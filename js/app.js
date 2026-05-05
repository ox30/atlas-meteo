// Atlas Météo — Entry point

import { state } from './state.js';
import { TimeCtl } from './time-ctl.js';
import { getMap, invalidateSizeSoon } from './map.js';
import { buildLegend, initLegendToggle } from './legend.js';
import * as CityMode from './city-mode.js';
import * as RouteMode from './route-mode.js';

// Init Leaflet (creates the map and base tile layer)
getMap();

// Init both modes (subscriptions, autocomplete bindings)
CityMode.init();
RouteMode.init();

// Build legend with current state
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
    // Deactivate previous mode
    if (state.mode === 'city') CityMode.deactivate();
    else RouteMode.deactivate();
    state.mode = newMode;
    // Rebuild legend (range switch only in city mode, stops layer hidden in city mode)
    buildLegend();
    // Activate new mode
    if (newMode === 'city') CityMode.activate();
    else RouteMode.activate();
    invalidateSizeSoon(150);
  });
});

// Scrubber controls (shared between both modes via TimeCtl)
document.getElementById('btn-play').addEventListener('click', () => TimeCtl.toggle());
document.getElementById('btn-rewind').addEventListener('click', () => TimeCtl.reset());
document.getElementById('speed-select').addEventListener('change', e => TimeCtl.setSpeed(parseInt(e.target.value)));
document.getElementById('timeline-bar').addEventListener('click', e => {
  if (!TimeCtl.isInitialized()) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const p = (e.clientX - rect.left) / rect.width;
  TimeCtl.pause();
  TimeCtl.setProgress(p);
});

import { on } from './state.js';
on('playStateChange', ({ playing }) => {
  document.getElementById('btn-play').textContent = playing ? '⏸' : '▶';
});

// Start in city mode
CityMode.activate();
