// Atlas Météo — Entry point

import { state, on } from './state.js';
import { TimeCtl } from './time-ctl.js';
import { getMap, invalidateSizeSoon } from './map.js';
import { buildLegend, initLegendToggle } from './legend.js';
import { initMapPicker } from './map-picker.js';
import { initScrubberHover, clearScrubberContent } from './scrubber.js';
import { initChart, renderChart } from './chart.js';
import * as CityMode from './city-mode.js';
import * as RouteMode from './route-mode.js';

// Init Leaflet
getMap();

// Init shared subsystems
initMapPicker();
initScrubberHover();
initChart();

// Init both modes
CityMode.init();
RouteMode.init();

// Build legend
buildLegend();
initLegendToggle();

// Tab switching
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    const newMode = t.dataset.mode;
    if (newMode === state.mode) return;
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.querySelectorAll('.section-mode').forEach(s => s.classList.remove('active'));
    document.getElementById('mode-' + newMode).classList.add('active');
    if (state.mode === 'city') CityMode.deactivate();
    else RouteMode.deactivate();
    state.mode = newMode;
    buildLegend();
    if (newMode === 'city') CityMode.activate();
    else RouteMode.activate();
    invalidateSizeSoon(150);
  });
});

// Scrubber controls
document.getElementById('btn-play').addEventListener('click', () => TimeCtl.toggle());
document.getElementById('btn-rewind').addEventListener('click', () => TimeCtl.reset());
document.getElementById('speed-select').addEventListener('change', e => TimeCtl.setSpeed(parseInt(e.target.value)));
document.getElementById('timeline-bar').addEventListener('click', e => {
  if (!TimeCtl.isInitialized()) return;
  // Don't trigger seek when clicking on a stop mark or sun mark (they have their own handler)
  if (e.target.closest('.tl-stop-mark, .tl-sun-mark, .tl-pause-zone, .tl-pause-icon')) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const p = (e.clientX - rect.left) / rect.width;
  TimeCtl.pause();
  TimeCtl.setProgress(p);
});

on('playStateChange', ({ playing }) => {
  document.getElementById('btn-play').textContent = playing ? '⏸' : '▶';
});

// Re-render chart whenever it changes
on('chartChange', () => renderChart());

// Lot C — "Détails →" button on stop popups: switch to city mode for that location
on('viewStopDetails', async ({ name, lat, lon, time }) => {
  // 1. Switch tab to city
  if (state.mode !== 'city') {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.mode === 'city'));
    document.querySelectorAll('.section-mode').forEach(s => s.classList.remove('active'));
    document.getElementById('mode-city').classList.add('active');
    RouteMode.deactivate();
    state.mode = 'city';
    buildLegend();
    CityMode.activate();
    invalidateSizeSoon(150);
  }
  // 2. Load the location and seek to the requested time once the city forecast is loaded
  CityMode.loadCityFromExternal({ name, latitude: lat, longitude: lon, country: '' }, time);
});

// Start in city mode
CityMode.activate();
