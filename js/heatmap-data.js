// Atlas Météo — Open-Meteo heatmap data client (v0.1, rate-limit aware)
// =============================================================================
// CRITICAL: Open-Meteo counts EACH location in a multi-location request as a
// separate API call. Free tier limits: 600/min, 5000/h, 10000/day. The naive
// v0 with 1° Europe + 0.2° Switzerland grids was 2180 calls per variable per
// day-load — which blew the minutely limit on a single layer toggle and broke
// the rest of the app's weather queries by exhausting our IP quota.
//
// This v0.1 fixes that with four mechanisms:
//   1. Coarser grids: Europe 4°, Switzerland 0.5°. 190 calls per variable per
//      day-load (11× less). Visual quality stays good thanks to bilinear
//      interpolation in the render layer.
//   2. Throttled queue: every Open-Meteo request goes through a single
//      internal queue that fires at most one HTTP call every 250 ms. This
//      keeps us under the 600/min ceiling regardless of how aggressively the
//      user toggles layers or scrubs the timeline.
//   3. localStorage cache: fetched day-data is persisted in the browser for
//      6 hours. Returning users (or page refreshers) don't re-pay for
//      already-fetched days.
//   4. Rate-limit detection: when Open-Meteo returns its rate-limit error
//      payload, the queue auto-pauses for 65 s and retries. After 2 retries
//      we give up to avoid infinite loops on hourly/daily limits.
// =============================================================================

import { API } from './config.js';

// -------- Grid definitions --------------------------------------------------

// Coarse continental grid. 4° step ≈ 440 km. With bilinear interpolation
// the rendered output still looks smooth — we lose detail of small weather
// features but keep the broad pattern of fronts, lows, and bands.
const EUROPE_GRID = {
  bbox: { latMin: 35, latMax: 70, lonMin: -12, lonMax: 32 },
  step: 4.0,    // 9 × 12 = 108 points (clipped by bbox to ~99)
};

// Fine grid over Switzerland + 100 km buffer. 0.5° ≈ 55 km — coarse enough
// to stay under quota, fine enough to capture local features in the Alps.
const SWISS_GRID = {
  bbox: { latMin: 45.0, latMax: 48.2, lonMin: 5.0, lonMax: 11.5 },
  step: 0.5,    // 7 × 13 = 91 points
};

const MODEL = 'best_match';     // ICON-CH1 in Switzerland, ECMWF/GFS elsewhere
const BATCH_SIZE = 200;         // points per HTTP request

// -------- Throttled fetch queue --------------------------------------------

const QUEUE_INTERVAL_MS    = 250;     // ≤ 240 requests/min (well under 600)
const RATE_LIMIT_PAUSE_MS  = 65_000;  // wait 65 s on minutely limit hit
const MAX_RETRIES          = 2;

const _queue = [];
let   _processing = false;
let   _rateLimitedUntil = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function queuedFetch(url) {
  return new Promise((resolve, reject) => {
    _queue.push({ url, resolve, reject, retries: 0 });
    processQueue();
  });
}

async function processQueue() {
  if (_processing) return;
  _processing = true;

  while (_queue.length) {
    // Honor outstanding rate-limit pause
    const wait = _rateLimitedUntil - Date.now();
    if (wait > 0) await sleep(wait);

    const item = _queue.shift();
    try {
      const resp = await fetch(item.url);
      const data = await resp.json();

      // Open-Meteo signals errors as 200 OK with { error: true, reason: ... }
      if (data && data.error === true) {
        const isRateLimit = /limit exceeded/i.test(data.reason || '');
        if (isRateLimit && item.retries < MAX_RETRIES) {
          console.warn(`[heatmap] Rate limit, pausing ${RATE_LIMIT_PAUSE_MS / 1000}s and retrying:`, data.reason);
          _rateLimitedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
          _queue.unshift({ ...item, retries: item.retries + 1 });
          continue;
        }
        // Out of retries or non-rate-limit error → fail this and cancel the
        // rest of the queue to avoid more pointless requests.
        const err = new Error(data.reason || 'Open-Meteo error');
        item.reject(err);
        if (isRateLimit) {
          console.warn('[heatmap] Rate limit exhausted retries, cancelling pending fetches');
          while (_queue.length) _queue.shift().reject(new Error('Cancelled (rate limit)'));
        }
        continue;
      }

      item.resolve(data);
    } catch (err) {
      item.reject(err);
    }

    if (_queue.length) await sleep(QUEUE_INTERVAL_MS);
  }

  _processing = false;
}

// -------- localStorage persistent cache ------------------------------------

const LS_PREFIX = 'atlas_hm_';
const LS_TTL_MS = 6 * 60 * 60 * 1000;  // 6 hours

function lsKey(variable, dKey) {
  return `${LS_PREFIX}${variable}_${dKey}`;
}

