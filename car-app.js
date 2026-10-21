// Deployment values are browser-visible; server credentials belong in the separate API.
const APP_CONFIG = Object.freeze({ ...window.CAR_RADIO_CONFIG });
const API_BASE_URL = APP_CONFIG.apiBaseUrl || '';
const PROXY_ROOT = APP_CONFIG.proxyRoot || '';
const APP_VERSION = '6.15';

let channels = [];
let currentChannel = null;
let currentAudio = null;
let currentHls = null;
let playbackVersion = 0;
let streamRequest = null;
let metadataRequest = null;
let metadataInterval = null;
let lastImageUrl = '';
let lastTrackTime = 0;
let metadataRetryCount = 0;
let lastAlt = 0;
let lastTime = Date.now();
let lastValidHeading = 0;
let screenWakeLock = null;
let wakeLockWanted = false;
let wakeLockPending = false;

document.addEventListener('DOMContentLoaded', () => {
    initCompass();
    setupAboutPanel();
    try {
        if (typeof initMapSystem === 'function') initMapSystem();
    } catch (error) {
        document.getElementById('current-address').textContent = 'Map unavailable';
        console.warn('Map initialization failed', error);
    }
    startClock();
    fetchChannels();
    setupListeners();
    setupWakeLock();
    enableDragScroll();
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker
            .register('service-worker.js')
            .catch((error) => console.warn('Offline cache unavailable', error));
    }
});

function closeMenu() {
    document.getElementById('sideMenu')?.classList.remove('open');
}

function setupListeners() {
    document.getElementById('stop-button').addEventListener('click', stopPlayer);
    document.getElementById('theme-toggle').addEventListener('click', toggleMapTheme);
    document.querySelector('.address-box').addEventListener('click', () => {
        document.getElementById('current-address').textContent = 'Restarting GPS...';
        if (typeof startGpsTracking === 'function') startGpsTracking(true);
    });
    const sideMenu = document.getElementById('sideMenu');
    document.getElementById('menu-btn').addEventListener('click', () => sideMenu.classList.toggle('open'));
    sideMenu.addEventListener('click', (event) => {
        if (event.target.closest('a') || event.target === sideMenu) closeMenu();
    });
    document.getElementById('aboutLink').addEventListener('click', (event) => {
        event.preventDefault();
        document.getElementById('aboutOverlay').style.display = 'flex';
        closeMenu();
    });
    document.getElementById('goToLink').addEventListener('click', (event) => {
        event.preventDefault();
        displaySavedDestinations();
        document.getElementById('whereToOverlay').classList.add('open');
        closeMenu();
    });
    document.getElementById('destination-close').addEventListener('click', () => {
        document.getElementById('whereToOverlay').classList.remove('open');
    });
    document.getElementById('destination-find').addEventListener('click', findDestinations);
    document.getElementById('clearRouteLink').addEventListener('click', (event) => {
        event.preventDefault();
        clearRoute();
        closeMenu();
    });
    document.getElementById('rerouteLink').addEventListener('click', async (event) => {
        event.preventDefault();
        if (currentRouteDestination) {
            await drawRouteTo(currentRouteDestination.lat, currentRouteDestination.lng);
        }
        closeMenu();
    });
}

function readSavedDestinations() {
    try {
        const saved = JSON.parse(localStorage.getItem('carDestinations') || '[]');
        return Array.isArray(saved)
            ? saved.filter(
                  (item) =>
                      item &&
                      typeof item.name === 'string' &&
                      Number.isFinite(item.lat) &&
                      Number.isFinite(item.lng),
              )
            : [];
    } catch {
        return [];
    }
}

async function selectDestination(lat, lng) {
    const route = await drawRouteTo(lat, lng);
    if (route) document.getElementById('whereToOverlay').classList.remove('open');
}

async function findDestinations() {
    const input = document.getElementById('destination-search');
    const resultsEl = document.getElementById('destination-results');
    resultsEl.textContent = 'Searching...';
    const results = await searchDestination(input.value);
    resultsEl.replaceChildren();
    if (!results.length) {
        resultsEl.textContent = 'No results found';
        return;
    }
    results.forEach((result) => {
        const row = document.createElement('div');
        row.className = 'destination-result-row';
        const lat = Number(result.lat);
        const lng = Number(result.lon);
        const button = document.createElement('button');
        button.className = 'destination-result';
        button.textContent = result.display_name;
        button.addEventListener('click', () => selectDestination(lat, lng));
        const saveButton = document.createElement('button');
        saveButton.className = 'destination-save';
        saveButton.textContent = 'SAVE';
        saveButton.addEventListener('click', () => {
            const name = prompt('Save destination as:');
            if (!name || !name.trim()) return;
            const saved = readSavedDestinations();
            saved.push({ name: name.trim(), address: result.display_name, lat, lng });
            try {
                localStorage.setItem('carDestinations', JSON.stringify(saved));
                saveButton.textContent = 'SAVED';
            } catch {
                saveButton.textContent = 'Save unavailable';
            }
        });
        row.append(button, saveButton);
        resultsEl.appendChild(row);
    });
}

