// In-memory event queue. Events keep the ID they were created with, so a
// retried batch is the same events and the Worker's UNIQUE(session_id,
// event_id) makes redelivery harmless.

import { randomId } from './session.ts';
import type { EmitOptions, TelemetryEvent } from './types.ts';

/** Hard cap so a dead endpoint cannot grow memory. When full, NEW events are
 *  rejected; already-recorded chronology is never deleted. */
export const MAX_QUEUED = 500;

export interface Clock {
	/** Monotonic milliseconds (performance.now()). */
	now(): number;
	/** Wall clock as an ISO 8601 string. */
	iso(): string;
}

export const browserClock: Clock = {
	now: () => performance.now(),
	iso: () => new Date().toISOString(),
};

export class EventQueue {
	private items: TelemetryEvent[] = [];
	private readonly clock: Clock;
	private readonly origin: number;
	private readonly newId: () => string | null;
	private readonly onOverflow: () => void;
	private warned = false;

	/** `origin` is the monotonic time of session start; elapsed_ms counts from it. */
	constructor(
		clock: Clock,
		origin: number,
		newId: () => string | null = randomId,
		onOverflow: () => void = () => {},
	) {
		this.clock = clock;
		this.origin = origin;
		this.newId = newId;
		this.onOverflow = onOverflow;
	}

	get length(): number {
		return this.items.length;
	}

	/** Creates and enqueues an event. Returns null if the queue is full or no ID
	 *  could be generated. */
	emit(eventType: string, opts: EmitOptions = {}): TelemetryEvent | null {
		if (this.items.length >= MAX_QUEUED) {
			if (!this.warned) {
				this.warned = true;
				this.onOverflow();
			}
			return null;
		}
		const id = this.newId();
		if (!id) return null;
		const ev: TelemetryEvent = {
			event_id: id,
			occurred_at: this.clock.iso(),
			elapsed_ms: Math.max(0, Math.round(this.clock.now() - this.origin)),
			event_type: eventType,
		};
		if (opts.target_type !== undefined && opts.target_id !== undefined) {
			ev.target_type = opts.target_type;
			ev.target_id = opts.target_id;
		}
		if (opts.properties) ev.properties = opts.properties;
		this.items.push(ev);
		return ev;
	}

	/** The next events to send, without removing them. Stops before `maxBytes` of JSON. */
	peek(maxEvents: number, maxBytes: number): TelemetryEvent[] {
		const out: TelemetryEvent[] = [];
		let bytes = 0;
		for (const ev of this.items) {
			if (out.length >= maxEvents) break;
			const size = JSON.stringify(ev).length + 1;
			if (out.length > 0 && bytes + size > maxBytes) break;
			out.push(ev);
			bytes += size;
		}
		return out;
	}

	/** Removes exactly the given (acknowledged or permanently rejected) events. */
	remove(sent: readonly TelemetryEvent[]): void {
		const gone = new Set(sent);
		this.items = this.items.filter((e) => !gone.has(e));
	}
}
