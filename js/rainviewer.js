// Atlas Météo — RainViewer radar layer
// =============================================================================
// Animated past-radar precipitation overlay from RainViewer's free public API.
//
// Reality of the free public API in 2026 (per official docs and the
// `rainviewer/rainviewer-api-example` repo):
//   - radar.past   : ~2 hours of past frames at 10-min steps
//   - radar.nowcast: NOT in the free public API anymore
//   - satellite    : NOT in the free public API anymore
//   - max zoom     : 7 (we declare maxNativeZoom on the Leaflet layer so tiles
//                       stay visible — blurry — at higher map zooms)
//
// Cloud cover is served by `js/clouds.js` (OpenWeatherMap via the Worker).
// =============================================================================

import { API } from './config.js';
import { getMap } from './map.js';
import { state } from './state.js';

let _radarFrames = [];
let _host = 'https://tilecache.rainviewer.com';
let _radarLayer = null;
let _currentRadarFrame = null;

export async function fetchIndex() {
  if (_radarFrames.length) return;
  try {
    const r = await fetch(API.rainviewer);
    const j = await r.json();
    _host = j.host || _host;
    const past = (j.radar?.past || []).map(f => ({ ...f, type: 'past' }));
    // We keep the nowcast read in case RainViewer ever brings it back to
    // the free tier — today it returns undefined and the array is empty.
    const fut = (j.radar?.nowcast || []).map(f => ({ ...f, type: 'nowcast' }));
    _radarFrames = [...past, ...fut].sort((a, b) => a.time - b.time);
  } catch (e) {
    console.error('RainViewer index fetch failed:', e);
  }
}

function findFrame(frames, time, slack = 300) {
  if (!frames.length) return null;
  const target = time.getTime() / 1000;
  const minT = frames[0].time, maxT = frames[frames.length - 1].time;
  if (target < minT - slack || target > maxT + slack) return null;
  let best = frames[0], diff = Math.abs(frames[0].time - target);
  for (const f of frames) {
    const d = Math.abs(f.time - target);
    if (d < diff) { diff = d; best = f; }
  }
  return best;
}

export const findRadarFrame = t => findFrame(_radarFrames, t, 300);

export function setRadarFrame(frame) {
  const map = getMap();
  if (_radarLayer) { map.removeLayer(_radarLayer); _radarLayer = null; }
  if (!frame || !state.layers.radar) return;
  const url = `${_host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
  _radarLayer = L.tileLayer(url, {
    opacity: 0.65,
    tileSize: 256,
    zIndex: 350,
    maxNativeZoom: 7,   // RainViewer free API caps at z7; upscale beyond that
    crossOrigin: true,
    attribution: '&copy; <a href="https://www.rainviewer.com">RainViewer</a>',
  }).addTo(map);
  _currentRadarFrame = frame;
}

// Update the radar layer based on the current scrubber time.
// (Cloud cover is handled separately in clouds.js.)
export function updateLayersForTime(time) {
  if (state.layers.radar) {
    const f = findRadarFrame(time);
    if (f !== _currentRadarFrame) setRadarFrame(f);
  } else if (_radarLayer) {
    getMap().removeLayer(_radarLayer);
    _radarLayer = null;
    _currentRadarFrame = null;
  }
}

export function clearLayers() {
  const map = getMap();
  if (_radarLayer) { map.removeLayer(_radarLayer); _radarLayer = null; }
  _currentRadarFrame = null;
}

export function hasFrames() {
  return _radarFrames.length > 0;
}
