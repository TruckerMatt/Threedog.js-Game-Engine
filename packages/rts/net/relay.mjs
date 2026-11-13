#!/usr/bin/env node
// The RTS relay server: rooms, lobby, the turn clock and hash comparison (relay-room.js) behind a WebSocket endpoint. It never runs the game,
// so one small VM carries many matches: traffic is only commands (a few KB/s per match).
//   node packages/rts/net/relay.mjs [--port 8788] [--replays ./replays]       (or: npx threedog rts relay)
//   clients connect to ws://host:8788/<room-name>; GET /healthz answers "ok" (for load balancers and uptime checks)
// No dependencies; Node 20+. Put it behind a TLS proxy (wss://) in production. Replays of finished matches go to --replays as JSON.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RelayRoom } from './relay-room.js';
import { MAX_MESSAGE } from './protocol.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
for (const a of args) if (a.startsWith('--') && !['--port', '--replays'].includes(a)) { console.error(`✗ unknown option ${a} (known: --port, --replays)`); process.exit(1); }
const PORT = Number(opt('port', process.env.PORT || 8788));
const REPLAYS = opt('replays', process.env.RTS_REPLAYS || '');
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) { console.error(`✗ --port must be 1..65535`); process.exit(1); }
if (REPLAYS) mkdirSync(REPLAYS, { recursive: true });

const rooms = new Map();   // name → RelayRoom

const server = createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok\n'); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ relay: 'threedog rts', rooms: rooms.size, playing: [...rooms.values()].filter(r => r.state === 'playing').length }) + '\n');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return socket.destroy(); }
  const name = decodeURIComponent(url.pathname.slice(1)) || 'default';
  if (!/^[\w.-]{1,64}$/.test(name)) return socket.destroy();
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const room = rooms.get(name) ?? rooms.set(name, new RelayRoom(name)).get(name);
  const conn = wrap(socket);
  let joined = false;
  conn.onMessage = m => { if (!joined) { joined = true; room.join(conn, m); } else room.message(conn, m); };
  conn.onClose = () => room.leave(conn);
});

// the turn clock: pump every room often; save and drop finished rooms
setInterval(() => {
  for (const [name, room] of rooms) {
    room.pump();
    const empty = room.state === 'lobby' && !room.slots.length && !room.observers.length;
    if (room.state === 'ended' || empty) {
      if (REPLAYS && room.log.length) writeFileSync(join(REPLAYS, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ v: 1, ...room.replay() }));   // wall-clock: file name only
      rooms.delete(name);
    }
  }
}, 10);

server.listen(PORT, () => console.log(`threedog rts relay on ws://localhost:${PORT}/<room>  (health: /healthz${REPLAYS ? `, replays → ${REPLAYS}` : ''})`));

/** A tiny RFC 6455 connection: text frames, ping / pong, close; JSON messages only */
function wrap(socket) {
  let buf = Buffer.alloc(0), parts = [], partsLen = 0, closed = false;
  const c = {
    onMessage: null, onClose: null,
    send(obj) { if (!closed) socket.write(frame(0x1, Buffer.from(JSON.stringify(obj)))); },
    close() { if (closed) return; closed = true; socket.end(frame(0x8, Buffer.alloc(0))); c.onClose?.(); },
  };
  socket.on('data', chunk => {
    if (closed) return;
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      if (len > MAX_MESSAGE || !masked) return c.close();   // clients always mask; an unmasked or huge frame is not a game client
      if (buf.length < at + 4 + len) return;
      const mask = buf.subarray(at, at + 4), data = Buffer.from(buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(at + 4 + len);
      if (op === 0x8) return c.close();
      if (op === 0x9) { socket.write(frame(0xA, data)); continue; }
      if (op === 0xA) continue;
      partsLen += data.length;
      if (partsLen > MAX_MESSAGE) return c.close();
      parts.push(data);
      if (!fin) continue;
      const text = Buffer.concat(parts).toString('utf8'); parts = []; partsLen = 0;
      let d; try { d = JSON.parse(text); } catch { continue; }   // not JSON: not a game message
      c.onMessage?.(d);
    }
  });
  socket.on('end', () => { c.close(); socket.destroy(); });
  socket.on('close', () => { if (!closed) { closed = true; c.onClose?.(); } });
  socket.on('error', () => socket.destroy());
  return c;
}

function frame(op, data) {
  const n = data.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  if (n >= 126 && n < 65536) { head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
  else if (n >= 65536) { head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, data]);
}
