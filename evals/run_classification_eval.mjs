#!/usr/bin/env node
// Round 2 Task 5, Step 2 (ROUND2.md §5.1) — classification eval harness.
//
// Reads evals/labelled/<category>/*.jpg-style subfolders (human task H3a,
// see HUMAN_CHECKLIST.md), runs each image through the REAL classifyImage()
// pipeline (via server/agents/classificationAgent.mjs's runClassification(),
// the same entry point the live app uses — see below), compares the
// predicted category to the folder-name label, and emits:
//   - evals/results/classification_report.json — raw per-image predictions,
//     per-category precision/recall/F1, a confusion matrix, mean latency.
//   - evals/results/classification_report.md — the readable version.
//
// CACHING: this deliberately does NOT build a separate eval-only cache. It
// calls runClassification(), which wraps classifyImage() in Task 4's shared
// server/cache.mjs (`llm_cache` SQLite table, keyed by a hash of the prompt
// version + text note + image bytes). Re-running this script against the
// same photos is therefore free — a cache hit on every image, zero new
// NVIDIA calls — with no extra code in this file.
//
// RATE LIMITING: an explicit fixed delay runs between images (EVAL_DELAY_MS,
// default 1500ms below every image regardless of whether it turned out to be
// a cache hit — simpler than pre-checking the cache, and 1500ms keeps this
// comfortably under the ~40 requests/minute community baseline NVIDIA's own
// developer forum describes for API-Catalog access — see server/pricing.mjs
// for that same research). Override with EVAL_DELAY_MS=<ms> if needed.
//
// MISSING DATA: if evals/labelled/ doesn't exist, or exists but contains no
// images, this prints a clear message and exits 0 — it does not crash and
// does not fabricate a report. Exit 0 (not a failure code) because "H3 isn't
// done yet" is an expected, not-broken state for this repo right now.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Must run BEFORE importing anything that reads process.env.NVIDIA_API_KEY at
// call time (server/nvidia.mjs) — this script is invoked standalone (`node
// evals/run_classification_eval.mjs`), not through server/index.mjs, so
// nothing else loads .env for it.
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

const { runClassification } = await import('../server/agents/classificationAgent.mjs');
const LABELLED_DIR = path.join(rootDir, 'evals', 'labelled');
const RESULTS_DIR = path.join(rootDir, 'evals', 'results');
const IMG_EXTENSIONS = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);
const EVAL_DELAY_MS = Number(process.env.EVAL_DELAY_MS) || 1500;

