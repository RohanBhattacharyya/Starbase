document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchButton = document.getElementById('search-button');
    const modList = document.getElementById('mod-list');
    const downloadSelectedButton = document.getElementById('download-selected-button');
    const downloadStatus = document.getElementById('download-status');
    const contentContainer = document.getElementById('content-container');
    const collectionDetail = document.getElementById('collection-detail');
    const collectionTitle = document.getElementById('collection-title');
    const collectionSummary = document.getElementById('collection-summary');
    const downloadCollectionButton = document.getElementById('download-collection-button');
    const downloadQueueButton = document.getElementById('download-queue-button');
    const downloadQueueBadge = document.getElementById('download-queue-badge');
    const downloadQueueDialog = document.getElementById('download-queue-dialog');
    const downloadQueueSummary = document.getElementById('download-queue-summary');
    const downloadQueueList = document.getElementById('download-queue-list');

    let instanceName = '';
    let installedMods = [];
    let downloadJobs = new Map();
    let currentKind = 'mod';
    let currentPage = 1;
    let currentQuery = '';
    let loading = false;
    let viewGeneration = 0;
    let hasMore = true;
    let currentCollection = null;
    const displayedIds = new Set();

    const isInstalled = id => installedMods.some(mod => String(mod.id) === String(id));
    const jobFor = id => downloadJobs.get(String(id));
    const isPending = job => job && ['queued', 'downloading', 'retrying'].includes(job.status);

    function renderDownloadQueue(jobs) {
        const sortedJobs = [...jobs];
        const order = { downloading: 0, retrying: 1, queued: 2, failed: 3, completed: 4 };
        sortedJobs.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
        const pending = sortedJobs.filter(isPending).length;
        const completed = sortedJobs.filter(job => job.status === 'completed').length;
        const failed = sortedJobs.filter(job => job.status === 'failed').length;

        downloadQueueButton.hidden = sortedJobs.length === 0;
        downloadQueueBadge.textContent = String(pending);
        downloadQueueSummary.textContent = sortedJobs.length
            ? `${pending} remaining · ${completed} complete${failed ? ` · ${failed} failed` : ''}`
            : 'No mod downloads yet.';
        downloadQueueList.replaceChildren();

        if (!sortedJobs.length) {
            const empty = document.createElement('div');
            empty.className = 'queue-empty';
            empty.textContent = 'This instance has no mod downloads yet.';
            downloadQueueList.appendChild(empty);
            return;
        }

        sortedJobs.forEach(job => {
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
            meta.textContent = `Workshop ${job.modId}${job.attempts > 1 ? ` · attempt ${job.attempts}` : ''}`;
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

    function applyDownloadState(state) {
        const jobs = (state.jobs || []).filter(job => !instanceName || job.instanceName === instanceName);
        downloadJobs = new Map(jobs.map(job => [String(job.modId), job]));
        const pending = jobs.filter(isPending).length;
        const completed = jobs.filter(job => job.status === 'completed').length;
        const failed = jobs.filter(job => job.status === 'failed').length;

        if (pending) {
            downloadStatus.textContent = `${completed} complete · ${pending} remaining${failed ? ` · ${failed} failed` : ''}`;
            downloadStatus.style.display = 'block';
        } else if (failed) {
            downloadStatus.textContent = `${completed} downloaded · ${failed} failed`;
            downloadStatus.style.display = 'block';
        } else {
            downloadStatus.textContent = '';
            downloadStatus.style.display = 'none';
        }
        renderDownloadQueue(jobs);
        updateCards();
    }

    window.workshopAPI.onSetInstanceName(async name => {
        instanceName = name;
        document.getElementById('instance-name-header').textContent = `Mod Manager for ${name}`;
        applyDownloadState(await window.electronAPI.getDownloadState(name));
    });

    window.workshopAPI.onSetInstalledMods(mods => {
        installedMods = mods || [];
        updateCards();
    });

    window.workshopAPI.onDownloadStateUpdate(applyDownloadState);
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

    function setButtonState(button, checkbox, id) {
        const installed = isInstalled(id);
        const job = jobFor(id);
        button.classList.remove('installed', 'downloading', 'error', 'primary');

        if (installed || job?.status === 'completed') {
            button.textContent = 'Installed';
            button.classList.add('installed');
            button.disabled = true;
        } else if (isPending(job)) {
            button.textContent = job.status === 'queued' ? 'Queued' : job.status === 'retrying' ? 'Retrying…' : 'Downloading…';
            button.classList.add('downloading');
            button.disabled = true;
        } else if (job?.status === 'failed') {
            button.textContent = 'Retry';
            button.classList.add('error');
            button.disabled = false;
        } else {
            button.textContent = 'Download';
            button.classList.add('primary');
            button.disabled = false;
        }
        if (checkbox) checkbox.disabled = button.disabled;
    }

    function updateCards() {
        document.querySelectorAll('.mod-card[data-kind="mod"]').forEach(card => {
            setButtonState(
                card.querySelector('.download-mod-button'),
                card.querySelector('.mod-checkbox'),
                card.dataset.id
            );
        });
    }

    function createCard(item) {
        const card = document.createElement('article');
        card.className = 'mod-card';
        card.dataset.id = item.id;
        card.dataset.kind = item.kind;

        const image = document.createElement('img');
        image.className = 'mod-image';
        image.src = item.imageUrl || '';
        image.alt = '';
        image.loading = 'lazy';
        card.appendChild(image);

        const content = document.createElement('div');
        content.className = 'mod-card-content';
        const title = document.createElement('h3');
        title.className = 'mod-name';
        title.textContent = item.name;
        title.title = 'Open on Steam Workshop';
        title.addEventListener('click', () => window.electronAPI.openExternalLink(item.url));
        const id = document.createElement('p');
        id.className = 'mod-id';
        id.textContent = `ID: ${item.id}`;
        content.append(title, id);
        if (item.kind === 'collection') {
            const count = document.createElement('span');
            count.className = 'collection-badge';
            count.textContent = item.itemCount ? `${item.itemCount} items` : 'Workshop collection';
            content.appendChild(count);
        }
        card.appendChild(content);

        const actions = document.createElement('div');
        actions.className = 'mod-card-actions';
        if (item.kind === 'collection') {
            const view = document.createElement('button');
            view.className = 'view-collection-button primary';
            view.dataset.collectionId = item.id;
            view.textContent = 'View Collection';
            actions.appendChild(view);
        } else {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'mod-checkbox';
            checkbox.dataset.modId = item.id;
            checkbox.dataset.modName = item.name;
            checkbox.setAttribute('aria-label', `Select ${item.name}`);
            const button = document.createElement('button');
            button.className = 'download-mod-button';
            button.dataset.modId = item.id;
            button.dataset.modName = item.name;
            setButtonState(button, checkbox, item.id);
            actions.append(checkbox, button);
        }
        card.appendChild(actions);
        return card;
    }

    function renderItems(items, append = false) {
        if (!append) {
            modList.replaceChildren();
            displayedIds.clear();
        }
        const uniqueItems = items.filter(item => !displayedIds.has(String(item.id)));
        uniqueItems.forEach(item => {
            displayedIds.add(String(item.id));
            modList.appendChild(createCard(item));
        });
        if (!append && uniqueItems.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = currentKind === 'collection' ? 'No collections found.' : 'No mods found.';
            modList.appendChild(empty);
        }
    }

    function showError(message) {
        modList.replaceChildren();
        const error = document.createElement('p');
        error.className = 'empty-state';
        error.textContent = message;
        modList.appendChild(error);
    }

    async function fetchPage(page, append = false) {
        if (loading || !hasMore) return;
        const generation = viewGeneration;
        loading = true;
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        modList.appendChild(spinner);
        try {
            const items = currentQuery
                ? await window.electronAPI.searchWorkshop(currentQuery, page, currentKind)
                : await window.electronAPI.getPopularMods(page, currentKind);
            if (generation !== viewGeneration) return;
            spinner.remove();
            renderItems(items, append);
            hasMore = items.length === 20;
            currentPage = page + 1;
        } catch (error) {
            if (generation !== viewGeneration) return;
            console.error('Workshop fetch failed:', error);
            showError(error.message || 'Failed to load Workshop content. Please try again.');
        } finally {
            spinner.remove();
            if (generation === viewGeneration) loading = false;
        }
    }

    async function resetAndLoad() {
        viewGeneration++;
        loading = false;
        currentPage = 1;
        hasMore = true;
        currentCollection = null;
        collectionDetail.hidden = true;
        modList.replaceChildren();
        updatePageControls();
        await fetchPage(1, false);
    }

    function updatePageControls() {
        const viewingCollection = Boolean(currentCollection);
        searchInput.placeholder = currentKind === 'collection'
            ? 'Search collections or paste a collection ID…'
            : 'Search mods or paste a Workshop ID…';
        downloadSelectedButton.style.display = currentKind === 'mod' || viewingCollection ? '' : 'none';
        document.querySelectorAll('.workshop-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.kind === currentKind);
        });
    }

    async function openCollection(collectionId) {
        viewGeneration++;
        const generation = viewGeneration;
        loading = true;
        showError('Loading collection…');
        try {
            const result = await window.electronAPI.getCollection(collectionId);
            if (generation !== viewGeneration) return;
            currentCollection = result;
            collectionTitle.textContent = currentCollection.collection.name;
            collectionSummary.textContent = `${currentCollection.items.length} downloadable mods`;
            downloadCollectionButton.dataset.collectionId = collectionId;
            downloadCollectionButton.disabled = false;
            downloadCollectionButton.textContent = 'Download Collection';
            collectionDetail.hidden = false;
            renderItems(currentCollection.items, false);
            contentContainer.scrollTop = 0;
            updatePageControls();
        } catch (error) {
            if (generation !== viewGeneration) return;
            currentCollection = null;
            collectionDetail.hidden = true;
            showError(error.message || 'Unable to open this collection.');
        } finally {
            if (generation === viewGeneration) loading = false;
        }
    }

    async function queueMod(modId, modName) {
        try {
            await window.electronAPI.downloadMod({ modId, modName, instanceName });
            applyDownloadState(await window.electronAPI.getDownloadState(instanceName));
        } catch (error) {
            downloadStatus.textContent = `Could not queue ${modName}: ${error.message}`;
            downloadStatus.style.display = 'block';
        }
    }

    searchInput.addEventListener('keyup', event => {
        if (event.key === 'Enter') searchButton.click();
    });

    searchButton.addEventListener('click', async () => {
        currentQuery = searchInput.value.trim();
        await resetAndLoad();
    });

    document.querySelectorAll('.workshop-tab').forEach(tab => {
        tab.addEventListener('click', async () => {
            if (tab.dataset.kind === currentKind && !currentCollection) return;
            currentKind = tab.dataset.kind;
            currentQuery = '';
            searchInput.value = '';
            await resetAndLoad();
        });
    });

    document.getElementById('back-to-collections').addEventListener('click', resetAndLoad);

    contentContainer.addEventListener('scroll', () => {
        if (!currentCollection && contentContainer.scrollTop + contentContainer.clientHeight >= contentContainer.scrollHeight - 120) {
            fetchPage(currentPage, true);
        }
    });

    modList.addEventListener('click', event => {
        const downloadButton = event.target.closest('.download-mod-button');
        if (downloadButton) {
            queueMod(downloadButton.dataset.modId, downloadButton.dataset.modName);
            return;
        }
        const collectionButton = event.target.closest('.view-collection-button');
        if (collectionButton) openCollection(collectionButton.dataset.collectionId);
    });

    downloadSelectedButton.addEventListener('click', async () => {
        const selected = Array.from(document.querySelectorAll('.mod-checkbox:checked')).map(checkbox => ({
            id: checkbox.dataset.modId,
            name: checkbox.dataset.modName
        }));
        if (!selected.length) {
            downloadStatus.textContent = 'Select at least one mod first.';
            downloadStatus.style.display = 'block';
            return;
        }
        try {
            await window.electronAPI.downloadMods(selected, instanceName);
            applyDownloadState(await window.electronAPI.getDownloadState(instanceName));
        } catch (error) {
            downloadStatus.textContent = `Could not queue downloads: ${error.message}`;
            downloadStatus.style.display = 'block';
        }
    });

    downloadCollectionButton.addEventListener('click', async () => {
        const collectionId = downloadCollectionButton.dataset.collectionId;
        downloadCollectionButton.disabled = true;
        downloadCollectionButton.textContent = 'Adding to queue…';
        try {
            const result = await window.electronAPI.downloadCollection(collectionId, instanceName);
            downloadCollectionButton.textContent = result.added ? `${result.added} mods queued` : 'Already downloaded or queued';
            applyDownloadState(await window.electronAPI.getDownloadState(instanceName));
        } catch (error) {
            downloadCollectionButton.textContent = `Could not queue collection`;
            downloadCollectionButton.disabled = false;
            console.error('Collection download failed:', error);
        }
    });

    updatePageControls();
    resetAndLoad();
});
