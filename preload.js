const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectPak: () => ipcRenderer.invoke('select-pak'),
  getInstances: () => ipcRenderer.invoke('get-instances'),
  createInstance: (name) => ipcRenderer.invoke('create-instance', name),
  downloadClient: () => ipcRenderer.invoke('download-client'),
  isClientDownloaded: () => ipcRenderer.invoke('is-client-downloaded'),
  downloadSteamcmd: () => ipcRenderer.invoke('download-steamcmd'),
  isSteamcmdDownloaded: () => ipcRenderer.invoke('is-steamcmd-downloaded'),
  openWorkshopWindow: (instanceName) => ipcRenderer.invoke('open-workshop-window', instanceName),
  searchWorkshop: (query) => ipcRenderer.invoke('search-workshop', query),
  downloadMod: (modId, instanceName) => ipcRenderer.invoke('download-mod', modId, instanceName),
  updateModStatus: (instanceName, modId, enabled) => ipcRenderer.invoke('update-mod-status', instanceName, modId, enabled),
  launchGame: (instanceName) => ipcRenderer.invoke('launch-game', instanceName),
  deleteInstance: (instanceName) => ipcRenderer.invoke('delete-instance', instanceName),
  deleteMod: (instanceName, modId) => ipcRenderer.invoke('delete-mod', instanceName, modId),
  checkForOpenstarboundUpdate: () => ipcRenderer.invoke('check-for-openstarbound-update'),
  showInputDialog: (options) => ipcRenderer.invoke('show-input-dialog', options)
});