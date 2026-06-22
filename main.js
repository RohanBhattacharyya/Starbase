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

let activeDownloads = 0;
let allowQuitWithDownloads = false;
const downloadQueue = [];
const failedDownloads = [];
const retryQueue = [];
const downloadJobs = new Map();
const MAX_RETRIES = 5;

const SHOW_MENUBAR = false;

function getDownloadJobKey(instanceName, modId) {
    return `${instanceName}:${modId}`;
}

function getDownloadState(instanceName = null) {
    const jobs = Array.from(downloadJobs.values())
        .filter(job => !instanceName || job.instanceName === instanceName)
        .map(job => ({ ...job }));
    const pending = jobs.filter(job => ['queued', 'downloading', 'retrying'].includes(job.status));
    return {
        jobs,
        active: jobs.filter(job => job.status === 'downloading').length,
        pending: pending.length,
        completed: jobs.filter(job => job.status === 'completed').length,
        failed: jobs.filter(job => job.status === 'failed').length,
        total: jobs.length
    };
}

function sendToWindow(window, channel, payload) {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(channel, payload);
    }
}

function getWorkshopWindows(instanceName = null) {
    return BrowserWindow.getAllWindows().filter(win =>
        win.workshopInstanceName && (!instanceName || win.workshopInstanceName === instanceName)
    );
}

// Downloads live in the main process. Any renderer can disappear and reconnect
// without affecting the queue.
function updateDownloadStatus() {
    const state = getDownloadState();
    sendToWindow(mainWindow, 'download-status-update', state);
    getWorkshopWindows()
        .forEach(win => {
            sendToWindow(win, 'download-status-update', state);
            sendToWindow(win, 'download-state-update', state);
        });
}

function queueMods(mods, instanceName, batchId = null) {
    const instances = store.get('instances', []);
    const instance = instances.find(item => item.name === instanceName);
    if (!instance) throw new Error(`Instance '${instanceName}' was not found.`);

    const installedIds = new Set((instance.mods || []).map(mod => String(mod.id)));
    let added = 0;
    for (const mod of mods) {
        const rawModId = mod.id || mod.modId;
        if (!rawModId) continue;
        const modId = String(rawModId);
        const modName = mod.name || mod.modName || `Workshop item ${modId}`;
        const key = getDownloadJobKey(instanceName, modId);
        const existing = downloadJobs.get(key);
        if (installedIds.has(modId) || (existing && ['queued', 'downloading', 'retrying'].includes(existing.status))) {
            continue;
        }
        downloadJobs.set(key, { modId, modName, instanceName, status: 'queued', attempts: 0, error: null });
        downloadQueue.push({ modId, modName, instanceName, attempts: 0, batchId });
        added++;
    }
    updateDownloadStatus();
    processDownloadQueue();
    return added;
}

async function ensureSteamCmdReady() {
    if (!fs.existsSync(steamcmdExecutable)) {
        const installed = await ensureSteamCMD();
        if (!installed || !fs.existsSync(steamcmdExecutable)) {
            throw new Error('SteamCMD could not be installed. Check your network connection and try again.');
        }
    }
    fs.chmodSync(steamcmdExecutable, '755');
}

async function runSteamCmdDownloads(mods) {
    await ensureSteamCmdReady();
    const args = [
        '+force_install_dir', steamcmdDir,
        '+login', 'anonymous'
    ];
    mods.forEach(mod => args.push('+workshop_download_item', '211820', mod.modId));
    args.push('+quit');

    console.log(`Downloading ${mods.length} mod${mods.length === 1 ? '' : 's'} in one SteamCMD session...`);
    await new Promise((resolve, reject) => {
        const steamcmdProcess = spawn(steamcmdExecutable, args);
        steamcmdProcess.stdout.on('data', data => console.log(`steamcmd: ${data}`));
        steamcmdProcess.stderr.on('data', data => console.error(`steamcmd stderr: ${data}`));
        steamcmdProcess.on('close', code => {
            if (code !== 0) {
                return reject(new Error(`SteamCMD exited with code ${code}. Check SteamCMD logs for details.`));
            }
            console.log('SteamCMD session finished. Checking downloaded files.');
            resolve();
        });
        steamcmdProcess.on('error', err => reject(new Error(`Failed to start SteamCMD: ${err.message}`)));
    });
}

