import { API } from './config.js';
import { getMap } from './map.js';
import { state } from './state.js';

let _radarFrames = [];
let _satFrames = [];
let _host = 'https://tilecache.rainviewer.com';
let _radarLayer = null;
let _cloudLayer = null;
let _currentRadarFrame = null;
let _currentCloudFrame = null;

export async function fetchIndex() {
  if (_radarFrames.length || _satFrames.length) return;
  try {
    const r = await fetch(API.rainviewer);
    const j = await r.json();
    _host = j.host || _host;
    const past = (j.radar?.past || []).map(f => ({...f, type: 'past'}));
    const fut = (j.radar?.nowcast || []).map(f => ({...f, type: 'nowcast'}));
    _radarFrames = [...past, ...fut].sort((a,b) => a.time - b.time);
    _satFrames = (j.satellite?.infrared || []).slice().sort((a,b) => a.time - b.time);
  } catch (e) {
    console.error('RainViewer index fetch failed:', e);
  }
}

function findFrame(frames, time, slack = 300) {
  if (!frames.length) return null;
  const target = time.getTime() / 1000;
  const minT = frames[0].time, maxT = frames[frames.length-1].time;
  if (target < minT - slack || target > maxT + slack) return null;
  let best = frames[0], diff = Math.abs(frames[0].time - target);
  for (const f of frames) {
    const d = Math.abs(f.time - target);
    if (d < diff) { diff = d; best = f; }
  }
  return best;
}

export const findRadarFrame = t => findFrame(_radarFrames, t, 300);
export const findCloudFrame = t => findFrame(_satFrames, t, 600);

export function setRadarFrame(frame) {
  const map = getMap();
  if (_radarLayer) { map.removeLayer(_radarLayer); _radarLayer = null; }
  if (!frame || !state.layers.radar) return;
  const url = `${_host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
  _radarLayer = L.tileLayer(url, { opacity: 0.65, tileSize: 256, zIndex: 350 }).addTo(map);
  _currentRadarFrame = frame;
}
export function setCloudFrame(frame) {
  const map = getMap();
  if (_cloudLayer) { map.removeLayer(_cloudLayer); _cloudLayer = null; }
  if (!frame || !state.layers.clouds) return;
  const url = `${_host}${frame.path}/256/{z}/{x}/{y}/0/0_0.png`;
  _cloudLayer = L.tileLayer(url, { opacity: 0.55, tileSize: 256, zIndex: 340 }).addTo(map);
  _currentCloudFrame = frame;
}

// Update both layers based on time. Returns true if a frame was set.
export function updateLayersForTime(time) {
  if (state.layers.radar) {
    const f = findRadarFrame(time);
    if (f !== _currentRadarFrame) setRadarFrame(f);
  } else if (_radarLayer) {
    getMap().removeLayer(_radarLayer); _radarLayer = null; _currentRadarFrame = null;
  }
  if (state.layers.clouds) {
    const f = findCloudFrame(time);
    if (f !== _currentCloudFrame) setCloudFrame(f);
  } else if (_cloudLayer) {
    getMap().removeLayer(_cloudLayer); _cloudLayer = null; _currentCloudFrame = null;
  }
}

export function clearLayers() {
  const map = getMap();
  if (_radarLayer) { map.removeLayer(_radarLayer); _radarLayer = null; }
  if (_cloudLayer) { map.removeLayer(_cloudLayer); _cloudLayer = null; }
  _currentRadarFrame = null;
  _currentCloudFrame = null;
}

export function hasFrames() {
  return _radarFrames.length > 0 || _satFrames.length > 0;
}
