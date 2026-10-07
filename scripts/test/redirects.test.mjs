// Run after `npm run build`: checks the built /linkedin redirect page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const TARGET =
	'https://mentorgamestudio.com/?utm_source=linkedin&utm_medium=social&utm_campaign=website_launch&utm_content=company';

test('/linkedin redirects to the homepage with exact UTM parameters', async () => {
	const html = await readFile(new URL('../../dist/linkedin/index.html', import.meta.url), 'utf8');
	const refresh = html.match(/<meta http-equiv="refresh" content="0;url=([^"]+)"/);
	assert.ok(refresh, 'meta refresh present');
	const url = new URL(refresh[1].replaceAll('&amp;', '&'), 'https://mentorgamestudio.com/');
	assert.equal(url.href, TARGET);
});
