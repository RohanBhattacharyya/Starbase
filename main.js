const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const Store = require('electron-store');
const axios = require('axios');
const yauzl = require('yauzl');
const tar = require('tar-fs');
const { spawn } = require('child_process');
const fse = require('fs-extra'); // Import fs-extra

const store = new Store();

const instancesDir = path.join(app.getPath('userData'), 'instances');
const steamcmdDir = path.join(app.getPath('userData'), 'steamcmd');
const steamcmdExecutable = path.join(steamcmdDir, 'steamcmd.sh');

if (!fs.existsSync(instancesDir)) fse.mkdirpSync(instancesDir); // Use fse.mkdirpSync for recursive creation
if (!fs.existsSync(steamcmdDir)) fse.mkdirpSync(steamcmdDir);

async function downloadAndExtractClient(versionTag, instancePath) {
    const releaseUrl = `https://api.github.com/repos/OpenStarbound/OpenStarbound/releases/tags/${versionTag}`;
    const tempDir = app.getPath('temp');
    const downloadPath = path.join(tempDir, `openstarbound-${versionTag}.zip`);

    try {
        console.log(`Fetching release info for ${versionTag}...`);
        const response = await axios.get(releaseUrl);
        const release = response.data;

        const asset = release.assets.find(a => a.name.toLowerCase().includes('linux') && a.name.toLowerCase().includes('client'));
        if (!asset) throw new Error(`No Linux client asset found in release ${versionTag}.`);

        console.log(`Downloading ${asset.name}...`);
        const assetResponse = await axios({ url: asset.browser_download_url, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(downloadPath);
        assetResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log('Download complete. Extracting zip...');
        await new Promise((resolve, reject) => {
            yauzl.open(downloadPath, { lazyEntries: true }, (err, zipfile) => {
                if (err) return reject(err);
                zipfile.readEntry();
                zipfile.on('entry', (entry) => {
                    if (entry.fileName.includes('client.tar')) {
                        console.log('Found client.tar. Extracting tarball...');
                        zipfile.openReadStream(entry, (err, readStream) => {
                            if (err) return reject(err);
                            const extract = tar.extract(instancePath, {
                                map: (header) => {
                                    header.name = header.name.replace(/^client_distribution\//, '');
                                    return header;
                                }
                            });
                            readStream.pipe(extract);
                            extract.on('finish', () => {
                                console.log('Extraction complete.');
                                zipfile.close();
                                resolve();
                            });
                            extract.on('error', reject);
                        });
                    } else {
                        zipfile.readEntry();
                    }
                });
                zipfile.on('end', () => {
                    // This might be reached if client.tar is not found
                });
            });
        });

        fs.unlinkSync(downloadPath); // Clean up the downloaded zip
        return instancePath;

    } catch (error) {
        console.error('Failed to download and extract client:', error);
        dialog.showErrorBox('Client Download Failed', error.message);
        if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath); // Cleanup on error
        return null;
    }
}

let mainWindow;

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (!store.get('packedPakPath')) {
    mainWindow.loadFile('setup.html');
  } else {
    mainWindow.loadFile('index.html');
  }
}

app.whenReady().then(createWindow);
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('select-pak', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Starbound Assets', extensions: ['pak'] }] });
  if (canceled || filePaths.length === 0) return null;
  store.set('packedPakPath', filePaths[0]);
  BrowserWindow.getAllWindows()[0].loadFile('index.html');
  return filePaths[0];
});

ipcMain.handle('get-instances', async () => store.get('instances', []));

