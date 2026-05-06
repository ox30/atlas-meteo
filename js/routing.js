import { API } from './config.js';
import { haversine, safeFetchJson } from './utils.js';

export async function fetchRoute(waypoints) {
  if (!waypoints || waypoints.length < 2) throw new Error('Au moins 2 étapes requises');
  const coords = waypoints.map(w => `${w.longitude},${w.latitude}`).join(';');
  const url = `${API.routing}/${coords}?overview=full&geometries=geojson&steps=false`;
  const j = await safeFetchJson(url);
  if (!j.routes?.length) throw new Error('Aucune route trouvée entre ces étapes');
  return j.routes[0];
}

export function computeCumDistances(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i-1] + haversine(coords[i-1], coords[i]));
  }
  return cum;
}

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

export function findWaypointIndices(coords, waypoints) {
  return waypoints.map(wp => {
    let bestIdx = 0, bestDist = Infinity;
    const target = [wp.longitude, wp.latitude];
    for (let i = 0; i < coords.length; i++) {
      const d = haversine(target, coords[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
  });
}

export function buildSegments(route, waypoints, departTime) {
  const segments = [];
  let t = 0;
  const coords = route.geometry.coordinates;
  const wpCoordIdx = findWaypointIndices(coords, waypoints);
  const cum = computeCumDistances(coords);
  const wpCum = wpCoordIdx.map(i => cum[i]);

  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i];
    segments.push({
      type: 'drive',
      startSec: t,
      endSec: t + leg.duration,
      wpIndex: i,
      fromCum: wpCum[i],
      toCum: wpCum[i+1]
    });
    t += leg.duration;
    if (i < route.legs.length - 1) {
      const wp = waypoints[i+1];
      const pauseSec = (wp.pauseHours || 0) * 3600 + (wp.pauseMinutes || 0) * 60;
      if (pauseSec > 0) {
        segments.push({
          type: 'pause',
          startSec: t,
          endSec: t + pauseSec,
          wpIndex: i+1,
          atCum: wpCum[i+1]
        });
        t += pauseSec;
      }
    }
  }
  return { segments, totalSec: t, departTime, wpCum };
}

export function findSegmentAt(segments, elapsedSec) {
  for (const s of segments) {
    if (elapsedSec >= s.startSec && elapsedSec < s.endSec) return s;
  }
  return segments[segments.length - 1];
}

export function positionAtTime(segments, coords, cumDist, elapsedSec) {
  const seg = findSegmentAt(segments, elapsedSec);
  if (seg.type === 'pause') {
    const targetCum = seg.atCum;
    let i = 0;
    while (i < cumDist.length-2 && cumDist[i+1] < targetCum) i++;
    const segLen = cumDist[i+1] - cumDist[i] || 1;
    const sp = (targetCum - cumDist[i]) / segLen;
    const lon = coords[i][0] + (coords[i+1][0] - coords[i][0]) * sp;
    const lat = coords[i][1] + (coords[i+1][1] - coords[i][1]) * sp;
    return { lon, lat, segIdx: i, isPaused: true, currentSegment: seg };
  }
  const segElapsed = elapsedSec - seg.startSec;
  const segDur = seg.endSec - seg.startSec || 1;
  const segProgress = segElapsed / segDur;
  const targetCum = seg.fromCum + segProgress * (seg.toCum - seg.fromCum);
  let i = 0;
  while (i < cumDist.length-2 && cumDist[i+1] < targetCum) i++;
  const segLen = cumDist[i+1] - cumDist[i] || 1;
  const sp = (targetCum - cumDist[i]) / segLen;
  const lon = coords[i][0] + (coords[i+1][0] - coords[i][0]) * sp;
  const lat = coords[i][1] + (coords[i+1][1] - coords[i][1]) * sp;
  return { lon, lat, segIdx: i, isPaused: false, currentSegment: seg };
}

export function sampleRouteStops(segments, coords, cumDist, departTime, n) {
  const drives = segments.filter(s => s.type === 'drive');
  if (!drives.length) return [];
  const totalDriveDist = drives.reduce((sum, d) => sum + (d.toCum - d.fromCum), 0);
  if (totalDriveDist <= 0) return [];
  const stops = [];
  for (let i = 0; i < n; i++) {
    const targetDriveDist = (totalDriveDist * i) / (n - 1);
    let acc = 0;
    let pickedDrive = drives[0];
    let driveOffset = 0;
    for (const d of drives) {
      const segDist = d.toCum - d.fromCum;
      if (acc + segDist >= targetDriveDist || d === drives[drives.length-1]) {
        pickedDrive = d;
        driveOffset = targetDriveDist - acc;
        break;
      }
      acc += segDist;
    }
    const segDist = pickedDrive.toCum - pickedDrive.fromCum || 1;
    const segDur = pickedDrive.endSec - pickedDrive.startSec;
    const localProg = driveOffset / segDist;
    const cumPos = pickedDrive.fromCum + driveOffset;
    const elapsedSec = pickedDrive.startSec + localProg * segDur;
    let idx = 0;
    while (idx < cumDist.length-2 && cumDist[idx+1] < cumPos) idx++;
    const segLen = cumDist[idx+1] - cumDist[idx] || 1;
    const sp = (cumPos - cumDist[idx]) / segLen;
    const lon = coords[idx][0] + (coords[idx+1][0] - coords[idx][0]) * sp;
    const lat = coords[idx][1] + (coords[idx+1][1] - coords[idx][1]) * sp;
    stops.push({
      lon, lat,
      distFromStart: cumPos,
      elapsedSec,
      arrival: new Date(departTime.getTime() + elapsedSec * 1000),
      idx
    });
  }
  return stops;
}
