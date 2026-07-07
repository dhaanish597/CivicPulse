export async function getRoute(originLng, originLat, destLng, destLat) {
  const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson&alternatives=true`;
  const res = await fetch(url);
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
