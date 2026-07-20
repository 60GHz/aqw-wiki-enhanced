# AQW Wiki Enhanced - the Extension

One shared codebase, two browsers. No frameworks, no dependencies, no build
toolchain - a plain WebExtension (Manifest V3) that loads unpacked as-is.
What it does for the player is in the [root README](../README.md); this file
is for loading, building and finding your way around the source.

## Load it

**Chromium (Chrome, Edge, Brave, Opera GX):**
`chrome://extensions` → Developer mode → *Load unpacked* → select this
`extension/` folder.

**Firefox:**
Firefox wants its own manifest, so build first (`powershell -File build.ps1`
or `node build.mjs`), then `about:debugging#/runtime/this-firefox` →
*Load Temporary Add-on* → pick any file inside `dist/firefox/`.

The build is a plain file copy: `src` + `assets` + the right manifest into
`dist/chromium` and `dist/firefox`. Nothing is transpiled or minified - what
you read here is what runs.

## Source map

```
manifest.json            Chromium MV3 (service worker background)
manifest.firefox.json    Firefox MV3 (event page, gecko id, CSP override -
                         the wiki 301s https to http, and Firefox's default
                         upgrade-insecure-requests would loop every fetch)
assets/                  Icons, the popup hero art, fonts, and the wiki's
                         bundled skin css (wikidot-theme.css)
src/
├── common.js            AQWE namespace: name normalization, wikidot slug
│                        rules, storage helpers, telemetry counters
├── background.js        Inventory sync (keyset-paged, silent), boost
│                        tracker, wiki fetch proxy, alarms
├── data/                Generated datasets, loadable as plain script tags:
│                        items-index.js (every wiki page, for search),
│                        rarities.js (rarity map + type fixes), tags.js
│                        (the tag vocabulary, from the wiki's own
│                        comprehensive tag list), legend-pages.js (names
│                        with a (Legend) page, for ownership gating), and
│                        wikidot-theme.js (a bundled copy of the wiki's
│                        own skin - rebuilt by tools/make-theme-js.py; the
│                        index, rarity and legend files come from
│                        tools/scrape.py)
├── content/
│   ├── boot.js          document_start: theme before first paint, the
│   │                    skin guarantee, https mirroring of wiki css
│   ├── wiki.css         The theme layer + every wiki component style
│   ├── wiki.js          Ownership badges, recipe panels, quest panels,
│   │                    the on-sight source loader, goal star
│   ├── hover.js         The shared hover preview engine
│   ├── hover.css        Preview styles for account pages
│   ├── account.js       Inventory sync fallback inside account.aq.com
│   └── account-hover.js Previews on CharPage + Manage Account tables
├── popup/               The popup (the whole control surface) + Farm Goals
├── armory/              The Armory: your inventory with search, sorting
│                        and rarity filters
└── pages-boot.js        Pre-paint theming for the extension's own pages
```

## Refreshing the datasets

`tools/scrape.py` (repo root) rebuilds `extension/src/data/items-index.js`,
`extension/src/data/rarities.js` and `extension/src/data/legend-pages.js`
from the live wiki. The script is resumable, polite and documented in its
own docstring. Rerun `tools/make-theme-js.py` after refreshing the bundled
skin css. Users never scrape anything; the datasets ship with each release.
