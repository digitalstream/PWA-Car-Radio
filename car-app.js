// --- CONFIGURATION ---
const API_BASE_URL = 'https://radiostreamapi.bettermediahub.com/api/radio';
const PROXY_ROOT = 'https://radiostreamapi.bettermediahub.com';

// --- STATE ---
let channels = [];
let currentChannel = null;
let currentAudio = null;
let currentHls = null;

// Metadata State
let metadataInterval = null;
let lastImageUrl = "";
let lastTrackTime = 0;
let metadataRetryCount = 0;

// Retry State
let isRetryingWithProxy = false;
let proxyTrialTimer = null;
let isGuest = true; // Assumed true for Car Mode unless integrated with login

// Telemetry State
let lastAlt = 0;
let lastTime = Date.now();
let lastValidHeading = 0; // Stores the last known good heading


// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
initCompass();
    setupAboutPanel(); 

    // SAFETY CHECK: Only add listener if element exists
    const aboutLink = document.getElementById('aboutLink');
    if (aboutLink) {
        aboutLink.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('aboutOverlay').style.display = 'flex';
            // Optional: Close menu
            const menu = document.getElementById('sideMenu');
            if(menu) menu.style.left = '-100vw';
        });
    } else {
        console.warn("aboutLink not found in DOM");
    }

    // Continue with the rest...
    if (typeof initMapSystem === 'function') {
        initMapSystem();
    }
    
    startClock();
    fetchChannels();
    setupListeners();
    enableDragScroll(); 
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .catch(err => console.error('SW Failed:', err));
    }
});

// --- LISTENERS ---
function setupListeners() {
    document.getElementById('stop-button').addEventListener('click', stopPlayer);
    
    document.getElementById('theme-toggle').addEventListener('click', () => {
        document.body.classList.toggle('day-mode');
    });

    document.querySelector('.address-box').addEventListener('click', () => {
        console.log("Manual GPS Restart...");
        document.getElementById('current-address').textContent = "Restarting GPS...";
        if (typeof startGpsTracking === 'function') startGpsTracking(true);
    });

        const menuBtn = document.getElementById('menu-btn');
    const sideMenu = document.getElementById('sideMenu');
    
    if (menuBtn && sideMenu) {
        menuBtn.addEventListener('click', () => {
            sideMenu.classList.toggle('open');
        });
        
        // Close when clicking empty space or link
        sideMenu.addEventListener('click', (e) => {
            if (e.target.tagName === 'A' || e.target === sideMenu) {
                sideMenu.classList.remove('open');
            }
        });
    }

    // About Link
    const aboutLink = document.getElementById('aboutLink');
    if (aboutLink) {
        aboutLink.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('aboutOverlay').style.display = 'flex';
            
            // FIX: Close the side menu now
            document.getElementById('sideMenu').classList.remove('open');
        });
    }
}

// --- TELEMETRY UI (Called by map-app.js) ---
function updateTelemetryUI(pos) {
    const speedMs = pos.coords.speed || 0;
    const rawHeading = pos.coords.heading; // Grab raw value (could be null)
    const alt = pos.coords.altitude || 0;
    
    // 1. Update Speed Text
    const speedKmh = Math.round(speedMs * 3.6);
    const elSpeed = document.getElementById('speed-val');
    if (elSpeed) elSpeed.textContent = speedKmh;
    
    // 2. Update Speed Ring (NEW)
    const ring = document.getElementById('speed-ring');
    if (ring) {
        const maxSpeed = 120;
        // Calculate degrees (Max range 270 deg)
        let degrees = Math.min((speedKmh / maxSpeed) * 270, 270);
        
        // Apply to Conic Gradient
        ring.style.background = `conic-gradient(from 225deg, var(--highlight) ${degrees}deg, transparent ${degrees}deg)`;
        
        // Optional: Change color if speeding (>100)
        if (speedKmh > 100) ring.style.setProperty('--highlight', '#ff3333');
        else ring.style.removeProperty('--highlight');
    }

// ... inside updateTelemetryUI ...

    // 3. Update Heading (Ball Logic)
    if (rawHeading !== null && !isNaN(rawHeading) && speedKmh > 3) {
        lastValidHeading = rawHeading;
    }
    
    const tape = document.getElementById('compass-tape');
    if (tape) {
        // --- CALIBRATION ---
        const tickWidth = 40; // Must match CSS
        const pxPerDeg = 40 / 15; // 40px per 15 degrees = 2.666
        
        // We generated 3 sets. Each set is 24 ticks long.
        // Middle Set starts at Index 24.
        // Index 24 * 40px = 960px.
        // To center the Middle 'N' (at 960px) in a 90px window (Center 45px):
        // Offset = 45 - (960 + 20) = -935px. (20 is half tick width)
        const baseOffset = -935;
        
        // Apply Heading
        const rotationOffset = lastValidHeading * pxPerDeg;
        const finalPx = baseOffset - rotationOffset;
        
        tape.style.transform = `translateY(-50%) translateX(${finalPx}px)`;
    }
    
    const elHead = document.getElementById('heading-val');
    if (elHead) elHead.textContent = Math.round(lastValidHeading) + "°";
    
    // 4. Update Altitude Text
    const elAlt = document.getElementById('alt-m-live');
    if (elAlt) elAlt.textContent = Math.round(alt); 
    
    // 5. Update VSI Bar
    if (typeof updateVSI === 'function') updateVSI(alt);
}

