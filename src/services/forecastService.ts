export function forecastNext7Days(dailyCounts: number[]): number[] {
  if (dailyCounts.length === 0) return Array(7).fill(0);
  if (dailyCounts.length < 7) {
    const avg = dailyCounts.reduce((a, b) => a + b, 0) / dailyCounts.length;
    return Array(7).fill(Math.round(avg));
  }

  const alpha = 0.35;
  const forecasts: number[] = [];

  let smoothedValue = dailyCounts[0];

  for (let i = 1; i < dailyCounts.length; i++) {
    smoothedValue = alpha * dailyCounts[i] + (1 - alpha) * smoothedValue;
  }

  const lastSmoothed = smoothedValue;

  for (let day = 0; day < 7; day++) {
    forecasts.push(Math.round(lastSmoothed + day * 0.05 * lastSmoothed));
  }

  return forecasts;
}

export function computeDailyCounts(dates: Date[]): { date: string; count: number }[] {
  const countMap = new Map<string, number>();
  dates.forEach((d) => {
    const dateStr = d.toISOString().split('T')[0];
    countMap.set(dateStr, (countMap.get(dateStr) || 0) + 1);
  });

  const sortedEntries = Array.from(countMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  return sortedEntries.map(([date, count]) => ({ date, count }));
}

export function forecastNextWeekFromComplaints(complaintDates: Date[]): number[] {
  const dailyData = computeDailyCounts(complaintDates);
  const counts = dailyData.map((d) => d.count);
  return forecastNext7Days(counts);
}
