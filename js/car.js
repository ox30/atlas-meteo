import { CAR_SVG } from './config.js';
import { getMap, clearLayer } from './map.js';
import { pointAtProgress } from './routing.js';
import { bearingDeg } from './utils.js';

let _carMarker = null;
let _carEl = null;

export function placeCar(coords, cumDist) {
  const map = getMap();
  clearLayer(_carMarker);
  const start = pointAtProgress(coords, cumDist, 0);
  const next = pointAtProgress(coords, cumDist, Math.min(0.001, 1));
  const initialBearing = bearingDeg([start.lon, start.lat], [next.lon, next.lat]);
  const icon = L.divIcon({
    className: 'car-marker',
    html: `<div class="car-rotate" id="car-rotate" style="transform: rotate(${initialBearing}deg)">${CAR_SVG}</div>`,
    iconSize: [36, 54],
    iconAnchor: [18, 27]
  });
  _carMarker = L.marker([start.lat, start.lon], { icon, zIndexOffset: 1000 }).addTo(map);
  _carEl = document.getElementById('car-rotate');
}

export function updateCarPosition(coords, cumDist, progress) {
  if (!_carMarker) return null;
  const p = pointAtProgress(coords, cumDist, progress);
  // Compute bearing from current segment
  const i = p.segIdx;
  const j = Math.min(coords.length - 1, i + 1);
  const brg = bearingDeg(coords[i], coords[j]);
  _carMarker.setLatLng([p.lat, p.lon]);
  if (_carEl) _carEl.style.transform = `rotate(${brg}deg)`;
  return { lat: p.lat, lon: p.lon, bearing: brg };
}

export function clearCar() {
  clearLayer(_carMarker);
  _carMarker = null;
  _carEl = null;
}
