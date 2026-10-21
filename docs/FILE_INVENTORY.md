# File inventory

## Active source

| File | Purpose |
| --- | --- |
| `index.html` | Dashboard, instruments, menus, map credits and pinned script/style references |
| `car-app.js` | Interface events, radio playback, metadata, instruments, destinations and wake lock |
| `car-style.css` | Dashboard layout and matching instrument styling |
| `map-app.js` | Leaflet setup, GPS, heading-up position, themes, geocoding and routes |
| `map-style.css` | Map coverage, fixed credits and destination interface |
| `config.js` | Public empty defaults |
| `config.example.js` | Setup template using example domains |
| `config.local.js` | Local browser-visible deployment values; ignored by Git |
| `service-worker.js` | App-shell cache and bounded local-artwork cache |
| `manifest.json` | App identity, icons and existing screenshot previews |
| `web.config` | IIS HTTPS, fallback, MIME and hidden-directory configuration |
| `package.json` | Version, code licence and dependency-free test command |
| `LICENSE` | MIT licence for original application code and documentation |
| `THIRD_PARTY_NOTICES.md` | Separate rights and licences for external content and libraries |
| `tests/app.test.cjs` | Regression checks |

## Retained assets

- `images/poster4.png`, `stop-button-2.png`, `car-icon.png` and `bg-shinny.jpg` are directly used by the app.
- The root `images/logos/` catalogue is selected dynamically by the radio API. These files must not be pruned based only on HTML references.
- `radio-icon-192.png` and `radio-icon-512.png` are manifest icons.
- `wide.png`, `splashDesktop.png`, `splashMobile.png` and `splash-320.png` remain referenced by the manifest. They depict the previous interface and should be refreshed before promotion.

## Local archive

`.local-archive/review-2026-10-21/` preserves the pre-cleanup source, approved old app copies, unused artwork and temporary review tooling. It is ignored by Git and blocked by the IIS configuration.

The archived app copies are `version1.0/`, `index.v1.html`, `index.v2.html`, `index2.html` and `gpstest.html`. Unused image variants and `images/logos/images`, `temp` and `temp2` working directories are archived without deletion.

Windows thumbnail files are ignored. No active file refers to an archived app copy or archived artwork.
