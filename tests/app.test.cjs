const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
const response = (data) => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
});

function element() {
    const classes = new Set();
    return {
        textContent: '',
        innerHTML: '',
        src: '',
        checked: false,
        disabled: false,
        dataset: {},
        children: [],
        listeners: {},
        style: {
            setProperty(name, value) {
                this[name] = value;
            },
            removeProperty(name) {
                delete this[name];
            },
        },
        classList: {
            add: (value) => classes.add(value),
            remove: (value) => classes.delete(value),
            contains: (value) => classes.has(value),
            toggle(value, force) {
                const enabled = force === undefined ? !classes.has(value) : force;
                if (enabled) classes.add(value);
                else classes.delete(value);
                return enabled;
            },
        },
        addEventListener(name, callback) {
            (this.listeners[name] ||= []).push(callback);
        },
        appendChild(child) {
            this.children.push(child);
        },
        append(...children) {
            this.children.push(...children);
        },
        replaceChildren() {
            this.children = [];
        },
    };
}

function app(options = {}) {
    const elements = new Map();
    const get = (id) => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
    };
    const audios = [],
        images = [],
        intervals = new Map(),
        requests = [];
    let intervalId = 0;
    const document = {
        body: element(),
        visibilityState: 'visible',
        listeners: {},
        getElementById: get,
        querySelector: () => get('address-box'),
        querySelectorAll: () => [],
        createElement: element,
        addEventListener(name, callback) {
            (this.listeners[name] ||= []).push(callback);
        },
    };
    document.body.classList.add('day-mode');
    let themeListener;
    const theme = {
        matches: true,
        addEventListener(name, callback) {
            themeListener = callback;
        },
    };
    const map = {
        setView() {
            return this;
        },
        removeLayer() {},
        getZoom: () => 17,
    };
    let routesDrawn = 0;
    const context = vm.createContext({
        window: {
            CAR_RADIO_CONFIG: options.config || {
                apiBaseUrl: 'https://api.example/api/radio',
                proxyRoot: 'https://api.example',
                cartoApiKey: 'test-browser-key',
            },
            location: { href: 'https://car.example/' },
            matchMedia: () => theme,
        },
        document,
        navigator: options.navigator || {},
        localStorage: { getItem: () => null },
        console: { warn() {}, error() {}, log() {} },
        URL,
        AbortController,
        Date,
        setInterval(callback) {
            intervals.set(++intervalId, callback);
            return intervalId;
        },
        clearInterval(id) {
            intervals.delete(id);
        },
        fetch: (...args) => {
            requests.push(args);
            return options.fetch ? options.fetch(...args) : Promise.resolve(response([]));
        },
        Audio: class {
            constructor() {
                this.events = {};
                audios.push(this);
            }
            addEventListener(name, callback) {
                this.events[name] = callback;
            }
            play() {
                this.played = true;
                return Promise.resolve();
            }
            pause() {
                this.paused = true;
            }
            removeAttribute() {}
            load() {}
        },
        Image: class {
            constructor() {
                images.push(this);
            }
        },
        L: {
            map: () => map,
            tileLayer: () => ({
                addTo() {
                    return this;
                },
                setUrl(url) {
                    this.url = url;
                },
            }),
            divIcon: (value) => value,
            marker: () => ({
                addTo() {
                    return this;
                },
            }),
            polyline: () => ({
                addTo() {
                    routesDrawn++;
                    return this;
                },
            }),
        },
    });
    vm.runInContext(source('car-app.js'), context);
    if (options.map) vm.runInContext(source('map-app.js'), context);
    return {
        context,
        get,
        document,
        audios,
        images,
        requests,
        intervals,
        theme,
        changeTheme: () => themeListener(),
        routesDrawn: () => routesDrawn,
        run: (code) => vm.runInContext(code, context),
    };
}

const station = { id: 'a', name: 'Station A', imageUrl: 'a.png' };

