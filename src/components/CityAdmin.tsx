import React, { useMemo } from 'react';
import { TrendingUp, Calendar, AlertTriangle, Lightbulb } from 'lucide-react';
import { Complaint } from '../types';
import { detectHotspots, getTopHotspotWard, computeDailyCounts, forecastNext7Days } from '../services';
import { KPICard } from './KPICard';
import { HotspotBarChart } from './HotspotBarChart';
import { MapView } from './MapView';

interface CityAdminProps {
  complaints: Complaint[];
}

export const CityAdmin: React.FC<CityAdminProps> = ({ complaints }) => {
  const openComplaints = useMemo(
    () => complaints.filter((c) => !c.resolved),
    [complaints]
  );
  const resolvedComplaints = useMemo(
    () => complaints.filter((c) => c.resolved),
    [complaints]
  );
  const wardsMonitored = useMemo(
    () => new Set(complaints.map((c) => c.ward)).size,
    [complaints]
  );
  const avgDaysToResolve = useMemo(() => {
    if (resolvedComplaints.length === 0) return 0;
    return (
      resolvedComplaints.reduce((sum, c) => sum + c.daysOpen, 0) / resolvedComplaints.length
    ).toFixed(1);
  }, [resolvedComplaints]);

  const hotspots = useMemo(() => detectHotspots(complaints, 30), [complaints]);
  const topWard = useMemo(() => getTopHotspotWard(hotspots), [hotspots]);

  const wardForecasts = useMemo(() => {
    const forecasts: Record<number, number> = {};
    const wardCounts = new Map<number, Complaint[]>();

    complaints.forEach((c) => {
      if (!wardCounts.has(c.ward)) {
        wardCounts.set(c.ward, []);
      }
      wardCounts.get(c.ward)!.push(c);
    });

    wardCounts.forEach((wardComplaints, ward) => {
      const dailyCounts = computeDailyCounts(wardComplaints.map((c) => c.reportedAt));
      const forecast = forecastNext7Days(dailyCounts.map((d) => d.count));
      const totalForecast = forecast.reduce((sum, val) => sum + val, 0);
      forecasts[ward] = totalForecast;
    });

    return forecasts;
  }, [complaints]);

  const sortedWards = useMemo(
    () =>
      Object.entries(wardForecasts)
        .map(([ward, forecast]) => ({
          ward: parseInt(ward),
          forecast,
        }))
        .sort((a, b) => b.forecast - a.forecast),
    [wardForecasts]
  );

  const weekForecast = sortedWards[0];
  const weekForecast2 = sortedWards[1];
  const recommendedCrews = Math.min(Math.ceil((weekForecast?.forecast || 0) / 8), 5);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard
          title="Total Open Issues"
          value={openComplaints.length}
          subtitle={`${resolvedComplaints.length} resolved`}
          icon="alert"
          accentColor="#E85D4C"
        />
        <KPICard
          title="Wards Monitored"
          value={wardsMonitored}
          subtitle="of 20 city wards"
          icon="map"
          accentColor="#1F3A5F"
        />
        <KPICard
          title="Avg. Days to Resolve"
          value={`${avgDaysToResolve}`}
          subtitle="resolution time"
          icon="clock"
          accentColor="#F2994A"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <HotspotBarChart hotspots={hotspots} topN={10} />
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb size={20} className="text-[#F2994A]" />
              <h3 className="text-lg font-semibold text-brand-navy">Resource Allocation</h3>
            </div>
            <div className="bg-gradient-to-r from-[#FAFBFB] to-[#F0F5F5] rounded-lg p-4 border border-gray-100">
              <div className="flex items-center gap-3 mb-3">
                <TrendingUp size={24} className="text-brand-terracotta" />
                <div>
                  <p className="text-sm text-gray-600">Priority Ward</p>
                  <p className="text-xl font-bold text-brand-teal">Ward {weekForecast?.ward || topWard.ward}</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                <strong>Recommendation:</strong> Reroute{' '}
                <span className="font-bold text-brand-terracotta">{recommendedCrews} cleanup crews</span>{' '}
                to Ward {weekForecast?.ward || topWard.ward} this week. Expected{' '}
                <span className="font-medium">{weekForecast?.forecast || 0}</span> new complaints.
              </p>
              {weekForecast2 && (
                <p className="text-xs text-gray-500 mt-3">
                  Secondary priority: Ward {weekForecast2.ward} ({weekForecast2.forecast} expected)
                </p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={20} className="text-brand-terracotta" />
              <h3 className="text-lg font-semibold text-brand-navy">Critical Alerts</h3>
            </div>
            <div className="space-y-3">
              {hotspots.slice(0, 3).map((h, idx) => (
                <div
                  key={`${h.ward}-${h.category}`}
                  className="flex items-center gap-3 text-sm"
                >
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                      idx === 0 ? 'bg-brand-terracotta' : idx === 1 ? 'bg-[#F2994A]' : 'bg-[#1F3A5F]'
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <div className="flex-1">
                    <span className="font-medium text-brand-navy">Ward {h.ward}</span>
                    <span className="text-gray-500"> - {h.category}</span>
                  </div>
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded">{h.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <Calendar size={20} className="text-brand-teal" />
          <h3 className="font-semibold text-brand-navy">Citywide Complaint Map</h3>
          <span className="text-xs text-gray-400 ml-auto">Open complaints and 30-day ward intensity</span>
        </div>
        <MapView complaints={complaints} height="360px" />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={20} className="text-brand-teal" />
          <h3 className="font-semibold text-brand-navy">Weekly Forecast by Ward</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {sortedWards.map(({ ward, forecast }) => {
            const wardTotal = complaints.filter((c) => c.ward === ward).length;
            const wardOpen = complaints.filter((c) => c.ward === ward && !c.resolved).length;
            return (
              <div
                key={ward}
                className={`p-3 rounded-lg border ${
                  ward === (weekForecast?.ward || topWard.ward)
                    ? 'border-[#E85D4C] bg-red-50'
                    : 'border-gray-100 bg-gray-50'
                }`}
              >
                <div className="font-medium text-brand-navy">Ward {ward}</div>
                <div className="text-2xl font-bold text-brand-teal mt-1">{forecast}</div>
                <div className="text-xs text-gray-500">{wardOpen} open / {wardTotal} total</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
