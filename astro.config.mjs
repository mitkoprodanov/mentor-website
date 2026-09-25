import { execSync } from 'node:child_process';
import { defineConfig } from 'astro/config';

// Telemetry `site_version`: the deployed commit's short SHA. GitHub Actions
// exposes GITHUB_SHA during the Pages build; locally fall back to git, then
// 'dev'. Must match the Worker's /^[A-Za-z0-9._+-]{1,40}$/.
function siteVersion() {
	const sha = process.env.GITHUB_SHA;
	if (sha) return sha.slice(0, 7);
	try {
		return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return 'dev';
	}
}

// https://astro.build/config
export default defineConfig({
	site: 'https://mentorgamestudio.com',
	vite: {
		define: {
			__SITE_VERSION__: JSON.stringify(siteVersion()),
		},
	},
});
