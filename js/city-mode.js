import { TimeCtl } from './time-ctl.js';
import { state, on } from './state.js';
import { fetchCityForecast, pickHour } from './weather.js';
import { fetchIndex, updateLayersForTime, clearLayers as clearRVLayers } from './rainviewer.js';
import { drawTerminator, clearTerminator } from './astronomy.js';
import { updateTheme, resetTheme } from './theme.js';
import { getMap, invalidateSizeSoon, clearLayer } from './map.js';
import { setupAutocomplete } from './geocoding.js';
import { startPicking } from './map-picker.js';
import { RANGE_MODES, wmo } from './config.js';
import { fmtTime, fmtDate, toast } from './utils.js';
import { clearScrubberContent, setWeatherProvider, clearWeatherProvider, setSummaryContent } from './scrubber.js';
import { renderChart } from './chart.js';
import { updateAstroBox } from './astro-ui.js';

let _cityMarker = null;
let _isActive = false;
let _lastSidebarHour = null;

// Day-frame v1: pin / hover / zoom state. _hoveredDay is what the user is
// currently hovering in the forecast grid; _pinnedDay is the day they clicked
// (sticky, with chip + "+" zoom button); _zoomedDay is set while the timeline
// is zoomed onto a 24h range. _isAnimatingZoom guards against re-entrant
// transitions while an enter/exit/crossfade animation is in flight.
let _hoveredDay = null;
let _pinnedDay = null;
let _zoomedDay = null;
let _isAnimatingZoom = false;

const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pad2 = n => String(n).padStart(2, '0');

