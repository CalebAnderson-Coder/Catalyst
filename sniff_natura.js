/**
 * Sniffing script to discover Natura catalog API structure
 * Run: $env:ELECTRON_RUN_AS_NODE=''; node sniff_natura.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const NATURA_URL = 'https://co.natura.digital-catalogue.com/co/2026/03/revista/ciclo-3/view/index.html?id_consultora=1311733&utm_term=web&page=1';

async function sniffNatura() {
    console.log('>>> Starting Natura catalog sniff...\n');

    const browser = await puppeteer.launch({ headless: false }); // Visible for debugging
    const page = await browser.newPage();

    const capturedRequests = [];
    const capturedResponses = [];

    // Capture all requests
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const url = request.url();
        if (url.includes('api') || url.includes('products') || url.includes('settings') || url.includes('.json')) {
            console.log(`>>> REQUEST [${request.method()}]: ${url.substring(0, 150)}`);
            capturedRequests.push({
                method: request.method(),
                url: url,
                postData: request.postData()
            });
        }
        request.continue();
    });

    // Capture responses with product data
    page.on('response', async (response) => {
        const url = response.url();
        const status = response.status();

        if ((url.includes('api') || url.includes('products') || url.includes('.json')) && status === 200) {
            console.log(`>>> RESPONSE [${status}]: ${url.substring(0, 150)}`);
            try {
                const contentType = response.headers()['content-type'] || '';
                if (contentType.includes('json')) {
                    const data = await response.json();
                    capturedResponses.push({
                        url: url,
                        status: status,
                        dataPreview: JSON.stringify(data).substring(0, 500),
                        fullData: data
                    });

                    // Check if this looks like product data
                    if (Array.isArray(data) && data.length > 0 && data[0].sku) {
                        console.log(`\n>>> FOUND PRODUCTS! Count: ${data.length}`);
                        console.log('>>> First product sample:', JSON.stringify(data[0], null, 2).substring(0, 1000));
                        fs.writeFileSync('natura_products.json', JSON.stringify(data, null, 2));
                    }

                    // Check for images_grouped.json
                    if (url.includes('images_grouped')) {
                        console.log(`\n>>> FOUND IMAGES GROUPED`);
                        fs.writeFileSync('natura_images_grouped.json', JSON.stringify(data, null, 2));
                    }
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
    });

    console.log(`>>> Navigating to: ${NATURA_URL}\n`);
    await page.goto(NATURA_URL, { waitUntil: 'networkidle2' });

    // Wait for additional API calls
    console.log('\n>>> Waiting 10s for additional API calls...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Save captured data
    fs.writeFileSync('natura_sniffer_output.json', JSON.stringify({
        requests: capturedRequests,
        responses: capturedResponses
    }, null, 2));

    console.log('\n>>> Sniffing complete. Check natura_sniffer_output.json');
    console.log(`>>> Captured ${capturedRequests.length} API requests`);
    console.log(`>>> Captured ${capturedResponses.length} API responses`);

    await browser.close();
}

sniffNatura().catch(console.error);
