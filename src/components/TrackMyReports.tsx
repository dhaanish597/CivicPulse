import React, { useEffect, useState } from 'react';
import { Clock, CheckCircle, ArrowRight, Loader } from 'lucide-react';

interface TrackedReport {
  id: string;
  locality: string;
  category: string;
  submittedAt: string;
}

interface ReportDetails {
  id: string;
  status: string;
  lead: string;
  status_events: Array<{ status: string; actor: string; createdAt: string }>;
}

export const TrackMyReports: React.FC = () => {
  const [reports, setReports] = useState<TrackedReport[]>([]);
  const [details, setDetails] = useState<Record<string, ReportDetails>>({});
  const [loading, setLoading] = useState(false);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const stored = JSON.parse(localStorage.getItem('civicpulse_my_reports') || '[]');
      setReports(stored);

      const detailsMap: Record<string, ReportDetails> = {};
      for (const r of stored) {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/complaints/${r.id}`);
        if (res.ok) {
          detailsMap[r.id] = await res.json();
        }
      }
      setDetails(detailsMap);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  if (reports.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center mt-12">
        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-100 shadow-sm">
          <Clock className="text-gray-400" size={32} />
        </div>
        <h3 className="text-xl font-medium text-brand-navy mb-2">No active reports</h3>
        <p className="text-gray-500">Reports you submit will appear here so you can track their progress.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <h2 className="text-2xl font-semibold text-brand-navy">Track My Reports</h2>
        <button onClick={fetchReports} className="text-sm font-medium text-brand-teal flex items-center gap-2 hover:bg-teal-50 px-4 py-2 rounded-lg transition-colors">
          {loading ? <Loader className="animate-spin" size={16} /> : <Clock size={16} />}
          Refresh Status
        </button>
      </div>

      <div className="space-y-4">
        {reports.map(r => {
          const detail = details[r.id];
          if (!detail) return null;

          return (
            <div key={r.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden transition-all hover:shadow-md">
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{r.id}</span>
                    <h3 className="text-lg font-semibold text-brand-navy mt-1">{r.category}</h3>
                    <p className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                      <span className="w-2 h-2 rounded-full bg-gray-300"></span> {r.locality}
                    </p>
                  </div>
                  <span className={`px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide uppercase ${
                    detail.status === 'resolved' ? 'bg-green-100 text-green-700' :
                    detail.status === 'in_progress' ? 'bg-amber-100 text-amber-700' :
                    detail.status === 'acknowledged' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {detail.status.replace('_', ' ')}
                  </span>
                </div>
                
                {detail.lead && (
                  <div className="bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-100 rounded-xl p-4 mb-5 shadow-inner">
                    <p className="text-sm text-teal-800 flex items-start gap-3">
                      <ArrowRight size={18} className="mt-0.5 shrink-0 text-teal-600" />
                      <span className="leading-relaxed"><strong className="font-semibold text-teal-900">AI Lead: </strong>{detail.lead}</span>
                    </p>
                  </div>
                )}

                <div className="flex gap-0 mt-6 items-center overflow-x-auto pb-2 px-2">
                  {detail.status_events.map((evt, idx) => (
                    <React.Fragment key={evt.createdAt}>
                      <div className="flex flex-col items-center min-w-[80px]">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm z-10 ${
                          detail.status === 'resolved' || idx < detail.status_events.length - 1 ? 'bg-brand-teal text-white' : 'bg-brand-terracotta text-white'
                        }`}>
                          <CheckCircle size={16} strokeWidth={3} />
                        </div>
                        <span className="text-xs font-medium text-gray-600 mt-2 uppercase tracking-wide text-center">{evt.status.replace('_', ' ')}</span>
                      </div>
                      {idx < detail.status_events.length - 1 && (
                        <div className="flex-1 h-1 bg-brand-teal -mt-6 rounded-full mx-[-20px]" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
