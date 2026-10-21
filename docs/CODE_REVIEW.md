# Code review — 21 October 2026

Scope: the static frontend, its assets and IIS configuration. The radio API backend and full Git history were not reviewed. No Git commands or GitHub mutations were executed.

## Changes made

- Replaced leftover development comments with short explanations at non-obvious boundaries and applied consistent source formatting.
- Removed duplicate About and theme handlers, unused retry/login placeholders, the development-only test route, a commented-out car overlay and unused styles.
- Consolidated map styling into `map-style.css` and merged duplicate destination styles. The established car position, marker rotation, map zoom and enlarged coverage are preserved.
- Preserved compass stop behaviour, the larger tape, smaller top-aligned diagonal labels and the symbol-free bearing.
- Separated browser settings into an ignored local file, with safe defaults and an example for reviewers. No backend secret belongs in that browser-downloaded file.
- Prevented old stream, metadata and artwork responses from overwriting a newer station or restarting stopped audio. Metadata polling now has one timer and one in-flight request.
- Connected the existing wake-lock switch with a supported-browser check and visibility handling.
- Replaced the missing offline-cache image with the real fallback artwork, bounded runtime artwork storage and limited cache cleanup to this app's cache names. Map tiles, APIs, streams and local settings bypass permanent app caching.
- Protected Git metadata and the local archive from IIS requests. Archived old app copies and unused artwork without deleting originals.
- Made the address bar fit beside the player on the 1024-pixel layout so the clock remains visible.
- Fixed invalid menu-list markup and pinned Leaflet/HLS.js to the versions verified during this review.
- Added 19 dependency-free regression checks and replaced the placeholder README with setup, behaviour and review guidance.

## Verification

The regression suite passes. Live browser startup, menus, manual/browser theme separation and cache installation passed at 1280 × 720 and 1024 × 600 with 39 stations and no page errors. Instrument fit was checked at both sizes. The private Git and archive paths return 404 on the live IIS deployment.

Tests cover cancellation even when an old network response still completes, reselecting the same station, old metadata/artwork, metadata URL parameters, polling cleanup, manual versus browser themes, pending-route clearing, compass retention/north crossings, wake-lock acquisition, malformed saved data, cache assets, cache bypass, storage failure, cache ownership and artwork limits.

## Remaining findings and publication decisions

1. **Public-source history check is still required.** The active source is prepared with local settings excluded, but past commits/branches and previously tracked screenshots or old app copies can remain in history. Inspect them before making the repository public; rotate any exposed real secret first.
2. **MIT licence selected by the owner on 21 October 2026.** Original application code and documentation use the [MIT License](../LICENSE), copyright © 2026 digitalstream. Broadcaster imagery, map content, streams and third-party libraries retain their own rights and licences.
3. **Backend is outside scope.** Authorization, stream/proxy URL validation, private-network restrictions and rate limiting need review in the API repository.
4. **One case-sensitive artwork mismatch exists upstream.** The API currently returns `images/logos/ChannelX-t.png`; the file is `images/logos/channelX-t.png`. IIS tolerates this, but case-sensitive hosting requires the API path and actual filename to match. No case-only Git rename was attempted.
5. **Head-unit validation remains necessary.** Browser theme/headlight integration, wake-lock support, GPS behaviour, audio recovery after a mobile-network outage and performance must be checked on the real device. The About diagnostics distinguish browser preference from map mode.
6. **Public service dependencies remain.** Address lookups are throttled to ten seconds but still occur while parked; distance-based throttling could reduce requests. The public OSRM/Nominatim services and CDN assets have no availability guarantee for this app.
7. **VSI is derived from GPS altitude.** It is susceptible to missing or noisy altitude and is not a calibrated instrument. This review preserves its existing calculation.
8. **Screenshots need refreshing.** The owner confirmed that the example desktop location is not their home address and may remain. Existing manifest screenshots still depict older UI. Fresh desktop previews were captured with the visual check; the manifest images have not been overwritten.

The frontend is easier to review, but these notes are not a claim that Git history or the separate backend is safe for public release.
