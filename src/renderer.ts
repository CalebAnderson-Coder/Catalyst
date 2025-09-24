const { ipcRenderer } = require('electron');

const extractBtn = document.getElementById('extract-btn');
const downloadBtn = document.getElementById('download-btn');
const brandSelect = document.getElementById('brand-select') as HTMLSelectElement;
const campaignInput = document.getElementById('campaign-input') as HTMLInputElement;

function getFormData() {
  const brandValue = brandSelect.value;
  const brandText = brandSelect.options[brandSelect.selectedIndex].text;
  const campaignNumber = campaignInput.value;
  const consultantID = 'YacomarOrtiz1'; // As requested

  if (brandValue && campaignNumber) {
    const campaign = `2025${campaignNumber}`;
    const url = `https://catalogo.somosbelcorp.com/co/${consultantID}/${brandValue}/pages/1`;
    return { url, campaign, brand: brandText, campaignNumber };
  } else {
    alert('Por favor, seleccione una marca e ingrese un número de campaña.');
    return null;
  }
}

if (extractBtn) {
  extractBtn.addEventListener('click', () => {
    const data = getFormData();
    if (data) {
      ipcRenderer.send('extract-data', data);
    }
  });
}

if (downloadBtn) {
  downloadBtn.addEventListener('click', () => {
    const data = getFormData();
    if (data) {
      ipcRenderer.send('download-images', data);
    }
  });
}
