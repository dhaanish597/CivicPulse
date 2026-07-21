import { EvidenceKind, EvidenceRecord, VerificationVerdict } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173';

/**
 * Thrown for any non-2xx response from the verification endpoints, carrying
 * the server's exact `error` message and HTTP status so callers can render
 * it directly (rather than a generic "something went wrong") — this matters
 * specifically for the documented 400s: "Verification requires the
 * citizen's counter-evidence photo..." and "Intake evidence is required
 * before verification."
 */
export class VerificationApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'VerificationApiError';
    this.status = status;
  }
}

export interface VerifyResult {
  verdict: VerificationVerdict;
  confidence: number;
  reasoning: string;
  newStatus: string;
}

export interface VerificationStats {
  counts: {
    not_required: number;
    awaiting_proof: number;
    verified: number;
    disputed: number;
    inconclusive: number;
    unverified: number;
  };
  disputed_rate: number;
  unverified_legacy_count: number;
}

/** Builds a full image URL from the API-relative path the same way the rest of this codebase builds other API-relative URLs (VITE_API_BASE_URL + path). */
export function buildEvidenceUrl(imagePath: string | undefined | null): string {
  if (!imagePath) return '';
  return imagePath.startsWith('http') ? imagePath : `${API_BASE}${imagePath}`;
}

export async function uploadEvidence(complaintId: string, file: File, kind: EvidenceKind): Promise<EvidenceRecord> {
  const form = new FormData();
  form.append('image', file);
  form.append('kind', kind);

  const response = await fetch(`${API_BASE}/api/complaints/${complaintId}/evidence`, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    throw new VerificationApiError(await readError(response), response.status);
  }

  const data = await response.json();
  const record: EvidenceRecord = {
    id: String(data.id),
    complaintId,
    kind: data.kind,
    imagePath: data.imagePath,
    imageUrl: buildEvidenceUrl(data.imagePath),
    submittedBy: data.submittedBy,
    createdAt: data.createdAt,
  };

  cacheEvidenceUrl(complaintId, kind, record.imageUrl);
  return record;
}

/** POST /api/complaints/:id/verify — no body. 400s if citizen_proof (or intake) evidence is missing; see VerificationApiError. */
export async function verifyResolution(complaintId: string): Promise<VerifyResult> {
  const response = await fetch(`${API_BASE}/api/complaints/${complaintId}/verify`, { method: 'POST' });

  if (!response.ok) {
    throw new VerificationApiError(await readError(response), response.status);
  }

  return response.json();
}

export async function fetchVerificationStats(): Promise<VerificationStats> {
  const response = await fetch(`${API_BASE}/api/verification-stats`);
  if (!response.ok) throw new Error('Unable to load verification stats.');
  return response.json();
}

/**
 * GET /api/complaints/:id/evidence (Fix round 1, Finding 2) — the real,
 * server-backed source of a complaint's evidence photos. Returns every
 * evidence row for the complaint, oldest to newest, same per-row shape as
 * POST .../evidence's response. Unlike the localStorage cache below, this
 * works from a fresh page load or a completely different browser/device,
 * since it reads the `evidence` table directly rather than only what this
 * browser happened to upload or receive.
 */
export async function fetchEvidence(complaintId: string): Promise<EvidenceRecord[]> {
  const response = await fetch(`${API_BASE}/api/complaints/${complaintId}/evidence`);
  if (!response.ok) {
    throw new VerificationApiError(await readError(response), response.status);
  }

  const rows: Array<{ id: string | number; kind: EvidenceKind; imagePath: string; submittedBy: string; createdAt: string }> = await response.json();

  return rows.map((row) => ({
    id: String(row.id),
    complaintId,
    kind: row.kind,
    imagePath: row.imagePath,
    imageUrl: buildEvidenceUrl(row.imagePath),
    submittedBy: row.submittedBy,
    createdAt: row.createdAt,
  }));
}

/** Reduces a list of evidence records (oldest-to-newest, as fetchEvidence returns) to the latest image URL per kind — what every VerificationPanel caller actually wants. */
export function pickLatestEvidenceByKind(records: EvidenceRecord[]): Partial<Record<EvidenceKind, string>> {
  const result: Partial<Record<EvidenceKind, string>> = {};
  for (const record of records) {
    result[record.kind] = record.imageUrl;
  }
  return result;
}

async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return typeof data.error === 'string' ? data.error : `Request failed (${response.status}).`;
  } catch {
    return response.statusText || `Request failed (${response.status}).`;
  }
}

// --- Client-side evidence URL cache ----------------------------------------
//
// Task 2's endpoint contracts (fixed, "consume as given" per the Task 3
// brief) include POST .../evidence but no GET .../evidence — there is no way
// to list a complaint's evidence photos from the server. Evidence URLs are
// only ever returned as the response of the upload call that created them.
// This demo runs the citizen/officer/admin views from the SAME browser
// (RoleContext's "Switch Role", not separate devices/sessions), so a small
// localStorage cache lets a component that DIDN'T make the original upload
// (e.g. TrackMyReports looking up the officer's proof photo, or
// OfficerLeadsBoard looking up the citizen's original intake photo) still
// resolve an image URL after a role switch or page reload, without
// inventing a new backend contract. This is a deliberate, flagged
// workaround, not a silent stub — see task-3-report.md "Concerns".
const CACHE_KEY = 'civicpulse_evidence_cache';

type EvidenceUrlCache = Record<string, Partial<Record<EvidenceKind, string>>>;

function readCache(): EvidenceUrlCache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function cacheEvidenceUrl(complaintId: string, kind: EvidenceKind, url: string): void {
  if (!url) return;
  const cache = readCache();
  cache[complaintId] = { ...cache[complaintId], [kind]: url };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function getCachedEvidenceUrls(complaintId: string): Partial<Record<EvidenceKind, string>> {
  return readCache()[complaintId] ?? {};
}
