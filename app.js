/**
 * US Bloom Scout — US-first Pikmin Bloom decor finder
 * Prefers US geocoding; optional local seed cache speeds some areas.
 */

const DEFAULT = {
  // Contiguous US midpoint — neutral start (not tied to one ZIP)
  lat: 39.8283,
  lon: -98.5795,
  zoom: 5,
};

const OVERPASS_SERVERS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const EARTH_R = 6371000;
/** Soft cap so Overpass bbox queries stay responsive (~city-scale) */
const MAX_BBOX_SPAN_DEG = 0.35;

const queryCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Optional seed cache (speeds one US area if present) — never required */
let seedCache = null;

let map;
let markersLayer;
let centerMarker;
let rangeCircle;
let mode = 'nearby';
/** @type {Set<string>} */
let selectedDecors = new Set();
let activeAbort = null;
let lastCenter = { lat: DEFAULT.lat, lon: DEFAULT.lon };
/** Active search/area label for status messages */
let activeAreaLabel = 'map view';
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

function inBbox(lat, lon, bbox) {
  if (!bbox) return false;
  return lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east;
}

function clampBbox(bbox) {
  let { south, west, north, east } = bbox;
  const latSpan = north - south;
  const lonSpan = east - west;
  if (latSpan > MAX_BBOX_SPAN_DEG) {
    const mid = (south + north) / 2;
    south = mid - MAX_BBOX_SPAN_DEG / 2;
    north = mid + MAX_BBOX_SPAN_DEG / 2;
  }
  if (lonSpan > MAX_BBOX_SPAN_DEG) {
    const mid = (west + east) / 2;
    west = mid - MAX_BBOX_SPAN_DEG / 2;
    east = mid + MAX_BBOX_SPAN_DEG / 2;
  }
  return { south, west, north, east };
}

function mapViewportBbox() {
  const b = map.getBounds();
  return clampBbox({
    south: b.getSouth(),
    west: b.getWest(),
    north: b.getNorth(),
    east: b.getEast(),
  });
}

async function loadSeedCache() {
  try {
    const res = await fetch('data/seed-cache.json', { cache: 'force-cache' });
    if (!res.ok) return null;
    seedCache = await res.json();
    return seedCache;
  } catch {
    return null;
  }
}

function filterSeedAround(lat, lon, radiusM) {
  if (!seedCache?.elements || !seedCache.bbox) return null;
  if (!inBbox(lat, lon, seedCache.bbox)) return null;
  return seedCache.elements.filter((el) => {
    const pos = elementLatLon(el);
    if (!pos || !el.tags) return false;
    return haversine(lat, lon, pos.lat, pos.lon) <= radiusM;
  });
}

function filterSeedByDecorInBbox(decorNames, bbox) {
  if (!seedCache?.elements || !seedCache.bbox) return null;
  const names = new Set(decorNames);
  // Only use seed when viewport overlaps seed area
  const overlap =
    bbox.south < seedCache.bbox.north &&
    bbox.north > seedCache.bbox.south &&
    bbox.west < seedCache.bbox.east &&
    bbox.east > seedCache.bbox.west;
  if (!overlap) return null;
  return seedCache.elements.filter((el) => {
    const pos = elementLatLon(el);
    if (!pos || !el.tags) return false;
    if (!inBbox(pos.lat, pos.lon, bbox)) return false;
    return matchDecorCategories(el.tags).some((d) => names.has(d.name));
  });
}