function setupWakeLock() {
    const toggle = document.getElementById('wakeLockToggle');
    if (!navigator.wakeLock?.request) {
        toggle.disabled = true;
        toggle.title = 'Screen wake lock is unavailable in this browser';
        return;
    }
    toggle.addEventListener('change', () => {
        wakeLockWanted = toggle.checked;
        syncWakeLock();
    });
    document.addEventListener('visibilitychange', syncWakeLock);
}

async function syncWakeLock() {
    if (!wakeLockWanted || document.visibilityState !== 'visible') {
        const lock = screenWakeLock;
        screenWakeLock = null;
        if (lock) await lock.release().catch(() => {});
        return;
    }
    if (screenWakeLock || wakeLockPending) return;
    wakeLockPending = true;
    try {
        const lock = await navigator.wakeLock.request('screen');
        if (!wakeLockWanted || document.visibilityState !== 'visible') {
            await lock.release();
            return;
        }
        screenWakeLock = lock;
        lock.addEventListener('release', () => {
            if (screenWakeLock === lock) screenWakeLock = null;
        });
    } catch {
        wakeLockWanted = false;
        const toggle = document.getElementById('wakeLockToggle');
        toggle.checked = false;
        toggle.title = 'The browser could not keep the screen awake';
    } finally {
        wakeLockPending = false;
    }
}

function updateTelemetryUI(pos) {
    const speedMs = pos.coords.speed || 0;
    const rawHeading = pos.coords.heading;
    const alt = pos.coords.altitude || 0;
    const speedKmh = Math.round(speedMs * 3.6);
    const speed = document.getElementById('speed-val');
    if (speed) speed.textContent = speedKmh;
    const ring = document.getElementById('speed-ring');
    if (ring) {
        const degrees = Math.min((speedKmh / 120) * 270, 270);
        ring.style.background =
            'conic-gradient(from 225deg, var(--highlight) ' +
            degrees +
            'deg, transparent ' +
            degrees +
            'deg)';
        // This is a fixed visual warning, not a detected road speed limit.
        if (speedKmh > 100) ring.style.setProperty('--highlight', '#ff3333');
        else ring.style.removeProperty('--highlight');
    }
    // Hold the last travel heading while stopped or when GPS has no heading.
    if (rawHeading !== null && !isNaN(rawHeading) && speedKmh > 3) lastValidHeading = rawHeading;
    updateCompassDisplay();
    const altitude = document.getElementById('alt-m-live');
    if (altitude) altitude.textContent = Math.round(alt);
    updateVSI(alt);
}

function updateVSI(currentAlt) {
    const now = Date.now();
    const timeDiff = (now - lastTime) / 1000;
    if (timeDiff < 1) return;
    const rate = (currentAlt - lastAlt) / timeDiff;
    lastAlt = currentAlt;
    lastTime = now;
    const needle = document.getElementById('vsi-needle');
    if (!needle) return;
    // Limit the needle to the dial; climb rotates it counter-clockwise.
    const degrees = Math.max(-60, Math.min(60, (rate / 5) * 90));
    needle.style.transform = 'translateY(-50%) rotate(' + -degrees + 'deg)';
}

function startClock() {
    const clockEl = document.getElementById('digital-clock');
    const update = () => {
        const now = new Date();
        let hours = now.getHours();
        const minutes = now.getMinutes();
        hours = hours % 12 || 12;
        const minStr = minutes < 10 ? '0' + minutes : minutes;
        clockEl.textContent = `${hours}:${minStr}`;
    };
    update();
    setInterval(update, 1000);
}

async function fetchChannels() {
    if (!API_BASE_URL) {
        document.getElementById('meta-title').textContent = 'Configure the radio API in config.local.js';
        return;
    }
    try {
        const response = await fetch(API_BASE_URL);
        if (!response.ok) throw new Error('Station service returned ' + response.status);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Invalid station list');
        channels = data;
        renderChannelScroller();
    } catch (error) {
        document.getElementById('meta-title').textContent = 'Station list unavailable';
        console.warn('Station list failed', error);
    }
}

