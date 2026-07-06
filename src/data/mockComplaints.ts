import { Complaint, Category, Source } from '../types';

const categories: Category[] = [
  'Garbage Overflow',
  'Pothole / Road Damage',
  'Water Leakage',
  'Streetlight Outage',
  'Drainage Blockage',
  'Stray Animal Hazard',
];

const sources: Source[] = ['Citizen App', 'WhatsApp', 'Call Center'];

const wardAddresses: Record<number, string> = {
  1: 'Hill View Colony, Ward 1',
  2: 'Lake Gardens, Ward 2',
  3: 'Industrial Area, Ward 3',
  4: 'Green Park Extension, Ward 4',
  5: 'Old City Market, Ward 5',
  6: 'Riverside Heights, Ward 6',
  7: 'Tech Park Layout, Ward 7',
  8: 'Central Transit Hub, Ward 8',
  9: 'University Campus Area, Ward 9',
  10: 'Sports Complex Zone, Ward 10',
  11: 'Residential Sector East, Ward 11',
  12: 'Harbor Approach Road, Ward 12',
};

const BASE_LAT = 12.9716;
const BASE_LNG = 77.5946;

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
  return Math.floor(Math.random() * 12) + 1;
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

function jitterCoord(): { lat: number; lng: number } {
  const latJitter = (Math.random() - 0.5) * 0.08;
  const lngJitter = (Math.random() - 0.5) * 0.08;
  return {
    lat: parseFloat((BASE_LAT + latJitter).toFixed(6)),
    lng: parseFloat((BASE_LNG + lngJitter).toFixed(6)),
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
    const coords = jitterCoord();

    complaints.push({
      id: generateId(),
      ward,
      category,
      severity: randomSeverity(),
      reportedAt,
      resolved,
      daysOpen,
      lat: coords.lat,
      lng: coords.lng,
      source: randomSource(),
      address: wardAddresses[ward],
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

    const coords = jitterCoord();

    complaints.push({
      id: generateId(),
      ward: 8,
      category: 'Garbage Overflow',
      severity: (Math.floor(Math.random() * 3) + 3) as 3 | 4 | 5,
      reportedAt,
      resolved,
      daysOpen,
      lat: coords.lat,
      lng: coords.lng,
      source: randomSource(),
      address: wardAddresses[8],
    });
  }

  complaints.sort((a, b) => b.reportedAt.getTime() - a.reportedAt.getTime());

  return complaints;
}

export const mockComplaints = generateMockComplaints(300);
