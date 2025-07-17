document.addEventListener('DOMContentLoaded', () => {
    console.log('inputDialog-renderer.js loaded');

    const inputElement = document.getElementById('dialog-input');
    const descriptionElement = document.getElementById('description-input');
    const okButton = document.getElementById('ok-button');
    const cancelButton = document.getElementById('cancel-button');
    const messageElement = document.getElementById('dialog-message');
    const versionSelect = document.getElementById('version-select');
    const pickIconButton = document.getElementById('pick-icon-button');
    const selectedIconPreview = document.getElementById('selected-icon-preview');

    let currentSelectedIcon = 'fa-rocket'; // Default icon

    if (window.inputDialogAPI) {
        window.inputDialogAPI.onSetOptions(async (options) => {
            console.log('Received dialog options:', options);

            if (options.title) {
                document.title = options.title;
            }

            if (options.message) {
                messageElement.textContent = options.message;
            } else {
                messageElement.style.display = 'none'; // Hide if no message
            }

            if (options.isConfirmation) {
                inputElement.style.display = 'none';
                descriptionElement.style.display = 'none';
                versionSelect.style.display = 'none';
                pickIconButton.style.display = 'none';
                selectedIconPreview.style.display = 'none';
            } else {
                inputElement.style.display = 'block';
                inputElement.placeholder = options.placeholder || 'Enter value';
                inputElement.value = options.value || '';

                if (options.descriptionPlaceholder !== undefined) {
                    descriptionElement.style.display = 'block';
                    descriptionElement.placeholder = options.descriptionPlaceholder || '';
                    descriptionElement.value = options.descriptionValue || '';
                } else {
                    descriptionElement.style.display = 'none';
                }

                // Icon picker setup
                pickIconButton.style.display = 'inline-flex';
                selectedIconPreview.style.display = 'inline-block';
                currentSelectedIcon = options.icon || 'fa-rocket';
                selectedIconPreview.className = `fas ${currentSelectedIcon}`;
            }

            if (options.versions && options.versions.length > 0) {
                versionSelect.style.display = 'block';
                versionSelect.innerHTML = ''; // Clear previous options
                options.versions.forEach(version => {
                    const option = document.createElement('option');
                    option.value = version.tag;
                    option.textContent = version.name;
                    versionSelect.appendChild(option);
                });
            } else {
                versionSelect.style.display = 'none';
            }
        });

        pickIconButton.addEventListener('click', async () => {
            const selected = await window.electronAPI.openIconPickerDialog(currentSelectedIcon);
            if (selected) {
                currentSelectedIcon = selected;
                selectedIconPreview.className = `fas ${currentSelectedIcon}`;
            }
        });
    } else {
        console.error('window.inputDialogAPI is NOT defined!');
    }

    if (okButton) {
        okButton.addEventListener('click', () => {
            console.log('OK button clicked');
            let responseValue = inputElement.value;
            let responseDescription = descriptionElement.value;
            let selectedVersion = null;

            if (versionSelect.style.display === 'block' && versionSelect.value) {
                selectedVersion = {
                    tag: versionSelect.value,
                    name: versionSelect.options[versionSelect.selectedIndex].text
                };
            }

            window.inputDialogAPI.sendResponse({
                value: responseValue,
                description: responseDescription,
                version: selectedVersion,
                icon: currentSelectedIcon,
                canceled: false
            });
        });
    }

    if (cancelButton) {
        cancelButton.addEventListener('click', () => {
            console.log('Cancel button clicked');
            window.inputDialogAPI.sendResponse({ value: null, version: null, canceled: true });
        });
    }

    if (inputElement) {
        inputElement.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                console.log('Enter key pressed');
                let responseValue = inputElement.value;
                let responseDescription = descriptionElement.value;
                let selectedVersion = null;

                if (versionSelect.style.display === 'block' && versionSelect.value) {
                    selectedVersion = {
                        tag: versionSelect.value,
                        name: versionSelect.options[versionSelect.selectedIndex].text
                    };
                }
                window.inputDialogAPI.sendResponse({
                    value: responseValue,
                    description: responseDescription,
                    version: selectedVersion,
                    icon: currentSelectedIcon,
                    canceled: false
                });
            }
        });
    }
});