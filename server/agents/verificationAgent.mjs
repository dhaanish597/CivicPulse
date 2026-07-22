import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callNvidia, NVIDIA_CHAT_MODEL, NVIDIA_VISION_MODEL, stripCodeFence } from '../nvidia.mjs';
import {
  escalateSeverity,
  insertAgentTrace,
  insertStatusEvent,
  listComplaints,
  updateComplaintStatus,
} from '../db.mjs';
import { computeRecurrenceCounts, scoreUrgency } from '../analytics.mjs';
import { generateId } from '../utils.mjs';
import { hashKey, withCache } from '../cache.mjs';

// Round 2 Task 4, Step 2: bump either if its respective prompt shape changes.
const DESCRIBE_PROMPT_VERSION = 'v1';
const ADJUDICATE_PROMPT_VERSION = 'v1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');

// Guardrail threshold — applied in code below, AFTER the model responds, never
// left to the prompt alone (task-2 brief §Step 3).
const CONFIDENCE_THRESHOLD = 0.6;

const VERIFICATION_STEP_NAME = 'Verification';
// orchestrator.mjs's pipeline uses step orders 1-7 (Ingestion..Recommendation);
// verification always runs afterward, well after a complaint already exists, so
// it continues that sequence rather than colliding with it.
const VERIFICATION_STEP_ORDER = 8;

// Never fabricate a verdict: if the model fails twice (bad JSON, network error,
// anything), this is the one and only fallback shape. It is returned verbatim —
// never "verified", never a guess.
const FAILURE_RESULT = {
  verdict: 'inconclusive',
  confidence: 0,
  reasoning: 'Automated verification unavailable — flagged for manual review.',
  sameLocationLikely: null,
};

/**
 * Adjudicates a claimed resolution by comparing the original intake photo
 * against the citizen's counter-evidence photo (citizen_proof) — and ONLY
 * that. The officer's own officer_proof photo is never read by this
 * function; it plays no role in adjudication (see task-2-report.md "Fix
 * round 1" — an officer must never be able to satisfy verification with
 * self-submitted evidence alone, and re-uploading officer_proof must have no
 * effect here). Pure model-calling + guardrail logic ONLY — no DB writes, no
 * side effects on `complaint`. Returns
 * { verdict, confidence, reasoning, sameLocationLikely } and never throws —
 * model failures degrade to the honest 'inconclusive' FAILURE_RESULT above,
 * they never propagate as an unhandled error and never get silently
 * upgraded to a real verdict.
 *
 * Round 2 Task 5: pulled out of runVerification() below (which used to
 * inline this) so evals/run_verification_eval.mjs can get a real verdict
 * without runVerification()'s DB-mutation tail (insertAgentTrace,
 * updateComplaintStatus, escalateSeverity, insertStatusEvent) — those assume
 * `complaint` is a real row in the `complaints` table (escalateSeverity()
 * re-reads it via getComplaintById() and returns null for a synthetic eval
 * id, which crashed runVerification()'s own scoreUrgency() call on a
 * 'disputed' verdict during Task 5 testing; see task-5-report.md).
 * runVerification() below is unchanged in behavior — it just calls this
 * first — so its existing contract (return shape, DB writes) is identical to
 * before this refactor.
 */
export async function adjudicateVerification(complaint, intakeImagePath, citizenProofImagePath) {
  let result;
  try {
    // Keyed on complaint id + both evidence image paths (each evidence
    // upload gets its own unique generateId('EVD') filename — server/index.mjs
    // — so the path itself already uniquely identifies that evidence row's
    // content, no need to separately hash file bytes). Re-verifying the same
    // complaint against the exact same intake/citizen_proof pair (a retried
    // request, a duplicate click) is a full cache hit — zero NVIDIA calls for
    // all 3 calls inside callVerificationModel (server/cache.mjs, ROUND2.md
    // §4.2's explicit "verification verdicts" entry).
    const cacheKey = hashKey(['verify-adjudicate', ADJUDICATE_PROMPT_VERSION, complaint.id, intakeImagePath, citizenProofImagePath]);
    result = await withCache(cacheKey, () => callVerificationModel(complaint, intakeImagePath, citizenProofImagePath));
  } catch (error) {
    console.warn('Verification model call failed (after retry) — returning inconclusive.', error.message);
    result = { ...FAILURE_RESULT };
  }

  return applyGuardrails(result);
}

/**
 * The full verification step: calls adjudicateVerification() above for the
 * verdict, then writes one agent_traces row and one status_events row for
 * the step, and on a 'disputed' verdict reopens the complaint and escalates
 * its urgency. This is verificationAgent.mjs's normal entry point — the one
 * server/index.mjs's POST /api/complaints/:id/verify route calls — and
 * requires `complaint` to be a real row in the `complaints` table (see
 * adjudicateVerification()'s doc comment above for why).
 */
