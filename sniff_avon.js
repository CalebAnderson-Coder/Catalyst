/**
 * Script para sniffear las APIs del catálogo Avon
 * Ejecutar con: node sniff_avon.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const TARGET_URL = 'https://co.natura-avon.digital-catalogue.com/co/2026/02/revista/avon-ciclo-2/view/index.html?page=1&module=plp';

async function sniffAvonCatalog() {
    console.log('🚀 Iniciando sniffer de Avon catalog...');

    const browser = await puppeteer.launch({
        headless: false, // Visible para ver qué pasa
        devtools: true   // Abrir DevTools automáticamente
    });

    const page = await browser.newPage();

    const capturedRequests = [];
    const capturedResponses = [];

    // Interceptar todas las requests
    await page.setRequestInterception(true);

    page.on('request', (request) => {
        const url = request.url();
        const method = request.method();

        // Capturar requests interesantes (APIs, JSON, etc.)
        if (url.includes('/api/') ||
            url.includes('graphql') ||
            url.includes('.json') ||
            url.includes('products') ||
            url.includes('catalog') ||
            (method === 'POST' && !url.includes('.js') && !url.includes('.css'))) {

            capturedRequests.push({
                url,
                method,
                postData: request.postData(),
                headers: request.headers()
            });
            console.log(`📥 REQUEST [${method}]: ${url.substring(0, 100)}...`);
        }

        request.continue();
    });

    page.on('response', async (response) => {
        const request = response.request();
        const url = request.url();
        const method = request.method();
        const contentType = response.headers()['content-type'] || '';

        // Capturar respuestas JSON
        if (contentType.includes('application/json') ||
            url.includes('/api/') ||
            url.includes('graphql') ||
            url.includes('.json')) {

            try {
                const body = await response.text();
                capturedResponses.push({
                    url,
                    method,
                    status: response.status(),
                    contentType,
                    bodyPreview: body.substring(0, 1000),
                    fullBody: body
                });
                console.log(`📤 RESPONSE [${response.status()}]: ${url.substring(0, 80)}...`);
                console.log(`   Content-Type: ${contentType}`);
                console.log(`   Body preview: ${body.substring(0, 200)}...`);
            } catch (e) {
                // Response was consumed or error
            }
        }
    });

    // Navegar a la página
    console.log(`\n🌐 Navegando a: ${TARGET_URL}\n`);
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Esperar un poco más para capturar lazy-loaded content
    console.log('\n⏳ Esperando contenido adicional...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Intentar hacer scroll para cargar más contenido
    console.log('📜 Haciendo scroll para cargar más contenido...');
    await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Intentar click en el primer producto si existe
    console.log('🖱️ Buscando productos para clickear...');
    try {
        const productSelector = '.product, .item, [data-product], .plp-product, .catalog-item';
        await page.waitForSelector(productSelector, { timeout: 5000 });
        await page.click(productSelector);
        await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (e) {
        console.log('   No se encontraron productos clickeables');
    }

    // Guardar resultados
    const results = {
        targetUrl: TARGET_URL,
        timestamp: new Date().toISOString(),
        requests: capturedRequests,
        responses: capturedResponses
    };

    fs.writeFileSync('avon_sniffer_output.json', JSON.stringify(results, null, 2));
    console.log('\n✅ Resultados guardados en avon_sniffer_output.json');

    console.log('\n📊 Resumen:');
    console.log(`   Requests capturadas: ${capturedRequests.length}`);
    console.log(`   Responses capturadas: ${capturedResponses.length}`);

    // Mantener el browser abierto para inspección manual
    console.log('\n🔍 Browser abierto para inspección manual. Presiona Ctrl+C para cerrar.');

    // No cerrar automáticamente para poder inspeccionar
    // await browser.close();
}

sniffAvonCatalog().catch(console.error);