ipcMain.handle('create-instance', async (event, { value: instanceName, version }) => {
    const instances = store.get('instances', []);
    if (instances.some(inst => inst.name === instanceName)) {
        dialog.showErrorBox('Error', 'An instance with this name already exists.');
        return null;
    }

    console.log(`DEBUG: create-instance handler - instancesDir: ${instancesDir} (type: ${typeof instancesDir}), instanceName: ${instanceName} (type: ${typeof instanceName})`);
    const instancePath = path.join(instancesDir, instanceName);

    try {
        // Download and extract the selected version
        const clientPath = await downloadAndExtractClient(version.tag, instancePath);
        if (!clientPath) {
            throw new Error('Failed to download and extract client.');
        }

        const instanceAssetsPath = path.join(instancePath, 'assets');
        const instanceModsPath = path.join(instancePath, 'mods');
        const instanceStoragePath = path.join(instancePath, 'storage');

        fse.mkdirpSync(instanceAssetsPath);
        fse.mkdirpSync(instanceModsPath);
        fse.mkdirpSync(instanceStoragePath);

        // Symlink packed.pak
        const pakPath = store.get('packedPakPath');
        if (pakPath) {
            fs.symlinkSync(pakPath, path.join(instanceAssetsPath, 'packed.pak'));
        } else {
            throw new Error('packed.pak path is not set.');
        }

        store.set('instances', [...instances, { name: instanceName, version: version.tag, mods: [], clientPath: instancePath }]);
        return instanceName;
    } catch (error) {
        console.error('Failed to create instance:', error);
        dialog.showErrorBox('Instance Creation Failed', error.message);
        if (fs.existsSync(instancePath)) fse.removeSync(instancePath); // Clean up
        return null;
    }
});

ipcMain.handle('get-openstarbound-versions', async () => {
    const releaseUrl = 'https://api.github.com/repos/OpenStarbound/OpenStarbound/releases';
    try {
        const response = await axios.get(releaseUrl);
        const releases = response.data.filter(r => !r.prerelease && !r.draft);
        return releases.map(r => ({ tag: r.tag_name, name: r.name }));
    } catch (error) {
        console.error('Failed to fetch OpenStarbound versions:', error);
        return [];
    }
});

