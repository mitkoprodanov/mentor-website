// Batching, delivery and retry policy. Knows about fetch and the Worker
// contract; knows nothing about the DOM or what the events mean.

import type { EventQueue } from './queue.ts';
import { TELEMETRY_VERSION } from './types.ts';
import type { Batch, SessionContext, SessionRef, TelemetryEvent } from './types.ts';

/** Worker limits are 100 events / 64 KiB; stay under both (and under the
 *  64 KiB keepalive cap). */
const MAX_BATCH_EVENTS = 100;
const MAX_BATCH_BYTES = 48 * 1024;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 5 * 60_000;

export type Fetch = (
	url: string,
	init: {
		method: 'POST';
		headers: Record<string, string>;
		body: string;
		keepalive: boolean;
		credentials: 'omit';
	},
) => Promise<{ ok: boolean; status: number }>;

export interface FlushOptions {
	/** Page-lifecycle delivery: use keepalive and ignore retry backoff. */
	lifecycle?: boolean;
}

export function buildBatch(
	session: SessionContext,
	sessionAcked: boolean,
	events: TelemetryEvent[],
): Batch {
	// Until the Worker acknowledges the creation batch, keep sending the full
	// context: session inserts are INSERT OR IGNORE, so resending is harmless.
	const ref: SessionRef = {
		session_id: session.session_id,
		telemetry_version: TELEMETRY_VERSION,
	};
	return { session: sessionAcked ? ref : session, events };
}

export class Transport {
	private sessionAcked = false;
	private inFlight = false;
	private rerun: FlushOptions | null = null;
	private failures = 0;
	private retryAt = 0;

	private readonly endpoint: string;
	private readonly session: SessionContext;
	private readonly queue: EventQueue;
	private readonly send: Fetch;
	private readonly now: () => number;
	private readonly log: (...args: unknown[]) => void;

	constructor(
		endpoint: string,
		session: SessionContext,
		queue: EventQueue,
		send: Fetch,
		now: () => number,
		log: (...args: unknown[]) => void = () => {},
	) {
		this.endpoint = endpoint;
		this.session = session;
		this.queue = queue;
		this.send = send;
		this.now = now;
		this.log = log;
	}

	/**
	 * Sends the queue in order, one request at a time. A call while a request is
	 * in flight schedules one follow-up flush instead of overlapping. Never
	 * rejects.
	 */
	async flush(opts: FlushOptions = {}): Promise<void> {
		if (this.inFlight) {
			this.rerun = { lifecycle: opts.lifecycle || this.rerun?.lifecycle };
			return;
		}
		if (!opts.lifecycle && this.now() < this.retryAt) return;

		this.inFlight = true;
		try {
			// Keep going while batches succeed; stop on the first failure.
			for (;;) {
				const events = this.queue.peek(MAX_BATCH_EVENTS, MAX_BATCH_BYTES);
				// Nothing pending: never send (lifecycle flushes included).
				if (events.length === 0) break;
				if (!(await this.sendOne(events, opts.lifecycle === true))) break;
			}
		} finally {
			this.inFlight = false;
		}
		const next = this.rerun;
		this.rerun = null;
		if (next) await this.flush(next);
	}

	/** True if the caller may immediately try the next batch. */
	private async sendOne(events: TelemetryEvent[], lifecycle: boolean): Promise<boolean> {
		const body = JSON.stringify(buildBatch(this.session, this.sessionAcked, events));
		let status = 0;
		try {
			const res = await this.send(this.endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				keepalive: lifecycle,
				credentials: 'omit',
			});
			status = res.status;
			if (res.ok) {
				this.sessionAcked = true;
				this.queue.remove(events);
				this.failures = 0;
				this.retryAt = 0;
				this.log('batch delivered', events.length);
				return true;
			}
		} catch (err) {
			this.log('network error', err);
		}

		if (status === 409) {
			// Worker does not know the session: resend the full context next time.
			this.sessionAcked = false;
		} else if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
			// Deterministic rejection: the same bytes can never succeed, and keeping
			// them would block every later event. Drop this batch only.
			this.log('batch rejected and dropped', status);
			this.queue.remove(events);
			return true;
		}
		this.failures += 1;
		const delay = Math.min(BACKOFF_BASE_MS * 2 ** (this.failures - 1), BACKOFF_MAX_MS);
		this.retryAt = this.now() + delay;
		this.log('batch failed, kept for retry', status, `backoff ${delay}ms`);
		return false;
	}
}
