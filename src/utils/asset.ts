/**
 * Prepends Astro's configured BASE_URL to a public-directory path so assets
 * resolve correctly when the site is deployed to a sub-path (e.g. GitHub Pages
 * project pages at /repo-name/).  External URLs (http/https/protocol-relative)
 * are returned unchanged.
 */
export function asset(path: string): string {
	if (!path || path.includes('://') || path.startsWith('//')) return path;
	const base = import.meta.env.BASE_URL; // '/' in production
	return base.endsWith('/') ? base + path.replace(/^\//, '') : base + path;
}
