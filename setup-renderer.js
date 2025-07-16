
document.addEventListener('DOMContentLoaded', () => {
    const selectPakButton = document.getElementById('select-pak-button');

    if (selectPakButton) {
        selectPakButton.addEventListener('click', async () => {
            if (window.electronAPI) {
                await window.electronAPI.selectPak();
            } else {
                console.error('electronAPI not found. Check preload script.');
            }
        });
    }
});
