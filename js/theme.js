import { PALETTES } from './config.js';
import { lerpColor, lerp } from './utils.js';
import { getSunAltitudeDeg, sunTint } from './astronomy.js';
import { state, on } from './state.js';

const ANCHORS = [
  { altMin: -90, altMax: -6, palette: PALETTES.night },
  { altMin: -6,  altMax: 6,  palette: PALETTES.twilight },
  { altMin: 6,   altMax: 30, palette: PALETTES.golden },
  { altMin: 30,  altMax: 90, palette: PALETTES.day }
];

function interpolatePalettes(p1, p2, t) {
  const out = {};
  for (const k of Object.keys(p1)) {
    if (k === 'map-brightness') {
      out[k] = lerp(parseFloat(p1[k]), parseFloat(p2[k]), t).toFixed(2);
    } else {
      out[k] = lerpColor(p1[k], p2[k], t);
    }
  }
  return out;
}

export function getCurrentPalette(altDeg) {
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const a = ANCHORS[i], b = ANCHORS[i+1];
    if (altDeg >= a.altMin && altDeg < b.altMax) {
      // interpolate between a and b around the boundary
      const span = b.altMax - a.altMin;
      const local = (altDeg - a.altMin) / span;
      return interpolatePalettes(a.palette, b.palette, Math.max(0, Math.min(1, local)));
    }
  }
  if (altDeg < -6) return PALETTES.night;
  return PALETTES.day;
}

export function applyPalette(p) {
  const root = document.documentElement;
  Object.entries(p).forEach(([k, v]) => root.style.setProperty(`--${k}`, v));
}

let _lastUpdate = 0;
export function updateTheme(time, lat, lon) {
  // Throttle to avoid useless work; transition CSS smooths anyway
  const now = performance.now();
  if (now - _lastUpdate < 300) return;
  _lastUpdate = now;
  const alt = getSunAltitudeDeg(time, lat, lon);
  if (state.layers.sun) {
    applyPalette(getCurrentPalette(alt));
    document.getElementById('sun-overlay').style.background = sunTint(alt);
  } else {
    applyPalette(PALETTES.night);
    document.getElementById('sun-overlay').style.background = 'transparent';
  }
}

export function resetTheme() {
  applyPalette(PALETTES.night);
  document.getElementById('sun-overlay').style.background = 'transparent';
}
