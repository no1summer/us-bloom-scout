/**
 * US Bloom Scout — US-first Pikmin Bloom decor finder
 * Speed: compact ZIP windows, raced Overpass mirrors, local result cache.
 */

const DEFAULT = {
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
/** ~5–6 km half-span — keeps Overpass queries fast */
const MAX_BBOX_SPAN_DEG = 0.1;
/** Default search window around a ZIP centroid (~4 km) */
const ZIP_PAD_DEG = 0.038;

const queryCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;
const LS_PREFIX = 'ubs:v2:';

/** Support links — change coffeeUrl if your Buy Me a Coffee handle differs */
const SUPPORT = {
  githubRepo: 'no1summer/us-bloom-scout',
  coffeeUrl: 'https://www.buymeacoffee.com/no1summer',
  likeKey: 'ubs:liked:v1',
};

let map;
let markersLayer;
let centerMarker;
let areaRect = null;
/** @type {Set<string>} */
let selectedDecors = new Set();
let activeAbort = null;
let lastCenter = { lat: DEFAULT.lat, lon: DEFAULT.lon };
let activeAreaLabel = 'map view';
let activeSearchBbox = null;
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

function areaAround(lat, lon, pad = ZIP_PAD_DEG) {
  return clampBbox({
    south: lat - pad,
    north: lat + pad,
    west: lon - pad,
    east: lon + pad,
  });
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

function browseTargetBbox() {
  if (activeSearchBbox) return clampBbox(activeSearchBbox);
  return mapViewportBbox();
}

function updateFindButton() {
  const btn = $('#btn-find');
  const n = selectedDecors.size;
  btn.disabled = n === 0;
  if (n === 0) btn.textContent = 'Show in area';
  else if (n === 1) btn.textContent = 'Show 1 type in area';
  else btn.textContent = `Show ${n} types in area`;
}

function cacheGet(key) {
  const mem = queryCache.get(key);
  if (mem && Date.now() - mem.at < CACHE_TTL_MS) return mem.elements;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.at > CACHE_TTL_MS) {
      localStorage.removeItem(LS_PREFIX + key);
      return null;
    }
    queryCache.set(key, parsed);
    return parsed.elements;
  } catch {
    return null;
  }
}

function cacheSet(key, elements) {
  const entry = { at: Date.now(), elements };
  queryCache.set(key, entry);
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota — ignore */
  }
}

function cacheKey(s) {
  // short stable key
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return 'q' + (h >>> 0).toString(36);
}

/** Emit node+way lines (skip slow relations) for a tag filter */
function nwLines(filter, scope) {
  return [`node${filter}(${scope});`, `way${filter}(${scope});`];
}

/** Fast bbox query for selected decor types only */
function buildFastBboxQuery(south, west, north, east, decorNames) {
  const relevant = DECOR_MAPPINGS.filter((d) => decorNames.includes(d.name));
  if (!relevant.length) return null;
  const bbox = `${south},${west},${north},${east}`;
  const tagsByKey = {};
  const compound = new Set();

  relevant.forEach((decor) => {
    (decor.tags || []).forEach((tag) => {
      if (!tagsByKey[tag.key]) tagsByKey[tag.key] = new Set();
      tagsByKey[tag.key].add(tag.value);
    });
    (decor.tagGroups || []).forEach((group) => {
      const predicates = group.map((t) => `["${t.key}"="${t.value}"]`).join('');
      compound.add(predicates);
    });
  });

  const lines = [];
  for (const [key, values] of Object.entries(tagsByKey)) {
    const arr = [...values];
    const filter =
      arr.length === 1
        ? `["${key}"="${arr[0]}"]`
        : `["${key}"~"^(${arr.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$"]`;
    lines.push(...nwLines(filter, bbox));
  }
  compound.forEach((predicates) => {
    lines.push(...nwLines(predicates, bbox));
  });

  return `
[out:json][timeout:15];
(
  ${lines.join('\n  ')}
);
out center tags qt;
  `.trim();
}

/**
 * Race Overpass mirrors in parallel — first OK response wins.
 * Much faster from the US than trying Europe mirrors one-by-one.
 */
