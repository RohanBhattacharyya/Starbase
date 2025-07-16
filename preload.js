const { contextBridge, ipcRenderer } = require('electron');

// A single, consistent API for the main application window
contextBridge.exposeInMainWorld('electronAPI', {
  // Instance Management
  getInstances: () => ipcRenderer.invoke('get-instances'),
  createInstance: (name, version) => ipcRenderer.invoke('create-instance', name, version),
  deleteInstance: (instanceName) => ipcRenderer.invoke('delete-instance', instanceName),
  launchGame: (instanceName) => ipcRenderer.invoke('launch-game', instanceName),
  getOpenStarboundVersions: () => ipcRenderer.invoke('get-openstarbound-versions'),
  onInstanceUpdate: (callback) => ipcRenderer.on('instance-updated', () => callback()),

  // Mod Management
  updateModStatus: (instanceName, modId, enabled) => ipcRenderer.invoke('update-mod-status', instanceName, modId, enabled),
  deleteMod: (instanceName, modId) => ipcRenderer.invoke('delete-mod', instanceName, modId),

  // Workshop
  openWorkshopWindow: (instanceName) => ipcRenderer.invoke('open-workshop-window', instanceName),
  searchWorkshop: (query) => ipcRenderer.invoke('search-workshop', query),
  downloadMod: (args) => ipcRenderer.invoke('download-mod', args),

  // Dialogs & Links
  openInputDialog: (options) => ipcRenderer.invoke('open-input-dialog', options),
  openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),

  // Setup
  selectPak: () => ipcRenderer.invoke('select-pak'),
});

// A separate, dedicated API for the Workshop window
contextBridge.exposeInMainWorld('workshopAPI', {
  onSetInstanceName: (callback) => ipcRenderer.on('set-instance-name', (_event, name) => callback(name))
});

// A separate, dedicated API for the custom Input Dialog window
contextBridge.exposeInMainWorld('inputDialogAPI', {
  sendResponse: (response) => ipcRenderer.send('dialog-response', response),
  onSetOptions: (callback) => ipcRenderer.on('set-dialog-options', (_event, options) => callback(options))
});