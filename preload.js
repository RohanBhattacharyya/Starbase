const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
  getInstances: () => ipcRenderer.invoke('get-instances'),
  createInstance: (args) => ipcRenderer.invoke('create-instance', args),
  updateInstance: (oldName, newName, newDescription, newIcon) => ipcRenderer.invoke('update-instance', oldName, newName, newDescription, newIcon),
  deleteInstance: (instanceName) => ipcRenderer.invoke('delete-instance', instanceName),
  launchGame: (instanceName) => ipcRenderer.invoke('launch-game', instanceName),
  getOpenStarboundVersions: () => ipcRenderer.invoke('get-openstarbound-versions'),
  onInstanceUpdate: (callback) => ipcRenderer.on('instance-updated', () => callback()),
  updateModStatus: (instanceName, modId, enabled) => ipcRenderer.invoke('update-mod-status', instanceName, modId, enabled),
  deleteMod: (instanceName, modId) => ipcRenderer.invoke('delete-mod', instanceName, modId),
  openWorkshopWindow: (instanceName) => ipcRenderer.invoke('open-workshop-window', instanceName),
  searchWorkshop: (query, page, sort) => ipcRenderer.invoke('search-workshop', query, page, sort),
  getMods: (query, sort, page) => ipcRenderer.invoke('get-mods', query, sort, page),
  downloadMod: (args) => ipcRenderer.invoke('download-mod', args),
  downloadMods: (modsToDownload, instanceName) => ipcRenderer.invoke('download-mods', modsToDownload, instanceName),
  openInputDialog: (options) => ipcRenderer.invoke('open-input-dialog', options),
  openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
  selectPak: () => ipcRenderer.invoke('select-pak'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  importMods: (instanceName, folderPath) => ipcRenderer.invoke('import-mods', instanceName, folderPath),
  getLog: (instanceName) => ipcRenderer.invoke('get-log', instanceName),
  onLogUpdate: (callback) => ipcRenderer.on('log-updated', (event, log) => callback(log)),
  onGameClose: (callback) => ipcRenderer.on('game-closed', () => callback()),
  openIconPickerDialog: (currentIcon) => ipcRenderer.invoke('open-icon-picker-dialog', currentIcon),
  openInstanceFolder: (instanceName) => ipcRenderer.invoke('open-instance-folder', instanceName),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

contextBridge.exposeInMainWorld('workshopAPI', {
  onSetInstanceName: (callback) => ipcRenderer.on('set-instance-name', (_event, name) => callback(name)),
  onSetInstalledMods: (callback) => ipcRenderer.on('set-installed-mods', (_event, mods) => callback(mods)),
  onDownloadStatusUpdate: (callback) => ipcRenderer.on('download-status-update', (_event, status) => callback(status))
});

contextBridge.exposeInMainWorld('inputDialogAPI', {
  sendResponse: (response) => ipcRenderer.send('dialog-response', response),
  onSetOptions: (callback) => ipcRenderer.on('set-dialog-options', (_event, options) => callback(options))
});

contextBridge.exposeInMainWorld('iconPickerAPI', {
  sendSelectedIcon: (iconClass) => ipcRenderer.send('icon-selected', iconClass),
  importIcon: () => ipcRenderer.invoke('import-icon'),
  getCustomIcons: () => ipcRenderer.invoke('get-custom-icons'),
  openCustomIconsFolder: () => ipcRenderer.invoke('open-custom-icons-folder')
});