// Atlas Météo — Heatmap rendering layer
// =============================================================================
// Custom L.GridLayer that renders Open-Meteo grid data as colored heatmap
// tiles. Holds multiple days of data simultaneously (so animation across day
// boundaries is seamless) and exposes setTime(date) for the orchestrator to
// drive the timeline.
//
// Render pipeline per tile:
//   1. Compute the tile's lat/lon bounds via Leaflet helpers
//   2. For each pixel of an internal 64×64 buffer:
//        - Convert pixel → lat/lon
//        - Try Switzerland grid (fine 0.2°), fall back to Europe grid (1°)
//        - Bilinear interp from the 4 surrounding grid corners
//        - Map value → RGBA via the variable's palette
//   3. Scale the 64×64 buffer to 256×256 with smoothing (looks like a soft
//      heatmap rather than blocky pixels)
//
// Why 64×64 internal? At full 256×256 we'd do 65k bilinear interps per tile.
// At 64×64 it's 4k, ~16× faster. The visual cost is some smoothness loss at
// strong gradients, but with `imageSmoothingQuality = 'high'` on upscale it
// stays clean enough for v0.
// =============================================================================

const TILE_RES = 64;
const TILE_OUT = 256;

// Smooth-blend width between the Swiss fine grid and the Europe coarse grid.
// At points within FEATHER_DEG (degrees) of the Swiss bbox edges, we linearly
// interpolate between the two grids' values. Hides the otherwise visible
// "fine-detail rectangle" of the Swiss zone.
const FEATHER_DEG = 0.4;

// -------- Color palettes ----------------------------------------------------

// Precipitation: mm/h → [r, g, b, a]. Stops match standard meteo gradients
// but tuned for visibility on the Atlas Météo dark palette.
const PRECIP_STOPS = [
  [0.10, 130, 190, 245,  60],   // 0.1 mm/h - barely visible mist
  [0.50,  90, 150, 235, 130],
  [1.00,  60, 120, 220, 175],
  [2.00,  40, 180, 200, 205],   // teal
  [5.00, 140, 220, 100, 220],   // green-yellow
  [10.0, 245, 185,  60, 230],   // orange
  [20.0, 230,  70,  60, 240],   // red
  [50.0, 195,  40, 160, 250],   // magenta (heavy storm)
];

function precipColor(mmh) {
  if (mmh < 0.1) return [0, 0, 0, 0];
  for (let i = 0; i < PRECIP_STOPS.length - 1; i++) {
    const s1 = PRECIP_STOPS[i], s2 = PRECIP_STOPS[i + 1];
    if (mmh >= s1[0] && mmh <= s2[0]) {
      const t = (mmh - s1[0]) / (s2[0] - s1[0]);
      return [
        Math.round(s1[1] + (s2[1] - s1[1]) * t),
        Math.round(s1[2] + (s2[2] - s1[2]) * t),
        Math.round(s1[3] + (s2[3] - s1[3]) * t),
        Math.round(s1[4] + (s2[4] - s1[4]) * t),
      ];
    }
  }
  return PRECIP_STOPS[PRECIP_STOPS.length - 1].slice(1);
}

// Cloud cover: % → [r, g, b, a]. Soft white-gray that "screens" nicely over
// the dark map. Below 15% = transparent (clear sky). Above 90% = saturated.
function cloudColor(pct) {
  if (pct < 15) return [0, 0, 0, 0];
  const norm = Math.min(1, (pct - 15) / 75);  // 15→0, 90→1
  const a = Math.round(60 + norm * 140);       // alpha 60..200
  return [240, 244, 250, a];
}

const PALETTES = {
  precipitation: precipColor,
  cloudcover: cloudColor,
};

// -------- Bilinear interpolation -------------------------------------------

function interpAt(grid, lat, lon, hourIdx) {
  if (!grid) return null;
  const { bbox, step, data } = grid;
  if (lat < bbox.latMin || lat > bbox.latMax ||
      lon < bbox.lonMin || lon > bbox.lonMax) return null;

  const fLat = (lat - bbox.latMin) / step;
  const fLon = (lon - bbox.lonMin) / step;
  const i0 = Math.floor(fLat);
  const j0 = Math.floor(fLon);
  const i1 = Math.min(i0 + 1, data.length - 1);
  const j1 = Math.min(j0 + 1, data[0].length - 1);
  const ti = fLat - i0;
  const tj = fLon - j0;

  const r0 = data[i0], r1 = data[i1];
  const v00 = r0?.[j0]?.[hourIdx] ?? 0;
  const v01 = r0?.[j1]?.[hourIdx] ?? 0;
  const v10 = r1?.[j0]?.[hourIdx] ?? 0;
  const v11 = r1?.[j1]?.[hourIdx] ?? 0;

  const va = v00 * (1 - tj) + v01 * tj;
  const vb = v10 * (1 - tj) + v11 * tj;
  return va * (1 - ti) + vb * ti;
}

