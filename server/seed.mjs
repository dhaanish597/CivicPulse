import { categories, loadWardReference, localities, sources } from './data/localities.mjs';
import { countComplaints, getDb, insertComplaint } from './db.mjs';

// ROUND2.md §1.1: ~600 new grievances/day in GHMC's Centralised Grievance
// Redressal System (CGRS). This is the only real-world number used to derive
// seed volume — do not invent or round it further.
const REAL_COMPLAINTS_PER_DAY = 600;
const SEED_DAYS = 30;

// If seeding (or dashboard rendering) at the real ~600/day rate proves too slow
// for local dev, fall back to this clearly-labelled reduced rate instead of
// silently dropping volume. See task report for whichever rate actually shipped.
const REDUCED_COMPLAINTS_PER_DAY = 100;

// Share of the seeded volume concentrated into one circle so it reads as a real,
// obvious hotspot in the demo rather than noise (mirrors the old "guarantee one
// demo hotspot" behavior that used to concentrate extra complaints on ward 8).
// Circles vary a lot in ward count (1 to 25 wards in the loaded GHMC data), so a
// small bump gets swamped by baseline volume in a large circle; 0.3 is large
// enough to keep the chosen circle a clear standout even in the worst case
// (smallest-ward-count circle vs. the largest-ward-count circle at baseline).
const HOTSPOT_SHARE = 0.3;

export function seedIfEmpty(database = getDb()) {
  if (countComplaints(database) > 0) return false;

  const wardReference = loadWardReference();
  const perDay = resolveSeedRate();
  const { complaints, meta } = generateSeedComplaints({ wardReference, days: SEED_DAYS, perDay });

  const insertMany = database.transaction(() => {
    complaints.forEach((complaint) => insertComplaint(complaint, database));
  });

  const startedAt = Date.now();
  insertMany();
  const elapsedMs = Date.now() - startedAt;

  console.log(
    `Seeded ${complaints.length} synthetic Hyderabad complaints into SQLite in ${elapsedMs}ms ` +
    `(${SEED_DAYS} days at ${perDay}/day, ward-reference source: ${wardReference.source}` +
    `${meta.hotspotCircle ? `, hotspot circle: ${meta.hotspotCircle}` : ''}).`
  );

  if (perDay !== REAL_COMPLAINTS_PER_DAY) {
    console.log(
      `[seed] seeded at a reduced rate (${perDay}/day) for local dev performance; ` +
      `real GHMC volume is ~${REAL_COMPLAINTS_PER_DAY}/day, see ROUND2.md §1.1.`
    );
  }

  return true;
}

function resolveSeedRate() {
  // Override for local dev / CI if the real-volume seed proves too slow:
  // SEED_RATE_PER_DAY=100 npm run dev
  const override = Number(process.env.SEED_RATE_PER_DAY);
  if (Number.isFinite(override) && override > 0) return override;
  return REAL_COMPLAINTS_PER_DAY;
}

export function generateSeedComplaints({ wardReference, days = SEED_DAYS, perDay = REAL_COMPLAINTS_PER_DAY }) {
  const wards = wardReference.wards;
  const hotspotCircle = pickHotspotCircle(wards, wardReference.source);

  const totalVolume = days * perDay;
  const hotspotCount = hotspotCircle ? Math.round(totalVolume * HOTSPOT_SHARE) : 0;
  const baselineCount = totalVolume - hotspotCount;

  const complaints = [];

  for (let i = 0; i < baselineCount; i += 1) {
    complaints.push(createSyntheticComplaint({
      wardEntry: randomWardEntry(wards),
      legacyLocality: randomLegacyLocality(),
      category: randomCategory(),
      maxDaysAgo: days,
      resolvedProbability: 0.7,
    }));
  }

  for (let i = 0; i < hotspotCount; i += 1) {
    complaints.push(createSyntheticComplaint({
      wardEntry: pickWardInCircle(wards, hotspotCircle),
      legacyLocality: randomLegacyLocality(),
      category: 'Garbage Overflow',
      maxDaysAgo: days,
      resolvedProbability: 0.55,
      severityMin: 3,
    }));
  }

  complaints.sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());

  return { complaints, meta: { hotspotCircle } };
}

