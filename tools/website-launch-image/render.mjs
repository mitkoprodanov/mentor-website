// Deterministic PNG export of the launch montage.
// Usage: npm run social:launch-image:render
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(resolve(here, 'index.html')).href + '?fit=0'; // 1:1, no preview scaling
const outFile = resolve(here, 'output', 'linkedin-launch.png');

const WIDTH = 1200;
const HEIGHT = 627;

await mkdir(dirname(outFile), { recursive: true });

const browser = await chromium.launch();
try {
	const context = await browser.newContext({
		viewport: { width: WIDTH, height: HEIGHT },
		deviceScaleFactor: 2,
	});
	const page = await context.newPage();

	const failed = [];
	page.on('requestfailed', (r) => failed.push(r.url()));

	await page.goto(pageUrl, { waitUntil: 'load' });

	// Wait for every <img> to be fully decoded and for fonts to settle.
	await page.evaluate(async () => {
		await document.fonts.ready;
		await Promise.all(
			[...document.images].map(async (img) => {
				if (!img.complete) {
					await new Promise((res, rej) => {
						img.addEventListener('load', res, { once: true });
						img.addEventListener('error', () => rej(new Error(`Failed to load ${img.src}`)), { once: true });
					});
				}
				if (!img.naturalWidth) throw new Error(`Broken image: ${img.src}`);
				await img.decode();
			}),
		);
	});

	if (failed.length) throw new Error(`Failed requests:\n${failed.join('\n')}`);

	await page.locator('#canvas').screenshot({ path: outFile, animations: 'disabled' });
	console.log(`Wrote ${outFile} (${WIDTH * 2}×${HEIGHT * 2})`);
} finally {
	await browser.close();
}
