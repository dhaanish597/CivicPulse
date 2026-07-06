import { categories, getLocalityByWard, localities, sources } from './data/localities.mjs';
import { countComplaints, getDb, insertComplaint } from './db.mjs';

export function seedIfEmpty(database = getDb()) {
  if (countComplaints(database) > 0) return false;

  const complaints = generateSeedComplaints(300);
  const insertMany = database.transaction(() => {
    complaints.forEach((complaint) => insertComplaint(complaint, database));
  });

  insertMany();
  console.log(`Seeded ${complaints.length} synthetic Hyderabad complaints into SQLite.`);
  return true;
}

export function generateSeedComplaints(count = 300) {
  const complaints = [];

  for (let i = 0; i < count; i += 1) {
    complaints.push(createSyntheticComplaint({
      ward: randomWard(),
      category: randomCategory(),
      maxDaysAgo: 60,
      resolvedProbability: 0.75,
    }));
  }

  for (let i = 0; i < 35; i += 1) {
    complaints.push(createSyntheticComplaint({
      ward: 8,
      category: 'Garbage Overflow',
      maxDaysAgo: 30,
      resolvedProbability: 0.6,
      severityMin: 3,
    }));
  }

  return complaints.sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());
}

function createSyntheticComplaint({
  ward,
  category,
  maxDaysAgo,
  resolvedProbability,
  severityMin = 1,
}) {
  const locality = getLocalityByWard(ward);
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

  const coords = jitterCoord(locality);
  const severity = severityMin > 1
    ? Math.max(severityMin, Math.floor(Math.random() * (6 - severityMin)) + severityMin)
    : randomSeverity();

  return {
    id: generateId(),
    ward,
    locality: locality.locality,
    category,
    severity,
    reportedAt: reportedAt.toISOString(),
    resolved,
    daysOpen,
    lat: coords.lat,
    lng: coords.lng,
    source: randomSource(),
    description: syntheticDescription(category, locality.locality),
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

function randomWard() {
  return Math.floor(Math.random() * localities.length) + 1;
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
