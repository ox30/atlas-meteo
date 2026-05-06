// Atlas Météo — Custom datetime picker
//
// Replaces the native <input type="datetime-local"> for the route departure
// time. The field element keeps id="route-time" and exposes a .value property
// (via Object.defineProperty) that round-trips strings in the same format as
// the native input ("YYYY-MM-DDTHH:MM", local time) so route-mode.js can keep
// reading/writing .value with no changes.
//
// Public API:
//   attachDateTimePicker(fieldId)
//
// Footer behavior:
//   Effacer    — clears the value and closes
//   Maintenant — sets picker to current local time (rounded to MINUTE_STEP)
//   Valider    — commits the current selection and closes

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                   'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS_FR_SHORT = ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'];
const MINUTE_STEP = 5;

const pad2 = n => n.toString().padStart(2, '0');
const roundToStep = (n, step) => Math.round(n / step) * step;
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

function formatDisplay(d) {
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Match the native datetime-local "value" format (local time, no TZ)
function formatValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseValue(v) {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

function buildCalendarCells(year, month) {
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday-first: 0..6
  const start = new Date(year, month, 1 - startDow);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ date: d, dim: d.getMonth() !== month });
  }
  return cells;
}

export function attachDateTimePicker(fieldId) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  const textEl  = field.querySelector('.dt-field-text');
  const checkEl = field.querySelector('.dt-field-check');

  // Internal state ----------------------------------------------------------
  let storedValue = '';      // canonical "YYYY-MM-DDTHH:MM" string (or '')
  let selDate     = null;    // mirror of storedValue as a Date (or null)
  let viewMonth   = 0;       // currently visible month in calendar
  let viewYear    = 0;
  let popupEl     = null;
  let isOpen      = false;
  let workingDate = null;    // editable inside the picker until "Valider"

  // Expose .value on the field so existing code keeps working --------------
  // Capture any value already assigned (in case setDefaultTime() ran before
  // we got attached), then redefine the property with our getter/setter.
  const preExisting = (typeof field.value === 'string') ? field.value : '';
  Object.defineProperty(field, 'value', {
    get() { return storedValue; },
    set(v) {
      storedValue = (typeof v === 'string') ? v : '';
      selDate = parseValue(storedValue);
      syncDisplay();
    },
    configurable: true
  });
  if (preExisting) field.value = preExisting; // triggers the setter

  // Display sync ------------------------------------------------------------
  function syncDisplay() {
    if (selDate) {
      textEl.textContent = formatDisplay(selDate);
      textEl.classList.remove('placeholder');
      if (checkEl) checkEl.hidden = false;
    } else {
      textEl.textContent = 'Sélectionner une date…';
      textEl.classList.add('placeholder');
      if (checkEl) checkEl.hidden = true;
    }
  }

  function commit(d) {
    if (d) {
      storedValue = formatValue(d);
      selDate = new Date(d.getTime());
    } else {
      storedValue = '';
      selDate = null;
    }
    syncDisplay();
    close();
  }

  // Open / close ------------------------------------------------------------
  function open() {
    if (isOpen) return;
    // Initialize working state from the committed selection (or "now")
    if (selDate) {
      workingDate = new Date(selDate.getTime());
    } else {
      const now = new Date();
      now.setMinutes(roundToStep(now.getMinutes(), MINUTE_STEP), 0, 0);
      workingDate = now;
    }
    viewMonth = workingDate.getMonth();
    viewYear  = workingDate.getFullYear();

    popupEl = document.createElement('div');
    popupEl.className = 'dt-popup';
    popupEl.setAttribute('role', 'dialog');
    popupEl.innerHTML = popupHTML();
    field.appendChild(popupEl);
    bindPopup();
    renderAll();

    isOpen = true;
    field.classList.add('dt-field-open');
    // Defer to skip the click that opened us
    setTimeout(() => {
      document.addEventListener('mousedown', onDocMouseDown);
      document.addEventListener('keydown', onDocKey);
    }, 0);
  }

  function close() {
    if (!isOpen) return;
    if (popupEl && popupEl.parentNode) popupEl.parentNode.removeChild(popupEl);
    popupEl = null;
    isOpen = false;
    field.classList.remove('dt-field-open');
    document.removeEventListener('mousedown', onDocMouseDown);
    document.removeEventListener('keydown', onDocKey);
  }

  function onDocMouseDown(e) {
    if (!field.contains(e.target)) close();
  }
  function onDocKey(e) {
    if (e.key === 'Escape') close();
  }

  // Popup HTML --------------------------------------------------------------
  function popupHTML() {
    return `
      <div class="dt-popup-inner">
        <div class="dt-cal-header">
          <button type="button" class="dt-cal-nav" data-nav="-1" aria-label="Mois précédent">‹</button>
          <div class="dt-cal-month">—</div>
          <button type="button" class="dt-cal-nav" data-nav="1" aria-label="Mois suivant">›</button>
        </div>
        <div class="dt-cal-dow">${DAYS_FR_SHORT.map(d => `<span>${d}</span>`).join('')}</div>
        <div class="dt-cal-grid"></div>

        <div class="dt-wheels">
          <div class="dt-wheel" data-wheel="hour">
            <button type="button" class="dt-wheel-btn dt-wheel-up" aria-label="Heure suivante">▲</button>
            <div class="dt-wheel-value" data-value="hour" tabindex="0" aria-label="Heures">00</div>
            <button type="button" class="dt-wheel-btn dt-wheel-down" aria-label="Heure précédente">▼</button>
            <div class="dt-wheel-label">Heures</div>
          </div>
          <div class="dt-wheel-sep" aria-hidden="true">:</div>
          <div class="dt-wheel" data-wheel="minute">
            <button type="button" class="dt-wheel-btn dt-wheel-up" aria-label="Minutes suivantes">▲</button>
            <div class="dt-wheel-value" data-value="minute" tabindex="0" aria-label="Minutes">00</div>
            <button type="button" class="dt-wheel-btn dt-wheel-down" aria-label="Minutes précédentes">▼</button>
            <div class="dt-wheel-label">Minutes</div>
          </div>
        </div>

        <div class="dt-footer">
          <button type="button" class="dt-footer-btn dt-clear">Effacer</button>
          <button type="button" class="dt-footer-btn dt-now">Maintenant</button>
          <button type="button" class="dt-footer-btn dt-confirm">Valider</button>
        </div>
      </div>
    `;
  }

  // Bindings ----------------------------------------------------------------
  function bindPopup() {
    popupEl.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = parseInt(btn.dataset.nav, 10);
        viewMonth += dir;
        if (viewMonth < 0)  { viewMonth = 11; viewYear--; }
        if (viewMonth > 11) { viewMonth = 0;  viewYear++; }
        renderCalendar();
      });
    });

    bindWheel('hour',   24, 1);
    bindWheel('minute', 60, MINUTE_STEP);

    popupEl.querySelector('.dt-clear').addEventListener('click', () => commit(null));
    popupEl.querySelector('.dt-now').addEventListener('click', () => {
      const now = new Date();
      now.setMinutes(roundToStep(now.getMinutes(), MINUTE_STEP), 0, 0);
      workingDate = now;
      viewMonth = now.getMonth();
      viewYear  = now.getFullYear();
      renderAll();
    });
    popupEl.querySelector('.dt-confirm').addEventListener('click', () => {
      commit(workingDate);
    });
  }

  function bindWheel(kind, mod, step) {
    const wheelEl = popupEl.querySelector(`[data-wheel="${kind}"]`);
    const change = delta => {
      if (kind === 'hour') {
        const v = workingDate.getHours();
        workingDate.setHours(((v + delta * step) % mod + mod) % mod);
      } else {
        const v = workingDate.getMinutes();
        workingDate.setMinutes(((v + delta * step) % mod + mod) % mod);
      }
      renderTime();
    };
    wheelEl.querySelector('.dt-wheel-up').addEventListener('click', () => change(1));
    wheelEl.querySelector('.dt-wheel-down').addEventListener('click', () => change(-1));
    wheelEl.addEventListener('wheel', e => {
      e.preventDefault();
      change(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    // Keyboard support on the value box
    const valueEl = wheelEl.querySelector('.dt-wheel-value');
    valueEl.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp')   { e.preventDefault(); change(1);  }
      if (e.key === 'ArrowDown') { e.preventDefault(); change(-1); }
    });
  }

  // Rendering ---------------------------------------------------------------
  function renderAll() {
    renderCalendar();
    renderTime();
  }

  function renderTime() {
    popupEl.querySelector('[data-value="hour"]').textContent   = pad2(workingDate.getHours());
    popupEl.querySelector('[data-value="minute"]').textContent = pad2(workingDate.getMinutes());
  }

  function renderCalendar() {
    popupEl.querySelector('.dt-cal-month').textContent = `${MONTHS_FR[viewMonth]} ${viewYear}`;

    const cells = buildCalendarCells(viewYear, viewMonth);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const grid = popupEl.querySelector('.dt-cal-grid');
    grid.innerHTML = cells.map((c, i) => {
      const cls = ['dt-day'];
      if (c.dim)                                cls.push('dim');
      if (sameDay(c.date, today))               cls.push('today');
      if (workingDate && sameDay(c.date, workingDate)) cls.push('selected');
      return `<button type="button" class="${cls.join(' ')}" data-i="${i}">${c.date.getDate()}</button>`;
    }).join('');

    grid.querySelectorAll('.dt-day').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = cells[parseInt(btn.dataset.i, 10)];
        // Preserve the working hour/minute
        workingDate = new Date(
          c.date.getFullYear(), c.date.getMonth(), c.date.getDate(),
          workingDate.getHours(), workingDate.getMinutes()
        );
        if (c.dim) {
          viewMonth = c.date.getMonth();
          viewYear  = c.date.getFullYear();
        }
        renderAll();
      });
    });
  }

  // Wire field interactions -------------------------------------------------
  field.addEventListener('click', e => {
    if (popupEl && popupEl.contains(e.target)) return;
    if (isOpen) close();
    else open();
  });
  field.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && !isOpen) {
      e.preventDefault();
      open();
    }
  });

  // Initial state
  syncDisplay();
}