// -------- HeatmapLayer ------------------------------------------------------

export const HeatmapLayer = L.GridLayer.extend({
  initialize: function (variable, options = {}) {
    L.GridLayer.prototype.initialize.call(this, options);
    this._variable = variable;
    this._palette = PALETTES[variable];
    this._days = new Map();        // dayKey ('YYYY-MM-DD') → { europe, swiss }
    this._currentTime = null;      // Date object, drives which hour is rendered
  },

  // Called by the orchestrator when fresh day-data is available.
  addDayData: function (dKey, dayData) {
    this._days.set(dKey, dayData);
    this.redraw();
  },

  // Called by the orchestrator on each scrubber tick.
  setTime: function (date) {
    if (this._currentTime &&
        this._currentTime.getTime() === date.getTime()) return;
    const sameHour = this._currentTime &&
      this._currentTime.getUTCFullYear() === date.getUTCFullYear() &&
      this._currentTime.getUTCMonth()    === date.getUTCMonth() &&
      this._currentTime.getUTCDate()     === date.getUTCDate() &&
      this._currentTime.getUTCHours()    === date.getUTCHours();
    this._currentTime = new Date(date);
    if (!sameHour) this.redraw();
  },

  // Tile factory called by Leaflet for each visible tile.
  createTile: function (coords, done) {
    const tile = document.createElement('canvas');
    tile.width = TILE_OUT;
    tile.height = TILE_OUT;
    this._renderInto(tile, coords);
    // Defer done() so Leaflet can wire up onload/onerror cleanly.
    setTimeout(() => done(null, tile), 0);
    return tile;
  },

  _renderInto: function (canvas, coords) {
    const ctx = canvas.getContext('2d');
    if (!this._currentTime) return;

    const dKey = this._currentTime.toISOString().slice(0, 10);
    const dayData = this._days.get(dKey);
    if (!dayData) return;  // data not yet loaded for this day → blank tile

    const hour = this._currentTime.getUTCHours();
    const tileBounds = this._tileCoordsToBounds(coords);
    const south = tileBounds.getSouth();
    const north = tileBounds.getNorth();
    const west  = tileBounds.getWest();
    const east  = tileBounds.getEast();

    // Render at low res into an offscreen buffer
    const buf = document.createElement('canvas');
    buf.width = TILE_RES;
    buf.height = TILE_RES;
    const bctx = buf.getContext('2d');
    const img = bctx.createImageData(TILE_RES, TILE_RES);
    const px = img.data;

    for (let py = 0; py < TILE_RES; py++) {
      // Web Mercator y is non-linear in lat, but per-tile range is small
      // enough that linear interp is fine at this resolution.
      const lat = north - (py / (TILE_RES - 1)) * (north - south);
      for (let pxIdx = 0; pxIdx < TILE_RES; pxIdx++) {
        const lon = west + (pxIdx / (TILE_RES - 1)) * (east - west);

        // Sample both grids and feather Swiss into Europe near the bbox
        // edges so the resolution change isn't visible as a hard rectangle.
        // - Inside the Swiss bbox, deep inside (>FEATHER from edges): pure Swiss
        // - Inside but within FEATHER of an edge: linearly blended
        // - At the edge or outside: pure Europe
        const swissV  = interpAt(dayData.swiss,  lat, lon, hour);
        const europeV = interpAt(dayData.europe, lat, lon, hour);

        let v;
        if (swissV === null && europeV === null) {
          continue;
        } else if (swissV === null) {
          v = europeV;
        } else if (europeV === null) {
          v = swissV;
        } else {
          const sb = dayData.swiss.bbox;
          const dEdge = Math.min(
            lat - sb.latMin, sb.latMax - lat,
            lon - sb.lonMin, sb.lonMax - lon
          );
          const wSwiss = Math.max(0, Math.min(1, dEdge / FEATHER_DEG));
          v = wSwiss * swissV + (1 - wSwiss) * europeV;
        }

        const [r, g, b, a] = this._palette(v);
        if (a === 0) continue;
        const o = (py * TILE_RES + pxIdx) * 4;
        px[o]     = r;
        px[o + 1] = g;
        px[o + 2] = b;
        px[o + 3] = a;
      }
    }

    bctx.putImageData(img, 0, 0);

    // Upscale to final tile resolution with smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, TILE_OUT, TILE_OUT);
    ctx.drawImage(buf, 0, 0, TILE_OUT, TILE_OUT);
  },
});
