# Woody — Carpenter's Plans (תוכניות נגרות)

Web app (Hebrew, RTL) that turns a parametric furniture design into a complete
IKEA-style build plan: 3D and dimensioned views, numbered parts with lettered
hole drawings and hole tables, step-by-step assembly pictures (new parts in
orange, already-built parts greyed, screws drawn), an optimised cut plan, a
shopping list with icons, a tools list, and a cost estimate from the lumber your
local yard sells.

Live at https://woody.gallab.top (private instance, behind a shared Google sign-in).

## Features

- **Wizard**: pick a design family (table / bench, cabinet, planter, shelves, pergola, saw jig),
  then the space, the sizes and the wood, in four steps.
- **Lumber catalog** (`app/catalog/default-catalog.json`): the profiles and stock lengths your yard
  sells; the plan maps every board to a real profile and can fit a plan to wood you already have.
- **Cut plan**: parts packed onto stock lengths, kerf and end-trim aware.
- **Cost estimate**: wood, screws, extras (wheels, hooks…) and finish.
- **Build plan**: parts list, hole drawings, assembly steps with a 3D viewer per step, printable.

## Stack

Vanilla JavaScript ES modules, SVG drawings, a three.js viewer with an SVG fallback
when WebGL is missing, PWA with a service worker for offline use. No build step,
no dependencies to install.

## Run

```bash
node app/server.mjs 8765          # the repo's own launcher (serves app/ without caching)
python -m http.server --directory app   # also works
```

Open the address the command prints. On Windows `start.bat` does the same and
opens the browser. Do not open `index.html` straight from the disk: browsers
block the module scripts and the 3D viewer when a page is loaded as a file.

Headless check of every design in `app/designs/index.json` (parts, cut plan,
warnings, writes SVGs to `app/test/out/`):

```bash
node app/test/run.mjs
```

## Projects and storage

The home screen lists every project: the built-in designs plus any design file
you import with "פרויקט חדש". Each project remembers its own sizes, space, lumber
mapping and photo.

Projects sync through the hub's document store (one shared JSON document, newer
change wins per key) with a copy in the browser for offline use; a backup / restore
to a file is also built in (`app/js/app.js`, `setupBackup`).

## Saw — saved posts and videos (`app/saw/`)

`woody.gallab.top/saw` is a small library of woodworking posts found on Facebook,
Instagram, YouTube, TikTok or blogs. Paste a link (or, on the phone, share the post
to Woody: the manifest's `share_target` opens `/saw/?url=…`; an iPhone Shortcut opens
`/saw/#url=…` instead, because the login gate drops the query string when it bounces
a request through auth.gallab.top) and the page asks
Kort's importer (`POST /api/saw/enrich`, proxied by `deploy/woody.caddy` to Kort on
port 8787) for the caption, a thumbnail copy and a short Hebrew summary with type,
tags, materials, tools and key points. Only links are kept, never the video. Cards
can be edited, tagged, starred, marked "want to build" / "built", filtered and
searched. The library is one shared family document in the hub store
(`/api/family/saw`); when two devices disagree the newer item wins.

Built-in designs (`app/designs/index.json`):

| id | name |
|---|---|
| `potting-bench` | שולחן גינה עם קיר כלים ומדף |
| `irrigation-cabinet` | ארון השקיה (שלבים) |
| `rolling-table` | שולחן עבודה על גלגלים |
| `planter-box` | אדנית עץ |
| `shelf-unit` | יחידת מדפים |
| `pergola-leanto` | פרגולה צמודה לקיר |
| `crosscut-jig` | התקן חיתוך ישר למסור עגול |

## Design file format (`app/designs/*.json`)

Every board is an axis-aligned box whose `at` and `size` are expressions over
the parameters, `derived` values, profile sections (`rail_t`, `rail_w`…) and
space fields (`wall_width`…). The engine then:

- detects every face-to-face contact and chooses the fastening (which board the
  screw goes through, screw size, countersink / counterbore, pilot hole),
- gives identical boards one part number; mirror-image boards (left/right legs)
  are variants א/ב of the same number,
- packs parts onto stock lengths (kerf + end trim aware), prices wood, screws,
  `extras` (wheels, hooks…) and finish, and builds the assembly steps.

`joints` overrides force direction (`through`), screw `count`, or disable a
joint (`method: "none"`). `steps` list which part ids are added in each step.

## Adding a project from a photo

Describe the piece (a photo plus the sizes you want) to an LLM assistant and have
it write a design JSON in this format, run
`node app/test/run.mjs app/designs/<id>.json` until there are no collision or
screw warnings, and add the id to `app/designs/index.json`.

## Deploy

A push to `master` runs `.github/workflows/deploy.yml`: it syntax-checks the
scripts, runs the headless design tests, then syncs `app/` to a static site
behind Caddy (`deploy/woody.caddy`) and smoke-tests the URL. `release.ps1` is
the local wrapper that runs the same checks, bumps the version stamp in
`index.html` and `sw.js` (so phones pick up the update) and pushes.
