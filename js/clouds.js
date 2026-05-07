// Atlas Météo — Cloud cover layer
// =============================================================================
// Static cloud-cover overlay sourced from OpenWeatherMap's `clouds_new` tile
// layer, fronted by the atlas-meteo-tiles Cloudflare Worker so the OWM key
// stays server-side.
//
// Unlike the radar layer, this is *not* time-animated — OWM's free public tile
// product is a "current state" image refreshed every few hours. Scrubbing the
// timeline does NOT change what's shown here. If/when we add the Open-Meteo
// precipitation heatmap later, the cloud forecast can join the same model and
// gain timeline sync.
//
// Rendering: tiles live in a dedicated Leaflet pane with CSS
// `mix-blend-mode: screen` so the white tile pixels brighten through the dark
// (or warm) basemap regardless of whether we're over land or sea. This is the
// difference between "barely visible" and "obvious" on a dark UI palette.
// =============================================================================

import { getMap } from './map.js';
import { CLOUD_TILES_URL } from './config.js';
import { state } from './state.js';

const PANE_NAME = 'atlasClouds';
let _cloudLayer = null;

function ensurePane(map) {
  if (map.getPane(PANE_NAME)) return;
  const pane = map.createPane(PANE_NAME);
  // Layered just below the radar pane (radar tile layer uses zIndex 350)
  // so radar precipitation visibly overlays clouds when both are on.
  pane.style.zIndex = 340;
  // The magic — white pixels of the OWM cloud tile "screen" through the
  // basemap, dramatically improving visibility over both dark sea and lit
  // land. Transparent pixels stay transparent.
  pane.style.mixBlendMode = 'screen';
}

function buildLayer() {
  return L.tileLayer(CLOUD_TILES_URL, {
    pane: PANE_NAME,
    opacity: 0.7,
    tileSize: 256,
    maxNativeZoom: 9,        // OWM tiles serve up to ~z9 cleanly; beyond that we upscale
    crossOrigin: true,
    attribution: '&copy; <a href="https://openweathermap.org">OpenWeatherMap</a>',
  });
}

export function setCloudsEnabled(enabled) {
  const map = getMap();
  if (enabled) {
    ensurePane(map);
    if (!_cloudLayer) _cloudLayer = buildLayer();
    if (!map.hasLayer(_cloudLayer)) _cloudLayer.addTo(map);
  } else if (_cloudLayer && map.hasLayer(_cloudLayer)) {
    map.removeLayer(_cloudLayer);
  }
}

export function clearCloudLayer() {
  const map = getMap();
  if (_cloudLayer && map.hasLayer(_cloudLayer)) {
    map.removeLayer(_cloudLayer);
  }
}

// Apply the initial layer state on app boot.
export function initCloudsFromState() {
  setCloudsEnabled(!!state.layers.clouds);
}
