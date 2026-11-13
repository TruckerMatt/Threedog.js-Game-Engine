// Messages between lockstep clients and the relay (plain JSON objects with a `type`). Shared by relay-room.js and lockstep.js.
//
// client → relay
//   { type: 'hello', room, name, version, contentHash, mapHash, observer?, key? }   join a room's lobby (key: rejoin a running match)
//   { type: 'slot', team?, faction? }                                              change my lobby slot
//   { type: 'ready', ready }                                                        mark ready
//   { type: 'start', settings? }                                                    host only: start when everyone is ready
//   { type: 'cmd', cmds: [...] }                                                    my commands; the relay puts them in the next turn
//   { type: 'hash', turn, hash }                                                    my state hash after running `turn`
//   { type: 'end', winner }                                                         my sim says the match ended
// relay → client
//   { type: 'welcome', you, key, observer }        your slot index (or -1 for an observer) and the key to rejoin with
//   { type: 'lobby', slots, host, state }          slots: [{ name, team, faction, ready, away }]
//   { type: 'start', settings, you }               settings: { seed, players: [{ name, team, faction }], turnMs, version, contentHash, mapHash, ... }
//   { type: 'turn', turn, cmds }                   the commands of one turn, each with p (set by the relay: a client cannot speak for another)
//   { type: 'catchup', turns: [[turn, cmds], ...], upTo }   on rejoin: every turn so far (empty turns left out), then live turns follow
//   { type: 'desync', turn, hashes }               the players' hashes for `turn` differ: { [player]: hash }
//   { type: 'away', p } / { type: 'back', p }      a player's connection dropped / came back
//   { type: 'error', code, msg }                   a refused request (bad message, version mismatch, room full...)

/** Bump when the protocol changes; the relay refuses clients with another version */
export const PROTOCOL = 1;
/** Turn length in milliseconds (two 50 ms ticks) */
export const TURN_MS = 100;
/** Clients report their hash every HASH_EVERY turns (once a second) */
export const HASH_EVERY = 10;
/** Most players in one match */
export const MAX_PLAYERS = 8;
/** Largest message the relay accepts, in bytes */
export const MAX_MESSAGE = 64 * 1024;
/** Most commands one client may put in one turn (anti-flood) */
export const MAX_CMDS_PER_TURN = 32;

/** A turn's command list as stored in logs and replays: only non-empty turns are kept */
export const compactTurns = turns => turns.filter(([, cmds]) => cmds.length);