// Refactored mod download logic
async function performModDownload(modId, modName, instanceName, { skipDownload = false } = {}) {

    const instancePath = path.join(instancesDir, instanceName);
    const instanceModsPath = path.join(instancePath, 'mods');
    
    const workshopDir = getSteamWorkshopDirectory();
    const downloadedModPath = path.join(workshopDir, 'content', '211820', modId);
    const fallbackModPath = path.join(steamcmdDir, 'steamapps', 'workshop', 'content', '211820', modId);

    try {
        if (!skipDownload) {
            await runSteamCmdDownloads([{ modId, modName, instanceName }]);
        }

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

        if (!finalModPath) {
            throw new Error(`Downloaded mod files not found for ${modName} (${modId}) at expected paths.`);
        }

        console.log(`Found mod directory at: ${finalModPath}`);

        // --- NEW LOGIC: Search for .pak files ---
        let pakFile = null;
        const filesInDownloadedDir = fs.readdirSync(finalModPath);
        for (const file of filesInDownloadedDir) {
            if (file.endsWith('.pak')) {
                pakFile = path.join(finalModPath, file);
                break; // Found a .pak file, take the first one
            }
        }

        if (!pakFile) {
            // If no .pak file found in the root, check one level deeper (common for some mods)
            for (const file of filesInDownloadedDir) {
                const subDirPath = path.join(finalModPath, file);
                if (fs.statSync(subDirPath).isDirectory()) {
                    const filesInSubDir = fs.readdirSync(subDirPath);
                    for (const subFile of filesInSubDir) {
                        if (subFile.endsWith('.pak')) {
                            pakFile = path.join(subDirPath, subFile);
                            break;
                        }
                    }
                }
                if (pakFile) break;
            }
        }

        if (!pakFile) {
            throw new Error(`No .pak file found in the downloaded mod folder for ${modName} (${modId}): ${finalModPath}. This mod might have a different structure or failed to download correctly.`);
        }
        // --- END NEW LOGIC ---

        fse.mkdirpSync(instanceModsPath);
        const safeFileName = `${modId}.pak`;
        const destinationPath = path.join(instanceModsPath, safeFileName);
        
        fse.moveSync(pakFile, destinationPath, { overwrite: true });
        console.log(`Moved ${pakFile} to ${destinationPath}`);

        // Update the store with the new mod
        const instances = store.get('instances', []);
        const updatedInstances = instances.map(inst => {
            if (inst.name === instanceName) {
                const mods = inst.mods || [];
                if (!mods.some(m => String(m.id) === String(modId))) {
                    return { ...inst, mods: [...mods, { id: modId, name: modName, fileName: String(modId), enabled: true }] };
                }
            }
            return inst;
        });
        store.set('instances', updatedInstances);

        // Send updated installed mods to the workshop window
        const currentInstance = updatedInstances.find(inst => inst.name === instanceName);
        if (currentInstance) {
            getWorkshopWindows(instanceName).forEach(win => sendToWindow(win, 'set-installed-mods', currentInstance.mods));
        }
        
        fse.remove(finalModPath).catch(err => console.error(`Failed to clean up mod directory: ${err}`));

        return true;

    } catch (error) {
        console.error('Failed to download or move mod:', error);
        throw error; // Re-throw to be caught by processDownloadQueue
    }
}

// Process the download queue with a concurrency limit
// SteamCMD writes shared manifests and workshop folders. Running multiple copies
// against the same install directory causes intermittent collection failures.
const MAX_CONCURRENT_DOWNLOADS = 1;
const STEAMCMD_BATCH_SIZE = 20;

async function performDownloadGroup(mods) {
    if (mods.length === 1) {
        return Promise.allSettled([
            performModDownload(mods[0].modId, mods[0].modName, mods[0].instanceName)
        ]);
    }

    let commandError = null;
    try {
        await runSteamCmdDownloads(mods);
    } catch (error) {
        // SteamCMD can return a non-zero code after downloading only part of a
        // batch. Inspect every item so completed downloads are still kept.
        commandError = error;
        console.error('SteamCMD batch reported an error; checking individual items:', error);
    }

    return Promise.allSettled(mods.map(async mod => {
        try {
            return await performModDownload(mod.modId, mod.modName, mod.instanceName, { skipDownload: true });
        } catch (error) {
            throw commandError || error;
        }
    }));
}

