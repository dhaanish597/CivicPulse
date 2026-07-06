import React, { useState, useMemo, useRef } from 'react';
import { MapPin, Clock, MessageCircle, Send, Loader2, AlertCircle } from 'lucide-react';
import { Complaint, ChatMessage, UserLocation } from '../types';
import {
  detectHotspots,
  getTopHotspotWard,
  sortComplaintsByUrgency,
  computeRecurrenceCounts,
  computeDailyCounts,
  forecastNext7Days,
  answerQuestion,
} from '../services';
import { ForecastChart } from './ForecastChart';
import { MapView } from './MapView';
import { categoryColors } from '../data/categoryColors';

interface WardDashboardProps {
  complaints: Complaint[];
  userLocation?: UserLocation | null;
}

export const WardDashboard: React.FC<WardDashboardProps> = ({ complaints, userLocation = null }) => {
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'Hello! I\'m your CivicPulse assistant. Ask me about complaints, hotspots, or any ward-specific information.',
      timestamp: new Date(),
    },
  ]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const chatErrorTimeoutRef = useRef<number | null>(null);

  const hotspots = useMemo(() => detectHotspots(complaints, 30), [complaints]);
  const topWardInfo = useMemo(() => getTopHotspotWard(hotspots), [hotspots]);
  const openComplaints = useMemo(
    () => complaints.filter((c) => !c.resolved),
    [complaints]
  );
  const recurrenceMap = useMemo(
    () => computeRecurrenceCounts(complaints),
    [complaints]
  );
  const topUrgentComplaints = useMemo(
    () => sortComplaintsByUrgency(openComplaints, recurrenceMap).slice(0, 8),
    [openComplaints, recurrenceMap]
  );

  const topWardComplaints = useMemo(
    () => complaints.filter((c) => c.ward === topWardInfo.ward),
    [complaints, topWardInfo.ward]
  );

  const topWardDailyCounts = useMemo(
    () => computeDailyCounts(topWardComplaints.map((c) => c.reportedAt)),
    [topWardComplaints]
  );

  const forecast = useMemo(
    () => forecastNext7Days(topWardDailyCounts.map((d) => d.count)),
    [topWardDailyCounts]
  );

  const handleSendMessage = async () => {
    const question = chatInput.trim();
    if (!question || isChatLoading) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: question,
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const response = await answerQuestion(question, complaints, userLocation);

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response.answer,
        timestamp: new Date(),
        toolsUsed: response.toolsUsed,
      };

      setChatMessages((prev) => [...prev, assistantMessage]);

      if (response.fallback && response.error) {
        showChatErrorToast(response.error);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'I could not answer that right now. Please try again in a moment.',
          timestamp: new Date(),
        },
      ]);
      showChatErrorToast('Unable to reach the AI assistant right now.');
    } finally {
      setIsChatLoading(false);
    }
  };

  const showChatErrorToast = (message: string) => {
    setChatError(message);
    if (chatErrorTimeoutRef.current) {
      window.clearTimeout(chatErrorTimeoutRef.current);
    }
    chatErrorTimeoutRef.current = window.setTimeout(() => setChatError(''), 5000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <MapPin size={18} className="text-[#0E5C56]" />
            <h3 className="font-semibold text-gray-800">Hyderabad Hotspot Map</h3>
            <span className="text-xs text-gray-400 ml-auto">{openComplaints.length} open issues</span>
          </div>
          <div className="h-80">
            <MapView complaints={complaints} height="320px" scopedWard={complaints.length ? undefined : topWardInfo.ward} />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Clock size={18} className="text-[#E85D4C]" />
            <h3 className="font-semibold text-gray-800">Today's Dispatch List</h3>
            <span className="text-xs bg-[#E85D4C] text-white px-2 py-0.5 rounded-full ml-auto">
              {topUrgentComplaints.length} urgent
            </span>
          </div>
          <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
            {topUrgentComplaints.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">
                All complaints resolved!
              </div>
            ) : (
              topUrgentComplaints.map((complaint) => {
                const urgencyScore = complaint.severity * 8 + Math.min(complaint.daysOpen, 30) * 2;
                return (
                  <div
                    key={complaint.id}
                    className="px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3"
                  >
                    <div
                      className="w-1 h-12 rounded-full flex-shrink-0"
                      style={{ backgroundColor: categoryColors[complaint.category] }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-800 text-sm">
                          Ward {complaint.ward}
                        </span>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full text-white"
                          style={{ backgroundColor: categoryColors[complaint.category] ?? '#4A90A4' }}
                        >
                          {complaint.category.split(' ')[0]}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {complaint.address}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold text-[#0E5C56]">
                        {urgencyScore}
                      </div>
                      <div className="text-xs text-gray-400">urgency</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <ForecastChart
              historicalData={topWardDailyCounts}
              forecastData={forecast}
              wardNumber={topWardInfo.ward}
            />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <MessageCircle size={18} className="text-[#0E5C56]" />
            <h3 className="font-semibold text-gray-800">Ask CivicPulse</h3>
          </div>
          <div className="flex-1 max-h-64 overflow-y-auto p-4 space-y-3">
            {chatMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-[#0E5C56] text-white rounded-br-none'
                      : 'bg-gray-100 text-gray-700 rounded-bl-none'
                  }`}
                >
                  {msg.content}
                  {msg.role === 'assistant' && msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-200 text-[11px] text-gray-500">
                      used: {msg.toolsUsed.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex justify-start">
                <div className="max-w-[85%] px-3 py-2 rounded-lg rounded-bl-none text-sm bg-gray-100 text-gray-700 flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Thinking...
                </div>
              </div>
            )}
          </div>
          <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSendMessage();
                }
              }}
              placeholder="Ask about complaints, wards, issues..."
              disabled={isChatLoading}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0E5C56] focus:border-transparent"
            />
            <button
              onClick={handleSendMessage}
              disabled={isChatLoading || !chatInput.trim()}
              className={`px-3 py-2 rounded-lg transition-colors ${
                isChatLoading || !chatInput.trim()
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-[#0E5C56] text-white hover:bg-[#0a4a45]'
              }`}
              aria-label="Send chat message"
            >
              {isChatLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>

      {chatError && (
        <div className="fixed bottom-8 left-8 bg-[#E85D4C] text-white px-6 py-4 rounded-xl shadow-lg flex items-center gap-3 animate-slide-up max-w-md">
          <AlertCircle size={24} />
          <div>
            <p className="font-medium">AI Service Fallback</p>
            <p className="text-sm text-red-50">{chatError}</p>
          </div>
        </div>
      )}
    </div>
  );
};
