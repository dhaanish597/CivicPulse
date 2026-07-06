import { computeRecurrenceCounts, scoreUrgency } from '../analytics.mjs';

export function runUrgencyAnalysis(complaints, candidate) {
  const recurrenceMap = computeRecurrenceCounts(complaints);
  const recurrenceCount = recurrenceMap.get(`${candidate.ward}-${candidate.category}`) ?? 0;
  const urgency = scoreUrgency(candidate, recurrenceCount);

  return {
    urgency,
    recurrenceCount,
    detail: `Urgency score ${urgency} from severity ${candidate.severity}, ${candidate.daysOpen} day open, and ${recurrenceCount} recurring ward/category complaints.`,
  };
}