async function processDownloadQueue() {
    while ((downloadQueue.length > 0 || retryQueue.length > 0) && activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
        const sourceQueue = downloadQueue.length > 0 ? downloadQueue : retryQueue;
        const firstMod = sourceQueue.shift();
        const modsToDownload = [firstMod];
        if (firstMod.batchId) {
            while (
                modsToDownload.length < STEAMCMD_BATCH_SIZE &&
                sourceQueue[0]?.batchId === firstMod.batchId
            ) {
                modsToDownload.push(sourceQueue.shift());
            }
        }

        modsToDownload.forEach(({ modId, instanceName, attempts }) => {
            const job = downloadJobs.get(getDownloadJobKey(instanceName, modId));
            if (job) {
                job.status = 'downloading';
                job.attempts = attempts + 1;
                job.error = null;
            }
        });

        activeDownloads++;
        updateDownloadStatus();
        console.log(`Starting SteamCMD group of ${modsToDownload.length} mod(s).`);

        performDownloadGroup(modsToDownload)
            .then(results => {
                results.forEach((result, index) => {
                    const mod = modsToDownload[index];
                    const { modId, modName, instanceName, attempts, batchId } = mod;
                    const job = downloadJobs.get(getDownloadJobKey(instanceName, modId));
                    if (result.status === 'fulfilled') {
                        console.log(`Successfully downloaded ${modName}`);
                        if (job) job.status = 'completed';
                    } else if (attempts < MAX_RETRIES) {
                        const error = result.reason;
                        console.error(`Error during download of ${modName}:`, error);
                        retryQueue.push({ modId, modName, instanceName, attempts: attempts + 1, batchId });
                        if (job) {
                            job.status = 'retrying';
                            job.error = error.message;
                        }
                    } else {
                        const error = result.reason;
                        failedDownloads.push({ modId, modName, instanceName, error: error.message });
                        if (job) {
                            job.status = 'failed';
                            job.error = error.message;
                        }
                    }
                });
            })
            .catch(error => {
                console.error('Unexpected download group failure:', error);
                modsToDownload.forEach(mod => {
                    const job = downloadJobs.get(getDownloadJobKey(mod.instanceName, mod.modId));
                    if (mod.attempts < MAX_RETRIES) {
                        retryQueue.push({ ...mod, attempts: mod.attempts + 1 });
                        if (job) {
                            job.status = 'retrying';
                            job.error = error.message;
                        }
                    } else {
                        failedDownloads.push({ ...mod, error: error.message });
                        if (job) {
                            job.status = 'failed';
                            job.error = error.message;
                        }
                    }
                });
            })
            .finally(() => {
                activeDownloads--;
                updateDownloadStatus();
                // Trigger main window UI update after each mod download completes
                sendToWindow(mainWindow, 'instance-updated');
                processDownloadQueue(); // Try to process next item in queue
            });
    }
    if (downloadQueue.length === 0 && retryQueue.length === 0 && activeDownloads === 0) {
        updateDownloadStatus(); // Send final status

        if (failedDownloads.length > 0) {
            const failedModNames = failedDownloads.map(mod => mod.modName).join(', ');
            dialog.showErrorBox(
                'Mod Download Failed',
                `The following mods failed to download after ${MAX_RETRIES} attempts: ${failedModNames}. Please check the console for more details.`
            );
            failedDownloads.length = 0; // Clear failed downloads after reporting
        }
    }
}

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

