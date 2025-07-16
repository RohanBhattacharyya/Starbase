document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const searchResults = document.getElementById('mod-list');
    let instanceName = '';

    // Use the correct, dedicated API for the workshop window
    window.workshopAPI.onSetInstanceName((name) => {
        instanceName = name;
        document.getElementById('instance-name-header').textContent = `Mod Manager for ${name}`;
    });

    searchButton.addEventListener('click', async () => {
        const query = searchInput.value.trim();
        if (!query) return;

        searchResults.innerHTML = '<div class="loading-spinner"></div>';

        try {
            // Use the main electronAPI for searching
            const mods = await window.electronAPI.searchWorkshop(query);
            searchResults.innerHTML = '';

            if (mods.length === 0) {
                searchResults.innerHTML = '<p>No mods found.</p>';
                return;
            }

            mods.forEach(mod => {
                const modElement = document.createElement('div');
                modElement.className = 'mod-item';
                modElement.innerHTML = `
                    <img src="${mod.imageUrl}" alt="${mod.name}" class="mod-image">
                    <div class="mod-info">
                        <h3 class="mod-name">${mod.name}</h3>
                        <p class="mod-id">ID: ${mod.id}</p>
                        <button class="download-mod-button" data-mod-id="${mod.id}" data-mod-name="${mod.name}">Download</button>
                    </div>
                `;
                searchResults.appendChild(modElement);
            });

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

            try {
                // Pass all necessary info to the main process
                const success = await window.electronAPI.downloadMod({ modId, modName, instanceName });
                if (success) {
                    button.textContent = 'Downloaded';
                    button.classList.add('downloaded');
                } else {
                    button.textContent = 'Error';
                    button.classList.add('error');
                }
            } catch (error) {
                button.textContent = 'Error';
                button.classList.add('error');
                console.error('Mod download failed:', error);
            }
        }
    });
});
