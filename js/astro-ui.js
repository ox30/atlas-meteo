// Shared renderer for the .astro-box block. Used by both city-mode and
// route-mode so the two sidebars stay in lockstep — same data, same labels,
// same below-horizon handling. The route-only "soleil bas en face" warning
// piggybacks on the same call (passed via the optional `bearing` arg).
//
// Lookup is class-based, scoped to the container. That way both modes can
// have their own astro-box in the DOM (city-astro-box / route-astro-box)
// without ID collisions, and only the active mode's box ever gets queried.

import {
  getSunAltitudeDeg, getSunAzimuthDeg, getSunTimes,
  getMoonAltitudeDeg, getMoonAzimuthDeg, getMoonTimes, getMoonIllumination
} from './astronomy.js';
import { fmtTime, formatCompass } from './utils.js';

const PHASE_EPS = 0.03;  // tolerance window around the four cardinal phases

function safeTime(d) {
  return (!d || isNaN(d.getTime())) ? '—' : fmtTime(d);
}

function sunPhaseLabel(altDeg) {
  if (altDeg > 30) return 'Plein jour';
  if (altDeg > 6)  return 'Heure dorée';
  if (altDeg > 0)  return 'Soleil bas';
  if (altDeg > -6) return 'Crépuscule';
  if (altDeg > -12) return 'Nuit (aube/crép. nautique)';
  return 'Pleine nuit';
}

function moonPosLabel(altDeg) {
  if (altDeg > 30) return 'Haute';
  if (altDeg > 6)  return 'Visible';
  if (altDeg > 0)  return 'Basse';
  return 'Sous l\'horizon';
}

// SunCalc phase 0-1 → emoji + French label. The cardinal phases (new, first
// quarter, full, last quarter) have a small ε window so a "near-full" phase
// is reported as "Pleine lune" rather than "Gibbeuse" for one tick.
function moonPhaseInfo(phase01) {
  if (phase01 < PHASE_EPS || phase01 > 1 - PHASE_EPS) return { emoji: '🌑', label: 'Nouvelle lune' };
  if (Math.abs(phase01 - 0.25) < PHASE_EPS) return { emoji: '🌓', label: 'Premier quartier' };
  if (Math.abs(phase01 - 0.50) < PHASE_EPS) return { emoji: '🌕', label: 'Pleine lune' };
  if (Math.abs(phase01 - 0.75) < PHASE_EPS) return { emoji: '🌗', label: 'Dernier quartier' };
  if (phase01 < 0.25) return { emoji: '🌒', label: 'Premier croissant' };
  if (phase01 < 0.50) return { emoji: '🌔', label: 'Gibb. croissante' };
  if (phase01 < 0.75) return { emoji: '🌖', label: 'Gibb. décroissante' };
  return { emoji: '🌘', label: 'Dernier croissant' };
}

// Format SunCalc.getMoonTimes() into safe strings, handling the edge cases
// where the moon doesn't rise or set on this calendar day (poles, certain
// configurations) or stays above/below horizon for the whole day.
function formatMoonTimes(mt) {
  if (mt.alwaysUp)   return { rise: 'permanente', set: 'permanente' };
  if (mt.alwaysDown) return { rise: 'absente',    set: 'absente' };
  return { rise: safeTime(mt.rise), set: safeTime(mt.set) };
}

// Set both the displayed value and the below-horizon dim class in one shot.
// When the body is below the horizon, the direction value is meaningless to
// the user (you can't see it) so we show "—" with the dimmed style.
function setDirection(el, altDeg, azDeg) {
  if (!el) return;
  if (altDeg > 0) {
    el.textContent = `${formatCompass(azDeg)} · ${Math.round(azDeg)}°`;
    el.classList.remove('astro-below-horizon');
  } else {
    el.textContent = '—';
    el.classList.add('astro-below-horizon');
  }
}

/**
 * Populate an .astro-box's values from current time + position. Idempotent:
 * call from the per-tick render loop of any mode.
 *
 * @param {string} containerId - id of the .astro-box root (e.g. 'city-astro-box')
 * @param {Date}   time         - moment to compute for
 * @param {number} lat          - latitude in degrees
 * @param {number} lon          - longitude in degrees
 * @param {?number} bearing     - if set (route mode), enables the
 *                                "soleil en face" warning when the sun is
 *                                low and roughly aligned with travel direction
 */
