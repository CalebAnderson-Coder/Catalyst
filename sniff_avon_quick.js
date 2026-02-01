/**
 * Script para sniffear las APIs del catálogo Avon (versión rápida)
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const TARGET_URL = 'https://co.natura-avon.digital-catalogue.com/co/2026/02/revista/avon-ciclo-2/view/index.html?page=1&module=plp';

async function sniffAvonCatalog() {
    console.log('🚀 Iniciando sniffer de Avon catalog...');

    const browser = await puppeteer.launch({
        headless: true // Modo headless para ser más rápido
    });

    const page = await browser.newPage();

    const capturedUrls = [];
    const capturedResponses = [];

    // Interceptar respuestas
    page.on('response', async (response) => {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';

        // Capturar respuestas JSON
        if (contentType.includes('application/json')) {
            try {
                const body = await response.text();
                capturedUrls.push(url);
                capturedResponses.push({
                    url,
                    status: response.status(),
                    contentType,
                    body: body
                });
                console.log(`📤 JSON: ${url}`);
            } catch (e) {
                console.log(`⚠️ Error parsing: ${url}`);
            }
        }
    });

    // Navegar a la página
    console.log(`\n🌐 Navegando a: ${TARGET_URL}\n`);
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });

    // Esperar contenido adicional
    console.log('\n⏳ Esperando contenido adicional...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    await browser.close();

    // Guardar resultados
    const results = {
        targetUrl: TARGET_URL,
        timestamp: new Date().toISOString(),
        urls: capturedUrls,
        responses: capturedResponses
    };

    fs.writeFileSync('avon_api_data.json', JSON.stringify(results, null, 2));
    console.log('\n✅ Resultados guardados en avon_api_data.json');
    console.log(`📊 Total URLs JSON capturadas: ${capturedUrls.length}`);

    // Imprimir URLs encontradas
    console.log('\n📋 URLs encontradas:');
    capturedUrls.forEach(url => console.log(`  - ${url}`));
}

sniffAvonCatalog().catch(console.error);
