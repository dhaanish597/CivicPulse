import React, { useState } from 'react';
import { CheckCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { AgentTrace } from '../types';

interface AgentActivityPanelProps {
  trace: AgentTrace[];
  isRunning?: boolean;
  recommendation?: string;
  statusEvents?: Array<{ status: string; actor: string; createdAt: string }>;
}

const pendingSteps = [
  'Ingestion',
  'Classification',
  'Dedup',
  'Hotspot',
  'Forecast',
  'Urgency',
  'Recommendation',
];

export const AgentActivityPanel: React.FC<AgentActivityPanelProps> = ({
  trace,
  isRunning = false,
  recommendation,
  statusEvents,
}) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = React.useState(0);

  React.useEffect(() => {
    if (trace.length > 0) {
      if (visibleCount < trace.length) {
        const timer = setTimeout(() => setVisibleCount((c) => c + 1), 400);
        return () => clearTimeout(timer);
      }
    } else {
      setVisibleCount(0);
    }
  }, [trace, visibleCount]);

  const visibleSteps = trace.length > 0
    ? trace.slice(0, visibleCount)
    : isRunning
      ? pendingSteps.map((stepName, index) => ({
          id: stepName,
          complaintId: '',
          stepName,
          stepOrder: index + 1,
          detail: 'Waiting for this agent step to complete...',
          createdAt: new Date(),
        }))
      : [];

  if (visibleSteps.length === 0 && (!statusEvents || statusEvents.length === 0)) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-brand-navy">Agent Orchestration Trace</h3>
        <p className="text-xs text-gray-500 mt-1">
          {'Ingestion -> Classification -> Dedup -> Hotspot -> Forecast -> Urgency -> Recommendation'}
        </p>
      </div>

      <div className="divide-y divide-gray-50">
        {visibleSteps.map((step, index) => {
          const key = step.id || `${step.stepName}-${index}`;
          const isComplete = trace.length > 0;
          const isOpen = expanded[key] ?? index === visibleSteps.length - 1;

          return (
            <div key={key} className="px-4 py-3">
              <button
                type="button"
                onClick={() => setExpanded((prev) => ({ ...prev, [key]: !isOpen }))}
                className="w-full flex items-center gap-3 text-left"
              >
                {isComplete ? (
                  <CheckCircle size={18} className="text-brand-teal" />
                ) : (
                  <Loader2 size={18} className="text-[#F2994A] animate-spin" />
                )}
                <span className="flex-1 text-sm font-medium text-brand-navy">
                  {step.stepOrder}. {step.stepName}
                </span>
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {isOpen && (
                <p className="text-sm text-gray-600 mt-2 ml-8 leading-relaxed">
                  {step.detail}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {recommendation && (
        <div className="bg-teal-50 border-t border-teal-100 px-4 py-3">
          <p className="text-sm font-medium text-brand-teal">Recommended action</p>
          <p className="text-sm text-gray-700 mt-1">{recommendation}</p>
        </div>
      )}

      {statusEvents && statusEvents.length > 0 && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          <div className="px-4 py-3 bg-gray-50">
            <h4 className="text-sm font-semibold text-brand-navy">Status Updates</h4>
          </div>
          {statusEvents.map((evt, idx) => (
             <div key={idx} className="px-4 py-3 flex items-center gap-3">
                <CheckCircle size={18} className="text-brand-teal" />
                <span className="flex-1 text-sm font-medium text-brand-navy uppercase">
                  Status changed to: {evt.status.replace('_', ' ')}
                </span>
                <span className="text-xs text-gray-500">{new Date(evt.createdAt).toLocaleDateString()}</span>
             </div>
          ))}
        </div>
      )}
    </div>
  );
};
