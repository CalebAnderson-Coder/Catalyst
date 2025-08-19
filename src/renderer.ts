const { ipcRenderer } = require('electron');

const extractBtn = document.getElementById('extract-btn');
const urlInput = document.getElementById('url') as HTMLInputElement;

if (extractBtn) {
  extractBtn.addEventListener('click', () => {
    const url = urlInput.value;
    if (url) {
      ipcRenderer.send('extract-data', url);
    }
  });
}
