// Dev host for the launch montage with live reload (no clicks needed).
// Usage: npm run social:launch-image   (PORT=1234 to override)
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4330;

const types = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
};

const reloadSnippet = `<script>new EventSource('/__reload').onmessage = () => location.reload();</script>`;

const clients = new Set();
let timer;
watch(root, { recursive: true }, (_event, file) => {
	if (!file || file.startsWith('output')) return; // exports don't trigger reloads
	clearTimeout(timer);
	timer = setTimeout(() => clients.forEach((res) => res.write('data: reload\n\n')), 80);
});

createServer(async (req, res) => {
	const url = new URL(req.url, 'http://localhost');

	if (url.pathname === '/__reload') {
		res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
		res.write('\n');
		clients.add(res);
		req.on('close', () => clients.delete(res));
		return;
	}

	const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
	const file = normalize(join(root, rel));
	if (file !== root && !file.startsWith(root + sep)) {
		res.writeHead(403).end('Forbidden');
		return;
	}

	try {
		let body = await readFile(file);
		const type = types[extname(file).toLowerCase()] ?? 'application/octet-stream';
		if (type.startsWith('text/html')) {
			body = Buffer.from(body.toString('utf8').replace('</body>', `${reloadSnippet}</body>`));
		}
		res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
		res.end(body);
	} catch {
		res.writeHead(404).end('Not found');
	}
}).listen(port, () => console.log(`Launch image dev host: http://localhost:${port}/  (live reload on; ?fit=0 for 1:1)`));
