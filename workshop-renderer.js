document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const searchResults = document.getElementById('mod-list');
    const downloadSelectedButton = document.getElementById('download-selected-button');
    const downloadStatus = document.getElementById('download-status');

    let instanceName = '';
    let installedMods = [];
    let currentSearchResults = []; // Store current search results
    const downloadingModIds = new Set(); // Track mods currently downloading

    // Use the correct, dedicated API for the workshop window
    window.workshopAPI.onSetInstanceName((name) => {
        instanceName = name;
        document.getElementById('instance-name-header').textContent = `Mod Manager for ${name}`;
    });

    window.workshopAPI.onSetInstalledMods((mods) => {
        installedMods = mods;
        // Update the status of currently displayed mods
        document.querySelectorAll('.mod-card').forEach(modCard => {
            const modId = modCard.querySelector('.download-mod-button').dataset.modId;
            const isInstalled = installedMods.some(installedMod => installedMod.id === modId);
            const button = modCard.querySelector('.download-mod-button');
            const checkbox = modCard.querySelector('.mod-checkbox');

            if (isInstalled) {
                button.textContent = 'Installed';
                button.classList.add('installed');
                button.classList.remove('primary');
                button.disabled = true;
                if (checkbox) checkbox.disabled = true;
                downloadingModIds.delete(modId); // Remove from downloading if now installed
            } else if (downloadingModIds.has(modId)) {
                // If it's still downloading, keep it as such
                button.textContent = 'Downloading...';
                button.disabled = true;
                if (checkbox) checkbox.disabled = true;
            } else {
                // If neither installed nor downloading, it's available for download
                button.textContent = 'Download';
                button.classList.remove('installed');
                button.classList.add('primary');
                button.disabled = false;
                if (checkbox) checkbox.disabled = false;
            }
        });
    });

    // Listen for download status updates
    window.workshopAPI.onDownloadStatusUpdate((status) => {
        if (status.active > 0) {
            downloadStatus.textContent = `Downloading ${status.active} of ${status.total} mods...`;
            downloadStatus.style.display = 'block';
        } else {
            downloadStatus.textContent = '';
            downloadStatus.style.display = 'none';
        }
    });

    function renderSearchResults(mods) {
        searchResults.innerHTML = '';
        if (mods.length === 0) {
            searchResults.innerHTML = '<p>No mods found.</p>';
            return;
        }

        mods.forEach(mod => {
            const isInstalled = installedMods.some(installedMod => installedMod.id === mod.id);
            const buttonText = isInstalled ? 'Installed' : (downloadingModIds.has(mod.id) ? 'Downloading...' : 'Download');
            const buttonClass = isInstalled ? 'download-mod-button installed' : (downloadingModIds.has(mod.id) ? 'download-mod-button downloading' : 'download-mod-button primary');
            const buttonIcon = isInstalled ? '<i class="fas fa-check"></i>' : (downloadingModIds.has(mod.id) ? '<i class="fas fa-spinner fa-spin"></i>' : '<i class="fas fa-download"></i>');
            const buttonDisabled = isInstalled || downloadingModIds.has(mod.id) ? 'disabled' : '';

            const modElement = document.createElement('div');
            modElement.className = 'mod-card';
            modElement.innerHTML = `
                <img src="${mod.imageUrl}" alt="${mod.name}" class="mod-image">
                <div class="mod-card-content">
                    <h3 class="mod-name">${mod.name}</h3>
                    <p class="mod-id">ID: ${mod.id}</p>
                </div>
                <div class="mod-card-actions">
                    <input type="checkbox" class="mod-checkbox" data-mod-id="${mod.id}" data-mod-name="${mod.name}" ${isInstalled || downloadingModIds.has(mod.id) ? 'disabled' : ''}>
                    <button class="${buttonClass}" data-mod-id="${mod.id}" data-mod-name="${mod.name}" ${buttonDisabled}>${buttonIcon} ${buttonText}</button>
                </div>
            `;
            searchResults.appendChild(modElement);
        });
    }

    searchButton.addEventListener('click', async () => {
        const query = searchInput.value.trim();
        if (!query) return;

        searchResults.innerHTML = '<div class="loading-spinner"></div>';

        try {
            const mods = await window.electronAPI.searchWorkshop(query);
            currentSearchResults = mods; // Store the results
            renderSearchResults(mods);

        } catch (error) {
            searchResults.innerHTML = '<p>Search failed. Please try again.</p>';
            console.error('Workshop search failed:', error);
        }
    });

    searchResults.addEventListener('click', async (event) => {
        if (event.target.classList.contains('download-mod-button')) {
            const modId = event.target.dataset.modId;
            const modName = event.target.dataset.modName;
            const button = event.target;

            button.textContent = 'Downloading...';
            button.disabled = true;
            const checkbox = button.previousElementSibling;
            if (checkbox) checkbox.disabled = true;
            downloadingModIds.add(modId); // Add to downloading set

            try {
                await window.electronAPI.downloadMod({ modId, modName, instanceName });
            } catch (error) {
                button.textContent = 'Error';
                button.classList.add('error');
                console.error('Mod download failed:', error);
                downloadingModIds.delete(modId); // Remove from downloading on error
            }
        }
    });

    downloadSelectedButton.addEventListener('click', async () => {
        const selectedMods = [];
        document.querySelectorAll('.mod-checkbox:checked').forEach(checkbox => {
            const modId = checkbox.dataset.modId;
            const modName = checkbox.dataset.modName;
            selectedMods.push({
                id: modId,
                name: modName
            });
            // Disable checkboxes and buttons for selected mods
            checkbox.disabled = true;
            const button = checkbox.nextElementSibling; // Assuming button is next to checkbox
            if (button) {
                button.textContent = 'Downloading...';
                button.disabled = true;
                downloadingModIds.add(modId); // Add to downloading set
            }
        });

        if (selectedMods.length > 0) {
            await window.electronAPI.downloadMods(selectedMods, instanceName);
        } else {
            alert('Please select at least one mod to download.');
        }
    });
});
