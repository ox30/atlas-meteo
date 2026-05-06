// Formatting helpers
export const fmtTemp = t => t == null ? '—' : Math.round(t) + '°';
export const fmtKm = m => (m/1000).toFixed(0) + ' km';
export const fmtDur = s => {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  return h ? `${h}h${m.toString().padStart(2,'0')}` : `${m}min`;
};
export const fmtDate = d => {
  const days = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  return `${days[d.getDay()]} ${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}`;
};
export const fmtTime = d => `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;

// Wind/azimuth degree → 16-cardinal compass label (N, NNE, NE, …). Used for
// wind direction in the meteo card and for sun/moon direction in astro-ui.
const COMPASS_16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
export function formatCompass(deg) {
  if (deg == null || !Number.isFinite(deg)) return '—';
  return COMPASS_16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// Debounce
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Toast notification
export function toast(msg) {
  const e = document.createElement('div');
  e.className = 'toast';
  e.textContent = msg;
  document.body.appendChild(e);
  setTimeout(() => e.remove(), 4000);
}

// Geo helpers
export function haversine(a, b) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]), lat2 = toRad(b[1]);
  const x = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function bearingDeg(p1, p2) {
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  const phi1 = toRad(p1[1]), phi2 = toRad(p2[1]);
  const dLambda = toRad(p2[0] - p1[0]);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1)*Math.sin(phi2) - Math.sin(phi1)*Math.cos(phi2)*Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Color helpers
export function hexToRgb(hex) {
  const m = hex.replace('#','');
  return { r: parseInt(m.substr(0,2),16), g: parseInt(m.substr(2,2),16), b: parseInt(m.substr(4,2),16) };
}
export function rgbToHex({r,g,b}) {
  const h = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2,'0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
export function lerp(a, b, t) { return a + (b - a) * t; }
export function lerpColor(c1, c2, t) {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  return rgbToHex({ r: lerp(a.r,b.r,t), g: lerp(a.g,b.g,t), b: lerp(a.b,b.b,t) });
}

// Robust JSON fetch — handles empty bodies, non-JSON errors, network issues
export async function safeFetchJson(url, options = {}) {
  let r;
  try {
    r = await fetch(url, options);
  } catch (e) {
    throw new Error(`Réseau indisponible (${e.message || 'fetch failed'})`);
  }
  let text;
  try { text = await r.text(); }
  catch (e) { throw new Error('Lecture de la réponse impossible'); }
  if (!r.ok) {
    // Try to extract a structured error
    try {
      const j = JSON.parse(text);
      throw new Error(j.reason || j.error || j.message || `HTTP ${r.status}`);
    } catch {
      throw new Error(text ? text.slice(0, 120) : `HTTP ${r.status} sans message`);
    }
  }
  if (!text || text.trim() === '') {
    throw new Error('Réponse vide du serveur (réessayer dans quelques secondes)');
  }
  try { return JSON.parse(text); }
  catch (e) {
    throw new Error('Réponse non-JSON : ' + text.slice(0, 100));
  }
}
