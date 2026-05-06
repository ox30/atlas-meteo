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
import { clearScrubberContent, setWeatherProvider, clearWeatherProvider } from './scrubber.js';
import { renderChart } from './chart.js';

let _cityMarker = null;
let _isActive = false;
let _lastSidebarHour = null;

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
    if (_isActive && state.city) {
      setupRange();
      _lastSidebarHour = null;       // force re-render of sidebar
      renderSidebarShell();
    }
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
  document.getElementById('viewport').classList.remove('viewport-mode-city-anim');
  document.getElementById('viewport').classList.remove('with-chart');
  document.getElementById('chart-box').innerHTML = '';
}

async function loadCity(city, seekTime = null) {
  state.city = city;
  document.getElementById('empty-state').style.display = 'none';
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
  if (state.cityHourly) {
    const w = pickHour(state.cityHourly, time);
    const cond = wmo(w.code);
    document.getElementById('scrubber-summary').innerHTML = `<strong>${cond.icon} ${cond.label}</strong>`;
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
}

// Just refresh the current card values without rebuilding the rest
function updateCurrentCard(time) {
  const w = pickHour(state.cityHourly, time);
  const cond = wmo(w.code);
  const c = state.city;
  const host = document.getElementById('cur-card-host');
  if (!host) return;
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
        <div class="meta-item"><span class="meta-label">Pression</span><span class="meta-value">${w.pressure ? Math.round(w.pressure) : '—'} hPa</span></div>
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
      <div class="fday-name">${['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][day.date.getDay()]}</div>
      <div class="fday-icon">${dc.icon}</div>
      <div class="fday-temps"><span class="fday-tmax">${Math.round(state.cityDaily.temperature_2m_max[day.idx])}°</span><span class="fday-tmin">/${Math.round(state.cityDaily.temperature_2m_min[day.idx])}°</span></div>
    </div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.forecast-day[data-day-iso]').forEach(el => {
    el.addEventListener('click', () => handleDayClick(new Date(el.dataset.dayIso)));
  });
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

function handleDayClick(targetDate) {
  // Set to noon of target day
  targetDate.setHours(12, 0, 0, 0);
  const now = new Date();
  const daysAhead = (targetDate.getTime() - now.getTime()) / (24 * 3600 * 1000);
  // Switch mode if needed to make the day reachable
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
  TimeCtl.setTime(targetDate.getTime());
}