test('compass holds its last heading at rest and crosses north without a long sweep', () => {
    const a = app();
    a.run('initCompass(); updateTelemetryUI({coords:{speed:10,heading:45,altitude:0}})');
    assert.equal(a.get('heading-val').textContent, 45);
    a.run('updateTelemetryUI({coords:{speed:0,heading:0,altitude:0}})');
    assert.equal(a.get('heading-val').textContent, 45);
    a.run(
        'updateTelemetryUI({coords:{speed:10,heading:359,altitude:0}}); updateTelemetryUI({coords:{speed:10,heading:1,altitude:0}})',
    );
    assert.equal(a.get('compass-tape').style.transition, 'none');
    assert.equal(a.get('heading-val').textContent, 1);
});

test('Stop invalidates a stream response even if the network ignores abort', async () => {
    const pending = deferred();
    const a = app({ fetch: () => pending.promise });
    a.context.station = station;
    const playing = a.run('playChannel(station)');
    a.run('stopPlayer()');
    pending.resolve(response({ resolvedUrl: 'https://stream.example/live.mp3' }));
    await playing;
    assert.equal(a.audios.length, 0);
    assert.equal(a.get('meta-title').textContent, 'Ready');
});

test('reselecting the same station cannot start the older request', async () => {
    const first = deferred(),
        second = deferred();
    let calls = 0;
    const a = app({ fetch: () => (++calls === 1 ? first.promise : second.promise) });
    a.context.station = station;
    const oldPlay = a.run('playChannel(station)');
    const newPlay = a.run('playChannel(station)');
    second.resolve(response({ resolvedUrl: 'https://stream.example/new.mp3' }));
    await newPlay;
    first.resolve(response({ resolvedUrl: 'https://stream.example/old.mp3' }));
    await oldPlay;
    assert.equal(a.audios.length, 1);
    assert.equal(a.audios[0].src, 'https://stream.example/new.mp3');
});

test('old metadata cannot replace a new station display', async () => {
    const pending = deferred();
    const a = app({ fetch: () => pending.promise });
    a.context.station = { ...station, metadataUrl: 'https://meta.example/song' };
    a.run('currentChannel = station');
    const updating = a.run('updateMetadata()');
    a.run('stopPlayer()');
    a.get('meta-title').textContent = 'New station';
    pending.resolve(response({ artist: 'Old artist', title: 'Old song' }));
    await updating;
    assert.equal(a.get('meta-title').textContent, 'New station');
});

test('old artwork cannot overwrite the new station and metadata query parameters survive', async () => {
    const a = app({
        fetch: () =>
            Promise.resolve(
                response({ artist: 'Artist', title: 'Song', imagePath: 'https://art.example/old.png' }),
            ),
    });
    a.context.station = { ...station, metadataUrl: 'https://meta.example/song?station=a' };
    a.run('currentChannel = station');
    await a.run('updateMetadata()');
    assert.equal(new URL(a.requests[0][0]).searchParams.get('station'), 'a');
    assert.equal(a.images.length, 1);
    a.run('stopPlayer()');
    a.get('player-logo').src = 'new-station.png';
    a.images[0].onload();
    assert.equal(a.get('player-logo').src, 'new-station.png');
});

test('metadata polling keeps one timer and one in-flight request', () => {
    const pending = deferred();
    const a = app({ fetch: () => pending.promise });
    a.context.station = { ...station, metadataUrl: 'https://meta.example/song' };
    a.run('currentChannel = station; startMetadataPolling(); startMetadataPolling()');
    assert.equal(a.intervals.size, 1);
    assert.equal(a.requests.length, 1);
    a.run('stopPlayer()');
    assert.equal(a.intervals.size, 0);
});

