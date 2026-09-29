// Pure, DOM-free flows for user actions whose failure our own code can
// objectively observe (docs/telemetry.md sections 17.9 / `action_failed`).
// Success/failure is decided here once, so the UI state (checkmark) and the
// telemetry event can never contradict each other.

export type CopyFailureReason = 'clipboard_denied' | 'clipboard_unavailable' | 'copy_failed';
export type CopyResult = { ok: true } | { ok: false; reason: CopyFailureReason };

export interface CopyEnv {
	clipboard?: { writeText?: (text: string) => Promise<void> } | null;
	/** `document.execCommand('copy')`-style fallback; returns whether the browser reported success. */
	legacyCopy: (text: string) => boolean;
}

const safeLegacy = (env: CopyEnv, text: string): boolean => {
	try {
		return env.legacyCopy(text) === true;
	} catch {
		return false;
	}
};

/** Tries the async Clipboard API, then the legacy fallback. `ok` is true only when
 *  the FINAL mechanism succeeded — a rejected primary rescued by the fallback is a
 *  success. The failure reason is a closed enum; no exception message is exposed. */
export async function copyText(text: string, env: CopyEnv): Promise<CopyResult> {
	if (typeof env.clipboard?.writeText === 'function') {
		let name = '';
		try {
			await env.clipboard.writeText(text);
			return { ok: true };
		} catch (err) {
			name = String((err as { name?: unknown } | null)?.name ?? '');
		}
		if (safeLegacy(env, text)) return { ok: true };
		return { ok: false, reason: name === 'NotAllowedError' || name === 'SecurityError' ? 'clipboard_denied' : 'copy_failed' };
	}
	return safeLegacy(env, text) ? { ok: true } : { ok: false, reason: 'clipboard_unavailable' };
}

/** Runs the copy and reports through exactly one callback — success UI (checkmark)
 *  only ever runs from `onSuccess`. */
export async function copyWithFeedback(
	text: string,
	env: CopyEnv,
	cb: { onSuccess: () => void; onFailure: (reason: CopyFailureReason) => void },
): Promise<void> {
	const r = await copyText(text, env);
	if (r.ok) cb.onSuccess();
	else cb.onFailure(r.reason);
}

// ---- project open ---------------------------------------------------------------

export interface DialogLike {
	open: boolean;
	showModal(): void;
}
export type ProjectOpenFailureReason = 'dialog_not_found' | 'dialog_open_error';
export type ProjectOpenResult = { ok: true } | { ok: false; reason: ProjectOpenFailureReason };

/** Attempts to open the expected project dialog. Already-open is not a failure. */
export function attemptOpenProject(dialog: DialogLike | null | undefined): ProjectOpenResult {
	if (!dialog) return { ok: false, reason: 'dialog_not_found' };
	if (dialog.open) return { ok: true };
	try {
		dialog.showModal();
		return { ok: true };
	} catch {
		return { ok: false, reason: 'dialog_open_error' };
	}
}
