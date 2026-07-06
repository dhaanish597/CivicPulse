export type Category =
  | 'Garbage Overflow'
  | 'Pothole / Road Damage'
  | 'Water Leakage'
  | 'Streetlight Outage'
  | 'Drainage Blockage'
  | 'Stray Animal Hazard';

export type Source = 'Citizen App' | 'WhatsApp' | 'Call Center';

export interface Complaint {
  id: string;
  ward: number;
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
}
