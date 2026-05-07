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
// =============================================================================

import { getMap } from './map.js';
import { CLOUD_TILES_URL } from './config.js';
import { state } from './state.js';

let _cloudLayer = null;

function buildLayer() {
  return L.tileLayer(CLOUD_TILES_URL, {
    opacity: 0.55,
    tileSize: 256,
    zIndex: 340,
    maxNativeZoom: 9,        // OWM tiles serve up to ~z9 cleanly; beyond that we upscale
    crossOrigin: true,
    attribution: '&copy; <a href="https://openweathermap.org">OpenWeatherMap</a>',
  });
}

export function setCloudsEnabled(enabled) {
  const map = getMap();
  if (enabled) {
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
