import { detectHotspots } from '../analytics.mjs';

export function runHotspotAnalysis(complaints, candidate) {
  const hotspots = detectHotspots(complaints, 30);
  const candidateHotspot = hotspots.find(
    (hotspot) => hotspot.ward === candidate.ward && hotspot.category === candidate.category,
  );

  return {
    hotspots,
    candidateHotspot,
    detail: candidateHotspot
      ? `Ward ${candidateHotspot.ward} ${candidateHotspot.locality} has ${candidateHotspot.count} recent ${candidateHotspot.category} complaints.`
      : `No current 30-day hotspot found for ${candidate.category} in Ward ${candidate.ward}.`,
  };
}