function renderChannelScroller() {
    const container = document.getElementById('channel-scroller');
    container.innerHTML = '';
    channels.forEach((channel) => {
        const btn = document.createElement('div');
        btn.className = 'car-channel-item';
        const img = document.createElement('img');
        img.src = channel.imageUrl;
        img.loading = 'lazy';
        btn.appendChild(img);
        btn.onclick = () => playChannel(channel);
        container.appendChild(btn);
    });
}

// A generation number prevents completed old requests from reviving stopped audio.
async function playChannel(channel) {
    stopPlayer();
    currentChannel = channel;
    const version = playbackVersion;
    const isCurrent = () => version === playbackVersion && currentChannel === channel;
    document.getElementById('meta-station').textContent = channel.name;
    document.getElementById('player-logo').src = channel.imageUrl;
    document.getElementById('meta-title').textContent = channel.metadataUrl
        ? 'Loading Track Info...'
        : 'Live Stream';
    const request = new AbortController();
    streamRequest = request;
    try {
        const response = await fetch(API_BASE_URL + '/stream/' + encodeURIComponent(channel.id), {
            signal: request.signal,
        });
        if (!response.ok) throw new Error('Stream service returned ' + response.status);
        const data = await response.json();
        if (!isCurrent()) return;
        let streamUrl = data.resolvedUrl;
        if (typeof streamUrl !== 'string' || !streamUrl) throw new Error('Missing stream URL');
        const proxyHosts = [
            'd2dgwrtikgx7lx.cloudfront.net',
            'd11fwwlrb0wuhh.cloudfront.net',
            'd2jt3l9ulybyg4.cloudfront.net',
        ];
        if (proxyHosts.includes(new URL(streamUrl).hostname)) {
            if (!PROXY_ROOT) throw new Error('Stream proxy is not configured');
            streamUrl = PROXY_ROOT + '/api/proxy?url=' + encodeURIComponent(streamUrl);
        } else {
            if (streamUrl.startsWith('http:')) streamUrl = streamUrl.replace('http:', 'https:');
            if (streamUrl.includes('streamtheworld.com')) {
                const url = new URL(streamUrl);
                url.searchParams.set('bust', Date.now());
                streamUrl = url.href;
            }
        }
        const audio = new Audio();
        currentAudio = audio;
        const handleError = (error) => {
            if (!isCurrent()) return;
            console.warn('Playback failed', error);
            document.getElementById('meta-title').textContent = 'Stream Error';
        };
        audio.addEventListener('error', handleError);
        const startPlayback = async () => {
            if (!isCurrent()) return;
            try {
                await audio.play();
                if (isCurrent()) startMetadataPolling();
            } catch (error) {
                if (error.name !== 'NotAllowedError' && error.name !== 'AbortError') handleError(error);
            }
        };
        const useHls =
            typeof Hls !== 'undefined' &&
            Hls.isSupported() &&
            (streamUrl.includes('.m3u8') || streamUrl.includes('.ashx'));
        if (useHls) {
            const hls = new Hls();
            currentHls = hls;
            hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) handleError(data);
            });
            hls.loadSource(streamUrl);
            hls.attachMedia(audio);
        } else {
            audio.src = streamUrl;
            await startPlayback();
        }
    } catch (error) {
        if (error.name !== 'AbortError' && isCurrent()) {
            document.getElementById('meta-title').textContent = 'Error Loading Stream';
            console.warn('Stream resolution failed', error);
        }
    } finally {
        if (streamRequest === request) streamRequest = null;
    }
}

function stopPlayer() {
    playbackVersion++;
    streamRequest?.abort();
    metadataRequest?.abort();
    streamRequest = null;
    metadataRequest = null;
    if (metadataInterval) clearInterval(metadataInterval);
    metadataInterval = null;
    if (currentHls) currentHls.destroy();
    currentHls = null;
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.removeAttribute('src');
        currentAudio.load();
    }
    currentAudio = null;
    currentChannel = null;
    lastImageUrl = '';
    lastTrackTime = 0;
    metadataRetryCount = 0;
    document.getElementById('meta-station').textContent = 'Select Station';
    document.getElementById('meta-title').textContent = 'Ready';
    document.getElementById('meta-artist').textContent = '';
    document.getElementById('player-logo').src = 'images/poster4.png';
}

