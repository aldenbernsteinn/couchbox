const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('couchbox', {
  getGames: () => ipcRenderer.invoke('get-games'),
  launchApp: (config) => ipcRenderer.invoke('launch-app', config),
  closeYouTube: () => ipcRenderer.invoke('close-youtube'),
});
