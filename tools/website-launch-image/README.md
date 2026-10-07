# Website launch image

Standalone HTML/CSS montage for the LinkedIn launch image (1200×627). No build step, no runtime dependency on the Astro site.

## Open it

`npm run social:launch-image` hosts it at http://localhost:4330/ with live reload — edit `style.css`, `index.html` or an asset and the browser refreshes itself. (`PORT=…` overrides the port.)

`npm run social:launch-image:render` exports the PNG to `output/linkedin-launch.png` and exits.

You can also just double-click `index.html`.

## Replace the source images

Overwrite these files in `assets/` (keep the names, or update the `<img src>` in `index.html`):

| File | Panel |
| --- | --- |
| `main-timeline.png` | shared-project/timeline, largest, centre-right |
| `adam-skills.png` | Ádám skills, smaller, left |
| `space-punks.png` | Space Punks, smaller, lower-right |

Screenshots are shown whole: width is set, height follows the image's own ratio. Nothing is cropped or `object-fit`ted.

## What controls position / size / tilt

In `style.css`, the `.panel--main`, `.panel--skills` and `.panel--punks` blocks:

- `--x`, `--y` — top-left position in canvas px
- `--w` — width in px (height follows)
- `--rot-y` — perspective turn; `--rot-z` — in-plane tilt
- `--z` — stacking order

Shared look (`:root`): `--panel-radius`, `--panel-frame-width`, `--panel-frame-color`, `--panel-glow`, `--panel-shadow`, `--perspective`. Canvas size: `--canvas-w`, `--canvas-h`. The backdrop is the `.bg` rule.

`output/` is for manual exports and is git-ignored.