function pickHotspotCircle(wards, source) {
  if (source !== 'ghmc_wards.json') return null;
  const circles = [...new Set(wards.map((w) => w.circle).filter(Boolean))];
  return circles[0] ?? null;
}

function pickWardInCircle(wards, circle) {
  const candidates = wards.filter((w) => w.circle === circle);
  if (candidates.length === 0) return randomWardEntry(wards);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function randomWardEntry(wards) {
  return wards[Math.floor(Math.random() * wards.length)];
}

function randomLegacyLocality() {
  return localities[Math.floor(Math.random() * localities.length)];
}

function createSyntheticComplaint({
  wardEntry,
  legacyLocality,
  category,
  maxDaysAgo,
  resolvedProbability,
  severityMin = 1,
}) {
  const daysAgo = randomDaysAgo(maxDaysAgo);
  const reportedAt = new Date();
  reportedAt.setDate(reportedAt.getDate() - daysAgo);
  reportedAt.setHours(Math.floor(Math.random() * 24));
  reportedAt.setMinutes(Math.floor(Math.random() * 60));
  reportedAt.setSeconds(0);
  reportedAt.setMilliseconds(0);

  const resolved = Math.random() < resolvedProbability;
  const daysOpen = resolved
    ? Math.max(1, Math.floor(Math.random() * Math.max(1, Math.min(daysAgo, 15))))
    : daysAgo + 1;

  // Complaint markers and legacy ward/locality stay anchored to the pre-existing
  // 20-locality demo geography (jittered) so map rendering in components outside
  // this task's scope (MapView, NearMePanel, LocalIssuesMap, RoutePlanner, CityAdmin)
  // is unaffected. zone/circle/ward_name are a separate, real-GHMC-sourced overlay
  // used only by the new circle-scoped officer/admin endpoints. See task report.
  const coords = jitterCoord(legacyLocality);
  const severity = severityMin > 1
    ? Math.max(severityMin, Math.floor(Math.random() * (6 - severityMin)) + severityMin)
    : randomSeverity();

  return {
    id: generateId(),
    ward: legacyLocality.ward,
    locality: legacyLocality.locality,
    category,
    severity,
    reportedAt: reportedAt.toISOString(),
    resolved,
    daysOpen,
    lat: coords.lat,
    lng: coords.lng,
    source: randomSource(),
    description: syntheticDescription(category, legacyLocality.locality),
    zone: wardEntry?.zone ?? null,
    circle: wardEntry?.circle ?? null,
    wardName: wardEntry?.ward_name ?? null,
  };
}

function generateId() {
  return `CMP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function randomSeverity() {
  const weights = [0.1, 0.15, 0.3, 0.3, 0.15];
  const r = Math.random();
  let cumulative = 0;

  for (let i = 0; i < weights.length; i += 1) {
    cumulative += weights[i];
    if (r < cumulative) return i + 1;
  }

  return 3;
}

function randomCategory() {
  return categories[Math.floor(Math.random() * categories.length)];
}

function randomSource() {
  return sources[Math.floor(Math.random() * sources.length)];
}

function randomDaysAgo(maxDays) {
  return Math.floor(Math.pow(Math.random(), 1.8) * maxDays);
}

function jitterCoord(locality) {
  return {
    lat: Number((locality.lat + (Math.random() - 0.5) * 0.01).toFixed(6)),
    lng: Number((locality.lng + (Math.random() - 0.5) * 0.01).toFixed(6)),
  };
}

function syntheticDescription(category, locality) {
  const snippets = {
    'Garbage Overflow': `Garbage bins overflowing near ${locality}.`,
    'Pothole / Road Damage': `Road surface damaged and slowing traffic in ${locality}.`,
    'Water Leakage': `Water leakage reported by residents in ${locality}.`,
    'Streetlight Outage': `Streetlight outage creating a dark stretch in ${locality}.`,
    'Drainage Blockage': `Drainage blockage causing stagnant water in ${locality}.`,
    'Stray Animal Hazard': `Stray animal hazard reported near ${locality}.`,
  };

  return snippets[category] ?? `Civic issue reported in ${locality}.`;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  seedIfEmpty();
}
