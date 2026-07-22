import React, { useState, useEffect, useRef } from 'react';
import { Camera, CheckCircle, Activity, Lock, X } from 'lucide-react';
import { Complaint, EvidenceKind } from '../types';
import { categoryColors } from '../data/categoryColors';
import { fetchComplaints, StatusUpdateError, updateComplaintStatus } from '../services';
import { fetchEvidence, getCachedEvidenceUrls, pickLatestEvidenceByKind, uploadEvidence, VerificationApiError } from '../services/verificationService';
import { VerificationPanel } from './VerificationPanel';

interface OfficerLeadsBoardProps {
  ward?: number;
  circle?: string;
}

interface LeadCardProps {
  complaint: Complaint;
  onStatusUpdate: (id: string, newStatus: string) => Promise<void>;
  onClaimResolution: (id: string, file: File) => Promise<void>;
}

const LeadCard: React.FC<LeadCardProps> = ({ complaint, onStatusUpdate, onClaimResolution }) => {
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [claimError, setClaimError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Evidence photo URLs (Fix round 1, Finding 2): seeded from this-session's
  // localStorage cache for an instant same-session display (e.g. right after
  // this officer's own claim-upload, before the round trip below resolves),
  // then reconciled against a live GET .../evidence fetch — the real,
  // cross-device/cross-browser source of truth. Re-runs on `complaint.status`
  // too, so the moment a claim flips this card into the locked view, it
  // re-reads the cache (which uploadEvidence() just wrote to) instead of a
  // stale value captured before the claim happened.
  const [evidenceUrls, setEvidenceUrls] = useState<Partial<Record<EvidenceKind, string>>>(
    () => getCachedEvidenceUrls(complaint.id)
  );

  useEffect(() => {
    setEvidenceUrls((prev) => ({ ...prev, ...getCachedEvidenceUrls(complaint.id) }));
    let alive = true;
    fetchEvidence(complaint.id)
      .then((records) => {
        if (!alive) return;
        setEvidenceUrls((prev) => ({ ...prev, ...pickLatestEvidenceByKind(records) }));
      })
      .catch(() => {
        // Live fetch failed (offline, server hiccup) — keep whatever the
        // same-session cache already had; VerificationPanel's own empty-state
        // placeholder covers the case where neither has anything.
      });
    return () => {
      alive = false;
    };
  }, [complaint.id, complaint.status]);

  const status = complaint.status || 'reported';

  const getNextAction = (s: string) => {
    switch (s) {
      case 'reported': return { label: 'Acknowledge', next: 'acknowledged', color: 'bg-blue-600 hover:bg-blue-700' };
      case 'acknowledged': return { label: 'Start Work', next: 'in_progress', color: 'bg-amber-600 hover:bg-amber-700' };
      default: return null;
    }
  };

  const action = getNextAction(status);

  const handleAction = async () => {
    if (!action) return;
    setLoading(true);
    await onStatusUpdate(complaint.id, action.next);
    setLoading(false);
  };

  const handleProofFile = (file: File) => {
    setProofFile(file);
    setProofPreview(URL.createObjectURL(file));
    setClaimError('');
  };

  const cancelClaim = () => {
    setClaiming(false);
    setProofFile(null);
    setProofPreview(null);
    setClaimError('');
  };

  const handleClaimSubmit = async () => {
    if (!proofFile) return;
    setLoading(true);
    setClaimError('');
    try {
      await onClaimResolution(complaint.id, proofFile);
      cancelClaim();
    } catch (error) {
      // Task 6 fix: only show `error.message` for our own controlled API
      // error classes (server-provided, human-readable text). A plain fetch
      // failure (offline, CORS, DNS) throws a raw browser TypeError instead
      // — e.g. "Failed to fetch" — which is not something a citizen or
      // officer should ever see verbatim (ROUND2.md §8, same class of fix
      // already applied to TrackMyReports.tsx's demo-data button in Task 4).
      setClaimError(
        error instanceof VerificationApiError || error instanceof StatusUpdateError
          ? error.message
          : 'Unable to submit proof of resolution — check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  // Once an officer claims resolution, they lose all control over this
  // complaint from this screen — no button can close it. Only the citizen's
  // own photo (uploaded from TrackMyReports) can move it forward, per
  // Task 2's hard backend rule (POST .../verify never reads officer_proof).
  if (status === 'resolution_claimed') {
    const verdict = complaint.verificationStatus === 'verified'
      || complaint.verificationStatus === 'disputed'
      || complaint.verificationStatus === 'inconclusive'
      ? complaint.verificationStatus
      : undefined;

    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 shadow-sm opacity-80 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-10 rounded-full bg-gray-300" />
            <div>
              <span className="text-xs font-bold text-gray-400">{complaint.id}</span>
              <h4 className="font-semibold text-gray-500 mt-1">{complaint.category}</h4>
              <p className="text-xs text-gray-400 mt-0.5">{complaint.address}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-gray-200 text-gray-600 font-semibold uppercase tracking-wide whitespace-nowrap">
            <Lock size={12} /> Awaiting citizen verification
          </span>
        </div>

        <VerificationPanel
          intakeImageUrl={evidenceUrls.intake}
          proofImageUrl={evidenceUrls.officer_proof}
          proofLabel="Officer's Proof Photo"
          verdict={verdict}
          reasoning={complaint.verificationReasoning}
          note="Shown for comparison only — the citizen's independent photo (not this one) is what confirms or disputes the resolution."
        />
      </div>
    );
  }

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

      {claiming ? (
        <div className="border-t border-gray-50 pt-3 mt-1 space-y-3">
          <p className="text-sm font-semibold text-brand-navy">Upload proof of resolution</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files && handleProofFile(e.target.files[0])}
          />

          {proofPreview ? (
            <div className="flex items-center gap-3">
              <img src={proofPreview} alt="Proof preview" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="text-xs font-medium text-brand-teal hover:underline">
                Change photo
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-200 rounded-lg py-5 text-sm text-gray-500 hover:border-brand-teal hover:text-brand-teal transition-colors flex flex-col items-center gap-1.5"
            >
              <Camera size={20} />
              Select a proof photo
            </button>
          )}

          {claimError && <p className="text-xs text-red-600">{claimError}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClaimSubmit}
              disabled={!proofFile || loading}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold text-white shadow-sm transition-all ${
                !proofFile || loading ? 'bg-gray-300 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {loading ? 'Submitting...' : 'Submit Proof & Claim Resolution'}
            </button>
            <button
              type="button"
              onClick={cancelClaim}
              disabled={loading}
              className="px-3 py-2 rounded-lg text-sm font-medium text-gray-500 border border-gray-200 hover:bg-gray-50 flex items-center gap-1"
            >
              <X size={14} /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between mt-2 pt-3 border-t border-gray-50">
          <span className="text-xs font-medium text-gray-500 flex items-center gap-1 uppercase tracking-wide">
            Status: <span className="text-brand-navy font-bold ml-1">{status.replace('_', ' ') || 'REPORTED'}</span>
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
          {status === 'in_progress' && (
            <button
              onClick={() => setClaiming(true)}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white shadow-sm transition-all bg-green-600 hover:bg-green-700"
            >
              Claim Resolution
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Task 6 fix: at real GHMC seed volume (ROUND2.md §2.4, ~600/day) the demo
// hotspot circle alone carries thousands of open complaints (2,480 for the
// seeded "Kapra" hotspot at the time of this fix). This board previously
// rendered a LeadCard — and fired an independent GET .../evidence request —
// for every single one of them on mount, with no cap. The browser can't
// sustain that many concurrent requests (confirmed live: ~2,700
// ERR_INSUFFICIENT_RESOURCES failures in the console on first load of the
// Kapra circle, the exact circle the demo path uses) and the resulting DOM
// (tens of thousands of nodes) made the board painfully slow to scroll,
// especially on mobile. "AI Resolution Leads" is conceptually a prioritized
// shortlist, not a full backlog dump, so capping to the top N by urgency
// (already computed and sorted below) is a fix, not a feature loss — the
// citywide/circle totals are still visible via City Admin and the
// `{complaints.length} ACTIVE` style summary text below.
const MAX_RENDERED_LEADS = 25;

export const OfficerLeadsBoard: React.FC<OfficerLeadsBoardProps> = ({ ward, circle }) => {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [totalActiveCount, setTotalActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const scopeLabel = circle ? `Circle ${circle}` : `Ward ${ward}`;

  const loadComplaints = async () => {
    if (!circle && !ward) {
      setLoading(false);
      return;
    }

    try {
      // Real, server-side scoping: ?circle= takes precedence over ?ward= so a
      // Ward Officer with a real GHMC circle assignment only ever sees their
      // own circle's complaints (Round 2 §2 — verified via WHERE circle = ?).
      const data = await fetchComplaints(circle ? { circle } : { ward });
      const sorted = [...data].sort((a, b) => {
        const uA = a.severity * 8 + Math.min(a.daysOpen, 30) * 2;
        const uB = b.severity * 8 + Math.min(b.daysOpen, 30) * 2;
        return uB - uA;
      });
      const active = sorted.filter((c) => c.status !== 'resolved');
      setTotalActiveCount(active.length);
      setComplaints(active.slice(0, MAX_RENDERED_LEADS));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadComplaints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ward, circle]);

  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      const updated = await updateComplaintStatus(id, newStatus);
      setComplaints((prev) => prev.map((c) => (c.id === id ? updated : c)).filter((c) => c.status !== 'resolved'));
    } catch (error) {
      console.error(error);
    }
  };

  const handleClaimResolution = async (id: string, file: File) => {
    // Upload the officer's own proof photo first (display/comparison only —
    // POST .../verify never reads officer_proof, see server/index.mjs), then
    // move the complaint into resolution_claimed. If either step fails, the
    // complaint is left exactly where it was — no partial "claimed without
    // photo" state is possible from this UI.
    await uploadEvidence(id, file, 'officer_proof');
    const updated = await updateComplaintStatus(id, 'resolution_claimed', 'Officer submitted proof of resolution.');
    setComplaints((prev) => prev.map((c) => (c.id === id ? updated : c)));
  };

  if (loading) {
    return (
      <div className="bg-gray-50 rounded-2xl shadow-inner border border-gray-100 overflow-hidden flex flex-col h-[500px]">
        <div className="px-5 py-4 bg-white border-b border-gray-200">
          <div className="h-4 w-40 bg-gray-100 rounded animate-pulse" />
        </div>
        <div className="flex-1 p-4 space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 space-y-3 animate-pulse">
              <div className="h-4 w-1/3 bg-gray-100 rounded" />
              <div className="h-3 w-2/3 bg-gray-100 rounded" />
              <div className="h-3 w-1/2 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
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
            <p className="text-xs text-gray-500 font-medium">{scopeLabel} active dispatch queue</p>
          </div>
        </div>
        <span className="text-xs bg-gray-900 text-white px-3 py-1 rounded-full font-bold shadow-sm whitespace-nowrap">
          {totalActiveCount > complaints.length
            ? `TOP ${complaints.length} OF ${totalActiveCount.toLocaleString()}`
            : `${complaints.length} ACTIVE`}
        </span>
      </div>

      {totalActiveCount > complaints.length && (
        <p className="px-5 pb-2 -mt-1 text-[11px] text-gray-400 bg-white">
          Showing the {complaints.length} highest-urgency leads. {(totalActiveCount - complaints.length).toLocaleString()} more open in {scopeLabel} — see City Admin for citywide totals.
        </p>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4 relative">
        {complaints.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
             <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mb-4">
               <CheckCircle className="text-green-500" size={32} />
             </div>
             <p className="font-medium text-brand-navy">All caught up!</p>
             <p className="text-sm text-gray-500 mt-1">No active leads for {scopeLabel}.</p>
          </div>
        ) : (
          complaints.map((c) => (
            <LeadCard key={c.id} complaint={c} onStatusUpdate={handleStatusUpdate} onClaimResolution={handleClaimResolution} />
          ))
        )}
      </div>
    </div>
  );
};
