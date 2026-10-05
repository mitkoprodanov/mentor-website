/**
 * Partner / publisher / IP-owner / studio logos as their own reusable resource.
 *
 *   logo id  →  logo definition (image + display hints)
 *   company / project  →  optional `logoId`
 *
 * A logo is defined ONCE here and any number of projects and/or companies may
 * reference it by id (`ProjectDef.logoId`, `CompanyDef.logoId` in data/timeline.ts).
 * References are explicit — a project never silently inherits its company's logo.
 *
 * The id is also the canonical telemetry identity of the logo
 * (`partner_logo` / `<logo id>`, see docs/telemetry.md 17.9): never the image
 * path, filename or URL, and independent of whichever project/company shows it.
 *
 * To add a logo: drop the asset under /public/logos/, add its id to `LogoId`
 * and a matching entry in `logos`, then reference it with `logoId`. Ids must
 * match `[A-Za-z0-9_.:-]{1,64}` (the Worker's target id rule).
 */

export type LogoId = 'riot-games' | 'primal' | 'black-hole' | 'flying-wild-hog';

/**
 * How the dark site background is eased into a logo's own rectangle (see
 * components/common/LogoPlate.astro for what each looks like). Presentation only.
 */
export type LogoTransition =
	| 'none'
	| 'single'
	| 'double'
	| 'double-wide'
	| 'double-line'
	| 'gradient-full'
	| 'gradient-mid'
	| 'hybrid'
	| 'feather'
	| 'halo'
	| 'soft-double';

/** The one switch for the logo transition treatment, site-wide. */
export const DEFAULT_LOGO_TRANSITION: LogoTransition = 'test';

/** Global multiplier for every logo band width (1 = the base widths listed in LogoPlate.astro). */
export const DEFAULT_LOGO_BAND_SCALE = 1;

export interface LogoDef {
	id: LogoId;
	/** Path under /public (e.g. '/logos/riot/riot-games-lockup-red.png'). */
	src: string;
	/** Width in CSS pixels for the small badge on the Timeline preview node. Default: 80. */
	previewWidth?: number;
	/** Width in CSS pixels for the modal-header display. Default: 130. */
	detailWidth?: number;
	/** Height in CSS pixels when shown beside a company name in a company box header. Default: 26. */
	headerHeight?: number;
	/**
	 * A backing plate behind the artwork where it needs one on the dark site:
	 *   - 'light': an off-white plate, for dark artwork on a transparent background;
	 *   - 'black': a pure-black plate, for light/white artwork on a transparent background.
	 * Omit when the artwork carries its own background or reads fine on the page.
	 */
	plate?: 'light' | 'black';
}

export const logos: Record<LogoId, LogoDef> = {
	'riot-games': {
		id: 'riot-games',
		src: '/logos/riot/riot-games-lockup-red.png',
		previewWidth: 120,
		detailWidth: 150,
		plate: 'black',
	},
	// Dark wordmark on a transparent background → needs a light plate.
	primal: {
		id: 'primal',
		src: '/logos/primal/primal-game-studio.png',
		headerHeight: 24,
		plate: 'light',
	},
	// Ships with its own black background.
	'black-hole': {
		id: 'black-hole',
		src: '/logos/black-hole/black-hole-entertainment.png',
		headerHeight: 26,
	},
	// White artwork on a transparent background → pure-black plate.
	'flying-wild-hog': {
		id: 'flying-wild-hog',
		src: '/logos/flying-wild-hog/flying-wild-hog-white.png',
		headerHeight: 34,
		plate: 'black',
	},
};

/** Looks up a logo definition by id. Unknown/absent ids yield undefined. */
export function getLogo(id: string | null | undefined): LogoDef | undefined {
	return id && Object.prototype.hasOwnProperty.call(logos, id) ? logos[id as LogoId] : undefined;
}

/** Resolves the logo an owner (a `ProjectDef` or `CompanyDef`) explicitly references, if any. */
export function resolveLogo(owner: { logoId?: LogoId | string } | null | undefined): LogoDef | undefined {
	return getLogo(owner?.logoId);
}
