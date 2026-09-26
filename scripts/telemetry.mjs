#!/usr/bin/env node
// Local telemetry development helper. Wired up as `npm run telemetry:*` and
// `npm run dev:telemetry` (see package.json, docs/telemetry.md "Local development").
//
// SAFETY: every D1 access goes through `d1()` below, which hard-codes `--local`
// and refuses anything that could reach the remote/production database. No
// command here deploys, and none accepts a flag that switches to remote.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = join(ROOT, 'workers', 'telemetry');
const WRANGLER_CONFIG = join(WORKER_DIR, 'wrangler.jsonc');
const WRANGLER_JS = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const ASTRO_JS = join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs');
const MIGRATIONS_DIR = join(ROOT, 'migrations');
const DEV_VARS = join(WORKER_DIR, '.dev.vars');
const LOCAL_D1_DIR = join(WORKER_DIR, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');

const DB_BINDING = 'DB';
const WORKER_PORT = 8787;
const ASTRO_PORT = 4321;

/** Private-network IPv4 addresses of this machine (for testing from a phone on the same Wi-Fi). */
function lanAddresses() {
	const found = [];
	for (const list of Object.values(networkInterfaces())) {
		for (const a of list ?? []) {
			if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) {
				found.push(a.address);
			}
		}
	}
	return found;
}
const LAN = lanAddresses();
// Loopback first (desktop); LAN addresses are added so a phone can use them.
const ASTRO_ORIGINS = [
	`http://localhost:${ASTRO_PORT}`,
	`http://127.0.0.1:${ASTRO_PORT}`,
	...LAN.map((ip) => `http://${ip}:${ASTRO_PORT}`),
];
// The endpoint the browser calls. It must be reachable from the phone, so use the LAN IP when there is one.
const WORKER_HOST = LAN[0] ?? 'localhost';
const WORKER_ORIGIN = `http://${WORKER_HOST}:${WORKER_PORT}`;
const ENDPOINT = `${WORKER_ORIGIN}/v1/batch`;
const DEV_VARS_HEADER = '# Local Worker configuration (git-ignored). ALLOWED_ORIGINS is CORS config, not authentication.\n';

const COMMANDS_BLOCK = `Normal commands
  Start development   Terminal 1: npm run telemetry:dev
                      Terminal 2: npm run dev:telemetry   (open http://localhost:${ASTRO_PORT}/ or the phone URL it prints)
  Inspect data        npm run telemetry:sessions | telemetry:events | telemetry:viewport
  Reset data          npm run telemetry:clear   (LOCAL only)`;

// ---------------------------------------------------------------- utilities

const out = (s = '') => console.log(s);
const tag = { ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]', info: '[ .. ]' };

function die(msg, code = 1) {
	console.error(msg);
	process.exit(code);
}

function nodeArgs(script, args) {
	return [script, ...args];
}

function parseFlags(argv) {
	const flags = { limit: 20, session: undefined };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--limit' || a === '-n') {
			const n = Number(argv[++i]);
			if (!Number.isInteger(n) || n < 1 || n > 500) die('--limit must be an integer 1..500');
			flags.limit = n;
		} else if (a === '--session' || a === '-s') {
			const s = argv[++i] ?? '';
			if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) die('--session must be a session id or id prefix');
			flags.session = s;
		} else {
			die(`Unknown option: ${a}\nSupported: --limit N, --session ID_PREFIX`);
		}
	}
	return flags;
}

/** Plain-text table, cells truncated so rows stay readable in a terminal. */
function table(columns, rows, maxCell = 44) {
	const cell = (v) => {
		const s = v === null || v === undefined ? '' : String(v);
		return s.length > maxCell ? s.slice(0, maxCell - 1) + '~' : s;
	};
	const data = rows.map((r) => columns.map((c) => cell(r[c])));
	const widths = columns.map((c, i) => Math.max(c.length, ...data.map((r) => r[i].length)));
	const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
	out(line(columns));
	out(widths.map((w) => '-'.repeat(w)).join('  '));
	for (const r of data) out(line(r));
}

function portOpen(port, host = '127.0.0.1', timeoutMs = 700) {
	return new Promise((res) => {
		const s = net.connect({ port, host });
		const done = (v) => {
			s.destroy();
			res(v);
		};
		s.setTimeout(timeoutMs, () => done(false));
		s.once('connect', () => done(true));
		s.once('error', () => done(false));
	});
}

