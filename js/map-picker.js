import { getMap } from './map.js';
import { reverseGeocode } from './geocoding.js';
import { toast } from './utils.js';

let _activeRequest = null;  // { onPick: fn, sourceBtn: HTMLElement }

function endPicking() {
  if (!_activeRequest) return;
  _activeRequest.sourceBtn?.classList.remove('picking');
  document.getElementById('viewport').classList.remove('picking');
  document.getElementById('map-picker-msg').style.display = 'none';
  _activeRequest = null;
}

export function startPicking(label, onPick, sourceBtn) {
  if (_activeRequest) endPicking();
  _activeRequest = { onPick, sourceBtn };
  sourceBtn?.classList.add('picking');
  document.getElementById('viewport').classList.add('picking');
  const msg = document.getElementById('map-picker-msg');
  msg.textContent = label || 'Clique sur la carte pour placer le point';
  msg.style.display = 'block';
}

export function cancelPicking() { endPicking(); }

export function isPickingActive() { return !!_activeRequest; }

// Initialize the map click handler
export function initMapPicker() {
  const map = getMap();
  map.on('click', async e => {
    if (!_activeRequest) return;
    const { lat, lng } = e.latlng;
    const cb = _activeRequest.onPick;
    endPicking();
    // Resolve a name in background
    let name;
    try { name = await reverseGeocode(lat, lng); }
    catch (err) { name = `${lat.toFixed(3)}, ${lng.toFixed(3)}`; }
    cb({ name, latitude: lat, longitude: lng, country: '' });
  });
  // Allow ESC to cancel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _activeRequest) {
      endPicking();
      toast('Sélection annulée');
    }
  });
}
