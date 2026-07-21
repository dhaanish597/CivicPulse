import { AgentTrace, Complaint } from '../types';

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

export async function fetchComplaints(params: { ward?: number; circle?: string; resolved?: boolean; since?: string } = {}): Promise<Complaint[]> {
  const search = new URLSearchParams();
  if (params.circle) search.set('circle', params.circle);
  if (params.ward) search.set('ward', String(params.ward));
  if (params.resolved !== undefined) search.set('resolved', String(params.resolved));
  if (params.since) search.set('since', params.since);

  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/complaints${search.toString() ? `?${search}` : ''}`);
  if (!response.ok) throw new Error('Unable to load complaints.');

  const data = await response.json();
  return data.map(normalizeComplaint);
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
  return {
    complaint: normalizeComplaint(data.complaint),
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

function normalizeComplaint(raw: Record<string, unknown>): Complaint {
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