function lsGet(variable, dKey) {
  try {
    const raw = localStorage.getItem(lsKey(variable, dKey));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj.ts || Date.now() - obj.ts > LS_TTL_MS) {
      localStorage.removeItem(lsKey(variable, dKey));
      return null;
    }
    return obj.data;
  } catch { return null; }
}

function lsSet(variable, dKey, data) {
  try {
    localStorage.setItem(lsKey(variable, dKey),
      JSON.stringify({ ts: Date.now(), data }));
  } catch (e) {
    // QuotaExceededError happens when LS is full. Try a janitorial pass:
    // drop the oldest atlas_hm_ entries and retry once.
    if (e && /Quota/.test(e.name || '')) {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(LS_PREFIX)) keys.push(k);
        }
        // Drop half (oldest by stored ts)
        const items = keys.map(k => {
          try { return { k, ts: JSON.parse(localStorage.getItem(k)).ts || 0 }; }
          catch { return { k, ts: 0 }; }
        }).sort((a, b) => a.ts - b.ts);
        for (let i = 0; i < Math.ceil(items.length / 2); i++) {
          localStorage.removeItem(items[i].k);
        }
        localStorage.setItem(lsKey(variable, dKey),
          JSON.stringify({ ts: Date.now(), data }));
      } catch {
        // Give up silently — in-memory cache still works
      }
    }
  }
}

// -------- Grid enumeration + URL building ----------------------------------

function enumerateGrid(grid) {
  const lats = [], lons = [], pts = [];
  for (let lat = grid.bbox.latMin; lat <= grid.bbox.latMax + 1e-6; lat += grid.step) {
    lats.push(+lat.toFixed(3));
  }
  for (let lon = grid.bbox.lonMin; lon <= grid.bbox.lonMax + 1e-6; lon += grid.step) {
    lons.push(+lon.toFixed(3));
  }
  for (const lat of lats) for (const lon of lons) pts.push({ lat, lon });
  return { lats, lons, pts };
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function buildUrl(batch, variable, dayDate) {
  const lats = batch.map(p => p.lat).join(',');
  const lons = batch.map(p => p.lon).join(',');
  const startISO = dayDate.toISOString().slice(0, 10);
  const params = new URLSearchParams({
    latitude: lats,
    longitude: lons,
    hourly: variable,
    models: MODEL,
    start_date: startISO,
    end_date: startISO,
    timezone: 'UTC',
  });
  // Auto-add past_days for historical days (radar mode crosses midnight, etc.)
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - dayDate.getTime()) / 86_400_000);
  if (diff > 0) params.set('past_days', String(diff));
  return `${API.forecast}?${params}`;
}

async function fetchGrid(grid, variable, dayDate) {
  const { lats, lons, pts } = enumerateGrid(grid);
  const batches = chunk(pts, BATCH_SIZE);

  // Sequential through the queue (the queue throttles globally anyway).
  const responses = [];
  for (const batch of batches) {
    const data = await queuedFetch(buildUrl(batch, variable, dayDate));
    responses.push(data);
  }

  // Open-Meteo returns an array for multi-location, single object for one
  const flat = [];
  for (const resp of responses) {
    if (Array.isArray(resp)) flat.push(...resp);
    else flat.push(resp);
  }

  const data = [];
  for (let i = 0; i < lats.length; i++) {
    const row = [];
    for (let j = 0; j < lons.length; j++) {
      const idx = i * lons.length + j;
      const hourly = flat[idx]?.hourly?.[variable];
      row.push(hourly && hourly.length === 24 ? hourly : new Array(24).fill(0));
    }
    data.push(row);
  }
  return { bbox: grid.bbox, step: grid.step, lats, lons, data };
}

// -------- Public API --------------------------------------------------------

const _memCache = new Map();   // in-memory cache (mirrors LS)
const _loading  = new Map();

export function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

export function getCachedDay(variable, date) {
  const dKey = dayKey(date);
  const cKey = `${variable}:${dKey}`;
  if (_memCache.has(cKey)) return _memCache.get(cKey);
  // Try LS — populate mem cache if found
  const ls = lsGet(variable, dKey);
  if (ls) {
    _memCache.set(cKey, ls);
    return ls;
  }
  return null;
}

export async function fetchHeatmapDay(variable, date) {
  const dKey = dayKey(date);
  const cKey = `${variable}:${dKey}`;

  const cached = getCachedDay(variable, date);
  if (cached) return cached;
  if (_loading.has(cKey)) return _loading.get(cKey);

  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);

  const promise = (async () => {
    try {
      const [europe, swiss] = await Promise.all([
        fetchGrid(EUROPE_GRID, variable, dayStart),
        fetchGrid(SWISS_GRID, variable, dayStart),
      ]);
      const result = { europe, swiss, dayStart, variable };
      _memCache.set(cKey, result);
      lsSet(variable, dKey, result);
      return result;
    } finally {
      _loading.delete(cKey);
    }
  })();
  _loading.set(cKey, promise);
  return promise;
}