async function main() {
  const images = collectLabelledImages(LABELLED_DIR);

  if (images.length === 0) {
    console.error('evals/labelled/ is empty or missing — run this after H3 is complete. See HUMAN_CHECKLIST.md.');
    process.exit(0);
  }

  console.log(`Found ${images.length} labelled image(s) across ${new Set(images.map((i) => i.label)).size} categor${new Set(images.map((i) => i.label)).size === 1 ? 'y' : 'ies'} under evals/labelled/.`);
  console.log(`Rate limit: ${EVAL_DELAY_MS}ms between images.\n`);

  const perImage = [];
  let fallbackCount = 0;

  for (let i = 0; i < images.length; i += 1) {
    const { label, filePath } = images[i];
    const relPath = path.relative(rootDir, filePath);
    process.stdout.write(`[${i + 1}/${images.length}] ${relPath} ... `);

    const startedAt = Date.now();
    let result;
    try {
      const image = loadImageAsPayload(filePath);
      result = await runClassification({ textNote: '', image });
    } catch (error) {
      // runClassification() itself never throws (it degrades to a local
      // fallback on any NVIDIA failure) — this catch exists only in case a
      // corrupt/unreadable image file throws before that point, so one bad
      // file never aborts the whole eval run.
      console.log(`SKIPPED (${error.message})`);
      continue;
    }
    const latencyMs = Date.now() - startedAt;

    if (result.fallback) fallbackCount += 1;

    console.log(`predicted "${result.category}" (true "${label}") — ${result.fallback ? 'LOCAL FALLBACK, ' : ''}${latencyMs}ms`);

    perImage.push({
      file: relPath,
      trueLabel: label,
      predictedLabel: result.category,
      severity: result.severity,
      fallback: Boolean(result.fallback),
      latencyMs,
    });

    if (i < images.length - 1) {
      await sleep(EVAL_DELAY_MS);
    }
  }

  if (perImage.length === 0) {
    console.error('\nNo images could be classified (all were skipped). No report written.');
    process.exit(0);
  }

  const metrics = computeMetrics(perImage);
  const meanLatencyMs = Math.round(perImage.reduce((s, r) => s + r.latencyMs, 0) / perImage.length);

  const report = {
    generatedAt: new Date().toISOString(),
    imageCount: perImage.length,
    fallbackCount,
    meanLatencyMs,
    accuracy: metrics.accuracy,
    perCategory: metrics.perCategory,
    confusionMatrix: metrics.matrix,
    labels: metrics.labels,
    perImage,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, 'classification_report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, 'classification_report.md'), renderMarkdown(report));

  console.log(`\nWrote evals/results/classification_report.json and .md`);
  console.log(`Accuracy: ${metrics.accuracy === null ? 'n/a' : (metrics.accuracy * 100).toFixed(1) + '%'} | Mean latency: ${meanLatencyMs}ms | Fallback (NVIDIA unavailable): ${fallbackCount}/${perImage.length}`);
}

function collectLabelledImages(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const images = [];

  for (const entry of entries) {
    const categoryDir = path.join(dir, entry.name);
    const files = fs.readdirSync(categoryDir).filter((f) => IMG_EXTENSIONS.has(path.extname(f).toLowerCase()));
    for (const file of files) {
      images.push({ label: entry.name, filePath: path.join(categoryDir, file) });
    }
  }

  return images;
}

function loadImageAsPayload(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = IMG_EXTENSIONS.get(ext) || 'image/jpeg';
  const data = fs.readFileSync(filePath).toString('base64');
  return { data, mimeType };
}

// sklearn-style: the label set is the union of true and predicted labels
// actually seen, not the app's full fixed category list — so an eval set
// that only covers 3 of the app's 6 categories doesn't get padded with
// meaningless all-zero rows for the other 3.
function computeMetrics(perImage) {
  const labels = Array.from(new Set(perImage.flatMap((r) => [r.trueLabel, r.predictedLabel]))).sort();
  const matrix = {};
  for (const trueLabel of labels) {
    matrix[trueLabel] = Object.fromEntries(labels.map((predicted) => [predicted, 0]));
  }
  for (const r of perImage) {
    matrix[r.trueLabel][r.predictedLabel] += 1;
  }

  const perCategory = {};
  for (const label of labels) {
    const tp = matrix[label][label] || 0;
    let fp = 0;
    let fn = 0;
    for (const other of labels) {
      if (other === label) continue;
      fp += matrix[other][label] || 0;
      fn += matrix[label][other] || 0;
    }
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : null;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : null;
    const f1 = (precision !== null && recall !== null && (precision + recall) > 0)
      ? (2 * precision * recall) / (precision + recall)
      : null;
    perCategory[label] = {
      support: perImage.filter((r) => r.trueLabel === label).length,
      precision,
      recall,
      f1,
    };
  }

  const correct = perImage.filter((r) => r.trueLabel === r.predictedLabel).length;
  const accuracy = perImage.length > 0 ? correct / perImage.length : null;

  return { labels, matrix, perCategory, accuracy };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Classification eval report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push(`- Images evaluated: **${report.imageCount}**`);
  lines.push(`- Overall accuracy: **${report.accuracy === null ? 'n/a' : (report.accuracy * 100).toFixed(1) + '%'}**`);
  lines.push(`- Mean latency: **${report.meanLatencyMs}ms** per image (end-to-end, includes cache hits on a re-run — see script header)`);
  lines.push(`- Local-fallback predictions (NVIDIA unavailable, rule-based keyword match used instead): **${report.fallbackCount}/${report.imageCount}**${report.fallbackCount > 0 ? ' — these do NOT reflect real model accuracy, see per-image table' : ''}`);
  lines.push('');

  lines.push('## Per-category precision / recall / F1');
  lines.push('');
  lines.push('| Category | Support | Precision | Recall | F1 |');
  lines.push('|---|---|---|---|---|');
  for (const label of report.labels) {
    const m = report.perCategory[label];
    lines.push(`| ${label} | ${m.support} | ${fmtPct(m.precision)} | ${fmtPct(m.recall)} | ${fmtPct(m.f1)} |`);
  }
  lines.push('');

  const weak = report.labels.filter((label) => {
    const f1 = report.perCategory[label].f1;
    return f1 !== null && f1 < 0.7;
  });
  if (weak.length > 0) {
    lines.push('## Known weaknesses');
    lines.push('');
    for (const label of weak) {
      const m = report.perCategory[label];
      lines.push(`- **${label}**: F1 ${fmtPct(m.f1)} (support ${m.support}) — the model is measurably unreliable on this category; do not claim otherwise on the slide.`);
    }
    lines.push('');
  }

  lines.push('## Confusion matrix (rows = true label, columns = predicted)');
  lines.push('');
  lines.push(`| True \\ Predicted | ${report.labels.join(' | ')} |`);
  lines.push(`|---|${report.labels.map(() => '---').join('|')}|`);
  for (const trueLabel of report.labels) {
    const row = report.labels.map((predicted) => report.confusionMatrix[trueLabel][predicted]);
    lines.push(`| **${trueLabel}** | ${row.join(' | ')} |`);
  }
  lines.push('');

  lines.push('## Per-image results');
  lines.push('');
  lines.push('| File | True | Predicted | Correct | Fallback | Latency (ms) |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of report.perImage) {
    lines.push(`| ${r.file} | ${r.trueLabel} | ${r.predictedLabel} | ${r.trueLabel === r.predictedLabel ? 'yes' : 'no'} | ${r.fallback ? 'yes' : ''} | ${r.latencyMs} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function fmtPct(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('Classification eval failed unexpectedly:', error);
  process.exit(1);
});
