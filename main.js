const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const Store = require('electron-store');
const axios = require('axios');
const yauzl = require('yauzl');
const tar = require('tar-fs');
const { spawn } = require('child_process');
const fse = require('fs-extra');

const store = new Store();

// Load embedded API key if it exists
try {
    const configPath = path.join(__dirname, 'build', 'config.json');
    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.apiKey) {
            const decodedKey = Buffer.from(config.apiKey, 'base64').toString('utf-8');
            store.set('steamApiKey', decodedKey);
            console.log('Embedded Steam API Key has been loaded.');
        }
    }
} catch (error) {
    console.error('Could not load the embedded API key:', error);
}

const instancesDir = path.join(app.getPath('userData'), 'instances');
const steamcmdDir = path.join(app.getPath('userData'), 'steamcmd');
const steamcmdExecutable = path.join(steamcmdDir, process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd.sh');

if (!fs.existsSync(instancesDir)) fse.mkdirpSync(instancesDir);
if (!fs.existsSync(steamcmdDir)) fse.mkdirpSync(steamcmdDir);

async function downloadAndExtractClient(versionTag, instancePath) {
    const releaseUrl = `https://api.github.com/repos/OpenStarbound/OpenStarbound/releases/tags/${versionTag}`;
    const tempDir = app.getPath('temp');
    const downloadPath = path.join(tempDir, `openstarbound-${versionTag}.zip`);

    try {
        console.log(`Fetching release info for ${versionTag}...`);
        const response = await axios.get(releaseUrl);
        const release = response.data;

        let asset;
        if (process.platform === 'win32') {
            asset = release.assets.find(a => a.name.toLowerCase().includes('windows') && a.name.toLowerCase().includes('client'));
            if (!asset) throw new Error(`No Windows client asset found in release ${versionTag}.`);
        } else { // linux
            asset = release.assets.find(a => a.name.toLowerCase().includes('linux') && a.name.toLowerCase().includes('client'));
            if (!asset) throw new Error(`No Linux client asset found in release ${versionTag}.`);
        }

        console.log(`Downloading ${asset.name}...`);
        const assetResponse = await axios({ url: asset.browser_download_url, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(downloadPath);
        assetResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log('Download complete. Extracting zip...');
        if (process.platform === 'win32') {
            await new Promise((resolve, reject) => {
                yauzl.open(downloadPath, { lazyEntries: true }, (err, zipfile) => {
                    if (err) return reject(err);
                    zipfile.readEntry();
                    zipfile.on('entry', (entry) => {
                        // Extract all files, but specifically look for starbound.exe to determine the base path
                        const targetPath = path.join(instancePath, entry.fileName.replace(/^OpenStarbound-Client-Windows\//, ''));
                        if (/\/$/.test(entry.fileName)) {
                            // Directory
                            fse.ensureDirSync(targetPath);
                            zipfile.readEntry();
                        } else {
                            // File
                            zipfile.openReadStream(entry, (err, readStream) => {
                                if (err) return reject(err);
                                fse.ensureDirSync(path.dirname(targetPath)); // Ensure directory exists
                                const writeStream = fs.createWriteStream(targetPath);
                                readStream.pipe(writeStream);
                                writeStream.on('finish', () => zipfile.readEntry());
                                writeStream.on('error', reject);
                            });
                        }
                    });
                    zipfile.on('end', () => {
                        console.log('Windows client extraction complete.');
                        resolve();
                    });
                    zipfile.on('error', reject);
                });
            });
        } else { // Linux extraction
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
                                    console.log('Linux client extraction complete.');
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
        }

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

async function ensureSteamCMD() {
    if (fs.existsSync(steamcmdExecutable)) {
        console.log('SteamCMD is already installed.');
        return true;
    }

    console.log('SteamCMD not found. Starting download...');
    dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'SteamCMD Setup',
        message: 'SteamCMD is required for workshop features. It will be downloaded now. This may take a few moments.',
        buttons: ['OK']
    });

    const platform = process.platform;
    let steamcmdUrl, archiveName;

    if (platform === 'win32') {
        steamcmdUrl = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
        archiveName = 'steamcmd.zip';
    } else if (platform === 'darwin') {
        steamcmdUrl = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz';
        archiveName = 'steamcmd_osx.tar.gz';
    } else { // linux
        steamcmdUrl = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz';
        archiveName = 'steamcmd_linux.tar.gz';
    }

    const tempDir = app.getPath('temp');
    const downloadPath = path.join(tempDir, archiveName);

    try {
        console.log(`Downloading steamcmd from ${steamcmdUrl}...`);
        const response = await axios({ url: steamcmdUrl, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(downloadPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log('Download complete. Extracting steamcmd...');
        if (archiveName.endsWith('.zip')) {
            // Windows extraction
            await new Promise((resolve, reject) => {
                yauzl.open(downloadPath, { lazyEntries: true }, (err, zipfile) => {
                    if (err) return reject(err);
                    zipfile.readEntry();
                    zipfile.on('entry', (entry) => {
                        zipfile.openReadStream(entry, (err, readStream) => {
                            if (err) return reject(err);
                            const filePath = path.join(steamcmdDir, entry.fileName);
                            fse.ensureDirSync(path.dirname(filePath));
                            const writeStream = fs.createWriteStream(filePath);
                            readStream.pipe(writeStream);
                            writeStream.on('finish', () => zipfile.readEntry());
                        });
                    });
                    zipfile.on('end', resolve);
                });
            });
        } else { // .tar.gz for Linux/macOS
            await new Promise((resolve, reject) => {
                fs.createReadStream(downloadPath)
                    .pipe(zlib.createGunzip())
                    .pipe(tar.extract(steamcmdDir))
                    .on('finish', resolve)
                    .on('error', reject);
            });
        }

        fs.unlinkSync(downloadPath);
        fs.chmodSync(steamcmdExecutable, '755');
        store.set('steamcmdDownloaded', true);
        console.log('SteamCMD setup complete.');
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Setup Complete',
            message: 'SteamCMD has been successfully installed.',
            buttons: ['OK']
        });
        return true;

    } catch (error) {
        console.error('Failed to download and extract steamcmd:', error);
        dialog.showErrorBox('SteamCMD Download Failed', error.message);
        if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath);
        return false;
    }
}

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
    mainWindow.loadFile(path.join(__dirname, 'setup.html'));
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }
}

app.whenReady().then(() => {
    createWindow();
    mainWindow.webContents.on('did-finish-load', () => {
        if (mainWindow.webContents.getURL().includes('setup.html')) return;
        ensureSteamCMD();
    });
});

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

    const instancePath = path.join(instancesDir, instanceName);

    try {
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
        if (fs.existsSync(instancePath)) fse.removeSync(instancePath);
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

ipcMain.handle('open-workshop-window', (event, instanceName) => {
    const instances = store.get('instances', []);
    const instance = instances.find(inst => inst.name === instanceName);
    const installedMods = instance ? instance.mods : [];

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
        workshopWindow.webContents.send('set-installed-mods', installedMods);
    });
});

ipcMain.handle('open-external-link', (event, url) => {
    shell.openExternal(url);
});

let inputDialogWindow = null;

ipcMain.handle('open-input-dialog', (event, options) => {
    return showInputDialog(options);
});

function showInputDialog(options) {
    return new Promise((resolve) => {
        if (inputDialogWindow) {
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

        inputDialogWindow.loadFile(path.join(__dirname, 'inputDialog.html'));

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

function getSteamWorkshopDirectory() {
    const homeDir = app.getPath('home');
    switch (process.platform) {
        case 'win32':
            // Default Steam install location on Windows
            const winPath = 'C:\\Program Files (x86)\\Steam\\steamapps\\workshop';
            if (fs.existsSync(winPath)) {
                return winPath;
            }
            // Fallback to the managed steamcmd directory
            return path.join(steamcmdDir, 'steamapps', 'workshop');

        case 'darwin':
            // Default Steam install location on macOS
            const macPath = path.join(homeDir, 'Library', 'Application Support', 'Steam', 'steamapps', 'workshop');
             if (fs.existsSync(macPath)) {
                return macPath;
            }
            // Fallback to the managed steamcmd directory
            return path.join(steamcmdDir, 'steamapps', 'workshop');

        case 'linux':
        default:
            // Common Steam install locations on Linux
            const path1 = path.join(homeDir, '.steam', 'steam', 'steamapps', 'workshop');
            const path2 = path.join(homeDir, '.local', 'share', 'Steam', 'steamapps', 'workshop');
            const path3 = path.join(homeDir, '.steam', 'SteamApps', 'workshop'); // Older path

            if (fs.existsSync(path3)) return path3;
            if (fs.existsSync(path1)) return path1;
            if (fs.existsSync(path2)) return path2;
            
            // Fallback to the managed steamcmd directory
            return path.join(steamcmdDir, 'steamapps', 'workshop');
    }
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
        searchUrl = `https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/`;
    } else {
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
        dialog.showErrorBox('Error', 'SteamCMD executable not found. Please ensure it was installed correctly.');
        return false;
    }

    const instancePath = path.join(instancesDir, instanceName);
    const instanceModsPath = path.join(instancePath, 'mods');
    
    const workshopDir = getSteamWorkshopDirectory();
    const downloadedModPath = path.join(workshopDir, 'content', '211820', modId);
    const fallbackModPath = path.join(steamcmdDir, 'steamapps', 'workshop', 'content', '211820', modId);

    try {
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
                }
                console.log(`steamcmd process finished. Checking for downloaded files.`);
                resolve();
            });
        });

        let finalModPath;
        console.log(`Checking for mod at primary path: ${downloadedModPath}`);
        if (fs.existsSync(downloadedModPath)) {
            finalModPath = downloadedModPath;
        } else {
            console.log(`Mod not found at primary path. Checking fallback: ${fallbackModPath}`);
            if (fs.existsSync(fallbackModPath)) {
                finalModPath = fallbackModPath;
            }
        }

        if (finalModPath) {
            console.log(`Found mod at: ${finalModPath}`);
            const destinationPath = path.join(instanceModsPath, `${modName}.pak`);
            const sourcePak = path.join(finalModPath, 'contents.pak');

            if (!fs.existsSync(sourcePak)) {
                 throw new Error(`'contents.pak' not found in the downloaded mod folder: ${finalModPath}`);
            }

            fse.moveSync(sourcePak, destinationPath, { overwrite: true });
            console.log(`Moved ${sourcePak} to ${destinationPath}`);

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

            mainWindow.webContents.send('instance-updated');
            
            fse.remove(finalModPath).catch(err => console.error(`Failed to clean up mod directory: ${err}`));

            return true;
        } else {
            throw new Error(`Downloaded mod not found at expected paths.`);
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
                    const instanceModsPath = path.join(instancesDir, instanceName, 'mods');
                    
                    const baseModName = mod.name.replace('.disabled', '');
                    
                    const currentFileName = enabled ? `${baseModName}.pak.disabled` : `${baseModName}.pak`;
                    const oldModPath = path.join(instanceModsPath, currentFileName);

                    const targetFileName = enabled ? `${baseModName}.pak` : `${baseModName}.pak.disabled`;
                    const newModPath = path.join(instanceModsPath, targetFileName);

                    try {
                        if (fs.existsSync(oldModPath) && oldModPath !== newModPath) {
                            fs.renameSync(oldModPath, newModPath);
                            console.log(`Renamed mod from ${oldModPath} to ${newModPath}`);
                        }
                    } catch (error) {
                        console.error(`Failed to rename mod file: ${error.message}`);
                        dialog.showErrorBox('Mod Status Update Failed', `Could not rename mod file: ${error.message}`);
                        return mod;
                    }

                    return { ...mod, name: baseModName, enabled: enabled };
                }
                return mod;
            });
            return { ...inst, mods: updatedMods };
        }
        return inst;
    });
    store.set('instances', updatedInstances);
    mainWindow.webContents.send('instance-updated');
    return true;
});

