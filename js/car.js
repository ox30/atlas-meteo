import { CAR_SVG } from './config.js';
import { getMap, clearLayer } from './map.js';
import { pointAtProgress } from './routing.js';
import { bearingDeg } from './utils.js';

let _carMarker = null;
let _carEl = null;

export function placeCar(coords, cumDist) {
  const map = getMap();
  clearLayer(_carMarker);
  // Initial position: start of route
  const start = coords[0];
  const next = coords[Math.min(1, coords.length - 1)];
  const initialBearing = bearingDeg(start, next);
  const icon = L.divIcon({
    className: 'car-marker',
    html: `<div class="car-rotate" id="car-rotate" style="transform: rotate(${initialBearing}deg)">${CAR_SVG}</div>`,
    iconSize: [36, 54],
    iconAnchor: [18, 27]
  });
  _carMarker = L.marker([start[1], start[0]], { icon, zIndexOffset: 1000 }).addTo(map);
  _carEl = document.getElementById('car-rotate');
}

// Direct position setter (used by route-mode for segment-aware positioning)
export function setCarPosition(lat, lon, bearing) {
  if (!_carMarker) return;
  _carMarker.setLatLng([lat, lon]);
  if (_carEl) _carEl.style.transform = `rotate(${bearing}deg)`;
}

// Legacy: progress-based update (kept for compatibility)
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
  _carEl = null;
}
