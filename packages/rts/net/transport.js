// Transports carry JSON messages between a lockstep client and the relay. Shape: { send(obj), close(), onOpen, onMessage, onClose }
// (the driver sets the three callbacks). Delivery must keep order (a WebSocket does).
//
//   webSocketTransport('wss://relay.example.com/room-1')     browsers, and Node 22+ (global WebSocket)
//   const net = memoryNetwork({ latency: 80, jitter: 30 });  tests and offline demos: an in-process relay with a manual clock
//   const a = net.connect(), b = net.connect();              transports for lockstepDriver
//   net.advance(100);                                        move the fake clock: deliver what is due, let the relay send turns
//   net.drop(a); net.reconnect()                             cut a client off (the relay sees a close), then a fresh transport
import { RelayRoom } from './relay-room.js';

/** A WebSocket transport (reconnecting is the game's call: make a new transport and a driver with the rejoin key) */
export function webSocketTransport(url) {
  const ws = new WebSocket(url);
  const t = {
    onOpen: null, onMessage: null, onClose: null,
    send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    close() { ws.close(); },
  };
  ws.onopen = () => t.onOpen?.();
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } t.onMessage?.(m); };   // a broken frame is ignored: the relay only sends JSON
  ws.onclose = () => t.onClose?.();
  return t;
}

/**
 * An in-process relay and network for tests: one room, a fake clock in ms, per-message latency + jitter (seeded, order kept per link).
 * spikes: { chance, ms } delays that share of messages by ms more: packet loss on a WebSocket (TCP) shows up as a resend, so as a late message
 * that holds up the ones behind it, never as a lost one.
 * @param {{ latency?: number, jitter?: number, spikes?: { chance: number, ms: number }, seed?: number, room?: object }} [o] room: options for RelayRoom
 */
export function memoryNetwork(o = {}) {
  let clock = 0, seq = 0, rnd = (o.seed ?? 7) >>> 0 || 7;
  const rand = () => { rnd ^= rnd << 13; rnd >>>= 0; rnd ^= rnd >> 17; rnd ^= rnd << 5; rnd >>>= 0; return rnd / 4294967296; };
  const room = new RelayRoom('memory', { now: () => clock, seed: () => 12345, ...(o.room ?? {}) });
  const queue = [];   // { at, seq, fn }
  const lastAt = new Map();
  const delay = link => {
    const spike = o.spikes && rand() < o.spikes.chance ? o.spikes.ms : 0;
    const at = Math.max(clock + (o.latency ?? 0) + rand() * (o.jitter ?? 0) + spike, lastAt.get(link) ?? 0);   // never overtake an earlier message
    lastAt.set(link, at);
    return at;
  };
  const later = (link, fn) => queue.push({ at: delay(link), seq: seq++, fn });
  const net = {
    room,
    get now() { return clock; },
    latency: o.latency ?? 0, jitter: o.jitter ?? 0,
    connect() {
      const up = {}, down = {};
      const conn = { open: true, send: m => { if (conn.open) later(down, () => t.onMessage?.(JSON.parse(JSON.stringify(m)))); }, close: () => { if (conn.open) { conn.open = false; later(down, () => t.onClose?.()); } } };
      let joined = false;
      const t = {
        onOpen: null, onMessage: null, onClose: null, conn,
        send(m) {
          if (!conn.open) return;
          const copy = JSON.parse(JSON.stringify(m));
          later(up, () => { if (!conn.open) return; if (!joined) { joined = true; room.join(conn, copy); } else room.message(conn, copy); });
        },
        close() { if (!conn.open) return; conn.open = false; later(up, () => room.leave(conn)); later(down, () => t.onClose?.()); },
      };
      later(down, () => t.onOpen?.());
      return t;
    },
    /** Cut a transport off without a goodbye (the relay sees the connection close) */
    drop(t) { t.close(); },
    /** Advance the fake clock by ms: deliver due messages in time order, pump the relay every 10 ms */
    advance(ms) {
      const end = clock + ms;
      while (clock < end) {
        clock = Math.min(end, clock + 10);
        room.pump();
        queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
        while (queue.length && queue[0].at <= clock) queue.shift().fn();
      }
    },
  };
  return net;
}