async function queryOverpass(query, { timeoutMs = 16000, signal } = {}) {
  const key = cacheKey(query);
  const cached = cacheGet(key);
  if (cached) return cached;

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const errors = [];
  const controllers = [];

  const winner = await new Promise((resolve, reject) => {
    let settled = false;
    let pending = OVERPASS_SERVERS.length;

    const failOne = (err) => {
      errors.push(err);
      pending -= 1;
      if (!settled && pending === 0) {
        reject(errors.find((e) => e?.name !== 'AbortError') || errors[0] || new Error('Overpass failed'));
      }
    };

    const onExternalAbort = () => {
      controllers.forEach((c) => c.abort());
      if (!settled) {
        settled = true;
        reject(new DOMException('Aborted', 'AbortError'));
      }
    };
    signal?.addEventListener('abort', onExternalAbort, { once: true });

    OVERPASS_SERVERS.forEach((server) => {
      const ctrl = new AbortController();
      controllers.push(ctrl);
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      fetch(server, {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain', Accept: 'application/json' },
        signal: ctrl.signal,
      })
        .then(async (res) => {
          clearTimeout(timer);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (settled) return;
          settled = true;
          controllers.forEach((c) => {
            if (c !== ctrl) c.abort();
          });
          signal?.removeEventListener('abort', onExternalAbort);
          resolve(data.elements || []);
        })
        .catch((err) => {
          clearTimeout(timer);
          failOne(err);
        });
    });
  });

  cacheSet(key, winner);
  return winner;
}

async function geocode(q) {
  const trimmed = q.trim();
  const gKey = LS_PREFIX + 'geo:' + trimmed.toLowerCase();
  try {
    const raw = localStorage.getItem(gKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.at < GEOCODE_TTL_MS) return parsed.hit;
    }
  } catch {
    /* ignore */
  }

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
    headers: { Accept: 'application/json', 'Accept-Language': 'en-US' },
  });
  if (!res.ok) throw new Error('Geocode failed');
  let data = await res.json();

  if (!data.length && !zipMatch) {
    const url2 = new URL(`${NOMINATIM}/search`);
    url2.searchParams.set('format', 'json');
    url2.searchParams.set('limit', '1');
    url2.searchParams.set('q', trimmed);
    const res2 = await fetch(url2.toString(), { headers: { Accept: 'application/json' } });
    if (res2.ok) data = await res2.json();
  }

  if (!data.length) return null;
  const hitRaw = data[0];
  const hit = {
    lat: parseFloat(hitRaw.lat),
    lon: parseFloat(hitRaw.lon),
    label: hitRaw.display_name,
  };
  try {
    localStorage.setItem(gKey, JSON.stringify({ at: Date.now(), hit }));
  } catch {
    /* ignore */
  }
  return hit;
}

/** Reverse-geocode lat/lon → US ZIP (and short label). Cached. */
async function reverseGeocode(lat, lon) {
  const key =
    LS_PREFIX +
    'rev:' +
    lat.toFixed(3) +
    ',' +
    lon.toFixed(3);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.at < GEOCODE_TTL_MS) return parsed.hit;
    }
  } catch {
    /* ignore */
  }

  const url = new URL(`${NOMINATIM}/reverse`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json', 'Accept-Language': 'en-US' },
  });
  if (!res.ok) throw new Error('Reverse geocode failed');
  const data = await res.json();
  const addr = data.address || {};
  const zip = (addr.postcode || '').toString().match(/\d{5}/)?.[0] || null;
  const city =
    addr.city || addr.town || addr.village || addr.hamlet || addr.county || '';
  const state = addr.state || '';
  const hit = {
    lat,
    lon,
    zip,
    label: data.display_name || [zip, city, state].filter(Boolean).join(', '),
    city,
    state,
  };
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), hit }));
  } catch {
    /* ignore */
  }
  return hit;
}

let reverseTimer = null;
let suppressReverseUntil = 0;
let lastShownZip = '';

function pauseAutoZip(ms = 1200) {
  suppressReverseUntil = Date.now() + ms;
}

