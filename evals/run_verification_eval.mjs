#!/usr/bin/env node
// Round 2 Task 5, Step 3 (ROUND2.md §5.2) — verification eval harness.
//
// Reads evals/pairs/<case>/{before.jpg, after.jpg, label.txt} (human task
// H3b, see HUMAN_CHECKLIST.md — label.txt contains "verified" or "disputed"),
// runs each pair through the REAL adjudication logic in
// verificationAgent.mjs#adjudicateVerification() (before.jpg as the original
// intake photo, after.jpg as the citizen's counter-evidence — matching
// runVerification()'s own parameter order), and reports the verdict
// distribution against the hand-labels in evals/results/verification_eval.md.
//
// WHY adjudicateVerification(), not runVerification(): runVerification() is
// verificationAgent.mjs's normal entry point, but it has a DB-mutation tail
// (insertAgentTrace, and on a 'disputed' verdict: updateComplaintStatus,
// escalateSeverity, insertStatusEvent) that assumes `complaint` is a real row
// in the `complaints` table. This eval's cases don't correspond to real
// complaints, so during Task 5 testing runVerification() actually crashed on
// a 'disputed' verdict — escalateSeverity() re-reads the row via
// getComplaintById(), gets null back for a synthetic id, and runVerification()'s
// own scoreUrgency(null, ...) call then throws (see task-5-report.md for the
// live error). adjudicateVerification() is the same model-calling logic
// (cache lookup, callVerificationModel, guardrails) WITHOUT that DB-mutation
// tail — a small Task 5 refactor of verificationAgent.mjs that runVerification()
// itself now calls too, so its own behavior/contract is unchanged.
//
// That function's image loader (loadImageAsDataPayload in
// verificationAgent.mjs) resolves paths by basename against server/uploads/
// regardless of what directory prefix is passed in — a real, pre-existing
// constraint of that function, not something this eval works around — so
// each case's before/after photos are first copied into server/uploads/
// under unique EVAL-<case>-* names (server/uploads/ is gitignored — see
// .gitignore — so these never get committed).
//
// CACHING: adjudicateVerification()'s calls are wrapped in Task 4's shared
// server/cache.mjs (`llm_cache`), keyed on (among other things) the complaint
// id + image paths used here — so re-running this script against the same
// case folders is a full cache hit, zero new NVIDIA calls, with no extra
// code in this file.
//
// RATE LIMITING: EVAL_DELAY_MS (default 1500ms) between cases. Each case is
// 3 real NVIDIA calls on a cache miss (2 vision describe + 1 chat adjudicate
// — see verificationAgent.mjs's own comment on why 3, not 1), so this is
// more conservative per-case than the classification eval's per-image delay.
//
// MISSING DATA: if evals/pairs/ doesn't exist, or exists but contains no
// complete {before, after, label.txt} case, this prints a clear message and
// exits 0 — it does not crash and does not fabricate a report.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Must run BEFORE importing anything that reads process.env.NVIDIA_API_KEY at
// call time (server/nvidia.mjs) — this script is invoked standalone (`node
// evals/run_verification_eval.mjs`), not through server/index.mjs, so
// nothing else loads .env for it.
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

const { adjudicateVerification } = await import('../server/agents/verificationAgent.mjs');
const PAIRS_DIR = path.join(rootDir, 'evals', 'pairs');
const RESULTS_DIR = path.join(rootDir, 'evals', 'results');
const UPLOADS_DIR = path.join(rootDir, 'server', 'uploads');
const IMG_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const VALID_LABELS = ['verified', 'disputed'];
const EVAL_DELAY_MS = Number(process.env.EVAL_DELAY_MS) || 1500;