async function updateMetadata() {
    const channel = currentChannel;
    const version = playbackVersion;
    if (!channel?.metadataUrl || metadataRequest) return;
    const isCurrent = () => currentChannel === channel && playbackVersion === version;
    const request = new AbortController();
    metadataRequest = request;
    try {
        const url = new URL(channel.metadataUrl, window.location.href);
        url.searchParams.set('t', Date.now());
        const response = await fetch(url.href, { signal: request.signal });
        if (!isCurrent()) return;
        if (!response.ok) {
            handleMetadataStrike();
            return;
        }
        const text = await response.text();
        if (!isCurrent()) return;
        if (!text.trim()) {
            handleMetadataStrike();
            return;
        }
        const data = JSON.parse(text);
        let title = '',
            artist = '',
            image = '',
            trackTime = 0;
        // Broadcasters expose three different metadata shapes.
        if (data.artist) {
            artist = data.artist;
            title = data.title;
            image = data.imagePath;
            trackTime = data.startTime || 0;
        } else if (data.nowPlaying) {
            artist = data.nowPlaying.artist;
            title = data.nowPlaying.name;
            image = data.nowPlaying.largeArtwork;
            if (image) image = image.replace(/\[width\]/gi, '1000').replace(/\[height\]/gi, '1000');
        } else if (data.nowplaying?.[0]) {
            const track = data.nowplaying[0];
            artist = track.artist;
            title = track.title;
            image = track.imageUrl;
            if (track.time) trackTime = Date.parse(track.time);
        }
        if (!artist || !title || !artist.trim()) {
            handleMetadataStrike();
            return;
        }
        if (trackTime > 0 && lastTrackTime > 0 && trackTime < lastTrackTime) return;
        if (trackTime > 0) lastTrackTime = trackTime;
        metadataRetryCount = 0;
        document.getElementById('meta-title').textContent = title;
        document.getElementById('meta-artist').textContent = artist;
        if (image?.startsWith('http:')) image = image.replace('http:', 'https:');
        if (image) {
            if (lastImageUrl !== image) {
                lastImageUrl = image;
                const loader = new Image();
                // An old artwork download must not overwrite a newer station or track.
                loader.onload = () => {
                    if (isCurrent() && lastImageUrl === image)
                        document.getElementById('player-logo').src = image;
                };
                loader.src = image;
            }
        } else {
            lastImageUrl = '';
            document.getElementById('player-logo').src = channel.imageUrl;
        }
    } catch (error) {
        if (error.name !== 'AbortError' && isCurrent()) handleMetadataStrike();
    } finally {
        if (metadataRequest === request) metadataRequest = null;
    }
}

function handleMetadataStrike() {
    metadataRetryCount++;
    if (metadataRetryCount >= 2) {
        lastImageUrl = '';
        document.getElementById('meta-title').textContent = 'Live Stream';
        document.getElementById('meta-artist').textContent = '';
        if (currentChannel) document.getElementById('player-logo').src = currentChannel.imageUrl;
    }
}

function startMetadataPolling() {
    if (metadataInterval) clearInterval(metadataInterval);
    metadataInterval = null;
    if (!currentChannel?.metadataUrl) return;
    updateMetadata();
    metadataInterval = setInterval(updateMetadata, 10000);
}

function enableDragScroll() {
    const slider = document.getElementById('channel-scroller');
    let isDown = false;
    let startX;
    let scrollLeft;

    slider.addEventListener('mousedown', (e) => {
        isDown = true;
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
        e.preventDefault();
    });
    slider.addEventListener('mouseleave', () => {
        isDown = false;
    });
    slider.addEventListener('mouseup', () => {
        isDown = false;
    });
    slider.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 2;
        slider.scrollLeft = scrollLeft - walk;
    });
}

function initCompass() {
    const tape = document.getElementById('compass-tape');
    if (!tape) return;
    tape.innerHTML = '';
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    // Three copies keep the moving strip filled on both sides of north.
    for (let loop = 0; loop < 3; loop++) {
        for (let angle = 0; angle < 360; angle += 15) {
            const tick = document.createElement('span');
            const isMajor = angle % 45 === 0;
            tick.className = isMajor ? 'tick major' : 'tick minor';
            if (isMajor && angle % 90 !== 0) tick.classList.add('intercardinal');
            tick.textContent = isMajor ? directions[angle / 45] : '';
            tape.appendChild(tick);
        }
    }
    updateCompassDisplay();
}