function updateVSI(currentAlt) {
    const now = Date.now();
    const timeDiff = (now - lastTime) / 1000;
    if (timeDiff < 1) return;

    const diff = currentAlt - lastAlt;
    const rate = diff / timeDiff;

    lastAlt = currentAlt;
    lastTime = now;

    const needle = document.getElementById('vsi-needle');
    if (!needle) return;

    // Scale: +/- 5 m/s covers 90 degrees
    const maxRate = 5; 
    let degrees = (rate / maxRate) * 90;
    
    // Clamp to +/- 90 (12 o'clock to 6 o'clock)
    degrees = Math.max(-60, Math.min(60, degrees));
    
    // Invert: Positive Climb (Up) needs Negative Rotation (Counter-Clockwise)
    // 0 = 3 o'clock
    // -90 = 12 o'clock
    // +90 = 6 o'clock
    needle.style.transform = `translateY(-50%) rotate(${-degrees}deg)`;
    
     needle.style.backgroundColor = 'var(--highlight)'; // Gold/Default
}

// --- CLOCK ---
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

// --- RADIO LOGIC ---
async function fetchChannels() {
    try {
        const res = await fetch(API_BASE_URL);
        channels = await res.json();
        renderChannelScroller();
    } catch (e) {
        console.error("API Error", e);
    }
}

function renderChannelScroller() {
    const container = document.getElementById('channel-scroller');
    container.innerHTML = '';
    channels.forEach(channel => {
        const btn = document.createElement('div');
        btn.className = 'car-channel-item';
        const img = document.createElement('img');
        img.src = channel.imageUrl;
        img.loading = "lazy";
        btn.appendChild(img);
        btn.onclick = () => playChannel(channel);
        container.appendChild(btn);
    });
}

