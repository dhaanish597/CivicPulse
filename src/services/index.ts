export { classifyComplaint } from './classificationService';
export {
  createComplaint,
  fetchComplaints,
  fetchDispatch,
  fetchForecast,
  fetchHotspots,
  fetchNearbyIssues,
  normalizeComplaint,
  updateComplaintStatus,
  StatusUpdateError,
} from './complaintService';
export { scoreUrgency, sortComplaintsByUrgency, computeRecurrenceCounts } from './urgencyService';
export { forecastNext7Days, computeDailyCounts, forecastNextWeekFromComplaints } from './forecastService';
export { detectHotspots, getTopHotspotWard, getWardHotspotBreakdown } from './hotspotService';
export { answerQuestion } from './chatService';
export {
  VerificationApiError,
  buildEvidenceUrl,
  cacheEvidenceUrl,
  fetchEvidence,
  fetchVerificationStats,
  getCachedEvidenceUrls,
  pickLatestEvidenceByKind,
  uploadEvidence,
  verifyResolution,
} from './verificationService';
export type { VerificationStats, VerifyResult } from './verificationService';
