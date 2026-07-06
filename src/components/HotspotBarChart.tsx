import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { HotspotGroup } from '../types';

interface HotspotBarChartProps {
  hotspots: HotspotGroup[];
  topN?: number;
}

const categoryColors: Record<string, string> = {
  'Garbage Overflow': '#E85D4C',
  'Pothole / Road Damage': '#F2994A',
  'Water Leakage': '#0E5C56',
  'Streetlight Outage': '#1F3A5F',
  'Drainage Blockage': '#4A90A4',
  'Stray Animal Hazard': '#7B68EE',
};

export const HotspotBarChart: React.FC<HotspotBarChartProps> = ({ hotspots, topN = 10 }) => {
  const topHotspots = hotspots.slice(0, topN);

  const chartData = topHotspots.map((h) => ({
    name: `W${h.ward} - ${h.category.length > 12 ? h.category.slice(0, 12) + '...' : h.category}`,
    fullLabel: `Ward ${h.ward} - ${h.category}`,
    count: h.count,
    fill: categoryColors[h.category] || '#0E5C56',
  }));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Top Hotspots (Last 30 Days)</h3>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis type="number" tick={{ fill: '#6B7280', fontSize: 12 }} />
            <YAxis
              dataKey="name"
              type="category"
              width={120}
              tick={{ fill: '#6B7280', fontSize: 11 }}
            />
            <Tooltip
              formatter={(value) => [`${value} complaints`, 'Count']}
              labelFormatter={(_, payload) => {
                if (payload && payload[0]) {
                  return (payload[0].payload as { fullLabel?: string })?.fullLabel || '';
                }
                return '';
              }}
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #E5E7EB',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
