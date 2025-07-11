document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const modList = document.getElementById('mod-list');
    let currentInstanceName = null; // To store the instance name passed from the main window

    // Listen for the instance name from the main process
    window.ipcRenderer.on('set-instance-name', (event, instanceName) => {
        currentInstanceName = instanceName;
        console.log(`Workshop window received instance name: ${currentInstanceName}`);
    });

    searchButton.addEventListener('click', async () => {
        const query = searchInput.value;
        if (query) {
            modList.innerHTML = '<p>Searching for mods...</p>';
            try {
                const mods = await window.electronAPI.searchWorkshop(query);
                if (mods.length > 0) {
                    modList.innerHTML = ''; // Clear previous message
                    mods.forEach(mod => displayMod(mod));
                } else {
                    modList.innerHTML = '<p>No mods found for your search.</p>';
                }
            } catch (error) {
                modList.innerHTML = `<p>Error searching for mods: ${error.message}</p>`;
                console.error('Error searching workshop:', error);
            }
        }
    });

    function displayMod(mod) {
        const modCard = document.createElement('div');
        modCard.classList.add('mod-card');
        modCard.innerHTML = `
            <img src="${mod.imageUrl}" alt="${mod.name}">
            <div class="mod-card-content">
                <h3>${mod.name}</h3>
                <p>${mod.description}</p>
            </div>
            <div class="mod-card-actions">
                <button data-mod-id="${mod.id}" class="download-mod-button">Download</button>
            </div>
        `;
        modList.appendChild(modCard);

        modCard.querySelector('.download-mod-button').addEventListener('click', async (event) => {
            const modId = event.target.dataset.modId;
            if (!currentInstanceName) {
                alert('Please select an instance in the main window before downloading mods.');
                return;
            }
            event.target.disabled = true;
            event.target.textContent = 'Downloading...';
            try {
                const success = await window.electronAPI.downloadMod(modId, currentInstanceName);
                if (success) {
                    event.target.textContent = 'Downloaded!';
                    event.target.style.backgroundColor = '#28a745'; // Green
                } else {
                    event.target.textContent = 'Failed';
                    event.target.style.backgroundColor = '#dc3545'; // Red
                }
            } catch (error) {
                event.target.textContent = 'Error';
                event.target.style.backgroundColor = '#dc3545'; // Red
                console.error('Error downloading mod:', error);
            }
        });
    }
});
