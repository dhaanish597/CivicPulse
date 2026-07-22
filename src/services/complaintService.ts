import { AgentTrace, Complaint } from '../types';
import { cacheEvidenceUrl, uploadEvidence } from './verificationService';

export interface CreateComplaintInput {
  textNote: string;
  photoFile?: File | null;
  category?: Complaint['category'];
  severity?: Complaint['severity'];
  reasoning?: string;
  ward?: number;
  locality?: string;
  lat?: number;
  lng?: number;
  source?: Complaint['source'];
}

export interface CreateComplaintResponse {
  complaint: Complaint;
  trace: AgentTrace[];
  duplicateOf?: string;
  recommendation?: string;
}

/**
 * `options.timeoutMs` (Round 2 Task 4, Step 7 — ROUND2.md §4.1): bounds how
 * long this waits on a possibly cold-starting backend (Render's free tier
 * can take ~50s to wake). Callers that have a static snapshot fallback to
 * fall back to (App.tsx) pass a short timeout so the UI can honestly switch
 * to "Showing cached data" instead of hanging; callers with no such fallback
 * can omit it to wait indefinitely, unchanged from pre-Task-4 behavior.
 */
export async function fetchComplaints(
  params: { ward?: number; circle?: string; resolved?: boolean; since?: string } = {},
  options: { timeoutMs?: number } = {},
): Promise<Complaint[]> {
  const search = new URLSearchParams();
  if (params.circle) search.set('circle', params.circle);
  if (params.ward) search.set('ward', String(params.ward));
  if (params.resolved !== undefined) search.set('resolved', String(params.resolved));
  if (params.since) search.set('since', params.since);

  const controller = options.timeoutMs ? new AbortController() : undefined;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), options.timeoutMs) : undefined;

  try {
    const response = await fetch(
      `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/complaints${search.toString() ? `?${search}` : ''}`,
      { signal: controller?.signal },
    );
    if (!response.ok) throw new Error('Unable to load complaints.');

    const data = await response.json();
    return data.map(normalizeComplaint);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

export async function createComplaint(input: CreateComplaintInput): Promise<CreateComplaintResponse> {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/complaints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      textNote: input.textNote,
      image: input.photoFile ? await fileToImagePayload(input.photoFile) : null,
      category: input.category,
      severity: input.severity,
      reasoning: input.reasoning,
      ward: input.ward,
      locality: input.locality,
      lat: input.lat,
      lng: input.lng,
      source: input.source ?? 'Citizen App',
    }),
  });

  if (!response.ok) {
    const error = await readError(response);
    throw new Error(error || 'Unable to submit complaint.');
  }

  const data = await response.json();
  const complaint = normalizeComplaint(data.complaint);

  // Task 2's /verify contract requires a stored 'intake' evidence row to
  // exist (server/index.mjs), but the original complaint-creation flow
  // (this function) never wrote one — it sends the photo as inline base64
  // in the JSON body above, not through the evidence endpoint. Task 2's own
  // report flagged this as an unresolved gap ("Also flagging" in
  // task-2-report.md Step 4). Closing it here, using only the given
  // POST .../evidence contract: if a photo was submitted, immediately
  // register it as 'intake' evidence too, so the citizen's later
  // verification flow doesn't dead-end on "Intake evidence is required".
  // Best-effort and non-fatal — the complaint itself was already created
  // successfully; a failure here just means verification will need a manual
  // fallback later (surfaced as that endpoint's own 400, not swallowed).
  if (input.photoFile) {
    try {
      const evidence = await uploadEvidence(complaint.id, input.photoFile, 'intake');
      cacheEvidenceUrl(complaint.id, 'intake', evidence.imageUrl);
    } catch (error) {
      console.error('Unable to register intake evidence photo:', error);
    }
  }

  return {
    complaint,
    trace: Array.isArray(data.trace) ? data.trace.map(normalizeTrace) : [],
    duplicateOf: data.duplicateOf,
    recommendation: data.recommendation,
  };
}

export async function fetchHotspots(limit = 20) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/hotspots?limit=${limit}`);
  if (!response.ok) throw new Error('Unable to load hotspots.');
  return response.json();
}

export async function fetchForecast(ward?: number) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/forecast${ward ? `?ward=${ward}` : ''}`);
  if (!response.ok) throw new Error('Unable to load forecast.');
  return response.json();
}

