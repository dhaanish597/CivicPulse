import React, { useState } from 'react';
import { LocateFixed, Loader2, MapPin, Navigation } from 'lucide-react';
import { Complaint, UserLocation } from '../types';
import { hyderabadLocalities } from '../data/hyderabadLocalities';
import { fetchNearbyIssues } from '../services';
import { categoryColors } from '../data/categoryColors';

interface NearMePanelProps {
  onLocationChange: (location: UserLocation) => void;
}

export const NearMePanel: React.FC<NearMePanelProps> = ({ onLocationChange }) => {
  const [nearbyIssues, setNearbyIssues] = useState<Complaint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showManualFallback, setShowManualFallback] = useState(false);
  const [activeLabel, setActiveLabel] = useState('');

  const showIssuesNearMe = () => {
    setError('');

    if (!navigator.geolocation) {
      setShowManualFallback(true);
      setError('Browser geolocation is not available. Pick a locality instead.');
      return;
    }

    setIsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const location: UserLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: 'Current browser location',
          source: 'geolocation',
        };
        onLocationChange(location);
        setActiveLabel(location.label);
        await loadNearby(location.lat, location.lng);
      },
      () => {
        setIsLoading(false);
        setShowManualFallback(true);
        setError('Location access was denied. Pick a Hyderabad locality instead.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleManualLocality = async (wardValue: string) => {
    const ward = Number(wardValue);
    const locality = hyderabadLocalities.find((item) => item.ward === ward);
    if (!locality) return;

    const location: UserLocation = {
      lat: locality.lat,
      lng: locality.lng,
      ward: locality.ward,
      locality: locality.locality,
      label: `${locality.locality}, Ward ${locality.ward}`,
      source: 'manual',
    };

    setError('');
    onLocationChange(location);
    setActiveLabel(location.label);
    await loadNearby(location.lat, location.lng);
  };

  const loadNearby = async (lat: number, lng: number) => {
    setIsLoading(true);
    try {
      const issues = await fetchNearbyIssues(lat, lng, 2);
      setNearbyIssues(issues);
    } catch {
      setError('Unable to load nearby issues from the backend.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
        <Navigation size={18} className="text-brand-teal" />
        <h3 className="font-semibold text-brand-navy">Issues Near Me</h3>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={showIssuesNearMe}
            disabled={isLoading}
            className={`flex-1 px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
              isLoading
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-brand-teal text-white hover:bg-[#0a4a45]'
            }`}
          >
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <LocateFixed size={18} />}
            Show issues near me
          </button>

          <button
            type="button"
            onClick={() => setShowManualFallback((value) => !value)}
            className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Pick locality
          </button>
        </div>

        {showManualFallback && (
          <select
            onChange={(event) => void handleManualLocality(event.target.value)}
            defaultValue=""
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0E5C56]"
          >
            <option value="" disabled>Select a Hyderabad locality</option>
            {hyderabadLocalities.map((locality) => (
              <option key={locality.ward} value={locality.ward}>
                Ward {locality.ward} - {locality.locality}
              </option>
            ))}
          </select>
        )}

        {activeLabel && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <MapPin size={16} className="text-brand-teal" />
            Searching within 2 km of {activeLabel}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-100 text-red-700 rounded-lg px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-2">
          {nearbyIssues.length === 0 && activeLabel && !isLoading ? (
            <p className="text-sm text-gray-500">No open issues found within 2 km.</p>
          ) : (
            nearbyIssues.slice(0, 6).map((issue) => (
              <div key={issue.id} className="border border-gray-100 rounded-lg px-3 py-2 flex items-start gap-3">
                <span
                  className="w-2 h-10 rounded-full flex-shrink-0"
                  style={{ backgroundColor: categoryColors[issue.category] }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-brand-navy">{issue.category}</div>
                  <div className="text-xs text-gray-500">
                    {formatDistance(issue.distanceKm)} away · {issue.daysOpen} day{issue.daysOpen === 1 ? '' : 's'} open · Open
                  </div>
                </div>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                  Ward {issue.ward}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

function formatDistance(distanceKm?: number) {
  if (distanceKm === undefined) return 'nearby';
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)}m`;
  return `${distanceKm.toFixed(1)}km`;
}
