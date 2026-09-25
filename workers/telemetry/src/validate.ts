// Strict validation for POST /v1/batch. See docs/telemetry.md sections 13-16.
// Only explicitly known fields are accepted; anything else is rejected, so
// arbitrary request data is never persisted.

export const TELEMETRY_VERSION = 1;

export const LIMITS = {
  maxBodyBytes: 64 * 1024,
  maxEvents: 100,
  maxDeltaMs: 10 * 60 * 1000,
  maxElapsedMs: 24 * 60 * 60 * 1000,
  maxDimension: 20000,
  maxReferrer: 512,
  maxUtm: 128,
  maxPropertiesBytes: 2048,
  maxPropertyKeys: 20,
  maxPropertyString: 200,
} as const;

export const EVENT_TYPES = new Set([
  'session_start',
  'viewport_changed',
  'skills_open',
  'skills_lock',
  'skills_unlock',
  'skills_close',
  'skill_filter_open',
  'skill_filter_close',
  'project_open',
  'project_close',
  'nav_click',
  'skill_click',
  'cv_download',
  'linkedin_click',
  'contact_email_copy',
  'contact_email_open',
  'external_link_click',
  'video_start',
  'context_menu',
  'noninteractive_click',
  'repeated_noninteractive_click',
  'visibility_delta',
]);

export interface SessionRow {
  session_id: string;
  started_at: string;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  viewport_width: number | null;
  viewport_height: number | null;
  screen_width: number | null;
  screen_height: number | null;
  primary_pointer_coarse: 0 | 1;
  primary_pointer_fine: 0 | 1;
  any_pointer_coarse: 0 | 1;
  any_pointer_fine: 0 | 1;
  hover_capable: 0 | 1;
  touch_capable: 0 | 1;
  site_version: string | null;
}

export interface EventRow {
  event_id: string;
  occurred_at: string;
  elapsed_ms: number;
  event_type: string;
  target_type: string | null;
  target_id: string | null;
  appearance_id: string | null;
  view_instance_id: string | null;
  v50_ms: number | null;
  v70_ms: number | null;
  v85_ms: number | null;
  v95_ms: number | null;
  max_visibility_ratio: number | null;
  playing_ms: number | null;
  playing_v50_ms: number | null;
  playing_v70_ms: number | null;
  playing_v85_ms: number | null;
  playing_v95_ms: number | null;
  properties: string | null;
}

export interface ValidBatch {
  session_id: string;
  /** Present only when the batch carries full session-creation fields. */
  session: SessionRow | null;
  events: EventRow[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; detail: string };

class Invalid extends Error {}

const fail = (path: string, why: string): never => {
  throw new Invalid(`${path}: ${why}`);
};

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const TARGET_TYPE_RE = /^[a-z][a-z0-9_]{0,39}$/;
const TARGET_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const SITE_VERSION_RE = /^[A-Za-z0-9._+-]{1,40}$/;
const PROP_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function allowKeys(o: Obj, allowed: readonly string[], path: string): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) fail(path, `unknown field "${k}"`);
  }
}

function idField(o: Obj, key: string, path: string, required: boolean): string | null {
  const v = o[key];
  if (v === undefined || v === null) {
    if (required) fail(`${path}.${key}`, 'required');
    return null;
  }
  if (typeof v !== 'string' || !ID_RE.test(v)) fail(`${path}.${key}`, 'invalid id');
  return v as string;
}

function patternField(
  o: Obj, key: string, re: RegExp, path: string, required: boolean,
): string | null {
  const v = o[key];
  if (v === undefined || v === null) {
    if (required) fail(`${path}.${key}`, 'required');
    return null;
  }
  if (typeof v !== 'string' || !re.test(v)) fail(`${path}.${key}`, 'invalid format');
  return v as string;
}

function intField(
  o: Obj, key: string, max: number, path: string, required: boolean,
): number | null {
  const v = o[key];
  if (v === undefined || v === null) {
    if (required) fail(`${path}.${key}`, 'required');
    return null;
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) {
    fail(`${path}.${key}`, `must be an integer 0..${max}`);
  }
  return v as number;
}

function boolField(o: Obj, key: string, path: string): 0 | 1 {
  const v = o[key];
  if (typeof v !== 'boolean') fail(`${path}.${key}`, 'must be a boolean');
  return v ? 1 : 0;
}

function timestampField(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length > 40 || !ISO_RE.test(v)) {
    fail(`${path}.${key}`, 'must be an ISO 8601 timestamp');
  }
  const d = new Date(v as string);
  const year = d.getUTCFullYear();
  if (Number.isNaN(d.getTime()) || year < 2020 || year > 2100) {
    fail(`${path}.${key}`, 'timestamp out of range');
  }
  return d.toISOString();
}

