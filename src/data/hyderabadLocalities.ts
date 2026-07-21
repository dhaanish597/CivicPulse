import fallbackLocalitiesData from './fallbackLocalities.json';

export interface HyderabadLocality {
  ward: number;
  locality: string;
  lat: number;
  lng: number;
}

// Approximate Hyderabad locality centroids for demo mapping, not surveyed boundaries.
// This 20-entry demo list is defined once, in src/data/fallbackLocalities.json, and
// shared with the backend fallback loader at server/data/localities.mjs so the two
// runtimes never hand-maintain separate copies of the same data (see Orientation
// Finding #6 in the Round 2 task brief). It powers the simplified citizen-facing
// locality pickers (Near Me, Local Map, Route Advisor) — it is intentionally
// separate from the real GHMC zone/circle/ward hierarchy loaded from
// server/data/ghmc_wards.json, which powers Ward Officer / City Admin scoping.
export const hyderabadLocalities: HyderabadLocality[] = fallbackLocalitiesData;

export function getLocalityByWard(ward: number): HyderabadLocality {
  return hyderabadLocalities.find((item) => item.ward === ward) ?? hyderabadLocalities[7];
}
