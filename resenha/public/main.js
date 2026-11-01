// Janela do app: abre o seu servidor 7M Hub, cuida do seletor de tela
// e captura o som só do programa transmitido (Windows).
const { app, BrowserWindow, session, desktopCapturer, Menu, shell, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// Módulo nativo de som por programa. Se não carregar, a transmissão segue sem som.
let capture = null;
try {
  capture = require('electron-native-screenshare');
  if (!capture.isAvailable()) capture = null;
} catch { capture = null; }

let wantAudio = false, useNative = false, capturing = false;
ipcMain.handle('audio-mode', () => ({ native: !!capture && process.platform === 'win32' }));
ipcMain.on('audio-want', (_e, want, native) => { wantAudio = !!want; useNative = !!native; });
ipcMain.on('audio-stop', () => stopAudio());

function stopAudio() {
  if (!capturing) return;
  try { capture.stopCapture(); } catch {}
  capturing = false;
}

function startAudio(win, src) {
  stopAudio();
  if (!wantAudio || !useNative) return;
  const status = (m) => !win.isDestroyed() && win.webContents.send('audio-status', m);
  if (process.platform !== 'win32' || !capture) return status('módulo de som não carregou');
  try {
    const onData = (buf, meta) => { if (!win.isDestroyed()) win.webContents.send('audio-chunk', buf, meta); };
    let ok;
    if (src.id.startsWith('window:')) {
      // Janela: só o som do programa dono da janela.
      const pid = capture.getPidFromWindowHandle(parseInt(src.id.split(':')[1], 10));
      if (!pid) return status('não achei o programa da janela');
      ok = capture.startCapture(pid, true, onData);
    } else {
      // Tela inteira: som de tudo, menos do próprio 7M Hub (evita o eco).
      ok = capture.startCapture(process.pid, false, onData);
    }
    capturing = !!ok;
    if (!ok) status('não consegui iniciar');
  } catch (e) { status(String(e.message || e).slice(0, 80)); }
}

function getUrl() {
  if (process.env.RESENHA_URL) return process.env.RESENHA_URL;
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).url; }
  catch { return 'http://localhost:3000'; }
}

function createWindow() {
  const url = getUrl();
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 560,
    backgroundColor: '#14161f', title: '7M Hub', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });

  // Libera microfone para o app.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'fullscreen'].includes(permission)));

  // Seletor de tela/janela quando você clica em "Compartilhar tela".
  // Padrão: som do sistema ('loopback'), como antes. Opção beta: módulo nativo por janela (startAudio).
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    let chosen = false;
    const menu = Menu.buildFromTemplate([
      { label: 'O que você quer compartilhar?', enabled: false },
      { type: 'separator' },
      ...sources.map((src) => ({
        label: (src.id.startsWith('screen') ? 'Tela: ' : 'Janela: ') + src.name.slice(0, 60),
        click: () => {
          chosen = true; startAudio(win, src);
          const loop = wantAudio && !useNative && process.platform === 'win32';
          callback(loop ? { video: src, audio: 'loopback' } : { video: src });
        },
      })),
    ]);
    menu.popup({ window: win, callback: () => { if (!chosen) callback({}); } });
  });

  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });

  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    const html = `<body style="font-family:sans-serif;background:#14161f;color:#e8eaf3;display:grid;place-items:center;height:100vh;margin:0">
      <div style="max-width:420px"><h2>Não consegui abrir o 7M Hub</h2>
      <p>Endereço: ${failedUrl}</p><p>${desc}. Confira se o servidor está ligado e se o endereço no config.json está certo.</p>
      <button onclick="location.href='${failedUrl}'" style="padding:10px 16px">Tentar de novo</button></div></body>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });

  win.loadURL(url);
}

app.whenReady().then(createWindow);
app.on('before-quit', stopAudio);
app.on('window-all-closed', () => app.quit());
