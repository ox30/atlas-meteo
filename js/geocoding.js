import { API } from './config.js';
import { debounce } from './utils.js';

// Search city by name
export async function geocode(query) {
  if (!query || query.length < 2) return [];
  try {
    const r = await fetch(`${API.geocoding}?name=${encodeURIComponent(query)}&count=6&language=fr&format=json`);
    return ((await r.json()).results || []);
  } catch (e) { return []; }
}

// Reverse geocode for stop names (Nominatim)
export async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`${API.reverseGeo}?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=fr`, {
      headers: { 'Accept': 'application/json' }
    });
    const j = await r.json();
    return j.address?.city || j.address?.town || j.address?.village
        || j.address?.county || j.address?.state || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  } catch (e) {
    return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  }
}

// Setup autocomplete on an input
export function setupAutocomplete(inputId, suggestId, onPick) {
  const input = document.getElementById(inputId);
  const box = document.getElementById(suggestId);
  const handler = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { box.style.display = 'none'; return; }
    const results = await geocode(q);
    if (!results.length) { box.style.display = 'none'; return; }
    box.innerHTML = results.map((r, i) => `
      <div class="suggestion" data-idx="${i}">
        <div class="suggestion-name">${r.name}${r.admin1 ? ', '+r.admin1 : ''}</div>
        <div class="suggestion-meta">${r.country || ''} · ${r.latitude.toFixed(2)}, ${r.longitude.toFixed(2)}</div>
      </div>
    `).join('');
    box.style.display = 'block';
    box.querySelectorAll('.suggestion').forEach((el, i) => {
      el.addEventListener('click', () => {
        const item = results[i];
        input.value = `${item.name}${item.country ? ', ' + item.country : ''}`;
        box.style.display = 'none';
        onPick(item);
      });
    });
  }, 280);
  input.addEventListener('input', handler);
  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !box.contains(e.target)) box.style.display = 'none';
  });
}
