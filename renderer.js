window.addEventListener('DOMContentLoaded', () => {
    const newInstanceButton = document.getElementById('new-instance-button');
    const instanceList = document.getElementById('instance-list');
    const instanceDetails = document.getElementById('instance-details');
    const browseWorkshopButton = document.getElementById('browse-workshop-button');
    const importModsButton = document.getElementById('import-mods-button');

    let instances = [];
    let selectedInstanceName = null;

    async function loadInstances() {
        instances = await window.electronAPI.getInstances();
        instanceList.innerHTML = '';
        instances.forEach(instance => {
            const instanceElement = document.createElement('li');
            instanceElement.dataset.instanceName = instance.name;
            instanceElement.innerHTML = `<i class="fas ${instance.icon || 'fa-rocket'}"></i> ${instance.name}`;
            if (instance.name === selectedInstanceName) {
                instanceElement.classList.add('active');
            }
            instanceList.appendChild(instanceElement);
        });
        renderInstanceDetails();
    }

    function renderInstanceDetails() {
        const selectedInstance = instances.find(inst => inst.name === selectedInstanceName);

        if (!selectedInstance) {
            instanceDetails.innerHTML = '<div class="empty-state"><p>Select an instance to see details.</p></div>';
            return;
        }

        instanceDetails.innerHTML = `
            <div class="instance-header">
                <h1><i class="fas ${selectedInstance.icon || 'fa-rocket'}"></i> ${selectedInstance.name} <button id="edit-instance-btn" class="secondary small"><i class="fas fa-edit"></i> Edit</button></h1>
                <p class="instance-description">${selectedInstance.description ? selectedInstance.description : 'No description provided.'}</p>
                <span>OpenStarbound Version: ${selectedInstance.version}</span>
            </div>
            <div class="instance-controls">
                <button id="launch-game-btn" class="primary"><i class="fas fa-play"></i> Launch Game</button>
                <button id="log-btn" class="secondary"><i class="fas fa-file-alt"></i> Log</button>
                <button id="open-folder-btn" class="secondary"><i class="fas fa-folder-open"></i> Open Folder</button>
                <button id="delete-instance-btn" class="danger"><i class="fas fa-trash"></i> Delete Instance</button>
            </div>
            <div id="log-section" class="log-section" style="display: none;">
                <h2><i class="fas fa-file-alt"></i> Game Log</h2>
                <pre id="log-content"></pre>
            </div>
            <div class="mods-section">
                <h2><i class="fas fa-puzzle-piece"></i> Mods</h2>
                <div id="mods-list"></div>
            </div>
        `;

        const modsList = document.getElementById('mods-list');
        if (selectedInstance.mods && selectedInstance.mods.length > 0) {
            selectedInstance.mods.forEach(mod => {
                const modElement = document.createElement('div');
                modElement.className = 'mod-item';
                const displayName = mod.enabled ? mod.name : `${mod.name} (Disabled)`;
                const importedStatus = mod.imported ? ' (Imported)' : '';
                modElement.innerHTML = `
                    <span class="mod-name">${displayName} (ID: ${mod.id})${importedStatus}</span>
                    <div class="mod-controls">
                        <label class="switch">
                            <input type="checkbox" class="mod-toggle" data-mod-id="${mod.id}" ${mod.enabled ? 'checked' : ''}>
                            <span class="slider round"></span>
                        </label>
                        <button class="delete-mod-btn danger" data-mod-id="${mod.id}"><i class="fas fa-trash"></i> Delete</button>
                    </div>
                `;
                modsList.appendChild(modElement);
            });
        } else {
            modsList.innerHTML = '<p>No mods installed for this instance.</p>';
        }
    }

    instanceList.addEventListener('click', (event) => {
        const target = event.target;
        if (target.tagName === 'LI') {
            selectedInstanceName = target.dataset.instanceName;
            loadInstances(); // Reload to update the active state and details
        }
    });

    instanceDetails.addEventListener('click', async (event) => {
        const target = event.target;
        const modId = target.dataset.modId;

        if (target.classList.contains('mod-toggle')) {
            const enabled = target.checked;
            await window.electronAPI.updateModStatus(selectedInstanceName, modId, enabled);
            loadInstances(); // Refresh to show updated status
        }

        if (target.classList.contains('delete-mod-btn')) {
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

        if (target.id === 'launch-game-btn') {
            window.electronAPI.launchGame(selectedInstanceName);
        }

        if (target.id === 'delete-instance-btn') {
            const confirm = await window.electronAPI.openInputDialog({
                title: 'Confirm Deletion',
                message: `Are you sure you want to delete the instance '${selectedInstanceName}'? This action cannot be undone.`,
                isConfirmation: true
            });
            if (confirm && !confirm.canceled) {
                await window.electronAPI.deleteInstance(selectedInstanceName);
                selectedInstanceName = null; // Reset selection
                loadInstances();
            }
        }

        if (target.id === 'log-btn') {
            const logSection = document.getElementById('log-section');
            const logContent = document.getElementById('log-content');
            if (logSection.style.display === 'none') {
                logSection.style.display = 'block';
                const log = await window.electronAPI.getLog(selectedInstanceName);
                logContent.textContent = log;
            } else {
                logSection.style.display = 'none';
            }
        }

        if (target.id === 'open-folder-btn') {
            await window.electronAPI.openInstanceFolder(selectedInstanceName);
        }

        if (target.id === 'edit-instance-btn') {
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
                    const success = await window.electronAPI.createInstance({ value: instanceName, description: instanceDescription, version: selectedVersion, icon: instanceIcon });
                    if (success) {
                        selectedInstanceName = instanceName; // Select the new instance
                        loadInstances();
                    }
                } else {
                    console.warn('Instance name or version not provided.');
                }
            }
        } catch (error) {
            console.error('Failed to create new instance:', error);
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
        }
    });

    // Initial load
    loadInstances();
});