// --- PLAY/STOP LOGIC (With Retry & Proxy) ---
async function playChannel(channel, forceProxy = false) {
    if (!forceProxy) {
        stopPlayer();
        currentChannel = channel;
        isRetryingWithProxy = false;
        
        document.getElementById('meta-station').textContent = channel.name;
        document.getElementById('player-logo').src = channel.imageUrl;
        document.getElementById('meta-artist').textContent = "";
        
        if (channel.metadataUrl) {
            document.getElementById('meta-title').textContent = "Loading Track Info...";
        } else {
            document.getElementById('meta-title').textContent = "Live Stream";
        }
    }

    try {
        // Stop if user cancelled
        if (currentChannel !== channel) return;

        const res = await fetch(`${API_BASE_URL}/stream/${channel.id}`);
        const data = await res.json();
        let streamUrl = data.resolvedUrl;

        // Proxy Decision
        const senHosts = ['d2dgwrtikgx7lx.cloudfront.net','d11fwwlrb0wuhh.cloudfront.net','d2jt3l9ulybyg4.cloudfront.net'];
        const isSen = senHosts.some(host => streamUrl.includes(host));
        
        if (isSen || forceProxy) {
             console.log("Applying Proxy...");
             streamUrl = `${PROXY_ROOT}/s-recursive-proxy.ashx?url=${encodeURIComponent(streamUrl)}`;
             
             // Freemium Logic (5 mins for guests)
             if (isGuest) {
                  if (proxyTrialTimer) clearTimeout(proxyTrialTimer);
                  proxyTrialTimer = setTimeout(() => {
                      stopPlayer();
                      alert("Free Preview Ended. Please Log In.");
                  }, 300000);
             }
        } else {
             if (streamUrl.startsWith('http:')) streamUrl = streamUrl.replace('http:', 'https:');
             if (streamUrl.includes('streamtheworld.com')) streamUrl += `?bust=${Date.now()}`;
        }

        const audio = new Audio();
        audio.src = streamUrl;
        currentAudio = audio;
        
        // Playback Error Handler
        const handlePlayError = (err) => {
             console.error("Playback Failed:", err);
             // Retry via Proxy if Troublesome
             if (!isRetryingWithProxy && channel.isTroublesomeChromeSmall) {
                 console.log("Retrying via Proxy...");
                 isRetryingWithProxy = true;
                 stopPlayer(); 
                 playChannel(channel, true);
             } else {
                 document.getElementById('meta-title').textContent = "Stream Error";
             }
        };

        if (Hls.isSupported() && (streamUrl.includes('.m3u8') || streamUrl.includes('.ashx'))) {
            const hls = new Hls();
            currentHls = hls;
            hls.loadSource(streamUrl);
            hls.attachMedia(audio);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (currentChannel === channel) { 
                    audio.play().catch(e => {
                        if (e.name !== 'NotAllowedError') handlePlayError(e);
                    });
                    startMetadataPolling();
                }
            });
            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) handlePlayError(data);
            });
        } else {
            audio.play().then(() => {
                if (currentChannel === channel) startMetadataPolling();
            }).catch(e => {
                if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') handlePlayError(e);
            });
        }

    } catch (e) {
        console.error(e);
        document.getElementById('meta-title').textContent = "Error Loading Stream";
    }
}

function stopPlayer() {
    if (metadataInterval) { clearInterval(metadataInterval); metadataInterval = null; }
    if (proxyTrialTimer) { clearTimeout(proxyTrialTimer); proxyTrialTimer = null; }

    if (currentHls) { currentHls.destroy(); currentHls = null; }
    if (currentAudio) { 
        currentAudio.pause(); 
        currentAudio.removeAttribute('src'); 
        currentAudio.load(); 
        currentAudio = null; 
    }
    
    document.querySelectorAll('audio').forEach(el => { el.pause(); el.remove(); });
    
    lastImageUrl = "";
    lastTrackTime = 0;
    metadataRetryCount = 0;
    currentChannel = null;
    
    document.getElementById('meta-station').textContent = "Select Station";
    document.getElementById('meta-title').textContent = "Ready";
    document.getElementById('meta-artist').textContent = "";
    document.getElementById('player-logo').src = "images/poster4.png";
}

// --- METADATA LOGIC ---
async function updateMetadata() {
    if (!currentChannel || !currentChannel.metadataUrl) return;
    
    try {
        const res = await fetch(`${currentChannel.metadataUrl}?t=${Date.now()}`);
        if (!currentChannel) return;

        if(res.ok) {
            const textRaw = await res.text();
            if (!textRaw || textRaw.trim() === "") { handleMetadataStrike(); return; }

            const data = JSON.parse(textRaw);
            let title = ""; let artist = ""; let image = ""; let trackTime = 0;

            // 1. Parsing
            if (data.artist) { 
                artist = data.artist; title = data.title; image = data.imagePath; trackTime = data.startTime || 0;
            } else if (data.nowPlaying) { 
                artist = data.nowPlaying.artist; title = data.nowPlaying.name; image = data.nowPlaying.largeArtwork; 
                if (image) image = image.replace(/\[width\]/gi, '1000').replace(/\[height\]/gi, '1000');
            } else if (data.nowplaying && data.nowplaying[0]) {
                 const t = data.nowplaying[0];
                 artist = t.artist; title = t.title; image = t.imageUrl;
                 if (t.time) trackTime = Date.parse(t.time);
            }

            // 2. Validation
            const hasInfo = artist && title && artist.trim() !== "";
            if (!hasInfo) { handleMetadataStrike(); return; }

            if (trackTime > 0 && lastTrackTime > 0 && trackTime < lastTrackTime) return;
            if (trackTime > 0) lastTrackTime = trackTime;
            
            metadataRetryCount = 0; // Clear strikes

            // 3. UI Update
            if (image && image.startsWith('http:')) image = image.replace('http:', 'https:');
            
            document.getElementById('meta-title').textContent = title;
            document.getElementById('meta-artist').textContent = artist;
            
            if (image) {
                if (typeof lastImageUrl === 'undefined') window.lastImageUrl = "";
                if (lastImageUrl !== image) {
                    lastImageUrl = image;
                    const imgLoader = new Image();
                    imgLoader.onload = () => { 
                        if(currentChannel) document.getElementById('player-logo').src = image; 
                    };
                    imgLoader.src = image;
                }
            } else {
                document.getElementById('player-logo').src = currentChannel.imageUrl;
            }
        } else {
             handleMetadataStrike();
        }
    } catch (e) {
        handleMetadataStrike();
    }
}