// ------------------------------------------------------------ local D1 access

/**
 * Runs `wrangler d1 execute` against the LOCAL database only. This is the sole
 * D1 entry point in this file; it is not possible to pass --remote through it.
 */
function d1(sqlArgs) {
	if (sqlArgs.some((a) => /^--(remote|preview|env|persist-to|config|local)/.test(a))) {
		throw new Error('Refusing: d1() controls --local/--config itself.');
	}
	const args = ['d1', 'execute', DB_BINDING, '--local', '--config', WRANGLER_CONFIG, ...sqlArgs];
	const r = spawnSync(process.execPath, nodeArgs(WRANGLER_JS, args), {
		cwd: ROOT,
		encoding: 'utf8',
		env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
		maxBuffer: 32 * 1024 * 1024,
	});
	return r;
}

/** Executes SQL, returns one result array per statement. Throws with wrangler's message on failure. */
function query(sql) {
	const r = d1(['--json', '--command', sql]);
	const text = `${r.stdout ?? ''}`;
	const start = text.indexOf('[');
	let parsed;
	try {
		parsed = JSON.parse(text.slice(start));
	} catch {
		throw new Error(cleanWranglerError(`${r.stdout}\n${r.stderr}`) || 'wrangler produced no JSON output');
	}
	if (r.status !== 0 || parsed.some((p) => p.success === false)) {
		throw new Error(cleanWranglerError(`${r.stdout}\n${r.stderr}`));
	}
	return parsed.map((p) => p.results ?? []);
}

function cleanWranglerError(s) {
	const lines = s
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l && /error|no such|fail|constraint/i.test(l));
	return lines.slice(0, 4).join('\n');
}

function localDbFiles() {
	if (!existsSync(LOCAL_D1_DIR)) return [];
	return readdirSync(LOCAL_D1_DIR).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
}

/** Non-destructive status: never creates the DB. */
function dbStatus() {
	const files = localDbFiles();
	if (files.length === 0) return { exists: false, tables: [], missing: ['sessions', 'events'] };
	const [tables] = query(
		`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
	);
	const names = tables.map((t) => t.name);
	const missing = ['sessions', 'events'].filter((t) => !names.includes(t));
	const status = { exists: true, tables: names, missing };
	if (missing.length === 0) {
		const [[c]] = query(
			`SELECT (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT COUNT(*) FROM events) AS events`,
		);
		status.counts = c;
	}
	return status;
}

/** Returns the DB status or exits with guidance when the local DB is not ready. */
function requireReadyDb() {
	let s;
	try {
		s = dbStatus();
	} catch (e) {
		die(`Could not read the local telemetry DB:\n${e.message}`);
	}
	if (!s.exists || s.missing.length) {
		die('Local telemetry DB is not initialized. Run: npm run telemetry:db:init');
	}
	return s;
}

// ----------------------------------------------------------------- commands

function cmdDbInit() {
	out('Initializing LOCAL telemetry database (never touches remote/production)...');
	if (!existsSync(MIGRATIONS_DIR)) die(`Missing ${MIGRATIONS_DIR}`);
	const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
	if (files.length === 0) die('No migrations found in migrations/');

	// Same bookkeeping table Wrangler's own `d1 migrations` uses, so migrations
	// applied here are tracked and never re-run.
	query(
		`CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`,
	);
	const [applied] = query(`SELECT name FROM d1_migrations`);
	const done = new Set(applied.map((a) => a.name));
	const [existing] = query(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions','events')`);
	// A local DB created by hand before tracking existed: adopt the initial schema.
	const adoptInitial = existing.length === 2 && done.size === 0;

	let ranAny = false;
	for (const [i, f] of files.entries()) {
		if (done.has(f)) {
			out(`  skip     ${f} (already applied)`);
			continue;
		}
		if (i === 0 && adoptInitial) {
			out(`  adopt    ${f} (schema already present; now tracked)`);
		} else {
			const r = d1(['--file', join(MIGRATIONS_DIR, f)]);
			if (r.status !== 0) die(`Migration ${f} failed:\n${cleanWranglerError(`${r.stdout}\n${r.stderr}`)}`);
			out(`  applied  ${f}`);
			ranAny = true;
		}
		query(`INSERT INTO d1_migrations (name) VALUES ('${f.replace(/'/g, "''")}')`);
	}
	out(ranAny ? 'Done. Verify with: npm run telemetry:db:check' : 'Nothing to do. Local DB is up to date.');
}

