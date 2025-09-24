import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';
import * as XLSX from 'xlsx';

async function handleExtractData(event: Electron.IpcMainEvent, data: { url: string; campaign: string; brand: string; campaignNumber: string; }) {
  const { url, campaign, brand, campaignNumber } = data;
  const defaultPath = `${brand.replace("'", "")} C${campaignNumber}.xlsx`;

  const { filePath } = await dialog.showSaveDialog({
    buttonLabel: 'Guardar Excel',
    defaultPath: defaultPath,
  });

  if (filePath) {
    try {
      const browser = await puppeteer.launch();
      const page = await browser.newPage();

      await page.setRequestInterception(true);

      let products: any[] = [];
      let productsFound = false;

      page.on('request', (request) => {
        const requestUrl = request.url();
        if (requestUrl.includes('graphql') && request.method() === 'POST') {
          const postData = JSON.parse(request.postData() || '[]');
          if (postData[0].operationName === 'getCatalog') {
            postData[0].variables.campaignCode = campaign;
            request.continue({
              postData: JSON.stringify(postData),
            });
            return;
          }
        }
        request.continue();
      });

      page.on('response', async (response) => {
        const request = response.request();
        const requestUrl = request.url();

        if (requestUrl.includes('graphql') && request.method() === 'POST') {
          try {
            const postData = JSON.parse(request.postData() || '[]');
            if (postData[0].operationName === 'getCatalog') {
              const data = await response.json();
              if (data[0].data && data[0].data.catalog && data[0].data.catalog.pages) {
                const pages = data[0].data.catalog.pages;
                pages.forEach((pageData: any) => {
                  if (pageData.products) {
                    pageData.products.forEach((product: any) => {
                      let promotion = 'No';
                      if (product.pricing.offerPrice < product.pricing.normalPrice) {
                        promotion = 'Sí';
                        if (product.strategySummary && product.strategySummary.seal) {
                          promotion = `Sí (${product.strategySummary.seal})`;
                        }
                      }
                      products.push({
                        'Página': pageData.order,
                        'Código': product.cuv,
                        'Nombre y descripción': `${product.name} - ${product.description}`,
                        'Promoción': promotion,
                        'Precio': product.pricing.offerPrice || product.pricing.normalPrice,
                        'Categoría': product.category ? product.category.name : '',
                        'Marca': product.brand ? product.brand.name : '',
                        'Precio Normal': product.pricing.normalPrice,
                        'URL de la Imagen': product.images ? product.images.main : '',
                      });
                    });
                  }
                });
                productsFound = true;
              }
            }
          } catch (error) {
            // Ignore errors
          }
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2' });

      if (!productsFound) {
        // Wait for a bit longer if products are not found immediately
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      if (!productsFound) {
        dialog.showErrorBox('Error', 'No se pudo encontrar la API de productos o los datos están en un formato inesperado.');
      }

      await browser.close();

      const worksheet = XLSX.utils.json_to_sheet(products);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Catálogo');
      XLSX.writeFile(workbook, filePath);

      dialog.showMessageBox({
        title: 'Éxito',
        message: `Datos guardados en ${filePath}`,
      });
    } catch (error) {
      console.error(error);
      dialog.showErrorBox('Error', 'No se pudieron extraer los datos.');
    }
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

async function handleDownloadImages(event: Electron.IpcMainEvent, data: { url: string; campaign: string; }) {
  const { url, campaign } = data;

  const { filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    buttonLabel: 'Seleccionar Carpeta',
  });

  if (filePaths && filePaths.length > 0) {
    const saveDir = filePaths[0];
    try {
      dialog.showMessageBox({ title: 'Iniciando', message: 'Iniciando descarga de imágenes. Esto puede tardar varios minutos...' });

      const browser = await puppeteer.launch();
      const page = await browser.newPage();
      await page.setRequestInterception(true);

      let allPageImages: any[] = [];
      let imagesFound = false;

      page.on('request', (request) => {
        if (request.url().includes('graphql') && request.method() === 'POST') {
          const postData = JSON.parse(request.postData() || '[]');
          if (postData[0].operationName === 'getCatalog') {
            postData[0].variables.campaignCode = campaign;
            request.continue({ postData: JSON.stringify(postData) });
            return;
          }
        }
        request.continue();
      });

      page.on('response', async (response) => {
        if (response.url().includes('graphql') && response.request().method() === 'POST') {
          try {
            const postData = JSON.parse(response.request().postData() || '[]');
            if (postData[0].operationName === 'getCatalog') {
              const data = await response.json();
              if (data[0].data?.catalog?.pages) {
                data[0].data.catalog.pages.forEach((pageData: any) => {
                  if (pageData.images && pageData.images.double) {
                    allPageImages.push({
                      imageUrl: pageData.images.double,
                      fileName: `Pagina_${String(pageData.order).padStart(2, '0')}.jpg`,
                    });
                  }
                });
                imagesFound = true;
              }
            }
          } catch (e) { /* Ignore parsing errors */ }
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2' });
      if (!imagesFound) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      if (!imagesFound) {
        throw new Error('No se pudo encontrar la información de las imágenes de página.');
      }

      for (let i = 0; i < allPageImages.length; i++) {
        const pageImage = allPageImages[i];
        try {
          const imagePage = await browser.newPage();
          const imageResponse = await imagePage.goto(pageImage.imageUrl);
          if (imageResponse) {
            const buffer = await imageResponse.buffer();
            fs.writeFileSync(path.join(saveDir, pageImage.fileName), buffer);
          }
          await imagePage.close();
        } catch (e) {
          console.error(`No se pudo descargar ${pageImage.imageUrl}: ${e}`);
        }
      }

      await browser.close();
      dialog.showMessageBox({ title: 'Éxito', message: `Se descargaron ${allPageImages.length} imágenes en ${saveDir}` });

    } catch (error) {
      console.error(error);
      dialog.showErrorBox('Error', `No se pudieron descargar las imágenes. ${error}`);
    }
  }
}

app.on('ready', () => {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  ipcMain.on('extract-data', handleExtractData);
  ipcMain.on('download-images', handleDownloadImages);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
