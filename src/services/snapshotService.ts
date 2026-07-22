import { Complaint, HotspotGroup } from '../types';
import { normalizeComplaint } from './complaintService';
import { VerificationStats } from './verificationService';

export interface SnapshotData {
  generatedAt: string;
  source: 'seeded-db' | 'fallback-empty';
  totalComplaintsInDb: number;
  complaints: Complaint[];
  hotspots: HotspotGroup[];
  verificationStats: VerificationStats;
}

const EMPTY_VERIFICATION_STATS: VerificationStats = {
  counts: {
    not_required: 0,
    awaiting_proof: 0,
    verified: 0,
    disputed: 0,
    inconclusive: 0,
    unverified: 0,
  },
  disputed_rate: 0,
  unverified_legacy_count: 0,
};

/**
 * Loads the static `public/snapshot.json` fallback (Round 2 Task 4, Step 7 —
 * ROUND2.md §4.1), generated at build time by `npm run snapshot`
 * (scripts/generate-snapshot.mjs). This is a same-origin static asset served
 * by whatever's hosting the built frontend (Vite's `public/` dir) — it never
 * depends on the backend being reachable at all, which is the entire point:
 * it's what the app renders while the backend is cold-starting (Render's
 * free tier can take ~50s to wake) or if it never responds.
 *
 * Returns null on any failure (missing file, bad JSON, network error) — the
 * caller (App.tsx) already has its own pre-Task-4 loading/error handling for
 * a snapshot-less world, so a null here just means "behave as if Task 4's
 * fallback path doesn't exist," never a thrown error.
 */
export async function loadSnapshot(): Promise<SnapshotData | null> {
  try {
    const response = await fetch('/snapshot.json');
    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data?.complaints)) return null;

    return {
      generatedAt: String(data.generatedAt ?? ''),
      source: data.source === 'fallback-empty' ? 'fallback-empty' : 'seeded-db',
      totalComplaintsInDb: Number(data.totalComplaintsInDb ?? data.complaints.length),
      complaints: data.complaints.map(normalizeComplaint),
      hotspots: Array.isArray(data.hotspots) ? (data.hotspots as HotspotGroup[]) : [],
      verificationStats: data.verificationStats ?? EMPTY_VERIFICATION_STATS,
    };
  } catch {
    return null;
  }
}
