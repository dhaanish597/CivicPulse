import React from 'react';
import { Camera, Clock, ImageOff, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { VerificationVerdict } from '../types';

export interface VerificationPanelProps {
  intakeImageUrl?: string;
  proofImageUrl?: string;
  verdict?: VerificationVerdict;
  confidence?: number;
  reasoning?: string;
  /** Label for the second photo column. Callers differentiate whose photo it is
   *  (officer's proof vs citizen's counter-evidence) — defaults to "Proof Photo". */
  proofLabel?: string;
  /** True while a verify() call is in flight — shows a working state instead of stale/awaiting copy. */
  loading?: boolean;
  /** Optional footnote rendered under the panel, e.g. clarifying an officer's
   *  own photo is shown for comparison only and never decides the verdict. */
  note?: string;
}

type VerdictMeta = {
  label: string;
  Icon: typeof ShieldCheck;
  badgeClass: string;
  panelClass: string;
  iconClass: string;
};

const VERDICT_META: Record<VerificationVerdict, VerdictMeta> = {
  verified: {
    label: 'Verified',
    Icon: ShieldCheck,
    badgeClass: 'bg-green-100 text-green-700',
    panelClass: 'bg-green-50 border-green-100',
    iconClass: 'text-green-600',
  },
  disputed: {
    label: 'Disputed',
    Icon: ShieldAlert,
    badgeClass: 'bg-red-100 text-red-700',
    panelClass: 'bg-red-50 border-red-100',
    iconClass: 'text-red-600',
  },
  inconclusive: {
    label: 'Inconclusive',
    Icon: ShieldQuestion,
    badgeClass: 'bg-amber-100 text-amber-700',
    panelClass: 'bg-amber-50 border-amber-100',
    iconClass: 'text-amber-600',
  },
};

const AWAITING_META = {
  label: 'Awaiting Verification',
  badgeClass: 'bg-blue-100 text-blue-700',
};

/**
 * Side-by-side before/after evidence comparison plus a verdict badge and
 * plain-language reasoning. Reused in 3 places (OfficerLeadsBoard's claimed
 * cards, TrackMyReports' "Verify this fix" card, and any standalone
 * detail view) — purely props-driven, no data fetching of its own. The
 * caller decides which photo goes in `proofImageUrl` (officer_proof while
 * awaiting, citizen_proof once available) and what `proofLabel` to show.
 */
export const VerificationPanel: React.FC<VerificationPanelProps> = ({
  intakeImageUrl,
  proofImageUrl,
  verdict,
  confidence,
  reasoning,
  proofLabel = 'Proof Photo',
  loading = false,
  note,
}) => {
  const meta = verdict ? VERDICT_META[verdict] : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-brand-navy">Resolution Verification</h3>
          <p className="text-xs text-gray-500 mt-0.5">Reported condition vs. proof of resolution</p>
        </div>

        {loading ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide bg-gray-100 text-gray-600">
            <Loader2 size={13} className="animate-spin" />
            Verifying
          </span>
        ) : meta ? (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide ${meta.badgeClass}`}>
            <meta.Icon size={13} />
            {meta.label}
          </span>
        ) : (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide ${AWAITING_META.badgeClass}`}>
            <Clock size={13} />
            {AWAITING_META.label}
          </span>
        )}
      </div>

      <div className="p-5 grid grid-cols-2 gap-4">
        <EvidenceThumb label="Reported" url={intakeImageUrl} placeholderIcon={ImageOff} placeholderText="No intake photo on file" />
        <EvidenceThumb label={proofLabel} url={proofImageUrl} placeholderIcon={Camera} placeholderText="Not uploaded yet" />
      </div>

      {loading && (
        <div className="mx-5 mb-5 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-brand-teal shrink-0" />
          <p className="text-sm text-gray-600">AI agent is comparing the two photos against the original report...</p>
        </div>
      )}

      {!loading && meta && (
        <div className={`mx-5 mb-5 rounded-xl border px-4 py-3 ${meta.panelClass}`}>
          <div className="flex items-center justify-between gap-3">
            <p className={`text-sm font-semibold ${meta.iconClass}`}>Verdict: {meta.label}</p>
            {typeof confidence === 'number' && (
              <span className="text-xs font-medium text-gray-500">Confidence: {Math.round(confidence * 100)}%</span>
            )}
          </div>
          {reasoning && <p className="text-sm text-gray-700 mt-1.5 leading-relaxed">{reasoning}</p>}
        </div>
      )}

      {!loading && !meta && (
        <div className="mx-5 mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
          <p className="text-sm text-blue-800 leading-relaxed">
            An officer has claimed this issue is resolved. The citizen's own photo — never the officer's —
            is what the AI agent will use to confirm it.
          </p>
        </div>
      )}

      {note && (
        <div className="px-5 pb-5 -mt-2">
          <p className="text-xs text-gray-400 leading-relaxed">{note}</p>
        </div>
      )}
    </div>
  );
};

interface EvidenceThumbProps {
  label: string;
  url?: string;
  placeholderIcon: typeof ImageOff;
  placeholderText: string;
}

const EvidenceThumb: React.FC<EvidenceThumbProps> = ({ label, url, placeholderIcon: PlaceholderIcon, placeholderText }) => (
  <div>
    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">{label}</p>
    <div className="aspect-square rounded-xl border border-gray-100 bg-gray-50 overflow-hidden flex items-center justify-center">
      {url ? (
        <img src={url} alt={label} className="w-full h-full object-cover" />
      ) : (
        <div className="flex flex-col items-center gap-2 text-gray-300 px-2 text-center">
          <PlaceholderIcon size={28} />
          <span className="text-xs text-gray-400">{placeholderText}</span>
        </div>
      )}
    </div>
  </div>
);
