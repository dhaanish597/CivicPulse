import React, { useState, useEffect } from 'react';
import { CheckCircle, Activity } from 'lucide-react';
import { Complaint } from '../types';
import { categoryColors } from '../data/categoryColors';

interface OfficerLeadsBoardProps {
  ward: number;
}

interface LeadCardProps {
  complaint: Complaint & { status?: string; lead?: string };
  onStatusUpdate: (id: string, newStatus: string) => void;
}

const LeadCard: React.FC<LeadCardProps> = ({ complaint, onStatusUpdate }) => {
  const [loading, setLoading] = useState(false);

  const getNextAction = (status: string) => {
    switch (status) {
      case 'reported': return { label: 'Acknowledge', next: 'acknowledged', color: 'bg-blue-600 hover:bg-blue-700' };
      case 'acknowledged': return { label: 'Start Work', next: 'in_progress', color: 'bg-amber-600 hover:bg-amber-700' };
      case 'in_progress': return { label: 'Resolve', next: 'resolved', color: 'bg-green-600 hover:bg-green-700' };
      default: return null;
    }
  };

  const action = getNextAction(complaint.status || 'reported');

  const handleAction = async () => {
    if (!action) return;
    setLoading(true);
    await onStatusUpdate(complaint.id, action.next);
    setLoading(false);
  };

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-10 rounded-full" style={{ backgroundColor: categoryColors[complaint.category] }} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-400">{complaint.id}</span>
              <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium shadow-sm" style={{ backgroundColor: categoryColors[complaint.category] }}>
                {complaint.category.split(' ')[0]}
              </span>
            </div>
            <h4 className="font-semibold text-brand-navy mt-1">{complaint.category}</h4>
            <p className="text-xs text-gray-500 mt-0.5">{complaint.address}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-brand-teal">{complaint.severity * 8 + Math.min(complaint.daysOpen, 30) * 2}</div>
          <div className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider">Urgency</div>
        </div>
      </div>

      {complaint.lead && (
        <div className="bg-teal-50 rounded-lg p-3 mt-1 border border-teal-100/50">
          <p className="text-sm text-teal-900 flex items-start gap-2">
            <Activity size={16} className="mt-0.5 text-teal-600 shrink-0" />
            <span><strong className="font-semibold">Agent Lead:</strong> {complaint.lead}</span>
          </p>
        </div>
      )}

      <div className="flex items-center justify-between mt-2 pt-3 border-t border-gray-50">
        <span className="text-xs font-medium text-gray-500 flex items-center gap-1 uppercase tracking-wide">
          Status: <span className="text-brand-navy font-bold ml-1">{complaint.status?.replace('_', ' ') || 'REPORTED'}</span>
        </span>
        {action && (
          <button
            onClick={handleAction}
            disabled={loading}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold text-white shadow-sm transition-all ${action.color} ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {loading ? 'Updating...' : action.label}
          </button>
        )}
      </div>
    </div>
  );
};

export const OfficerLeadsBoard: React.FC<OfficerLeadsBoardProps> = ({ ward }) => {
  const [complaints, setComplaints] = useState<(Complaint & { status?: string; lead?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchComplaints = async () => {
    try {
      const res = await fetch(`/api/complaints?ward=${ward}`);
      if (res.ok) {
        const data = await res.json();
        // Sort by urgency roughly
        const sorted = data.sort((a: any, b: any) => {
          const uA = a.severity * 8 + Math.min(a.daysOpen, 30) * 2;
          const uB = b.severity * 8 + Math.min(b.daysOpen, 30) * 2;
          return uB - uA;
        });
        setComplaints(sorted.filter((c: any) => c.status !== 'resolved'));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComplaints();
  }, [ward]);

  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/complaints/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        const updated = await res.json();
        setComplaints(prev => prev.map(c => c.id === id ? updated : c).filter(c => c.status !== 'resolved'));
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500 animate-pulse">Loading active leads...</div>;
  }

  return (
    <div className="bg-gray-50 rounded-2xl shadow-inner border border-gray-100 overflow-hidden flex flex-col h-[500px]">
      <div className="px-5 py-4 bg-white border-b border-gray-200 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-brand-terracotta p-2 rounded-lg shadow-sm">
            <CheckCircle size={20} className="text-white" />
          </div>
          <div>
            <h3 className="font-bold text-brand-navy leading-tight">AI Resolution Leads</h3>
            <p className="text-xs text-gray-500 font-medium">Ward {ward} active dispatch queue</p>
          </div>
        </div>
        <span className="text-xs bg-gray-900 text-white px-3 py-1 rounded-full font-bold shadow-sm">
          {complaints.length} ACTIVE
        </span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4 relative">
        {complaints.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
             <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mb-4">
               <CheckCircle className="text-green-500" size={32} />
             </div>
             <p className="font-medium text-brand-navy">All caught up!</p>
             <p className="text-sm text-gray-500 mt-1">No active leads for Ward {ward}.</p>
          </div>
        ) : (
          complaints.map(c => (
            <LeadCard key={c.id} complaint={c} onStatusUpdate={handleStatusUpdate} />
          ))
        )}
      </div>
    </div>
  );
};
