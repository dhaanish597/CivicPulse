export function runRecommendation({ candidate, hotspot, forecast, urgency }) {
  const hotspotCount = hotspot.candidateHotspot?.count ?? 0;
  const expected = forecast.expected ?? 0;
  const urgencyScore = urgency.urgency ?? 0;

  if (hotspotCount >= 10 || urgencyScore >= 55) {
    return `Ward ${candidate.ward} (${candidate.locality}) is under elevated pressure for ${candidate.category}; dispatch an extra crew and review this cluster today.`;
  }

  if (expected >= 20) {
    return `Ward ${candidate.ward} (${candidate.locality}) is forecast to receive ${expected} complaints this week; schedule preventive maintenance capacity.`;
  }

  if (candidate.severity >= 4) {
    return `Prioritize inspection in Ward ${candidate.ward} (${candidate.locality}) because this ${candidate.category} report has severity ${candidate.severity}.`;
  }

  return `Queue this ${candidate.category} report for normal ward operations in Ward ${candidate.ward} (${candidate.locality}).`;
}
