import { Complaint, HotspotGroup } from '../types';

export function detectHotspots(complaints: Complaint[], lastNDays: number = 30): HotspotGroup[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lastNDays);

  const recentComplaints = complaints.filter((c) => c.reportedAt >= cutoffDate);

  const grouped = new Map<string, { ward: number; category: string; count: number; totalSeverity: number }>();

  recentComplaints.forEach((complaint) => {
    const key = `${complaint.ward}-${complaint.category}`;

    if (grouped.has(key)) {
      const existing = grouped.get(key)!;
      existing.count += 1;
      existing.totalSeverity += complaint.severity;
    } else {
      grouped.set(key, {
        ward: complaint.ward,
        category: complaint.category,
        count: 1,
        totalSeverity: complaint.severity,
      });
    }
  });

  const hotspots: HotspotGroup[] = [];

  grouped.forEach((value) => {
    hotspots.push({
      ward: value.ward,
      category: value.category as HotspotGroup['category'],
      count: value.count,
      avgSeverity: parseFloat((value.totalSeverity / value.count).toFixed(2)),
    });
  });

  return hotspots.sort((a, b) => b.count - a.count);
}

export function getTopHotspotWard(hotspots: HotspotGroup[]): { ward: number; total: number } {
  const wardCounts = new Map<number, number>();

  hotspots.forEach((h) => {
    wardCounts.set(h.ward, (wardCounts.get(h.ward) || 0) + h.count);
  });

  let topWard = 1;
  let topCount = 0;

  wardCounts.forEach((count, ward) => {
    if (count > topCount) {
      topWard = ward;
      topCount = count;
    }
  });

  return { ward: topWard, total: topCount };
}

export function getWardHotspotBreakdown(hotspots: HotspotGroup[], wardNumber: number): HotspotGroup[] {
  return hotspots.filter((h) => h.ward === wardNumber);
}