export async function fetchDispatch(ward?: number, limit = 8): Promise<Complaint[]> {
  const search = new URLSearchParams({ limit: String(limit) });
  if (ward) search.set('ward', String(ward));

  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/dispatch?${search}`);
  if (!response.ok) throw new Error('Unable to load dispatch list.');

  const data = await response.json();
  return data.map(normalizeComplaint);
}

export async function fetchNearbyIssues(lat: number, lng: number, radiusKm = 2): Promise<Complaint[]> {
  const search = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius_km: String(radiusKm),
  });

  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/nearby?${search}`);
  if (!response.ok) throw new Error('Unable to load nearby issues.');

  const data = await response.json();
  return data.map(normalizeComplaint);
}

/**
 * Thrown by updateComplaintStatus() specifically for the 409 an officer hits
 * trying to close a complaint without a 'verified' verdict (server/index.mjs
 * PATCH /api/complaints/:id/status). Carries the response's exact
 * `verification_status` field (snake_case in the wire body, per Task 2's
 * contract) so callers can explain *why* rather than showing a bare error.
 */
export class StatusUpdateError extends Error {
  status: number;
  verificationStatus?: string;

  constructor(message: string, status: number, verificationStatus?: string) {
    super(message);
    this.name = 'StatusUpdateError';
    this.status = status;
    this.verificationStatus = verificationStatus;
  }
}

export async function updateComplaintStatus(id: string, status: string, note?: string): Promise<Complaint> {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/complaints/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, note }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new StatusUpdateError(
      typeof data.error === 'string' ? data.error : 'Unable to update status.',
      response.status,
      data.verification_status,
    );
  }

  return normalizeComplaint(data);
}

export function normalizeComplaint(raw: Record<string, unknown>): Complaint {
  const reportedAt = raw.reportedAt instanceof Date
    ? raw.reportedAt
    : new Date(String(raw.reportedAt ?? raw.reported_at));

  return {
    id: String(raw.id),
    ward: Number(raw.ward),
    locality: String(raw.locality ?? raw.address ?? `Ward ${raw.ward}`),
    category: raw.category as Complaint['category'],
    severity: Number(raw.severity) as Complaint['severity'],
    reportedAt,
    resolved: Boolean(raw.resolved),
    daysOpen: Number(raw.daysOpen ?? raw.days_open ?? 0),
    lat: Number(raw.lat),
    lng: Number(raw.lng),
    source: raw.source as Complaint['source'],
    address: String(raw.address ?? raw.locality ?? ''),
    description: raw.description ? String(raw.description) : undefined,
    reasoning: raw.reasoning ? String(raw.reasoning) : undefined,
    distanceKm: raw.distanceKm === undefined ? undefined : Number(raw.distanceKm),
    urgency: raw.urgency === undefined ? undefined : Number(raw.urgency),
    zone: raw.zone ? String(raw.zone) : undefined,
    circle: raw.circle ? String(raw.circle) : undefined,
    wardName: raw.wardName ? String(raw.wardName) : (raw.ward_name ? String(raw.ward_name) : undefined),
    status: (raw.status as Complaint['status']) ?? undefined,
    lead: raw.lead ? String(raw.lead) : undefined,
    statusUpdatedAt: raw.statusUpdatedAt
      ? String(raw.statusUpdatedAt)
      : (raw.status_updated_at ? String(raw.status_updated_at) : undefined),
    verificationStatus: (raw.verificationStatus as Complaint['verificationStatus'])
      ?? (raw.verification_status as Complaint['verificationStatus'])
      ?? undefined,
    verificationReasoning: raw.verificationReasoning
      ? String(raw.verificationReasoning)
      : (raw.verification_reasoning ? String(raw.verification_reasoning) : undefined),
    verifiedAt: raw.verifiedAt
      ? String(raw.verifiedAt)
      : (raw.verified_at ? String(raw.verified_at) : undefined),
  };
}

function normalizeTrace(raw: Record<string, unknown>): AgentTrace {
  return {
    id: String(raw.id),
    complaintId: String(raw.complaintId ?? raw.complaint_id),
    stepName: String(raw.stepName ?? raw.step_name),
    stepOrder: Number(raw.stepOrder ?? raw.step_order),
    detail: String(raw.detail),
    createdAt: new Date(String(raw.createdAt ?? raw.created_at)),
  };
}

function fileToImagePayload(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const data = result.includes(',') ? result.split(',')[1] : result;
      resolve({ data, mimeType: file.type || 'image/jpeg' });
    };
    reader.readAsDataURL(file);
  });
}

async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return typeof data.error === 'string' ? data.error : '';
  } catch {
    return response.statusText;
  }
}
