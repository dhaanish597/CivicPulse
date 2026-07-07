import React, { useState, useEffect } from 'react';
import { LocateFixed, Loader2 } from 'lucide-react';
import { Complaint, UserLocation } from '../types';
import { hyderabadLocalities } from '../data/hyderabadLocalities';
import { fetchNearbyIssues } from '../services';
import { MapView } from './MapView';

interface LocalIssuesMapProps {
  userLocation: UserLocation | null;
  onLocationChange: (location: UserLocation) => void;
}

export const LocalIssuesMap: React.FC<LocalIssuesMapProps> = ({ userLocation, onLocationChange }) => {
  const [nearbyIssues, setNearbyIssues] = useState<Complaint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadNearby = async (lat: number, lng: number) => {
    setIsLoading(true);
    try {
      const issues = await fetchNearbyIssues(lat, lng, 2);
      setNearbyIssues(issues);
    } catch {
      setError('Unable to load nearby issues.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (userLocation) {
      loadNearby(userLocation.lat, userLocation.lng);
    } else {
      showIssuesNearMe();
    }
  }, [userLocation]);

  const showIssuesNearMe = () => {
    setError('');
    if (!navigator.geolocation) {
      setError('Browser geolocation is not available.');
      return;
    }
    setIsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location: UserLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: 'Current browser location',
          source: 'geolocation',
        };
        onLocationChange(location);
      },
      () => {
        setIsLoading(false);
        setError('Location access was denied. Pick a locality instead.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleManualLocality = (wardValue: string) => {
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
    onLocationChange(location);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold text-brand-navy">Issues Near Me</h2>
            <p className="text-gray-500 mt-1">Showing open issues within a 2km radius</p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            <button
              type="button"
              onClick={showIssuesNearMe}
              disabled={isLoading}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                isLoading ? 'bg-gray-100 text-gray-400' : 'bg-brand-teal text-white hover:bg-[#0a4a45]'
              }`}
            >
              {isLoading ? <Loader2 size={18} className="animate-spin" /> : <LocateFixed size={18} />}
              Use my location
            </button>
            <select
              onChange={(event) => handleManualLocality(event.target.value)}
              value={userLocation?.source === 'manual' ? userLocation.ward : ''}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-teal"
            >
              <option value="" disabled>Or pick a locality</option>
              {hyderabadLocalities.map((locality) => (
                <option key={locality.ward} value={locality.ward}>
                  {locality.locality}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <div className="bg-gray-50 rounded-xl overflow-hidden border border-gray-100">
          <MapView 
            complaints={nearbyIssues} 
            height="500px" 
            centerLocation={userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : undefined}
            radiusKm={2}
          />
        </div>
      </div>
    </div>
  );
};
