/** Kebab-case a skill label into a safe token for `data-*` attribute matching. */
export function slugify(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}
