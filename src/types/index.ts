export type Category =
  | 'Garbage Overflow'
  | 'Pothole / Road Damage'
  | 'Water Leakage'
  | 'Streetlight Outage'
  | 'Drainage Blockage'
  | 'Stray Animal Hazard';

export type Source = 'Citizen App' | 'Telegram' | 'Call Center';

/**
 * Lifecycle status of a complaint (server/db.mjs#rowToComplaint, Round 2
 * Task 2). 'resolution_claimed' sits between 'in_progress' and 'resolved' —
 * an officer has uploaded proof but the citizen hasn't verified it yet, and
 * the officer can no longer close the complaint directly (see
 * verificationStatus / the 409 gate on PATCH /api/complaints/:id/status).
 */
export type ComplaintStatus =
  | 'reported'
  | 'acknowledged'
  | 'in_progress'
  | 'resolution_claimed'
  | 'resolved';

/**
 * Verification-agent adjudication state (Round 2 Task 2). 'not_required'
 * means the complaint was never claimed resolved; 'awaiting_proof' means an
 * officer claimed resolution but no verdict has been reached yet;
 * 'unverified' is the legacy-backfill value for complaints resolved before
 * this verification system existed.
 */
export type VerificationStatus =
  | 'not_required'
  | 'awaiting_proof'
  | 'verified'
  | 'disputed'
  | 'inconclusive'
  | 'unverified';

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
  /** Workflow status — see ComplaintStatus. Optional because a few callers
   *  (e.g. forecast/hotspot summaries) construct partial Complaint-shaped
   *  objects that never carry a status. */
  status?: ComplaintStatus;
  /** AI-generated recommended next action for the assigned officer. */
  lead?: string;
  statusUpdatedAt?: string;
  verificationStatus?: VerificationStatus;
  verificationReasoning?: string;
  verifiedAt?: string;
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

/** Kinds accepted by POST /api/complaints/:id/evidence (server/index.mjs EVIDENCE_KINDS). */
export type EvidenceKind = 'intake' | 'officer_proof' | 'citizen_proof';

/** A single verdict the verificationAgent can reach — never fabricated, see server/agents/verificationAgent.mjs. */
export type VerificationVerdict = 'verified' | 'disputed' | 'inconclusive';

export interface EvidenceRecord {
  id: string;
  complaintId: string;
  kind: EvidenceKind;
  /** Relative path returned by the API, e.g. /uploads/EVD-XXXX.png. */
  imagePath: string;
  /** Fully-qualified URL (VITE_API_BASE_URL + imagePath) ready for an <img src>. */
  imageUrl: string;
  submittedBy: string;
  createdAt: string;
}
