import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const categories = [
  'Garbage Overflow',
  'Pothole / Road Damage',
  'Water Leakage',
  'Streetlight Outage',
  'Drainage Blockage',
  'Stray Animal Hazard',
];

export const sources = ['Citizen App', 'Telegram', 'Call Center'];

// Approximate Hyderabad locality centroids for demo mapping, not surveyed boundaries.
// This 20-entry demo list lives in one place, src/data/fallbackLocalities.json, and is
// shared with the frontend (src/data/hyderabadLocalities.ts) so the two runtimes never
// hand-maintain separate copies (see Orientation Finding #6 in the Round 2 task brief).
// It backs the legacy `ward`/`locality` columns and the citizen-facing locality pickers.
// It is deliberately NOT the real GHMC administrative hierarchy — see loadWardReference()
// below for that.
const fallbackLocalitiesPath = path.join(__dirname, '../../src/data/fallbackLocalities.json');
export const localities = JSON.parse(fs.readFileSync(fallbackLocalitiesPath, 'utf-8'));

export function getLocalityByWard(ward) {
  return localities.find((item) => item.ward === Number(ward)) ?? localities[7];
}

export function getLocalityByName(name) {
  const normalized = String(name ?? '').trim().toLowerCase();
  return localities.find((item) => item.locality.toLowerCase() === normalized) ?? null;
}

// --- Real GHMC zone / circle / ward reference (Round 2, Orientation Finding #1/#2) ---
//
// server/data/ghmc_wards.json is authoritative when present: it was generated from a
// real GHMC spreadsheet the user supplied, plus separately-researched approximate
// circle-level coordinates. It reflects a real but older (2007-era) 5-zone/18-circle
// administrative structure, not the 6-zone structure named in ROUND2.md's prose — that
// mismatch is a known, deliberate decision (see README). Never synthesize ward names to
// fill gaps in either path below.
const ghmcWardsPath = path.join(__dirname, 'ghmc_wards.json');

let wardReferenceCache = null;

/**
 * Loads the ward reference data once and caches it for the process lifetime.
 * Returns { wards, source } where source is 'ghmc_wards.json' when the real GHMC
 * file is present and parses, or 'fallback-20-locality' otherwise.
 */
export function loadWardReference() {
  if (wardReferenceCache) return wardReferenceCache;

  if (fs.existsSync(ghmcWardsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(ghmcWardsPath, 'utf-8'));
      if (Array.isArray(raw) && raw.length > 0) {
        wardReferenceCache = { wards: raw, source: 'ghmc_wards.json' };
        return wardReferenceCache;
      }
    } catch (error) {
      console.warn(`[ward-reference] server/data/ghmc_wards.json failed to parse (${error.message}) — falling back to 20-locality demo table. Ward-level data will not reflect real GHMC administrative boundaries.`);
    }
  }

  if (!wardReferenceCache) {
    console.warn('[ward-reference] server/data/ghmc_wards.json not found — falling back to 20-locality demo table. Ward-level data will not reflect real GHMC administrative boundaries.');
    wardReferenceCache = {
      wards: localities.map((item) => ({
        ward_no: item.ward,
        ward_name: item.locality,
        circle: null,
        zone: null,
        lat: item.lat,
        lng: item.lng,
      })),
      source: 'fallback-20-locality',
    };
  }

  return wardReferenceCache;
}

/**
 * Upserts the loaded ward reference into the `ghmc_wards` SQLite table by ward_no.
 * No-op in fallback mode: the fallback list is not real GHMC ward data and must not
 * be persisted into the table that represents it.
 */
export function populateWardReferenceTable(database) {
  const { wards, source } = loadWardReference();
  if (source !== 'ghmc_wards.json') return;

  const upsert = database.prepare(`
    INSERT INTO ghmc_wards (ward_no, ward_name, circle, zone, lat, lng)
    VALUES (@ward_no, @ward_name, @circle, @zone, @lat, @lng)
    ON CONFLICT(ward_no) DO UPDATE SET
      ward_name = excluded.ward_name,
      circle = excluded.circle,
      zone = excluded.zone,
      lat = excluded.lat,
      lng = excluded.lng
  `);

  const insertMany = database.transaction((rows) => {
    for (const row of rows) {
      upsert.run({
        ward_no: row.ward_no,
        ward_name: row.ward_name,
        circle: row.circle,
        zone: row.zone,
        lat: row.lat ?? null,
        lng: row.lng ?? null,
      });
    }
  });

  insertMany(wards);
}
