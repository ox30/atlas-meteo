// Atlas Météo — Heatmap orchestrator
// =============================================================================
// Wires together the data layer (heatmap-data.js) and the render layer
// (heatmap-render.js), driven by the timeline scrubber.
//
// One HeatmapLayer instance per variable (precip_model, clouds_model). The
// layers are created lazily on first toggle-on and kept alive even when
// toggled off so cached day-data sticks around.
//
// Day-loading strategy:
//   • On layer activation: load the day containing the current scrubber time
//     (effectively "today" at first activation since the scrubber starts at
//     "now"), giving you the immediate +24h preload the user requested.
//   • On scrubber tick: if the current time crosses into a day that's not in
//     the layer's cache, kick off a fetch for that day. The layer keeps
//     showing the previous day until the new one arrives, then redraws.
//   • Past days (radar mode -2h) are handled the same way — heatmap-data
//     auto-adds past_days when needed.
// =============================================================================

import { state, on } from './state.js';
import { TimeCtl } from './time-ctl.js';
import { getMap } from './map.js';
import { fetchHeatmapDay, getCachedDay, dayKey } from './heatmap-data.js';
import { HeatmapLayer } from './heatmap-render.js';

// state.layers key → { apiName, paneName, paneZ }
const VARIABLES = {
  precip_model: {
    apiName:  'precipitation',
    paneName: 'atlasHeatmapPrecip',
    paneZ:    345,    // above OWM clouds (340), below RainViewer radar (350)
  },
  clouds_model: {
    apiName:  'cloudcover',
    paneName: 'atlasHeatmapClouds',
    paneZ:    338,    // just below the static OWM cloud layer
  },
};

const _layers = {};        // stateKey → HeatmapLayer
const _loadedDays = {};    // stateKey → Set<dayKey>

function ensurePane(name, zIndex) {
  const map = getMap();
  if (map.getPane(name)) return;
  const pane = map.createPane(name);
  pane.style.zIndex = String(zIndex);
}

function getOrCreateLayer(stateKey) {
  if (_layers[stateKey]) return _layers[stateKey];
  const v = VARIABLES[stateKey];
  ensurePane(v.paneName, v.paneZ);
  const layer = new HeatmapLayer(v.apiName, {
    pane:       v.paneName,
    opacity:    0.85,
    tileSize:   256,
    keepBuffer: 2,    // pre-render tiles just outside the viewport for smooth pan
  });
  _layers[stateKey] = layer;
  _loadedDays[stateKey] = new Set();
  return layer;
}

// Load day-data for `date` and push it into the layer when it arrives.
// Returns immediately; resolution is async.
function ensureDayLoaded(stateKey, date) {
  const layer = _layers[stateKey];
  if (!layer) return;
  const v = VARIABLES[stateKey];
  const dKey = dayKey(date);

  if (_loadedDays[stateKey].has(dKey)) return;       // already in layer
  const cached = getCachedDay(v.apiName, date);
  if (cached) {
    layer.addDayData(dKey, cached);
    _loadedDays[stateKey].add(dKey);
    return;
  }

  // Fire-and-forget fetch. When done, push to layer if still relevant.
  fetchHeatmapDay(v.apiName, date)
    .then(data => {
      if (!_layers[stateKey]) return;                // layer dropped while loading
      layer.addDayData(dKey, data);
      _loadedDays[stateKey].add(dKey);
    })
    .catch(err => {
      console.error(`Heatmap fetch failed (${v.apiName} ${dKey}):`, err);
    });
}

// -------- Public API --------------------------------------------------------

export function setHeatmapEnabled(stateKey, enabled) {
  if (!VARIABLES[stateKey]) return;
  const map = getMap();

  if (enabled) {
    const layer = getOrCreateLayer(stateKey);
    if (!map.hasLayer(layer)) layer.addTo(map);
    const t = TimeCtl.current || new Date();
    layer.setTime(t);
    ensureDayLoaded(stateKey, t);
  } else if (_layers[stateKey] && map.hasLayer(_layers[stateKey])) {
    map.removeLayer(_layers[stateKey]);
  }
}

export function initHeatmaps() {
  // Apply initial state (in case any heatmap layer is on by default)
  for (const k of Object.keys(VARIABLES)) {
    if (state.layers[k]) setHeatmapEnabled(k, true);
  }

  // Sync with timeline scrubber. On every tick we:
  //  1. Update the displayed hour for active heatmap layers
  //  2. Trigger a day-load if the scrubber crossed into an unloaded day
  on('tick', ({ time }) => {
    for (const k of Object.keys(VARIABLES)) {
      if (!state.layers[k] || !_layers[k]) continue;
      _layers[k].setTime(time);
      ensureDayLoaded(k, time);
    }
  });

  // React to legend toggles for our layers
  on('layerToggle', evt => {
    if (VARIABLES[evt.layer]) setHeatmapEnabled(evt.layer, evt.on);
  });
}
