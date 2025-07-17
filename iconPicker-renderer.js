document.addEventListener('DOMContentLoaded', () => {
    const iconSearchInput = document.getElementById('icon-search-input');
    const iconGrid = document.getElementById('icon-grid');
    const selectButton = document.getElementById('select-button');
    const cancelButton = document.getElementById('cancel-button');

    let selectedIcon = null;

    // A small subset of Font Awesome icons for demonstration
    const allIcons = [
    'fa-solid fa-rocket', 'fa-solid fa-star', 'fa-solid fa-gamepad', 'fa-solid fa-folder',
    'fa-solid fa-code', 'fa-solid fa-bug', 'fa-solid fa-cogs', 'fa-solid fa-wrench',
    'fa-solid fa-terminal', 'fa-solid fa-server', 'fa-solid fa-cloud', 'fa-solid fa-database',
    'fa-solid fa-cube', 'fa-solid fa-flask', 'fa-solid fa-lightbulb', 'fa-solid fa-fire',
    'fa-solid fa-bolt', 'fa-solid fa-leaf', 'fa-solid fa-tree', 'fa-solid fa-mountain',
    'fa-solid fa-water', 'fa-solid fa-sun', 'fa-solid fa-moon', 'fa-solid fa-car',
    'fa-solid fa-plane', 'fa-solid fa-ship', 'fa-solid fa-bicycle', 'fa-solid fa-robot',
    'fa-solid fa-user-astronaut', 'fa-solid fa-ghost', 'fa-solid fa-dragon', 'fa-solid fa-cat',
    'fa-solid fa-dog', 'fa-solid fa-fish', 'fa-solid fa-spider', 'fa-solid fa-crow',
    'fa-solid fa-frog', 'fa-solid fa-otter', 'fa-solid fa-hippo', 'fa-solid fa-horse',
    'fa-solid fa-cow', 'fa-solid fa-pig', 'fa-solid fa-sheep', 'fa-solid fa-mouse',
    'fa-solid fa-keyboard', 'fa-solid fa-headphones', 'fa-solid fa-microphone', 'fa-solid fa-camera',
    'fa-solid fa-video', 'fa-solid fa-image', 'fa-solid fa-music', 'fa-solid fa-film',
    'fa-solid fa-book', 'fa-solid fa-map', 'fa-solid fa-globe', 'fa-solid fa-compass',
    'fa-solid fa-bell', 'fa-solid fa-heart', 'fa-solid fa-thumbs-up', 'fa-solid fa-thumbs-down',
    'fa-solid fa-smile', 'fa-solid fa-frown', 'fa-solid fa-meh', 'fa-solid fa-grin',
    'fa-solid fa-angry', 'fa-solid fa-surprise', 'fa-solid fa-tired', 'fa-solid fa-dizzy',
    'fa-solid fa-skull', 'fa-solid fa-bomb', 'fa-solid fa-gavel', 'fa-solid fa-balance-scale',
    'fa-solid fa-shield-alt', 'fa-solid fa-lock', 'fa-solid fa-unlock', 'fa-solid fa-key',
    'fa-solid fa-hammer', 'fa-solid fa-screwdriver', 'fa-solid fa-toolbox', 'fa-solid fa-tools',
    'fa-solid fa-paint-brush', 'fa-solid fa-palette', 'fa-solid fa-ruler', 'fa-solid fa-pencil-alt',
    'fa-solid fa-eraser', 'fa-solid fa-cut', 'fa-solid fa-copy', 'fa-solid fa-paste',
    'fa-solid fa-save', 'fa-solid fa-upload', 'fa-solid fa-download', 'fa-solid fa-print',
    'fa-solid fa-share-alt', 'fa-solid fa-plus', 'fa-solid fa-minus', 'fa-solid fa-times',
    'fa-solid fa-check', 'fa-solid fa-question', 'fa-solid fa-info', 'fa-solid fa-exclamation',
    'fa-solid fa-home', 'fa-solid fa-building', 'fa-solid fa-city', 'fa-solid fa-industry',
    'fa-solid fa-store', 'fa-solid fa-shopping-cart', 'fa-solid fa-credit-card', 'fa-solid fa-wallet',
    'fa-solid fa-chart-line', 'fa-solid fa-calendar-alt', 'fa-solid fa-clock', 'fa-solid fa-history',
    'fa-solid fa-trash-alt', 'fa-solid fa-archive', 'fa-solid fa-box', 'fa-solid fa-boxes',
    'fa-solid fa-warehouse', 'fa-solid fa-truck', 'fa-solid fa-truck-moving', 'fa-solid fa-users',
    'fa-solid fa-user-plus', 'fa-solid fa-user-minus', 'fa-solid fa-phone', 'fa-solid fa-envelope',
    'fa-solid fa-comments', 'fa-solid fa-list', 'fa-solid fa-bold', 'fa-solid fa-italic',
    'fa-solid fa-underline', 'fa-solid fa-language', 'fa-solid fa-map-marker-alt', 'fa-solid fa-road',
    'fa-solid fa-tractor', 'fa-solid fa-egg', 'fa-solid fa-carrot', 'fa-solid fa-pizza-slice',
    'fa-solid fa-hamburger', 'fa-solid fa-coffee', 'fa-solid fa-wine-glass', 'fa-solid fa-utensils',
    'fa-solid fa-apple-whole', 'fa-solid fa-lemon', 'fa-solid fa-orange', 'fa-solid fa-seedling',
    'fa-solid fa-hospital', 'fa-solid fa-microscope', 'fa-solid fa-dna', 'fa-solid fa-atom',
    'fa-solid fa-virus', 'fa-solid fa-bacteria', 'fa-solid fa-disease', 'fa-solid fa-mosquito',
   ];

    function renderIcons(filter = '') {
        iconGrid.innerHTML = '';
        const filteredIcons = allIcons.filter(icon => icon.includes(filter.toLowerCase()));

        if (filteredIcons.length === 0) {
            iconGrid.innerHTML = '<p>No icons found matching your search.</p>';
            return;
        }

        filteredIcons.forEach(iconClass => {
            const iconElement = document.createElement('div');
            iconElement.className = `icon-card ${selectedIcon === iconClass ? 'selected' : ''}`;
            iconElement.innerHTML = `<i class="fas ${iconClass}"></i><p>${iconClass.replace('fa-', '')}</p>`;
            iconElement.dataset.iconClass = iconClass;
            iconGrid.appendChild(iconElement);
        });
    }

    iconSearchInput.addEventListener('input', (event) => {
        renderIcons(event.target.value);
    });

    iconGrid.addEventListener('click', (event) => {
        let target = event.target;
        // Traverse up to find the .icon-card if a child element was clicked
        while (target && !target.classList.contains('icon-card')) {
            target = target.parentNode;
        }

        if (target && target.classList.contains('icon-card')) {
            // Remove selected class from previously selected icon
            if (selectedIcon) {
                const prevSelected = iconGrid.querySelector(`.icon-card[data-icon-class="${selectedIcon}"]`);
                if (prevSelected) {
                    prevSelected.classList.remove('selected');
                }
            }

            selectedIcon = target.dataset.iconClass;
            target.classList.add('selected');
            selectButton.disabled = false;
        }
    });

    selectButton.addEventListener('click', () => {
        if (selectedIcon) {
            window.iconPickerAPI.sendSelectedIcon(selectedIcon);
        }
    });

    cancelButton.addEventListener('click', () => {
        window.iconPickerAPI.sendSelectedIcon(null);
    });

    // Initial render
    renderIcons();
});