function handleMetadataStrike() {
    metadataRetryCount++;
    if (metadataRetryCount >= 2) {
        document.getElementById('meta-title').textContent = "Live Stream";
        document.getElementById('meta-artist').textContent = "";
        if(currentChannel) document.getElementById('player-logo').src = currentChannel.imageUrl;
    }
}

function startMetadataPolling() {
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
    slider.addEventListener('mouseleave', () => { isDown = false; });
    slider.addEventListener('mouseup', () => { isDown = false; });
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
    
    tape.innerHTML = ''; // Clear it
    
    // Define the Cardinals
    const cardinals = {
        0: 'N',
        45: 'NE',
        90: 'E',
        135: 'SE',
        180: 'S',
        225: 'SW',
        270: 'W',
        315: 'NW'
    };
    
    // Generate one full circle (0 to 345 in 15 degree steps)
    const points = [];
    for (let i = 0; i < 360; i += 15) {
        if (cardinals[i]) {
            points.push({ type: 'major', text: cardinals[i] });
        } else {
            points.push({ type: 'number', text: i.toString() });
        }
    }
    
    // Create 3 loops for smooth infinite scrolling
    // (Left Buffer + Center + Right Buffer)
    const fullList = [...points, ...points, ...points];
    
    fullList.forEach(p => {
        const span = document.createElement('span');
        span.className = `tick ${p.type}`; // 'tick major' or 'tick number'
        span.textContent = p.text;
        tape.appendChild(span);
    });
}

// --- ABOUT PANEL LOGIC ---
function setupAboutPanel() {
    const content = `
        <div class="about-header">
            <h2>System Architecture</h2>
            <p>v1.1.0 | Build: Release</p>
        </div>

        <div class="tech-section">
            <h4>Core Engine</h4>
            <p>
                A high-performance Automotive Dashboard PWA powered by a custom <strong>C# .NET Core API</strong>. 
                The backend acts as a central proxy and metadata aggregator, normalizing data from disparate radio networks (iHeart, Rova, StreamGuys) into a unified JSON stream.
            </p>
            <div class="tech-tags">
                <span class="tag">C# .NET 8</span>
                <span class="tag">Web API</span>
                <span class="tag">Recursive Proxy</span>
                <span class="tag">Memory Cache</span>
            </div>
        </div>

        <div class="tech-section">
            <h4>Telemetry & GIS</h4>
            <p>
                Real-time <strong>High-Accuracy GPS Telemetry</strong> calculating vectors for Speed, Vertical Speed (VSI), and Heading. 
                Implements a custom <strong>Heading-Up</strong> navigation engine using Leaflet.js with algorithmic visual offsetting to optimize driver visibility.
                Features reverse-geocoding via OpenStreetMap.
            </p>
            <div class="tech-tags">
                <span class="tag">Leaflet.js</span>
                <span class="tag">Geolocation API</span>
                <span class="tag">Vector Math</span>
                <span class="tag">Nominatim</span>
            </div>
        </div>

        <div class="tech-section">
            <h4>Resilience & UX</h4>
            <p>
                Engineered for unreliable networks with <strong>Auto-Retry</strong> logic, <strong>Offline Caching (Service Worker)</strong>, 
                and automatic <strong>Day/Night</strong> switching synchronized with vehicle headlights via system theme detection.
            </p>
            <div class="tech-tags">
                <span class="tag">PWA</span>
                <span class="tag">HLS.js</span>
                <span class="tag">Glassmorphism</span>
            </div>
        </div>

        <button id="about-close-btn">Close ABOUT</button>
    `;

    const panel = document.getElementById('aboutPanelContent');
    if (panel) {
        panel.innerHTML = content;
        document.getElementById('about-close-btn').addEventListener('click', () => {
            document.getElementById('aboutOverlay').style.display = 'none';
        });
    }
}

