/**
 * US Bloom Scout — US-first Pikmin Bloom decor finder
 * Local OSM cache for ZIP 50010 (Ames, IA) so US users skip slow live Overpass.
 */

const HOME = {
  zip: '50010',
  // Downtown Ames (Main St) — denser POIs than the postcode centroid
  lat: 42.025,
  lon: -93.614,
  label: 'US · 50010 Downtown Ames',
  bbox: {
    south: 41.9834204,
    west: -93.6762780,
    north: 42.0734814,
    east: -93.5554840,
  },
  cacheUrl: 'data/ames-50010.json',
};

const OVERPASS_SERVERS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const EARTH_R = 6371000;

const queryCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Local OSM snapshot for ZIP 50010 — loaded once at boot */
let homeSnapshot = null;

let map;
let markersLayer;
let centerMarker;
let rangeCircle;
let mode = 'nearby';
let selectedDecor = null;
let activeAbort = null;
let lastCenter = { lat: HOME.lat, lon: HOME.lon };
let lastResults = [];

const $ = (sel) => document.querySelector(sel);

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return Math.round(EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function inHomeBbox(lat, lon) {
  const b = HOME.bbox;
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

function setStatus(msg, busy = false) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('is-busy', busy);
}

function elementLatLon(el) {
  if (el.type === 'node') return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  if (el.lat != null) return { lat: el.lat, lon: el.lon };
  return null;
}

function placeName(tags = {}) {
  return tags.name || tags['name:en'] || tags.brand || tags.operator || 'Unnamed place';
}

async function loadHomeSnapshot() {
  const res = await fetch(HOME.cacheUrl, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Cache HTTP ${res.status}`);
  homeSnapshot = await res.json();
  return homeSnapshot;
}

function filterSnapshotAround(lat, lon, radiusM) {
  if (!homeSnapshot?.elements) return [];
  return homeSnapshot.elements.filter((el) => {
    const pos = elementLatLon(el);
    if (!pos || !el.tags) return false;
    return haversine(lat, lon, pos.lat, pos.lon) <= radiusM;
  });
}

function filterSnapshotByDecor(decorName) {
  if (!homeSnapshot?.elements) return [];
  return homeSnapshot.elements.filter((el) => {
    if (!el.tags) return false;
    return matchDecorCategories(el.tags).some((d) => d.name === decorName);
  });
}

async function queryOverpass(query, { timeoutMs = 28000, signal } = {}) {
  const key = query.replace(/\s+/g, ' ').trim();
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.elements;

  let lastError;
  for (const server of OVERPASS_SERVERS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onCancel = () => ctrl.abort();
    signal?.addEventListener('abort', onCancel, { once: true });
    try {
      const res = await fetch(server, {
        method: 'POST',
        body: query,
        headers: {
          'Content-Type': 'text/plain',
          Accept: 'application/json',
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCancel);
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const data = await res.json();
      const elements = data.elements || [];
      queryCache.set(key, { at: Date.now(), elements });
      return elements;
    } catch (err) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCancel);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      lastError = err;
    }
  }
  throw lastError || new Error('Overpass failed');
}

async function geocode(q) {
  const url = new URL(`${NOMINATIM}/search`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', q);
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Geocode failed');
  const data = await res.json();
  if (!data.length) return null;
  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    label: data[0].display_name,
  };
}

function cancelInFlight() {
  if (activeAbort) activeAbort.abort();
  activeAbort = new AbortController();
  return activeAbort.signal;
}

function clearMapOverlays() {
  markersLayer.clearLayers();
  if (centerMarker) {
    map.removeLayer(centerMarker);
    centerMarker = null;
  }
  if (rangeCircle) {
    map.removeLayer(rangeCircle);
    rangeCircle = null;
  }
}

function setScanCenter(lat, lon, { zoom = 16, fly = true } = {}) {
  lastCenter = { lat, lon };
  clearMapOverlays();
  const icon = L.divIcon({
    className: '',
    html: '<div class="center-pin"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  centerMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map);
  rangeCircle = L.circle([lat, lon], {
    radius: DETECTOR_RANGE,
    color: '#3f9a45',
    weight: 2,
    fillColor: '#6fbf4a',
    fillOpacity: 0.12,
  }).addTo(map);
  if (fly) map.flyTo([lat, lon], zoom, { duration: 0.55 });
  else map.setView([lat, lon], zoom);
  $('#btn-scan').disabled = false;
}

function markerIcon(decor) {
  return L.divIcon({
    className: '',
    html: `<div class="decor-marker" style="background:${decor.color}">${decor.icon}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderResults(items) {
  lastResults = items;
  const list = $('#results');
  list.innerHTML = '';
  $('#result-count').textContent = `${items.length} place${items.length === 1 ? '' : 's'}`;

  items.forEach((item, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'result-item';
    btn.style.setProperty('--accent', item.decor.color);
    btn.style.animationDelay = `${Math.min(idx, 12) * 0.03}s`;
    btn.innerHTML = `
      <span class="badge">${item.decor.icon}</span>
      <span class="meta">
        <div class="title">${escapeHtml(item.name)}</div>
        <div class="sub">${escapeHtml(item.decor.name)}${item.decor.costume ? ` · ${escapeHtml(item.decor.costume)}` : ''}</div>
      </span>
      <span class="dist">${item.dist != null ? `${item.dist} m` : ''}</span>
    `;
    btn.addEventListener('click', () => {
      list.querySelectorAll('.result-item').forEach((el) => el.classList.remove('is-active'));
      btn.classList.add('is-active');
      map.flyTo([item.lat, item.lon], Math.max(map.getZoom(), 17), { duration: 0.4 });
      if (item.marker) item.marker.openPopup();
    });
    list.appendChild(btn);
  });
}

function elementsToResults(elements, origin) {
  const seen = new Set();
  const out = [];
  for (const el of elements) {
    const pos = elementLatLon(el);
    if (!pos || !el.tags) continue;
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const matches = matchDecorCategories(el.tags);
    if (!matches.length) continue;
    for (const decor of matches) {
      out.push({
        id: `${key}:${decor.name}`,
        name: placeName(el.tags),
        lat: pos.lat,
        lon: pos.lon,
        decor,
        dist: origin ? haversine(origin.lat, origin.lon, pos.lat, pos.lon) : null,
        tags: el.tags,
      });
    }
  }
  out.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));
  return out;
}

function plotResults(items) {
  markersLayer.clearLayers();
  for (const item of items) {
    const marker = L.marker([item.lat, item.lon], { icon: markerIcon(item.decor) })
      .bindPopup(
        `<strong>${escapeHtml(item.name)}</strong><br>${escapeHtml(item.decor.name)}` +
          (item.decor.costume ? `<br><em>${escapeHtml(item.decor.costume)}</em>` : '') +
          (item.dist != null ? `<br>${item.dist} m away` : '')
      )
      .addTo(markersLayer);
    item.marker = marker;
  }
}

async function fetchNearbyElements(lat, lon, signal) {
  // Instant path: filter preloaded ZIP 50010 snapshot
  if (homeSnapshot && inHomeBbox(lat, lon)) {
    return {
      elements: filterSnapshotAround(lat, lon, DETECTOR_RANGE),
      source: 'local-50010',
    };
  }
  const query = buildOverpassQuery(lat, lon, DETECTOR_RANGE);
  const elements = await queryOverpass(query, { signal, timeoutMs: 25000 });
  return { elements, source: 'overpass' };
}

async function scanNearby(lat, lon, { fly = true } = {}) {
  const signal = cancelInFlight();
  setScanCenter(lat, lon, { fly, zoom: 16 });
  const local = homeSnapshot && inHomeBbox(lat, lon);
  setStatus(
    local
      ? `Scanning ${DETECTOR_RANGE} m · US cache ${HOME.zip} (instant)…`
      : `Scanning ${DETECTOR_RANGE} m · live Overpass (slower outside US cache)…`,
    true
  );
  try {
    const { elements, source } = await fetchNearbyElements(lat, lon, signal);
    const items = elementsToResults(elements, { lat, lon });
    plotResults(items);
    renderResults(items);
    const srcNote =
      source === 'local-50010' ? ' · US instant cache' : ' · live Overpass';
    setStatus(
      items.length
        ? `Found ${items.length} decor spot${items.length === 1 ? '' : 's'}${srcNote}.`
        : `No mapped decor in detector range${srcNote}.`
    );
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    setStatus('Map data request failed. Try again in a moment.');
  }
}

async function browseDecorInHomeZip(decorName) {
  cancelInFlight();
  const decor = DECOR_MAPPINGS.find((d) => d.name === decorName);
  if (!decor) return;

  setStatus(`Finding ${decorName} in ZIP ${HOME.zip}…`, true);
  clearMapOverlays();

  let elements;
  if (homeSnapshot) {
    elements = filterSnapshotByDecor(decorName);
  } else {
    const signal = activeAbort.signal;
    const { south, west, north, east } = HOME.bbox;
    const query = buildOverpassBboxQuery(south, west, north, east, decorName);
    elements = await queryOverpass(query, { signal, timeoutMs: 30000 });
  }

  const items = elementsToResults(elements, lastCenter).filter((i) => i.decor.name === decorName);
  plotResults(items);
  renderResults(items);

  const { south, west, north, east } = HOME.bbox;
  if (items.length) {
    const group = L.featureGroup(items.map((i) => i.marker));
    map.fitBounds(group.getBounds().pad(0.12), { maxZoom: 15, animate: true });
    setStatus(`${items.length} ${decorName} location${items.length === 1 ? '' : 's'} in US ZIP ${HOME.zip} · instant cache.`);
  } else {
    map.fitBounds(
      [
        [south, west],
        [north, east],
      ],
      { padding: [24, 24] }
    );
    setStatus(`No ${decorName} spots tagged in ZIP ${HOME.zip} on OSM.`);
  }
}

function buildDecorGrid(filter = '') {
  const grid = $('#decor-grid');
  const q = filter.trim().toLowerCase();
  grid.innerHTML = '';
  DECOR_MAPPINGS.filter((d) => {
    if (!q) return true;
    return (
      d.name.toLowerCase().includes(q) ||
      (d.costume && d.costume.toLowerCase().includes(q))
    );
  }).forEach((d) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'decor-chip' + (selectedDecor === d.name ? ' is-selected' : '');
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', selectedDecor === d.name ? 'true' : 'false');
    btn.title = d.costume || d.name;
    btn.innerHTML = `<span class="swatch" style="background:${d.color}"></span><span class="name">${d.icon} ${d.name}</span>`;
    btn.addEventListener('click', () => {
      selectedDecor = d.name;
      $('#btn-find').disabled = false;
      buildDecorGrid($('#decor-filter').value);
    });
    grid.appendChild(btn);
  });
}

