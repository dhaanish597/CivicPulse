import { Complaint } from '../types';

export function scoreUrgency(complaint: Complaint, recurrenceCount: number = 0): number {
  const severityComponent = complaint.severity * 8;
  const daysComponent = Math.min(complaint.daysOpen, 30) * 2;
  const recurrenceComponent = recurrenceCount * 1.5;

  return parseFloat((severityComponent + daysComponent + recurrenceComponent).toFixed(2));
}

export function sortComplaintsByUrgency(
  complaints: Complaint[],
  recurrenceMap: Map<string, number> = new Map()
): Complaint[] {
  return [...complaints]
    .sort((a, b) => {
      const urgencyA = scoreUrgency(a, recurrenceMap.get(`${a.ward}-${a.category}`) || 0);
      const urgencyB = scoreUrgency(b, recurrenceMap.get(`${b.ward}-${b.category}`) || 0);
      return urgencyB - urgencyA;
    });
}

export function computeRecurrenceCounts(complaints: Complaint[]): Map<string, number> {
  const map = new Map<string, number>();
  complaints.forEach((c) => {
    const key = `${c.ward}-${c.category}`;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}
