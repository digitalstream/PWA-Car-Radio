# Better Car Radio PWA

A lightweight radio dashboard for an Android car head unit. It combines internet radio, track artwork, a heading-up map, GPS speed and altitude, a compass, a vertical-speed indicator and saved destinations.

The frontend is plain HTML, CSS and JavaScript. There is no build step. The radio API is a separate service and its implementation is not included here.

## Setup

1. Copy `config.example.js` to `config.local.js`.
2. Enter your radio API URL, optional proxy base URL and CARTO basemap key.
3. Serve the folder through HTTPS, or localhost for development. Allow location access when prompted.

PowerShell configuration copy:

```powershell
Copy-Item config.example.js config.local.js
```

`config.js` contains safe empty defaults. `config.local.js` is excluded from Git. Without API settings, the dashboard shows a configuration message. Without a CARTO key, the map remains in day mode.

These are **browser-visible settings**, not a place for secrets. A website's API addresses and map key can be seen in browser requests even when the settings file is excluded from Git. Restrict a production CARTO key to the hosting website; use a separate development key for localhost. Passwords, server API credentials and signing keys belong on the backend.

For IIS, `web.config` enforces HTTPS and blocks web access to Git metadata and the local archive. Other servers need equivalent protections. Serve the contents at the site root; the manifest currently uses root URLs.

## Radio API contract

The configured API base URL returns an array of stations:

```json
[
    {
        "id": "example",
        "name": "Example Radio",
        "imageUrl": "images/logos/example.png",
        "metadataUrl": "https://metadata.example/current"
    }
]
```

`GET <apiBaseUrl>/stream/<stationId>` returns `{ "resolvedUrl": "https://stream.example/live.m3u8" }`.

When needed, the proxy is `<proxyRoot>/api/proxy?url=...`. The frontend preserves the existing proxy-host rules. The backend must validate proxy destinations and enforce authorization; hiding buttons or configuration values does not protect backend endpoints.

Metadata supports the existing `artist/title`, `nowPlaying` and `nowplaying[0]` response shapes. Artwork paths must match the files' capitalization on case-sensitive hosting.

## Behaviour

- Speed is shown in km/h. The speed arc turns red above a fixed 100 km/h; this is not road-speed-limit detection.
- The compass and map retain their last valid travel heading while stopped. GPS does not provide a stationary magnetic heading.
- Day/night starts from the browser preference and follows preference changes. The button changes the map mode manually. About shows both readings separately.
- Headlights trigger automatic switching only if the head unit exposes the change to its browser.
- Saved destinations remain in this browser's local storage. They are not written into the repository.
- Keep Screen Awake uses the browser's wake-lock API. It is disabled when unavailable, and the browser can release a lock when the app is hidden.
- Routes require internet access. Routing and address lookup use external public services; no turn-by-turn or offline-navigation guarantees are provided.

## Offline caching and releases

The service worker caches the app shell and a bounded collection of local station artwork. Streams, APIs, map tiles and `config.local.js` bypass permanent app caching. Browser HTTP caching still applies. External CDN libraries and map services mean a first visit requires internet access.

When publishing changed shell files, update `CACHE_NAME` in `service-worker.js`, `APP_VERSION` in `car-app.js`, and the package version. An already-open app may need another reload after the new service worker takes control.

Leaflet 1.9.4 and HLS.js 1.7.3 are pinned to the versions verified during this review. A package install is not required to run the frontend.

## Checks

With Node.js 20 or newer:

```powershell
npm test
```

The tests use Node's built-in runner and require no installed packages. They cover request cancellation, old metadata/artwork, compass retention, theme switching, routes, wake lock and offline caching. Hardware behaviour and actual broadcaster streams still need testing on the head unit.

See [the code-review notes](docs/CODE_REVIEW.md), [file inventory](docs/FILE_INVENTORY.md), [security notes](SECURITY.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## Licence

Original application code and documentation are licensed under the [MIT License](LICENSE), copyright © 2026 digitalstream.

This licence does not cover third-party libraries, broadcaster logos, artwork, map data, programme information or streams. Those remain subject to their respective owners' rights and licences. See [third-party notices](THIRD_PARTY_NOTICES.md).