test('manual theme has one click handler and stays distinct from browser preference', () => {
    const a = app({ map: true });
    a.run('initMap(); setupListeners()');
    assert.equal(a.get('theme-toggle').listeners.click.length, 1);
    assert.equal(a.get('map-theme-status').textContent, 'Dark');
    a.get('theme-toggle').listeners.click[0]();
    assert.equal(a.get('map-theme-status').textContent, 'Light');
    assert.equal(a.get('browser-theme-status').textContent, 'Dark');
    a.theme.matches = false;
    a.changeTheme();
    assert.equal(a.get('browser-theme-status').textContent, 'Light');
});

test('clearing a route invalidates a pending route response', async () => {
    const pending = deferred();
    const a = app({ map: true, fetch: () => pending.promise });
    a.run('initMap(); currentLat = -36; currentLng = 174');
    const route = a.run('drawRouteTo(-37, 175)');
    a.run('clearRoute()');
    pending.resolve(
        response({
            routes: [
                {
                    geometry: {
                        coordinates: [
                            [174, -36],
                            [175, -37],
                        ],
                    },
                    distance: 1,
                    duration: 1,
                },
            ],
        }),
    );
    await route;
    assert.equal(a.routesDrawn(), 0);
    assert.equal(a.run('currentRouteDestination'), null);
});

test('switching wake lock off during acquisition releases the eventual lock', async () => {
    const pending = deferred();
    let releases = 0;
    const a = app({ navigator: { wakeLock: { request: () => pending.promise } } });
    a.run('wakeLockWanted = true');
    const acquiring = a.run('syncWakeLock()');
    a.run('wakeLockWanted = false');
    await a.run('syncWakeLock()');
    pending.resolve({
        release: async () => {
            releases++;
        },
        addEventListener() {},
    });
    await acquiring;
    assert.equal(releases, 1);
    assert.equal(a.run('screenWakeLock'), null);
});

test('unsupported wake lock is disabled instead of leaving an inert switch', () => {
    const a = app();
    a.run('setupWakeLock()');
    assert.equal(a.get('wakeLockToggle').disabled, true);
});

test('invalid saved destination data does not break the destination menu', () => {
    const a = app();
    a.context.localStorage.getItem = () => '{bad json';
    assert.equal(a.run('readSavedDestinations().length'), 0);
});

function worker(options = {}) {
    const listeners = {},
        deleted = [],
        installed = [];
    const cache = options.cache || {
        addAll: async (files) => installed.push(...files),
        match: async () => undefined,
        put: async () => {},
        keys: async () => [],
    };
    const context = vm.createContext({
        URL,
        self: {
            registration: { scope: 'https://car.example/' },
            location: { origin: 'https://car.example' },
            addEventListener: (name, fn) => (listeners[name] = fn),
            skipWaiting: async () => {},
            clients: { claim: async () => {} },
        },
        caches: {
            open: async () => cache,
            keys: async () => ['another-app-cache', 'car-radio-v6.12'],
            delete: async (key) => deleted.push(key),
        },
        fetch:
            options.fetch ||
            (async () => ({
                ok: true,
                status: 200,
                clone() {
                    return this;
                },
            })),
    });
    vm.runInContext(source('service-worker.js'), context);
    return { listeners, installed, deleted, context };
}

test('every precached local file exists', async () => {
    const w = worker();
    let work;
    w.listeners.install({ waitUntil: (value) => (work = value) });
    await work;
    for (const file of w.installed)
        assert.ok(fs.existsSync(path.join(root, file)), 'Missing offline asset: ' + file);
    assert.ok(!w.installed.includes('config.local.js'));
});

test('worker bypasses APIs, map tiles, local settings, media and non-GET requests', () => {
    const w = worker();
    for (const [url, destination, method] of [
        ['https://api.example/api/radio', '', 'GET'],
        ['https://basemaps.cartocdn.com/tiles/0.png', 'image', 'GET'],
        ['https://car.example/config.local.js', 'script', 'GET'],
        ['https://car.example/live.mp3', 'audio', 'GET'],
        ['https://car.example/images/a.png', 'image', 'POST'],
    ])
        w.listeners.fetch({
            request: { url, destination, method },
            respondWith() {
                assert.fail('Request should bypass app cache');
            },
        });
});

