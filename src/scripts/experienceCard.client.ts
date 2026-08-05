/**
 * Experience showcase cards are collapsed by default. Clicking the toggle
 * expands a panel (pure-CSS grid-rows transition, see ExperienceCard.astro)
 * and — only on that first expand — lazily injects the actual embed (a
 * YouTube iframe, or a linked preview image) so no third-party request
 * fires until the user actually opens it.
 */

function youTubeVideoId(url: string): string | null {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.replace(/^www\./, '');

		if (host === 'youtu.be') {
			return parsed.pathname.slice(1) || null;
		}

		if (host === 'youtube.com' || host === 'm.youtube.com') {
			if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
			const shortsMatch = parsed.pathname.match(/^\/(shorts|embed)\/([^/]+)/);
			if (shortsMatch) return shortsMatch[2];
		}

		return null;
	} catch {
		return null;
	}
}

function buildEmbed(link: string, previewImage: string | undefined): HTMLElement {
	const videoId = youTubeVideoId(link);

	if (videoId) {
		const iframe = document.createElement('iframe');
		iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}`;
		iframe.title = 'Showcase video';
		iframe.loading = 'lazy';
		iframe.allow = 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
		iframe.allowFullscreen = true;
		iframe.setAttribute('frameborder', '0');
		return iframe;
	}

	const anchor = document.createElement('a');
	anchor.href = link;
	anchor.target = '_blank';
	anchor.rel = 'noopener noreferrer';

	if (previewImage) {
		const img = document.createElement('img');
		img.src = previewImage;
		img.alt = 'Showcase preview';
		img.loading = 'lazy';
		anchor.appendChild(img);
	} else {
		anchor.textContent = `Open showcase ↗`;
	}

	return anchor;
}

function init() {
	document.addEventListener('click', (event) => {
		const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>('.showcase-toggle');
		if (!toggle) return;

		const expanded = toggle.getAttribute('aria-expanded') === 'true';
		toggle.setAttribute('aria-expanded', String(!expanded));

		if (expanded) return;

		const container = toggle.parentElement?.querySelector<HTMLElement>('[data-showcase-embed]');
		if (!container || container.childElementCount > 0) return;

		const link = container.dataset.link;
		if (!link) return;

		container.appendChild(buildEmbed(link, container.dataset.previewImage));
	});
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}

export {};
