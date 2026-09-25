// mentor-telemetry Worker: POST /v1/batch -> D1 (binding DB).
// Specification: docs/telemetry.md

import { LIMITS, TELEMETRY_VERSION, validateBatch } from './validate.ts';
import type { EventRow, SessionRow } from './validate.ts';

export interface Env {
  DB: D1Database;
  /** Optional comma-separated extra browser origins (development/testing only). */
  ALLOWED_ORIGINS?: string;
}

const PRODUCTION_ORIGIN = 'https://mentorgamestudio.com';

const SESSION_SQL = `INSERT OR IGNORE INTO sessions (
  session_id, started_at, referrer, utm_source, utm_medium, utm_campaign, utm_content,
  viewport_width, viewport_height, screen_width, screen_height,
  primary_pointer_coarse, primary_pointer_fine, any_pointer_coarse, any_pointer_fine,
  hover_capable, touch_capable, country, telemetry_version, site_version
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const EVENT_SQL = `INSERT OR IGNORE INTO events (
  session_id, event_id, occurred_at, elapsed_ms, event_type, target_type, target_id,
  appearance_id, view_instance_id, v50_ms, v70_ms, v85_ms, v95_ms, max_visibility_ratio,
  playing_ms, playing_v50_ms, playing_v70_ms, playing_v85_ms, playing_v95_ms,
  properties, telemetry_version
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function allowedOrigins(env: Env): Set<string> {
  const set = new Set([PRODUCTION_ORIGIN]);
  for (const o of (env.ALLOWED_ORIGINS ?? '').split(',')) {
    const t = o.trim();
    if (t) set.add(t);
  }
  return set;
}

/** CORS only tells browsers which sites may read responses. It is not authentication;
 *  non-browser clients can send any Origin (or none), so all validation still applies. */
function corsHeaders(origin: string | null, allowed: Set<string>): Record<string, string> {
  const h: Record<string, string> = { Vary: 'Origin' };
  if (origin !== null && allowed.has(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function respond(
  status: number,
  body: unknown,
  cors: Record<string, string>,
  extra: Record<string, string> = {},
): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...cors,
      ...extra,
    },
  });
}

const error = (
  status: number,
  code: string,
  cors: Record<string, string>,
  detail?: string,
  extra?: Record<string, string>,
) => respond(status, detail ? { error: code, detail } : { error: code }, cors, extra);

/** Reads the body up to a hard byte cap, independent of any Content-Length header. */
async function readBounded(request: Request, max: number): Promise<string | null> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && Number(declared) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(all);
}

/** Coarse country from Cloudflare's own request metadata only. Never the raw IP. */
function countryOf(request: Request): string | null {
  const c = (request as Request & { cf?: { country?: unknown } }).cf?.country;
  // "XX" = unknown, "T1" = Tor
  return typeof c === 'string' && /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : null;
}

function sessionStatement(db: D1Database, s: SessionRow, country: string | null) {
  return db.prepare(SESSION_SQL).bind(
    s.session_id, s.started_at, s.referrer, s.utm_source, s.utm_medium, s.utm_campaign,
    s.utm_content, s.viewport_width, s.viewport_height, s.screen_width, s.screen_height,
    s.primary_pointer_coarse, s.primary_pointer_fine, s.any_pointer_coarse,
    s.any_pointer_fine, s.hover_capable, s.touch_capable, country, TELEMETRY_VERSION,
    s.site_version,
  );
}

function eventStatement(db: D1Database, sessionId: string, e: EventRow) {
  return db.prepare(EVENT_SQL).bind(
    sessionId, e.event_id, e.occurred_at, e.elapsed_ms, e.event_type, e.target_type,
    e.target_id, e.appearance_id, e.view_instance_id, e.v50_ms, e.v70_ms, e.v85_ms,
    e.v95_ms, e.max_visibility_ratio, e.playing_ms, e.playing_v50_ms, e.playing_v70_ms,
    e.playing_v85_ms, e.playing_v95_ms, e.properties, TELEMETRY_VERSION,
  );
}

async function handleBatch(request: Request, env: Env, cors: Record<string, string>) {
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    return error(415, 'unsupported_media_type', cors);
  }

  let text: string | null;
  try {
    text = await readBounded(request, LIMITS.maxBodyBytes);
  } catch {
    return error(400, 'invalid_body', cors);
  }
  if (text === null) return error(413, 'payload_too_large', cors);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return error(400, 'invalid_json', cors);
  }

  const result = validateBatch(json);
  if (!result.ok) return error(400, 'invalid_payload', cors, result.detail);
  const { session_id, session, events } = result.value;

  const statements: D1PreparedStatement[] = [];
  if (session) statements.push(sessionStatement(env.DB, session, countryOf(request)));
  for (const e of events) statements.push(eventStatement(env.DB, session_id, e));

  try {
    // D1 batch() runs as one transaction: all statements apply or none do.
    await env.DB.batch(statements);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    // Events for a session that has not been created yet (missing creation batch).
    if (/FOREIGN KEY/i.test(message)) return error(409, 'unknown_session', cors);
    console.error('d1 batch failed', message.slice(0, 300));
    return error(500, 'internal_error', cors);
  }
  return respond(200, { ok: true }, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = allowedOrigins(env);
    const cors = corsHeaders(origin, allowed);

    if (url.pathname !== '/v1/batch') return error(404, 'not_found', cors);

    // A present-but-unlisted Origin is a browser on another site. Absent Origin
    // means a non-browser client, which CORS cannot and does not try to police.
    if (origin !== null && !allowed.has(origin)) return error(403, 'origin_not_allowed', cors);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (request.method !== 'POST') return error(405, 'method_not_allowed', cors, undefined, { Allow: 'POST, OPTIONS' });

    return handleBatch(request, env, cors);
  },
} satisfies ExportedHandler<Env>;