/** Free-form context strings are truncated rather than rejected so that a long
 *  referrer or UTM value cannot make the whole batch fail. */
function looseString(o: Obj, key: string, max: number, path: string): string | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') fail(`${path}.${key}`, 'must be a string');
  const s = (v as string).slice(0, max);
  return s === '' ? null : s;
}

const SESSION_MINIMAL = ['session_id', 'telemetry_version'] as const;
const SESSION_CREATE = [
  ...SESSION_MINIMAL,
  'started_at', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
  'viewport_width', 'viewport_height', 'screen_width', 'screen_height',
  'primary_pointer_coarse', 'primary_pointer_fine', 'any_pointer_coarse',
  'any_pointer_fine', 'hover_capable', 'touch_capable', 'site_version',
] as const;

function parseSession(raw: unknown): { session_id: string; row: SessionRow | null } {
  if (!isObj(raw)) return fail('session', 'must be an object');
  const p = 'session';
  const creating = 'started_at' in raw;
  allowKeys(raw, creating ? SESSION_CREATE : SESSION_MINIMAL, p);

  if (raw.telemetry_version !== TELEMETRY_VERSION) {
    fail(`${p}.telemetry_version`, `must be ${TELEMETRY_VERSION}`);
  }
  const session_id = idField(raw, 'session_id', p, true) as string;
  if (!creating) return { session_id, row: null };

  return {
    session_id,
    row: {
      session_id,
      started_at: timestampField(raw, 'started_at', p),
      referrer: looseString(raw, 'referrer', LIMITS.maxReferrer, p),
      utm_source: looseString(raw, 'utm_source', LIMITS.maxUtm, p),
      utm_medium: looseString(raw, 'utm_medium', LIMITS.maxUtm, p),
      utm_campaign: looseString(raw, 'utm_campaign', LIMITS.maxUtm, p),
      utm_content: looseString(raw, 'utm_content', LIMITS.maxUtm, p),
      viewport_width: intField(raw, 'viewport_width', LIMITS.maxDimension, p, false),
      viewport_height: intField(raw, 'viewport_height', LIMITS.maxDimension, p, false),
      screen_width: intField(raw, 'screen_width', LIMITS.maxDimension, p, false),
      screen_height: intField(raw, 'screen_height', LIMITS.maxDimension, p, false),
      primary_pointer_coarse: boolField(raw, 'primary_pointer_coarse', p),
      primary_pointer_fine: boolField(raw, 'primary_pointer_fine', p),
      any_pointer_coarse: boolField(raw, 'any_pointer_coarse', p),
      any_pointer_fine: boolField(raw, 'any_pointer_fine', p),
      hover_capable: boolField(raw, 'hover_capable', p),
      touch_capable: boolField(raw, 'touch_capable', p),
      site_version: patternField(raw, 'site_version', SITE_VERSION_RE, p, false),
    },
  };
}

const EVENT_KEYS = [
  'event_id', 'occurred_at', 'elapsed_ms', 'event_type',
  'target_type', 'target_id', 'appearance_id', 'view_instance_id',
  'v50_ms', 'v70_ms', 'v85_ms', 'v95_ms', 'max_visibility_ratio',
  'playing_ms', 'playing_v50_ms', 'playing_v70_ms', 'playing_v85_ms', 'playing_v95_ms',
  'properties',
] as const;

const MEASUREMENT_KEYS = [
  'v50_ms', 'v70_ms', 'v85_ms', 'v95_ms', 'max_visibility_ratio',
  'playing_ms', 'playing_v50_ms', 'playing_v70_ms', 'playing_v85_ms', 'playing_v95_ms',
] as const;

/** Nested thresholds: each present value must not exceed the previous present one. */
function checkNested(vals: (number | null)[], names: string[], path: string): void {
  let prev: number | null = null;
  vals.forEach((v, i) => {
    if (v === null) return;
    if (prev !== null && v > prev) fail(`${path}.${names[i]}`, 'exceeds a lower threshold');
    prev = v;
  });
}

function parseProperties(raw: unknown, path: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) return fail(path, 'must be an object');
  const keys = Object.keys(raw);
  if (keys.length > LIMITS.maxPropertyKeys) fail(path, 'too many keys');
  const clean: Obj = {};
  for (const k of keys) {
    if (!PROP_KEY_RE.test(k)) fail(path, `invalid key "${k.slice(0, 40)}"`);
    const v = raw[k];
    if (typeof v === 'string') {
      if (v.length > LIMITS.maxPropertyString) fail(`${path}.${k}`, 'string too long');
    } else if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail(`${path}.${k}`, 'must be finite');
    } else if (typeof v !== 'boolean' && v !== null) {
      fail(`${path}.${k}`, 'must be a string, number, boolean or null');
    }
    clean[k] = v;
  }
  if (keys.length === 0) return null;
  const json = JSON.stringify(clean);
  if (new TextEncoder().encode(json).length > LIMITS.maxPropertiesBytes) {
    fail(path, 'too large');
  }
  return json;
}

