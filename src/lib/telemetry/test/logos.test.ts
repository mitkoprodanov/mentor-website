import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getLogo, logos, resolveLogo } from '../../../data/logos.ts';
import type { LogoId } from '../../../data/logos.ts';
import { resolve } from '../interactionResolver.ts';
import type { ElementLike } from '../interactionResolver.ts';
import { buildNoninteractiveClick } from '../interactions.ts';

const TARGET_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

test('registry: every logo is keyed by its own canonical id, which is Worker-valid', () => {
	for (const [key, def] of Object.entries(logos)) {
		assert.equal(def.id, key);
		assert.match(def.id, TARGET_ID_RE);
		assert.ok(def.src.startsWith('/logos/'));
	}
	assert.equal(getLogo('riot-games')?.id, 'riot-games');
	assert.equal(getLogo('nope'), undefined);
	assert.equal(getLogo(undefined), undefined);
	assert.equal(getLogo('__proto__'), undefined, 'no prototype-chain lookups');
});

test('a project can reference a logo; a company can reference a logo; both resolve to the SAME definition', () => {
	const project = { id: 'lol-universe', logoId: 'riot-games' as LogoId };
	const company = { id: 'primal', logoId: 'riot-games' as LogoId };
	const anotherProject = { id: 'other', logoId: 'riot-games' as LogoId };
	assert.equal(resolveLogo(project), logos['riot-games']);
	assert.equal(resolveLogo(company), logos['riot-games']);
	assert.equal(resolveLogo(anotherProject), resolveLogo(project), 'one shared definition object, no duplicated asset config');
});

test('no logoId → no logo (rendering unchanged); references are explicit, never inherited', () => {
	assert.equal(resolveLogo({}), undefined);
	assert.equal(resolveLogo(null), undefined);
	const company = { id: 'c', logoId: 'riot-games' as LogoId, projects: [{ id: 'p' } as { id: string; logoId?: LogoId }] };
	assert.equal(resolveLogo(company.projects[0]), undefined, 'a project does NOT pick up its company logo');
});

