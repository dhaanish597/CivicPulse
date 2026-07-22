import { useEffect, useRef, useState } from 'react';
import { Building2, CloudOff, RadioTower } from 'lucide-react';
import { Complaint, UserLocation } from './types';
import { Tab, TabBar, TabKey } from './components/TabBar';
import { ReportIssue } from './components/ReportIssue';
import { WardDashboard } from './components/WardDashboard';
import { TrackMyReports } from './components/TrackMyReports';
import { RoutePlanner } from './components/RoutePlanner';
import { CityAdmin } from './components/CityAdmin';
import { RoleSelect } from './components/RoleSelect';
import { LocalIssuesMap } from './components/LocalIssuesMap';
import { RoleProvider, RoleSession, useRole } from './context/RoleContext';
import { fetchComplaints, loadSnapshot, SnapshotData } from './services';
import { LIVE_FETCH_TIMEOUT_MS } from './config';

type DataBadgeState = 'snapshot' | 'live' | 'cached' | null;

const allTabs: Tab[] = [
  { key: 'nearme', label: 'Local Map' },
  { key: 'report', label: 'Report an Issue' },
  { key: 'track', label: 'My Reports' },
  { key: 'route', label: 'Route Advisor' },
  { key: 'ward', label: 'Ward Dashboard' },
  { key: 'admin', label: 'City Admin' },
];

function App() {
  return (
    <RoleProvider>
      <AppShell />
    </RoleProvider>
  );
}