function sameDay(a, b) {
  return !!(a && b
    && a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate());
}
function dayBounds(date) {
  const s = new Date(date); s.setHours(0, 0, 0, 0);
  const e = new Date(date); e.setHours(23, 59, 59, 999);
  return [s, e];
}
function formatDayChip(date) {
  return `${DAY_NAMES[date.getDay()]} ${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}`;
}
function formatWindDir(deg) {
  if (deg == null || !Number.isFinite(deg)) return '—';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

export function init() {
  setupAutocomplete('city-search', 'city-suggestions', city => {
    if (_isActive) loadCity(city);
  });
  document.getElementById('city-pin').addEventListener('click', e => {
    if (!_isActive) return;
    startPicking('Clique sur la carte pour choisir une localité', city => {
      document.getElementById('city-search').value = city.name;
      loadCity(city);
    }, e.currentTarget);
  });
  on('tick', onTick);
  on('modelChange', () => { if (_isActive && state.city) loadCity(state.city); });
  on('rangeChange', () => {
    if (!_isActive || !state.city) return;
    // External range change (radio in legend menu) while zoomed: cancel the
    // zoom without animation — the underlying bounds are about to flip and
    // animating against a moving target gets messy.
    if (_zoomedDay) {
      _zoomedDay = null;
      document.querySelectorAll('.tl-sun-mark').forEach(el => el.remove());
      applyDayNightGradient(null);
      const layer = document.getElementById('day-frame-layer');
      const f = layer && layer.querySelector('.day-frame.pin-frame');
      if (f) {
        f.classList.remove('zoomed', 'loading');
        const btn = f.querySelector('.day-frame-zoom-btn');
        if (btn) btn.title = 'Voir le détail du jour';
      }
    }
    setupRange();
    _lastSidebarHour = null;       // force re-render of sidebar
    renderSidebarShell();
    renderDayFrames();
  });
  on('chartChange', () => { if (_isActive) renderChart(); });
  on('layerToggle', ({ layer }) => {
    if (!_isActive) return;
    if (layer === 'terminator') {
      if (state.layers.terminator) drawTerminator(TimeCtl.current || new Date());
      else clearTerminator();
    } else if (layer === 'sun') {
      updateTheme(TimeCtl.current || new Date(), state.city?.latitude || 0, state.city?.longitude || 0);
    }
  });
}

export function activate() {
  _isActive = true;
  // Belt-and-braces: clear any route-mode artifacts left on the timeline
  // (influence bands, stop marks, pause zones). clearScrubberContent in
  // RouteMode.deactivate() should already have done this, but a stray late
  // render can sneak in — be defensive.
  document.querySelectorAll('.timeline-bar .tl-influence-band, .timeline-bar .tl-stop-mark, .timeline-bar .tl-sun-mark, .timeline-bar .tl-pause-zone, .timeline-bar .tl-pause-icon').forEach(el => el.remove());
  setWeatherProvider(time => {
    if (!state.cityHourly) return null;
    const w = pickHour(state.cityHourly, time);
    return { temp: w.temp, code: w.code };
  });
  // External load (e.g. coming from "Détails →" on a route stop) will be
  // handled by loadCityFromExternal — skip our default reload to avoid races.
  if (state.pendingExternalCityLoad) {
    state.pendingExternalCityLoad = false;
    return;
  }
  if (state.city) loadCity(state.city);
  else document.getElementById('empty-state').style.display = 'flex';
}

export function deactivate() {
  _isActive = false;
  TimeCtl.pause();
  clearLayer(_cityMarker); _cityMarker = null;
  clearRVLayers();
  clearTerminator();
  resetTheme();
  clearWeatherProvider();
  clearScrubberContent();
  // Day-frame teardown
  _hoveredDay = null;
  _pinnedDay = null;
  _zoomedDay = null;
  _isAnimatingZoom = false;
  document.querySelectorAll('.tl-sun-mark').forEach(el => el.remove());
  applyDayNightGradient(null);
  const layer = document.getElementById('day-frame-layer');
  if (layer) layer.innerHTML = '';
  document.getElementById('viewport').classList.remove('viewport-mode-city-anim');
  document.getElementById('viewport').classList.remove('with-chart');
  document.getElementById('chart-box').innerHTML = '';
}

async function loadCity(city, seekTime = null) {
  state.city = city;
  document.getElementById('empty-state').style.display = 'none';
  // City changes invalidate any pinned/zoomed day from the previous city
  _hoveredDay = null;
  _pinnedDay = null;
  _zoomedDay = null;
  _isAnimatingZoom = false;
  document.querySelectorAll('.tl-sun-mark').forEach(el => el.remove());
  applyDayNightGradient(null);
  const map = getMap();
  invalidateSizeSoon();
  map.setView([city.latitude, city.longitude], 9);
  clearLayer(_cityMarker);
  _cityMarker = L.marker([city.latitude, city.longitude]).addTo(map);
  // Reflect the searched location in the input field
  const searchInput = document.getElementById('city-search');
  if (searchInput) searchInput.value = city.name + (city.country ? ', ' + city.country : '');
  try {
    const data = await fetchCityForecast(city, state.currentModel, 14, 1);
    state.cityHourly = data.hourly;
    state.cityDaily = data.daily;
    setupRange();
    document.getElementById('viewport').classList.add('viewport-mode-city-anim');
    invalidateSizeSoon(150);
    fetchIndex();
    // If a seek time was requested (e.g. from "Détails →" on a route stop),
    // pause the scrubber and jump to that moment. If beyond range, switch to
    // the extended (14-day) range.
    if (seekTime instanceof Date && !isNaN(seekTime.getTime())) {
      seekToTime(seekTime);
    }
    renderDayFrames();
  } catch (e) {
    toast('Erreur météo : ' + e.message);
  }
}

// Public entry point used by app.js when switching from route mode via "Détails →"
export async function loadCityFromExternal(city, seekTime) {
  return loadCity(city, seekTime);
}

// Seek the city scrubber to the given time, expanding range mode if needed
function seekToTime(target) {
  const now = new Date();
  const daysAhead = (target.getTime() - now.getTime()) / (24 * 3600 * 1000);
  if (daysAhead > 7 && state.rangeMode !== 'extended') {
    state.rangeMode = 'extended';
    setupRange();
    import('./legend.js').then(m => m.buildLegend());
  } else if (daysAhead > 0.1 && state.rangeMode === 'radar') {
    state.rangeMode = 'week';
    setupRange();
    import('./legend.js').then(m => m.buildLegend());
  }
  TimeCtl.pause();
  TimeCtl.setTime(target.getTime());
}

function setupRange() {
  const r = RANGE_MODES[state.rangeMode];
  const now = new Date();
  const start = new Date(now.getTime() - r.hoursBefore * 3600 * 1000);
  const end = new Date(now.getTime() + r.hoursAfter * 3600 * 1000);
  TimeCtl.init(start, end);
  TimeCtl.setTime(now.getTime());
}

function onTick({ time, progress }) {
  if (!_isActive || !state.city) return;
  if (state.cityHourly) {
    const hourKey = Math.floor(time.getTime() / 3600000);
    if (hourKey !== _lastSidebarHour) {
      _lastSidebarHour = hourKey;
      renderSidebarShell(time);
    } else {
      // Refresh just the "current" card values without rebuilding the grid
      updateCurrentCard(time);
      updateNowHighlight(time);
    }
  }
  updateLayersForTime(time);
  if (state.layers.terminator) drawTerminator(time);
  else clearTerminator();
  updateTheme(time, state.city.latitude, state.city.longitude);
  document.getElementById('clock-time').textContent = fmtTime(time);
  document.getElementById('clock-meta').textContent = fmtDate(time);
  document.getElementById('timeline-fill').style.width = `${progress*100}%`;
  // The weather pill in the scrubber summary stays live in all modes — even
  // while zoomed, it now reflects the weather at the cursor's hour, which is
  // exactly what the user wants when scrubbing through a single day.
  if (state.cityHourly) {
    const w = pickHour(state.cityHourly, time);
    const cond = wmo(w.code);
    setSummaryContent(`<strong>${cond.icon} ${cond.label}</strong>`);
  }
  // Astro box: refresh on every tick (altitude / azimuth / phase change
  // continuously as the cursor moves; rise/set times can flip when the
  // cursor crosses local midnight in week/extended modes).
  if (state.city) {
    updateAstroBox('city-astro-box', time, state.city.latitude, state.city.longitude);
  }
}

// Build the full sidebar (current card + range buttons + grid)
function renderSidebarShell(time) {
  if (!time) time = TimeCtl.current || new Date();
  const r = RANGE_MODES[state.rangeMode];
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < state.cityDaily.time.length; i++) {
    const d = new Date(state.cityDaily.time[i]);
    if (d >= today0) days.push({ idx: i, date: d });
    if (days.length >= r.daysShown) break;
  }
  const titleN = r.daysShown;
  const html = `
    <div id="cur-card-host"></div>
    <div class="astro-box visible" id="city-astro-box">
      <div class="section-label" style="margin-bottom: 8px">Astronomie</div>
      <div class="astro-section">
        <div class="astro-row"><span class="lbl">Lever soleil</span><span class="val astro-sun-rise">—</span></div>
        <div class="astro-row"><span class="lbl">Coucher soleil</span><span class="val astro-sun-set">—</span></div>
        <div class="astro-row"><span class="lbl">Position soleil</span><span class="val astro-sun-pos">—</span></div>
        <div class="astro-row"><span class="lbl">Direction soleil</span><span class="val astro-sun-dir">—</span></div>
      </div>
      <div class="astro-section astro-moon-section">
        <div class="astro-row"><span class="lbl">Phase</span><span class="val astro-moon-phase">—</span></div>
        <div class="astro-row"><span class="lbl">Illumination</span><span class="val astro-moon-illum">—</span></div>
        <div class="astro-row"><span class="lbl">Lever lune</span><span class="val astro-moon-rise">—</span></div>
        <div class="astro-row"><span class="lbl">Coucher lune</span><span class="val astro-moon-set">—</span></div>
        <div class="astro-row"><span class="lbl">Position lune</span><span class="val astro-moon-pos">—</span></div>
        <div class="astro-row"><span class="lbl">Direction lune</span><span class="val astro-moon-dir">—</span></div>
      </div>
    </div>
    <div class="range-quick-row">
      <button class="range-quick${state.rangeMode === 'week' ? ' active' : ''}" data-quick="week">7 prochains jours</button>
      <button class="range-quick${state.rangeMode === 'extended' ? ' active' : ''}" data-quick="extended">14 prochains jours</button>
    </div>
    <div class="section-label">Prévision ${titleN} jours</div>
    <div class="forecast-grid${r.daysShown > 7 ? ' wrap' : ''}" id="forecast-grid"></div>
  `;
  document.getElementById('city-data').innerHTML = html;
  // Quick buttons → switch range mode
  document.querySelectorAll('[data-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.quick;
      if (target === state.rangeMode) return;
      state.rangeMode = target;
      setupRange();
      // Rebuild legend so that the radio in menu + reflects the change
      import('./legend.js').then(m => m.buildLegend());
      _lastSidebarHour = null;
      renderSidebarShell();
    });
  });
  renderForecastGrid(days, time);
  updateCurrentCard(time);
  // Populate the freshly-rebuilt astro-box right away — the next onTick is
  // close, but we don't want '—' flashing until then.
  if (state.city) {
    updateAstroBox('city-astro-box', time, state.city.latitude, state.city.longitude);
  }
}