async function downloadAndExtractClient(versionTag, instancePath, reportProgress = () => {}) {
    const releaseUrl = `https://api.github.com/repos/OpenStarbound/OpenStarbound/releases/tags/${versionTag}`;
    const tempDir = app.getPath('temp');
    const downloadPath = path.join(tempDir, `openstarbound-${versionTag}.zip`);

    try {
        console.log(`Fetching release info for ${versionTag}...`);
        reportProgress({ phase: 'release', message: 'Finding the correct game build…', percent: 0, indeterminate: true });
        const response = await axios.get(releaseUrl);
        const release = response.data;

        let asset;
        if (process.platform === 'win32') {
            asset = release.assets.find(a => a.name.toLowerCase().includes('windows') && a.name.toLowerCase().includes('client'));
            if (!asset) throw new Error(`No Windows client asset found in release ${versionTag}.`);
        } else if (process.platform === 'darwin') {
            const arch = process.arch; // 'arm64' for Apple Silicon, 'x64' for Intel
            asset = release.assets.find(a =>
                a.name.toLowerCase().includes('macos') &&
                a.name.toLowerCase().includes('client') &&
                a.name.toLowerCase().includes(arch === 'arm64' ? 'silicon' : 'intel')
            );
            if (!asset) throw new Error(`No macOS client asset found for ${arch} in release ${versionTag}.`);
        }
        else { // linux
            asset = release.assets.find(a => a.name.toLowerCase().includes('linux') && a.name.toLowerCase().includes('client'));
            if (!asset) throw new Error(`No Linux client asset found in release ${versionTag}.`);
        }

        console.log(`Downloading ${asset.name}...`);
        reportProgress({ phase: 'download', message: `Starting ${asset.name}…`, percent: 0, bytes: 0, totalBytes: Number(asset.size) || 0 });
        const assetResponse = await axios({ url: asset.browser_download_url, method: 'GET', responseType: 'stream' });
        const totalBytes = Number(assetResponse.headers['content-length']) || Number(asset.size) || 0;
        let downloadedBytes = 0;
        let lastReportedPercent = -1;
        let lastReportTime = 0;
        assetResponse.data.on('data', chunk => {
            downloadedBytes += chunk.length;
            const percent = totalBytes ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null;
            const now = Date.now();
            if (percent !== lastReportedPercent || now - lastReportTime >= 250) {
                lastReportedPercent = percent;
                lastReportTime = now;
                reportProgress({
                    phase: 'download',
                    message: `Downloading ${asset.name}`,
                    percent,
                    bytes: downloadedBytes,
                    totalBytes,
                    indeterminate: !totalBytes
                });
            }
        });
        const writer = fs.createWriteStream(downloadPath);
        assetResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
            assetResponse.data.on('error', reject);
        });

        console.log('Download complete. Extracting zip...');
        reportProgress({ phase: 'extract', message: 'Download complete. Extracting game files…', percent: 100, indeterminate: true });
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
        } else if (process.platform === 'darwin') { // macOS extraction
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
                                    console.log('macOS client extraction complete.');
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
        reportProgress({ phase: 'configure', message: 'Game files extracted. Finishing setup…', percent: 100, indeterminate: false });
        return instancePath;

    } catch (error) {
        console.error('Failed to download and extract client:', error);
        reportProgress({ phase: 'error', message: error.message, percent: 0, indeterminate: false });
        dialog.showErrorBox('Client Download Failed', error.message);
        if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath); // Cleanup on error
        return null;
    }
}

let mainWindow;
let steamcmdSetupPromise = null;

