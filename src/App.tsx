import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
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
import { fetchComplaints } from './services';

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

  useEffect(() => {
    if (!roleSession) return;

    let isMounted = true;
    const params = roleSession.role === 'officer' && roleSession.circle
      ? { circle: roleSession.circle }
      : roleSession.role === 'officer' && roleSession.ward
        ? { ward: roleSession.ward }
        : {};

    setIsLoadingComplaints(true);
    fetchComplaints(params)
      .then((data) => {
        if (!isMounted) return;
        setComplaints(data);
        setLoadError('');
      })
      .catch(() => {
        if (!isMounted) return;
        setLoadError('Unable to load complaints from the shared backend.');
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
        return <CityAdmin complaints={complaints} />;
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
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-brand-teal rounded-lg">
                <Building2 size={24} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-brand-navy">CivicPulse</h1>
                <p className="text-xs text-gray-500">AI Decision Intelligence</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-700">
                  {roleLabel(roleSession)}
                </p>
                <p className="text-xs text-gray-500">{complaints.length} complaints tracked</p>
              </div>
              <button
                type="button"
                onClick={resetRole}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
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
              <span>Wards: 20</span>
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

export default App;