// Just refresh the current card values without rebuilding the rest
function updateCurrentCard(time) {
  const w = pickHour(state.cityHourly, time);
  const cond = wmo(w.code);
  const c = state.city;
  const host = document.getElementById('cur-card-host');
  if (!host) return;
  // Six metas, always — the user wants a stable card across modes (zoom or
  // not). Sunrise / sunset moved out to the astro-box where they belong.
  host.innerHTML = `
    <div class="current-card">
      <div class="current-loc">${c.name}${c.country?', '+c.country:''}</div>
      <div class="current-coords">${c.latitude.toFixed(3)}°N · ${c.longitude.toFixed(3)}°E · ${fmtTime(time)} ${fmtDate(time)}</div>
      <div class="current-row">
        <div class="current-temp">${Math.round(w.temp)}<span class="unit">°C</span></div>
        <div style="text-align:right">
          <div class="current-icon">${cond.icon}</div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:4px">${cond.label}</div>
        </div>
      </div>
      <div class="current-meta">
        <div class="meta-item"><span class="meta-label">Ressenti</span><span class="meta-value">${Math.round(w.apparent ?? w.temp)}°C</span></div>
        <div class="meta-item"><span class="meta-label">Humidité</span><span class="meta-value">${w.humidity ?? '—'}%</span></div>
        <div class="meta-item"><span class="meta-label">Vent</span><span class="meta-value">${Math.round(w.wind)} km/h</span></div>
        <div class="meta-item"><span class="meta-label">Direction</span><span class="meta-value">${formatWindDir(w.windDir)}</span></div>
        <div class="meta-item"><span class="meta-label">Pression</span><span class="meta-value">${w.pressure ? Math.round(w.pressure) : '—'} hPa</span></div>
        <div class="meta-item"><span class="meta-label">Nuages</span><span class="meta-value">${w.cloudCover != null ? w.cloudCover + '%' : '—'}</span></div>
      </div>
    </div>`;
}

