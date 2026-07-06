import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { Complaint } from './types';
import { mockComplaints } from './data/mockComplaints';
import { TabBar } from './components/TabBar';
import { ReportIssue } from './components/ReportIssue';
import { WardDashboard } from './components/WardDashboard';
import { CityAdmin } from './components/CityAdmin';

type TabKey = 'report' | 'ward' | 'admin';

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('ward');
  const [complaints, setComplaints] = useState<Complaint[]>(mockComplaints);

  const handleNewComplaint = (complaint: Complaint) => {
    setComplaints((prev) => [complaint, ...prev]);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'report':
        return <ReportIssue onSubmit={handleNewComplaint} />;
      case 'ward':
        return <WardDashboard complaints={complaints} />;
      case 'admin':
        return <CityAdmin complaints={complaints} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFBFB]">
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#0E5C56] rounded-lg">
                <Building2 size={24} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">CivicPulse</h1>
                <p className="text-xs text-gray-500">AI Decision Intelligence</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-700">City Operations</p>
                <p className="text-xs text-gray-500">{complaints.length} complaints tracked</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      <main>
        {renderContent()}
      </main>

      <footer className="bg-white border-t border-gray-200 mt-8 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-gray-500">
              CivicPulse - Municipal Civic Operations Intelligence
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-400">
              <span>Wards: 12</span>
              <span>Categories: 6</span>
              <span>Sources: 3</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
