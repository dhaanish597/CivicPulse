import { buildDispatchList } from '../analytics.mjs';
import { insertAgentTrace, insertComplaint, listComplaints, insertStatusEvent } from '../db.mjs';
import { generateId } from '../utils.mjs';
import { runClassification } from './classificationAgent.mjs';
import { runDeduplication } from './dedupAgent.mjs';
import { runForecastAnalysis } from './forecastAgent.mjs';
import { runHotspotAnalysis } from './hotspotAgent.mjs';
import { runIngestion } from './ingestionAgent.mjs';
import { runRecommendation } from './recommendationAgent.mjs';
import { runUrgencyAnalysis } from './urgencyAgent.mjs';

const stepNames = [
  'Ingestion',
  'Classification',
  'Dedup',
  'Hotspot',
  'Forecast',
  'Urgency',
  'Recommendation',
];

export async function runPipeline(complaintInput) {
  const candidateId = generateId('CMP');
  const trace = [];

  const ingested = runIngestion(complaintInput);
  addTrace(trace, 'Ingestion', `Accepted ${ingested.source} report for Ward ${ingested.ward} (${ingested.locality}) with ${ingested.image ? 'photo' : 'text-only'} evidence.`);

  const classification = await runClassification(ingested, candidateId);
  addTrace(
    trace,
    'Classification',
    `${classification.category}, severity ${classification.severity}. ${classification.reasoning}${classification.fallback ? ' (fallback)' : ''}`,
  );

  const candidate = {
    id: candidateId,
    ...ingested,
    category: classification.category,
    severity: classification.severity,
    reasoning: classification.reasoning,
    reportedAt: new Date().toISOString(),
    resolved: false,
    daysOpen: 1,
  };

  const dedup = runDeduplication(candidate);
  addTrace(trace, 'Dedup', dedup.detail);

  const analyticsComplaint = dedup.duplicate ?? candidate;
  const analyticsComplaints = dedup.duplicate ? listComplaints() : [candidate, ...listComplaints()];

  const hotspot = runHotspotAnalysis(analyticsComplaints, analyticsComplaint);
  addTrace(trace, 'Hotspot', hotspot.detail);

  const forecast = runForecastAnalysis(analyticsComplaints, analyticsComplaint.ward);
  addTrace(trace, 'Forecast', forecast.detail);

  const urgency = runUrgencyAnalysis(analyticsComplaints, analyticsComplaint);
  addTrace(trace, 'Urgency', urgency.detail);

  const recommendation = runRecommendation({
    candidate: analyticsComplaint,
    hotspot,
    forecast,
    urgency,
  });
  addTrace(trace, 'Recommendation', recommendation);

  candidate.lead = recommendation;

  const complaint = dedup.duplicate ?? insertComplaint(candidate);

  if (!dedup.duplicate) {
    insertStatusEvent({
      id: generateId('EVT'),
      complaintId: complaint.id,
      status: 'reported',
      actor: 'agent',
    });
  }

  const storedTrace = trace.map((item) => insertAgentTrace({ ...item, complaintId: complaint.id }));
  const dispatchPreview = buildDispatchList(listComplaints({ ward: complaint.ward }), 3);

  return {
    complaint,
    trace: storedTrace,
    duplicateOf: dedup.duplicate?.id,
    recommendation,
    dispatchPreview,
  };
}

function addTrace(trace, stepName, detail) {
  trace.push({
    id: generateId('TRC'),
    complaintId: '',
    stepName,
    stepOrder: stepNames.indexOf(stepName) + 1,
    detail,
    createdAt: new Date().toISOString(),
  });
}
