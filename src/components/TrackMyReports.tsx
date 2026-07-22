import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Camera, CheckCircle, Clock, Loader, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { EvidenceKind, EvidenceRecord, VerificationVerdict } from '../types';
import { StatusUpdateError, updateComplaintStatus, uploadEvidence, verifyResolution } from '../services';
import { fetchEvidence, getCachedEvidenceUrls, pickLatestEvidenceByKind, VerificationApiError } from '../services/verificationService';
import { VerificationPanel } from './VerificationPanel';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173';

interface TrackedReport {
  id: string;
  locality: string;
  category: string;
  submittedAt: string;
}

interface ReportDetails {
  id: string;
  status: string;
  lead: string;
  verificationStatus?: string;
  verificationReasoning?: string;
  status_events: Array<{ status: string; actor: string; createdAt: string }>;
}

function isVerdict(value: string | undefined): value is VerificationVerdict {
  return value === 'verified' || value === 'disputed' || value === 'inconclusive';
}

/** fetchEvidence() returns oldest-to-newest (see verificationService.ts) — the last citizen_proof row is the latest one. */
function latestCitizenProofCreatedAt(records: EvidenceRecord[]): string | undefined {
  const citizenProofs = records.filter((r) => r.kind === 'citizen_proof');
  return citizenProofs.length > 0 ? citizenProofs[citizenProofs.length - 1].createdAt : undefined;
}

/** Most recent 'resolution_claimed' status_event — marks when the CURRENT verification cycle began. */
function latestClaimedAt(statusEvents: ReportDetails['status_events']): string | undefined {
  for (let i = statusEvents.length - 1; i >= 0; i -= 1) {
    if (statusEvents[i].status === 'resolution_claimed') return statusEvents[i].createdAt;
  }
  return undefined;
}

