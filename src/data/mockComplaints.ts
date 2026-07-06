import { Complaint, Category, Source } from '../types';
import { getLocalityByWard, hyderabadLocalities } from './hyderabadLocalities';

const categories: Category[] = [
  'Garbage Overflow',
  'Pothole / Road Damage',
  'Water Leakage',
  'Streetlight Outage',
  'Drainage Blockage',
  'Stray Animal Hazard',
];

const sources: Source[] = ['Citizen App', 'Telegram', 'Call Center'];

function generateId(): string {
  return `CMP-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`.toUpperCase();
}

function randomSeverity(): 1 | 2 | 3 | 4 | 5 {
  const weights = [0.1, 0.15, 0.3, 0.3, 0.15];
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (r < cumulative) return (i + 1) as 1 | 2 | 3 | 4 | 5;
  }
  return 3;
}

function randomWard(): number {
  return Math.floor(Math.random() * hyderabadLocalities.length) + 1;
}

function randomCategory(): Category {
  return categories[Math.floor(Math.random() * categories.length)];
}

function randomSource(): Source {
  return sources[Math.floor(Math.random() * sources.length)];
}

function randomDaysAgo(maxDays: number, skewRecent: boolean = true): number {
  const r = Math.random();
  if (skewRecent) {
    const skewed = Math.pow(r, 1.8);
    return Math.floor(skewed * maxDays);
  }
  return Math.floor(r * maxDays);
}

function jitterCoord(ward: number): { lat: number; lng: number } {
  const locality = getLocalityByWard(ward);
  const latJitter = (Math.random() - 0.5) * 0.01;
  const lngJitter = (Math.random() - 0.5) * 0.01;
  return {
    lat: parseFloat((locality.lat + latJitter).toFixed(6)),
    lng: parseFloat((locality.lng + lngJitter).toFixed(6)),
  };
}

export function generateMockComplaints(count: number = 300): Complaint[] {
  const complaints: Complaint[] = [];

  for (let i = 0; i < count; i++) {
    const daysAgo = randomDaysAgo(60, true);
    const reportedAt = new Date();
    reportedAt.setDate(reportedAt.getDate() - daysAgo);
    reportedAt.setHours(Math.floor(Math.random() * 24));
    reportedAt.setMinutes(Math.floor(Math.random() * 60));

    const resolved = Math.random() < 0.75;
    let daysOpen: number;
    if (resolved) {
      daysOpen = Math.floor(Math.random() * Math.min(daysAgo, 10)) + 1;
    } else {
      daysOpen = daysAgo + 1;
    }

    const ward = randomWard();
    const category = randomCategory();
    const locality = getLocalityByWard(ward);
    const coords = jitterCoord(ward);

    complaints.push({
      id: generateId(),
      ward,
      locality: locality.locality,
      category,
      severity: randomSeverity(),
      reportedAt,
      resolved,
      daysOpen,
      lat: coords.lat,
      lng: coords.lng,
      source: randomSource(),
      address: locality.locality,
    });
  }

  for (let i = 0; i < 35; i++) {
    const daysAgo = randomDaysAgo(30, true);
    const reportedAt = new Date();
    reportedAt.setDate(reportedAt.getDate() - daysAgo);
    reportedAt.setHours(Math.floor(Math.random() * 24));
    reportedAt.setMinutes(Math.floor(Math.random() * 60));

    const resolved = Math.random() < 0.6;
    let daysOpen: number;
    if (resolved) {
      daysOpen = Math.floor(Math.random() * Math.min(daysAgo, 15)) + 1;
    } else {
      daysOpen = daysAgo + 1;
    }

    const locality = getLocalityByWard(8);
    const coords = jitterCoord(8);

    complaints.push({
      id: generateId(),
      ward: 8,
      locality: locality.locality,
      category: 'Garbage Overflow',
      severity: (Math.floor(Math.random() * 3) + 3) as 3 | 4 | 5,
      reportedAt,
      resolved,
      daysOpen,
      lat: coords.lat,
      lng: coords.lng,
      source: randomSource(),
      address: locality.locality,
    });
  }

  complaints.sort((a, b) => b.reportedAt.getTime() - a.reportedAt.getTime());

  return complaints;
}

export const mockComplaints = generateMockComplaints(300);
