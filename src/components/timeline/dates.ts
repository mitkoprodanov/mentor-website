/**
 * Split a company's `dateRange` ("2009 – 2012", "2022 – Present", "2025")
 * into its join (start) and leave (end) year, used to tick the top and bottom
 * edge of each timeline card. A single-year range repeats the same value.
 */
export function splitYears(dateRange: string): { start: string; end: string } {
	const parts = dateRange.split(/\s*[–-]\s*/);
	const start = (parts[0] ?? '').trim();
	const end = (parts[1] ?? parts[0] ?? '').trim();
	return { start, end };
}
