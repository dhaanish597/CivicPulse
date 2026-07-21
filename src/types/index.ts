export type Category =
  | 'Garbage Overflow'
  | 'Pothole / Road Damage'
  | 'Water Leakage'
  | 'Streetlight Outage'
  | 'Drainage Blockage'
  | 'Stray Animal Hazard';

export type Source = 'Citizen App' | 'Telegram' | 'Call Center';

export interface Complaint {
  id: string;
  ward: number;
  locality: string;
  category: Category;
  severity: 1 | 2 | 3 | 4 | 5;
  reportedAt: Date;
  resolved: boolean;
  daysOpen: number;
  lat: number;
  lng: number;
  source: Source;
  address: string;
  description?: string;
  reasoning?: string;
  distanceKm?: number;
  urgency?: number;
  /** Real GHMC administrative overlay (server/data/ghmc_wards.json), when loaded. */
  zone?: string;
  circle?: string;
  wardName?: string;
}

export interface HotspotGroup {
  ward: number;
  category: Category;
  count: number;
  avgSeverity: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolsUsed?: string[];
}

export interface AgentTrace {
  id: string;
  complaintId: string;
  stepName: string;
  stepOrder: number;
  detail: string;
  createdAt: Date;
}

export interface UserLocation {
  lat: number;
  lng: number;
  ward?: number;
  locality?: string;
  label: string;
  source: 'geolocation' | 'manual';
}
