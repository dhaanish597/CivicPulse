export function detectHotspots(complaints, lastNDays = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lastNDays);

  const recentComplaints = complaints.filter((complaint) => new Date(complaint.reportedAt) >= cutoffDate);
  const grouped = new Map();

  recentComplaints.forEach((complaint) => {
    const key = `${complaint.ward}-${complaint.category}`;
    const existing = grouped.get(key) ?? {
      ward: complaint.ward,
      locality: complaint.locality,
      category: complaint.category,
      count: 0,
      totalSeverity: 0,
    };

    existing.count += 1;
    existing.totalSeverity += complaint.severity;
    grouped.set(key, existing);
  });

  return Array.from(grouped.values())
    .map((value) => ({
      ward: value.ward,
      locality: value.locality,
      category: value.category,
      count: value.count,
      avgSeverity: round(value.totalSeverity / value.count),
    }))
    .sort((a, b) => b.count - a.count);
}

export function forecastNext7Days(dailyCounts) {
  if (dailyCounts.length === 0) return Array(7).fill(0);
  if (dailyCounts.length < 7) {
    const avg = dailyCounts.reduce((a, b) => a + b, 0) / dailyCounts.length;
    return Array(7).fill(Math.round(avg));
  }

  const alpha = 0.35;
  let smoothedValue = dailyCounts[0];

  for (let i = 1; i < dailyCounts.length; i += 1) {
    smoothedValue = alpha * dailyCounts[i] + (1 - alpha) * smoothedValue;
  }

  return Array.from({ length: 7 }, (_, day) => Math.round(smoothedValue + day * 0.05 * smoothedValue));
}

export function computeDailyCounts(dates) {
  const countMap = new Map();

  dates.forEach((date) => {
    const dateStr = new Date(date).toISOString().split('T')[0];
    countMap.set(dateStr, (countMap.get(dateStr) ?? 0) + 1);
  });

  return Array.from(countMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

export function computeRecurrenceCounts(complaints) {
  const map = new Map();

  complaints.forEach((complaint) => {
    const key = `${complaint.ward}-${complaint.category}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  });

  return map;
}

export function scoreUrgency(complaint, recurrenceCount = 0) {
  const severityComponent = complaint.severity * 8;
  const daysComponent = Math.min(complaint.daysOpen, 30) * 2;
  const recurrenceComponent = recurrenceCount * 1.5;
  return round(severityComponent + daysComponent + recurrenceComponent);
}

export function sortComplaintsByUrgency(complaints, recurrenceMap = new Map()) {
  return [...complaints].sort((a, b) => {
    const urgencyA = scoreUrgency(a, recurrenceMap.get(`${a.ward}-${a.category}`) ?? 0);
    const urgencyB = scoreUrgency(b, recurrenceMap.get(`${b.ward}-${b.category}`) ?? 0);
    return urgencyB - urgencyA;
  });
}

export function haversineKm(a, b) {
  const radiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const value = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return radiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function getNearbyIssues(complaints, lat, lng, radiusKm = 2) {
  const origin = { lat: Number(lat), lng: Number(lng) };

  return complaints
    .filter((complaint) => !complaint.resolved)
    .map((complaint) => ({
      ...complaint,
      distanceKm: round(haversineKm(origin, complaint)),
    }))
    .filter((complaint) => complaint.distanceKm <= Number(radiusKm))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export function buildDispatchList(complaints, limit = 8) {
  const openComplaints = complaints.filter((complaint) => !complaint.resolved);
  const recurrenceMap = computeRecurrenceCounts(complaints);

  return sortComplaintsByUrgency(openComplaints, recurrenceMap)
    .slice(0, limit)
    .map((complaint) => ({
      ...complaint,
      urgency: scoreUrgency(complaint, recurrenceMap.get(`${complaint.ward}-${complaint.category}`) ?? 0),
    }));
}

export function buildWardSummary(complaints, ward) {
  const scopedComplaints = ward ? complaints.filter((complaint) => complaint.ward === Number(ward)) : complaints;
  const byCategory = new Map();

  scopedComplaints.forEach((complaint) => {
    const stats = byCategory.get(complaint.category) ?? {
      category: complaint.category,
      total: 0,
      open: 0,
      severity: 0,
    };

    stats.total += 1;
    stats.open += complaint.resolved ? 0 : 1;
    stats.severity += complaint.severity;
    byCategory.set(complaint.category, stats);
  });

  return {
    ward: ward ? Number(ward) : null,
    total: scopedComplaints.length,
    open: scopedComplaints.filter((complaint) => !complaint.resolved).length,
    categories: Array.from(byCategory.values()).map((stats) => ({
      category: stats.category,
      total: stats.total,
      open: stats.open,
      resolved: stats.total - stats.open,
      avgSeverity: round(stats.severity / stats.total),
    })),
  };
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function round(value) {
  return Number(value.toFixed(2));
}
