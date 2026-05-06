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
  // Normalize: state.waypoints wraps {city: {latitude, longitude}}, but
  // findWaypointIndices expects {latitude, longitude} directly. Unwrap if needed.
  const wpCoords = waypoints.map(w => w.city || w);
  const wpCoordIdx = findWaypointIndices(coords, wpCoords);
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
      idx,
      kind: 'interp'   // interpolated stop (not on a waypoint)
    });
  }
  return stops;
}

// Build stops that include both interpolated samples AND every waypoint with its
// arrival/departure times (waypoints with pause have departure = arrival + pauseSec).
// Returns stops sorted by elapsedSec, deduplicated when an interp stop falls very
// close to a waypoint stop.
export function buildRouteStops(segments, coords, cumDist, waypoints, departTime, n) {
  // 1. Interpolated samples
  const interp = sampleRouteStops(segments, coords, cumDist, departTime, n);
  // 2. Waypoint stops (one per waypoint, with arrival = elapsedSec at that waypoint)
  const drives = segments.filter(s => s.type === 'drive');
  if (!drives.length) return interp;
  const wpStops = [];
  // Departure (waypoint 0): elapsedSec = 0
  // Subsequent waypoints: elapsedSec = end of leg i = drives[i].endSec
  // BUT if there's a pause AFTER waypoint i+1, the drive ends at start of pause
  // We want arrivalSec at waypoint i+1 = end of drive that brought us there
  // Build a list of (waypointIndex, arrivalElapsedSec)
  for (let i = 0; i < waypoints.length; i++) {
    let arrivalSec;
    if (i === 0) arrivalSec = 0;
    else if (i - 1 < drives.length) arrivalSec = drives[i - 1].endSec;
    else arrivalSec = drives[drives.length - 1].endSec;
    const wp = waypoints[i];
    const city = wp.city || wp;
    const pauseSec = (wp.pauseHours || 0) * 3600 + (wp.pauseMinutes || 0) * 60;
    wpStops.push({
      lon: city.longitude,
      lat: city.latitude,
      distFromStart: i === 0 ? 0 : drives.slice(0, Math.min(i, drives.length)).reduce((s, d) => s + (d.toCum - d.fromCum), 0),
      elapsedSec: arrivalSec,
      arrival: new Date(departTime.getTime() + arrivalSec * 1000),
      kind: 'waypoint',
      waypointIndex: i,
      isEndpoint: (i === 0 || i === waypoints.length - 1),
      name: city.name,
      pauseSec,
      pauseDeparture: pauseSec > 0 ? new Date(departTime.getTime() + (arrivalSec + pauseSec) * 1000) : null
    });
  }
  // 3. Merge: drop interp stops too close (in time) to any waypoint stop
  const PROXIMITY_SEC = 600;  // 10 min
  const filteredInterp = interp.filter(s =>
    !wpStops.some(w => Math.abs(w.elapsedSec - s.elapsedSec) < PROXIMITY_SEC)
  );
  // 4. Sort all by elapsedSec
  return [...wpStops, ...filteredInterp].sort((a, b) => a.elapsedSec - b.elapsedSec);
}


// Find the stop index that should drive the weather display at a given time.
// During a pause: returns the waypoint stop where the pause occurs (forces
// the weather to stay on that location for the whole pause duration).
// Otherwise: returns the stop temporally closest to `time`.
//
// Inputs:
//   legSegments — built segments (drives + pauses)
//   routeStops  — output of buildRouteStops
//   departTime  — Date of trip start
//   time        — Date for which we want the relevant stop
export function findStopIdxAtTime(legSegments, routeStops, departTime, time) {
  if (!routeStops?.length) return -1;
  // 1. Check if we're in a pause segment
  if (legSegments && departTime) {
    const elapsedSec = (time.getTime() - departTime.getTime()) / 1000;
    for (const seg of legSegments) {
      if (seg.type === 'pause' && elapsedSec >= seg.startSec && elapsedSec < seg.endSec) {
        // Find the waypoint stop matching this pause's wpIndex
        const idx = routeStops.findIndex(s =>
          s.kind === 'waypoint' && s.waypointIndex === seg.wpIndex
        );
        if (idx >= 0) return idx;
      }
    }
  }
  // 2. Otherwise: closest stop temporally
  const tt = time.getTime();
  let bestIdx = 0, bestDiff = Infinity;
  for (let i = 0; i < routeStops.length; i++) {
    const d = Math.abs(routeStops[i].arrival.getTime() - tt);
    if (d < bestDiff) { bestDiff = d; bestIdx = i; }
  }
  return bestIdx;
}
