// Round 2 Task 4, Step 6 (ROUND2.md §4.5): OSRM is a third-party public
// service with no SLA — a hung request here used to be able to hang the
// whole /api/route-check call indefinitely. AbortController bounds it to 5s;
// routeAgent.mjs's existing try/catch around getRoute() (its straight-line
// fallback) already catches ANY thrown error unconditionally, including the
// AbortError this produces — confirmed by reading that catch block, not
// assumed — so no change was needed there. The AbortError is re-thrown as a
// plain Error with a descriptive message purely so it reads clearly if ever
// logged, not because the catch needed a different shape.
const OSRM_TIMEOUT_MS = 5000;

export async function getRoute(originLng, originLat, destLng, destLat) {
  const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson&alternatives=true`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Routing service timed out after ${OSRM_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error('Routing service unavailable');
  }
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
    throw new Error('No route found');
  }

  return {
    routes: data.routes.map(r => ({
      points: r.geometry.coordinates, // array of [lng, lat]
      distance: r.distance,
      duration: r.duration
    }))
  };
}
