import React, { useState } from 'react';
import { Map, MapPin, Navigation, AlertTriangle, Loader2 } from 'lucide-react';
import { hyderabadLocalities } from '../data/hyderabadLocalities';
import { MapView } from './MapView';

interface RouteResult {
  route: { points: [number, number][] };
  riskScore: 'green' | 'amber' | 'red';
  flaggedComplaints: any[];
  advisory: string;
  alternativeRouteIndex?: number;
  alternativeRoutes?: { points: [number, number][] }[];
}

export const RoutePlanner: React.FC = () => {
  const [originStr, setOriginStr] = useState('');
  const [destStr, setDestStr] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [error, setError] = useState('');

  const handleCheck = async () => {
    if (!originStr || !destStr) return;
    setLoading(true);
    setError('');
    
    const oLoc = hyderabadLocalities.find(l => l.locality === originStr);
    const dLoc = hyderabadLocalities.find(l => l.locality === destStr);
    
    if (!oLoc || !dLoc) {
      setError('Please select valid localities');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/route-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originLat: oLoc.lat,
          originLng: oLoc.lng,
          destLat: dLoc.lat,
          destLng: dLoc.lng
        })
      });
      if (!res.ok) throw new Error('Routing service unavailable. Please try again.');
      const data = await res.json();
      setResult(data);
    } catch {
      // Task 6 fix: this previously rendered `e.message` verbatim, which for
      // a plain network failure (offline, CORS, backend unreachable) is a
      // raw browser string like "Failed to fetch" — never shown to the user
      // per ROUND2.md §8 ("never render an error string where prose
      // should be"). A fixed, honest message covers both the !res.ok case
      // above and any network-level exception.
      setError('Routing service unavailable right now. Please try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  const getRiskColor = (score: string) => {
    switch (score) {
      case 'red': return '#E85D4C';
      case 'amber': return '#F2994A';
      case 'green': return '#0E5C56';
      default: return '#3388ff';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <Map size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-brand-navy">Route Advisor</h2>
              <p className="text-xs text-gray-500 mt-1">AI-guided hazard avoidance</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Origin</label>
              <select 
                className="w-full p-2 border border-gray-200 rounded-lg shadow-sm focus:ring-[#0E5C56] focus:border-brand-teal outline-none"
                value={originStr}
                onChange={e => setOriginStr(e.target.value)}
              >
                <option value="">Select starting point...</option>
                {hyderabadLocalities.map(l => (
                  <option key={l.ward} value={l.locality}>{l.locality}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Destination</label>
              <select 
                className="w-full p-2 border border-gray-200 rounded-lg shadow-sm focus:ring-[#0E5C56] focus:border-brand-teal outline-none"
                value={destStr}
                onChange={e => setDestStr(e.target.value)}
              >
                <option value="">Select destination...</option>
                {hyderabadLocalities.map(l => (
                  <option key={l.ward} value={l.locality}>{l.locality}</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleCheck}
              disabled={loading || !originStr || !destStr}
              className={`w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-medium transition-all ${
                loading || !originStr || !destStr ? 'bg-gray-100 text-gray-400' : 'bg-brand-teal text-white hover:bg-[#0a4a45] shadow-sm'
              }`}
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Navigation size={18} />}
              Check Route
            </button>
            {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
          </div>
        </div>

        {result && (
          <div className={`bg-white rounded-2xl p-6 shadow-sm border-2 ${
            result.riskScore === 'red' ? 'border-red-100 bg-red-50/30' : 
            result.riskScore === 'amber' ? 'border-amber-100 bg-amber-50/30' : 'border-green-100 bg-green-50/30'
          }`}>
            <div className="flex items-start gap-3">
              <AlertTriangle className={`mt-0.5 shrink-0 ${
                result.riskScore === 'red' ? 'text-red-500' : 
                result.riskScore === 'amber' ? 'text-amber-500' : 'text-green-500'
              }`} size={20} />
              <div>
                <h3 className="font-bold text-brand-navy">AI Advisory</h3>
                <p className="text-sm text-gray-700 mt-2 leading-relaxed">{result.advisory}</p>
                {result.flaggedComplaints.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                     <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Hazards on Route</p>
                     <ul className="space-y-2">
                       {result.flaggedComplaints.slice(0, 3).map((c: any) => (
                         <li key={c.id} className="text-sm text-gray-700 flex items-center gap-2">
                           <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                           {c.category} ({c.locality})
                         </li>
                       ))}
                       {result.flaggedComplaints.length > 3 && (
                         <li className="text-xs text-gray-400 italic">+{result.flaggedComplaints.length - 3} more</li>
                       )}
                     </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="lg:col-span-2 bg-white p-2 rounded-2xl shadow-sm border border-gray-100 min-h-[500px]">
        {result ? (
          <MapView 
            complaints={result.flaggedComplaints} 
            route={result.route} 
            routeColor={getRiskColor(result.riskScore)}
            height="500px" 
          />
        ) : (
          <div className="w-full h-full bg-gray-50 rounded-xl flex items-center justify-center border-2 border-dashed border-gray-200" style={{ height: '500px' }}>
             <div className="text-center">
               <MapPin className="mx-auto text-gray-300 mb-3" size={48} />
               <p className="text-gray-500 font-medium">Select origin and destination to preview your route</p>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};
