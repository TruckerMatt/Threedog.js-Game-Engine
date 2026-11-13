// One match room on the relay: the lobby, then the turn clock. The relay never runs the game. Every TURN_MS it sends one turn holding the
// commands that arrived since the last turn (each stamped with its sender's player index), keeps the log for rejoins and replays, and
// compares the hashes clients report so a desync is caught by a third party with no stake in either sim.
// Pure logic with an injected clock and connections: relay.mjs wraps it in a WebSocket server, tests drive it with a fake clock.
//
//   const room = new RelayRoom('my-room', { now: () => Date.now() });
//   room.join(conn, helloMsg);  room.message(conn, msg);  room.leave(conn);  room.pump();   // pump(): send every turn that is due
//   conn = { send(obj), close() }
import { PROTOCOL, TURN_MS, HASH_EVERY, MAX_PLAYERS, MAX_CMDS_PER_TURN } from './protocol.js';

let keySeq = 0;
const newKey = () => `k${Date.now().toString(36)}${(keySeq++).toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;

export class RelayRoom {
  /**
   * @param {string} name
   * @param {{ now?: () => number, turnMs?: number, leaveAfterMs?: number, observerDelay?: number, maxPlayers?: number, seed?: () => number }} [o]
   *   leaveAfterMs: a dropped player becomes a 'leave' command after this long (default 60 s); observerDelay: turns observers lag (default 30, 3 s)
   */
  constructor(name, o = {}) {
    this.name = name;
    this.now = o.now ?? (() => Date.now());
    this.turnMs = o.turnMs ?? TURN_MS;
    this.leaveAfterMs = o.leaveAfterMs ?? 60_000;
    this.observerDelay = o.observerDelay ?? 30;
    this.maxPlayers = Math.min(MAX_PLAYERS, o.maxPlayers ?? MAX_PLAYERS);
    this.seedFn = o.seed ?? (() => Math.floor(Math.random() * 0x7fffffff) + 1);
    this.state = 'lobby';          // lobby | playing | ended
    this.slots = [];               // { conn, name, team, faction, ready, key, awaySince, left }
    this.observers = [];           // { conn, sent }
    this.host = 0;
    this.version = null;           // { version, contentHash, mapHash } of the first joiner; others must match
    this.settings = null;
    this.turn = 0; this.startedAt = 0;
    this.inbox = [];               // commands waiting for the next turn
    this.log = [];                 // [turn, cmds] for every turn sent (empty ones too, compacted when shipped)
    this.hashes = new Map();       // turn → Map(player → hash)
    this.desyncs = [];
    this.ends = new Map();
  }

  /** A connection's first message. Returns '' or the reason it was refused (the conn is told and closed). */
  join(conn, m) {
    const refuse = (code, msg) => { conn.send({ type: 'error', code, msg }); conn.close(); return msg; };
    if (m?.type !== 'hello') return refuse('bad-hello', 'the first message must be { type: "hello", ... }');
    if (m.protocol !== PROTOCOL) return refuse('protocol', `relay speaks protocol ${PROTOCOL}, client ${m.protocol}: update the game`);
    const ver = { version: String(m.version ?? ''), contentHash: m.contentHash >>> 0, mapHash: m.mapHash >>> 0 };
    if (m.key) {   // rejoin
      const i = this.slots.findIndex(s => s.key === m.key);
      if (i < 0) return refuse('bad-key', 'no player with that key in this room');
      const s = this.slots[i];
      if (s.left) return refuse('left', 'that player already left the match');
      s.conn = conn; s.awaySince = 0;
      conn.send({ type: 'welcome', you: i, key: s.key, observer: false });
      if (this.state === 'lobby') { this.broadcastLobby(); return ''; }
      conn.send({ type: 'start', settings: this.settings, you: i });
      conn.send({ type: 'catchup', turns: this.log.filter(([, c]) => c.length), upTo: this.turn - 1 });
      this.broadcast({ type: 'back', p: i });
      return '';
    }
    if (this.version && (ver.version !== this.version.version || ver.contentHash !== this.version.contentHash || ver.mapHash !== this.version.mapHash))
      return refuse('mismatch', `game build differs from the room's (version ${this.version.version}, content ${this.version.contentHash}, map ${this.version.mapHash}): everyone needs the same build and map`);
    if (m.observer) {
      const o = { conn, sent: 0 };
      this.observers.push(o);
      conn.send({ type: 'welcome', you: -1, key: '', observer: true });
      if (this.state !== 'lobby') { conn.send({ type: 'start', settings: this.settings, you: -1 }); this.feedObserver(o); }
      return '';
    }
    if (this.state !== 'lobby') return refuse('started', 'the match already started (join as an observer, or rejoin with your key)');
    if (this.slots.length >= this.maxPlayers) return refuse('full', `the room is full (${this.maxPlayers} players)`);
    this.version ??= ver;
    const s = { conn, name: String(m.name ?? `player ${this.slots.length + 1}`).slice(0, 32), team: this.slots.length, faction: null, ready: false, key: newKey(), awaySince: 0, left: false };
    this.slots.push(s);
    conn.send({ type: 'welcome', you: this.slots.length - 1, key: s.key, observer: false });
    this.broadcastLobby();
    return '';
  }

  /** Every later message from a joined connection */
  message(conn, m) {
    const i = this.slots.findIndex(s => s.conn === conn);
    const err = (code, msg) => conn.send({ type: 'error', code, msg });
    if (i < 0) return err('not-joined', 'observers only listen; players send hello first');
    const s = this.slots[i];
    switch (m?.type) {
      case 'slot':
        if (this.state !== 'lobby') return err('started', 'slots are fixed once the match starts');
        if (m.team !== undefined) { if (!Number.isInteger(m.team) || m.team < 0 || m.team >= MAX_PLAYERS) return err('bad-team', 'team must be 0..7'); s.team = m.team; }
        if (m.faction !== undefined) s.faction = m.faction === null ? null : String(m.faction).slice(0, 32);
        s.ready = false;
        return this.broadcastLobby();
      case 'ready':
        if (this.state !== 'lobby') return;
        s.ready = !!m.ready;
        return this.broadcastLobby();
      case 'start': {
        if (this.state !== 'lobby') return err('started', 'already started');
        if (i !== this.host) return err('not-host', 'only the host starts the match');
        const notReady = this.slots.filter((x, j) => j !== this.host && !x.ready).map(x => x.name);
        if (notReady.length) return err('not-ready', `waiting for: ${notReady.join(', ')}`);
        if (new Set(this.slots.map(x => x.team)).size < 2 && !m.settings?.allowOneTeam) return err('one-team', 'everyone is on one team (set settings.allowOneTeam for co-op vs bots)');
        return this.start(m.settings ?? {});
      }
      case 'cmd': {
        if (this.state !== 'playing') return err('not-playing', 'commands only count during a match');
        if (!Array.isArray(m.cmds)) return err('bad-cmd', 'cmds must be an array');
        const mine = this.inbox.filter(c => c.p === i).length;
        for (const c of m.cmds.slice(0, Math.max(0, MAX_CMDS_PER_TURN - mine))) if (c && typeof c === 'object' && typeof c.t === 'string' && c.t !== 'leave') this.inbox.push({ ...c, p: i });
        return;
      }
      case 'hash': return this.reportHash(i, m.turn, m.hash);
      case 'end': this.ends.set(i, m.winner); if (this.ends.size >= this.slots.filter(x => !x.left).length) this.state = 'ended'; return;
      default: return err('bad-type', `unknown message type '${m?.type}'`);
    }
  }

  /** A connection closed */
  leave(conn) {
    this.observers = this.observers.filter(o => o.conn !== conn);
    const i = this.slots.findIndex(s => s.conn === conn);
    if (i < 0) return;
    const s = this.slots[i];
    s.conn = null;
    if (this.state === 'lobby') {   // in the lobby a slot is just freed
      this.slots.splice(i, 1);
      if (this.host >= this.slots.length) this.host = 0;
      return this.broadcastLobby();
    }
    s.awaySince = this.now();
    this.broadcast({ type: 'away', p: i });
  }

  start(settings) {
    this.state = 'playing';
    this.settings = { ...settings, seed: Number.isInteger(settings.seed) ? settings.seed : this.seedFn(), turnMs: this.turnMs, ...this.version,
      players: this.slots.map(s => ({ name: s.name, team: s.team, faction: s.faction })) };
    this.slots.forEach((s, i) => s.conn?.send({ type: 'start', settings: this.settings, you: i }));
    for (const o of this.observers) o.conn.send({ type: 'start', settings: this.settings, you: -1 });
    this.startedAt = this.now(); this.turn = 0;
  }

  /** Send every turn that is due by the clock (call often; the WebSocket server calls it on a short timer) */
  pump() {
    if (this.state !== 'playing') return;
    const now = this.now();
    for (const s of this.slots) if (s.awaySince && !s.left && now - s.awaySince >= this.leaveAfterMs) {
      s.left = true; this.inbox.push({ p: this.slots.indexOf(s), t: 'leave' });
    }
    while (this.startedAt + this.turn * this.turnMs <= now) {
      const cmds = this.inbox; this.inbox = [];
      this.log.push([this.turn, cmds]);
      for (const s of this.slots) s.conn?.send({ type: 'turn', turn: this.turn, cmds });
      this.turn++;
    }
    for (const o of this.observers) this.feedObserver(o);
    if (this.slots.every(s => s.left || !s.conn) && now - Math.max(...this.slots.map(s => s.awaySince || 0)) > this.leaveAfterMs) this.state = 'ended';
  }

  feedObserver(o) {
    const upTo = this.turn - this.observerDelay;
    while (o.sent < upTo) { const [turn, cmds] = this.log[o.sent]; o.conn.send({ type: 'turn', turn, cmds }); o.sent++; }
  }

  reportHash(p, turn, hash) {
    if (!Number.isInteger(turn) || turn % HASH_EVERY !== 0 || turn >= this.turn) return;
    const m = this.hashes.get(turn) ?? this.hashes.set(turn, new Map()).get(turn);
    m.set(p, hash >>> 0);
    const active = this.slots.filter(s => !s.left).length;
    if (m.size >= active) {
      if (new Set(m.values()).size > 1) {
        const d = { type: 'desync', turn, hashes: Object.fromEntries(m) };
        this.desyncs.push(d);
        this.broadcast(d);
      }
      this.hashes.delete(turn);
    }
    for (const t of this.hashes.keys()) if (t < turn - HASH_EVERY * 30) this.hashes.delete(t);   // stragglers who never reported
  }

  broadcast(m) { for (const s of this.slots) s.conn?.send(m); }

  broadcastLobby() {
    const m = { type: 'lobby', state: this.state, host: this.host, slots: this.slots.map(s => ({ name: s.name, team: s.team, faction: s.faction, ready: s.ready, away: !s.conn })) };
    this.broadcast(m);
    for (const o of this.observers) o.conn.send(m);
  }

  /** The match so far as a replay body: settings and the non-empty turns */
  replay() { return { settings: this.settings, turns: this.log.filter(([, c]) => c.length), lastTurn: this.turn - 1 }; }

  describe() {
    return { room: this.name, state: this.state, players: this.slots.length, observers: this.observers.length, turn: this.turn,
      away: this.slots.filter(s => !s.conn && !s.left).length, desyncs: this.desyncs.length };
  }
}
