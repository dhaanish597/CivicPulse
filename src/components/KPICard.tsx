import React from 'react';
import { AlertCircle, MapPin, Clock } from 'lucide-react';

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: 'alert' | 'map' | 'clock';
  accentColor?: string;
}

const iconMap = {
  alert: AlertCircle,
  map: MapPin,
  clock: Clock,
};

export const KPICard: React.FC<KPICardProps> = ({ title, value, subtitle, icon, accentColor = '#0E5C56' }) => {
  const IconComponent = iconMap[icon];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow duration-200">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
          <p className="text-3xl font-bold" style={{ color: accentColor }}>
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
          )}
        </div>
        <div
          className="p-3 rounded-lg"
          style={{ backgroundColor: `${accentColor}15` }}
        >
          <IconComponent size={24} style={{ color: accentColor }} />
        </div>
      </div>
    </div>
  );
};
