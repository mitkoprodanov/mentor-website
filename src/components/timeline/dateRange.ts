/**
 * Splits a company's `dateRange` string (e.g. "2009 – 2012", "2025",
 * "2026 – Present") into its start and end labels, so the timeline can render
 * a company's join (name + start) and leave (end) as separate, per-person
 * events at the top and bottom of the card rather than one combined range in
 * the header — see CompanyBlock.astro and ApartBlock.astro.
 *
 * A single-year range ("2025") yields the same value for both ends. The
 * separator is an en dash ("–"), matching the data in data/timeline.ts.
 */
export function parseDateRange(dateRange: string): { start: string; end: string } {
	const parts = dateRange.split('–').map((p) => p.trim());
	const start = parts[0] || dateRange.trim();
	const end = parts[parts.length - 1] || start;
	return { start, end };
}

/**
 * An engagement still in progress reads its end as "Present" — there's no
 * leave event yet, so no end label is shown for it.
 */
export function isOngoing(end: string): boolean {
	return end.trim().toLowerCase() === 'present';
}
