import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface ForecastChartProps {
  historicalData: { date: string; count: number }[];
  forecastData: number[];
  wardNumber?: number;
}

export const ForecastChart: React.FC<ForecastChartProps> = ({
  historicalData,
  forecastData,
  wardNumber,
}) => {
  const today = new Date();
  const forecastDates = forecastData.map((_, idx) => {
    const date = new Date(today);
    date.setDate(date.getDate() + idx + 1);
    return date.toISOString().split('T')[0];
  });

  const combinedData = [
    ...historicalData.slice(-14).map((d) => ({
      date: d.date.slice(5),
      count: d.count,
      type: 'historical',
    })),
    ...forecastDates.map((date, idx) => ({
      date: date.slice(5),
      count: null,
      forecast: forecastData[idx],
      type: 'forecast',
    })),
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-brand-navy mb-2">
        7-Day Forecast {wardNumber ? `- Ward ${wardNumber}` : ''}
      </h3>
      <p className="text-xs text-gray-500 mb-4">Predicted daily complaints using exponential smoothing</p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={combinedData}
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#6B7280', fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#6B7280', fontSize: 12 }}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #E5E7EB',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="count"
              name="Historical"
              stroke="#0E5C56"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="forecast"
              name="Forecast"
              stroke="#F2994A"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ r: 3, fill: '#F2994A' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
