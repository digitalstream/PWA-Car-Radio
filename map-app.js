// --- MAP STATE ---
let map = null;
let carMarker = null;
let gpsWatchId = null;
let lastAddressUpdate = 0;

let mapTileLayer = null; 

// --- PUBLIC INIT ---
// Called by car-app.js when the page loads
function initMapSystem() {
    initMap();
    // Try to start GPS immediately
    if (navigator.geolocation) {
        startGpsTracking(true);
    }
}

// --- MAP SETUP ---
function initMap() {
    map = L.map('map-container', { zoomControl: false }).setView([-36.8485, 174.7633], 17);

    // 1. Create Tile Layer (Start with default, will be updated instantly)
        mapTileLayer = L.tileLayer('', { 
        maxZoom: 19,
        // NEW: Keep more tiles loaded off-screen so they are ready when we spin
        keepBuffer: 8 
    }).addTo(map);

    // ... Car Icon code ... (Keep as is)
        const carIcon = L.divIcon({
        className: 'car-marker-icon',
        // Make sure 'images/car-icon.png' exists in your folder!
        html: '<img src="images/car-icon.png" style="width: 50px; transform: rotate(0deg);" id="car-image">', 
        iconSize: [50, 50],
        iconAnchor: [25, 25] // Centers the icon
    });
    
    // Add Marker to Map
    carMarker = L.marker([-36.8485, 174.7633], {icon: carIcon}).addTo(map);

    // 2. Setup Theme Detection
    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    // Run once on load
    applyMapTheme(false);
    
    // Listen for Headlights
    darkModeQuery.addEventListener('change', (e) => applyMapTheme(e.matches));
}

// --- GPS TRACKING ---
function startGpsTracking(highAccuracy = true) {
    if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
    
    gpsWatchId = navigator.geolocation.watchPosition(
        handleGpsUpdate, 
        (err) => {
            console.warn("GPS Error", err);
            // If High Accuracy times out (Error 3), try Low Accuracy
            if (err.code === 3 && highAccuracy) {
                startGpsTracking(false);
            } else {
                // Update UI to show error (Check if UI element exists first)
                const addr = document.getElementById('current-address');
                if (addr) addr.textContent = "GPS Signal Lost";
            }
        }, 
        { enableHighAccuracy: highAccuracy, timeout: 15000, maximumAge: 0 }
    );
}

// --- CORE UPDATE LOOP ---
function handleGpsUpdate(pos) {
    // 1. Internal Map Update (Move car, pan map)
    updateMapState(pos);
    
    // 2. External UI Update (Call function in car-app.js)
    if (typeof updateTelemetryUI === 'function') {
        updateTelemetryUI(pos);
    }
    
    // 3. Address Update (Internal)
    updateAddress(pos.coords.latitude, pos.coords.longitude);
}

// Add this variable at the very top of map-app.js if it's not there
let lastMapHeading = 0; 

function updateMapState(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const newLatLng = new L.LatLng(lat, lng);
    
    // 1. GET RAW DATA
    const rawHeading = pos.coords.heading;
    const speedMs = pos.coords.speed || 0;
    const speedKmh = speedMs * 3.6;

    // 2. APPLY THE "COMPASS LOGIC" (Speed Check)
    // Only update the map rotation if we are moving (> 3km/h) 
    // AND the GPS gave us a valid number.
    if (speedKmh > 3 && rawHeading !== null && !isNaN(rawHeading)) {
        lastMapHeading = rawHeading;
    }
    
    // 3. UPDATE MAP
    if (map && carMarker) {
        // Move Car
        carMarker.setLatLng(newLatLng);
        
        // Rotate Icon (Using the stable heading)
        const carImg = document.getElementById('car-image');
        if (carImg) carImg.style.transform = `rotate(${lastMapHeading}deg)`;
        
        // Offset Logic (Car on Left)
        const zoom = map.getZoom();
        const maskEl = document.querySelector('.dashboard-wrapper') || document.body;
        const visibleWidth = maskEl.clientWidth;
        const offsetX = visibleWidth * 0.15; 
        
        const targetPoint = map.project(newLatLng, zoom);
        const centerPoint = L.point(targetPoint.x + offsetX, targetPoint.y);
        const centerLatLng = map.unproject(centerPoint, zoom);
        
                map.panTo(centerLatLng, { 
            animate: true, 
            duration: 2.0,  // Was 1.0. Try 2.0 for ultra-smoothness.
            easeLinearity: 0.1 
        });
        
        // Rotate Container (Using the stable heading)
        const mapRotation = 360 - lastMapHeading;
        const carPixel = map.latLngToContainerPoint(newLatLng);
        
        const mapDiv = map.getContainer();
        mapDiv.style.transformOrigin = `${carPixel.x}px ${carPixel.y}px`;
        mapDiv.style.transform = `rotate(${mapRotation}deg)`;
    }
}

// --- HELPERS ---
async function updateAddress(lat, lng) {
    const now = Date.now();
    if (now - lastAddressUpdate < 10000) return;
    lastAddressUpdate = now;

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
        const res = await fetch(url, { headers: { "User-Agent": "BetterRadioCarApp/1.0" } });
        if (res.ok) {
            const data = await res.json();
            const road = data.address.road || "";
            const suburb = data.address.suburb || data.address.neighbourhood || data.address.city || "";
            
            const addrEl = document.getElementById('current-address');
            if (addrEl) addrEl.textContent = road ? `${road}, ${suburb}` : "Unknown Road";
        }
    } catch (e) {}
}

function applyMapTheme(isDark) {
    if (!mapTileLayer) return;

    // isDark will be 'true' if system is dark, 'false' otherwise
    if (isDark) {
        // NIGHT MODE
        mapTileLayer.setUrl('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
        document.body.classList.remove('day-mode');
    } else {
        // DAY MODE (Default)
        mapTileLayer.setUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
        document.body.classList.add('day-mode');
    }
}

// --- PUBLIC TOGGLE ---
function toggleMapTheme() {
    const isCurrentlyDay = document.body.classList.contains('day-mode');
    
    // If Day -> Switch to Night (isDark = true)
    // If Night -> Switch to Day (isDark = false)
    applyMapTheme(isCurrentlyDay); 
}



document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('theme-toggle');
    if (btn) {
        btn.addEventListener('click', () => {
            // Toggle current state based on body class
            const isCurrentlyDay = document.body.classList.contains('day-mode');
            applyMapTheme(!isCurrentlyDay); // Flip it
        });
    }
});