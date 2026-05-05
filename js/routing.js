import { API } from './config.js';
import { haversine } from './utils.js';

// Fetch driving route between two points
export async function fetchRoute(from, to) {
  const url = `${API.routing}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Routing OSRM indisponible');
  const j = await r.json();
  if (!j.routes?.length) throw new Error('Aucune route trouvée');
  return j.routes[0];
}

// Cumulative distances along a polyline of [lon,lat] coords
export function computeCumDistances(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i-1] + haversine(coords[i-1], coords[i]));
  }
  return cum;
}

// Sample N evenly-spaced stops along a route
export function sampleStops(coords, totalDist, totalDur, departTime, n) {
  const cum = computeCumDistances(coords);
  const total = cum[cum.length-1] || totalDist;
  const stops = [];
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1);
    let idx = cum.findIndex(c => c >= target);
    if (idx < 0) idx = cum.length - 1;
    const elapsedSec = (target / total) * totalDur;
    stops.push({
      lon: coords[idx][0], lat: coords[idx][1],
      distFromStart: target,
      elapsedSec,
      arrival: new Date(departTime.getTime() + elapsedSec * 1000),
      idx
    });
  }
  return stops;
}

// Get point at fractional progress along a polyline
export function pointAtProgress(coords, cum, progress) {
  const total = cum[cum.length-1];
  const target = Math.max(0, Math.min(1, progress)) * total;
  let i = 0;
  while (i < cum.length-2 && cum[i+1] < target) i++;
  const segLen = cum[i+1] - cum[i] || 1;
  const sp = (target - cum[i]) / segLen;
  const lon = coords[i][0] + (coords[i+1][0] - coords[i][0]) * sp;
  const lat = coords[i][1] + (coords[i+1][1] - coords[i][1]) * sp;
  return { lon, lat, segIdx: i, segProgress: sp };
}
