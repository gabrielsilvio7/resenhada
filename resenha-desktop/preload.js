// Ponte segura entre o app (Electron) e a página: só entrega o som da transmissão.
const { contextBridge, ipcRenderer } = require('electron');

let onChunk = null, onStatus = null;
ipcRenderer.on('audio-chunk', (_e, buf, meta) => onChunk && onChunk(buf, meta));
ipcRenderer.on('audio-status', (_e, msg) => onStatus && onStatus(msg));

contextBridge.exposeInMainWorld('hubAudio', {
  setWant: (v) => ipcRenderer.send('audio-want', !!v),
  onChunk: (cb) => { onChunk = cb; },
  onStatus: (cb) => { onStatus = cb; },
  stop: () => ipcRenderer.send('audio-stop'),
});