export async function runVerification(complaint, intakeImagePath, citizenProofImagePath) {
  const result = await adjudicateVerification(complaint, intakeImagePath, citizenProofImagePath);

  insertAgentTrace({
    id: generateId('TRC'),
    complaintId: complaint.id,
    stepName: VERIFICATION_STEP_NAME,
    stepOrder: VERIFICATION_STEP_ORDER,
    detail: `Verdict: ${result.verdict} (confidence ${result.confidence}, same_location_likely ${result.sameLocationLikely}). ${result.reasoning}`,
  });

  if (result.verdict === 'disputed') {
    updateComplaintStatus(complaint.id, { status: 'in_progress' });
    const escalated = escalateSeverity(complaint.id);

    // Recompute via the existing urgencyAgent path (scoreUrgency/computeRecurrenceCounts,
    // server/agents/urgencyAgent.mjs) purely to surface the before/after escalation here.
    // There is no persisted `urgency` column on complaints — it's always computed live
    // wherever it's needed (analytics.mjs#buildDispatchList, forecast, etc.) — so the
    // durable half of "escalate urgency" is the fixed severity bump from escalateSeverity()
    // above (severity is scoreUrgency's dominant weighted term, severity * 8), and this
    // recomputation is the visible/reported half. See task-2-report.md for the full
    // rationale on why both are used together rather than just one.
    const allComplaints = listComplaints();
    const recurrenceCount = computeRecurrenceCounts(allComplaints).get(`${complaint.ward}-${complaint.category}`) ?? 0;
    const beforeUrgency = scoreUrgency(complaint, recurrenceCount);
    const afterUrgency = scoreUrgency(escalated, recurrenceCount);

    insertStatusEvent({
      id: generateId('EVT'),
      complaintId: complaint.id,
      status: 'in_progress',
      note: `Reopened — disputed resolution. ${result.reasoning} Urgency escalated ${beforeUrgency} -> ${afterUrgency} (severity ${complaint.severity} -> ${escalated.severity}).`,
      actor: 'agent',
    });
  } else {
    insertStatusEvent({
      id: generateId('EVT'),
      complaintId: complaint.id,
      status: complaint.status,
      note: `Verification verdict: ${result.verdict}. ${result.reasoning}`,
      actor: 'agent',
    });
  }

  return result;
}

// IMPORTANT DEVIATION FROM THE BRIEF — documented in task-2-report.md:
//
// The brief asked for one NVIDIA vision call carrying both images at once,
// mirroring classifyImage()'s single-image message-array shape but with two
// image_url entries. A real call against this repo's configured model
// (meta/llama-3.2-11b-vision-instruct) proved that's not possible:
//
//   NVIDIA API returned 400: {"error":{"message":"At most 1 image(s) may be
//   provided in one prompt. None","type":"BadRequestError", ...}}
//
// That's a genuine endpoint limit, not a guess — see task-2-report.md for the
// literal error and the live run that surfaced it. The workaround below keeps
// the same net effect (an AI agent visually compares the two photos and
// adjudicates a verdict) using three calls instead of one: two single-image
// vision calls that each describe one photo (respecting the "at most 1 image"
// limit), then one text-only reasoning call (NVIDIA_CHAT_MODEL, the same model
// conversationalAgent.mjs already uses for text reasoning) that compares the
// two descriptions and produces the strict JSON verdict. The retry-once-on-
// invalid-JSON pattern from classifyImage() is preserved on that final call.
async function callVerificationModel(complaint, intakeImagePath, citizenProofImagePath) {
  const intakeDescription = await describeImage(intakeImagePath, 'ORIGINAL INTAKE PHOTO (the reported issue)', complaint.id);
  const citizenProofDescription = await describeImage(citizenProofImagePath, "CITIZEN COUNTER-EVIDENCE PHOTO (submitted independently by the citizen — never the officer — specifically to verify whether the officer's resolution claim is genuine)", complaint.id);

  const messages = [{ role: 'user', content: buildVerificationPrompt(complaint, intakeDescription, citizenProofDescription) }];

  // Round 2 Task 5: agent_step 'verification_adjudicate' — kept distinct from
  // 'verification_describe' (see describeImage() below) in run_metrics, since
  // the two call shapes (vision-describe vs. text-adjudicate) have genuinely
  // different token/latency profiles and lumping them together would blur
  // both the p50/p95 latency stats and the cost model's arithmetic.
  let text = await callNvidia({
    model: NVIDIA_CHAT_MODEL,
    messages,
    max_tokens: 512,
    temperature: 0.2,
  }, { agentStep: 'verification_adjudicate', complaintId: complaint.id });

  try {
    return validateVerification(JSON.parse(stripCodeFence(text)));
  } catch (error) {
    // Retry once with a stricter message — mirrors classifyImage()'s pattern in
    // server/nvidia.mjs exactly (same follow-up message text).
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: 'Your previous response was invalid. Return ONLY a valid JSON object matching the schema. Do not include prose or code fences.' });

    text = await callNvidia({
      model: NVIDIA_CHAT_MODEL,
      messages,
      max_tokens: 512,
      temperature: 0.1,
    }, { agentStep: 'verification_adjudicate', complaintId: complaint.id });
    return validateVerification(JSON.parse(stripCodeFence(text)));
  }
}

