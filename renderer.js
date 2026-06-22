window.addEventListener('DOMContentLoaded', () => {
    const newInstanceButton = document.getElementById('new-instance-button');
    const instanceList = document.getElementById('instance-list');



    const instanceDetails = document.getElementById('instance-details');
    const instanceDetailsTop = document.getElementById('instance-details-top');
    const instanceDetailsBottom = document.getElementById('instance-details-bottom');



    const browseWorkshopButton = document.getElementById('browse-workshop-button');
    const importModsButton = document.getElementById('import-mods-button');
    const downloadToast = document.getElementById('loadingOverlay');
    const downloadProgressTitle = document.getElementById('downloadProgressTitle');
    const downloadProgressMessage = document.getElementById('downloadProgressMessage');
    const downloadProgressPercent = document.getElementById('downloadProgressPercent');
    const downloadProgressTrack = document.getElementById('downloadProgressTrack');
    const downloadProgressBar = document.getElementById('downloadProgressBar');
    const downloadProgressDetails = document.getElementById('downloadProgressDetails');
    const downloadQueueButton = document.getElementById('download-queue-button');
    const downloadQueueBadge = document.getElementById('download-queue-badge');
    const downloadQueueDialog = document.getElementById('download-queue-dialog');
    const downloadQueueSummary = document.getElementById('download-queue-summary');
    const downloadQueueList = document.getElementById('download-queue-list');

    let instances = [];
    let selectedInstanceName = null;
    let runningInstances = [];
    let toastHideTimer = null;

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '';
        const units = ['B', 'KB', 'MB', 'GB'];
        const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        const value = bytes / (1024 ** unitIndex);
        return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    }

    function hideDownloadToast() {
        downloadToast.classList.remove('visible', 'success', 'error');
        downloadToast.setAttribute('aria-hidden', 'true');
    }

    function showDownloadProgress(progress) {
        if (toastHideTimer) clearTimeout(toastHideTimer);
        const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0;
        const terminal = progress.phase === 'complete' || progress.phase === 'error';

        downloadToast.classList.toggle('success', progress.phase === 'complete');
        downloadToast.classList.toggle('error', progress.phase === 'error');
        downloadToast.classList.add('visible');
        downloadToast.setAttribute('aria-hidden', 'false');
        downloadProgressTitle.textContent = progress.phase === 'complete'
            ? 'Instance ready'
            : progress.phase === 'error'
                ? 'Instance creation failed'
                : `Creating ${progress.instanceName || 'instance'}`;
        downloadProgressMessage.textContent = progress.message || 'Working…';
        downloadProgressTrack.classList.toggle('indeterminate', Boolean(progress.indeterminate));

        if (progress.indeterminate) {
            downloadProgressPercent.textContent = progress.phase === 'extract' ? 'Extracting' : 'Working…';
            downloadProgressTrack.removeAttribute('aria-valuenow');
        } else {
            downloadProgressPercent.textContent = `${Math.round(percent)}%`;
            downloadProgressBar.style.width = `${percent}%`;
            downloadProgressTrack.setAttribute('aria-valuenow', String(Math.round(percent)));
        }

        if (progress.phase === 'download' && progress.bytes) {
            const downloaded = formatBytes(progress.bytes);
            const total = formatBytes(progress.totalBytes);
            downloadProgressDetails.textContent = total ? `${downloaded} of ${total}` : downloaded;
        } else {
            downloadProgressDetails.textContent = '';
        }

        if (terminal) {
            toastHideTimer = setTimeout(hideDownloadToast, progress.phase === 'complete' ? 3000 : 7000);
        }
    }

    window.electronAPI.onClientDownloadProgress(showDownloadProgress);

    function renderDownloadQueue(state) {
        const jobs = [...(state.jobs || [])];
        const order = { downloading: 0, retrying: 1, queued: 2, failed: 3, completed: 4 };
        jobs.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
        const pending = jobs.filter(job => ['queued', 'downloading', 'retrying'].includes(job.status)).length;
        const completed = jobs.filter(job => job.status === 'completed').length;
        const failed = jobs.filter(job => job.status === 'failed').length;

        downloadQueueButton.hidden = jobs.length === 0;
        downloadQueueBadge.textContent = String(pending);
        downloadQueueSummary.textContent = jobs.length
            ? `${pending} remaining · ${completed} complete${failed ? ` · ${failed} failed` : ''}`
            : 'No mod downloads yet.';
        downloadQueueList.replaceChildren();

        if (!jobs.length) {
            const empty = document.createElement('div');
            empty.className = 'queue-empty';
            empty.textContent = 'Your mod download queue is empty.';
            downloadQueueList.appendChild(empty);
            return;
        }

        jobs.forEach(job => {
            const item = document.createElement('div');
            item.className = 'queue-item';
            const name = document.createElement('div');
            name.className = 'queue-item-name';
            name.textContent = job.modName;
            const status = document.createElement('span');
            status.className = `queue-status ${job.status}`;
            status.textContent = job.status;
            const meta = document.createElement('div');
            meta.className = 'queue-item-meta';
            meta.textContent = `${job.instanceName} · Workshop ${job.modId}${job.attempts > 1 ? ` · attempt ${job.attempts}` : ''}`;
            item.append(name, status, meta);
            if (job.error && ['failed', 'retrying'].includes(job.status)) {
                const error = document.createElement('div');
                error.className = 'queue-item-error';
                error.textContent = `${job.status === 'retrying' ? 'Last error: ' : ''}${job.error}`;
                item.appendChild(error);
            }
            downloadQueueList.appendChild(item);
        });
    }

    function openDownloadQueue() {
        downloadQueueDialog.classList.add('visible');
        downloadQueueDialog.setAttribute('aria-hidden', 'false');
        downloadQueueDialog.querySelector('.queue-close-button').focus();
    }

    function closeDownloadQueue() {
        downloadQueueDialog.classList.remove('visible');
        downloadQueueDialog.setAttribute('aria-hidden', 'true');
        downloadQueueButton.focus();
    }

    downloadQueueButton.addEventListener('click', openDownloadQueue);
    downloadQueueDialog.querySelector('.queue-close-button').addEventListener('click', closeDownloadQueue);
    downloadQueueDialog.addEventListener('click', event => {
        if (event.target === downloadQueueDialog) closeDownloadQueue();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && downloadQueueDialog.classList.contains('visible')) closeDownloadQueue();
    });
    window.electronAPI.onDownloadStatusUpdate(renderDownloadQueue);
    window.electronAPI.getDownloadState().then(renderDownloadQueue);

    async function loadInstances() {
        instances = await window.electronAPI.getInstances();
        instanceList.innerHTML = '';
        instances.forEach(instance => {
            const instanceElement = document.createElement('li');
            instanceElement.dataset.instanceName = instance.name;
            if (instance.icon && instance.icon.startsWith('fa-')) {
                instanceElement.innerHTML = `<i class="fas ${instance.icon}"></i> ${instance.name}`;
            } else if (instance.icon) {
                instanceElement.innerHTML = `<img src="${instance.icon}" class="custom-icon"/> ${instance.name}`;
            } else {
                instanceElement.innerHTML = `<i class="fas fa-rocket"></i> ${instance.name}`;
            }
            if (instance.name === selectedInstanceName) {
                instanceElement.classList.add('active');
            }
            instanceList.appendChild(instanceElement);
        });
        renderinstanceDetails();
    }

    function renderinstanceDetails() {
        const selectedInstance = instances.find(inst => inst.name === selectedInstanceName);

        if (!selectedInstance) {
            instanceDetailsTop.innerHTML = '<div class="empty-state"><p>Select an instance to see details.</p></div>';
            instanceDetailsBottom.innerHTML = '<div class="empty-state"></div>';
            return;
        }

        console.info(instanceDetailsBottom);

        let iconHtml;
        if (selectedInstance.icon && selectedInstance.icon.startsWith('fa-')) {
            iconHtml = `<i class="fas ${selectedInstance.icon}"></i>`;
        } else if (selectedInstance.icon) {
            iconHtml = `<img src="${selectedInstance.icon}" class="custom-icon"/>`;
        } else {
            iconHtml = `<i class="fas fa-rocket"></i>`;
        }

        instanceDetailsTop.innerHTML = `
            <div class="instance-header">
                <h1>${iconHtml} ${selectedInstance.name} <button id="edit-instance-btn" class="secondary small"><i class="fas fa-edit"></i> Edit</button></h1>
                <p class="instance-description">${selectedInstance.description ? selectedInstance.description : 'No description provided.'}</p>
                <span>OpenStarbound Version: ${selectedInstance.version}</span>
            </div>
            <div class="instance-controls">
                <button id="launch-game-btn" class="${runningInstances.includes(selectedInstance.name) ? 'disabled-btn' : 'primary'}" ${runningInstances.includes(selectedInstance.name) ? 'disabled' : ''}><i class="fas fa-play"></i> Launch Game</button>
                <button id ="mods-btn" class="secondary"><i class="fas fa-puzzle-piece"></i> Mods</button>
                <button id ="logs-btn" class="secondary"><i class="fas fa-file-alt"></i> Logs</button>
                <button id="open-folder-btn" class="secondary"><i class="fas fa-folder-open"></i> Open Folder</button>
                <button id="delete-instance-btn" class="${runningInstances.includes(selectedInstance.name) ? 'disabled-btn' : 'danger'}" ${runningInstances.includes(selectedInstance.name) ? 'disabled' : ''}><i class="fas fa-trash"></i> Delete Instance</button>
            </div>
            
        `;

        const installedModCount = selectedInstance.mods?.length || 0;
        let instanceDetailsBottomToAdd = `
            <div id="tab-content" class="tab-content">
                <div id="mods-tab" class="tab-pane active">
                    <div class="installed-mods-toolbar">
                        <div class="installed-mod-search-wrap">
                            <i class="fas fa-search" aria-hidden="true"></i>
                            <input type="text" id="installed-mod-search" placeholder="Filter installed mods…" aria-label="Filter installed mods" ${installedModCount === 0 ? 'disabled' : ''}>
                        </div>
                        <span id="installed-mod-count" class="installed-mod-count" data-total="${installedModCount}">${installedModCount} ${installedModCount === 1 ? 'mod' : 'mods'} installed</span>
                    </div>
                    <div id="mods-list">
        `;

        if (installedModCount > 0) {
            selectedInstance.mods.forEach(mod => {
                const displayName = mod.external
                    ? mod.name
                    : mod.enabled ? mod.name : `${mod.name} (Disabled)`;
                const safeDisplayName = escapeHtml(displayName);
                const importedStatus = mod.imported ? ' (Imported)' : '';
                const identifier = mod.external ? '' : ` (ID: ${mod.id})`;
                const externalFlair = mod.external ? '<span class="mod-flair external">External</span>' : '';
                const folderFlair = mod.isDirectory ? '<span class="mod-flair folder">Folder</span>' : '';
                const toggleControl = mod.isDirectory ? '' : `
                            <label class="switch">
                                <input type="checkbox" class="mod-toggle" data-mod-id="${mod.id}" ${mod.enabled ? 'checked' : ''}>
                                <span class="slider round"></span>
                            </label>`;
                instanceDetailsBottomToAdd += `
                    <div class="mod-item">
                        <span class="mod-name">${safeDisplayName}${identifier}${importedStatus} ${externalFlair}${folderFlair}</span>
                        <div class="mod-controls">
                            ${toggleControl}
                            <button class="delete-mod-btn danger" data-mod-id="${mod.id}"><i class="fas fa-trash"></i> Delete</button>
                        </div>
                    </div>
                `;
            });
        } else {
            instanceDetailsBottomToAdd += '<p class="empty-state">No mods installed.</p>';
        }

        instanceDetailsBottomToAdd += `
                        <p id="installed-mod-search-empty" class="empty-state" hidden>No installed mods match your search.</p>
                    </div>
                </div>
                <div id="logs-tab" class="tab-pane">
                    <pre id="log-content"></pre>
                </div>
            </div>`;

        instanceDetailsBottom.innerHTML = instanceDetailsBottomToAdd;
        
    }

    instanceList.addEventListener('click', (event) => {
        const target = event.target;
        if (target.tagName === 'LI') {
            selectedInstanceName = target.dataset.instanceName;
            loadInstances(); // Reload to update the active state and details
        }
    });

    instanceDetails.addEventListener('input', event => {
        if (event.target.id !== 'installed-mod-search') return;

        const query = event.target.value.trim().toLowerCase();
        const modItems = Array.from(instanceDetails.querySelectorAll('#mods-list .mod-item'));
        let visibleCount = 0;
        modItems.forEach(item => {
            const matches = !query || item.querySelector('.mod-name').textContent.toLowerCase().includes(query);
            item.hidden = !matches;
            if (matches) visibleCount++;
        });

        const count = document.getElementById('installed-mod-count');
        const total = Number(count?.dataset.total || 0);
        if (count) {
            count.textContent = query
                ? `${visibleCount} of ${total} shown`
                : `${total} ${total === 1 ? 'mod' : 'mods'} installed`;
        }

        const emptyResult = document.getElementById('installed-mod-search-empty');
        if (emptyResult) emptyResult.hidden = !query || visibleCount > 0;
    });

    instanceDetails.addEventListener('click', async (event) => {

        const modId = event.target.dataset.modId;



        if (event.target.classList.contains('mod-toggle')) {
            const enabled = event.target.checked;
            await window.electronAPI.updateModStatus(selectedInstanceName, modId, enabled);
            loadInstances(); // Refresh to show updated status
        }

        if (event.target.classList.contains('delete-mod-btn')) {
            const confirm = await window.electronAPI.openInputDialog({
                title: 'Confirm Deletion',
                message: `Are you sure you want to delete this mod?`,
                isConfirmation: true
            });
            if (confirm && !confirm.canceled) {
                await window.electronAPI.deleteMod(selectedInstanceName, modId);
                loadInstances(); // Refresh the list
            }
        }

        if (event.target.id === 'launch-game-btn') {

            window.electronAPI.launchGame(selectedInstanceName);
            runningInstances.push(selectedInstanceName);


            document.getElementById('delete-instance-btn').disabled = true;
            document.getElementById('delete-instance-btn').className = "disabled-btn";

            document.getElementById('launch-game-btn').disabled = true;
            document.getElementById('launch-game-btn').className = "disabled-btn";


        }

        window.electronAPI.onGameClose(() => {
            runningInstances = runningInstances.filter(inst => inst !== selectedInstanceName);

            document.getElementById('delete-instance-btn').disabled = false;
            document.getElementById('delete-instance-btn').className = "danger";

            document.getElementById('launch-game-btn').disabled = false;
            document.getElementById('launch-game-btn').className = "primary";

        });

        if (event.target.id === 'delete-instance-btn') {
            const confirm = await window.electronAPI.openInputDialog({
                title: 'Confirm Deletion',
                message: `Are you sure you want to delete the instance '${selectedInstanceName}'? This action cannot be undone.`,
                isConfirmation: true
            });
            if (confirm && !confirm.canceled) {
                await window.electronAPI.deleteInstance(selectedInstanceName);
                selectedInstanceName = null; // Reset selection

                // Clear the log content when an instance is deleted
                const logContent = document.getElementById('log-content');
                if (logContent) {
                    logContent.textContent = '';
                }
                
                loadInstances();
            }
        }

        if (event.target.id === 'mods-btn') {
            document.getElementById(`logs-tab`).classList.remove('active');
            document.getElementById(`mods-tab`).classList.add('active');
        }

        if (event.target.id === 'logs-btn') {
                document.getElementById(`mods-tab`).classList.remove('active');
                document.getElementById(`logs-tab`).classList.add('active');
                const logContent = document.getElementById('log-content');
                const log = await window.electronAPI.getLog(selectedInstanceName);
                logContent.textContent = log;
                logContent.scrollTop = logContent.scrollHeight; // Scroll to bottom
        }

        if (event.target.id === 'open-folder-btn') {
            await window.electronAPI.openInstanceFolder(selectedInstanceName);
        }

        if (event.target.id === 'edit-instance-btn') {
            const currentInstance = instances.find(inst => inst.name === selectedInstanceName);
            const result = await window.electronAPI.openInputDialog({
                title: 'Edit Instance',
                message: 'Edit instance name and description:',
                placeholder: 'Instance Name',
                value: currentInstance.name,
                descriptionPlaceholder: 'Optional Description',
                descriptionValue: currentInstance.description || '',
                isEdit: true,
                icon: currentInstance.icon || 'fa-rocket'
            });

            if (result && !result.canceled) {
                const newName = result.value;
                const newDescription = result.description || '';
                if (newName && (newName !== currentInstance.name || newDescription !== currentInstance.description || result.icon !== currentInstance.icon)) {
                    const success = await window.electronAPI.updateInstance(selectedInstanceName, newName, newDescription, result.icon);
                    if (success) {
                        selectedInstanceName = newName; // Update selected instance name if name changed
                        loadInstances();
                    }
                }
            }
        }
    });

    newInstanceButton.addEventListener('click', async () => {
        try {
            const versions = await window.electronAPI.getOpenStarboundVersions();
            if (!versions || versions.length === 0) {
                // Handle case where versions couldn't be fetched
                console.error('Could not fetch OpenStarbound versions.');
                return;
            }

            const instanceNameAndVersionResult = await window.electronAPI.openInputDialog({
                title: 'New Instance',
                message: 'Enter a name for your new instance, an optional description, and select a version:',
                placeholder: 'Instance Name',
                descriptionPlaceholder: 'Optional Description',
                versions: versions.map(v => ({ name: v.name, tag: v.tag })),
                icon: 'fa-rocket' // Default icon for new instance
            });

            if (instanceNameAndVersionResult && !instanceNameAndVersionResult.canceled) {
                const instanceName = instanceNameAndVersionResult.value;
                const instanceDescription = instanceNameAndVersionResult.description || ''; // Get description
                const selectedVersion = instanceNameAndVersionResult.version;
                const instanceIcon = instanceNameAndVersionResult.icon; // Get icon

                if (instanceName && selectedVersion) {
                    newInstanceButton.disabled = true;
                    showDownloadProgress({
                        instanceName,
                        phase: 'release',
                        message: 'Preparing the game download…',
                        percent: 0,
                        indeterminate: true
                    });

                    try {
                        const success = await window.electronAPI.createInstance({ value: instanceName, description: instanceDescription, version: selectedVersion, icon: instanceIcon });
                        if (success) {
                            selectedInstanceName = instanceName; // Select the new instance
                            loadInstances();
                        }
                    } finally {
                        newInstanceButton.disabled = false;
                    }
                } else {
                    console.warn('Instance name or version not provided.');
                }
            }
        } catch (error) {
            console.error('Failed to create new instance:', error);
            showDownloadProgress({ phase: 'error', message: error.message, percent: 0, indeterminate: false });
            newInstanceButton.disabled = false;
        }
    });

    browseWorkshopButton.addEventListener('click', () => {
        if (selectedInstanceName) {
            window.electronAPI.openWorkshopWindow(selectedInstanceName);
        } else {
            window.electronAPI.openInputDialog({ title: 'No Instance Selected', message: 'Please select an instance from the list before browsing the workshop.', isConfirmation: true });
        }
    });

    importModsButton.addEventListener('click', async () => {
        if (selectedInstanceName) {
            const result = await window.electronAPI.openFolderDialog();
            if (result && !result.canceled && result.filePaths.length > 0) {
                await window.electronAPI.importMods(selectedInstanceName, result.filePaths[0]);
                loadInstances();
            }
        } else {
            window.electronAPI.openInputDialog({ title: 'No Instance Selected', message: 'Please select an instance from the list before importing mods.', isConfirmation: true });
        }
    });

    window.electronAPI.onInstanceUpdate(loadInstances);

    window.electronAPI.onLogUpdate((log) => {
        const logContent = document.getElementById('log-content');
        if (logContent) {
            logContent.textContent = log;
            logContent.scrollTop = logContent.scrollHeight;
        }
    });

    // Initial load
    loadInstances();
});
