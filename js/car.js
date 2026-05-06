import { CAR_SVG } from './config.js';
import { getMap, clearLayer } from './map.js';
import { pointAtProgress } from './routing.js';
import { bearingDeg } from './utils.js';

let _carMarker = null;
let _lastBearing = 0;

function makeIcon(bearing) {
  return L.divIcon({
    className: 'car-marker',
    html: `<div style="width:36px;height:54px;transform:rotate(${bearing}deg);transform-origin:center">${CAR_SVG}</div>`,
    iconSize: [36, 54],
    iconAnchor: [18, 27]
  });
}

export function placeCar(coords, cumDist) {
  const map = getMap();
  clearLayer(_carMarker);
  const start = coords[0];
  const next = coords[Math.min(1, coords.length - 1)];
  _lastBearing = bearingDeg(start, next);
  _carMarker = L.marker([start[1], start[0]], { icon: makeIcon(_lastBearing), zIndexOffset: 1000 }).addTo(map);
  console.log('[car] placed at lat=%f lon=%f bearing=%f', start[1], start[0], _lastBearing);
}

export function setCarPosition(lat, lon, bearing) {
  if (!_carMarker) {
    console.warn('[car] setCarPosition called but marker is null!');
    return;
  }
  _carMarker.setLatLng([lat, lon]);
  // Use setIcon to update rotation — far more reliable than DOM manipulation.
  // Throttle to avoid recreating icon on every tick.
  if (Math.abs(bearing - _lastBearing) > 2) {
    _carMarker.setIcon(makeIcon(bearing));
    _lastBearing = bearing;
  }
}

// Legacy progress-based update (still used by some code paths)
export function updateCarPosition(coords, cumDist, progress) {
  if (!_carMarker) return null;
  const p = pointAtProgress(coords, cumDist, progress);
  const i = p.segIdx;
  const j = Math.min(coords.length - 1, i + 1);
  const brg = bearingDeg(coords[i], coords[j]);
  setCarPosition(p.lat, p.lon, brg);
  return { lat: p.lat, lon: p.lon, bearing: brg };
}

export function clearCar() {
  clearLayer(_carMarker);
  _carMarker = null;
  _lastBearing = 0;
}