async function installSteamCMD() {
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

function ensureSteamCMD() {
    if (fs.existsSync(steamcmdExecutable)) return Promise.resolve(true);
    if (!steamcmdSetupPromise) {
        steamcmdSetupPromise = installSteamCMD().finally(() => {
            steamcmdSetupPromise = null;
        });
    }
    return steamcmdSetupPromise;
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

  mainWindow.setMenuBarVisibility(SHOW_MENUBAR);

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
app.on('before-quit', event => {
    const pendingDownloads = getDownloadState().pending;
    if (allowQuitWithDownloads || pendingDownloads === 0) return;

    event.preventDefault();
    const parentWindow = BrowserWindow.getFocusedWindow() || mainWindow;
    const options = {
        type: 'warning',
        title: 'Mods are still downloading',
        message: `${pendingDownloads} mod${pendingDownloads === 1 ? ' is' : 's are'} still queued or downloading.`,
        detail: 'Closing Starbase now will stop these downloads. Keep the application open until the queue finishes.',
        buttons: ['Keep Downloading', 'Quit Anyway'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
    };
    const response = parentWindow && !parentWindow.isDestroyed()
        ? dialog.showMessageBoxSync(parentWindow, options)
        : dialog.showMessageBoxSync(options);

    if (response === 1) {
        allowQuitWithDownloads = true;
        app.quit();
    } else if (BrowserWindow.getAllWindows().length === 0) {
        setImmediate(createWindow);
    }
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

ipcMain.handle('create-instance', async (event, { value: instanceName, description: instanceDescription, version, icon }) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    const reportProgress = progress => sendToWindow(sourceWindow, 'client-download-progress', {
        instanceName,
        ...progress
    });
    const instances = store.get('instances', []);
    if (instances.some(inst => inst.name === instanceName)) {
        dialog.showErrorBox('Error', 'An instance with this name already exists.');
        reportProgress({ phase: 'error', message: 'An instance with this name already exists.', percent: 0, indeterminate: false });
        return null;
    }

    const instancePath = path.join(instancesDir, instanceName);

    try {
        const clientPath = await downloadAndExtractClient(version.tag, instancePath, reportProgress);
        if (!clientPath) {
            if (fs.existsSync(instancePath)) fse.removeSync(instancePath);
            return null;
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

        store.set('instances', [...instances, { name: instanceName, description: instanceDescription, version: version.tag, icon: icon || 'fa-rocket', mods: [], clientPath: instancePath }]);
        reportProgress({ phase: 'complete', message: `${instanceName} is ready to play.`, percent: 100, indeterminate: false });
        return instanceName;
    } catch (error) {
        console.error('Failed to create instance:', error);
        reportProgress({ phase: 'error', message: error.message, percent: 0, indeterminate: false });
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
    const existingWindow = getWorkshopWindows(instanceName)[0];
    if (existingWindow) {
        if (existingWindow.isMinimized()) existingWindow.restore();
        existingWindow.focus();
        return true;
    }
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
    workshopWindow.workshopInstanceName = instanceName;

    workshopWindow.setMenuBarVisibility(SHOW_MENUBAR);

    workshopWindow.loadFile('workshop.html');
    workshopWindow.webContents.on('did-finish-load', () => {
        sendToWindow(workshopWindow, 'set-instance-name', instanceName);
        sendToWindow(workshopWindow, 'set-installed-mods', installedMods);
        sendToWindow(workshopWindow, 'download-state-update', getDownloadState(instanceName));
    });
    return true;
});

ipcMain.handle('open-external-link', (event, url) => {
    shell.openExternal(url);
});

let inputDialogWindow = null;

ipcMain.handle('open-input-dialog', (event, options) => {
    return showInputDialog(options);
});

let iconPickerDialogWindow = null;

ipcMain.handle('open-icon-picker-dialog', (event, currentIcon) => {
    return new Promise((resolve) => {
        if (iconPickerDialogWindow) {
            iconPickerDialogWindow.focus();
            return;
        }

        const parentWindow = BrowserWindow.getFocusedWindow();
        if (!parentWindow) {
            console.error("main.js: Cannot open icon picker dialog, no focused window.");
            return resolve(null);
        }

        iconPickerDialogWindow = new BrowserWindow({
            width: 600,
            height: 700,
            parent: parentWindow,
            modal: true,
            show: false,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false
            }
        });
        iconPickerDialogWindow.setMenuBarVisibility(SHOW_MENUBAR);

        iconPickerDialogWindow.loadFile(path.join(__dirname, 'iconPicker.html'));

        iconPickerDialogWindow.once('ready-to-show', () => {
            iconPickerDialogWindow.show();
            // Optionally send currentIcon to pre-select it in the picker
            // iconPickerDialogWindow.webContents.send('set-current-icon', currentIcon);
        });

        const onIconSelected = (event, iconClass) => {
            if (iconPickerDialogWindow) {
                iconPickerDialogWindow.close();
            }
            resolve(iconClass);
        };

        ipcMain.once('icon-selected', onIconSelected);

        iconPickerDialogWindow.on('closed', () => {
            iconPickerDialogWindow = null;
            ipcMain.removeListener('icon-selected', onIconSelected);
            resolve(null); // Resolve with null if dialog is closed without selection
        });
    });
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
            width: 500,
            height: 400,
            parent: parentWindow,
            modal: true,
            show: false,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false
            }
        });

        inputDialogWindow.setMenuBarVisibility(SHOW_MENUBAR);

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

async function getSteamApiKey() {
    let apiKey = store.get('steamApiKey');
    if (!apiKey) {
        const result = await showInputDialog({
            title: 'Steam Web API Key',
            message: 'Please enter your Steam Web API key to browse the workshop. You can get one from https://steamcommunity.com/dev/apikey',
            placeholder: 'Your API Key'
        });

        if (result.canceled || !result.value) {
            return null;
        }
        apiKey = result.value.trim();
        store.set('steamApiKey', apiKey);
    }
    return apiKey;
}

function mapWorkshopItem(item, kind = 'mod') {
    return {
        id: String(item.publishedfileid),
        name: item.title || `Workshop item ${item.publishedfileid}`,
        imageUrl: item.preview_url || '',
        description: item.short_description || item.file_description || '',
        itemCount: Number(item.num_children || item.children?.length || 0),
        kind,
        url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.publishedfileid}`
    };
}

async function fetchPublishedFileDetails(ids) {
    if (!ids.length) return [];
    const results = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
        const chunk = ids.slice(offset, offset + 100);
        const params = new URLSearchParams();
        params.append('itemcount', chunk.length);
        chunk.forEach((id, index) => params.append(`publishedfileids[${index}]`, id));
        const response = await axios.post(
            'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
            params
        );
        results.push(...(response.data.response.publishedfiledetails || []));
    }
    return results.filter(item => Number(item.result) === 1);
}

async function fetchCollectionChildIds(collectionId, visited = new Set()) {
    const id = String(collectionId);
    if (visited.has(id)) return [];
    visited.add(id);

    const params = new URLSearchParams();
    params.append('collectioncount', 1);
    params.append('publishedfileids[0]', id);
    const response = await axios.post(
        'https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/',
        params
    );
    const collection = response.data.response.collectiondetails?.[0];
    if (!collection || Number(collection.result) !== 1) {
        throw new Error(`Steam collection ${id} was not found or is not public.`);
    }

    const childIds = [];
    for (const child of collection.children || []) {
        if (Number(child.filetype) === 2) {
            childIds.push(...await fetchCollectionChildIds(child.publishedfileid, visited));
        } else {
            childIds.push(String(child.publishedfileid));
        }
    }
    return [...new Set(childIds)];
}

async function fetchCollection(collectionId) {
    const [metadata] = await fetchPublishedFileDetails([String(collectionId)]);
    const childIds = await fetchCollectionChildIds(collectionId);
    const details = await fetchPublishedFileDetails(childIds);
    const byId = new Map(details.map(item => [String(item.publishedfileid), item]));
    const items = childIds
        .map(id => byId.get(id))
        .filter(Boolean)
        .filter(item => !item.consumer_app_id || Number(item.consumer_app_id) === 211820)
        .map(item => mapWorkshopItem(item, 'mod'));
    return {
        collection: metadata ? mapWorkshopItem(metadata, 'collection') : {
            id: String(collectionId),
            name: `Collection ${collectionId}`,
            imageUrl: '',
            description: '',
            kind: 'collection',
            url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${collectionId}`
        },
        items
    };
}

async function queryWorkshop({ query = '', page = 1, kind = 'mod' }) {
    const apiKey = await getSteamApiKey();
    if (!apiKey) return [];
    const response = await axios.get('https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/', {
        params: {
            key: apiKey,
            appid: 211820,
            query_type: 0,
            search_text: query || undefined,
            filetype: kind === 'collection' ? 1 : 0,
            numperpage: 20,
            page,
            return_metadata: true,
            return_children: kind === 'collection'
        }
    });
    return (response.data.response.publishedfiledetails || []).map(item => mapWorkshopItem(item, kind));
}

ipcMain.handle('search-workshop', async (event, query, page = 1, kind = 'mod') => {
    const isNumericId = /^\d+$/.test(query);

    try {
        if (isNumericId) {
            if (kind === 'collection') {
                const result = await fetchCollection(query);
                return [result.collection];
            }
            const details = await fetchPublishedFileDetails([query]);
            return details.map(item => mapWorkshopItem(item, 'mod'));
        }
        return await queryWorkshop({ query, page, kind });
    } catch (error) {
        console.error('Failed to search workshop:', error);
        throw new Error(`Workshop search failed: ${error.message}`);
    }
});

ipcMain.handle('get-popular-mods', async (event, page = 1, kind = 'mod') => {
    try {
        return await queryWorkshop({ page, kind });
    } catch (error) {
        console.error('Failed to get popular workshop content:', error);
        throw new Error(`Workshop browsing failed: ${error.message}`);
    }
});

ipcMain.handle('get-collection', async (event, collectionId) => fetchCollection(collectionId));

ipcMain.handle('download-mod', async (event, { modId, modName, instanceName }) => {
    return { added: queueMods([{ id: modId, name: modName }], instanceName) };
});

ipcMain.handle('download-mods', async (event, modsToDownload, instanceName) => {
    return { added: queueMods(modsToDownload, instanceName) };
});

ipcMain.handle('download-collection', async (event, collectionId, instanceName) => {
    const result = await fetchCollection(collectionId);
    const batchId = `collection:${collectionId}:${Date.now()}`;
    return { added: queueMods(result.items, instanceName, batchId), total: result.items.length };
});

ipcMain.handle('get-download-state', (event, instanceName) => getDownloadState(instanceName));

ipcMain.handle('update-mod-status', (event, instanceName, modId, enabled) => {
    const instances = store.get('instances', []);
    const updatedInstances = instances.map(inst => {
        if (inst.name === instanceName) {
            const updatedMods = inst.mods.map(mod => {
                if (String(mod.id) === String(modId)) {
                    const instanceModsPath = path.join(instancesDir, instanceName, 'mods');
                    const storedFileName = mod.fileName || mod.name.replace('.disabled', '');
                    const currentFileName = enabled ? `${storedFileName}.pak.disabled` : `${storedFileName}.pak`;
                    const oldModPath = path.join(instanceModsPath, currentFileName);

                    const targetFileName = enabled ? `${storedFileName}.pak` : `${storedFileName}.pak.disabled`;
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

                    return { ...mod, enabled: enabled };
                }
                return mod;
            });
            return { ...inst, mods: updatedMods };
        }
        return inst;
    });
    store.set('instances', updatedInstances);
    mainWindow.webContents.send('instance-updated');

    // Send updated installed mods to the workshop window
    const currentInstance = updatedInstances.find(inst => inst.name === instanceName);
    if (currentInstance) {
        getWorkshopWindows(instanceName).forEach(win => sendToWindow(win, 'set-installed-mods', currentInstance.mods));
    }
    return true;
});

ipcMain.handle('update-instance', async (event, oldName, newName, newDescription, newIcon) => {
    console.log(`Attempting to update instance: ${oldName} to ${newName}, desc: ${newDescription}, icon: ${newIcon}`);
    const instances = store.get('instances', []);
    const instanceIndex = instances.findIndex(inst => inst.name === oldName);

    if (instanceIndex === -1) {
        dialog.showErrorBox('Error', `Instance '${oldName}' not found.`);
        return false;
    }

    // Check if new name already exists for another instance
    if (newName !== oldName && instances.some((inst, index) => index !== instanceIndex && inst.name === newName)) {
        dialog.showErrorBox('Error', `An instance with the name '${newName}' already exists.`);
        return false;
    }

    const oldInstancePath = path.join(instancesDir, oldName);
    const newInstancePath = path.join(instancesDir, newName);

    try {
        if (oldName !== newName) {
            if (fs.existsSync(oldInstancePath)) {
                fse.moveSync(oldInstancePath, newInstancePath);
                console.log(`Renamed instance directory from ${oldInstancePath} to ${newInstancePath}`);
            }
        }

        const updatedInstance = { ...instances[instanceIndex], name: newName, description: newDescription, icon: newIcon, clientPath: newInstancePath};
        const updatedInstances = [...instances];
        updatedInstances[instanceIndex] = updatedInstance;
        store.set('instances', updatedInstances);
        mainWindow.webContents.send('instance-updated');
        return true;
    } catch (error) {
        console.error('Failed to update instance:', error);
        dialog.showErrorBox('Instance Update Failed', error.message);
        return false;
    }
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
    } else if (process.platform === 'darwin') {
        starboundExecutable = path.join(instance.clientPath, 'osx', 'Starbound.app');
        // Check if the user has disabled Gatekeeper for unsigned apps
        const gatekeeperCheck = await new Promise(resolve => {
            const child = spawn('spctl', ['--status']);
            let output = '';
            child.stdout.on('data', (data) => { output += data.toString(); });
            child.on('close', () => {
                resolve(output.includes('assessments disabled'));
            });
        });

        if (!gatekeeperCheck) {
            dialog.showErrorBox(
                'Gatekeeper Enabled',
                'To run OpenStarbound, you need to disable Gatekeeper for unsigned applications. Please open your Terminal and run the following command, then enter your password when prompted:\n\n' +
                'sudo spctl --master-disable\n\n' +
                'This is necessary because OpenStarbound is not signed by an identified developer, and macOS Gatekeeper prevents unsigned applications from running by default. Disabling it will allow you to run OpenStarbound and other unsigned applications.'
            );
            return false;
        }
    } else { // linux
        starboundExecutable = path.join(instance.clientPath, 'linux', 'starbound');
    }
    if (!fs.existsSync(starboundExecutable)) {
        dialog.showErrorBox('Error', 'OpenStarbound executable not found. Please ensure the client is downloaded for this instance.');
        return false;
    }

    if (process.platform !== 'darwin') {
        fs.chmodSync(starboundExecutable, '755');
    }

    console.log(`Launching ${starboundExecutable}`);

    try {
        let gameProcess;
        if (process.platform === 'darwin') {
            gameProcess = spawn('open', ['Starbound.app'], {
                cwd: path.join(instance.clientPath, 'osx'),
                detached: true,
                stdio: 'pipe'
            });
        } else {
            gameProcess = spawn(starboundExecutable, [], {
                cwd: instance.clientPath,
                detached: true,
                stdio: 'pipe'
            });
        }

        const logPath = path.join(instance.clientPath, 'logs', 'starbound.log');
        const logDir = path.dirname(logPath);
        if (!fs.existsSync(logDir)) {
            fse.mkdirpSync(logDir);
        }
        if (!fs.existsSync(logPath)) {
            fs.writeFileSync(logPath, ''); // Create empty log file if it doesn't exist
        }
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });

        gameProcess.stdout.pipe(logStream);
        gameProcess.stderr.pipe(logStream);

        gameProcess.unref();

        dialog.showMessageBox(BrowserWindow.getAllWindows()[0], {
            type: 'info',
            title: 'Launching Game',
            message: `Launching OpenStarbound instance: ${instanceName}`,
            buttons: ['OK']
        });

        fs.watchFile(logPath, () => {
            const logContent = fs.readFileSync(logPath, 'utf-8');
            mainWindow.webContents.send('log-updated', logContent);
        });

        gameProcess.on('close', () => {
            fs.unwatchFile(logPath);
            mainWindow.webContents.send('game-closed');
        });

        return true;
    } catch (error) {
        console.error('Failed to launch game:', error);
        dialog.showErrorBox('Game Launch Failed', error.message);
        return false;
    }
});

