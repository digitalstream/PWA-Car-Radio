const DAY_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const CARTO_API_KEY = APP_CONFIG.cartoApiKey || '';
const NIGHT_TILE_URL =
    'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=' +
    encodeURIComponent(CARTO_API_KEY);

let map = null;
let carMarker = null;
let gpsWatchId = null;
let lastAddressUpdate = 0;

let mapTileLayer = null;

let routeLine = null;
let routeRequestVersion = 0;
let currentRouteDestination = null;
let currentLat = null;
let currentLng = null;

function initMapSystem() {
    initMap();
    if (navigator.geolocation) {
        startGpsTracking(true);
    }
}

function initMap() {
    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    map = L.map('map-container', { zoomControl: false }).setView([-36.8485, 174.7633], 17);

    mapTileLayer = L.tileLayer(darkModeQuery.matches && CARTO_API_KEY ? NIGHT_TILE_URL : DAY_TILE_URL, {
        maxZoom: 19,
        // Retain off-screen tiles during heading-up rotation.
        keepBuffer: 8,
    }).addTo(map);

    const carIcon = L.divIcon({
        className: 'car-marker-icon',
        html: '<img src="images/car-icon.png" style="width: 50px; transform: rotate(0deg);" id="car-image">',
        iconSize: [50, 50],
        iconAnchor: [25, 25],
    });

    carMarker = L.marker([-36.8485, 174.7633], { icon: carIcon }).addTo(map);

    // Follow the browser theme; headlight integration depends on the head unit.

    const syncBrowserTheme = () => {
        applyMapTheme(darkModeQuery.matches);
        const status = document.getElementById('browser-theme-status');
        if (status) status.textContent = darkModeQuery.matches ? 'Dark' : 'Light';
    };

    syncBrowserTheme();
    if (typeof darkModeQuery.addEventListener === 'function') {
        darkModeQuery.addEventListener('change', syncBrowserTheme);
    } else if (typeof darkModeQuery.addListener === 'function') {
        // Older Android browsers use the legacy listener.
        darkModeQuery.addListener(syncBrowserTheme);
    }
}

function startGpsTracking(highAccuracy = true) {
    if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);

    gpsWatchId = navigator.geolocation.watchPosition(
        handleGpsUpdate,
        (err) => {
            console.warn('GPS Error', err);
            if (err.code === 3 && highAccuracy) {
                startGpsTracking(false);
            } else {
                const addr = document.getElementById('current-address');
                if (addr) addr.textContent = 'GPS Signal Lost';
            }
        },
        { enableHighAccuracy: highAccuracy, timeout: 15000, maximumAge: 0 },
    );
}

function handleGpsUpdate(pos) {
    currentLat = pos.coords.latitude;
    currentLng = pos.coords.longitude;
    updateMapState(pos);

    if (typeof updateTelemetryUI === 'function') {
        updateTelemetryUI(pos);
    }

    updateAddress(pos.coords.latitude, pos.coords.longitude);
}

let lastMapHeading = 0;

function updateMapState(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const newLatLng = new L.LatLng(lat, lng);

    const rawHeading = pos.coords.heading;
    const speedMs = pos.coords.speed || 0;
    const speedKmh = speedMs * 3.6;

    // Keep the last heading while stopped to avoid rotating back to north.
    if (speedKmh > 3 && rawHeading !== null && !isNaN(rawHeading)) {
        lastMapHeading = rawHeading;
    }

    if (map && carMarker) {
        carMarker.setLatLng(newLatLng);

        const carImg = document.getElementById('car-image');
        if (carImg) carImg.style.transform = `rotate(${lastMapHeading}deg)`;

        const zoom = map.getZoom();
        const maskEl = document.querySelector('.dashboard-wrapper') || document.body;
        const visibleWidth = maskEl.clientWidth;
        const offsetX = visibleWidth * 0.15;

        const targetPoint = map.project(newLatLng, zoom);
        const centerPoint = L.point(targetPoint.x + offsetX, targetPoint.y);
        const centerLatLng = map.unproject(centerPoint, zoom);

        map.panTo(centerLatLng, {
            animate: true,
            duration: 2.0,
            easeLinearity: 0.1,
        });

        const mapRotation = 360 - lastMapHeading;
        const carPixel = map.latLngToContainerPoint(newLatLng);

        const mapDiv = map.getContainer();
        mapDiv.style.transformOrigin = `${carPixel.x}px ${carPixel.y}px`;
        mapDiv.style.transform = `rotate(${mapRotation}deg)`;
    }
}

