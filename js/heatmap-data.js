// Atlas Météo — Open-Meteo heatmap data client
// =============================================================================
// Two-tier grid:
//   EUROPE_GRID    — coarse 1° (~110 km) covering Europe + UK
//   SWISS_GRID     — fine 0.2° (~20 km) covering Switzerland + 100 km buffer
//
// Both grids fetch from Open-Meteo using `models=best_match` so the API picks
// the best regional model automatically: ICON-CH1 (1 km native) inside the
// Swiss area, ECMWF/GFS over the rest of Europe.
//
// Cache: in-memory Map keyed by `${variable}:${dayKey}`. We never expire — the
// app reload clears it. For 14 days × 2 variables × ~2 MB per day = ~56 MB
// worst case (gzipped network is much smaller), which is fine for a tab.
// =============================================================================

import { API } from './config.js';

const EUROPE_GRID = {
  bbox: { latMin: 35, latMax: 70, lonMin: -12, lonMax: 32 },
  step: 1.0,
};

const SWISS_GRID = {
  bbox: { latMin: 45.0, latMax: 48.2, lonMin: 5.0, lonMax: 11.5 },
  step: 0.2,
};

const BATCH_SIZE = 200;     // points per Open-Meteo request (URL-length safe)
const MODEL = 'best_match'; // auto-selects ICON-CH1 for Switzerland

// -------- Grid enumeration --------------------------------------------------

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

// -------- Open-Meteo fetch --------------------------------------------------

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
  // past_days lets us request days up to ~92 days in the past on free tier;
  // only useful for radar-mode (-2h overlap with yesterday). Auto-add it
  // when the requested day is before today.
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - dayDate.getTime()) / 86400000);
  if (diffDays > 0) params.set('past_days', String(diffDays));
  return `${API.forecast}?${params}`;
}

async function fetchGrid(grid, variable, dayDate) {
  const { lats, lons, pts } = enumerateGrid(grid);
  const batches = chunk(pts, BATCH_SIZE);
  const responses = await Promise.all(
    batches.map(batch =>
      fetch(buildUrl(batch, variable, dayDate)).then(r => {
        if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
        return r.json();
      })
    )
  );

  // Open-Meteo returns an array when multiple locations are passed,
  // or a single object when only one location is passed. Normalize.
  const flat = [];
  for (const resp of responses) {
    if (Array.isArray(resp)) flat.push(...resp);
    else flat.push(resp);
  }

  // Build [latIdx][lonIdx] = number[24] (one value per hour of day, UTC)
  const data = [];
  for (let i = 0; i < lats.length; i++) {
    const row = [];
    for (let j = 0; j < lons.length; j++) {
      const idx = i * lons.length + j;
      const hourly = flat[idx]?.hourly?.[variable];
      // Defensive: if a point is missing, fill with zeros
      row.push(hourly && hourly.length === 24 ? hourly : new Array(24).fill(0));
    }
    data.push(row);
  }
  return { bbox: grid.bbox, step: grid.step, lats, lons, data };
}

// -------- Public cache + day fetch -----------------------------------------

const _cache = new Map();
const _loading = new Map();

export function dayKey(date) {
  // UTC day key. We pass UTC dates throughout this module so all timezones
  // hit the same cache entries.
  return date.toISOString().slice(0, 10);
}

export function getCachedDay(variable, date) {
  return _cache.get(`${variable}:${dayKey(date)}`) || null;
}

// Fetch (or return cached) one day's worth of data for both grids.
// Returns: { europe, swiss, dayStart, variable }
export async function fetchHeatmapDay(variable, date) {
  const dKey = dayKey(date);
  const cKey = `${variable}:${dKey}`;
  if (_cache.has(cKey)) return _cache.get(cKey);
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
      _cache.set(cKey, result);
      return result;
    } finally {
      _loading.delete(cKey);
    }
  })();
  _loading.set(cKey, promise);
  return promise;
}