/** Update the search box + active area from a map position */
async function syncZipFromLatLon(lat, lon, { quiet = false, placePin = !quiet } = {}) {
  try {
    const hit = await reverseGeocode(lat, lon);
    activeAreaLabel = hit.label;
    activeSearchBbox = areaAround(lat, lon);
    if (placePin) {
      pauseAutoZip(1200);
      setAreaPin(lat, lon, {
        zoom: map.getZoom(),
        fly: false,
        bbox: activeSearchBbox,
      });
    }
    if (hit.zip) {
      if (hit.zip !== lastShownZip) {
        $('#address').value = hit.zip;
        lastShownZip = hit.zip;
      }
      if (!quiet) {
        const place = [hit.city, hit.state].filter(Boolean).join(', ');
        setStatus(`ZIP ${hit.zip}${place ? ` · ${place}` : ''} — select decor types, then Show in area.`);
      }
    } else if (!quiet) {
      setStatus('No ZIP for this spot — still searchable on the map.');
    }
    return hit;
  } catch (err) {
    console.warn(err);
    if (!quiet) setStatus('Could not resolve ZIP for this location.');
    return null;
  }
}

function scheduleZipFromMapCenter() {
  if (Date.now() < suppressReverseUntil) return;
  clearTimeout(reverseTimer);
  reverseTimer = setTimeout(() => {
    if (Date.now() < suppressReverseUntil) return;
    const c = map.getCenter();
    syncZipFromLatLon(c.lat, c.lng, { quiet: true });
  }, 650);
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
  if (areaRect) {
    map.removeLayer(areaRect);
    areaRect = null;
  }
}