ipcMain.handle('launch-game', async (event, instanceName) => {
    const instances = store.get('instances', []);
    const instance = instances.find(inst => inst.name === instanceName);

    if (!instance) {
        dialog.showErrorBox('Error', `Instance '${instanceName}' not found.`);
        return false;
    }

    let starboundExecutable;
    if (process.platform === 'win32') {
        starboundExecutable = path.join(instance.clientPath, 'win', 'starbound.exe');
    } else { // linux
        starboundExecutable = path.join(instance.clientPath, 'linux', 'starbound');
    }
    if (!fs.existsSync(starboundExecutable)) {
        dialog.showErrorBox('Error', 'OpenStarbound executable not found. Please ensure the client is downloaded for this instance.');
        return false;
    }

    fs.chmodSync(starboundExecutable, '755');

    console.log(`Launching ${starboundExecutable}`);

    try {
        const gameProcess = spawn(starboundExecutable, [], {
            cwd: instance.clientPath,
            detached: true,
            stdio: 'ignore'
        });

        gameProcess.unref();

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
            fse.removeSync(instancePath);
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

ipcMain.handle('open-folder-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (canceled || filePaths.length === 0) return null;
    return { canceled, filePaths };
});

ipcMain.handle('import-mods', async (event, instanceName, folderPath) => {
    const instances = store.get('instances', []);
    const instance = instances.find(inst => inst.name === instanceName);
    if (!instance) {
        dialog.showErrorBox('Error', `Instance '${instanceName}' not found.`);
        return false;
    }

    const instanceModsPath = path.join(instancesDir, instanceName, 'mods');
    const files = fs.readdirSync(folderPath);

    for (const file of files) {
        if (path.extname(file) === '.pak') {
            const sourcePath = path.join(folderPath, file);
            const destPath = path.join(instanceModsPath, file);
            fs.copyFileSync(sourcePath, destPath);

            let modId = 'ID unknown';
            try {
                const buffer = fs.readFileSync(sourcePath);
                const urlMatch = buffer.toString('utf8').match(/steam:\/\/url\/CommunityFilePage\/(\d+)/);
                if (urlMatch && urlMatch[1]) {
                    modId = urlMatch[1];
                }
            } catch (error) {
                console.error(`Error reading ${file}:`, error);
            }

            const modName = path.basename(file, '.pak');
            if (!instance.mods.some(m => m.id === modId)) {
                instance.mods.push({ id: modId, name: modName, enabled: true, imported: true });
            }
        }
    }

    store.set('instances', instances);
    mainWindow.webContents.send('instance-updated');
    return true;
});

ipcMain.handle('delete-mod', async (event, instanceName, modId) => {
    // ... existing delete-mod logic ...
});

ipcMain.handle('open-instance-folder', async (event, instanceName) => {
    const instances = store.get('instances', []);
    const instance = instances.find(inst => inst.name === instanceName);

    if (!instance) {
        dialog.showErrorBox('Error', `Instance '${instanceName}' not found.`);
        return false;
    }

    const instancePath = path.join(instancesDir, instanceName);

    try {
        await shell.openPath(instancePath);
        return true;
    } catch (error) {
        console.error('Failed to open instance folder:', error);
        dialog.showErrorBox('Error', `Could not open folder for instance '${instanceName}'.`);
        return false;
    }
});

ipcMain.handle('check-for-openstarbound-update', async () => {
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
            fse.removeSync(modPath);
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