async function updateAddress(lat, lng) {
    const now = Date.now();
    if (now - lastAddressUpdate < 10000) return;
    lastAddressUpdate = now;

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            const address = data.address || {};
            const road = address.road || '';
            const suburb = address.suburb || address.neighbourhood || address.city || '';

            const addrEl = document.getElementById('current-address');
            if (addrEl) addrEl.textContent = road ? `${road}, ${suburb}` : 'Unknown Road';
        }
    } catch {
        // Keep the last address through a temporary connection failure.
    }
}

function applyMapTheme(isDark) {
    // A clone without a CARTO key keeps a usable day map.
    isDark = isDark && Boolean(CARTO_API_KEY);
    if (!mapTileLayer) return;

    if (isDark) {
        mapTileLayer.setUrl(NIGHT_TILE_URL);
        document.body.classList.remove('day-mode');
    } else {
        mapTileLayer.setUrl(DAY_TILE_URL);
        document.body.classList.add('day-mode');
    }
    const status = document.getElementById('map-theme-status');
    if (status) status.textContent = isDark ? 'Dark' : 'Light';
}

function toggleMapTheme() {
    const isCurrentlyDay = document.body.classList.contains('day-mode');

    applyMapTheme(isCurrentlyDay);
}

async function drawRouteTo(endLat, endLng) {
    const version = ++routeRequestVersion;
    if (currentLat === null || currentLng === null) {
        console.warn('Waiting for GPS position...');
        return;
    }

    const startLat = currentLat;
    const startLng = currentLng;

    const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${startLng},${startLat};${endLng},${endLat}` +
        `?overview=full&geometries=geojson`;

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Route service returned ' + res.status);
        const data = await res.json();
        if (version !== routeRequestVersion) return null;

        if (!data.routes || !data.routes.length) {
            console.error('No route returned');
            return;
        }

        currentRouteDestination = { lat: endLat, lng: endLng };
        const route = data.routes[0];
        const coords = route.geometry.coordinates;

        const latLngs = coords.map(([lng, lat]) => [lat, lng]);

        if (routeLine) {
            map.removeLayer(routeLine);
        }

        routeLine = L.polyline(latLngs, {
            color: 'blue',
            weight: 6,
            opacity: 0.85,
        }).addTo(map);

        const clearRouteMenuItem = document.getElementById('clearRouteMenuItem');
        if (clearRouteMenuItem) {
            clearRouteMenuItem.style.display = '';
        }

        const rerouteMenuItem = document.getElementById('rerouteMenuItem');

        if (rerouteMenuItem) {
            rerouteMenuItem.style.display = '';
        }

        return {
            distanceKm: route.distance / 1000,
            durationMinutes: route.duration / 60,
        };
    } catch (err) {
        console.error('Route failed:', err);
        return null;
    }
}

async function searchDestination(query) {
    if (!query || !query.trim()) return [];

    const url =
        `https://nominatim.openstreetmap.org/search` +
        `?format=json` +
        `&q=${encodeURIComponent(query.trim())}` +
        `&limit=5` +
        `&countrycodes=nz`;

    try {
        const res = await fetch(url);

        if (!res.ok) {
            console.error('Destination search failed:', res.status);
            return [];
        }

        return await res.json();
    } catch (err) {
        console.error('Destination search error:', err);
        return [];
    }
}

function clearRoute() {
    routeRequestVersion++;
    currentRouteDestination = null;
    if (routeLine && map) {
        map.removeLayer(routeLine);
        routeLine = null;
    }

    const clearRouteMenuItem = document.getElementById('clearRouteMenuItem');
    if (clearRouteMenuItem) {
        clearRouteMenuItem.style.display = 'none';
    }

    const rerouteMenuItem = document.getElementById('rerouteMenuItem');
    if (rerouteMenuItem) {
        rerouteMenuItem.style.display = 'none';
    }
}
