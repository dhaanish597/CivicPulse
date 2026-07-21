import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, ChevronDown, ChevronUp, Lightbulb, ShieldOff, TrendingUp } from 'lucide-react';
import { Complaint } from '../types';
import { detectHotspots, getTopHotspotWard, computeDailyCounts, forecastNext7Days, fetchVerificationStats, VerificationStats } from '../services';
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

  // City Admin already receives `complaints` as a prop from App.tsx (no
  // ward/circle filter for this role — see App.tsx's fetchComplaints() call),
  // so this stat is the only thing on the page that needs its own fetch —
  // there's no existing prop chain carrying verification-stats down from
  // App.tsx, and threading one through solely for this single self-contained
  // number would be more plumbing than the stat is worth (Task 3 brief §5).
  const [stats, setStats] = useState<VerificationStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState('');
  const [showUnverifiedList, setShowUnverifiedList] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setStatsLoading(true);
    fetchVerificationStats()
      .then((data) => {
        if (isMounted) {
          setStats(data);
          setStatsError('');
        }
      })
      .catch(() => {
        if (isMounted) setStatsError('Unable to load verification stats.');
      })
      .finally(() => {
        if (isMounted) setStatsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // GET /api/verification-stats returns citywide counts with no time
  // dimension (Task 2's fixed contract — no "last N days" breakdown exists
  // server-side). The brief's copy suggested framing this as a 30-day
  // window; rather than inventing a new endpoint to support one, this uses
  // the honest all-time figure the given endpoint actually provides — see
  // task-3-report.md "Concerns" for the full note on this wording choice.
  //
  // Fix round 1 (Finding 1): `closedCount` must only include verification
  // statuses that actually correspond to a CLOSED (status === 'resolved')
  // complaint. Tracing server/agents/verificationAgent.mjs: a 'disputed'
  // verdict explicitly reopens the complaint to status 'in_progress', and an
  // 'inconclusive' verdict leaves status untouched (typically still
  // 'resolution_claimed') — neither is closed. Only 'verified' (the real
  // adjudicated-and-closed case) and 'unverified' (the legacy pre-verification
  // backfill bucket, also status 'resolved') correspond to a closed complaint
  // — confirmed by the 409 gate on PATCH /:id/status, which only allows
  // status 'resolved' when verification_status === 'verified' (plus the
  // one-time migration backfill that set 'unverified' on already-resolved
  // rows). Previously this summed in disputed + inconclusive too, which
  // mislabeled open/reopened/pending complaints as "closures."
  const closedCount = stats ? stats.counts.verified + stats.counts.unverified : 0;
  const unverifiedPct = stats && closedCount > 0
    ? Math.round((stats.counts.unverified / closedCount) * 100)
    : null;
  const unverifiedCount = stats?.counts.unverified ?? 0;
  // disputed_rate (server/db.mjs#getVerificationStats) = disputed / (verified
  // + disputed) — i.e., of complaints whose claimed resolution reached a
  // verified-or-disputed VERDICT, what fraction ended in dispute. Disputed
  // complaints are reopened, not closed (see closedCount above), so the prior
  // caption "% of verified closures were disputed" was self-contradictory —
  // 'verified' and 'disputed' are mutually exclusive terminal verdicts, a
  // complaint can never be both. Captioned below to describe what the metric
  // actually measures instead.
  const disputedRatePct = stats ? Math.round(stats.disputed_rate * 100) : 0;

  const unverifiedComplaints = useMemo(
    () => complaints.filter((c) => c.verificationStatus === 'unverified'),
    [complaints]
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {statsLoading ? (
        <div className="bg-brand-navy rounded-3xl p-8 sm:p-10 animate-pulse">
          <div className="h-3 w-40 bg-white/10 rounded mb-4" />
          <div className="h-16 w-64 bg-white/10 rounded mb-3" />
          <div className="h-3 w-56 bg-white/10 rounded" />
        </div>
      ) : statsError || unverifiedPct === null ? (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 flex items-center gap-4">
          <div className="p-3 bg-gray-50 rounded-xl">
            <ShieldOff className="text-gray-400" size={28} />
          </div>
          <div>
            <p className="font-semibold text-brand-navy">Verification stats unavailable</p>
            <p className="text-sm text-gray-500 mt-1">{statsError || 'No closures have been recorded yet.'}</p>
          </div>
        </div>
      ) : (
        <div className="bg-brand-navy rounded-3xl shadow-lg overflow-hidden text-white">
          <div className="p-8 sm:p-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50 mb-4">Verification Integrity</p>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-6xl sm:text-7xl font-bold leading-none tabular-nums">{unverifiedPct}%</span>
              <span className="text-lg sm:text-xl text-white/85 max-w-md leading-snug">
                of closed complaints were never independently verified
              </span>
            </div>
            <p className="text-sm text-white/50 mt-5">
              {unverifiedCount.toLocaleString()} of {closedCount.toLocaleString()} closures citywide have no counter-evidence on file
              {disputedRatePct > 0 && ` · ${disputedRatePct}% of adjudicated verifications ended in dispute`}
            </p>
            <button
              type="button"
              onClick={() => setShowUnverifiedList((v) => !v)}
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
            >
              {showUnverifiedList ? 'Hide' : 'View'} unverified complaints
              {showUnverifiedList ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>

          {showUnverifiedList && (
            <div className="bg-white text-brand-navy px-6 sm:px-10 py-5 border-t border-white/10">
              {unverifiedComplaints.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">
                  None of the complaints currently loaded in this view are unverified.
                </p>
              ) : (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                    {unverifiedComplaints.length} unverified closure{unverifiedComplaints.length === 1 ? '' : 's'}
                  </p>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {unverifiedComplaints.slice(0, 8).map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-3 text-sm border-b border-gray-50 pb-2">
                        <div className="min-w-0">
                          <span className="font-medium text-brand-navy">{c.category}</span>
                          <span className="text-gray-400"> · Ward {c.ward}{c.wardName ? ` (${c.wardName})` : ''}</span>
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">{c.id}</span>
                      </div>
                    ))}
                  </div>
                  {unverifiedComplaints.length > 8 && (
                    <p className="text-xs text-gray-400 mt-3">and {unverifiedComplaints.length - 8} more...</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

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