function renderForecastGrid(days, time) {
  const grid = document.getElementById('forecast-grid');
  if (!grid) return;
  const currentDayKey = (() => { const d = new Date(time); d.setHours(0,0,0,0); return d.getTime(); })();
  let html = '';
  for (const day of days) {
    const dc = wmo(state.cityDaily.weather_code[day.idx]);
    const dKey = new Date(day.date); dKey.setHours(0,0,0,0);
    const isCurrent = dKey.getTime() === currentDayKey;
    html += `<div class="forecast-day${isCurrent ? ' now' : ''}" title="${dc.label}" data-day-iso="${day.date.toISOString()}">
      <div class="fday-name">${DAY_NAMES[day.date.getDay()]}</div>
      <div class="fday-date">${pad2(day.date.getDate())}.${pad2(day.date.getMonth()+1)}</div>
      <div class="fday-icon">${dc.icon}</div>
      <div class="fday-temps"><span class="fday-tmax">${Math.round(state.cityDaily.temperature_2m_max[day.idx])}°</span><span class="fday-tmin">${Math.round(state.cityDaily.temperature_2m_min[day.idx])}°</span></div>
    </div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.forecast-day[data-day-iso]').forEach(el => {
    el.addEventListener('click', () => handleDayClick(new Date(el.dataset.dayIso)));
    el.addEventListener('mouseenter', () => onDayHoverEnter(new Date(el.dataset.dayIso)));
    el.addEventListener('mouseleave', onDayHoverLeave);
  });
  // Sync the frame layer once the grid is in the DOM (positions depend on
  // the timeline-bar's bounding rect being measurable).
  renderDayFrames();
}

// Just refresh which day is highlighted without rebuilding
function updateNowHighlight(time) {
  const grid = document.getElementById('forecast-grid');
  if (!grid) return;
  const currentDayKey = (() => { const d = new Date(time); d.setHours(0,0,0,0); return d.getTime(); })();
  grid.querySelectorAll('.forecast-day[data-day-iso]').forEach(el => {
    const d = new Date(el.dataset.dayIso); d.setHours(0,0,0,0);
    el.classList.toggle('now', d.getTime() === currentDayKey);
  });
}

// === Day-frame v1: hover, pin, zoom ========================================

function onDayHoverEnter(date) {
  if (_isAnimatingZoom) return;
  _hoveredDay = date;
  renderHoverFrame();
}
function onDayHoverLeave() {
  if (_isAnimatingZoom) return;
  _hoveredDay = null;
  renderHoverFrame();
}

function handleDayClick(targetDate) {
  if (_isAnimatingZoom) return;
  // Already zoomed: clicking another day cross-fades the zoom to that day.
  // Clicking the same day is a no-op (consistent: nothing to do).
  if (_zoomedDay) {
    if (sameDay(targetDate, _zoomedDay)) return;
    crossfadeZoomToDay(targetDate);
    return;
  }
  // Not zoomed. If clicking the already-pinned day → unpin (toggle).
  if (_pinnedDay && sameDay(targetDate, _pinnedDay)) {
    _pinnedDay = null;
    renderDayFrames();
    return;
  }
  // Otherwise pin the new day, and as before move TimeCtl to noon of that day.
  // The range-switch logic mirrors the original handleDayClick behaviour.
  _pinnedDay = new Date(targetDate);
  const seek = new Date(targetDate); seek.setHours(12, 0, 0, 0);
  const now = new Date();
  const daysAhead = (seek.getTime() - now.getTime()) / (24 * 3600 * 1000);
  if (daysAhead > 7) {
    if (state.rangeMode !== 'extended') {
      state.rangeMode = 'extended';
      setupRange();
      import('./legend.js').then(m => m.buildLegend());
      _lastSidebarHour = null;
      renderSidebarShell();
    }
  } else if (daysAhead > 0.1 && state.rangeMode === 'radar') {
    state.rangeMode = 'week';
    setupRange();
    import('./legend.js').then(m => m.buildLegend());
    _lastSidebarHour = null;
    renderSidebarShell();
  }
  TimeCtl.pause();
  TimeCtl.setTime(seek.getTime());
  renderDayFrames();
}

// Compute [leftPercent, rightPercent] of a day on the current timeline, or
// null if the day falls fully outside the visible range (e.g. a future day in
// radar mode whose 0h-24h window doesn't overlap the [start, end] interval).
function dayPositionPct(date) {
  if (!TimeCtl.isInitialized()) return null;
  const [s, e] = dayBounds(date);
  const span = TimeCtl.end.getTime() - TimeCtl.start.getTime();
  if (span <= 0) return null;
  const left  = ((s.getTime() - TimeCtl.start.getTime()) / span) * 100;
  const right = ((e.getTime() - TimeCtl.start.getTime()) / span) * 100;
  const cl = Math.max(0, Math.min(100, left));
  const cr = Math.max(0, Math.min(100, right));
  if (cl >= 100 || cr <= 0 || cr - cl < 0.5) return null;
  return [cl, cr];
}

// Make sure we have a positioned wrapper (#timeline-zone) around the
// timeline-bar + chart-box so the absolute-positioned frame layer can span
// both. Wrap once, lazily, on first access. Re-using the same wrapper across
// modes is safe — route mode never queries it directly.
function ensureFrameLayer() {
  let layer = document.getElementById('day-frame-layer');
  if (layer) return layer;
  const scrubber = document.getElementById('scrubber');
  const timelineBar = document.getElementById('timeline-bar');
  const chartBox = document.getElementById('chart-box');
  if (!scrubber || !timelineBar || !chartBox) return null;
  let zone = document.getElementById('timeline-zone');
  if (!zone) {
    zone = document.createElement('div');
    zone.id = 'timeline-zone';
    zone.className = 'timeline-zone';
    scrubber.insertBefore(zone, timelineBar);
    zone.appendChild(timelineBar);
    zone.appendChild(chartBox);
  }
  layer = document.createElement('div');
  layer.id = 'day-frame-layer';
  layer.className = 'day-frame-layer';
  zone.appendChild(layer);
  return layer;
}

function renderDayFrames() {
  renderHoverFrame();
  renderPinFrame();
}

function renderHoverFrame() {
  const layer = ensureFrameLayer();
  if (!layer) return;
  let f = layer.querySelector('.day-frame.hover-frame');
  // Hover frame is hidden when: zoomed, no hover, or hover == pin (the pin
  // frame already covers that day with a richer style).
  const shouldShow = !_zoomedDay && _hoveredDay && !(_pinnedDay && sameDay(_hoveredDay, _pinnedDay));
  if (!shouldShow) {
    if (f) f.remove();
    return;
  }
  const pos = dayPositionPct(_hoveredDay);
  if (!pos) {
    if (f) f.remove();
    return;
  }
  if (!f) {
    f = document.createElement('div');
    f.className = 'day-frame hover-frame';
    layer.appendChild(f);
  }
  f.style.left = `${pos[0]}%`;
  f.style.right = `${100 - pos[1]}%`;
}

function renderPinFrame() {
  const layer = ensureFrameLayer();
  if (!layer) return;
  let f = layer.querySelector('.day-frame.pin-frame');
  // While zoomed, the pin frame is morphed into the zoomed border; don't
  // touch it here (enterZoom / exitZoom / crossfade own the lifecycle).
  if (_zoomedDay) return;
  if (!_pinnedDay) {
    if (f) f.remove();
    return;
  }
  const pos = dayPositionPct(_pinnedDay);
  if (!pos) {
    // Pinned day fell out of range (e.g. range switched). Drop the pin
    // silently — it'd be confusing to keep an invisible reference.
    _pinnedDay = null;
    if (f) f.remove();
    return;
  }
  if (!f) {
    f = document.createElement('div');
    f.className = 'day-frame pin-frame';
    f.innerHTML = `
      <div class="day-frame-chip">
        <span class="day-frame-chip-label"></span>
        <button type="button" class="day-frame-chip-x" title="Désépingler">✕</button>
      </div>
      <button type="button" class="day-frame-zoom-btn" title="Voir le détail du jour"></button>
    `;
    f.querySelector('.day-frame-chip-x').addEventListener('click', e => {
      e.stopPropagation();
      if (_isAnimatingZoom) return;
      _pinnedDay = null;
      renderDayFrames();
    });
    // Toggle button: same physical location, dispatches enter or exit based
    // on current zoom state. The CSS swaps the +/− glyph automatically.
    f.querySelector('.day-frame-zoom-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (_isAnimatingZoom) return;
      if (_zoomedDay) exitZoom();
      else if (_pinnedDay) enterZoom(_pinnedDay);
    });
    layer.appendChild(f);
  }
  f.querySelector('.day-frame-chip-label').textContent = formatDayChip(_pinnedDay);
  f.style.left = `${pos[0]}%`;
  f.style.right = `${100 - pos[1]}%`;
}

// Render sunrise/sunset pictograms on the timeline for the zoomed day.
function renderZoomedSunMarks(date) {
  const tlBar = document.getElementById('timeline-bar');
  if (!tlBar) return;
  tlBar.querySelectorAll('.tl-sun-mark').forEach(el => el.remove());
  if (!date || !state.cityDaily) return;
  const idx = state.cityDaily.time.findIndex(t => sameDay(new Date(t), date));
  if (idx < 0) return;
  const span = TimeCtl.end.getTime() - TimeCtl.start.getTime();
  if (span <= 0) return;
  const place = (iso, icon, label) => {
    if (!iso) return;
    const t = new Date(iso).getTime();
    const p = (t - TimeCtl.start.getTime()) / span;
    if (p < 0 || p > 1) return;
    const m = document.createElement('div');
    m.className = 'tl-sun-mark';
    m.style.left = `${p * 100}%`;
    m.title = `${label} ${fmtTime(new Date(iso))}`;
    m.textContent = icon;
    tlBar.appendChild(m);
  };
  place(state.cityDaily.sunrise?.[idx], '🌅', 'Lever');
  place(state.cityDaily.sunset?.[idx], '🌇', 'Coucher');
}

// Apply (or clear, when date is null) a subtle day/night gradient on the
// chart-box background. The chart's SVG is partly transparent so the gradient
// is visible behind the curve. Inline backgroundImage so chart.js's
// innerHTML rewrites don't disturb it.
function applyDayNightGradient(date) {
  const chartBox = document.getElementById('chart-box');
  if (!chartBox) return;
  if (!date || !state.cityDaily) {
    chartBox.style.backgroundImage = '';
    return;
  }
  const idx = state.cityDaily.time.findIndex(t => sameDay(new Date(t), date));
  if (idx < 0) { chartBox.style.backgroundImage = ''; return; }
  const span = TimeCtl.end.getTime() - TimeCtl.start.getTime();
  if (span <= 0) { chartBox.style.backgroundImage = ''; return; }
  const sunrise = state.cityDaily.sunrise?.[idx];
  const sunset  = state.cityDaily.sunset?.[idx];
  if (!sunrise || !sunset) { chartBox.style.backgroundImage = ''; return; }
  const rP = Math.max(0, Math.min(100, ((new Date(sunrise).getTime() - TimeCtl.start.getTime()) / span) * 100));
  const sP = Math.max(0, Math.min(100, ((new Date(sunset).getTime()  - TimeCtl.start.getTime()) / span) * 100));
  chartBox.style.backgroundImage = `linear-gradient(90deg,
    var(--night-band) 0%,
    var(--night-band) ${rP}%,
    var(--day-band) ${rP}%,
    var(--day-band) ${sP}%,
    var(--night-band) ${sP}%,
    var(--night-band) 100%)`;
}



async function enterZoom(date) {
  if (_isAnimatingZoom || _zoomedDay) return;
  const layer = ensureFrameLayer();
  if (!layer) return;
  const f = layer.querySelector('.day-frame.pin-frame');
  if (!f) return;  // Defensive: enterZoom shouldn't be triggerable without a pin frame
  _isAnimatingZoom = true;
  _zoomedDay = new Date(date);
  const reduced = reducedMotion();

  // Phase 1: gray + shimmer in place. CSS transitions bg-color from
  // transparent → gray over ~150ms; the shimmer keyframes start immediately.
  f.classList.add('loading');
  await sleep(reduced ? 0 : 130);

  // Phase 2: stretch frame to span the entire timeline. CSS transition on
  // left/right takes ~220ms; meanwhile the gray fill masks any visual drift
  // of the underlying timeline content.
  f.style.left = '0%';
  f.style.right = '0%';
  await sleep(reduced ? 0 : 230);

  // Phase 3: swap the actual data. Reinit TimeCtl onto the day's 24h
  // window. If "now" falls inside the day, point the cursor there;
  // otherwise default to noon.
  const [dStart, dEnd] = dayBounds(date);
  const now = new Date();
  TimeCtl.init(dStart, dEnd);
  const target = (now >= dStart && now <= dEnd) ? now : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  TimeCtl.setTime(target.getTime());
  renderZoomedSunMarks(date);
  applyDayNightGradient(date);
  // The toggle button now means "exit zoom" — update tooltip; the +/−
  // glyph itself is swapped via CSS based on the .zoomed class.
  const btn = f.querySelector('.day-frame-zoom-btn');
  if (btn) btn.title = 'Quitter la vue détaillée';
  _lastSidebarHour = null;        // force the sidebar to rebuild
  renderSidebarShell();

  // Phase 4: morph the frame into the zoomed external border (lighter,
  // transparent fill) and stop the shimmer.
  await sleep(reduced ? 0 : 50);
  f.classList.remove('loading');
  f.classList.add('zoomed');
  _isAnimatingZoom = false;
}

async function exitZoom() {
  if (_isAnimatingZoom || !_zoomedDay) return;
  const layer = ensureFrameLayer();
  if (!layer) return;
  const f = layer.querySelector('.day-frame.pin-frame');
  _isAnimatingZoom = true;
  const dayThatWasZoomed = _zoomedDay;

  // Restore TimeCtl to the current state.rangeMode bounds. Calling setupRange
  // is enough — it does init+setTime to "now".
  setupRange();
  document.querySelectorAll('.tl-sun-mark').forEach(el => el.remove());
  applyDayNightGradient(null);

  // Pin frame: shrink back to the day's position in the new range. Drop the
  // .zoomed class first so the border style transitions back to the solid
  // pin look while CSS animates left/right back to the bounded position.
  _zoomedDay = null;
  if (f) {
    const pos = dayPositionPct(dayThatWasZoomed);
    f.classList.remove('zoomed', 'loading');
    const btn = f.querySelector('.day-frame-zoom-btn');
    if (btn) btn.title = 'Voir le détail du jour';
    if (pos) {
      f.style.left = `${pos[0]}%`;
      f.style.right = `${100 - pos[1]}%`;
      _pinnedDay = new Date(dayThatWasZoomed);
    } else {
      // Day no longer in range (shouldn't happen for week/extended which
      // both contain "today + N days") — drop the pin.
      f.remove();
      _pinnedDay = null;
    }
  }
  _lastSidebarHour = null;
  renderSidebarShell();

  await sleep(reducedMotion() ? 0 : 250);
  _isAnimatingZoom = false;
}

async function crossfadeZoomToDay(date) {
  if (_isAnimatingZoom || !_zoomedDay) return;
  const layer = ensureFrameLayer();
  if (!layer) return;
  const f = layer.querySelector('.day-frame.pin-frame');
  _isAnimatingZoom = true;
  const reduced = reducedMotion();

  // Show the loading rideau over the (already full-width) frame.
  if (f) f.classList.add('loading');
  await sleep(reduced ? 0 : 140);

  _zoomedDay = new Date(date);
  _pinnedDay = new Date(date);
  const [dStart, dEnd] = dayBounds(date);
  const now = new Date();
  TimeCtl.init(dStart, dEnd);
  const target = (now >= dStart && now <= dEnd) ? now : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  TimeCtl.setTime(target.getTime());
  renderZoomedSunMarks(date);
  applyDayNightGradient(date);
  _lastSidebarHour = null;
  renderSidebarShell();

  await sleep(reduced ? 0 : 60);
  if (f) f.classList.remove('loading');
  _isAnimatingZoom = false;
}
