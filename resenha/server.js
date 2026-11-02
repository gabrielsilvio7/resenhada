// Servidor de sinalização: só apresenta os amigos uns aos outros.
// O áudio e a tela vão direto entre os navegadores (WebRTC).
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { noiseManifest } = require('./noise-assets');

const app = express();
// Supressão de ruído por IA (RNNoise): arquivos do pacote npm servidos pelo próprio servidor.
const NOISE_DIR = path.join(__dirname, 'node_modules', '@sapphi-red', 'web-noise-suppressor');
app.get('/vendor/noise/manifest.json', (_req, res) => res.json(noiseManifest(NOISE_DIR, '/vendor/noise')));
app.use('/vendor/noise', express.static(NOISE_DIR, { maxAge: '7d' }));
app.use(express.static('public'));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 * 1024 });

const rooms = new Map(); // sala -> Map(id -> ws)
let nextId = 1;

// Canais de texto (histórico só na memória: some quando o servidor dorme ou reinicia).
const TEXTS = ['geral', 'memes', 'jogos', 'estudo'];
const history = new Map(TEXTS.map((c) => [c, []]));
const MAX_FILES = 4; // anexos mantidos por canal

// Histórico gravado em arquivo (HISTORY_FILE). Só sobrevive a reinícios se o servidor tiver disco permanente.
const fs = require('fs');
const HIST_FILE = process.env.HISTORY_FILE || path.join(__dirname, 'data', 'history.json');
try {
  const d = JSON.parse(fs.readFileSync(HIST_FILE, 'utf8'));
  for (const c of TEXTS) if (Array.isArray(d[c])) history.set(c, d[c]);
} catch {}
let saveTimer;
function saveHistory() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(HIST_FILE), { recursive: true });
      fs.writeFileSync(HIST_FILE + '.tmp', JSON.stringify(Object.fromEntries(history)));
      fs.renameSync(HIST_FILE + '.tmp', HIST_FILE);
    } catch (e) { console.error('histórico não gravado:', e.message); }
  }, 3000);
}
function setProfile(ws, m) {
  ws.name = String(m.name || 'Anônimo').slice(0, 24);
  ws.avatar = typeof m.avatar === 'string' && m.avatar.startsWith('data:image/') && m.avatar.length < 30000 ? m.avatar : '';
}

const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
const broadcast = (room, msg, exceptId) =>
  rooms.get(room)?.forEach((p) => p.id !== exceptId && send(p, msg));

// Quem está em cada canal de voz (todos veem, mesmo estando em outro canal).
function presence() {
  const out = {};
  rooms.forEach((m, r) => (out[r] = [...m.values()].map((p) => ({ id: p.id, name: p.name, avatar: p.avatar }))));
  const online = [...wss.clients].filter((c) => c.readyState === 1 && c.name).map((c) => ({ id: c.id, name: c.name, avatar: c.avatar, room: c.room }));
  const msg = JSON.stringify({ type: 'presence', rooms: out, online });
  wss.clients.forEach((c) => c.readyState === 1 && c.send(msg));
}

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
  presence();

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'hello') {
      setProfile(ws, m); send(ws, { type: 'me', id: ws.id }); presence();
    } else if (m.type === 'leave-voice') {
      leave(ws); presence();
    } else if (m.type === 'join') {
      leave(ws);
      ws.room = String(m.room || 'geral').slice(0, 32);
      setProfile(ws, m);
      if (!rooms.has(ws.room)) rooms.set(ws.room, new Map());
      const room = rooms.get(ws.room);
      const peers = [...room.values()].map((p) => ({ id: p.id, name: p.name, avatar: p.avatar }));
      send(ws, { type: 'joined', id: ws.id, peers });
      room.set(ws.id, ws);
      broadcast(ws.room, { type: 'peer-joined', id: ws.id, name: ws.name, avatar: ws.avatar }, ws.id);
      presence();
    } else if (m.type === 'signal' && ws.room) {
      const target = rooms.get(ws.room)?.get(m.to);
      if (target) send(target, { type: 'signal', from: ws.id, data: m.data });
    } else if (m.type === 'history-req' && history.has(m.channel)) {
      send(ws, { type: 'history', channel: m.channel, msgs: history.get(m.channel) });
    } else if (m.type === 'text' && history.has(m.channel)) {
      const msg = { name: ws.name || 'Anônimo', avatar: ws.avatar || '', ts: Date.now(), text: String(m.text || '').slice(0, 1000) };
      const f = m.file;
      if (f && typeof f.data === 'string' && f.data.startsWith('data:') && f.data.length < 14000000) {
        msg.file = { name: String(f.name || 'arquivo').slice(0, 100), type: String(f.type || 'application/octet-stream').slice(0, 100), data: f.data };
      }
      if (!msg.text && !msg.file) return;
      const arr = history.get(m.channel);
      arr.push(msg);
      if (arr.length > 100) arr.shift();
      const withFiles = arr.filter((x) => x.file && !x.file.expired);
      while (withFiles.length > MAX_FILES) {
        const old = withFiles.shift();
        old.file = { name: old.file.name, type: old.file.type, expired: true };
      }
      saveHistory();
      const out = JSON.stringify({ type: 'text', channel: m.channel, msg });
      wss.clients.forEach((c) => c.readyState === 1 && c.send(out));
    }
  });

  ws.on('close', () => { leave(ws); presence(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`7M Hub rodando em http://localhost:${PORT}`));
