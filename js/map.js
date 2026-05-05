// Leaflet singleton

let _map = null;

export function getMap() {
  if (_map) return _map;
  _map = L.map('map', { zoomControl: true, attributionControl: true, preferCanvas: true })
    .setView([46.95, 8.0], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 18
  }).addTo(_map);
  return _map;
}

export function invalidateSizeSoon(delay = 80) {
  setTimeout(() => _map && _map.invalidateSize(), delay);
}

export function clearLayer(layer) {
  if (layer && _map) _map.removeLayer(layer);
}