async function main() {
  const cases = collectPairs(PAIRS_DIR);

  if (cases.length === 0) {
    console.error('evals/pairs/ is empty or missing — run this after H3 is complete. See HUMAN_CHECKLIST.md.');
    process.exit(0);
  }

  console.log(`Found ${cases.length} verification pair(s) under evals/pairs/.`);
  console.log(`Rate limit: ${EVAL_DELAY_MS}ms between cases (each case is up to 3 real NVIDIA calls on a cache miss).\n`);

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const results = [];

  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i];
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.name} (label: ${c.label}) ... `);

    const beforeUploadPath = copyIntoUploads(c.beforePath, `EVAL-${sanitize(c.name)}-before`);
    const afterUploadPath = copyIntoUploads(c.afterPath, `EVAL-${sanitize(c.name)}-after`);

    const complaint = {
      id: `EVAL-${sanitize(c.name)}`,
      category: 'Reported Issue',
      description: `Eval pair: ${c.name}`,
      ward: 0,
      severity: 3,
      status: 'resolution_claimed',
    };

    let verdictResult;
    try {
      verdictResult = await adjudicateVerification(complaint, beforeUploadPath, afterUploadPath);
    } catch (error) {
      console.log(`SKIPPED (${error.message})`);
      continue;
    }

    console.log(`verdict "${verdictResult.verdict}" (confidence ${verdictResult.confidence})`);

    results.push({
      case: c.name,
      trueLabel: c.label,
      verdict: verdictResult.verdict,
      confidence: verdictResult.confidence,
      reasoning: verdictResult.reasoning,
    });

    if (i < cases.length - 1) {
      await sleep(EVAL_DELAY_MS);
    }
  }

  if (results.length === 0) {
    console.error('\nNo pairs could be verified (all were skipped). No report written.');
    process.exit(0);
  }

  const report = buildDistribution(results);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, 'verification_eval.md'), renderMarkdown(results, report));

  console.log(`\nWrote evals/results/verification_eval.md`);
  console.log(`Verified-label cases: ${JSON.stringify(report.verified)}`);
  console.log(`Disputed-label cases: ${JSON.stringify(report.disputed)}`);
}

function collectPairs(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const cases = [];

  for (const entry of entries) {
    const caseDir = path.join(dir, entry.name);
    const beforePath = findImage(caseDir, 'before');
    const afterPath = findImage(caseDir, 'after');
    const labelPath = path.join(caseDir, 'label.txt');

    if (!beforePath || !afterPath || !fs.existsSync(labelPath)) {
      console.warn(`Skipping evals/pairs/${entry.name}/ — needs before.*, after.*, and label.txt (missing ${[!beforePath && 'before', !afterPath && 'after', !fs.existsSync(labelPath) && 'label.txt'].filter(Boolean).join(', ')}).`);
      continue;
    }

    const label = fs.readFileSync(labelPath, 'utf-8').trim().toLowerCase();
    if (!VALID_LABELS.includes(label)) {
      console.warn(`Skipping evals/pairs/${entry.name}/ — label.txt must be "verified" or "disputed", found "${label}".`);
      continue;
    }

    cases.push({ name: entry.name, beforePath, afterPath, label });
  }

  return cases;
}

function findImage(dir, stem) {
  for (const ext of IMG_EXTENSIONS) {
    const candidate = path.join(dir, `${stem}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function copyIntoUploads(sourcePath, targetStem) {
  const ext = path.extname(sourcePath).toLowerCase();
  const filename = `${targetStem}${ext}`;
  fs.copyFileSync(sourcePath, path.join(UPLOADS_DIR, filename));
  return `/uploads/${filename}`;
}

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildDistribution(results) {
  const dist = {
    verified: { verified: 0, disputed: 0, inconclusive: 0 },
    disputed: { verified: 0, disputed: 0, inconclusive: 0 },
  };
  for (const r of results) {
    dist[r.trueLabel][r.verdict] += 1;
  }
  return dist;
}

function renderMarkdown(results, dist) {
  const lines = [];
  lines.push('# Verification eval report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`- Pairs evaluated: **${results.length}**`);
  const verifiedTotal = dist.verified.verified + dist.verified.disputed + dist.verified.inconclusive;
  const disputedTotal = dist.disputed.verified + dist.disputed.disputed + dist.disputed.inconclusive;
  const verifiedAccuracy = verifiedTotal > 0 ? dist.verified.verified / verifiedTotal : null;
  const disputedAccuracy = disputedTotal > 0 ? dist.disputed.disputed / disputedTotal : null;
  lines.push(`- Labeled-\`verified\` cases correctly returned \`verified\`: **${fmtPct(verifiedAccuracy)}** (${dist.verified.verified}/${verifiedTotal})`);
  lines.push(`- Labeled-\`disputed\` cases correctly returned \`disputed\`: **${fmtPct(disputedAccuracy)}** (${dist.disputed.disputed}/${disputedTotal})`);
  lines.push('');

  lines.push('## Verdict distribution (confusion-style)');
  lines.push('');
  lines.push('| True label | → verified | → disputed | → inconclusive | Total |');
  lines.push('|---|---|---|---|---|');
  lines.push(`| verified | ${dist.verified.verified} | ${dist.verified.disputed} | ${dist.verified.inconclusive} | ${verifiedTotal} |`);
  lines.push(`| disputed | ${dist.disputed.verified} | ${dist.disputed.disputed} | ${dist.disputed.inconclusive} | ${disputedTotal} |`);
  lines.push('');

  lines.push('## Per-case results');
  lines.push('');
  lines.push('| Case | True label | Verdict | Confidence | Correct | Reasoning |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of results) {
    const correct = r.trueLabel === r.verdict ? 'yes' : (r.verdict === 'inconclusive' ? 'inconclusive' : 'no');
    lines.push(`| ${r.case} | ${r.trueLabel} | ${r.verdict} | ${r.confidence} | ${correct} | ${r.reasoning.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');

  const misses = results.filter((r) => r.trueLabel !== r.verdict);
  if (misses.length > 0) {
    lines.push('## Misses (real numbers, including the bad ones)');
    lines.push('');
    for (const r of misses) {
      lines.push(`- **${r.case}**: labeled \`${r.trueLabel}\`, agent returned \`${r.verdict}\` (confidence ${r.confidence}). ${r.reasoning}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function fmtPct(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('Verification eval failed unexpectedly:', error);
  process.exit(1);
});