// Cached independently of the final adjudication call above it, keyed on
// just the image path + label (the same intake photo gets described
// identically on every re-verification attempt for a complaint — only
// citizen_proof usually changes between attempts after an 'inconclusive'
// result — so this is a real second win beyond the outer
// verify-adjudicate cache when only one of the two photos actually changed).
async function describeImage(imagePath, label, complaintId) {
  const cacheKey = hashKey(['verify-describe', DESCRIBE_PROMPT_VERSION, label, imagePath]);

  return withCache(cacheKey, async () => {
    const image = loadImageAsDataPayload(imagePath);
    const content = [
      {
        type: 'text',
        text: `Describe this photo in 2-3 sentences for a municipal civic-complaint verification pipeline. This is the ${label}. Note the setting, visible objects/surfaces, colors, and anything relevant to judging location and condition. Be concrete and literal — do not speculate beyond what's visible. Do not wrap your answer in markdown.`,
      },
      { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
    ];

    const text = await callNvidia({
      model: NVIDIA_VISION_MODEL,
      messages: [{ role: 'user', content }],
      max_tokens: 200,
      temperature: 0.2,
    }, { agentStep: 'verification_describe', complaintId });

    return text.trim();
  });
}

function applyGuardrails(result) {
  let verdict = result.verdict;

  // same_location_likely === false is a strong, specific signal that the proof
  // photo isn't even of the same place as the original report — force disputed.
  if (result.sameLocationLikely === false) {
    verdict = 'disputed';
  }

  // Confidence gate is applied LAST so it is the final authority over any other
  // signal (including the same-location force above): a low-confidence read is
  // never trusted enough to assert anything but 'inconclusive' — consistent with
  // the never-fabricate-a-verdict rule, a shaky read always degrades rather than
  // confidently asserting a dispute.
  if (result.confidence < CONFIDENCE_THRESHOLD) {
    verdict = 'inconclusive';
  }

  return { ...result, verdict };
}

function validateVerification(value) {
  const verdict = value?.verdict;
  const confidence = Number(value?.confidence);
  const reasoning = typeof value?.reasoning === 'string' ? value.reasoning : '';
  const sameLocationLikely = value?.same_location_likely;

  if (
    !['verified', 'disputed', 'inconclusive'].includes(verdict) ||
    !Number.isFinite(confidence) || confidence < 0 || confidence > 1 ||
    typeof sameLocationLikely !== 'boolean'
  ) {
    throw new Error('NVIDIA model returned an invalid verification payload.');
  }

  return { verdict, confidence, reasoning, sameLocationLikely };
}

function buildVerificationPrompt(complaint, intakeDescription, citizenProofDescription) {
  return [
    'You are adjudicating a municipal civic-complaint resolution for the CivicPulse operations dashboard.',
    `Complaint category: ${complaint.category}. Original description: ${complaint.description || '(none provided)'}.`,
    `Description of the ORIGINAL INTAKE PHOTO (the reported issue): ${intakeDescription}`,
    `Description of the CITIZEN'S COUNTER-EVIDENCE PHOTO (submitted independently by the citizen — not the officer — as the check on the officer's resolution claim): ${citizenProofDescription}`,
    "Compare the two descriptions. Judge whether the citizen's counter-evidence photo plausibly shows the same location/issue as the intake photo, and whether it shows the issue has genuinely been resolved.",
    'Return ONLY a JSON object with this exact shape: {"verdict": "verified" | "disputed" | "inconclusive", "confidence": number between 0.0 and 1.0, "reasoning": "one or two sentences, plain language", "same_location_likely": true | false}.',
    '"verified" = the citizen\'s photo credibly shows the same location with the issue resolved. "disputed" = the citizen\'s photo shows a different location/issue, or clearly shows the issue is NOT resolved. "inconclusive" = you cannot tell from the descriptions.',
    'Do not wrap the JSON in markdown code blocks. Return just the JSON string.',
  ].join('\n');
}

function loadImageAsDataPayload(imagePath) {
  const filename = path.basename(imagePath);
  const absolutePath = path.join(uploadsDir, filename);
  const buffer = fs.readFileSync(absolutePath);
  return { data: buffer.toString('base64'), mimeType: mimeFromExt(path.extname(filename)) };
}

function mimeFromExt(ext) {
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return map[ext.toLowerCase()] ?? 'image/jpeg';
}
