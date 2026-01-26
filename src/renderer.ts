const { ipcRenderer } = require('electron');

const extractBtn = document.getElementById('extract-btn') as HTMLButtonElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const brandSelect = document.getElementById('brand-select') as HTMLSelectElement;
const campaignInput = document.getElementById('campaign-input') as HTMLInputElement;
const statusBar = document.getElementById('status-bar') as HTMLDivElement;
const nodeVersion = document.getElementById('node-version');
const electronVersion = document.getElementById('electron-version');

// Expose versions
if (nodeVersion) nodeVersion.innerText = process.versions.node;
if (electronVersion) electronVersion.innerText = process.versions.electron;

function showStatus(message: string, type: 'success' | 'error' | 'info') {
  if (statusBar) {
    statusBar.textContent = message;
    statusBar.className = `status-bar status ${type}`;
    statusBar.style.display = 'block';

    if (type !== 'info') { // Auto-hide success/error
      setTimeout(() => {
        statusBar.style.display = 'none';
      }, 5000);
    }
  }
}

function setLoading(isLoading: boolean) {
  if (extractBtn) {
    extractBtn.disabled = isLoading;
    if (isLoading) {
      extractBtn.classList.add('loading');
    } else {
      extractBtn.classList.remove('loading');
    }
  }
  if (downloadBtn) downloadBtn.disabled = isLoading;
}

function getFormData() {
  const brandValue = brandSelect.value;
  const brandText = brandSelect.options[brandSelect.selectedIndex].text;
  const campaignNumber = campaignInput.value.trim();
  const consultantID = 'YacomarOrtiz1';

  if (brandValue && campaignNumber) {
    const campaign = `2026${campaignNumber}`;
    const url = `https://catalogo.somosbelcorp.com/co/${consultantID}/${brandValue}/pages/1`;
    return { url, campaign, brand: brandText, campaignNumber };
  } else {
    showStatus('⚠️ Selecciona una marca y escribe el número de campaña.', 'error');
    return null;
  }
}

if (extractBtn) {
  extractBtn.addEventListener('click', () => {
    const data = getFormData();
    if (data) {
      setLoading(true);
      showStatus('Iniciando extracción...', 'info');
      ipcRenderer.send('extract-data', data);
    }
  });
}

if (downloadBtn) {
  downloadBtn.addEventListener('click', () => {
    const data = getFormData();
    if (data) {
      setLoading(true);
      showStatus('Iniciando descarga de imágenes...', 'info');
      ipcRenderer.send('download-images', data);
    }
  });
}

// IPC Listeners
ipcRenderer.on('extract-complete', () => {
  setLoading(false);
  showStatus('✅ Extracción completada exitosamente.', 'success');
});

ipcRenderer.on('extract-error', (event: any, message: string) => {
  setLoading(false);
  showStatus(`❌ ${message || 'Error durante la extracción.'}`, 'error');
});

ipcRenderer.on('download-complete', () => {
  setLoading(false);
  showStatus('✅ Imágenes descargadas exitosamente.', 'success');
});

ipcRenderer.on('download-error', (event: any, message: string) => {
  setLoading(false);
  showStatus(`❌ ${message || 'Error durante la descarga.'}`, 'error');
});
