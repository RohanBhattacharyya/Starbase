document.addEventListener('DOMContentLoaded', () => {
    const inputElement = document.getElementById('dialog-input');
    const okButton = document.getElementById('ok-button');
    const cancelButton = document.getElementById('cancel-button');
    const messageElement = document.getElementById('dialog-message');

    // Receive options from main process using the exposed API
    window.inputDialogAPI.onSetOptions((event, options) => {
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
        window.inputDialogAPI.sendResponse({ value: inputElement.value, canceled: false });
    });

    cancelButton.addEventListener('click', () => {
        window.inputDialogAPI.sendResponse({ value: null, canceled: true });
    });

    inputElement.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            window.inputDialogAPI.sendResponse({ value: inputElement.value, canceled: false });
        }
    });
});
