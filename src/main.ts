import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';
import * as XLSX from 'xlsx';

// Constant for the Deep Extraction GraphQL hash
const PRODUCT_DETAIL_HASH = "530a74eda27af4dd42ba9efe9106fc1df02726f1c86d8b56036d9f6ca2ce652d";

async function handleExtractData(event: Electron.IpcMainEvent, data: { url: string; campaign: string; brand: string; campaignNumber: string; }) {
  const { url, campaign, brand, campaignNumber } = data;
  const defaultPath = `${brand.replace("'", "")} C${campaignNumber}.xlsx`;

  const { filePath } = await dialog.showSaveDialog({
    buttonLabel: 'Guardar Excel',
    defaultPath: defaultPath,
  });

  if (filePath) {
    try {
      const browser = await puppeteer.launch({ headless: true, pipe: true });
      const page = await browser.newPage();

      await page.setRequestInterception(true);

      let products: any[] = [];
      let productsFound = false;
      let rawCatalogPages: any[] = [];

      page.on('request', (request) => {
        const requestUrl = request.url();
        if (requestUrl.includes('graphql') && request.method() === 'POST') {
          try {
            const postData = JSON.parse(request.postData() || '[]');
            const queries = Array.isArray(postData) ? postData : [postData];

            // Fix campaign code in getCatalog requests
            let modified = false;
            queries.forEach((q: any) => {
              if (q.operationName === 'getCatalog') {
                q.variables.campaignCode = campaign;
                modified = true;
              }
            });

            if (modified) {
              request.continue({ postData: JSON.stringify(postData) });
              return;
            }
          } catch (e) { }
        }
        request.continue();
      });

      page.on('response', async (response) => {
        const request = response.request();
        if (request.url().includes('graphql') && request.method() === 'POST') {
          try {
            const postData = JSON.parse(request.postData() || '[]');
            const queries = Array.isArray(postData) ? postData : [postData];
            const isCatalog = queries.some((q: any) => q.operationName === 'getCatalog');

            if (isCatalog) {
              const resJson = await response.json();
              const responseData = Array.isArray(resJson) ? resJson[0] : resJson;

              if (responseData?.data?.catalog?.pages) {
                rawCatalogPages = responseData.data.catalog.pages;
                productsFound = true;
              }
            }
          } catch (error) { }
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2' });

      // Wait for catalog data to be captured
      if (!productsFound) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      if (productsFound) {
        console.log(`>>> CATALOG CAPTURED. PROCESSING ${rawCatalogPages.length} PAGES...`);
        const processedCuves = new Set<string>();
        const finalResults: any[] = [];

        for (const pageData of rawCatalogPages) {
          if (!pageData.products) continue;

          for (const product of pageData.products) {
            const cuv = product.cuv || product.code;
            if (processedCuves.has(cuv)) continue;
            processedCuves.add(cuv);

            // Determine if we need deep extraction
            if (product.hasVariants) {
              console.log(`>>> FETCHING VARIANTS FOR: ${product.name} (${cuv})`);
              try {
                // Correct Endpoint
                const API_ENDPOINT = 'https://catalogodigital.somosbelcorp.com/api/graphql';

                const detailResponse = await page.evaluate(async (cuv, campaign, brandCode, hash, endpoint) => {
                  try {
                    // Try with Hash first (Standard)
                    let response = await fetch(endpoint, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify([{
                        operationName: 'getProductLinkedTactic',
                        variables: {
                          skipCondition: false, skipGifts: false, skipOffers: false, skipProducts: false,
                          withVariants: true, countryCode: "CO", campaignCode: campaign, brandCode: brandCode, cuv: cuv
                        },
                        extensions: { persistedQuery: { version: 1, sha256Hash: hash } }
                      }])
                    });

                    // If Hash fails (400/404/500), try Ad-Hoc Query
                    if (!response.ok) {
                      console.warn(`[DeepExtract] Hash failed (${response.status}), trying Ad-Hoc query...`);

                      const adHocQuery = `
                          query SimpleProduct($countryCode: CountryCode!, $campaignCode: String!, $brandCode: BrandCode!, $cuv: String!) {
                            product(countryCode: $countryCode, campaignCode: $campaignCode, brandCode: $brandCode, cuv: $cuv) {
                              name
                              cuv
                              description
                              pricing {
                                normalPrice
                                offerPrice
                              }
                              variants {
                                cuv
                                name
                                code
                                description
                                pricing {
                                  normalPrice
                                  offerPrice
                                }
                                images {
                                  main
                                  variant
                                }
                              }
                            }
                          }
                        `;

                      response = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify([{
                          operationName: 'SimpleProduct',
                          variables: {
                            countryCode: "CO",
                            campaignCode: campaign,
                            brandCode: brandCode,
                            cuv: cuv
                          },
                          query: adHocQuery
                        }])
                      });
                    }

                    if (!response.ok) {
                      return { error: `HTTP ${response.status}`, cuv };
                    }

                    return await response.json();
                  } catch (e: any) {
                    return { error: e.message, cuv };
                  }
                }, cuv, campaign, product.brand?.code || 'E', PRODUCT_DETAIL_HASH, API_ENDPOINT);

                if (detailResponse.error) {
                  console.error(`>>> FETCH ERROR FOR ${cuv}:`, detailResponse.error);
                  finalResults.push(mapProductToRow(product, pageData.order));
                  continue;
                }

                const detailData = Array.isArray(detailResponse) ? detailResponse[0] : detailResponse;
                const variants = detailData?.data?.product?.variants || [];

                if (variants.length > 0) {
                  console.log(`>>> FOUND ${variants.length} VARIANTS`);
                  variants.forEach((v: any) => {
                    finalResults.push(mapProductToRow(v, pageData.order));
                  });
                } else {
                  // Fallback to base product if no variants in detail response
                  finalResults.push(mapProductToRow(product, pageData.order));
                }
              } catch (err) {
                console.error(`Error fetching variants for ${cuv}:`, err);
                finalResults.push(mapProductToRow(product, pageData.order));
              }
            } else {
              finalResults.push(mapProductToRow(product, pageData.order));
            }
          }
        }
        products = finalResults;
      }

      await browser.close();

      const worksheet = XLSX.utils.json_to_sheet(products);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Catálogo');
      XLSX.writeFile(workbook, filePath);

      dialog.showMessageBox({ title: 'Éxito', message: `Datos guardados en ${filePath}` });
      event.sender.send('extract-complete');
    } catch (error: any) {
      console.error(error);
      dialog.showErrorBox('Error', 'No se pudieron extraer los datos.');
      event.sender.send('extract-error', error.message || 'Error desconocido');
    }
  } else {
    event.sender.send('extract-complete');
  }
}