function setMode(next) {
  mode = next;
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.mode === next;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.mode-pane').forEach((pane) => {
    pane.classList.toggle('is-active', pane.dataset.pane === next);
  });
}

function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
  }).setView([HOME.lat, HOME.lon], 14);

  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  L.rectangle(
    [
      [HOME.bbox.south, HOME.bbox.west],
      [HOME.bbox.north, HOME.bbox.east],
    ],
    {
      color: '#3f9a45',
      weight: 1.5,
      dashArray: '6 6',
      fillOpacity: 0.03,
      interactive: false,
    }
  ).addTo(map);

  map.on('click', (e) => {
    if (mode === 'nearby') scanNearby(e.latlng.lat, e.latlng.lng);
  });
}

function bindUi() {
  buildDecorGrid();

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  });

  $('#decor-filter').addEventListener('input', (e) => buildDecorGrid(e.target.value));

  $('#btn-find').addEventListener('click', () => {
    if (selectedDecor) browseDecorInHomeZip(selectedDecor);
  });

  $('#btn-clear').addEventListener('click', () => {
    cancelInFlight();
    selectedDecor = null;
    $('#btn-find').disabled = true;
    buildDecorGrid($('#decor-filter').value);
    clearMapOverlays();
    renderResults([]);
    setStatus(`Cleared. Home area is ZIP ${HOME.zip}.`);
    map.flyTo([HOME.lat, HOME.lon], 14, { duration: 0.45 });
  });

  $('#btn-scan').addEventListener('click', () => {
    const c = map.getCenter();
    scanNearby(c.lat, c.lng);
  });

  const runSearch = async () => {
    const q = $('#address').value.trim() || HOME.zip;
    // Skip geocode round-trip for the home zip
    if (/^\s*50010\s*$/.test(q) || q.toLowerCase() === 'ames' || q.toLowerCase() === 'ames, ia') {
      await scanNearby(HOME.lat, HOME.lon);
      return;
    }
    setStatus(`Looking up “${q}”…`, true);
    try {
      const hit = await geocode(q);
      if (!hit) {
        setStatus('No matching place found.');
        return;
      }
      await scanNearby(hit.lat, hit.lon);
    } catch (err) {
      console.error(err);
      setStatus('Address lookup failed.');
    }
  };

  $('#btn-search').addEventListener('click', runSearch);
  $('#address').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSearch();
  });

  $('#btn-locate').addEventListener('click', () => {
    if (!navigator.geolocation) {
      setStatus('Geolocation not available — using 50010.');
      scanNearby(HOME.lat, HOME.lon);
      return;
    }
    setStatus('Getting your location…', true);
    navigator.geolocation.getCurrentPosition(
      (pos) => scanNearby(pos.coords.latitude, pos.coords.longitude),
      () => {
        setStatus('Location blocked — falling back to 50010.');
        scanNearby(HOME.lat, HOME.lon);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  $('#address').value = HOME.zip;
  $('#address').placeholder = `Search… (home: ${HOME.zip})`;
}

async function boot() {
  initMap();
  bindUi();
  setStatus(`Loading ${HOME.label} cache…`, true);
  setScanCenter(HOME.lat, HOME.lon, { zoom: 15, fly: false });

  try {
    await loadHomeSnapshot();
    const n = homeSnapshot?.elements?.length ?? 0;
    setStatus(`Cached ${n.toLocaleString()} OSM places for ${HOME.zip}.`);
  } catch (err) {
    console.warn('Local cache miss; live Overpass will be used.', err);
    homeSnapshot = null;
  }

  await scanNearby(HOME.lat, HOME.lon, { fly: false });
}

boot();