function cmdDbCheck({ quiet = false } = {}) {
	let s;
	try {
		s = dbStatus();
	} catch (e) {
		out(`${tag.fail} Local telemetry DB is not usable:\n${e.message}`);
		return false;
	}
	if (!s.exists) {
		out(`${tag.fail} No local telemetry DB yet. Run: npm run telemetry:db:init`);
		return false;
	}
	out(`${tag.ok} Local DB present (${LOCAL_D1_DIR.replace(ROOT + '\\', '').replace(ROOT + '/', '')})`);
	for (const t of ['sessions', 'events']) {
		out(`${s.missing.includes(t) ? tag.fail : tag.ok} table ${t}${s.missing.includes(t) ? ' MISSING' : ''}`);
	}
	if (s.missing.length) {
		out('Run: npm run telemetry:db:init');
		return false;
	}
	if (!quiet) out(`${tag.info} rows: ${s.counts.sessions} sessions, ${s.counts.events} events`);
	return true;
}

/** Creates .dev.vars if needed and keeps its ALLOWED_ORIGINS line in step with this machine's LAN addresses. */
function ensureDevVars() {
	const line = `ALLOWED_ORIGINS=${ASTRO_ORIGINS.join(',')}`;
	const current = existsSync(DEV_VARS) ? readFileSync(DEV_VARS, 'utf8') : null;
	let next;
	if (current === null) next = DEV_VARS_HEADER + line + '\n';
	else if (/^\s*ALLOWED_ORIGINS\s*=/m.test(current)) next = current.replace(/^\s*ALLOWED_ORIGINS\s*=.*$/m, line);
	else next = current.replace(/\s*$/, '\n') + line + '\n';
	if (next !== current) {
		writeFileSync(DEV_VARS, next);
		out('Updated workers/telemetry/.dev.vars (git-ignored) ALLOWED_ORIGINS for localhost + LAN.');
	}
}

