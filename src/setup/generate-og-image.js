import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE = path.resolve(__dirname, '../../weekly-fixture/src/og-card.html');
const OUTPUT = path.resolve(__dirname, '../../weekly-fixture/images/og-image.png');
const WIDTH = 1200;
const HEIGHT = 630;

async function main() {
    console.log(`Rendering ${SOURCE} → ${OUTPUT}`);

    const browser = await puppeteer.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });

        await page.goto(pathToFileURL(SOURCE).href, { waitUntil: 'networkidle0' });

        // Make sure web fonts have actually swapped in before we snap.
        await page.evaluate(() => document.fonts.ready);

        await page.screenshot({
            path: OUTPUT,
            type: 'png',
            clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
            omitBackground: false,
        });

        console.log(`✅ Wrote ${OUTPUT}`);
    } finally {
        await browser.close();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