function updateFindButton() {
  const btn = $('#btn-find');
  const n = selectedDecors.size;
  btn.disabled = n === 0;
  if (n === 0) btn.textContent = 'Show in map view';
  else if (n === 1) btn.textContent = 'Show 1 type in view';
  else btn.textContent = `Show ${n} types in view`;
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

/** US-preferring geocode; ZIP codes use postalcode lookup */
async function geocode(q) {
  const trimmed = q.trim();
  const url = new URL(`${NOMINATIM}/search`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');

  const zipMatch = trimmed.match(/^(\d{5})(?:-\d{4})?$/);
  if (zipMatch) {
    url.searchParams.set('postalcode', zipMatch[1]);
    url.searchParams.set('countrycodes', 'us');
  } else {
    url.searchParams.set('q', trimmed);
    url.searchParams.set('countrycodes', 'us');
  }

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en-US',
    },
  });
  if (!res.ok) throw new Error('Geocode failed');
  let data = await res.json();

  // Fallback without country filter if US-restricted search misses
  if (!data.length && !zipMatch) {
    const url2 = new URL(`${NOMINATIM}/search`);
    url2.searchParams.set('format', 'json');
    url2.searchParams.set('limit', '1');
    url2.searchParams.set('q', trimmed);
    const res2 = await fetch(url2.toString(), { headers: { Accept: 'application/json' } });
    if (res2.ok) data = await res2.json();
  }

  if (!data.length) return null;
  const hit = data[0];
  const bb = hit.boundingbox; // [south, north, west, east]
  return {
    lat: parseFloat(hit.lat),
    lon: parseFloat(hit.lon),
    label: hit.display_name,
    bbox: bb
      ? {
          south: parseFloat(bb[0]),
          north: parseFloat(bb[1]),
          west: parseFloat(bb[2]),
          east: parseFloat(bb[3]),
        }
      : null,
  };
}

function cancelInFlight() {
  if (activeAbort) activeAbort.abort();
  activeAbort = new AbortController();
  return activeAbort.signal;
}

function clearMapOverlays({ keepMarkers = false } = {}) {
  if (!keepMarkers) markersLayer.clearLayers();
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
  const seeded = filterSeedAround(lat, lon, DETECTOR_RANGE);
  if (seeded) return { elements: seeded, source: 'cache' };
  const query = buildOverpassQuery(lat, lon, DETECTOR_RANGE);
  const elements = await queryOverpass(query, { signal, timeoutMs: 25000 });
  return { elements, source: 'live' };
}

async function scanNearby(lat, lon, { fly = true, zoom = 16 } = {}) {
  const signal = cancelInFlight();
  setScanCenter(lat, lon, { fly, zoom });
  setStatus(`Scanning ${DETECTOR_RANGE} m for decor…`, true);
  try {
    const { elements, source } = await fetchNearbyElements(lat, lon, signal);
    const items = elementsToResults(elements, { lat, lon });
    plotResults(items);
    renderResults(items);
    const note = source === 'cache' ? ' · cached' : '';
    setStatus(
      items.length
        ? `Found ${items.length} decor spot${items.length === 1 ? '' : 's'}${note}.`
        : `No mapped decor within ${DETECTOR_RANGE} m.`
    );
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    setStatus('Map data request failed. Try again in a moment.');
  }
}

