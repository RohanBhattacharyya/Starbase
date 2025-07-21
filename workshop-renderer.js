document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const modList = document.getElementById('mod-list');
    const downloadSelectedButton = document.getElementById('download-selected-button');
    const downloadStatus = document.getElementById('download-status');
    const contentContainer = document.getElementById('content-container');

    let instanceName = '';
    let installedMods = [];
    const downloadingModIds = new Set();
    let currentPage = 1;
    let loading = false;
    let currentQuery = null;
    let popularModsLoaded = false; // Track if popular mods have been loaded
    const displayedModIds = new Set(); // Track displayed mod IDs to prevent duplicates

    window.workshopAPI.onSetInstanceName((name) => {
        instanceName = name;
        document.getElementById('instance-name-header').textContent = `Mod Manager for ${name}`;
    });

    window.workshopAPI.onSetInstalledMods((mods) => {
        installedMods = mods;
        updateModCards();
    });

    window.workshopAPI.onDownloadStatusUpdate((status) => {
        if (status.active > 0) {
            downloadStatus.textContent = `Downloading ${status.active} of ${status.total} mods...`;
            downloadStatus.style.display = 'block';
        } else {
            downloadStatus.textContent = '';
            downloadStatus.style.display = 'none';
        }
    });

    function updateModCards() {
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
                downloadingModIds.delete(modId);
            } else if (downloadingModIds.has(modId)) {
                button.textContent = 'Downloading...';
                button.disabled = true;
                if (checkbox) checkbox.disabled = true;
            } else {
                button.textContent = 'Download';
                button.classList.remove('installed');
                button.classList.add('primary');
                button.disabled = false;
                if (checkbox) checkbox.disabled = false;
            }
        });
    }

    function renderMods(mods, append = false) {
        if (!append) {
            modList.innerHTML = '';
            displayedModIds.clear();
        }

        const uniqueMods = mods.filter(mod => !displayedModIds.has(mod.id));

        if (uniqueMods.length === 0 && !append) {
            modList.innerHTML = '<p>No mods found.</p>';
            return;
        }

        uniqueMods.forEach(mod => {
            displayedModIds.add(mod.id);
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
                    <input type="checkbox" class="mod-checkbox" data-mod-id="${mod.id}" data-mod-name="${mod.name}" ${buttonDisabled}>
                    <button class="${buttonClass}" data-mod-id="${mod.id}" data-mod-name="${mod.name}" ${buttonDisabled}>${buttonIcon} ${buttonText}</button>
                </div>
            `;
            modElement.querySelector(".mod-name").addEventListener('click', (event) => {
                event.preventDefault();
                window.electronAPI.openExternalLink(mod.url);
            });
            modList.appendChild(modElement);
        });
        updateModCards();
    }

    async function fetchAndRenderMods(page, query = null) {
        if (loading) return;
        loading = true;
        modList.insertAdjacentHTML('beforeend', '<div class="loading-spinner"></div>');

        try {
            const mods = query
                ? await window.electronAPI.searchWorkshop(query, page)
                : await window.electronAPI.getPopularMods(page);

            renderMods(mods, page > 1 || popularModsLoaded);
            currentPage = page + 1;
            if (!query) {
                popularModsLoaded = true;
            }
        } catch (error) {
            modList.innerHTML = '<p>Failed to load mods. Please try again.</p>';
            console.error('Workshop fetch failed:', error);
        } finally {
            loading = false;
            const spinner = modList.querySelector('.loading-spinner');
            if (spinner) spinner.remove();
        }
    }

    async function handleSearch() {
        const query = searchInput.value.trim();
        modList.innerHTML = '';
        currentPage = 1;
        currentQuery = query;
        popularModsLoaded = false; // Reset popular mods flag
        if (query) {
            await fetchAndRenderMods(currentPage, query);
        } else {
            await fetchAndRenderMods(currentPage);
        }
    }

    searchInput.addEventListener('keyup', async (event) => {
        if (event.key === 'Enter') {
            handleSearch();
        }
    });

    searchButton.addEventListener('click', handleSearch);

    contentContainer.addEventListener('scroll', () => {
        if (popularModsLoaded && !currentQuery && contentContainer.scrollTop + contentContainer.clientHeight >= contentContainer.scrollHeight - 100) {
            fetchAndRenderMods(currentPage);
        }
    });

    modList.addEventListener('click', async (event) => {
        if (event.target.classList.contains('download-mod-button')) {
            const modId = event.target.dataset.modId;
            const modName = event.target.dataset.modName;
            const button = event.target;

            button.textContent = 'Downloading...';
            button.disabled = true;
            const checkbox = button.previousElementSibling;
            if (checkbox) checkbox.disabled = true;
            downloadingModIds.add(modId);

            try {
                await window.electronAPI.downloadMod({ modId, modName, instanceName });
            } catch (error) {
                button.textContent = 'Error';
                button.classList.add('error');
                console.error('Mod download failed:', error);
                downloadingModIds.delete(modId);
            }
        }
    });

    downloadSelectedButton.addEventListener('click', async () => {
        const selectedMods = [];
        document.querySelectorAll('.mod-checkbox:checked').forEach(checkbox => {
            const modId = checkbox.dataset.modId;
            const modName = checkbox.dataset.modName;
            selectedMods.push({ id: modId, name: modName });
            checkbox.disabled = true;
            const button = checkbox.nextElementSibling;
            if (button) {
                button.textContent = 'Downloading...';
                button.disabled = true;
                downloadingModIds.add(modId);
            }
        });

        if (selectedMods.length > 0) {
            await window.electronAPI.downloadMods(selectedMods, instanceName);
        } else {
            alert('Please select at least one mod to download.');
        }
    });

    // Initial load
    fetchAndRenderMods(currentPage);
});