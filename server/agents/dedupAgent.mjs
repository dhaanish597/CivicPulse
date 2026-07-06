import { haversineKm } from '../analytics.mjs';
import { listComplaints } from '../db.mjs';

const DUPLICATE_RADIUS_KM = 0.15;
const DUPLICATE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export function runDeduplication(candidate) {
  const cutoffTime = Date.now() - DUPLICATE_WINDOW_MS;
  const duplicates = listComplaints({ resolved: false })
    .filter((complaint) => complaint.category === candidate.category)
    .map((complaint) => ({
      complaint,
      distanceKm: haversineKm(candidate, complaint),
    }))
    .filter(({ complaint, distanceKm }) => (
      distanceKm <= DUPLICATE_RADIUS_KM
      && new Date(complaint.reportedAt).getTime() >= cutoffTime
    ))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const match = duplicates[0];
  if (!match) {
    return {
      duplicate: null,
      detail: 'No open complaint of the same category found within 150m in the last 3 days.',
    };
  }

  return {
    duplicate: match.complaint,
    detail: `Likely duplicate of ${match.complaint.id}, ${Math.round(match.distanceKm * 1000)}m away in ${match.complaint.locality}.`,
  };
}