ipcMain.handle('download-steamcmd', async () => {
    const steamcmdUrl = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz';
    const tempDir = app.getPath('temp');
    const downloadPath = path.join(tempDir, 'steamcmd_linux.tar.gz');

    try {
        console.log('Downloading steamcmd...');
        const response = await axios({ url: steamcmdUrl, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(downloadPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log('Download complete. Extracting steamcmd...');
        await new Promise((resolve, reject) => {
            fs.createReadStream(downloadPath)
                .pipe(zlib.createGunzip()) // Decompress the tar.gz
                .pipe(tar.extract(steamcmdDir))
                .on('finish', resolve)
                .on('error', reject);
        });

        fs.unlinkSync(downloadPath); // Clean up the downloaded tar.gz
        store.set('steamcmdDownloaded', true);
        return true;

    } catch (error) {
        console.error('Failed to download and extract steamcmd:', error);
        dialog.showErrorBox('SteamCMD Download Failed', error.message);
        if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath); // Cleanup on error
        return false;
    }
});

ipcMain.handle('is-steamcmd-downloaded', async () => {
    return store.get('steamcmdDownloaded', false);
});

ipcMain.handle('open-workshop-window', (event, instanceName) => {
    const workshopWindow = new BrowserWindow({
        width: 900,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    workshopWindow.loadFile('workshop.html');
    workshopWindow.webContents.on('did-finish-load', () => {
        workshopWindow.webContents.send('set-instance-name', instanceName);
    });
});

ipcMain.handle('open-external-link', (event, url) => {
    shell.openExternal(url);
});

let inputDialogWindow = null;

function showInputDialog(options) {
    return new Promise((resolve) => {
        if (inputDialogWindow) {
            inputDialogWindow.focus();
            return;
        }

        if (!mainWindow) {
            console.error("main.js: Cannot open input dialog, mainWindow is not defined.");
            return resolve({ value: null, canceled: true });
        }

        const parentWindow = mainWindow;

        inputDialogWindow = new BrowserWindow({
            width: 400,
            height: 250,
            parent: parentWindow,
            modal: true,
            show: false,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false
            }
        });

        inputDialogWindow.loadFile('inputDialog.html');

        inputDialogWindow.once('ready-to-show', () => {
            inputDialogWindow.show();
            inputDialogWindow.webContents.send('set-dialog-options', options);
        });

        const onDialogResponse = (event, result) => {
            if (inputDialogWindow) {
                inputDialogWindow.close();
            }
            resolve(result);
        };

        ipcMain.once('dialog-response', onDialogResponse);

        inputDialogWindow.on('closed', () => {
            inputDialogWindow = null;
            ipcMain.removeListener('dialog-response', onDialogResponse);
            resolve({ value: null, canceled: true });
        });
    });
}

ipcMain.handle('open-input-dialog', (event, options) => {
    console.log('main.js: Received open-input-dialog IPC call with options:', options);
    return showInputDialog(options);
});

function showInputDialog(options) {
    console.log('main.js: showInputDialog called with options:', options);
    return new Promise((resolve) => {
        if (inputDialogWindow) {
            console.log('main.js: inputDialogWindow already exists, focusing.');
            inputDialogWindow.focus();
            return;
        }

        const parentWindow = BrowserWindow.getFocusedWindow();
        if (!parentWindow) {
            console.error("main.js: Cannot open input dialog, no focused window.");
            return resolve({ value: null, canceled: true });
        }

        inputDialogWindow = new BrowserWindow({
            width: 400,
            height: 250,
            parent: parentWindow,
            modal: true,
            show: false,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false
            }
        });

        inputDialogWindow.loadFile('inputDialog.html');

        inputDialogWindow.once('ready-to-show', () => {
            console.log('main.js: inputDialogWindow ready-to-show. Sending options:', options);
            inputDialogWindow.show();
            inputDialogWindow.webContents.send('set-dialog-options', options);
        });

        const onDialogResponse = (event, result) => {
            console.log('main.js: Received dialog-response:', result);
            if (inputDialogWindow) {
                inputDialogWindow.close();
            }
            resolve(result);
        };

        ipcMain.once('dialog-response', onDialogResponse);

        inputDialogWindow.on('closed', () => {
            console.log('main.js: inputDialogWindow closed.');
            inputDialogWindow = null;
            ipcMain.removeListener('dialog-response', onDialogResponse);
            resolve({ value: null, canceled: true });
        });
    });
}

ipcMain.handle('search-workshop', async (event, query) => {
    let apiKey = store.get('steamApiKey');
    if (!apiKey) {
        const result = await showInputDialog({
            title: 'Steam Web API Key',
            message: 'Please enter your Steam Web API key to search the workshop. You can get one from https://steamcommunity.com/dev/apikey',
            placeholder: 'Your API Key'
        });

        if (result.canceled || !result.value) {
            dialog.showErrorBox('API Key Required', 'A Steam Web API key is required to search the workshop.');
            return [];
        }
        apiKey = result.value;
        store.set('steamApiKey', apiKey);
    }

    let searchUrl;
    const isNumericId = /^\d+$/.test(query);

    if (isNumericId) {
        // Use GetPublishedFileDetails for specific ID
        searchUrl = `https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/`;
    } else {
        // Use QueryFiles for text search
        searchUrl = `https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/`;
    }

    try {
        let response;
        if (isNumericId) {
            const params = new URLSearchParams();
            params.append('itemcount', 1);
            params.append('publishedfileids[0]', query);
            response = await axios.post(searchUrl, params);
        } else {
            response = await axios.get(searchUrl, {
                params: {
                    key: apiKey,
                    appid: 211820,
                    search_text: query,
                    numperpage: 20,
                    return_metadata: true
                }
            });
        }

        const details = response.data.response.publishedfiledetails;

        if (!details || details.length === 0 || details[0].result === 9) {
             dialog.showErrorBox('No Mods Found', `No mods found for your query: "${query}"`);
            return [];
        }

        const mods = details.map(mod => ({
            id: mod.publishedfileid,
            name: mod.title,
            imageUrl: mod.preview_url,
            url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.publishedfileid}`
        }));
        return mods;
    } catch (error) {
        console.error('Failed to search workshop:', error);
        dialog.showErrorBox('Workshop Search Failed', 'Could not fetch or parse search results from the Steam Workshop API.');
        return [];
    }
});

ipcMain.handle('download-mod', async (event, { modId, modName, instanceName }) => {
    if (!fs.existsSync(steamcmdExecutable)) {
        dialog.showErrorBox('Error', 'SteamCMD executable not found. Please download SteamCMD first.');
        return false;
    }

    const instancePath = path.join(instancesDir, instanceName);
    const instanceModsPath = path.join(instancePath, 'mods');
    const downloadedModPath = path.join(app.getPath('home'), '.steam', 'SteamApps', 'workshop', 'content', '211820', modId);

    try {
        // Ensure steamcmd.sh is executable
        fs.chmodSync(steamcmdExecutable, '755');

        console.log(`Downloading mod ${modId} using steamcmd...`);
        await new Promise((resolve, reject) => {
            const steamcmdProcess = spawn(steamcmdExecutable, [
                '+force_install_dir', steamcmdDir,
                '+login', 'anonymous',
                '+workshop_download_item', '211820', modId,
                '+quit'
            ]);

            steamcmdProcess.stdout.on('data', (data) => {
                console.log(`steamcmd: ${data}`);
            });

            steamcmdProcess.stderr.on('data', (data) => {
                console.error(`steamcmd stderr: ${data}`);
            });

            steamcmdProcess.on('close', (code) => {
                if (code !== 0) {
                    console.error(`steamcmd process exited with code ${code}`);
                    reject(new Error(`SteamCMD exited with code ${code}`));
                    return;
                }
                console.log(`Mod ${modId} downloaded to ${downloadedModPath}`);
                resolve();
            }
        );
    });

        if (fs.existsSync(downloadedModPath)) {
            const destinationPath = path.join(instanceModsPath, `${modName}.pak`);
            fse.moveSync(path.join(downloadedModPath, 'contents.pak'), destinationPath, { overwrite: true });

            const instances = store.get('instances', []);
            const updatedInstances = instances.map(inst => {
                if (inst.name === instanceName) {
                    const mods = inst.mods || [];
                    if (!mods.some(m => m.id === modId)) {
                        return { ...inst, mods: [...mods, { id: modId, name: modName, enabled: true }] };
                    }
                }
                return inst;
            });
            store.set('instances', updatedInstances);

            // Notify the renderer to update the instances
            mainWindow.webContents.send('instance-updated');

            return true;
        } else {
            throw new Error('Downloaded mod not found at expected path.');
        }

    } catch (error) {
        console.error('Failed to download or move mod:', error);
        dialog.showErrorBox('Mod Download Failed', error.message);
        return false;
    }
});

ipcMain.handle('update-mod-status', (event, instanceName, modId, enabled) => {
    const instances = store.get('instances', []);
    const updatedInstances = instances.map(inst => {
        if (inst.name === instanceName) {
            const updatedMods = inst.mods.map(mod => {
                if (mod.id === modId) {
                    return { ...mod, enabled: enabled };
                }
                return mod;
            });
            return { ...inst, mods: updatedMods };
        }
        return inst;
    });
    store.set('instances', updatedInstances);
    return true;
});

ipcMain.handle('launch-game', async (event, instanceName) => {
    const instances = store.get('instances', []);
    const instance = instances.find(inst => inst.name === instanceName);

    if (!instance) {
        dialog.showErrorBox('Error', `Instance '${instanceName}' not found.`);
        return false;
    }

    const starboundExecutable = path.join(instance.clientPath, 'linux', 'starbound');
    if (!fs.existsSync(starboundExecutable)) {
        dialog.showErrorBox('Error', 'OpenStarbound executable not found. Please ensure the client is downloaded for this instance.');
        return false;
    }

    // Ensure the executable is runnable
    fs.chmodSync(starboundExecutable, '755');

    const instancePath = path.join(instancesDir, instanceName);
    const instanceModsPath = path.join(instancePath, 'mods');
    const instanceAssetsPath = path.join(instancePath, 'assets');
    const instanceStoragePath = path.join(instancePath, 'storage');

    const args = [];
    const env = { ...process.env };

    console.log(`Launching ${starboundExecutable}`);

    try {
        const gameProcess = spawn(starboundExecutable, [], {
            cwd: instance.clientPath, // Run from the instance's client directory
            env: env,
            detached: true, // Detach the child process from the parent
            stdio: 'ignore' // Ignore stdio to prevent blocking the main process
        });

        gameProcess.unref(); // Allow the parent process to exit independently

        dialog.showMessageBox(BrowserWindow.getAllWindows()[0], {
            type: 'info',
            title: 'Launching Game',
            message: `Launching OpenStarbound instance: ${instanceName}`,
            buttons: ['OK']
        });
        return true;
    } catch (error) {
        console.error('Failed to launch game:', error);
        dialog.showErrorBox('Game Launch Failed', error.message);
        return false;
    }
});

ipcMain.handle('delete-instance', async (event, instanceName) => {
    const instances = store.get('instances', []);
    const instancePath = path.join(instancesDir, instanceName);

    try {
        if (fs.existsSync(instancePath)) {
            fse.removeSync(instancePath); // Use fse.removeSync for recursive deletion
            console.log(`Instance directory ${instancePath} deleted.`);
        }

        const updatedInstances = instances.filter(inst => inst.name !== instanceName);
        store.set('instances', updatedInstances);
        return true;
    } catch (error) {
        console.error('Failed to delete instance:', error);
        dialog.showErrorBox('Instance Deletion Failed', error.message);
        return false;
    }
});

ipcMain.handle('delete-mod', async (event, instanceName, modId) => {
    const instances = store.get('instances', []);
    const instance = instances.find(inst => inst.name === instanceName);

    if (!instance) {
        dialog.showErrorBox('Error', `Instance '${instanceName}' not found.`);
        return false;
    }

    const modToDelete = instance.mods.find(mod => mod.id === modId);
    if (!modToDelete) {
        dialog.showErrorBox('Error', `Mod with ID '${modId}' not found in instance '${instanceName}'.`);
        return false;
    }

    const modPath = path.join(instancesDir, instanceName, 'mods', modToDelete.name);

    try {
        if (fs.existsSync(modPath)) {
            fse.removeSync(modPath); // Use fse.removeSync for recursive deletion
            console.log(`Mod directory ${modPath} deleted.`);
        }

        const updatedMods = instance.mods.filter(mod => mod.id !== modId);
        const updatedInstances = instances.map(inst => {
            if (inst.name === instanceName) {
                return { ...inst, mods: updatedMods };
            }
            return inst;
        });
        store.set('instances', updatedInstances);
        return true;
    } catch (error) {
        console.error('Failed to delete mod:', error);
        dialog.showErrorBox('Mod Deletion Failed', error.message);
        return false;
    }
});

ipcMain.handle('check-for-openstarbound-update', async () => {
    const releaseUrl = 'https://api.github.com/repos/OpenStarbound/OpenStarbound/releases';
    try {
        const response = await axios.get(releaseUrl);
        const latestRelease = response.data.find(r => !r.prerelease && !r.draft);
        if (!latestRelease) return { updateAvailable: false, latestVersion: null };

        const latestVersionTag = latestRelease.tag_name;
        const downloadedVersions = store.get('downloadedVersions', []);

        if (!downloadedVersions.includes(latestVersionTag)) {
            return { updateAvailable: true, latestVersion: latestVersionTag };
        }

        return { updateAvailable: false, latestVersion: latestVersionTag };

    } catch (error) {
        console.error('Failed to check for OpenStarbound update:', error);
        return { updateAvailable: false, latestVersion: null, error: error.message };
    }
});