function updateCompassDisplay() {
    const heading = ((lastValidHeading % 360) + 360) % 360;
    const bearing = document.getElementById('heading-val');
    if (bearing) bearing.textContent = Math.round(heading) % 360;

    const tape = document.getElementById('compass-tape');
    if (tape) {
        const tickWidth = 16;
        const offset = -(24 * tickWidth + tickWidth / 2) - (heading * tickWidth) / 15;
        // Crossing north resets the strip without sweeping through every direction.
        const previous = Number(tape.dataset.heading);
        const resetStrip = tape.dataset.heading === undefined || Math.abs(heading - previous) > 180;
        tape.style.transition = resetStrip ? 'none' : '';
        tape.style.transform = 'translateX(' + offset + 'px)';
        tape.dataset.heading = heading;
    }
}

function setupAboutPanel() {
    const content = `
    <div class="about-header">
        <h2>Better Car Radio</h2>
        <p>Version ${APP_VERSION} · digitalstream</p>
    </div>

    <div class="tech-section">
        <h4>Display</h4>
        <p>Map mode: <strong id="map-theme-status">Checking...</strong></p>
        <p>Browser preference: <strong id="browser-theme-status">Checking...</strong></p>
        <p>The day/night button changes the map manually. Automatic switching follows the browser preference.</p>
        <p>To check headlight integration while parked, switch the headlights on and off and watch the browser preference.</p>
    </div>

    <div class="tech-section">
        <h4>Internet Radio</h4>
        <p>Live stations, track information and artwork are supplied through a separate radio service. Availability depends on the station and your internet connection.</p>
    </div>

    <div class="tech-section">
        <h4>GPS & Instruments</h4>
        <p>The map follows your position and direction of travel. The compass keeps its last valid heading when stopped.</p>
        <p>Speed is shown in km/h. The red arc above 100 km/h is a fixed marker, not the road's speed limit. Altitude and vertical speed (VSI) use GPS readings and may fluctuate.</p>
    </div>

    <div class="tech-section">
        <h4>Routes & Saved Places</h4>
        <p>Search for a destination, save it in this browser and display a road route. Routes and address searches need internet access. Rerouting is manual.</p>
    </div>

    <div class="tech-section">
        <h4>Connection & Screen</h4>
        <p>The dashboard and some station artwork are cached locally. Radio, map tiles, address searches and routes need an internet connection.</p>
        <p>Keep Screen Awake is available in the menu when supported by your browser.</p>
    </div>

    <div class="tech-section">
        <h4>Licence & Credits</h4>
        <p>Original application code and documentation © 2026 digitalstream, released under the MIT licence.</p>
        <p>Broadcaster logos, artwork, programme information and streams belong to their respective owners and are outside the app's MIT licence. Third-party libraries keep their own licences.</p>
        <p>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>.
            Night cartography © <a href="https://carto.com/attribution/" target="_blank" rel="noopener noreferrer">CARTO</a>.
            Maps use Leaflet; address searches use Nominatim; routes use OSRM; HLS playback uses HLS.js.</p>
    </div>

    <button id="about-close-btn">Close About</button>
`;

    const panel = document.getElementById('aboutPanelContent');
    if (panel) {
        panel.innerHTML = content;
        document.getElementById('about-close-btn').addEventListener('click', () => {
            document.getElementById('aboutOverlay').style.display = 'none';
        });
    }
}

function displaySavedDestinations() {
    const container = document.getElementById('saved-destinations');
    if (!container) return;

    const destinations = readSavedDestinations();

    container.innerHTML = '';

    if (destinations.length === 0) {
        return;
    }

    const heading = document.createElement('div');
    heading.className = 'saved-destinations-heading';
    heading.textContent = 'Saved';
    container.appendChild(heading);

    destinations.forEach((destination, index) => {
        const row = document.createElement('div');
        row.className = 'saved-destination-row';

        const destinationButton = document.createElement('button');
        destinationButton.className = 'saved-destination-button';
        destinationButton.textContent = destination.name;

        destinationButton.addEventListener('click', async () => {
            const route = await drawRouteTo(destination.lat, destination.lng);

            if (route) {
                console.log(
                    `Route: ${route.distanceKm.toFixed(1)} km, ` + `${Math.round(route.durationMinutes)} min`,
                );

                document.getElementById('whereToOverlay')?.classList.remove('open');
            }
        });

        const deleteButton = document.createElement('button');
        deleteButton.className = 'saved-destination-delete';
        deleteButton.textContent = 'DELETE';

        deleteButton.addEventListener('click', () => {
            destinations.splice(index, 1);

            localStorage.setItem('carDestinations', JSON.stringify(destinations));

            displaySavedDestinations();
        });

        row.appendChild(destinationButton);
        row.appendChild(deleteButton);

        container.appendChild(row);
    });
}
