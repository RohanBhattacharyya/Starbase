const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const inputElement = document.getElementById('dialog-input');
    const okButton = document.getElementById('ok-button');
    const cancelButton = document.getElementById('cancel-button');
    const messageElement = document.getElementById('dialog-message');

    // Receive options from main process
    ipcRenderer.on('set-dialog-options', (event, options) => {
        if (options.message) {
            messageElement.textContent = options.message;
        }
        if (options.placeholder) {
            inputElement.placeholder = options.placeholder;
        }
        if (options.defaultValue) {
            inputElement.value = options.defaultValue;
        }
    });

    okButton.addEventListener('click', () => {
        ipcRenderer.send('dialog-response', { value: inputElement.value, canceled: false });
    });

    cancelButton.addEventListener('click', () => {
        ipcRenderer.send('dialog-response', { value: null, canceled: true });
    });

    inputElement.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            ipcRenderer.send('dialog-response', { value: inputElement.value, canceled: false });
        }
    });
});