function AppShell() {
  const { roleSession, setRoleSession, resetRole } = useRole();
  const [activeTab, setActiveTab] = useState<TabKey>('ward');
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [isLoadingComplaints, setIsLoadingComplaints] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Round 2 Task 4, Step 7 (ROUND2.md §4.1) — snapshot-first render. `snapshot`
  // drives CityAdmin's verification-stats fallback prop below; `snapshotRef`
  // lets the live-fetch effect read the latest snapshot without needing it as
  // a dependency (avoiding a second live fetch firing merely because the
  // snapshot happened to finish loading after the live one started).
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const snapshotRef = useRef<SnapshotData | null>(null);
  const liveDataLoadedRef = useRef(false);
  const [dataBadge, setDataBadge] = useState<DataBadgeState>(null);

  // Loads the static snapshot once, independent of role/tab — a same-origin
  // static asset, so this never waits on the (possibly cold-starting)
  // backend. If the live fetch below hasn't already succeeded by the time
  // this resolves, show the snapshot immediately instead of a bare spinner.
  useEffect(() => {
    let isMounted = true;
    loadSnapshot().then((data) => {
      if (!isMounted || !data) return;
      snapshotRef.current = data;
      setSnapshot(data);
      if (!liveDataLoadedRef.current) {
        setComplaints(data.complaints);
        setIsLoadingComplaints(false);
        setDataBadge('snapshot');
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!roleSession) return;

    let isMounted = true;
    const params = roleSession.role === 'officer' && roleSession.circle
      ? { circle: roleSession.circle }
      : roleSession.role === 'officer' && roleSession.ward
        ? { ward: roleSession.ward }
        : {};

    if (snapshotRef.current) {
      // Snapshot already loaded — render it now instead of a spinner while
      // the live request (possibly against a cold-starting backend) is in flight.
      setComplaints(snapshotRef.current.complaints);
      setIsLoadingComplaints(false);
      setDataBadge('snapshot');
    } else {
      setIsLoadingComplaints(true);
    }

    fetchComplaints(params, { timeoutMs: LIVE_FETCH_TIMEOUT_MS })
      .then((data) => {
        if (!isMounted) return;
        liveDataLoadedRef.current = true;
        setComplaints(data);
        setLoadError('');
        setDataBadge('live');
      })
      .catch(() => {
        if (!isMounted) return;
        if (snapshotRef.current) {
          // Live fetch failed or timed out — the snapshot data is still on
          // screen (or gets applied by the snapshot effect above once it
          // resolves), just relabel it honestly rather than showing a blank
          // screen or an error banner (ROUND2.md §4.1).
          setDataBadge('cached');
        } else {
          setLoadError('Unable to load complaints from the shared backend.');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingComplaints(false);
      });

    return () => {
      isMounted = false;
    };
  }, [roleSession]);

  const handleNewComplaint = (complaint: Complaint) => {
    setComplaints((prev) => (
      prev.some((item) => item.id === complaint.id)
        ? prev.map((item) => (item.id === complaint.id ? complaint : item))
        : [complaint, ...prev]
    ));
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'nearme':
        return (
          <LocalIssuesMap 
            userLocation={userLocation}
            onLocationChange={setUserLocation}
          />
        );
      case 'report':
        return (
          <ReportIssue
            onSubmit={handleNewComplaint}
            userLocation={userLocation}
            onLocationChange={setUserLocation}
          />
        );
      case 'track':
        return <TrackMyReports />;
      case 'route':
        return <RoutePlanner />;
      case 'ward':
        return <WardDashboard complaints={complaints} userLocation={userLocation} circle={roleSession?.circle} />;
      case 'admin':
        return <CityAdmin complaints={complaints} snapshotVerificationStats={snapshot?.verificationStats ?? null} />;
      default:
        return null;
    }
  };

  const handleRoleSelect = (session: RoleSession) => {
    setRoleSession(session);
    setActiveTab(defaultTabForRole(session.role));
  };

  if (!roleSession) {
    return <RoleSelect onSelect={handleRoleSelect} />;
  }

  const visibleTabs = tabsForRole(roleSession.role);

  return (
    <div className="min-h-screen bg-[#FAFBFB]">
      {/*
        Task 6 fix: this row used to be `items-center justify-between h-16`
        with no wrap allowed. At mobile widths (~390px) the left block (logo +
        "CivicPulse" + "AI Decision Intelligence" + DataSourceBadge) and the
        right block (role label + "N complaints tracked" + Switch Role) don't
        fit on one line — the text wrapped inside its own column but the
        fixed h-16 height didn't grow to match, so the extra lines spilled
        out of the header and visually overlapped whatever rendered directly
        below it (confirmed live: on City Admin's cold-open screen, the
        header text overlapped the "VERIFICATION INTEGRITY" hero stat).
        Fixed two ways: (1) the row is now `flex-wrap` with `min-h` instead
        of a fixed `h-16`, so if it ever does need two lines it grows instead
        of clipping; (2) the purely decorative subtitle and the "complaints
        tracked" counter (duplicated context — every screen already shows
        this data) are hidden below the `sm` breakpoint so the common case
        fits on one line again without wrapping at all.
      */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-1 min-h-16 py-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-brand-teal rounded-lg shrink-0">
                <Building2 size={24} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-brand-navy leading-tight">CivicPulse</h1>
                <p className="text-xs text-gray-500 hidden sm:block">AI Decision Intelligence</p>
              </div>
              <DataSourceBadge state={dataBadge} />
            </div>
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-700 leading-tight">
                  {roleLabel(roleSession)}
                </p>
                <p className="text-xs text-gray-500 hidden sm:block">{complaints.length} complaints tracked</p>
              </div>
              <button
                type="button"
                onClick={resetRole}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 shrink-0"
              >
                Switch Role
              </button>
            </div>
          </div>
        </div>
      </header>

      <TabBar activeTab={activeTab} onTabChange={setActiveTab} tabs={visibleTabs} />

      <main>
        {isLoadingComplaints ? (
          <div className="max-w-7xl mx-auto px-4 py-12 text-center text-gray-500">
            Loading shared complaint data...
          </div>
        ) : loadError ? (
          <div className="max-w-7xl mx-auto px-4 py-12">
            <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-4">
              {loadError}
            </div>
          </div>
        ) : (
          renderContent()
        )}
      </main>

      <footer className="bg-white border-t border-gray-200 mt-8 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-gray-500">
              CivicPulse - Municipal Civic Operations Intelligence
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-400">
              {/* Task 6 fix: was "Wards: 20", which reads as a citywide
                  total and contradicts the real ~149 GHMC wards cited
                  elsewhere in the app (ROUND2.md §1.1) — see the matching
                  fix note in CityAdmin.tsx. This "20" is the legacy demo
                  map's locality count, not a GHMC figure; relabelled to say
                  so instead of removing context entirely. */}
              <span>Demo map localities: 20</span>
              <span>Categories: 6</span>
              <span>Sources: 3</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function tabsForRole(role: RoleSession['role']): Tab[] {
  if (role === 'citizen') return allTabs.filter((tab) => ['nearme', 'report', 'track', 'route'].includes(tab.key));
  if (role === 'officer') return allTabs.filter((tab) => tab.key === 'ward');
  return allTabs;
}

function defaultTabForRole(role: RoleSession['role']): TabKey {
  if (role === 'citizen') return 'nearme';
  if (role === 'officer') return 'ward';
  return 'admin';
}

function roleLabel(session: RoleSession): string {
  if (session.role === 'citizen') return `${session.name} · Citizen`;
  if (session.role === 'officer') {
    return session.circle
      ? `${session.name} · Circle ${session.circle} Officer`
      : `${session.name} · Ward ${session.ward} Officer`;
  }
  return `${session.name} · City Admin`;
}

/**
 * Round 2 Task 4, Step 7 (ROUND2.md §4.1): an honest, small indicator of
 * where the data on screen came from — never a blank screen or a bare
 * spinner while the live API is still loading (or unreachable). Renders
 * nothing once live data has actually loaded (dataBadge === 'live') or
 * before any snapshot/live signal exists yet (dataBadge === null).
 */
function DataSourceBadge({ state }: { state: DataBadgeState }) {
  if (state === 'snapshot') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full">
        <RadioTower size={12} className="animate-pulse" />
        Live data loading…
      </span>
    );
  }

  if (state === 'cached') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-full">
        <CloudOff size={12} />
        Showing cached data
      </span>
    );
  }

  return null;
}

export default App;