function devVarsOrigins() {
	if (!existsSync(DEV_VARS)) return null;
	const m = readFileSync(DEV_VARS, 'utf8').match(/^\s*ALLOWED_ORIGINS\s*=\s*(.*)$/m);
	if (!m) return [];
	return m[1].replace(/^["']|["']\s*$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
}

function runForeground(script, args, env) {
	const child = spawn(process.execPath, nodeArgs(script, args), {
		cwd: ROOT,
		stdio: 'inherit',
		env: { ...process.env, ...env },
	});
	child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
	child.on('error', (e) => die(`Failed to start: ${e.message}`));
}

async function cmdWorkerDev() {
	ensureDevVars();
	let ready = false;
	try {
		const s = dbStatus();
		ready = s.exists && s.missing.length === 0;
	} catch {
		/* reported below */
	}
	if (!ready) die('Local telemetry DB is not initialized. Run once: npm run telemetry:db:init');
	if (await portOpen(WORKER_PORT)) die(`Port ${WORKER_PORT} is already in use (Worker already running?).`);
	out(`Starting LOCAL telemetry Worker on ${WORKER_ORIGIN} (all interfaces, local D1 only).`);
	// --ip 0.0.0.0 so a phone on the same network can reach the Worker.
	runForeground(WRANGLER_JS, ['dev', '--local', '--ip', '0.0.0.0', '--port', String(WORKER_PORT), '--config', WRANGLER_CONFIG], {
		WRANGLER_SEND_METRICS: 'false',
	});
}

async function cmdAstroDev() {
	if (await portOpen(ASTRO_PORT)) {
		out(`${tag.warn} Port ${ASTRO_PORT} is in use; --force will replace an existing Astro dev server (it is not started with telemetry unless it was this command).`);
	}
	if (!(await portOpen(WORKER_PORT))) {
		out(`${tag.warn} Worker not detected on :${WORKER_PORT}. In another terminal run: npm run telemetry:dev`);
	}
	out(`Astro dev with telemetry ON -> ${ENDPOINT}`);
	out(`Desktop: http://localhost:${ASTRO_PORT}/`);
	if (LAN.length) {
		for (const ip of LAN) out(`Phone (same Wi-Fi): http://${ip}:${ASTRO_PORT}/`);
		out(`If the phone cannot connect, allow inbound TCP ${ASTRO_PORT} and ${WORKER_PORT} in Windows Firewall (Private network).`);
	} else {
		out(`${tag.warn} No LAN IPv4 address found; phone testing unavailable.`);
	}
	runForeground(ASTRO_JS, ['dev', '--host', '--force', '--port', String(ASTRO_PORT)], {
		PUBLIC_TELEMETRY: '1',
		PUBLIC_TELEMETRY_ENDPOINT: ENDPOINT,
	});
}

function cmdSessions(argv) {
	const f = parseFlags(argv);
	requireReadyDb();
	const [rows] = query(`
		SELECT substr(s.session_id, 1, 8) AS session,
		       s.started_at AS started_at,
		       (SELECT COUNT(*) FROM events e WHERE e.session_id = s.session_id) AS events,
		       s.viewport_width || 'x' || s.viewport_height AS viewport,
		       CASE WHEN s.primary_pointer_coarse = 1 THEN 'coarse' WHEN s.primary_pointer_fine = 1 THEN 'fine' ELSE '-' END AS pointer,
		       CASE WHEN s.hover_capable = 1 THEN 'hover' ELSE 'no-hover' END AS hover,
		       CASE WHEN s.touch_capable = 1 THEN 'touch' ELSE '-' END AS touch,
		       COALESCE(s.utm_source, '') AS utm,
		       COALESCE(NULLIF(s.referrer, ''), '') AS referrer,
		       COALESCE(s.site_version, '') AS site
		FROM sessions s
		${f.session ? `WHERE s.session_id LIKE '${f.session}%'` : ''}
		ORDER BY s.started_at DESC, s.rowid DESC LIMIT ${f.limit}`);
	if (!rows.length) return out('No local sessions.');
	out(`Most recent ${rows.length} local session(s), newest first:`);
	table(['session', 'started_at', 'events', 'viewport', 'pointer', 'hover', 'touch', 'utm', 'referrer', 'site'], rows, 30);
}

function cmdEvents(argv) {
	const f = parseFlags(argv);
	requireReadyDb();
	const [rows] = query(`
		SELECT * FROM (
			SELECT id, substr(session_id, 1, 8) AS session, elapsed_ms AS elapsed_ms, event_type AS type,
			       CASE WHEN target_type IS NULL THEN '' ELSE target_type || ':' || target_id END AS target,
			       COALESCE(properties, '') AS properties
			FROM events
			${f.session ? `WHERE session_id LIKE '${f.session}%'` : ''}
			ORDER BY id DESC LIMIT ${f.limit}
		) ORDER BY id ASC`);
	if (!rows.length) return out('No local events.');
	out(`Last ${rows.length} local event(s), oldest first:`);
	table(['id', 'session', 'elapsed_ms', 'type', 'target', 'properties'], rows, 60);
}

function cmdViewport(argv) {
	const f = parseFlags(argv);
	requireReadyDb();
	const [rows] = query(`
		SELECT * FROM (
			SELECT id, substr(session_id, 1, 8) AS session, elapsed_ms AS elapsed_ms, occurred_at,
			       json_extract(properties, '$.viewport_width') AS width,
			       json_extract(properties, '$.viewport_height') AS height
			FROM events
			WHERE event_type = 'viewport_changed'
			${f.session ? `AND session_id LIKE '${f.session}%'` : ''}
			ORDER BY id DESC LIMIT ${f.limit}
		) ORDER BY id ASC`);
	if (!rows.length) return out('No local viewport_changed events.');
	for (const r of rows) {
		r.size = `${r.width}x${r.height}`;
		r.orientation = r.width >= r.height ? 'landscape' : 'portrait';
	}
	out(`Last ${rows.length} local viewport_changed event(s), oldest first:`);
	table(['id', 'session', 'elapsed_ms', 'occurred_at', 'size', 'orientation'], rows);
}

function cmdClear() {
	requireReadyDb();
	const [[before]] = query(
		`SELECT (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT COUNT(*) FROM events) AS events`,
	);
	out(`Clearing LOCAL telemetry only (${before.events} events, ${before.sessions} sessions)...`);
	// events first: events.session_id references sessions.
	query(`DELETE FROM events; DELETE FROM sessions;`);
	try {
		query(`DELETE FROM sqlite_sequence WHERE name = 'events'`); // restart event ids at 1
	} catch {
		/* cosmetic only */
	}
	const [[after]] = query(
		`SELECT (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT COUNT(*) FROM events) AS events`,
	);
	out(`Done. Local DB now has ${after.sessions} sessions, ${after.events} events. Production is untouched.`);
	out('For a clean test: reload/open a fresh page (a reload is a new session).');
}

async function cmdCheck() {
	let bad = 0;
	const line = (level, msg) => {
		if (level === 'fail') bad++;
		out(`${tag[level]} ${msg}`);
	};
	out('Local telemetry readiness\n');

	const [maj, min] = process.versions.node.split('.').map(Number);
	line(maj > 22 || (maj === 22 && min >= 12) ? 'ok' : 'fail', `Node ${process.versions.node} (need >= 22.12)`);
	line(existsSync(WRANGLER_JS) ? 'ok' : 'fail', existsSync(WRANGLER_JS) ? 'wrangler installed' : 'wrangler missing: run npm install');
	line(existsSync(ASTRO_JS) ? 'ok' : 'fail', existsSync(ASTRO_JS) ? 'astro installed' : 'astro missing: run npm install');
	line(existsSync(WRANGLER_CONFIG) ? 'ok' : 'fail', 'Worker config workers/telemetry/wrangler.jsonc');

	const origins = devVarsOrigins();
	if (origins === null) {
		line('warn', 'workers/telemetry/.dev.vars missing (created automatically by npm run telemetry:dev)');
	} else if (origins.includes(ASTRO_ORIGINS[0])) {
		line('ok', `.dev.vars ALLOWED_ORIGINS includes ${ASTRO_ORIGINS[0]}`);
	} else {
		line('fail', `.dev.vars ALLOWED_ORIGINS does not include ${ASTRO_ORIGINS[0]} (browser requests would get 403)`);
	}

	// Local DB
	let dbOk = false;
	try {
		const s = dbStatus();
		if (!s.exists) line('fail', 'Local DB not created. Run: npm run telemetry:db:init');
		else if (s.missing.length) line('fail', `Local DB missing table(s): ${s.missing.join(', ')}. Run: npm run telemetry:db:init`);
		else {
			dbOk = true;
			line('ok', `Local DB ready (${s.counts.sessions} sessions, ${s.counts.events} events)`);
		}
	} catch (e) {
		line('fail', `Local DB unreadable: ${e.message}`);
	}

	// Running processes (informational: not required for the check to pass)
	const workerUp = await portOpen(WORKER_PORT);
	if (workerUp) {
		try {
			const res = await fetch(ENDPOINT, {
				method: 'OPTIONS',
				headers: {
					Origin: ASTRO_ORIGINS[0],
					'Access-Control-Request-Method': 'POST',
					'Access-Control-Request-Headers': 'content-type',
				},
			});
			const allow = res.headers.get('access-control-allow-origin');
			line(
				allow === ASTRO_ORIGINS[0] ? 'ok' : 'fail',
				allow === ASTRO_ORIGINS[0]
					? `Worker running on :${WORKER_PORT}; CORS preflight allows ${ASTRO_ORIGINS[0]}`
					: `Worker running on :${WORKER_PORT} but preflight from ${ASTRO_ORIGINS[0]} gave status ${res.status}, allow-origin=${allow}. Restart telemetry:dev after editing .dev.vars.`,
			);
		} catch (e) {
			line('warn', `Worker port open but preflight failed: ${e.message}`);
		}
	} else {
		line('info', `Worker not running on :${WORKER_PORT} (start: npm run telemetry:dev)`);
	}
	line('info', (await portOpen(ASTRO_PORT)) ? `Something is listening on :${ASTRO_PORT} (Astro)` : `Astro not running on :${ASTRO_PORT} (start: npm run dev:telemetry)`);

	out(`\n${bad ? `${bad} problem(s) found.` : dbOk ? 'Ready.' : 'Not ready.'}\n`);
	out(COMMANDS_BLOCK);
	process.exitCode = bad ? 1 : 0;
}

// --------------------------------------------------------------------- main

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
	'db-init': cmdDbInit,
	'db-check': () => process.exit(cmdDbCheck() ? 0 : 1),
	dev: cmdWorkerDev,
	astro: cmdAstroDev,
	sessions: () => cmdSessions(rest),
	events: () => cmdEvents(rest),
	viewport: () => cmdViewport(rest),
	clear: cmdClear,
	check: cmdCheck,
};
if (!commands[cmd]) die(`Usage: node scripts/telemetry.mjs <${Object.keys(commands).join('|')}>`);
try {
	await commands[cmd]();
} catch (e) {
	die(e.message);
}