export function updateAstroBox(containerId, time, lat, lon, bearing = null) {
  const root = document.getElementById(containerId);
  if (!root) return;
  const $ = sel => root.querySelector(sel);
  try {
    // --- Sun ----------------------------------------------------------------
    const sunTimes = getSunTimes(time, lat, lon);
    const sunAlt = getSunAltitudeDeg(time, lat, lon);
    const sunAz  = getSunAzimuthDeg(time, lat, lon);
    if ($('.astro-sun-rise')) $('.astro-sun-rise').textContent = safeTime(sunTimes.sunrise);
    if ($('.astro-sun-set'))  $('.astro-sun-set').textContent  = safeTime(sunTimes.sunset);
    if ($('.astro-sun-pos'))  $('.astro-sun-pos').textContent  = `${sunAlt > 0 ? '+' : ''}${sunAlt.toFixed(0)}° · ${sunPhaseLabel(sunAlt)}`;
    setDirection($('.astro-sun-dir'), sunAlt, sunAz);

    // --- Moon ---------------------------------------------------------------
    const moonTimes = formatMoonTimes(getMoonTimes(time, lat, lon));
    const moonAlt = getMoonAltitudeDeg(time, lat, lon);
    const moonAz  = getMoonAzimuthDeg(time, lat, lon);
    const illum = getMoonIllumination(time);
    const phase = moonPhaseInfo(illum.phase);
    if ($('.astro-moon-phase')) $('.astro-moon-phase').textContent = `${phase.emoji} ${phase.label}`;
    if ($('.astro-moon-illum')) $('.astro-moon-illum').textContent = `${Math.round(illum.fraction * 100)}%`;
    if ($('.astro-moon-rise'))  $('.astro-moon-rise').textContent  = moonTimes.rise;
    if ($('.astro-moon-set'))   $('.astro-moon-set').textContent   = moonTimes.set;
    if ($('.astro-moon-pos'))   $('.astro-moon-pos').textContent   = `${moonAlt > 0 ? '+' : ''}${moonAlt.toFixed(0)}° · ${moonPosLabel(moonAlt)}`;
    setDirection($('.astro-moon-dir'), moonAlt, moonAz);

    // --- Route-only warning -------------------------------------------------
    const warnEl = $('.astro-warning');
    if (warnEl) {
      let show = false;
      if (bearing != null && sunAlt > 0 && sunAlt < 8) {
        // `diff` is the absolute angular gap between vehicle heading and sun
        // azimuth. diff = 0  → sun directly in front (toward direction of
        // travel); diff = 180 → sun directly behind. The warning fires when
        // the sun is within a ±30° cone in front of the vehicle.
        //
        // (Earlier versions tested `(180 - diff) < 30`, which inverted the
        // semantics and fired when the sun was *behind* the car — bug
        // inherited from the original route-mode code, fixed in v1.3.)
        const diff = Math.abs(((bearing - sunAz + 540) % 360) - 180);
        if (diff < 30) {
          warnEl.textContent = `Soleil bas (${sunAlt.toFixed(0)}°) en face — visibilité réduite probable`;
          show = true;
        }
      }
      warnEl.style.display = show ? 'block' : 'none';
    }
  } catch (e) {
    // SunCalc occasionally throws near edge dates / extreme latitudes; we'd
    // rather show stale data than break the whole tick loop.
  }
}

// === Collapse / expand toggle =============================================
//
// Per-box state (keyed by container id) so each mode has its own collapse
// state and they don't interfere. Lives in module memory — survives
// re-renders within the session, resets on full page reload. That's fine
// for v1; if persistence across reloads becomes valuable, swap this Map for
// a localStorage-backed wrapper.

const _collapseState = new Map();

/**
 * Wire up the collapse / expand toggle button inside an astro-box. Idempotent
 * across re-renders: city-mode rebuilds the astro-box DOM in renderSidebarShell
 * and calls this each time, so we re-attach the listener and restore the
 * remembered state via the Map.
 */
export function setupAstroToggle(containerId) {
  const root = document.getElementById(containerId);
  if (!root) return;
  const btn = root.querySelector('.astro-toggle');
  if (!btn) return;
  const wasCollapsed = _collapseState.get(containerId) === true;
  root.classList.toggle('collapsed', wasCollapsed);
  btn.title = wasCollapsed ? 'Déplier' : 'Replier';
  // Idempotent: route-mode reuses the same static button across activate
  // cycles, and city-mode rebuilds it on every renderSidebarShell. Both
  // paths can call this freely.
  if (btn._astroToggleWired) return;
  btn._astroToggleWired = true;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const next = !root.classList.contains('collapsed');
    root.classList.toggle('collapsed', next);
    btn.title = next ? 'Déplier' : 'Replier';
    _collapseState.set(containerId, next);
  });
}
