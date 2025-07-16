document.addEventListener('DOMContentLoaded', () => {
    const newInstanceButton = document.getElementById('new-instance-button');
    const instanceList = document.getElementById('instance-list');
    const instanceDetails = document.getElementById('instance-details');
    const browseWorkshopButton = document.getElementById('browse-workshop-button');

    let instances = [];
    let selectedInstanceName = null;

    async function loadInstances() {
        instances = await window.electronAPI.getInstances();
        instanceList.innerHTML = '';
        instances.forEach(instance => {
            const instanceElement = document.createElement('li');
            instanceElement.textContent = instance.name;
            instanceElement.dataset.instanceName = instance.name;
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
                <h1>${selectedInstance.name}</h1>
                <span>OpenStarbound Version: ${selectedInstance.version}</span>
            </div>
            <div class="instance-controls">
                <button id="launch-game-btn" class="primary"><i class="fas fa-play"></i> Launch Game</button>
                <button id="delete-instance-btn" class="danger"><i class="fas fa-trash"></i> Delete Instance</button>
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
                modElement.innerHTML = `
                    <span class="mod-name">${displayName} (ID: ${mod.id})</span>
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

        // Add event listeners for the new buttons
        document.getElementById('launch-game-btn').addEventListener('click', () => {
            window.electronAPI.launchGame(selectedInstanceName);
        });

        document.getElementById('delete-instance-btn').addEventListener('click', async () => {
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
        });

        modsList.addEventListener('click', async (event) => {
            const target = event.target;
            const modId = target.dataset.modId;

            if (target.classList.contains('mod-toggle')) {
                const enabled = target.checked;
                await window.electronAPI.updateModStatus(selectedInstanceName, modId, enabled);
                // We don't need to reload the entire instance list here, but it's simpler for now
                loadInstances(); 
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
        });
    }

    instanceList.addEventListener('click', (event) => {
        const target = event.target;
        if (target.tagName === 'LI') {
            selectedInstanceName = target.dataset.instanceName;
            loadInstances(); // Reload to update the active state and details
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
                message: 'Enter a name for your new instance and select a version:',
                placeholder: 'Instance Name',
                versions: versions.map(v => ({ name: v.name, tag: v.tag }))
            });

            if (instanceNameAndVersionResult && !instanceNameAndVersionResult.canceled) {
                const instanceName = instanceNameAndVersionResult.value;
                const selectedVersion = instanceNameAndVersionResult.version;

                if (instanceName && selectedVersion) {
                    const success = await window.electronAPI.createInstance({ value: instanceName, version: selectedVersion });
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

    // Listen for updates from the main process (e.g., after a mod download)
    window.electronAPI.onInstanceUpdate(loadInstances);

    // Initial load
    loadInstances();
});