test('cache write failures do not block a successful image response', async () => {
    const network = {
        ok: true,
        status: 200,
        clone() {
            return this;
        },
    };
    const w = worker({
        cache: {
            match: async () => undefined,
            put: async () => {
                throw new Error('Quota full');
            },
        },
        fetch: async () => network,
    });
    let work;
    w.listeners.fetch({
        request: { url: 'https://car.example/images/a.png', method: 'GET', destination: 'image' },
        respondWith: (value) => (work = value),
    });
    assert.equal(await work, network);
});

test('activation keeps caches belonging to other applications', async () => {
    const w = worker();
    let work;
    w.listeners.activate({ waitUntil: (value) => (work = value) });
    await work;
    assert.deepEqual(w.deleted, ['car-radio-v6.12']);
});

test('runtime image cache is bounded while preserving core images', async () => {
    const deleted = [];
    const keys = [
        { url: 'https://car.example/images/poster4.png' },
        ...Array.from({ length: 125 }, (_, i) => ({ url: 'https://car.example/images/logo-' + i + '.png' })),
    ];
    const w = worker();
    w.context.testCache = { keys: async () => keys, delete: async (request) => deleted.push(request.url) };
    await vm.runInContext('trimImages(testCache)', w.context);
    assert.equal(deleted.length, 25);
    assert.ok(!deleted.some((url) => url.endsWith('/poster4.png')));
});


test('HLS.js branch never starts a cancelled manifest', async () => {
    const instances = [];
    const a = app({ fetch: () => Promise.resolve(response({ resolvedUrl: 'https://stream.example/live.m3u8' })) });
    a.context.Hls = class {
        static isSupported() { return true; }
        static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
        constructor() { this.events = {}; instances.push(this); }
        on(name, handler) { this.events[name] = handler; }
        loadSource() {}
        attachMedia() {}
        destroy() { this.destroyed = true; }
    };
    a.context.station = station;
    await a.run('playChannel(station)');
    assert.equal(instances.length, 1);
    a.run('stopPlayer()');
    await instances[0].events.manifest();
    assert.equal(a.audios[0].played, undefined);
    assert.equal(instances[0].destroyed, true);
});

test('metadata provider formats resolve artwork and invalidate it after fallback', async () => {
    let payload = { nowPlaying: { artist: 'Artist', name: 'Track', largeArtwork: 'https://art.example/[width]/[height].png' } };
    const a = app({ fetch: () => Promise.resolve(response(payload)) });
    a.context.station = { ...station, metadataUrl: 'https://meta.example/song' };
    a.run('currentChannel = station');
    await a.run('updateMetadata()');
    assert.equal(a.images[0].src, 'https://art.example/1000/1000.png');
    payload = { nowplaying: [{ artist: 'Second artist', title: 'Second track', imageUrl: 'https://art.example/second.png' }] };
    await a.run('updateMetadata()');
    assert.equal(a.get('meta-title').textContent, 'Second track');
    a.run('handleMetadataStrike(); handleMetadataStrike()');
    a.images[1].onload();
    assert.equal(a.get('player-logo').src, station.imageUrl);
});


test('empty public configuration leaves a working day map and a clear setup message', async () => {
    const a = app({ map: true, config: { apiBaseUrl: '', proxyRoot: '', cartoApiKey: '' } });
    a.run('initMap()');
    await a.run('fetchChannels()');
    assert.equal(a.requests.length, 0);
    assert.equal(a.get('map-theme-status').textContent, 'Light');
    assert.equal(a.get('browser-theme-status').textContent, 'Dark');
    assert.match(a.get('meta-title').textContent, /config.local.js/);
});