// Helper to map product data to Excel row format
function mapProductToRow(product: any, pageOrder: number) {
  let promotion = 'No';
  const priceObj = product.pricing;

  if (priceObj && priceObj.offerPrice < priceObj.normalPrice) {
    promotion = 'Sí';
    if (product.strategySummary && product.strategySummary.seal) {
      promotion = `Sí (${product.strategySummary.seal})`;
    }
  }

  return {
    'Página': pageOrder,
    'Código': product.cuv || product.code,
    'Nombre': product.name,
    'Tono/Variante': product.nameVariant || '',
    'Descripción': product.description || '',
    'Promoción': promotion,
    'Precio': priceObj ? (priceObj.offerPrice || priceObj.normalPrice) : '',
    'Categoría': product.category ? product.category.name : '',
    'Marca': product.brand ? product.brand.name : '',
    'Precio Normal': priceObj ? priceObj.normalPrice : '',
    'Imágenes': (() => {
      const imgs = product.images || {};
      const uniqueUrls = new Set<string>();
      if (typeof imgs.main === 'string' && imgs.main.startsWith('http')) uniqueUrls.add(imgs.main);
      if (typeof imgs.variant === 'string' && imgs.variant.startsWith('http')) uniqueUrls.add(imgs.variant);

      // Also check if any other values are strings/urls
      Object.values(imgs).forEach((v: any) => {
        if (typeof v === 'string' && v.startsWith('http')) uniqueUrls.add(v);
      });

      return Array.from(uniqueUrls).join(', ');
    })(),
  };
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
      const browser = await puppeteer.launch({ pipe: true });
      const page = await browser.newPage();
      await page.setRequestInterception(true);

      let allPageImages: any[] = [];
      let imagesFound = false;

      page.on('request', (request) => {
        if (request.url().includes('graphql') && request.method() === 'POST') {
          try {
            const postData = JSON.parse(request.postData() || '[]');
            if (postData[0]?.operationName === 'getCatalog') {
              postData[0].variables.campaignCode = campaign;
              request.continue({ postData: JSON.stringify(postData) });
              return;
            }
          } catch (e) { }
        }
        request.continue();
      });

      page.on('response', async (response) => {
        if (response.url().includes('graphql') && response.request().method() === 'POST') {
          try {
            const postData = JSON.parse(response.request().postData() || '[]');
            if (postData[0]?.operationName === 'getCatalog') {
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
          } catch (e) { }
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2' });
      if (!imagesFound) await new Promise(resolve => setTimeout(resolve, 5000));
      if (!imagesFound) throw new Error('No se pudo encontrar la información de las imágenes de página.');

      for (const pageImage of allPageImages) {
        try {
          const imagePage = await browser.newPage();
          const imageResponse = await imagePage.goto(pageImage.imageUrl);
          if (imageResponse) {
            fs.writeFileSync(path.join(saveDir, pageImage.fileName), await imageResponse.buffer());
          }
          await imagePage.close();
        } catch (e) {
          console.error(`Error descargando ${pageImage.imageUrl}:`, e);
        }
      }

      await browser.close();
      dialog.showMessageBox({ title: 'Éxito', message: `Se descargaron ${allPageImages.length} imágenes en ${saveDir}` });
      event.sender.send('download-complete');
    } catch (error: any) {
      console.error(error);
      dialog.showErrorBox('Error', `No se pudieron descargar las imágenes. ${error}`);
      event.sender.send('download-error', error.message);
    }
  }
}

// Helper to map AVON/Natura product data to Excel row format
// imagesMap is a fallback lookup: { [productSku]: ["path/Image_xxx_1.jpg", ...] }
function mapDigitalCatalogueProductToRow(product: any, imagesMap: Record<string, string[]> = {}, brandName: string = 'AVON', mediaBaseUrl: string = 'https://media.latam.natura-avon.digital-catalogue.com/') {
  const price = parseFloat(product.price || '0');
  const priceTo = parseFloat(product.price_to || '0');

  let promotion = 'No';
  if (priceTo > 0 && priceTo < price) {
    promotion = 'Sí';
    if (product.condition) {
      promotion = `Sí (${product.condition})`;
    }
  }

  // Get page number from publications array
  const pageNumber = product.publications?.[0]?.page_uuid || 0;

  // Build image URL: prefer external_images, fallback to imagesMap lookup
  let imageUrl = (product.external_images || '').replace(/\\\/\//g, '/');

  if (!imageUrl && product.sku && imagesMap[product.sku]) {
    // Use images_grouped.json data as fallback
    const imagePaths = imagesMap[product.sku];
    if (imagePaths && imagePaths.length > 0) {
      imageUrl = imagePaths
        .map((p: string) => mediaBaseUrl + p.replace(/\\\/\//g, '/'))
        .join(', ');
    }
  }

  return {
    'Página': pageNumber,
    'Código': product.sku || '',
    'Nombre': product.title || '',
    'Tono/Variante': product.variant || '',
    'Descripción': product.description || '',
    'Promoción': promotion,
    'Precio': priceTo > 0 ? priceTo : price,
    'Categoría': product.category || '',
    'Marca': brandName,
    'Precio Normal': price,
    'Imágenes': imageUrl,
  };
}

async function handleExtractDigitalCatalogueData(event: Electron.IpcMainEvent, data: { url: string; campaign: string; brand: string; campaignNumber: string; brandCode: string; }) {
  const { url, brand, campaignNumber, brandCode } = data;
  const defaultPath = `${brand} Ciclo ${campaignNumber}.xlsx`;

  // Determine media base URL based on brand
  const mediaBaseUrl = brandCode === 'natura'
    ? 'https://media.latam.natura.digital-catalogue.com/'
    : 'https://media.latam.natura-avon.digital-catalogue.com/';

  const { filePath } = await dialog.showSaveDialog({
    buttonLabel: 'Guardar Excel',
    defaultPath: defaultPath,
  });

  if (!filePath) {
    event.sender.send('extract-cancelled');
    return;
  }

  try {
    const browser = await puppeteer.launch({ headless: true, pipe: true });
    const page = await browser.newPage();

    await page.setRequestInterception(true);

    let avonProducts: any[] = [];
    let productsFound = false;
    let imagesMap: Record<string, string[]> = {};

    page.on('request', (request) => {
      const requestUrl = request.url();
      if (requestUrl.includes('api') || requestUrl.includes('products') || requestUrl.includes('settings')) {
        console.log(`>>> AVON REQUEST: ${request.method()} ${requestUrl}`);
      }
      request.continue();
    });

    page.on('response', async (response) => {
      const responseUrl = response.url();
      const status = response.status();

      if (responseUrl.includes('api') || responseUrl.includes('products')) {
        console.log(`>>> AVON RESPONSE [${status}]: ${responseUrl}`);
      }

      // Capture images_grouped.json for image URL fallback
      if (responseUrl.includes('images_grouped.json') && status === 200) {
        try {
          const imagesData = await response.json();
          if (imagesData.products) {
            imagesMap = imagesData.products;
            console.log(`>>> AVON: Captured ${Object.keys(imagesMap).length} product images from images_grouped.json`);
          }
        } catch (e) {
          console.error('Error parsing images_grouped.json:', e);
        }
      }

      // Intercept the PLP endpoint for product data
      if (responseUrl.includes('/api/v2/products/') && responseUrl.includes('/plp') && status === 200) {
        try {
          const products = await response.json();
          if (Array.isArray(products) && products.length > 0) {
            console.log(`>>> AVON: Captured ${products.length} products from PLP`);
            fs.writeFileSync('avon_first_product.json', JSON.stringify(products[0], null, 2));
            avonProducts = products;
            productsFound = true;
          }
        } catch (e) {
          console.error('Error parsing PLP response:', e);
        }
      }

      // Alternative endpoint for products
      if (responseUrl.includes('/products') && !productsFound && status === 200) {
        try {
          const responseData = await response.json();
          if (Array.isArray(responseData) && responseData.length > 0 && responseData[0]?.sku) {
            console.log(`>>> AVON: Found products in alternative endpoint: ${responseUrl}`);
            avonProducts = responseData;
            productsFound = true;
          }
        } catch (e) { /* ignore non-json responses */ }
      }
    });

    console.log(`>>> AVON: Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Wait for products to be captured
    if (!productsFound) {
      console.log('>>> AVON: Waiting for product data...');
      await new Promise(resolve => setTimeout(resolve, 8000));
    }

    if (productsFound && avonProducts.length > 0) {
      console.log(`>>> AVON: Processing ${avonProducts.length} products...`);

      // Map products to Excel format with images fallback
      const rows = avonProducts.map((product: any) => mapDigitalCatalogueProductToRow(product, imagesMap, brand, mediaBaseUrl));

      // Sort by page number
      rows.sort((a, b) => (a['Página'] || 0) - (b['Página'] || 0));

      await browser.close();

      // Generate Excel
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, `Catálogo ${brand}`);
      XLSX.writeFile(workbook, filePath);

      dialog.showMessageBox({ title: 'Éxito', message: `${rows.length} productos guardados en ${filePath}` });
      event.sender.send('extract-complete');
    } else {
      await browser.close();
      throw new Error('No se encontraron productos en el catálogo AVON.');
    }
  } catch (error: any) {
    console.error('AVON extraction error:', error);
    dialog.showErrorBox('Error', `No se pudieron extraer los datos de AVON: ${error.message}`);
    event.sender.send('extract-error', error.message || 'Error desconocido');
  }
}

app.on('ready', () => {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  ipcMain.on('extract-data', (event, data) => {
    if (data.brandCode === 'avon' || data.brandCode === 'avon-casa' || data.brandCode === 'natura') {
      handleExtractDigitalCatalogueData(event, data);
    } else {
      handleExtractData(event, data);
    }
  });
  ipcMain.on('download-images', handleDownloadImages);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
