import { computeDailyCounts, forecastNext7Days } from '../analytics.mjs';

export function runForecastAnalysis(complaints, ward) {
  const wardComplaints = complaints.filter((complaint) => complaint.ward === ward);
  const dailyCounts = computeDailyCounts(wardComplaints.map((complaint) => complaint.reportedAt));
  const forecast = forecastNext7Days(dailyCounts.map((day) => day.count));
  const expected = forecast.reduce((sum, value) => sum + value, 0);

  return {
    dailyCounts,
    forecast,
    expected,
    detail: `Ward ${ward} forecast expects ${expected} complaints over the next 7 days.`,
  };
}