/** Find selected decor type(s) in the current map view (any ZIP / city / pan) */
async function browseDecorInView(decorNames) {
  const names = [...decorNames];
  if (!names.length) return;
  const signal = cancelInFlight();

  const bbox = mapViewportBbox();
  const label =
    names.length === 1 ? names[0] : `${names.length} decor types`;
  setStatus(`Finding ${label} in current map view…`, true);
  clearMapOverlays({ keepMarkers: false });

  try {
    let elements = filterSeedByDecorInBbox(names, bbox);
    let source = 'cache';
    if (!elements) {
      const query = buildOverpassBboxQueryMulti(
        bbox.south,
        bbox.west,
        bbox.north,
        bbox.east,
        names
      );
      elements = await queryOverpass(query, { signal, timeoutMs: 40000 });
      source = 'live';
    }

    const nameSet = new Set(names);
    const origin = map.getCenter();
    const items = elementsToResults(elements, {
      lat: origin.lat,
      lon: origin.lng,
    }).filter((i) => nameSet.has(i.decor.name));

    plotResults(items);
    renderResults(items);

    if (items.length) {
      const group = L.featureGroup(items.map((i) => i.marker));
      map.fitBounds(group.getBounds().pad(0.12), { maxZoom: 15, animate: true });
      setStatus(
        `${items.length} place${items.length === 1 ? '' : 's'} · ${label} in view` +
          (source === 'cache' ? ' · cached' : '') +
          `.`
      );
    } else {
      setStatus(`No matching spots for ${label} in this map view on OSM.`);
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    setStatus('Browse request failed. Zoom in a bit and try again.');
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
    const on = selectedDecors.has(d.name);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'decor-chip' + (on ? ' is-selected' : '');
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.title = (d.costume || d.name) + ' — click to toggle';
    btn.innerHTML = `<span class="swatch" style="background:${d.color}"></span><span class="name">${d.icon} ${d.name}</span>`;
    btn.addEventListener('click', () => {
      if (selectedDecors.has(d.name)) selectedDecors.delete(d.name);
      else selectedDecors.add(d.name);
      updateFindButton();
      buildDecorGrid($('#decor-filter').value);
    });
    grid.appendChild(btn);
  });
  updateFindButton();
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
  }).setView([DEFAULT.lat, DEFAULT.lon], DEFAULT.zoom);

  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    if (mode === 'nearby') {
      activeAreaLabel = 'map pin';
      scanNearby(e.latlng.lat, e.latlng.lng);
    }
  });
}

function bindUi() {
  buildDecorGrid();

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  });

  $('#decor-filter').addEventListener('input', (e) => buildDecorGrid(e.target.value));

  $('#btn-find').addEventListener('click', () => {
    if (selectedDecors.size) browseDecorInView(selectedDecors);
  });

  $('#btn-clear').addEventListener('click', () => {
    cancelInFlight();
    selectedDecors.clear();
    updateFindButton();
    buildDecorGrid($('#decor-filter').value);
    clearMapOverlays();
    renderResults([]);
    setStatus('Cleared. Search a ZIP or city, or click the map.');
  });

  $('#btn-scan').addEventListener('click', () => {
    const c = map.getCenter();
    activeAreaLabel = 'map center';
    scanNearby(c.lat, c.lng);
  });

  const runSearch = async () => {
    const q = $('#address').value.trim();
    if (!q) {
      setStatus('Enter a US ZIP, city, or address.');
      return;
    }
    setStatus(`Looking up “${q}”…`, true);
    try {
      const hit = await geocode(q);
      if (!hit) {
        setStatus('No matching place found. Try a US ZIP (e.g. 78701) or city.');
        return;
      }
      activeAreaLabel = hit.label;
      if (hit.bbox) {
        map.fitBounds(
          [
            [hit.bbox.south, hit.bbox.west],
            [hit.bbox.north, hit.bbox.east],
          ],
          { padding: [28, 28], maxZoom: 15, animate: true }
        );
      }
      await scanNearby(hit.lat, hit.lon, { fly: !hit.bbox, zoom: 15 });
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
      setStatus('Geolocation not available in this browser.');
      return;
    }
    setStatus('Getting your location…', true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        activeAreaLabel = 'your location';
        scanNearby(pos.coords.latitude, pos.coords.longitude);
      },
      () => setStatus('Location permission blocked.'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  $('#address').value = '';
  $('#address').placeholder = 'US ZIP, city, or address…';
}

async function boot() {
  initMap();
  bindUi();
  setStatus('Search any US ZIP or city — or use your location.');
  await loadSeedCache();

  // Prefer device location on first load when available
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        activeAreaLabel = 'your location';
        scanNearby(pos.coords.latitude, pos.coords.longitude, { zoom: 15 });
      },
      () => {
        /* stay on US overview until user searches */
      },
      { enableHighAccuracy: false, timeout: 4000 }
    );
  }
}

boot();