test('lol-universe maps through the registry with the exact presentation it had inline', () => {
	const src = readFileSync(new URL('../../../data/timeline.ts', import.meta.url), 'utf8');
	const entry = src.slice(src.indexOf("id: 'lol-universe'"));
	const block = entry.slice(0, entry.indexOf('media:'));
	assert.match(block, /logoId: 'riot-games'/);
	assert.doesNotMatch(src, /\blogo: \{/, 'no inline logo config remains');
	// previously inline: src '/logos/riot/riot-games-lockup-red.png', previewWidth 80, detailWidth 130
	assert.deepEqual(resolveLogo({ logoId: 'riot-games' }), {
		id: 'riot-games',
		src: '/logos/riot/riot-games-lockup-red.png',
		previewWidth: 80,
		detailWidth: 130,
	});
});

test('components render the logo through the registry, at the same positions, with the canonical id marker', () => {
	const row = readFileSync(new URL('../../../components/timeline/ProjectRow.astro', import.meta.url), 'utf8');
	const detail = readFileSync(new URL('../../../components/projects/ProjectDetail.astro', import.meta.url), 'utf8');
	assert.match(row, /const logo = resolveLogo\(project\)/);
	assert.match(row, /data-partner-logo=\{logo\.id\}/);
	assert.match(detail, /data-partner-logo=\{logo\.id\}/);
	assert.doesNotMatch(row + detail, /data-partner-logo=\{(projectId|visibilityId)\}/);
});

// ---- telemetry identity -----------------------------------------------------------

function el(tagName: string, o: { cls?: string; attrs?: Record<string, string> } = {}, parent: ElementLike | null = null): ElementLike {
	const classes = new Set((o.cls ?? '').split(/\s+/).filter(Boolean));
	const attrs = o.attrs ?? {};
	return {
		tagName: tagName.toUpperCase(),
		id: '',
		parentElement: parent,
		getAttribute: (n) => (n in attrs ? attrs[n] : null),
		hasAttribute: (n) => n in attrs,
		classList: { contains: (c) => classes.has(c) },
	};
}

test('partner-logo telemetry: target is partner_logo/<logo id>, never the project id, path or filename', () => {
	const dialog = el('dialog', { attrs: { 'data-project-modal': 'tl-lol-universe', 'data-project-id': 'lol-universe' } });
	const logo = el('img', { cls: 'project-modal__logo', attrs: { 'data-partner-logo': 'riot-games', src: '/logos/riot/riot-games-lockup-red.png' } }, dialog);
	const hit = resolve(logo, 'project_modal')?.noninteractive;
	assert.deepEqual(hit, { type: 'partner_logo', id: 'riot-games', element: 'partner_logo', projectId: 'lol-universe' });
	const opts = buildNoninteractiveClick(hit!, 'mouse', 'view-instance-1');
	assert.equal(opts.target_type, 'partner_logo');
	assert.equal(opts.target_id, 'riot-games');
	assert.equal(opts.properties?.project_id, 'lol-universe', 'project context stays independently recoverable');
	assert.ok(!JSON.stringify(opts).match(/\.png|\/logos\//), 'no asset path/filename in telemetry');
});

test('the same logo shown by two different projects has ONE telemetry identity', () => {
	const mk = (pid: string) => {
		const d = el('dialog', { attrs: { 'data-project-modal': `tl-${pid}`, 'data-project-id': pid } });
		return resolve(el('img', { attrs: { 'data-partner-logo': 'riot-games' } }, d), 'project_modal')?.noninteractive;
	};
	const a = mk('lol-universe');
	const b = mk('another-riot-project');
	assert.equal(a?.id, b?.id);
	assert.notEqual(a?.projectId, b?.projectId);
});

// ---- company logos --------------------------------------------------------------------

import { existsSync } from 'node:fs';

test('company logos: registry assets exist, and plates match the artwork (dark art → light plate, white art → black plate)', () => {
	for (const def of Object.values(logos)) {
		assert.ok(existsSync(new URL(`../../../../public${def.src}`, import.meta.url)), `${def.id}: ${def.src} exists`);
	}
	assert.equal(logos.primal.plate, 'light');
	assert.equal(logos['flying-wild-hog'].plate, 'black');
	assert.equal(logos['black-hole'].plate, undefined, 'ships with its own black background');
});

test('company logos: companies reference logos explicitly by id in the timeline data', () => {
	const src = readFileSync(new URL('../../../data/timeline.ts', import.meta.url), 'utf8');
	const logoOf = (companyId: string) => {
		const at = src.indexOf(`id: '${companyId}',`);
		assert.ok(at >= 0, companyId);
		return /logoId: '([^']+)'/.exec(src.slice(at, at + 120))?.[1];
	};
	assert.equal(logoOf('black-hole-entertainment'), 'black-hole');
	assert.equal(logoOf('bhe-early'), 'black-hole');
	assert.equal(logoOf('primal-game-studio'), 'primal');
	assert.equal(logoOf('primal-continued'), 'primal');
	assert.equal(logoOf('flying-wild-hog'), 'flying-wild-hog');
	assert.equal(logoOf('ericsson'), undefined, 'a company with no logoId shows none');
	for (const id of ['black-hole', 'primal', 'flying-wild-hog']) assert.ok(getLogo(id), id);
});

test('company logos: both company header renderers use the shared noninteractive CompanyLogo component', () => {
	const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
	assert.match(read('../../../components/timeline/CompanyBlock.astro'), /resolveLogo\(company\)/);
	assert.match(read('../../../components/timeline/ApartBlock.astro'), /resolveLogo\(company\)/);
	const comp = read('../../../components/common/CompanyLogo.astro');
	assert.match(comp, /data-partner-logo=\{logo\.id\}/);
	assert.doesNotMatch(comp, /<a\b|<button\b|onclick/i, 'logos stay noninteractive');
});
