document.addEventListener('DOMContentLoaded', async () => {
    // --- Setup Page Logic ---
    const selectPakButton = document.getElementById('select-pak-button');
    if (selectPakButton) {
        selectPakButton.addEventListener('click', async () => {
            await window.electronAPI.selectPak();
            // Main process reloads on success
        });
    }

    // --- Main Application Page Logic ---
    const newInstanceButton = document.getElementById('new-instance-button');
    const browseWorkshopButton = document.getElementById('browse-workshop-button');
    const instanceList = document.getElementById('instance-list');
    const instanceDetails = document.getElementById('instance-details');
    const updateInfoDiv = document.getElementById('update-info');

    let currentSelectedInstance = null; // Store the currently selected instance object

    async function loadInstances() {
        if (!instanceList) return;
        instanceList.innerHTML = ''; // Clear existing list
        const instances = await window.electronAPI.getInstances();
        if (instances.length === 0) {
            instanceList.innerHTML = '<li>No instances yet.</li>';
        } else {
            instances.forEach(instance => {
                const listItem = document.createElement('li');
                listItem.textContent = instance.name;
                listItem.dataset.instanceName = instance.name;
                instanceList.appendChild(listItem);
            });
        }
    }

    async function showMainContent() {
        const isClientDownloaded = await window.electronAPI.isClientDownloaded();
        const isSteamcmdDownloaded = await window.electronAPI.isSteamcmdDownloaded();

        if (!isClientDownloaded) {
            instanceDetails.innerHTML = `
                <div class="client-download-view">
                    <h1>OpenStarbound Client Not Found</h1>
                    <p>Please download the OpenStarbound client to continue.</p>
                    <button id="download-client-button">Download Client</button>
                    <p id="download-status"></p>
                </div>
            `;
            const downloadClientButton = document.getElementById('download-client-button');
            const downloadStatus = document.getElementById('download-status');

            if (downloadClientButton) {
                downloadClientButton.addEventListener('click', async () => {
                    downloadClientButton.disabled = true;
                    downloadStatus.textContent = 'Downloading and extracting client...';
                    const success = await window.electronAPI.downloadClient();
                    if (success) {
                        downloadStatus.textContent = 'Client downloaded and extracted successfully!';
                        await showMainContent(); // Reload main content to show instance management
                    } else {
                        downloadStatus.textContent = 'Failed to download client. Please try again.';
                        downloadClientButton.disabled = false;
                    }
                });
            }
        } else if (!isSteamcmdDownloaded) {
            instanceDetails.innerHTML = `
                <div class="client-download-view">
                    <h1>SteamCMD Not Found</h1>
                    <p>SteamCMD is required to browse and download mods from the Steam Workshop.</p>
                    <button id="download-steamcmd-button">Download SteamCMD</button>
                    <p id="download-status"></p>
                </div>
            `;
            const downloadSteamcmdButton = document.getElementById('download-steamcmd-button');
            const downloadStatus = document.getElementById('download-status');

            if (downloadSteamcmdButton) {
                downloadSteamcmdButton.addEventListener('click', async () => {
                    downloadSteamcmdButton.disabled = true;
                    downloadStatus.textContent = 'Downloading and extracting SteamCMD...';
                    const success = await window.electronAPI.downloadSteamcmd();
                    if (success) {
                        downloadStatus.textContent = 'SteamCMD downloaded and extracted successfully!';
                        await showMainContent(); // Reload main content to show instance management
                    } else {
                        downloadStatus.textContent = 'Failed to download SteamCMD. Please try again.';
                        downloadSteamcmdButton.disabled = false;
                    }
                });
            }
        } else {
            // Show instance management UI
            instanceDetails.innerHTML = `
                <div class="empty-state">
                    <h1>No Instance Selected</h1>
                    <p>Create a new instance or select an existing one from the list.</p>
                </div>
            `;
            await loadInstances();

            // Check for OpenStarbound updates
            const updateInfo = await window.electronAPI.checkForOpenstarboundUpdate();
            if (updateInfo.updateAvailable) {
                updateInfoDiv.innerHTML = `
                    <p>A new OpenStarbound version (${updateInfo.latestVersion}) is available! 
                    <button id="update-client-button">Update Client</button></p>
                `;
                document.getElementById('update-client-button').addEventListener('click', async () => {
                    document.getElementById('update-client-button').disabled = true;
                    updateInfoDiv.textContent = 'Updating client...';
                    const success = await window.electronAPI.downloadClient();
                    if (success) {
                        updateInfoDiv.textContent = 'Client updated successfully!';
                    } else {
                        updateInfoDiv.textContent = 'Client update failed.';
                    }
                });
            } else {
                updateInfoDiv.textContent = 'OpenStarbound client is up to date.';
            }
        }
    }

    if (newInstanceButton) {
        newInstanceButton.addEventListener('click', async () => {
            const { value: instanceName, canceled } = await window.electronAPI.openInputDialog({
                title: 'Create New Instance',
                message: 'Enter a name for the new instance:',
                placeholder: 'My New Instance'
            });

            if (!canceled && instanceName) {
                const created = await window.electronAPI.createInstance(instanceName);
                if (created) {
                    console.log(`Instance '${created}' created successfully.`);
                    await loadInstances();
                } else {
                    console.error('Failed to create instance in main process.');
                }
            }
        });
    }

    if (browseWorkshopButton) {
        browseWorkshopButton.addEventListener('click', () => {
            if (currentSelectedInstance) {
                window.electronAPI.openWorkshopWindow(currentSelectedInstance.name);
            } else {
                alert('Please select an instance first to browse the workshop for it.');
            }
        });
    }

    if (instanceList) {
        instanceList.addEventListener('click', async (event) => {
            if (event.target && event.target.dataset.instanceName) {
                Array.from(instanceList.children).forEach(child => child.classList.remove('active'));
                event.target.classList.add('active');
                const instanceName = event.target.dataset.instanceName;
                const instances = await window.electronAPI.getInstances();
                currentSelectedInstance = instances.find(inst => inst.name === instanceName);
                updateInstanceDetails(currentSelectedInstance);
            }
        });
    }

    function updateInstanceDetails(instance) {
        if (!instanceDetails || !instance) return;

        let modsHtml = '';
        if (instance.mods && instance.mods.length > 0) {
            modsHtml = `
                <h3>Installed Mods:</h3>
                <ul class="mod-list">
                    ${instance.mods.map(mod => `
                        <li>
                            <label>
                                <input type="checkbox" data-mod-id="${mod.id}" ${mod.enabled ? 'checked' : ''}>
                                ${mod.name}
                            </label>
                            <button class="delete-mod-button" data-mod-id="${mod.id}" data-mod-name="${mod.name}">Delete</button>
                        </li>
                    `).join('')}
                </ul>
            `;
        } else {
            modsHtml = '<p>No mods installed for this instance.</p>';
        }

        instanceDetails.innerHTML = `
            <div class="instance-view">
                <h1>${instance.name}</h1>
                ${modsHtml}
                <button class="launch-button" data-instance-name="${instance.name}">Launch ${instance.name}</button>
                <button class="delete-instance-button" data-instance-name="${instance.name}">Delete Instance</button>
            </div>
        `;

        // Add event listeners for mod checkboxes
        instanceDetails.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', async (event) => {
                const modId = event.target.dataset.modId;
                const enabled = event.target.checked;
                await window.electronAPI.updateModStatus(instance.name, modId, enabled);
                console.log(`Mod ${modId} in instance ${instance.name} set to enabled: ${enabled}`);
            });
        });

        // Add event listener for mod delete buttons
        instanceDetails.querySelectorAll('.delete-mod-button').forEach(button => {
            button.addEventListener('click', async (event) => {
                const modId = event.target.dataset.modId;
                const modName = event.target.dataset.modName;
                const confirmDelete = confirm(`Are you sure you want to delete mod '${modName}' from instance '${instance.name}'?`);
                if (confirmDelete) {
                    const success = await window.electronAPI.deleteMod(instance.name, modId);
                    if (success) {
                        console.log(`Mod '${modName}' deleted successfully from instance '${instance.name}'.`);
                        // Refresh the instance details to reflect the change
                        const instances = await window.electronAPI.getInstances();
                        currentSelectedInstance = instances.find(inst => inst.name === instance.name);
                        updateInstanceDetails(currentSelectedInstance);
                    } else {
                        alert(`Failed to delete mod '${modName}'. Check console for details.`);
                    }
                }
            });
        });

        // Add event listener for launch button
        const launchButton = instanceDetails.querySelector('.launch-button');
        if (launchButton) {
            launchButton.addEventListener('click', async () => {
                console.log(`Launching instance: ${instance.name}`);
                await window.electronAPI.launchGame(instance.name);
            });
        }

        // Add event listener for delete instance button
        const deleteInstanceButton = instanceDetails.querySelector('.delete-instance-button');
        if (deleteInstanceButton) {
            deleteInstanceButton.addEventListener('click', async () => {
                const confirmDelete = confirm(`Are you sure you want to delete instance '${instance.name}'? This will remove all its files.`);
                if (confirmDelete) {
                    const success = await window.electronAPI.deleteInstance(instance.name);
                    if (success) {
                        console.log(`Instance '${instance.name}' deleted successfully.`);
                        currentSelectedInstance = null; // Clear selected instance
                        await loadInstances(); // Reload instance list
                        instanceDetails.innerHTML = `
                            <div class="empty-state">
                                <h1>No Instance Selected</h1>
                                <p>Create a new instance or select an existing one from the list.</p>
                            </div>
                        `;
                    } else {
                        alert(`Failed to delete instance '${instance.name}'. Check console for details.`);
                    }
                }
            });
        }
    }

    // Initial load for the main page
    if (document.getElementById('instance-list')) {
        await showMainContent();
    }
});