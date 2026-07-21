import { getLocalityByName, getLocalityByWard, resolveWardForLocation, sources } from '../data/localities.mjs';
import { normalizeImageInput } from '../utils.mjs';

export function runIngestion(input) {
  const textNote = typeof input.textNote === 'string'
    ? input.textNote.trim()
    : typeof input.description === 'string'
      ? input.description.trim()
      : '';
  const image = normalizeImageInput(input.image ?? input);

  if (!textNote && !image) {
    const error = new Error('A complaint requires a photo or text description.');
    error.status = 400;
    throw error;
  }

  const locality = resolveLocality(input);
  const coords = resolveCoordinates(input, locality);
  const source = sources.includes(input.source) ? input.source : 'Citizen App';
  // Real GHMC circle/zone assignment is a separate, geographic lookup from the legacy
  // ward/locality resolution above — see resolveWardForLocation() for why this can't be
  // joined by ward number. Every new complaint gets a real, geographically-grounded
  // zone/circle/ward_name here (or nulls when only the fallback demo table is loaded),
  // so circle-scoped views (?circle=) see complaints reported through this pipeline,
  // not just seeded historical rows.
  const ghmcWard = resolveWardForLocation(coords.lat, coords.lng);

  return {
    textNote,
    image,
    ward: locality.ward,
    locality: locality.locality,
    lat: coords.lat,
    lng: coords.lng,
    zone: ghmcWard.zone,
    circle: ghmcWard.circle,
    wardName: ghmcWard.ward_name,
    source,
    description: textNote,
  };
}

function resolveLocality(input) {
  if (input.locality) {
    const byName = getLocalityByName(input.locality);
    if (byName) return byName;
  }

  if (input.ward) return getLocalityByWard(input.ward);

  const error = new Error('A complaint requires coordinates, locality, or ward.');
  error.status = 400;
  throw error;
}

function resolveCoordinates(input, locality) {
  const lat = Number(input.lat);
  const lng = Number(input.lng);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }

  return {
    lat: Number((locality.lat + (Math.random() - 0.5) * 0.01).toFixed(6)),
    lng: Number((locality.lng + (Math.random() - 0.5) * 0.01).toFixed(6)),
  };
}