export const TrackMyReports: React.FC = () => {
  const [reports, setReports] = useState<TrackedReport[]>([]);
  const [details, setDetails] = useState<Record<string, ReportDetails>>({});
  // Evidence photo URLs per report, keyed by report id (Fix round 1, Finding
  // 2). Sourced primarily from a live GET .../evidence fetch — the
  // cross-device/cross-browser source of truth — seeded from this-session's
  // localStorage cache first so a photo this same browser just
  // uploaded/received shows instantly without waiting on the round trip.
  const [evidence, setEvidence] = useState<Record<string, Partial<Record<EvidenceKind, string>>>>({});
  // Task 6 fix (HUMAN_CHECKLIST "stale cached citizen_proof" deferred item):
  // when a complaint is disputed and later re-claimed by the officer for a
  // second resolution_claimed cycle, `evidence[r.id].citizen_proof` above
  // still resolves to the citizen's PREVIOUS cycle's photo (the latest
  // citizen_proof row across all time — there's no per-cycle scoping in the
  // evidence table). Without this, VerifyResolutionCard's "Confirm fixed" /
  // "Still not fixed" buttons pre-enable using that stale photo instead of
  // prompting for a fresh one. The backend still honestly re-adjudicates
  // whatever's actually latest (no security gap — see HUMAN_CHECKLIST), but
  // it's a real UX trap: a citizen could submit against evidence they never
  // looked at for this cycle. Tracked here so render-time can compare it
  // against the most recent 'resolution_claimed' status_event and blank out
  // the stale URL before it ever reaches VerifyResolutionCard's initial state.
  const [citizenProofCreatedAt, setCitizenProofCreatedAt] = useState<Record<string, string | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState('');

  const fetchReports = async () => {
    setLoading(true);
    try {
      const stored = JSON.parse(localStorage.getItem('civicpulse_my_reports') || '[]');
      setReports(stored);

      const detailsMap: Record<string, ReportDetails> = {};
      const evidenceMap: Record<string, Partial<Record<EvidenceKind, string>>> = {};
      const citizenProofCreatedAtMap: Record<string, string | undefined> = {};
      for (const r of stored) {
        const res = await fetch(`${API_BASE}/api/complaints/${r.id}`);
        if (res.ok) {
          detailsMap[r.id] = await res.json();
        }

        evidenceMap[r.id] = { ...getCachedEvidenceUrls(r.id) };
        try {
          const records = await fetchEvidence(r.id);
          evidenceMap[r.id] = { ...evidenceMap[r.id], ...pickLatestEvidenceByKind(records) };
          citizenProofCreatedAtMap[r.id] = latestCitizenProofCreatedAt(records);
        } catch (e) {
          // Live evidence fetch failed — fall back to whatever the
          // same-session cache already had (may be nothing, in which case
          // VerificationPanel renders its normal empty-state placeholder).
          console.error(e);
        }
      }
      setDetails(detailsMap);
      setEvidence(evidenceMap);
      setCitizenProofCreatedAt(citizenProofCreatedAtMap);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const refetchDetail = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/complaints/${id}`);
      if (res.ok) {
        const data = await res.json();
        setDetails((prev) => ({ ...prev, [id]: data }));
      }
    } catch (e) {
      console.error(e);
    }

    // A verify action may have just uploaded new citizen_proof evidence —
    // refresh this report's entry in the shared evidence map too, since the
    // "verification record" panel below reads from it (not from
    // VerifyResolutionCard's own local upload-preview state).
    try {
      const records = await fetchEvidence(id);
      setEvidence((prev) => ({ ...prev, [id]: { ...prev[id], ...pickLatestEvidenceByKind(records) } }));
      setCitizenProofCreatedAt((prev) => ({ ...prev, [id]: latestCitizenProofCreatedAt(records) }));
    } catch (e) {
      console.error(e);
    }
  };

  /**
   * Round 2 Task 4, Step 8 (ROUND2.md §4.6): "a judge arriving fresh has
   * empty localStorage, so TrackMyReports is blank — the worst possible
   * first impression for the headline feature." Pulls up to 3 REAL complaint
   * IDs from GET /api/demo-reports — one active/early-stage, one
   * 'resolution_claimed' (awaiting verification), one 'disputed' — and adds
   * them to localStorage['civicpulse_my_reports'] so the rest of this
   * screen's normal (non-demo) rendering path takes over from there.
   *
   * IDs are looked up live rather than hardcoded (see
   * db.mjs#getDemoReportCandidates for the full reasoning): seeding alone
   * never creates 'resolution_claimed'/'disputed' complaints, only the real
   * claim/verify/dispute flow does, so which IDs qualify can only be known
   * by asking the live DB, and any slot with nothing yet is simply omitted
   * rather than faked. This is a genuinely live-dependent feature (unlike
   * the snapshot-backed dashboards elsewhere in the app) — if the backend is
   * unreachable, that's reported honestly below rather than silently
   * inventing IDs that would just dead-end the next fetch anyway.
   */
  const loadDemoReports = async () => {
    setDemoLoading(true);
    setDemoError('');
    try {
      const res = await fetch(`${API_BASE}/api/demo-reports`);
      if (!res.ok) throw new Error('Unable to reach the server for demo reports.');

      const data: Array<{ id: string; locality: string; category: string; reportedAt: string }> = await res.json();

      if (data.length === 0) {
        setDemoError('No demo reports exist in this environment yet — they only appear once a claim/verify/dispute has happened at least once.');
        return;
      }

      const demoTracked: TrackedReport[] = data.map((c) => ({
        id: c.id,
        locality: c.locality,
        category: c.category,
        submittedAt: c.reportedAt,
      }));

      const existing: TrackedReport[] = JSON.parse(localStorage.getItem('civicpulse_my_reports') || '[]');
      const merged = [...demoTracked, ...existing.filter((r) => !demoTracked.some((d) => d.id === r.id))];
      localStorage.setItem('civicpulse_my_reports', JSON.stringify(merged));

      await fetchReports();
    } catch (e) {
      // Deliberately not surfacing e.message here — a real network failure
      // (backend unreachable) throws a raw browser TypeError ("Failed to
      // fetch"), and rendering that verbatim would violate the "never show
      // a raw error string where prose belongs" rule this whole task is
      // built around. This button is genuinely live-dependent (see the
      // function doc comment above), so a fixed, honest, intentional-
      // sounding message is used for every failure mode instead.
      console.error('Unable to load demo reports:', e);
      setDemoError('Demo reports need a live connection to the server, which isn’t reachable right now. Try again once the backend is up.');
    } finally {
      setDemoLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  if (reports.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center mt-12">
        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-100 shadow-sm">
          <Clock className="text-gray-400" size={32} />
        </div>
        <h3 className="text-xl font-medium text-brand-navy mb-2">No active reports</h3>
        <p className="text-gray-500">Reports you submit will appear here so you can track their progress.</p>

        <button
          type="button"
          onClick={loadDemoReports}
          disabled={demoLoading}
          className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-teal bg-teal-50 hover:bg-teal-100 border border-teal-100 px-5 py-2.5 rounded-lg transition-colors disabled:opacity-60"
        >
          {demoLoading ? <Loader className="animate-spin" size={16} /> : <Sparkles size={16} />}
          Demo data — load sample reports
        </button>
        {demoError && <p className="text-xs text-red-600 mt-3 max-w-sm mx-auto">{demoError}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <h2 className="text-2xl font-semibold text-brand-navy">Track My Reports</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadDemoReports}
            disabled={demoLoading}
            title="Demo data — load sample reports"
            className="text-sm font-medium text-gray-500 flex items-center gap-2 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors disabled:opacity-60"
          >
            {demoLoading ? <Loader className="animate-spin" size={14} /> : <Sparkles size={14} />}
            Demo data
          </button>
          <button onClick={fetchReports} className="text-sm font-medium text-brand-teal flex items-center gap-2 hover:bg-teal-50 px-4 py-2 rounded-lg transition-colors">
            {loading ? <Loader className="animate-spin" size={16} /> : <Clock size={16} />}
            Refresh Status
          </button>
        </div>
      </div>
      {demoError && (
        <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm">{demoError}</div>
      )}

      <div className="space-y-4">
        {reports.map(r => {
          const detail = details[r.id];

          if (!detail) {
            return (
              <div key={r.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 animate-pulse space-y-3">
                <div className="h-3 w-24 bg-gray-100 rounded" />
                <div className="h-5 w-1/2 bg-gray-100 rounded" />
                <div className="h-3 w-1/3 bg-gray-100 rounded" />
              </div>
            );
          }

          const showVerifyCard = detail.status === 'resolution_claimed';
          const showVerificationHistory = !showVerifyCard && isVerdict(detail.verificationStatus);

          // Task 6 fix: blank out a citizen_proof URL that predates this
          // complaint's current resolution_claimed cycle (see
          // citizenProofCreatedAt's doc comment above) so VerifyResolutionCard
          // never initializes with a stale photo from a prior claim/dispute
          // round — the citizen has to upload fresh evidence for THIS claim.
          const proofUploadedAt = citizenProofCreatedAt[r.id];
          const currentCycleStartedAt = latestClaimedAt(detail.status_events);
          const citizenProofIsStale = Boolean(
            showVerifyCard && currentCycleStartedAt && proofUploadedAt && proofUploadedAt < currentCycleStartedAt
          );
          const verifyCardEvidence = citizenProofIsStale
            ? { ...evidence[r.id], citizen_proof: undefined }
            : (evidence[r.id] ?? {});

          return (
            <div key={r.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden transition-all hover:shadow-md">
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{r.id}</span>
                    <h3 className="text-lg font-semibold text-brand-navy mt-1">{r.category}</h3>
                    <p className="text-sm text-gray-500 flex items-center gap-2 mt-1">
                      <span className="w-2 h-2 rounded-full bg-gray-300"></span> {r.locality}
                    </p>
                  </div>
                  <span className={`px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide uppercase whitespace-nowrap ${
                    detail.status === 'resolved' ? 'bg-green-100 text-green-700' :
                    detail.status === 'resolution_claimed' ? 'bg-indigo-100 text-indigo-700' :
                    detail.status === 'in_progress' ? 'bg-amber-100 text-amber-700' :
                    detail.status === 'acknowledged' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {detail.status.replace('_', ' ')}
                  </span>
                </div>

                {showVerifyCard && (
                  <VerifyResolutionCard
                    reportId={r.id}
                    detail={detail}
                    evidenceUrls={verifyCardEvidence}
                    onVerified={() => refetchDetail(r.id)}
                  />
                )}

                {showVerificationHistory && (
                  <div className="mb-5">
                    <VerificationPanel
                      intakeImageUrl={evidence[r.id]?.intake}
                      proofImageUrl={evidence[r.id]?.citizen_proof}
                      proofLabel="Citizen's Counter-Evidence Photo"
                      verdict={detail.verificationStatus as VerificationVerdict}
                      reasoning={detail.verificationReasoning}
                    />
                  </div>
                )}

                {detail.lead && (
                  <div className="bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-100 rounded-xl p-4 mb-5 shadow-inner">
                    <p className="text-sm text-teal-800 flex items-start gap-3">
                      <ArrowRight size={18} className="mt-0.5 shrink-0 text-teal-600" />
                      <span className="leading-relaxed"><strong className="font-semibold text-teal-900">AI Lead: </strong>{detail.lead}</span>
                    </p>
                  </div>
                )}

                {/* Fixed w-20/shrink-0 on each step, plus a fixed connector width below
                    the sm breakpoint, force real horizontal scrolling on narrow screens
                    instead of flex-shrinking labels into each other — with
                    'resolution_claimed' now a possible extra step (Task 3), 4-5 steps no
                    longer reliably fit a 375px width the way the original 2-3 did. */}
                <div className="flex gap-0 mt-6 items-center overflow-x-auto pb-2 px-2">
                  {detail.status_events.map((evt, idx) => (
                    <React.Fragment key={evt.createdAt}>
                      <div className="flex flex-col items-center w-20 shrink-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm z-10 ${
                          detail.status === 'resolved' || idx < detail.status_events.length - 1 ? 'bg-brand-teal text-white' : 'bg-brand-terracotta text-white'
                        }`}>
                          <CheckCircle size={16} strokeWidth={3} />
                        </div>
                        {/* w-20 (fixed, not min-w) forces long labels like "RESOLUTION
                            CLAIMED" to wrap onto a second line within their own step
                            instead of growing past it and butting into the next one —
                            the bug this fixes only became visible once Task 3 added a
                            4th/5th possible step to a stepper that used to max out at 3. */}
                        <span className="text-xs font-medium text-gray-600 mt-2 uppercase tracking-wide text-center leading-tight">{evt.status.replace('_', ' ')}</span>
                      </div>
                      {idx < detail.status_events.length - 1 && (
                        <div className="w-10 shrink-0 sm:w-auto sm:shrink sm:flex-1 h-1 bg-brand-teal -mt-6 rounded-full mx-[-20px]" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface VerifyResolutionCardProps {
  reportId: string;
  detail: ReportDetails;
  /** Intake/officer_proof URLs for the comparison panel — from the parent's live-fetched evidence map (Fix round 1, Finding 2), not a local cache read. */
  evidenceUrls: Partial<Record<EvidenceKind, string>>;
  onVerified: () => Promise<void>;
}

/**
 * The citizen-facing half of the verification loop. Gates "Confirm fixed" /
 * "Still not fixed" behind an actually-successful citizen_proof upload, so a
 * click can never hit the backend's "no citizen_proof evidence" 400 in the
 * normal flow (Task 3 brief). Both buttons call the same POST .../verify —
 * the verdict always comes from the agent, never from which button was
 * pressed. That's a deliberate product decision worth flagging: the buttons
 * only capture citizen *intent/framing* for the note attached to this
 * action, they cannot override the model. See task-3-report.md.
 */
const VerifyResolutionCard: React.FC<VerifyResolutionCardProps> = ({ reportId, detail, evidenceUrls, onVerified }) => {
  const [citizenProofUrl, setCitizenProofUrl] = useState<string | undefined>(evidenceUrls.citizen_proof);
  const [uploading, setUploading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError('');
    try {
      const evidence = await uploadEvidence(reportId, file, 'citizen_proof');
      setCitizenProofUrl(evidence.imageUrl);
    } catch (error) {
      // Task 6 fix: only trust `.message` from our own controlled API error
      // classes (server-provided text); a plain network failure throws a raw
      // browser TypeError instead, which must never render verbatim
      // (ROUND2.md §8) — same fix as OfficerLeadsBoard.tsx/RoutePlanner.tsx.
      setUploadError(error instanceof VerificationApiError ? error.message : 'Unable to upload your photo — check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  // Both "Confirm fixed" and "Still not fixed" call this exact same function
  // — POST .../verify takes no body (Task 2's contract), and the verdict is
  // always the agent's independent read of the two photos, never something
  // either button can steer. The two buttons exist purely so the citizen can
  // register their own expectation before seeing the agent's answer; there
  // is currently no field to send that framing to the backend, so nothing is
  // silently invented here — see task-3-report.md "Concerns" for why this
  // is flagged rather than assumed.
  const handleVerify = async () => {
    if (!citizenProofUrl || verifying) return;
    setVerifying(true);
    setVerifyError('');
    try {
      const result = await verifyResolution(reportId);

      if (result.verdict === 'verified') {
        // POST .../verify persists the verdict but does not itself close the
        // complaint — server/agents/verificationAgent.mjs only auto-transitions
        // status on a 'disputed' verdict (reopen). Closing the loop on a
        // genuine 'verified' result is done here, via the same PATCH
        // .../status contract the officer's claim flow uses. It succeeds
        // because verification_status is now 'verified', satisfying the
        // 409 gate that blocks any other path to 'resolved'.
        await updateComplaintStatus(reportId, 'resolved', 'Verified via citizen counter-evidence.');
      } else if (result.verdict === 'inconclusive') {
        // Task 6 fix (HUMAN_CHECKLIST deferred item): the complaint stays in
        // 'resolution_claimed' after an inconclusive verdict, so this same
        // card instance stays mounted (never remounts, unlike the
        // dispute/re-claim cycle handled by the parent's staleness check
        // above) — without this, "Confirm fixed"/"Still not fixed" would
        // stay pre-enabled using the exact same photo that just produced an
        // inconclusive result. Clearing it forces a deliberate next step —
        // pick a new/clearer photo — before trying again.
        setCitizenProofUrl(undefined);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }

      await onVerified();
    } catch (error) {
      // Task 6 fix: same rationale as handleFile's catch above.
      setVerifyError(
        error instanceof VerificationApiError || error instanceof StatusUpdateError
          ? error.message
          : 'Unable to verify this resolution — check your connection and try again.'
      );
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-teal-50 to-white border-2 border-teal-100 rounded-2xl p-5 mb-5 space-y-4">
      <div>
        <h4 className="font-bold text-brand-navy text-lg">Verify this fix</h4>
        <p className="text-sm text-gray-600 mt-1">
          An officer says this issue has been resolved. Upload your own photo to confirm it — only your
          independent photo can close this complaint out.
        </p>
      </div>

      {detail.verificationStatus === 'inconclusive' && detail.verificationReasoning && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800">
          Previous attempt was inconclusive: {detail.verificationReasoning} Try uploading a clearer photo.
        </div>
      )}

      <VerificationPanel
        intakeImageUrl={evidenceUrls.intake}
        proofImageUrl={evidenceUrls.officer_proof}
        proofLabel="Officer's Proof Photo"
        loading={verifying}
      />

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files && handleFile(e.target.files[0])}
        />
        {citizenProofUrl ? (
          <div className="flex items-center gap-3 bg-white rounded-lg border border-gray-100 p-2">
            <img src={citizenProofUrl} alt="Your uploaded proof" className="w-14 h-14 rounded-md object-cover shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-brand-navy">Your photo is ready to submit</p>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="text-xs text-brand-teal hover:underline">
                Replace photo
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full border-2 border-dashed border-teal-200 rounded-xl py-5 text-sm font-medium text-brand-teal hover:bg-teal-50 transition-colors flex flex-col items-center gap-1.5 disabled:opacity-60"
          >
            {uploading ? <Loader className="animate-spin" size={20} /> : <Camera size={20} />}
            {uploading ? 'Uploading...' : 'Upload your photo'}
          </button>
        )}
        {uploadError && <p className="text-xs text-red-600 mt-2">{uploadError}</p>}
      </div>

      {verifyError && (
        <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-700">{verifyError}</div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => handleVerify()}
          disabled={!citizenProofUrl || verifying}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
            !citizenProofUrl || verifying
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700 shadow-sm'
          }`}
        >
          <ThumbsUp size={16} /> Confirm fixed
        </button>
        <button
          type="button"
          onClick={() => handleVerify()}
          disabled={!citizenProofUrl || verifying}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
            !citizenProofUrl || verifying
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
          }`}
        >
          <ThumbsDown size={16} /> Still not fixed
        </button>
      </div>
      {!citizenProofUrl && (
        <p className="text-xs text-gray-400 text-center -mt-2">Upload your photo above to enable these actions.</p>
      )}
    </div>
  );
};
