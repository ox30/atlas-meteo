import { getMap, clearLayer } from './map.js';
import { pointAtProgress } from './routing.js';

// Sun altitude in degrees at time/lat/lon
export function getSunAltitudeDeg(time, lat, lon) {
  return SunCalc.getPosition(time, lat, lon).altitude * 180 / Math.PI;
}

// Sun azimuth in compass degrees (0=N, 90=E, 180=S, 270=W)
export function getSunAzimuthDeg(time, lat, lon) {
  // SunCalc azimuth: 0 = south, +west. Convert.
  return (SunCalc.getPosition(time, lat, lon).azimuth * 180 / Math.PI + 180 + 360) % 360;
}

export function getSunTimes(time, lat, lon) {
  return SunCalc.getTimes(time, lat, lon);
}

// Compute lever / coucher events along a route between depart and arrival
export function computeSunEvents(coords, cumDist, departTime, totalDur) {
  const events = [];
  if (totalDur <= 0) return events;
  const stepMin = 10;
  const totalMin = totalDur / 60;
  let lastAlt = null, lastT = null;
  for (let m = 0; m <= totalMin + stepMin; m += stepMin) {
    const elapsedSec = Math.min(m * 60, totalDur);
    const progress = elapsedSec / totalDur;
    const t = new Date(departTime.getTime() + elapsedSec * 1000);
    const p = pointAtProgress(coords, cumDist, progress);
    const alt = getSunAltitudeDeg(t, p.lat, p.lon);
    if (lastAlt !== null && Math.sign(lastAlt) !== Math.sign(alt) && lastAlt !== 0) {
      const frac = -lastAlt / (alt - lastAlt);
      const eventT = new Date(lastT.getTime() + frac * (t.getTime() - lastT.getTime()));
      const eventProg = (eventT.getTime() - departTime.getTime()) / (totalDur * 1000);
      events.push({
        type: alt > 0 ? 'sunrise' : 'sunset',
        time: eventT,
        progress: Math.max(0, Math.min(1, eventProg))
      });
    }
    lastAlt = alt; lastT = t;
  }
  return events;
}

// Subsolar point at a given time (where the sun is directly overhead)
function getSubsolarPoint(date) {
  // Cooper formula for solar declination
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date - start) / 86400000);
  const decDeg = 23.45 * Math.sin(2 * Math.PI * (dayOfYear + 284) / 365);
  // Subsolar longitude (ignoring equation of time, ~15 min approx max error)
  const utcHours = date.getUTCHours() + date.getUTCMinutes()/60 + date.getUTCSeconds()/3600;
  let lon = (12 - utcHours) * 15;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return { lat: decDeg, lon };
}

// Compute terminator polyline (where sun altitude = 0)
export function computeTerminator(date, stepDeg = 2) {
  const sub = getSubsolarPoint(date);
  const latSubRad = sub.lat * Math.PI / 180;
  const tanLatSub = Math.tan(latSubRad);
  // Avoid singularity near equinox: if tan very small, use a tiny offset
  const safeTan = Math.abs(tanLatSub) < 0.01 ? (tanLatSub >= 0 ? 0.01 : -0.01) : tanLatSub;
  const points = [];
  for (let lonDeg = -180; lonDeg <= 180; lonDeg += stepDeg) {
    const lonDiff = (lonDeg - sub.lon) * Math.PI / 180;
    const latRad = Math.atan(-Math.cos(lonDiff) / safeTan);
    points.push([latRad * 180 / Math.PI, lonDeg]);
  }
  return points;
}

// Terminator drawing — singleton
let _terminatorLayer = null;
export function drawTerminator(date) {
  const map = getMap();
  clearLayer(_terminatorLayer);
  _terminatorLayer = null;
  const points = computeTerminator(date);
  // Draw two lines: a glow underlay, and a thin top line
  const glow = L.polyline(points, {
    color: '#ffd28a', weight: 8, opacity: 0.18,
    smoothFactor: 1, interactive: false, noClip: true
  });
  const line = L.polyline(points, {
    color: '#ffb366', weight: 1.4, opacity: 0.85,
    dashArray: '4,3', smoothFactor: 1, interactive: false, noClip: true
  });
  _terminatorLayer = L.layerGroup([glow, line]).addTo(map);
}
export function clearTerminator() {
  clearLayer(_terminatorLayer);
  _terminatorLayer = null;
}

// Sun overlay tint based on altitude
export function sunTint(altDeg) {
  if (altDeg > 30) return 'transparent';
  if (altDeg > 6) {
    const t = (30 - altDeg) / 24;
    return `rgba(255, 165, 60, ${0.10*t})`;
  }
  if (altDeg > -6) {
    const t = (6 - altDeg) / 12;
    return `rgba(120, 70, 140, ${0.18*t})`;
  }
  const depth = Math.min(1, (-altDeg + 6) / 12);
  return `rgba(20, 30, 70, ${0.20 + 0.20*depth})`;
}
