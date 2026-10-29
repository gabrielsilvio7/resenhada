// Servidor de sinalização: só apresenta os amigos uns aos outros.
// O áudio e a tela vão direto entre os navegadores (WebRTC).
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static('public'));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map(); // sala -> Map(id -> ws)
let nextId = 1;

const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
const broadcast = (room, msg, exceptId) =>
  rooms.get(room)?.forEach((p) => p.id !== exceptId && send(p, msg));

function leave(ws) {
  if (!ws.room) return;
  const room = rooms.get(ws.room);
  room?.delete(ws.id);
  broadcast(ws.room, { type: 'peer-left', id: ws.id });
  if (room && room.size === 0) rooms.delete(ws.room);
  ws.room = null;
}

wss.on('connection', (ws) => {
  ws.id = nextId++;
  ws.room = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'join') {
      leave(ws);
      ws.room = String(m.room || 'geral').slice(0, 32);
      ws.name = String(m.name || 'Anônimo').slice(0, 24);
      if (!rooms.has(ws.room)) rooms.set(ws.room, new Map());
      const room = rooms.get(ws.room);
      const peers = [...room.values()].map((p) => ({ id: p.id, name: p.name }));
      send(ws, { type: 'joined', id: ws.id, peers });
      room.set(ws.id, ws);
      broadcast(ws.room, { type: 'peer-joined', id: ws.id, name: ws.name }, ws.id);
    } else if (m.type === 'signal' && ws.room) {
      const target = rooms.get(ws.room)?.get(m.to);
      if (target) send(target, { type: 'signal', from: ws.id, data: m.data });
    } else if (m.type === 'chat' && ws.room) {
      broadcast(ws.room, { type: 'chat', name: ws.name, text: String(m.text).slice(0, 500) });
    }
  });

  ws.on('close', () => leave(ws));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Resenha rodando em http://localhost:${PORT}`));
