#!/usr/bin/env node
// Round 2 Task 4, Step 7 (ROUND2.md §4.1): generates public/snapshot.json —
// a static fallback so the frontend can render a complete-looking initial
// view (complaints list, hotspots, verification stats) even before the live
// backend responds, or if it never does at all (Render's free tier spins
// down after inactivity; first request can take ~50s — a judge will not
// wait, per ROUND2.md §4.1).
//
// Run via `npm run snapshot` (also chained in front of `npm run build`, see
// package.json, so a forgotten manual step can't ship a stale snapshot).
// Safe to run standalone on a completely fresh checkout — it seeds the DB
// first (seedIfEmpty() is a no-op if the DB is already populated) so this
// never depends on the dev server having been started first.
//
// Defensive by design: this script must NEVER be able to break `npm run
// build`. Any failure while reading the DB — including '../server/db.mjs'
// and '../server/seed.mjs' failing to even load (both transitively import
// the native 'better-sqlite3' addon, which can fail at import time if a
// build platform lacks a matching prebuilt binary for its OS/Node ABI) —
// falls back to writing a small, honestly-labelled empty snapshot (source:
// 'fallback-empty') instead of throwing and aborting the whole build. Those
// two modules are therefore imported dynamically *inside* buildSnapshot(),
// so the same try/catch in main() covers both the imports and the query
// logic. '../server/analytics.mjs' has no imports of its own (pure
// functions only), so it can't fail at load time and stays a static import.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectHotspots } from '../server/analytics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(__dirname, '..', 'public', 'snapshot.json');

// Complaints are capped, not dumped whole — the seeded DB holds ~18,000 rows
// (several MB as JSON), which would defeat the entire point of an
// instant-render fallback on a judge's phone over mobile data. Hotspots and
// verification stats below are still computed over the FULL dataset so
// those headline numbers stay accurate; only the raw per-complaint list
// rendered in list/map views is a representative recent-first slice
// (listComplaints() already orders by reported_at DESC).
const MAX_COMPLAINTS = 400;

async function buildSnapshot() {
  // Dynamic + inside this function (called only from within main()'s
  // try/catch) so a native-module load failure in either module is caught
  // right alongside every other failure mode — see header comment.
  const [{ seedIfEmpty }, { getVerificationStats, listComplaints }] = await Promise.all([
    import('../server/seed.mjs'),
    import('../server/db.mjs'),
  ]);

  seedIfEmpty();

  const allComplaints = listComplaints();
  const complaints = allComplaints.slice(0, MAX_COMPLAINTS);
  const hotspots = detectHotspots(allComplaints, 30);
  const verificationStats = getVerificationStats();

  return {
    generatedAt: new Date().toISOString(),
    source: 'seeded-db',
    totalComplaintsInDb: allComplaints.length,
    complaints,
    hotspots,
    verificationStats,
  };
}

function emptyFallbackSnapshot(reason) {
  return {
    generatedAt: new Date().toISOString(),
    source: 'fallback-empty',
    reason: String(reason),
    totalComplaintsInDb: 0,
    complaints: [],
    hotspots: [],
    verificationStats: {
      counts: {
        not_required: 0,
        awaiting_proof: 0,
        verified: 0,
        disputed: 0,
        inconclusive: 0,
        unverified: 0,
      },
      disputed_rate: 0,
      unverified_legacy_count: 0,
    },
  };
}

async function main() {
  let snapshot;
  try {
    snapshot = await buildSnapshot();
  } catch (error) {
    console.error(
      '[generate-snapshot] Failed to build snapshot from the seeded DB — writing an empty fallback instead so `npm run build` is never blocked by this script.',
      error,
    );
    snapshot = emptyFallbackSnapshot(error instanceof Error ? error.message : String(error));
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(snapshot));

  console.log(
    `[generate-snapshot] Wrote ${outputPath} (${snapshot.complaints.length} of ${snapshot.totalComplaintsInDb} complaints, source: ${snapshot.source}).`,
  );
}

await main();