/** Drop a pin and show the active search area for Find a decor */
function setAreaPin(lat, lon, { zoom = 14, fly = true, bbox = null } = {}) {
  lastCenter = { lat, lon };
  const box = bbox || activeSearchBbox || areaAround(lat, lon);
  activeSearchBbox = box;

  if (centerMarker) map.removeLayer(centerMarker);
  if (areaRect) map.removeLayer(areaRect);

  const icon = L.divIcon({
    className: '',
    html: '<div class="center-pin"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  centerMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map);
  areaRect = L.rectangle(
    [
      [box.south, box.west],
      [box.north, box.east],
    ],
    {
      color: '#3f9a45',
      weight: 1.5,
      dashArray: '6 4',
      fillColor: '#6fbf4a',
      fillOpacity: 0.06,
      interactive: false,
    }
  ).addTo(map);

  if (fly) map.setView([lat, lon], zoom, { animate: true, duration: 0.35 });
  else map.setView([lat, lon], zoom, { animate: false });
}

function markerIcon(decor, { pure = false } = {}) {
  const size = pure ? 44 : 34;
  const ring = pure
    ? 'box-shadow:0 0 0 3px #f0c346,0 0 0 6px rgba(240,195,70,0.35),0 8px 16px rgba(0,0,0,0.25);'
    : 'box-shadow:0 6px 14px rgba(0,0,0,0.22);';
  const badge = pure
    ? `<span style="position:absolute;top:-6px;right:-6px;background:#f0c346;color:#3d2b00;font-size:9px;font-weight:800;border-radius:999px;padding:1px 4px;border:1px solid #fff;">P</span>`
    : '';
  return L.divIcon({
    className: '',
    html: `<div class="decor-marker${pure ? ' is-pure' : ''}" style="width:${size}px;height:${size}px;background:${decor.color};${ring};position:relative">${decor.icon}${badge}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Pure = only decor place in its smallest local region.
 * The region radius is min(distance to nearest other result, DETECTOR_RANGE).
 * A spot is pure when nothing else (any type) sits inside that smallest cell —
 * i.e. it is the sole spot in its local neighborhood.
 * Rank: most isolated first (largest empty radius around them).
 */
function annotatePureSpots(items) {
  const RANGE = typeof DETECTOR_RANGE === 'number' ? DETECTOR_RANGE : 100;

  for (const item of items) {
    let nearestOther = Infinity; // any other place
    let nearestOtherType = Infinity; // different decor type
    const typesInRange = new Set([item.decor.name]);
    let othersInRange = 0;

    for (const other of items) {
      if (other === item || other.id === item.id) continue;
      // Same OSM place listed under multiple types — treat as same point
      if (other.placeKey && item.placeKey && other.placeKey === item.placeKey) {
        typesInRange.add(other.decor.name);
        continue;
      }
      const d = haversine(item.lat, item.lon, other.lat, other.lon);
      if (d < nearestOther) nearestOther = d;
      if (other.decor.name !== item.decor.name && d < nearestOtherType) {
        nearestOtherType = d;
      }
      if (d <= RANGE) {
        othersInRange += 1;
        typesInRange.add(other.decor.name);
      }
    }

    // Smallest region that still only contains this spot (= distance to nearest neighbor)
    const aloneRadius =
      nearestOther === Infinity ? RANGE : Math.min(nearestOther, RANGE);

    item.aloneRadiusM = aloneRadius;
    item.isolationM = nearestOther === Infinity ? 1e9 : nearestOther;
    item.typesInRange = [...typesInRange];
    // Only one place in the smallest local region (nothing else within detector range)
    item.soleInSmallestRegion = othersInRange === 0;
    // Also require a single decor category at this OSM place when possible
    item.purePlace = (item.matchCount || 1) === 1;
    item.pure = item.soleInSmallestRegion;
    // Score: prefer truly alone spots; then larger isolation (more empty around them)
    item.pureScore = (item.pure ? 1e9 : 0) + item.isolationM + (item.purePlace ? 1e3 : 0);
  }

  items.sort((a, b) => {
    if (b.pureScore !== a.pureScore) return b.pureScore - a.pureScore;
    return (a.dist ?? 0) - (b.dist ?? 0);
  });
  return items;
}

function renderResults(items) {
  lastResults = items;
  const list = $('#results');
  list.innerHTML = '';
  const pureN = items.filter((i) => i.pure).length;
  $('#result-count').textContent =
    `${items.length} place${items.length === 1 ? '' : 's'}` +
    (pureN ? ` · ${pureN} pure` : '');

  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'result-item' + (item.pure ? ' is-pure' : '');
    btn.style.setProperty('--accent', item.decor.color);
    const pureTag = item.pure
      ? `<span class="pure-tag" title="Only decor spot within ~${item.aloneRadiusM != null ? Math.round(item.aloneRadiusM) : 100} m">PURE</span>`
      : '';
    btn.innerHTML = `
      <span class="badge">${item.decor.icon}</span>
      <span class="meta">
        <div class="title">${escapeHtml(item.name)} ${pureTag}</div>
        <div class="sub">${escapeHtml(item.decor.name)}${item.decor.costume ? ` · ${escapeHtml(item.decor.costume)}` : ''}${
          item.pure
            ? ` · alone in ~${Math.round(item.aloneRadiusM || 100)} m`
            : ''
        }</div>
      </span>
      <span class="dist">${item.dist != null ? `${item.dist} m` : ''}</span>
    `;
    btn.addEventListener('click', () => {
      list.querySelectorAll('.result-item').forEach((el) => el.classList.remove('is-active'));
      btn.classList.add('is-active');
      map.setView([item.lat, item.lon], Math.max(map.getZoom(), 17), { animate: true });
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
        placeKey: key,
        name: placeName(el.tags),
        lat: pos.lat,
        lon: pos.lon,
        decor,
        matchCount: matches.length,
        matchNames: matches.map((m) => m.name),
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
    const marker = L.marker([item.lat, item.lon], {
      icon: markerIcon(item.decor, { pure: !!item.pure }),
      zIndexOffset: item.pure ? 500 : 0,
    })
      .bindPopup(
        `<strong>${escapeHtml(item.name)}</strong>` +
          (item.pure
            ? `<br><span style="color:#9a6b00;font-weight:700">✦ PURE</span> — only decor spot in its smallest region (~${Math.round(item.aloneRadiusM || 100)}&nbsp;m)`
            : '') +
          `<br>${escapeHtml(item.decor.name)}` +
          (item.decor.costume ? `<br><em>${escapeHtml(item.decor.costume)}</em>` : '') +
          (item.matchCount > 1
            ? `<br><span style="opacity:.75">Also tagged: ${escapeHtml(item.matchNames.join(', '))}</span>`
            : '') +
          (item.dist != null ? `<br>${item.dist} m away` : '')
      )
      .addTo(markersLayer);
    item.marker = marker;
  }
}

/** Find selected decor type(s) in the searched ZIP/city (or current map view) */
async function browseDecorInView(decorNames) {
  const names = [...decorNames];
  if (!names.length) return;
  const signal = cancelInFlight();

  const bbox = browseTargetBbox();
  const areaNote = activeSearchBbox
    ? activeAreaLabel.split(',').slice(0, 2).join(',')
    : 'current map view';
  const label =
    names.length === 1 ? names[0] : `${names.length} decor types`;
  setStatus(`Finding ${label} near ${areaNote}…`, true);

  markersLayer.clearLayers();

  pauseAutoZip(2000);
  map.fitBounds(
    [
      [bbox.south, bbox.west],
      [bbox.north, bbox.east],
    ],
    { padding: [28, 28], maxZoom: 15, animate: true }
  );

  const t0 = performance.now();
  try {
    const query = buildFastBboxQuery(
      bbox.south,
      bbox.west,
      bbox.north,
      bbox.east,
      names
    );
    if (!query) {
      setStatus('No decor types selected.');
      return;
    }
    const elements = await queryOverpass(query, { signal, timeoutMs: 16000 });

    const nameSet = new Set(names);
    const origin = {
      lat: (bbox.south + bbox.north) / 2,
      lon: (bbox.west + bbox.east) / 2,
    };
    let items = elementsToResults(elements, origin).filter((i) =>
      nameSet.has(i.decor.name)
    );
    annotatePureSpots(items);

    const pureOnly = $('#pure-only')?.checked;
    if (pureOnly) items = items.filter((i) => i.pure);

    plotResults(items);
    renderResults(items);
    const ms = Math.round(performance.now() - t0);
    const pureN = items.filter((i) => i.pure).length;

    if (items.length) {
      const group = L.featureGroup(items.map((i) => i.marker));
      map.fitBounds(group.getBounds().pad(0.12), { maxZoom: 15, animate: true });
      setStatus(
        `${items.length} place${items.length === 1 ? '' : 's'}` +
          (pureN ? ` · ${pureN} pure (alone in smallest region)` : '') +
          ` (${ms} ms).`
      );
    } else {
      setStatus(
        pureOnly
          ? `No pure spots for ${label} in ${areaNote}.`
          : `No matching spots for ${label} in ${areaNote} (${ms} ms).`
      );
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    setStatus('Browse request failed. Try fewer types or a smaller area.');
  }
}

function isMobileSheet() {
  return window.matchMedia('(max-width: 820px)').matches;
}

function setPanelExpanded(open) {
  const panel = $('#panel');
  const handle = $('#panel-handle');
  if (!panel) return;
  panel.classList.toggle('is-expanded', !!open);
  panel.classList.toggle('is-collapsed', !open);
  handle?.setAttribute('aria-expanded', open ? 'true' : 'false');
  setTimeout(refreshMapSize, 280);
}

function expandPanelForDecor() {
  if (isMobileSheet()) setPanelExpanded(true);
}

function toggleDecor(name) {
  if (selectedDecors.has(name)) selectedDecors.delete(name);
  else selectedDecors.add(name);
  updateFindButton();
  buildDecorGrid($('#decor-filter')?.value || '');
}

function buildDecorGrid(filter = '') {
  const grid = $('#decor-grid');
  const empty = $('#decor-empty');
  const selectedWrap = $('#decor-selected');
  const q = filter.trim().toLowerCase();
  grid.innerHTML = '';

  // Selected pills (easy to see / remove on phone)
  if (selectedWrap) {
    selectedWrap.innerHTML = '';
    if (selectedDecors.size === 0) {
      selectedWrap.hidden = true;
    } else {
      selectedWrap.hidden = false;
      [...selectedDecors].forEach((name) => {
        const decor = DECOR_MAPPINGS.find((d) => d.name === name);
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'decor-pill';
        pill.title = 'Remove ' + name;
        pill.innerHTML = `${decor?.icon || ''} ${name} <span class="x">×</span>`;
        pill.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          selectedDecors.delete(name);
          updateFindButton();
          buildDecorGrid($('#decor-filter').value);
        });
        selectedWrap.appendChild(pill);
      });
    }
  }

  const matches = DECOR_MAPPINGS.filter((d) => {
    if (!q) return true;
    return (
      d.name.toLowerCase().includes(q) ||
      (d.costume && d.costume.toLowerCase().includes(q))
    );
  });

  if (empty) empty.hidden = matches.length > 0;

  matches.forEach((d) => {
    const on = selectedDecors.has(d.name);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'decor-chip' + (on ? ' is-selected' : '');
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.title = (d.costume || d.name) + ' — tap to toggle';
    btn.innerHTML = `<span class="swatch" style="background:${d.color}"></span><span class="name">${d.icon} ${d.name}</span>`;

    let down = null;
    btn.addEventListener(
      'pointerdown',
      (e) => {
        down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      },
      { passive: true }
    );
    btn.addEventListener(
      'pointerup',
      (e) => {
        if (!down || down.id !== e.pointerId) return;
        const moved =
          Math.abs(e.clientX - down.x) > 14 || Math.abs(e.clientY - down.y) > 14;
        down = null;
        if (moved) return; // scrolling the list, not a tap
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        expandPanelForDecor();
        toggleDecor(d.name);
      },
      { passive: false }
    );
    btn.addEventListener('pointercancel', () => {
      down = null;
    });
    grid.appendChild(btn);
  });
  updateFindButton();
}

function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    fadeAnimation: false,
    zoomAnimation: true,
    markerZoomAnimation: false,
    tapTolerance: 25,
  }).setView([DEFAULT.lat, DEFAULT.lon], DEFAULT.zoom);

  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    opacity: 1,
    updateWhenIdle: true,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  map.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    pauseAutoZip(1500);
    activeSearchBbox = areaAround(lat, lng);
    await syncZipFromLatLon(lat, lng, { quiet: false, placePin: true });
    // Keep the sheet open so decor types stay tappable after setting a ZIP
    if (isMobileSheet()) {
      setPanelExpanded(true);
      refreshMapSize();
    }
  });

  map.on('moveend', () => scheduleZipFromMapCenter());

  requestAnimationFrame(() => refreshMapSize());
  window.addEventListener('resize', () => refreshMapSize());
  window.addEventListener('orientationchange', () => setTimeout(refreshMapSize, 250));
}

function refreshMapSize() {
  if (!map) return;
  map.invalidateSize({ animate: false });
}

function isLiked() {
  try {
    return localStorage.getItem(SUPPORT.likeKey) === '1';
  } catch {
    return false;
  }
}

function setLiked(on) {
  try {
    localStorage.setItem(SUPPORT.likeKey, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function paintLikeUi(count) {
  const liked = isLiked();
  document.querySelectorAll('.like-btn').forEach((btn) => {
    btn.classList.toggle('is-liked', liked);
    btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
    const ico = btn.querySelector('.support-ico');
    if (ico) ico.textContent = liked ? '♥' : '♡';
  });
  document.querySelectorAll('.support-count, #like-count, .like-count-panel').forEach((el) => {
    if (typeof count === 'number') el.textContent = String(count);
  });
}

async function loadLikeCount() {
  let stars = 0;
  try {
    const res = await fetch(`https://api.github.com/repos/${SUPPORT.githubRepo}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (res.ok) {
      const data = await res.json();
      stars = data.stargazers_count || 0;
    }
  } catch {
    /* offline / rate limit */
  }
  const localBonus = isLiked() ? 1 : 0;
  // Show GitHub stars; if user liked locally but hasn't starred, still show +1 feel via max
  const shown = Math.max(stars, localBonus ? stars + (stars === 0 ? 1 : 0) : stars);
  paintLikeUi(shown || (isLiked() ? 1 : 0));
  return stars;
}

function bindSupportUi() {
  document.querySelectorAll('a.coffee-btn').forEach((a) => {
    a.href = SUPPORT.coffeeUrl;
  });

  const onLike = async () => {
    const next = !isLiked();
    setLiked(next);
    paintLikeUi();
    // Bump visible count optimistically
    document.querySelectorAll('.support-count, #like-count, .like-count-panel').forEach((el) => {
      const n = parseInt(el.textContent, 10) || 0;
      el.textContent = String(Math.max(0, n + (next ? 1 : -1)) || (next ? 1 : 0));
    });
    if (next) {
      // Encourage a GitHub star (persistent public like)
      window.open(`https://github.com/${SUPPORT.githubRepo}`, '_blank', 'noopener,noreferrer');
      setStatus('Thanks for the like — starring the GitHub repo helps a lot!');
    } else {
      setStatus('Like removed.');
    }
  };

  $('#btn-like')?.addEventListener('click', onLike);
  $('#btn-like-panel')?.addEventListener('click', onLike);
  paintLikeUi(0);
  loadLikeCount();
}

function bindPanelSheet() {
  const panel = $('#panel');
  const handle = $('#panel-handle');
  if (!panel || !handle) return;

  const toggle = () => {
    const open = !panel.classList.contains('is-expanded');
    setPanelExpanded(open);
  };
  handle.addEventListener('click', toggle);

  // Swipe up/down on handle area
  let startY = null;
  handle.addEventListener(
    'touchstart',
    (e) => {
      startY = e.changedTouches[0].clientY;
    },
    { passive: true }
  );
  handle.addEventListener(
    'touchend',
    (e) => {
      if (startY == null) return;
      const dy = e.changedTouches[0].clientY - startY;
      startY = null;
      if (dy < -28) setPanelExpanded(true);
      else if (dy > 28) setPanelExpanded(false);
    },
    { passive: true }
  );

  // Expanding when the user starts picking types
  $('#decor-picker')?.addEventListener(
    'pointerdown',
    () => expandPanelForDecor(),
    { passive: true }
  );
}

function bindUi() {
  buildDecorGrid();
  bindSupportUi();
  bindPanelSheet();

  $('#decor-filter').addEventListener('input', (e) => buildDecorGrid(e.target.value));
  $('#decor-filter').addEventListener('focus', () => expandPanelForDecor());

  $('#btn-find').addEventListener('click', () => {
    if (selectedDecors.size) {
      expandPanelForDecor();
      browseDecorInView(selectedDecors);
    }
  });

  $('#pure-only')?.addEventListener('change', () => {
    if (selectedDecors.size && lastResults.length) {
      browseDecorInView(selectedDecors);
    }
  });

  $('#btn-clear').addEventListener('click', () => {
    cancelInFlight();
    selectedDecors.clear();
    activeSearchBbox = null;
    activeAreaLabel = 'map view';
    lastShownZip = '';
    updateFindButton();
    buildDecorGrid($('#decor-filter').value);
    clearMapOverlays();
    renderResults([]);
    $('#address').value = '';
    setStatus('Cleared. Tap the map or search a ZIP.');
  });

  const runSearch = async () => {
    const q = $('#address').value.trim();
    if (!q) {
      setStatus('Enter a US ZIP, city, or address — or tap the map.');
      return;
    }
    setStatus(`Looking up “${q}”…`, true);
    pauseAutoZip(2000);
    try {
      const hit = await geocode(q);
      if (!hit) {
        setStatus('No matching place found. Try a US ZIP (e.g. 78701) or city.');
        return;
      }
      activeAreaLabel = hit.label;
      activeSearchBbox = areaAround(hit.lat, hit.lon);
      if (/^\d{5}/.test(q)) {
        lastShownZip = q.slice(0, 5);
        $('#address').value = lastShownZip;
      } else {
        syncZipFromLatLon(hit.lat, hit.lon, { quiet: true, placePin: false });
      }
      setAreaPin(hit.lat, hit.lon, { zoom: 14, fly: true, bbox: activeSearchBbox });
      setStatus(
        `Area set: ${hit.label.split(',').slice(0, 2).join(',')}. Select decor → Show in area.`
      );
      // Blur keyboard on mobile
      $('#address')?.blur();
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
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        pauseAutoZip(2000);
        activeSearchBbox = areaAround(lat, lon);
        setAreaPin(lat, lon, { zoom: 14, fly: true });
        await syncZipFromLatLon(lat, lon, { placePin: false });
      },
      () => setStatus('Location permission blocked — enable location for this site.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

async function boot() {
  initMap();
  bindUi();
  if (isMobileSheet()) setPanelExpanded(true);
  setStatus('Tap the map or search a ZIP, then select decor types.');
}

boot();
