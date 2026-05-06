import { TimeCtl } from './time-ctl.js';
import { fmtTime, fmtDate, debounce } from './utils.js';
import { state, on } from './state.js';
import { wmo } from './config.js';

let _hoverHandler = null;
let _weatherProvider = null;  // function (time) -> { temp, code } or null

// Clear all dynamic content (pictograms, pause zones)
export function clearScrubberContent() {
  const tlBar = document.getElementById('timeline-bar');
  tlBar.querySelectorAll('.tl-stop-mark, .tl-sun-mark, .tl-pause-zone, .tl-pause-icon').forEach(el => el.remove());
  document.getElementById('timeline-fill').style.width = '0%';
  document.getElementById('clock-time').textContent = '--:--';
  document.getElementById('clock-meta').textContent = '—';
  document.getElementById('scrubber-summary').textContent = '—';
}

// Provider for the hover tooltip (each mode sets its own)
export function setWeatherProvider(fn) {
  _weatherProvider = fn;
}

export function clearWeatherProvider() {
  _weatherProvider = null;
}

function setupHover() {
  const tlBar = document.getElementById('timeline-bar');
  const cursor = document.getElementById('timeline-cursor');
  const tooltip = document.getElementById('timeline-tooltip');
  if (_hoverHandler) tlBar.removeEventListener('mousemove', _hoverHandler);
  _hoverHandler = e => {
    if (!TimeCtl.isInitialized()) {
      cursor.style.display = 'none';
      tooltip.style.display = 'none';
      return;
    }
    // If hovering over a stop pictogram, defer to its own tooltip
    if (e.target.closest('.tl-stop-mark, .tl-sun-mark, .tl-pause-icon')) {
      cursor.style.display = 'none';
      tooltip.style.display = 'none';
      return;
    }
    const rect = tlBar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const p = Math.max(0, Math.min(1, x / rect.width));
    const time = new Date(TimeCtl.start.getTime() + p * (TimeCtl.end - TimeCtl.start));
    cursor.style.left = `${x}px`;
    cursor.style.display = 'block';
    let html = `<div class="tt-time">${fmtTime(time)} · ${fmtDate(time)}</div>`;
    if (_weatherProvider) {
      const w = _weatherProvider(time);
      if (w && w.code != null) {
        const cond = wmo(w.code);
        html += `<div class="tt-cond">
          <span class="tt-cond-icon">${cond.icon}</span>
          <span class="tt-cond-temp">${w.temp != null ? Math.round(w.temp)+'°' : ''}</span>
        </div>`;
      }
    }
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    // Position tooltip relative to bar
    tooltip.style.left = `${x}px`;
  };
  tlBar.addEventListener('mousemove', _hoverHandler);
  tlBar.addEventListener('mouseleave', () => {
    cursor.style.display = 'none';
    tooltip.style.display = 'none';
  });
}

export function initScrubberHover() {
  setupHover();
}