ipcMain.handle('get-log', async (event, instanceName) => {
    const instances = store.get('instances', []);
    const instance = instances.find(inst => inst.name === instanceName);
    if (!instance) {
        return 'Instance not found.';
    }

    const logPath = path.join(instance.clientPath, 'logs', 'starbound.log');
    if (fs.existsSync(logPath)) {
        return fs.readFileSync(logPath, 'utf-8');
    } else {
        return 'Log file not found.';
    }
});

ipcMain.handle('delete-instance', async (event, instanceName) => {
    const instances = store.get('instances', []);
    const instancePath = path.join(instancesDir, instanceName);
    const logPath = path.join(instancePath, 'logs', 'starbound.log');

    try {
        if (fs.existsSync(instancePath)) {
            fs.unwatchFile(logPath);
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
    const instances = store.get('instances', []);
    const instanceIndex = instances.findIndex(inst => inst.name === instanceName);

    if (instanceIndex === -1) {
        dialog.showErrorBox('Error', `Instance '${instanceName}' not found.`);
        return false;
    }

    const instance = instances[instanceIndex];
    const modToDelete = instance.mods.find(mod => String(mod.id) === String(modId));

    if (!modToDelete) {
        dialog.showErrorBox('Error', `Mod with ID '${modId}' not found in instance '${instanceName}'.`);
        return false;
    }

    const instanceModsPath = path.join(instancesDir, instanceName, 'mods');
    const storedFileName = modToDelete.fileName || modToDelete.name;
    const modFileName = `${storedFileName}.pak`;
    const modFilePath = path.join(instanceModsPath, modFileName);
    const disabledModFilePath = path.join(instanceModsPath, `${storedFileName}.pak.disabled`);

    try {
        if (fs.existsSync(modFilePath)) {
            fse.removeSync(modFilePath);
            console.log(`Deleted mod file: ${modFilePath}`);
        } else if (fs.existsSync(disabledModFilePath)) {
            fse.removeSync(disabledModFilePath);
            console.log(`Deleted disabled mod file: ${disabledModFilePath}`);
        }

        const updatedMods = instance.mods.filter(mod => String(mod.id) !== String(modId));
        const updatedInstance = { ...instance, mods: updatedMods };
        const updatedInstances = [...instances];
        updatedInstances[instanceIndex] = updatedInstance;
        store.set('instances', updatedInstances);
        mainWindow.webContents.send('instance-updated');

        // Send updated installed mods to the workshop window
        getWorkshopWindows(instanceName).forEach(win => sendToWindow(win, 'set-installed-mods', updatedMods));
        
        return true;
    } catch (error) {
        console.error('Failed to delete mod:', error);
        dialog.showErrorBox('Mod Deletion Failed', error.message);
        return false;
    }
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

const customIconsDir = path.join(app.getPath('userData'), 'custom_icons');
if (!fs.existsSync(customIconsDir)) fse.mkdirpSync(customIconsDir);

ipcMain.handle('import-icon', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }]
    });

    if (canceled || filePaths.length === 0) {
        return null;
    }

    const sourcePath = filePaths[0];
    const fileName = path.basename(sourcePath);
    const destPath = path.join(customIconsDir, fileName);

    try {
        fse.copySync(sourcePath, destPath, { overwrite: true });
        const customIcons = store.get('customIcons', []);
        if (!customIcons.includes(destPath)) {
            store.set('customIcons', [...customIcons, destPath]);
        }
        return destPath;
    } catch (error) {
        console.error('Failed to import icon:', error);
        dialog.showErrorBox('Icon Import Failed', error.message);
        return null;
    }
});

ipcMain.handle('get-custom-icons', async () => {
    return store.get('customIcons', []);
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