function parseEvent(raw: unknown, path: string): EventRow {
  if (!isObj(raw)) return fail(path, 'must be an object');
  allowKeys(raw, EVENT_KEYS, path);

  const event_type = raw.event_type;
  if (typeof event_type !== 'string' || !EVENT_TYPES.has(event_type)) {
    fail(`${path}.event_type`, 'unknown event type');
  }
  const isVisibility = event_type === 'visibility_delta';
  if (!isVisibility) {
    for (const k of MEASUREMENT_KEYS) {
      if (raw[k] !== undefined && raw[k] !== null) {
        fail(`${path}.${k}`, 'only allowed on visibility_delta');
      }
    }
  }

  const target_type = patternField(raw, 'target_type', TARGET_TYPE_RE, path, isVisibility);
  const target_id = patternField(raw, 'target_id', TARGET_ID_RE, path, isVisibility);
  if ((target_type === null) !== (target_id === null)) {
    fail(path, 'target_type and target_id must be provided together');
  }

  const d = LIMITS.maxDeltaMs;
  const v50_ms = intField(raw, 'v50_ms', d, path, false);
  const v70_ms = intField(raw, 'v70_ms', d, path, false);
  const v85_ms = intField(raw, 'v85_ms', d, path, false);
  const v95_ms = intField(raw, 'v95_ms', d, path, false);
  const playing_ms = intField(raw, 'playing_ms', d, path, false);
  const playing_v50_ms = intField(raw, 'playing_v50_ms', d, path, false);
  const playing_v70_ms = intField(raw, 'playing_v70_ms', d, path, false);
  const playing_v85_ms = intField(raw, 'playing_v85_ms', d, path, false);
  const playing_v95_ms = intField(raw, 'playing_v95_ms', d, path, false);
  checkNested([v50_ms, v70_ms, v85_ms, v95_ms], ['v50_ms', 'v70_ms', 'v85_ms', 'v95_ms'], path);
  checkNested(
    [playing_ms, playing_v50_ms, playing_v70_ms, playing_v85_ms, playing_v95_ms],
    ['playing_ms', 'playing_v50_ms', 'playing_v70_ms', 'playing_v85_ms', 'playing_v95_ms'],
    path,
  );

  let max_visibility_ratio: number | null = null;
  const ratio = raw.max_visibility_ratio;
  if (ratio !== undefined && ratio !== null) {
    if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      fail(`${path}.max_visibility_ratio`, 'must be a number 0..1');
    }
    max_visibility_ratio = ratio as number;
  }

  return {
    event_id: idField(raw, 'event_id', path, true) as string,
    occurred_at: timestampField(raw, 'occurred_at', path),
    elapsed_ms: intField(raw, 'elapsed_ms', LIMITS.maxElapsedMs, path, true) as number,
    event_type: event_type as string,
    target_type,
    target_id,
    appearance_id: idField(raw, 'appearance_id', path, false),
    view_instance_id: idField(raw, 'view_instance_id', path, false),
    v50_ms, v70_ms, v85_ms, v95_ms, max_visibility_ratio,
    playing_ms, playing_v50_ms, playing_v70_ms, playing_v85_ms, playing_v95_ms,
    properties: parseProperties(raw.properties, `${path}.properties`),
  };
}

export function validateBatch(body: unknown): Result<ValidBatch> {
  try {
    if (!isObj(body)) return fail('body', 'must be an object');
    allowKeys(body, ['session', 'events'], 'body');
    const { session_id, row } = parseSession(body.session);

    const rawEvents = body.events ?? [];
    if (!Array.isArray(rawEvents)) return fail('events', 'must be an array');
    if (rawEvents.length > LIMITS.maxEvents) {
      return fail('events', `at most ${LIMITS.maxEvents} per batch`);
    }
    if (row === null && rawEvents.length === 0) return fail('body', 'nothing to record');

    const seen = new Set<string>();
    const events = rawEvents.map((e, i) => {
      const ev = parseEvent(e, `events[${i}]`);
      // A duplicate inside one batch is a client bug; INSERT OR IGNORE would hide it.
      if (seen.has(ev.event_id)) fail(`events[${i}].event_id`, 'duplicate within batch');
      seen.add(ev.event_id);
      return ev;
    });

    return { ok: true, value: { session_id, session: row, events } };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, detail: e.message };
    throw e;
  }
}
