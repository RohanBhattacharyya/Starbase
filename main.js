const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
const openstarboundVersionsDir = path.join(app.getPath('userData'), 'openstarbound_versions'); // New directory for different versions
const steamcmdDir = path.join(app.getPath('userData'), 'steamcmd');
const steamcmdExecutable = path.join(steamcmdDir, 'steamcmd.sh');

if (!fs.existsSync(instancesDir)) fse.mkdirpSync(instancesDir); // Use fse.mkdirpSync for recursive creation
if (!fs.existsSync(openstarboundVersionsDir)) fse.mkdirpSync(openstarboundVersionsDir);
if (!fs.existsSync(steamcmdDir)) fse.mkdirpSync(steamcmdDir);

function createWindow () {
  const mainWindow = new BrowserWindow({
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

ipcMain.handle('create-instance', async (event, instanceName, versionTag) => {
    const instances = store.get('instances', []);
    if (instances.some(inst => inst.name === instanceName)) {
        dialog.showErrorBox('Error', 'An instance with this name already exists.');
        return null;
    }

    const instancePath = path.join(instancesDir, instanceName);
    const instanceAssetsPath = path.join(instancePath, 'assets');
    const instanceModsPath = path.join(instancePath, 'mods');
    const instanceStoragePath = path.join(instancePath, 'storage');
    const instanceClientPath = path.join(instancePath, 'client');

    const selectedVersionPath = path.join(openstarboundVersionsDir, versionTag);
    const sourceClientPath = path.join(selectedVersionPath, 'client_distribution');

    try {
        // Create instance directories
        fse.mkdirpSync(instanceAssetsPath);
        fse.mkdirpSync(instanceModsPath);
        fse.mkdirpSync(instanceStoragePath);

        // Copy client files to instance
        fse.copySync(sourceClientPath, instanceClientPath, { overwrite: true });

        // Symlink packed.pak
        const pakPath = store.get('packedPakPath');
        if (pakPath) fs.symlinkSync(pakPath, path.join(instanceAssetsPath, 'packed.pak'));
        else throw new Error('packed.pak path is not set.');

        store.set('instances', [...instances, { name: instanceName, version: versionTag, mods: [] }]);
        return instanceName;
    } catch (error) {
        console.error('Failed to create instance:', error);
        dialog.showErrorBox('Instance Creation Failed', error.message);
        if (fs.existsSync(instancePath)) fse.removeSync(instancePath); // Clean up partially created directory
        return null;
    }
});

ipcMain.handle('download-client', async () => {
    const releaseUrl = 'https://api.github.com/repos/OpenStarbound/OpenStarbound/releases';
    const tempDir = app.getPath('temp');
    const downloadPath = path.join(tempDir, 'openstarbound-release.zip');

    try {
        console.log('Fetching latest release info...');
        const response = await axios.get(releaseUrl);
        const latestRelease = response.data.find(r => !r.prerelease && !r.draft);
        if (!latestRelease) throw new Error('No stable release found.');

        const asset = latestRelease.assets.find(a => a.name.toLowerCase().includes('linux') && a.name.toLowerCase().includes('client'));
        if (!asset) throw new Error('No Linux client asset found in the latest release.');

        console.log(`Downloading ${asset.name}...`);
        const assetResponse = await axios({ url: asset.browser_download_url, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(downloadPath);
        assetResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log('Download complete. Extracting zip...');
        const versionSpecificClientDir = path.join(openstarboundVersionsDir, latestRelease.tag_name);
        fse.mkdirpSync(versionSpecificClientDir); // Create version-specific directory

        await new Promise((resolve, reject) => {
            yauzl.open(downloadPath, { lazyEntries: true }, (err, zipfile) => {
                if (err) return reject(err);
                zipfile.readEntry();
                zipfile.on('entry', (entry) => {
                    if (entry.fileName.includes('client.tar')) {
                        console.log('Found client.tar. Extracting tarball...');
                        zipfile.openReadStream(entry, (err, readStream) => {
                            if (err) return reject(err);
                            const extract = tar.extract(versionSpecificClientDir, {
                                map: (header) => {
                                    // Remove the top-level 'client_distribution' folder from paths
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
        store.set('openstarboundVersion', latestRelease.tag_name); // Store the downloaded version
        return true;

    } catch (error) {
        console.error('Failed to download and extract client:', error);
        dialog.showErrorBox('Client Download Failed', error.message);
        if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath); // Cleanup on error
        return false;
    }
});

ipcMain.handle('is-client-downloaded', async () => {
    // Check if any version is downloaded
    const versions = store.get('openstarboundVersions', []);
    return versions.length > 0;
});

ipcMain.handle('get-openstarbound-versions', async () => {
    const versions = [];
    try {
        const downloadedVersions = await fse.readdir(openstarboundVersionsDir);
        for (const versionTag of downloadedVersions) {
            const versionPath = path.join(openstarboundVersionsDir, versionTag);
            const stat = await fse.stat(versionPath);
            if (stat.isDirectory()) {
                versions.push({ tag: versionTag, path: versionPath });
            } 
        }
    } catch (error) {
        console.error('Error reading OpenStarbound versions directory:', error);
    }
    return versions;
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

ipcMain.handle('search-workshop', async (event, query) => {
    if (!fs.existsSync(steamcmdExecutable)) {
        dialog.showErrorBox('Error', 'SteamCMD executable not found. Please download SteamCMD first.');
        return [];
    }

    // Ensure steamcmd.sh is executable
    fs.chmodSync(steamcmdExecutable, '755');

    return new Promise((resolve, reject) => {
        let output = '';
        const steamcmdProcess = spawn(steamcmdExecutable, [
            '+login', 'anonymous',
            '+workshop_search', '211820', `*${query}*`,
            '+quit'
        ], {
            cwd: steamcmdDir
        });

        steamcmdProcess.stdout.on('data', (data) => {
            output += data.toString();
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
            console.log('steamcmd output:', output);
            // Basic parsing - this will need to be more robust
            const mods = [];
            const regex = /AppID: 211820\n\s+PublishedFileId: (\d+)\n\s+Title: (.+?)\n/g;
            let match;
            while ((match = regex.exec(output)) !== null) {
                mods.push({
                    id: match[1],
                    name: match[2],
                    description: 'Description not available from search',
                    imageUrl: 'https://via.placeholder.com/150' // Placeholder
                });
            }
            resolve(mods);
        });

        steamcmdProcess.on('error', (err) => {
            console.error('Failed to start steamcmd process:', err);
            reject(err);
        });
    });
});

ipcMain.handle('download-mod', async (event, modId, instanceName) => {
    if (!fs.existsSync(steamcmdExecutable)) {
        dialog.showErrorBox('Error', 'SteamCMD executable not found. Please download SteamCMD first.');
        return false;
    }

    const instancePath = path.join(instancesDir, instanceName);
    const instanceModsPath = path.join(instancePath, 'mods');
    const downloadedModPath = path.join(steamcmdDir, 'steamapps', 'workshop', 'content', '211820', modId);

    try {
        // Ensure steamcmd.sh is executable
        fs.chmodSync(steamcmdExecutable, '755');

        console.log(`Downloading mod ${modId} using steamcmd...`);
        await new Promise((resolve, reject) => {
            const steamcmdProcess = spawn(steamcmdExecutable, [
                '+login', 'anonymous',
                '+force_install_dir', steamcmdDir, // Ensure steamcmd downloads to its own directory
                '+workshop_download_item', '211820', modId,
                '+quit'
            ], {
                cwd: steamcmdDir
            });

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
            });

            steamcmdProcess.on('error', (err) => {
                console.error('Failed to start steamcmd process for download:', err);
                reject(err);
            }
        );
    });

        // Move the downloaded mod to the instance's mods folder
        if (fs.existsSync(downloadedModPath)) {
            const modContents = fs.readdirSync(downloadedModPath);
            if (modContents.length > 0) {
                // Assuming the mod is directly inside the modId folder
                const modFolderName = modContents[0]; // Get the actual mod folder name
                const sourcePath = path.join(downloadedModPath, modFolderName);
                const destinationPath = path.join(instanceModsPath, modFolderName);

                console.log(`Moving mod from ${sourcePath} to ${destinationPath}`);
                fse.moveSync(sourcePath, destinationPath, { overwrite: true }); // Use fse.moveSync
                console.log(`Mod ${modId} moved successfully.`);

                // Update instance data with the new mod
                const instances = store.get('instances', []);
                const updatedInstances = instances.map(inst => {
                    if (inst.name === instanceName) {
                        const mods = inst.mods || [];
                        if (!mods.some(m => m.id === modId)) {
                            return { ...inst, mods: [...mods, { id: modId, name: modFolderName, enabled: true }] };
                        }
                    }
                    return inst;
                });
                store.set('instances', updatedInstances);
                return true;
            } else {
                throw new Error('Downloaded mod folder is empty.');
            }
        }
        else {
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

    const starboundExecutable = path.join(instance.clientPath, 'linux', 'starbound'); // Use instance-specific client path
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

    // Set the Starbound assets path to the instance's assets folder
    env.STARBOUND_ASSET_SOURCE = instanceAssetsPath;
    env.STARBOUND_PATH = instancePath; // Set STARBOUND_PATH to the instance root

    // Add enabled mods to the command line arguments
    if (instance.mods && instance.mods.length > 0) {
        const enabledMods = instance.mods.filter(mod => mod.enabled);
        if (enabledMods.length > 0) {
            const modPaths = enabledMods.map(mod => path.join(instanceModsPath, mod.name));
            args.push(`--mods=${modPaths.join(',')}`);
        }
    }

    console.log(`Launching ${starboundExecutable} with args: ${args.join(' ')} and env: STARBOUND_ASSET_SOURCE=${env.STARBOUND_ASSET_SOURCE}, STARBOUND_PATH=${env.STARBOUND_PATH}`);

    try {
        const gameProcess = spawn(starboundExecutable, args, {
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
        const currentVersionTag = store.get('openstarboundVersion');

        if (!currentVersionTag) {
            // If no version is stored, assume it's a fresh install or old version, suggest download
            return { updateAvailable: true, latestVersion: latestVersionTag };
        }

        // Simple version comparison (e.g., v1.0.0 vs v1.0.1)
        // A more robust comparison might be needed for complex versioning schemes
        if (latestVersionTag !== currentVersionTag) {
            return { updateAvailable: true, latestVersion: latestVersionTag };
        }

        return { updateAvailable: false, latestVersion: latestVersionTag };

    } catch (error) {
        console.error('Failed to check for OpenStarbound update:', error);
        return { updateAvailable: false, latestVersion: null, error: error.message };
    }
});

let inputDialogWindow = null;

ipcMain.handle('open-input-dialog', (event, options) => {
    return new Promise((resolve) => {
        if (inputDialogWindow) {
            inputDialogWindow.focus();
            return;
        }

        inputDialogWindow = new BrowserWindow({
            width: 400,
            height: 200,
            parent: BrowserWindow.getFocusedWindow(),
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

        inputDialogWindow.on('closed', () => {
            inputDialogWindow = null;
            resolve({ value: null, canceled: true }); // Resolve with canceled if window is closed directly
        });

        ipcMain.once('dialog-response', (event, result) => {
            if (inputDialogWindow) {
                inputDialogWindow.close();
            }
            resolve(result);
        });
    });
});