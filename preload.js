const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
  getInstances: () => ipcRenderer.invoke('get-instances'),
  createInstance: (name, version) => ipcRenderer.invoke('create-instance', name, version),
  deleteInstance: (instanceName) => ipcRenderer.invoke('delete-instance', instanceName),
  launchGame: (instanceName) => ipcRenderer.invoke('launch-game', instanceName),
  getOpenStarboundVersions: () => ipcRenderer.invoke('get-openstarbound-versions'),
  onInstanceUpdate: (callback) => ipcRenderer.on('instance-updated', () => callback()),
  updateModStatus: (instanceName, modId, enabled) => ipcRenderer.invoke('update-mod-status', instanceName, modId, enabled),
  deleteMod: (instanceName, modId) => ipcRenderer.invoke('delete-mod', instanceName, modId),
  openWorkshopWindow: (instanceName) => ipcRenderer.invoke('open-workshop-window', instanceName),
  searchWorkshop: (query) => ipcRenderer.invoke('search-workshop', query),
  downloadMod: (args) => ipcRenderer.invoke('download-mod', args),
  openInputDialog: (options) => ipcRenderer.invoke('open-input-dialog', options),
  openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
  selectPak: () => ipcRenderer.invoke('select-pak'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  importMods: (instanceName, folderPath) => ipcRenderer.invoke('import-mods', instanceName, folderPath),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

contextBridge.exposeInMainWorld('workshopAPI', {
  onSetInstanceName: (callback) => ipcRenderer.on('set-instance-name', (_event, name) => callback(name)),
  onSetInstalledMods: (callback) => ipcRenderer.on('set-installed-mods', (_event, mods) => callback(mods))
});

contextBridge.exposeInMainWorld('inputDialogAPI', {
  sendResponse: (response) => ipcRenderer.send('dialog-response', response),
  onSetOptions: (callback) => ipcRenderer.on('set-dialog-options', (_event, options) => callback(options))
});