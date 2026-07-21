# CivicPulse Round 2 — Closure Verification Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe CivicPulse around a single thesis — "the closure-verification layer GHMC said it needed and never built" — and ship the resolution-verification feature (officer claims a fix, citizen supplies counter-evidence, an AI agent adjudicates verified/disputed/inconclusive), on top of a real GHMC zone→circle→ward hierarchy, hardened for a judge opening a cold prototype link on a phone, with an eval harness proving the numbers are real.

**Architecture:** Existing Express + better-sqlite3 + React/Vite app, already running a 7-step agent pipeline (`server/agents/orchestrator.mjs`) against NVIDIA's OpenAI-compatible chat/vision API (`server/nvidia.mjs`). This plan adds one new agent (`verificationAgent.mjs`) and one new closure-evidence subsystem on top of that pipeline, migrates the flat `ward INTEGER` model to a real `zone → circle → ward` hierarchy sourced from `server/data/ghmc_wards.json`, and hardens the whole thing against cold starts, rate limits, and empty first-visit state. No re-architecture — every task extends files that already exist and follow established patterns.

**Tech Stack:** TypeScript/React (Vite) frontend, Node/Express + better-sqlite3 backend, NVIDIA NIM (`meta/llama-3.2-11b-vision-instruct` vision, `meta/llama-3.1-70b-instruct`-class chat) via `server/nvidia.mjs`, Leaflet/react-leaflet for maps.

## Global Constraints

Copied verbatim from `ROUND2.md` §8 (Non-negotiables) — every task below implicitly includes these:

- **Never break the build.** Run `npm run typecheck` and `npm run build` after every task. Never leave the repo non-building between changes.
- **Never invent statistics.** The only real-world numbers permitted anywhere in code, UI, README, or comments are the ones in `ROUND2.md` §1.1, cited as they are there.
- **Never fabricate GHMC ward data.** If `ghmc_wards.json` is absent, fall back and warn loudly. Do not pad a partial list with plausible-sounding names.
- **Never fabricate a verification verdict.** Model failure → `inconclusive`, always, with honest reasoning text.
- **Never expose `NVIDIA_API_KEY` or `TELEGRAM_BOT_TOKEN` to the client.**
- **Preserve existing contracts.** `classifyImage()` and `answerWithTools()` return shapes must not change.
- **Don't silently stub.** If something is genuinely infeasible in the time, say so directly in the task report rather than leaving a mock in place and calling it done.
- Synthetic seed data stays clearly disclosed in the README, and must not be confused with the real sourced facts in §1.1.
- Commit in small logical chunks.

## Orientation findings (Prompt-0 equivalent — already resolved, do not re-litigate)

These were established by reading `PROJECT_SPEC.md`, `CivicPulseV3spec.md`, the actual repo, and the user-supplied `234228561-GHMC-Ward-Wise-Data.xlsx` before this plan was written. Full detail lives in `HUMAN_CHECKLIST.md`; summarized here so implementers don't re-derive it:

1. **Ward data source resolved.** `server/data/ghmc_wards.json` will be generated from the user's uploaded spreadsheet (149 real wards, real zone/circle/ward names, real population) **before Task 1 starts** — see "Pre-Task-1 data prep" below. Implementers do not need to source or invent this file; it will already exist.
2. **Zone-naming conflict, resolved by using the real source data as-is.** `ROUND2.md` §2.1 names the *current* 6 GHMC zones (Charminar, L.B. Nagar, Serilingampally, Kukatpally, Secunderabad, Khairatabad). The user's spreadsheet uses GHMC's *classic/legacy* 4-zone naming (East Zone, South Zone, Central Zone, North Zone — visible in the data itself as "Erstwhile Circle III/IV/V/VI" labels). These do not have a verified 1:1 mapping. **Decision: ship the spreadsheet's real zone/circle/ward names verbatim, do not rename them to the 6-name list.** This is zero-fabrication (100% real, sourced government data) at the cost of not matching the exact zone names `ROUND2.md`'s prose assumed. The schema and code must NOT hardcode the 6 zone names anywhere — treat zone/circle as arbitrary strings loaded from the reference file, not an enum. Flagged for the user in `HUMAN_CHECKLIST.md`.
3. **Ward 16 is missing** from the source spreadsheet (a gap in the source document itself, not a data-entry error on our side) — 149 of 150 wards present. Do not invent ward 16.
4. **Coordinates**: the spreadsheet has no lat/lng. Approximate circle-level centroids (18 circles) are being researched separately and will be merged into `ghmc_wards.json` before Task 1 starts, each one labeled with a confidence level. Any circle where no reasonably-confident coordinate could be found gets `lat: null, lng: null` — Task 1's loader code must handle a ward with null coordinates by falling back to its zone's rough centroid (or omitting it from map rendering, implementer's call, documented either way) rather than crashing or defaulting to `(0,0)`.
5. **Neighborhood Digest was never built.** Grepped the full repo for "digest" — zero code hits, only mentions in spec markdown. Task 1's "remove Neighborhood Digest" step is a no-op; confirm and move on, don't hunt for phantom code.
6. **The two-locality-table duplication**: `server/data/localities.mjs` (backend) and `src/data/hyderabadLocalities.ts` (frontend) are independently-maintained duplicates of the old 20-locality model. Task 1 replaces both with the new ghmc_wards hierarchy; prefer collapsing to a single server-served source (`GET /api/localities`-equivalent already exists) rather than creating a third duplicate file — implementer's call on exact mechanism, but do not leave three copies.
7. **`/health` vs `/api/health`**: `ROUND2.md` §4.1 wants a bare `GET /health` returning `{ok: true, ts}`. The existing `GET /api/health` (`server/index.mjs:42-44`) returns `{status: 'ok'}` and is a different route. Task 4 adds the new bare route; the existing `/api/health` can stay as-is (other code/docs may reference it).
8. **CORS is single-origin today** (`server/index.mjs:38-40`, `origin` is a plain string). Task 4 must change this to support multiple origins (production + preview domains) per `ROUND2.md` §4.3.
9. **NVIDIA retry backoff is linear, not exponential** (`server/nvidia.mjs`'s `generateNvidiaContent()`, `attempt * 1000`ms, 2 retries, 429/5xx only) — `ROUND2.md` §4.2 says "verify it's actually implemented"; it's implemented but linear. Task 4 decides whether linear-with-2-retries is sufficient or needs to become exponential; either is defensible, document the choice.
10. **No LLM response cache exists anywhere.** Task 4 builds this from scratch, and it must wrap classification, leads (`resolutionAgent`), advisories (`routeAgent`), and the new verification agent (Task 2) consistently.
11. **Image uploads today are base64-in-JSON**, not multipart (`ReportIssue.tsx` → `POST /api/complaints`). The new evidence-upload endpoint (Task 2) is the first multipart/file-upload code path in this repo — `multer` is not installed yet and needs adding.
12. **`stripCodeFence`/`validateClassification` in `server/nvidia.mjs` are not exported** — Task 2's `verificationAgent.mjs` needs the same defensive JSON-parsing pattern; either export these from `nvidia.mjs` for reuse or duplicate the two small helpers locally. Prefer exporting (DRY) unless it risks touching `classifyImage()`'s behavior — that function's contract must not change (Global Constraints).
13. **`@supabase/supabase-js` is an unused dependency** — not part of this plan's scope, do not remove it as a drive-by change (out of scope for Round 2, flagged only for awareness).

## Pre-Task-1 data prep (done by the controller, not an implementer subagent)

Before Task 1 is dispatched, the controlling session will have already written `server/data/ghmc_wards.json` (149 entries: `ward_no, ward_name, circle, zone, lat, lng` — `circle` and `zone` are the real values from the spreadsheet, `lat`/`lng` are researched approximate circle-centroids or `null`) directly to disk via the plan's pre-flight step, and will note this in the task dispatch context. Task 1's implementer should treat this file as already-existing input, per §2.3 of `ROUND2.md` ("load it if present").

---

### Task 1: Reframe + GHMC structure

**Files:**
- Modify: `README.md` (full rewrite of the opening section)
- Modify: `server/db.mjs` (schema migration for zone/circle/ward_name + `ghmc_wards` table + indexes)
- Create: `server/data/ghmc_wards.json` (already written by the controller before this task — confirm it exists, do not overwrite)
- Modify: `server/data/localities.mjs` (loader logic: load `ghmc_wards.json` if present, else fall back to the current 20-locality table with one warning line)
- Modify or delete: `src/data/hyderabadLocalities.ts` (collapse into a single source per Orientation Finding #6)
- Modify: `server/seed.mjs` (full rewrite per §2.4)
- Modify: `server/index.mjs` (Ward Officer scoping: accept `?circle=` alongside/instead of `?ward=` on `GET /api/complaints`, `GET /api/dispatch`; real server-side filtering, not UI-only)
- Modify: `src/components/RoleSelect.tsx` (Ward Officer picks a circle, not a ward-number locality)
- Modify: `src/components/OfficerLeadsBoard.tsx`, `WardDashboard.tsx` (consume circle-scoped data instead of ward-scoped)
- Search and remove: any Neighborhood Digest code (expected to be a no-op per Orientation Finding #5 — confirm via grep, report in task report either way)
- Test: manual verification via `npm run typecheck`, `npm run build`, and a scripted reseed-and-query pass (no existing test framework in this repo — see Task 5 for eval harness; this task's "test" is the build/typecheck/manual-query loop below)

**Interfaces:**
- Consumes: `server/data/ghmc_wards.json` (already on disk), the existing `PRAGMA table_info` guarded-migration pattern at `server/db.mjs:55-56` (mirror this shape, don't invent a new migration mechanism)
- Produces: `complaints.zone TEXT`, `complaints.circle TEXT`, `complaints.ward_name TEXT` columns (legacy `ward INTEGER` and `locality` columns stay populated, do not drop); a `loadWardReference()`-equivalent export from `server/data/localities.mjs` (or wherever it ends up) returning `{ wards: [...], source: 'ghmc_wards.json' | 'fallback-20-locality' }` so Task 2+ code and the frontend can tell which mode is active; `GET /api/complaints?circle=` and `GET /api/dispatch?circle=` query filters, real (server-side `WHERE circle = ?`)

- [ ] **Step 1: Add the schema migration**

In `server/db.mjs`, extend the existing `PRAGMA table_info`-guarded block (the one at `:55-56` that adds `status`/`lead`/`status_updated_at`) with the same pattern for the new columns. Exact DDL, from `ROUND2.md` §2.2:

```sql
ALTER TABLE complaints ADD COLUMN zone TEXT;
ALTER TABLE complaints ADD COLUMN circle TEXT;
ALTER TABLE complaints ADD COLUMN ward_name TEXT;

CREATE TABLE IF NOT EXISTS ghmc_wards (
  ward_no INTEGER PRIMARY KEY,
  ward_name TEXT NOT NULL,
  circle TEXT NOT NULL,
  zone TEXT NOT NULL,
  lat REAL,
  lng REAL
);
```

Note `lat`/`lng` are nullable here (not `NOT NULL` as `ROUND2.md` originally wrote it) — Orientation Finding #4 established some circles may not have a confident coordinate. Add indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_complaints_zone ON complaints(zone);
CREATE INDEX IF NOT EXISTS idx_complaints_circle ON complaints(circle);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
```
(`idx_complaints_reported_at` already exists per the audit — confirm, don't duplicate.)

- [ ] **Step 2: Run it against the existing dev DB and confirm no crash**

Run: `node -e "require('./server/db.mjs')"` (or however the module is invoked to trigger init — check `server/db.mjs`'s export/init pattern first) against the existing `server/civicpulse.db`.
Expected: no error, `PRAGMA table_info(complaints)` now lists `zone`, `circle`, `ward_name`.

- [ ] **Step 3: Build the ward-reference loader with the documented fallback**

In `server/data/localities.mjs` (or a new `server/data/wardReference.mjs` if that's cleaner — implementer's call, but only one file should be the source of truth per Orientation Finding #6): on module load, check for `server/data/ghmc_wards.json`. If present, parse it, populate the `ghmc_wards` table (upsert by `ward_no`), and export the ward list from it. If absent, fall back to the existing hardcoded 20-locality array and log exactly one line: something like `[ward-reference] server/data/ghmc_wards.json not found — falling back to 20-locality demo table. Ward-level data will not reflect real GHMC administrative boundaries.` Never synthesize ward names to fill gaps in either path.

- [ ] **Step 4: Rewrite `server/seed.mjs` per §2.4**

Target volume: **30 days ≈ 18,000 complaints** at the real ~600/day rate, distributed across zones/circles with a deliberate skew so one circle is a clear standout hotspot (keep the existing "guarantee one demo hotspot" pattern the current seed already uses for ward 8, just retarget it at a real circle from `ghmc_wards.json`). **If 18,000 rows makes seeding or any dashboard render unacceptably slow, do not silently drop the volume** — scale down to a clearly-labeled lower rate (e.g. seed 30 days at 100/day and add a one-line README/console note: "seeded at a reduced rate for local dev performance; real GHMC volume is ~600/day, see ROUND2.md §1.1") and say so explicitly in the task report so the controller can decide whether that's acceptable.

Seed a realistic proportion of `status = 'resolved'` rows with `verification_status = 'unverified'` (the `verification_status` column itself is added in Task 2 — if Task 1 runs before Task 2's migration exists, either order the migrations so this column exists by the time seed.mjs runs, or seed a plain `resolved` status now and let Task 2's backfill step (see Task 2 Step 1) retroactively set `verification_status = 'unverified'` on all pre-existing resolved rows. Prefer the backfill approach — it's simpler and matches what `ROUND2.md` §3.2 already specifies as the backfill rule for legacy rows, so Task 1 does not need to know about a column it doesn't own yet).

- [ ] **Step 5: Ward Officer scoping — server-side, not UI-only**

In `server/index.mjs`, add `circle` as a real filter on `GET /api/complaints` and `GET /api/dispatch` (alongside the existing `ward` param — don't remove `ward` filtering, it's still used by legacy/citizen-facing code). In `RoleSelect.tsx`, change the Ward Officer's picker from "assigned ward" (a locality from the old 20-list) to "assigned circle" (from the new ward-reference data), and store `circle` in `RoleContext` instead of/alongside `ward`. Update `OfficerLeadsBoard.tsx` and `WardDashboard.tsx` to fetch with `?circle=` instead of `?ward=` when the loaded role has a circle. Verify by hand: pick two different circles as two different "officer" sessions, confirm each only sees their own circle's complaints via the Network tab, not just via hidden UI.

- [ ] **Step 6: Confirm Neighborhood Digest is genuinely absent**

Run a repo-wide case-insensitive search for `digest` outside `node_modules`/`dist`/markdown files. Expected: zero code hits (confirmed by prior audit). State this explicitly in the task report rather than skipping it silently — the Definition of Done checklist item exists and should be checked off with evidence, not assumed.

- [ ] **Step 7: Rewrite the README opening**

Replace the current README's opening section with the closure-verification thesis (`ROUND2.md` §1.2, quoted verbatim) and the sourced facts table (§1.1, quoted verbatim, exact numbers, no additions). Keep the existing "synthetic seed data" disclosure section, but add one sentence distinguishing it from the §1.1 facts: something like "The problem statement above is sourced, real reporting. The demo data populating this prototype (complaints, ward activity, resolution history) is synthetic — do not confuse the two." Also add one sentence disclosing the ward zone-naming decision from Orientation Finding #2 (real government data, legacy zone naming, not the current 6-zone names) — this is exactly the kind of honest disclosure `ROUND2.md` asks for elsewhere and prevents a judge finding it first.

- [ ] **Step 8: Verify and commit**

Run: `npm run typecheck && npm run build`
Expected: both pass clean.
Then manually: start the server, confirm `/api/complaints?circle=<a real circle name>` returns only that circle's rows, and that a role-select flow with a circle-scoped officer only shows that circle's leads.
Commit: `git add -A && git commit -m "feat: migrate to real GHMC zone/circle/ward hierarchy, reframe README around verification thesis"`

---

### Task 2: Verification feature — backend

**Files:**
- Modify: `server/db.mjs` (evidence table, `verification_status`/`verification_reasoning`/`verified_at` columns, status enum extension, backfill)
- Create: `server/agents/verificationAgent.mjs`
- Modify: `server/nvidia.mjs` (export `stripCodeFence`/`validateClassification`-equivalent helpers if reused per Orientation Finding #12)
- Modify: `server/index.mjs` (4 new/changed endpoints, `multer` wiring, static route for `server/uploads/`)
- Modify: `server/agents/tools.mjs` (2 new tools)
- Modify: `server/agents/conversationalAgent.mjs` only if the tool-calling loop needs changes to support the new tools (check first — it likely doesn't, since `tools.mjs` is already the registry it reads from)
- Modify: `package.json` (add `multer`)
- Test: manual end-to-end curl/script run (documented in Step 6 below) — this repo has no automated test framework; the verification-of-record for this task is the literal request/response transcript from a real run, per `ROUND2.md`'s Prompt 2 instruction to "show me the actual request/response log from that run, not a description of it"

**Interfaces:**
- Consumes: Task 1's `zone`/`circle`/`ward_name` columns (verification doesn't touch these directly, but shares the same `complaints` table); the existing `PRAGMA table_info` migration pattern; `generateNvidiaContent()` / the vision-call shape from `classifyImage()` in `server/nvidia.mjs` (mirror its message-array-with-two-images shape, not a new client)
- Produces: `evidence` table; `complaints.verification_status` (`'not_required' | 'awaiting_proof' | 'verified' | 'disputed' | 'inconclusive' | 'unverified'`), `complaints.verification_reasoning`, `complaints.verified_at`; `status` enum gains `'resolution_claimed'` (between `in_progress` and `resolved`); `runVerification(complaintId)`-equivalent export from `verificationAgent.mjs` returning `{ verdict, confidence, reasoning, sameLocationLikely }`; endpoints `POST /api/complaints/:id/evidence`, `POST /api/complaints/:id/verify`, `PATCH /api/complaints/:id/status` (409 behavior added), `GET /api/verification-stats`; tools `get_verification_status({ complaint_id })`, `get_disputed_closures({ circle, limit })` registered in `tools.mjs`'s existing `toolDeclarations`/`executeTool()` pattern

- [ ] **Step 1: Schema migration + backfill**

Add to `server/db.mjs`'s migration block, same `PRAGMA table_info` guard pattern as Task 1:

```sql
ALTER TABLE complaints ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE complaints ADD COLUMN verification_reasoning TEXT;
ALTER TABLE complaints ADD COLUMN verified_at TEXT;

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  image_path TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Backfill: `UPDATE complaints SET verification_status = 'unverified' WHERE status = 'resolved' AND verification_status = 'not_required';` — this covers both truly-legacy rows and Task 1's freshly-seeded legacy-resolved rows (Task 1 Step 4 deferred this exact backfill to here). Extend the status-validation array at `server/index.mjs:77` to include `'resolution_claimed'` (full enum: `['reported', 'acknowledged', 'in_progress', 'resolution_claimed', 'resolved']`).

- [ ] **Step 2: Set up file storage**

Add `multer` to `package.json`. Create `server/uploads/` (add to `.gitignore` if not already covered). Wire a static route (`app.use('/uploads', express.static(...))` or equivalent) so stored images are servable. Cap upload size to ~4MB and reject non-image mime types at the multer config level (`fileFilter`), not after the fact.

- [ ] **Step 3: `server/agents/verificationAgent.mjs`**

Input: complaint record + intake image path + proof image path. Send both images in **one** NVIDIA vision call (mirror the message-array shape `classifyImage()` uses in `server/nvidia.mjs`, i.e. `content: [{type:'text',...}, {type:'image_url',...}, {type:'image_url',...}]` with two image entries instead of one). Prompt for strict JSON:

```json
{
  "verdict": "verified" | "disputed" | "inconclusive",
  "confidence": 0.0-1.0,
  "reasoning": "one or two sentences, plain language",
  "same_location_likely": true | false
}
```

Reuse the exact `stripCodeFence`/validate/retry-once pattern from `server/nvidia.mjs:7-42` (the `classifyImage()` implementation) — parse, validate shape, and on failure retry once with the same stricter "return ONLY valid JSON" follow-up message shown in that function. **If the model returns malformed JSON on the retry too, return `{ verdict: 'inconclusive', confidence: 0, reasoning: 'Automated verification unavailable — flagged for manual review.', sameLocationLikely: null }` — never let the second failure propagate as an unhandled error, and never fabricate a verdict.**

Apply guardrails in code after getting a structured response, not in the prompt:
- `confidence < 0.6` → force `verdict = 'inconclusive'` regardless of what the model said
- `same_location_likely === false` → force `verdict = 'disputed'`

Write one `agent_traces` row (`step_name: 'Verification'`) and one `status_events` row for the verification step, matching the existing shape those tables already use elsewhere in the pipeline (check `orchestrator.mjs` for the exact row-writing calls to mirror).

If the final verdict is `'disputed'`: set `complaints.status = 'in_progress'` (reopen) and escalate urgency — call the existing `urgencyAgent`/`scoreUrgency()` path to recompute with a bump, or apply a documented fixed escalation if recomputing isn't straightforward; either is acceptable, document which in the task report.

- [ ] **Step 4: Endpoints**

`POST /api/complaints/:id/evidence` — multipart upload (`multer`), body includes `kind` (`'intake' | 'officer_proof' | 'citizen_proof'`). Validates `complaint_id` exists, writes the file under `server/uploads/`, inserts an `evidence` row, returns the row.

`POST /api/complaints/:id/verify` — loads the latest `intake` evidence row and latest `officer_proof`/`citizen_proof` row for the complaint, calls `verificationAgent`, persists `verification_status`/`verification_reasoning`/`verified_at`, returns `{ verdict, confidence, reasoning, newStatus }`.

`PATCH /api/complaints/:id/status` — add: moving to `status: 'resolved'` returns **409** unless the complaint's current `verification_status === 'verified'`. The 409 response body must carry a human-readable message, e.g. `{ error: "Cannot close a complaint without verified proof of resolution.", verification_status: "<current value>" }` so the frontend (Task 3) can render it directly. Officers moving toward closure go through `'resolution_claimed'` first (allowed unconditionally, same as any other status transition), and that transition should set `verification_status = 'awaiting_proof'`.

`GET /api/verification-stats` — citywide counts grouped by `verification_status`, plus `disputed_rate` (disputed / total verified-or-disputed) and `unverified_legacy_count` (count where `verification_status = 'unverified'`).

- [ ] **Step 5: New tools**

In `server/agents/tools.mjs`, following the existing `toolDeclarations`/`executeTool()` pattern used by the other 7 tools:

```
get_verification_status({ complaint_id }) -> { verification_status, verification_reasoning, verified_at }
get_disputed_closures({ circle, limit }) -> [{ complaint_id, category, circle, ward_name, verification_reasoning, verified_at }, ...]
```

No changes to `conversationalAgent.mjs`'s loop should be needed since it already reads from `tools.mjs`'s registry generically — confirm this is true by reading the file; if the loop does need a change, make the minimal one and note why in the task report.

- [ ] **Step 6: End-to-end verification (this is the task's test)**

Run a real sequence against the running dev server and capture the actual output:
1. `POST /api/complaints` with a real photo → get a complaint id.
2. `PATCH /api/complaints/:id/status` with `{status: 'resolution_claimed'}`.
3. `POST /api/complaints/:id/evidence` with a **genuinely different** photo, `kind: 'officer_proof'`.
4. `POST /api/complaints/:id/evidence` again with another different photo, `kind: 'citizen_proof'`.
5. `POST /api/complaints/:id/verify`.
6. Confirm the response shows `verdict: 'disputed'` (since the photos are of different things) and that a follow-up `GET /api/complaints/:id` shows `status: 'in_progress'` (reopened) and an escalated urgency.
7. Also confirm `PATCH .../status {status:'resolved'}` on a complaint whose `verification_status` is not `'verified'` returns 409 with the documented error body.

Include the literal terminal output/curl transcript from this run in the task report — not a paraphrase.

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck && npm run build`
Commit: `git add -A && git commit -m "feat: resolution verification backend — evidence upload, verificationAgent, 409-gated closure"`

---

### Task 3: Verification feature — frontend

**Files:**
- Create: `src/components/VerificationPanel.tsx`
- Modify: `src/components/OfficerLeadsBoard.tsx`
- Modify: `src/components/TrackMyReports.tsx`
- Modify: `src/components/CityAdmin.tsx`
- Modify: `src/types/index.ts` (add `verification_status`, `resolution_claimed` etc. to the `Complaint` type — Orientation Finding notes this type is currently stale/loosely-cast; this is a natural point to fix it properly rather than adding more `any` casts)
- Modify: `src/services/*` as needed for the new endpoints (follow the existing service-file pattern, e.g. wherever `createComplaint`/`fetchNearbyIssues` live)

**Interfaces:**
- Consumes: Task 2's exact endpoint contracts — `POST /api/complaints/:id/evidence`, `POST /api/complaints/:id/verify`, the 409 body shape from `PATCH /api/complaints/:id/status`, `GET /api/verification-stats`
- Produces: `VerificationPanel` component with props `{ intakeImageUrl, proofImageUrl, verdict?, confidence?, reasoning? }` reused in 3 places (Officer detail, TrackMyReports, and standalone)

- [ ] **Step 1: Read the ui-ux-pro-max and frontend-design skills, and read the existing visual patterns**

Before writing any JSX/CSS, read the `ui-ux-pro-max` and `frontend-design` skills (per `ROUND2.md` §3.6/§7's instruction), and read `src/components/MapView.tsx`, `KPICard.tsx`, and `AgentActivityPanel.tsx` to match the established visual direction from the v3 UI pass exactly — spacing scale, accent-color logic, existing badge/pill patterns if any exist. Do not start a new design direction.

- [ ] **Step 2: Build `VerificationPanel.tsx`**

Side-by-side before/after image comparison (intake vs proof), a verdict badge (green `verified` / red `disputed` / amber `inconclusive`, with a distinct "awaiting" state before a verdict exists), and the reasoning text rendered plainly below. This is explicitly called out as the most-watched component in the demo — invest the most polish here of anything in this task. Props-driven, no data fetching inside the component itself (parent components own the fetch).

- [ ] **Step 3: Wire into `OfficerLeadsBoard.tsx`**

The existing `Resolve` button (final action in the `Acknowledge → Start Work → Resolve` chain, per the audit at `OfficerLeadsBoard.tsx`) becomes `Claim Resolution`. Clicking it opens a proof-photo upload control (`POST /api/complaints/:id/evidence`, `kind: 'officer_proof'`) instead of directly calling the status PATCH. After a successful upload, PATCH status to `resolution_claimed`, then show the card in a visibly disabled/greyed state with the label `Awaiting citizen verification` — the officer must not have any control left to close the complaint from this screen.

- [ ] **Step 4: Wire into `TrackMyReports.tsx`**

A report whose `status === 'resolution_claimed'` shows a prominent `Verify this fix` card using `VerificationPanel` in its "awaiting" mode (intake photo vs the officer's proof photo, no verdict yet), plus an `Upload your photo` control (`POST /api/complaints/:id/evidence`, `kind: 'citizen_proof'`) and `Confirm fixed` / `Still not fixed` actions that both ultimately trigger `POST /api/complaints/:id/verify` (the actual verdict comes from the agent regardless of which button the citizen presses — the buttons are about citizen intent/framing, not about overriding the model; if this feels wrong, flag it in the task report rather than silently deciding). After verification, render `VerificationPanel` in its resolved mode with the real verdict/confidence/reasoning.

- [ ] **Step 5: City Admin hero stat**

Add one hero stat card above everything else in `CityAdmin.tsx`: `"X% of closures in the last 30 days are unverified"`, sourced from `GET /api/verification-stats`. This must be legible as a still frame in a slide deck — treat it as a poster, not a widget (large type, high contrast, minimal surrounding chrome). Add a drill-down list (click through to see which complaints make up the unverified count). Note per Orientation Finding, `CityAdmin.tsx` currently takes `complaints` as a prop and doesn't fetch on its own — this new stat needs its own fetch of `/api/verification-stats`, which is a new pattern for this component; keep it self-contained (component fetches this one stat itself) rather than threading it through `App.tsx`'s prop chain, unless that chain already exists for a good reason — check first.

- [ ] **Step 6: Empty and loading states**

Every new/changed panel gets a designed empty state (v3 already required this pattern elsewhere — match it) and a loading state, not a bare spinner or blank div.

- [ ] **Step 7: Mobile check**

Verify `TrackMyReports`, `OfficerLeadsBoard`'s claim-resolution flow, and the City Admin hero stat are usable at mobile width (resize the browser to ~375px wide, or use devtools device emulation) — these are citizen/demo-path screens per `ROUND2.md` §6/§7.

- [ ] **Step 8: Verify and commit**

Run: `npm run typecheck && npm run build`
Then manually walk: submit a report → officer claims resolution with a proof photo → citizen sees the Verify card → citizen uploads a deliberately different photo → sees a disputed verdict → complaint reappears higher in the officer's queue. Screenshot or describe what's actually on screen at each step in the task report.
Commit: `git add -A && git commit -m "feat: verification UI — VerificationPanel, claim/verify flows, City Admin hero stat"`

---

### Task 4: Reliability hardening

**Files:**
- Modify: `server/index.mjs` (bare `/health` route, CORS multi-origin, remove dead `dist/index.html` static-serving code)
- Create: `server/cache.mjs` (or similar — shared LLM response cache)
- Modify: `server/nvidia.mjs`, `server/agents/classificationAgent.mjs`, `server/agents/resolutionAgent.mjs`, `server/agents/routeAgent.mjs`, `server/agents/verificationAgent.mjs` (wrap with the cache)
- Modify: `server/routing.mjs` (add a hard timeout to the OSRM fetch)
- Modify: `package.json` (add `npm run snapshot` script)
- Create: `public/snapshot.json` generation script (e.g. `scripts/generate-snapshot.mjs`)
- Modify: frontend data-loading entry point(s) (wherever the app currently does its first fetch — likely `App.tsx` or a context provider) to render from the snapshot immediately with a `Live data loading…` badge, then swap to live data
- Modify: `src/components/TrackMyReports.tsx` (add `Load demo reports` button)
- Modify: `.env.example` (add `ALLOWED_ORIGIN`, `NODE_ENV`, `PORT` — currently used in code but undocumented, per Orientation audit)

**Interfaces:**
- Consumes: every NVIDIA-calling agent from Tasks 2 and earlier (classification, resolution/leads, route advisory, verification)
- Produces: `GET /health` → `{ ok: true, ts: <ISO timestamp> }`; a cache wrapper function (e.g. `withCache(cacheKey, fn)`) importable by all LLM-calling agents

- [ ] **Step 1: `GET /health`**

Add a bare route (not under `/api`) returning `{ ok: true, ts: new Date().toISOString() }`, no DB write, no auth. Keep the existing `GET /api/health` as-is (other things may depend on it).

- [ ] **Step 2: LLM response cache**

Build a cache keyed by a hash of the meaningful input (e.g. image bytes hash + prompt version for classification; complaint id + evidence ids for verification; question text + tool context for chat where sensible — chat is inherently less cacheable, focus effort on classification/leads/advisories/verification first per `ROUND2.md` §4.2's explicit list). Persist server-side (a SQLite table is simplest and consistent with the rest of the stack — e.g. `llm_cache(key TEXT PRIMARY KEY, value TEXT, created_at TEXT)`) with a long TTL (document the chosen TTL, e.g. 7 days, in a comment). Wrap `classifyImage()`'s caller in `classificationAgent.mjs`, `resolutionAgent.mjs`'s lead-generation call, `routeAgent.mjs`'s advisory call, and Task 2's `verificationAgent.mjs` — each keyed appropriately for its own inputs.

Verify the existing 429 retry/backoff in `generateNvidiaContent()` (`server/nvidia.mjs`) is actually exercised — per Orientation Finding #9 it's linear (1s, 2s), 2 retries, 429/5xx only. Decide whether that's sufficient (it likely is for a hackathon judge's usage pattern) or bump it to true exponential backoff; document the decision either way, don't just assume without checking.

- [ ] **Step 3: Rule-based fallback text everywhere an LLM output could be missing**

Audit every LLM-dependent surface (classification, leads, advisories, verification) for what happens on total failure (cache miss + API failure). None should ever render a raw error string where prose belongs — each needs a rule-based fallback that reads as intentional (the existing `generateFallbackLead()` pattern in `resolutionAgent.mjs` and the local keyword classifier in `classificationAgent.mjs` are the templates to match; `verificationAgent.mjs` already has its `inconclusive` fallback from Task 2).

- [ ] **Step 4: Remove dead `dist/index.html` static-serving code**

Delete the block at `server/index.mjs:172-192` identified in the audit (the `isProduction` branch that serves `dist/` — dead in the actual Vercel/Render split-deployment topology). Confirm the dev-mode Vite middleware path still works after removal (`npm run dev` should still serve the app locally in dev).

- [ ] **Step 5: CORS multi-origin**

Change `server/index.mjs:38-40`'s `cors({ origin: ... })` from a single string to a function or array that accepts the production Vercel domain and Vercel preview domains (typically a wildcard pattern like `*.vercel.app` plus the exact production domain — implementer's call on the exact matching logic, document it). Add `ALLOWED_ORIGIN` to `.env.example` with a comment explaining the expected format, since it's currently used in code (`render.yaml`) but undocumented there.

- [ ] **Step 6: OSRM timeout**

In `server/routing.mjs`, add an `AbortController`-based timeout (5 seconds) to the OSRM fetch. On timeout or any OSRM failure, the existing straight-line-distance fallback path in `routeAgent.mjs` should still trigger (confirm it does; if the current catch doesn't cover an aborted-fetch error shape, fix that).

- [ ] **Step 7: `public/snapshot.json` + `npm run snapshot`**

Add a script (`scripts/generate-snapshot.mjs` or similar) that reads from the seeded DB and writes a static `public/snapshot.json` at build time, containing enough data for the frontend to render a complete-looking initial view (complaints list, hotspots, verification-stats) without a live API call. Wire it as `npm run snapshot` in `package.json`. On the frontend's initial load, render from this snapshot immediately with a small `Live data loading…` badge, then swap to live-fetched data when the API responds; if the API never responds (timeout), change the badge to `Showing cached data` instead of hanging or showing a blank/error state.

- [ ] **Step 8: `Load demo reports` button**

In `TrackMyReports.tsx`, add a button labeled `Demo data — load sample reports` that populates `localStorage['civicpulse_my_reports']` with 3 seeded complaint IDs spanning different states, **including one in `resolution_claimed` (awaiting verification) and one already `disputed`** — pull real IDs from the seeded DB at button-click time via a small new endpoint or by shipping 3 known-good IDs from the snapshot data, implementer's call, document which.

- [ ] **Step 9: Cold-start simulation**

Stop the local backend entirely, load the frontend fresh, and confirm it still renders a complete-looking UI (from the snapshot) rather than a blank screen or bare spinner. Describe or screenshot what's actually on screen in the task report — this is the exact scenario `ROUND2.md` §4.1 is worried about.

- [ ] **Step 10: Verify and commit**

Run: `npm run typecheck && npm run build`
Commit: `git add -A && git commit -m "fix: reliability hardening — health check, snapshot fallback, LLM cache, CORS, OSRM timeout"`

---

### Task 5: Evals + instrumentation

**Files:**
- Create: `evals/run_classification_eval.mjs`
- Create: `evals/run_verification_eval.mjs`
- Modify: `server/db.mjs` (`run_metrics` table)
- Modify: every LLM-calling agent (log timing/tokens/cost per step to `run_metrics`)
- Modify: `server/index.mjs` (`GET /api/metrics/summary`)
- Create: `evals/results/cost_model.md`

**Interfaces:**
- Consumes: `classifyImage()` (unchanged contract), Task 2's `verificationAgent`, `evals/labelled/` and `evals/pairs/` directories (human-supplied per H3 — **may not exist yet**, code defensively around their absence, see Step 1)
- Produces: `evals/results/classification_report.json`, `evals/results/classification_report.md`, `evals/results/verification_eval.md`, `run_metrics` table, `GET /api/metrics/summary`, `evals/results/cost_model.md`

- [ ] **Step 1: Handle the missing-eval-data case explicitly**

`evals/labelled/` (photos) and `evals/pairs/` (before/after pairs) are human-supplied tasks (H3 in `HUMAN_CHECKLIST.md`) and likely do not exist yet at the time this task runs. Both eval scripts must detect an empty/missing input directory and exit with a clear message (`"evals/labelled/ is empty or missing — run this after H3 is complete. See HUMAN_CHECKLIST.md."`), not crash with an unhandled error and not silently produce a fake/empty report claiming success. Build and commit the scripts regardless — they need to be ready to run the moment the photos exist. If sample/placeholder images happen to exist for smoke-testing the script's mechanics, use those to verify the script *works* mechanically, and say clearly in the task report that the resulting numbers are from placeholder data, not the real eval.

- [ ] **Step 2: `evals/run_classification_eval.mjs`**

Reads `evals/labelled/<category>/*.jpg`-style subfolders, runs each image through the real `classifyImage()`, compares predicted category to the folder-name label. Emits `evals/results/classification_report.json` (raw data: per-image prediction, per-category precision/recall/F1, a confusion matrix, mean latency) and a readable markdown table version. Rate-limit calls to stay under NVIDIA's free-tier quota (reuse whatever backoff/delay pattern `generateNvidiaContent()` already has, or add an explicit inter-request delay). Cache results per-image (hash the image, skip re-classifying on a re-run) so repeated runs are free — this can reuse Task 4's cache infrastructure if that task is already done, or a simple local file-based cache if run standalone; document which.

- [ ] **Step 3: `evals/run_verification_eval.mjs`**

Reads `evals/pairs/<case>/{before.jpg, after.jpg, label.txt}`, runs each pair through `verificationAgent`, compares the agent's verdict to the label (`verified`/`disputed`), and reports the verdict distribution (confusion-style: how many labeled-verified pairs came back verified/disputed/inconclusive, and same for labeled-disputed pairs) in `evals/results/verification_eval.md`.

**Both eval scripts: report the real numbers including bad ones.** If a category or case type performs poorly, note it plainly in the output — do not tune prompts specifically to make the eval look better and then report the tuned number as if it were the baseline; if a prompt does get tuned as a result of running this eval, report both the before and after numbers in the markdown output.

- [ ] **Step 4: `run_metrics` table + instrumentation**

```sql
CREATE TABLE IF NOT EXISTS run_metrics (
  id TEXT PRIMARY KEY,
  complaint_id TEXT,
  agent_step TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  estimated_cost_usd REAL,
  created_at TEXT NOT NULL
);
```

Add logging calls at each NVIDIA-calling agent step (classification, resolution/lead, route advisory, verification) recording timing and, where the NVIDIA response includes usage/token counts, those too (if the NVIDIA API response doesn't reliably include token usage, estimate from input/output length and document the estimation method — don't leave the column always null without explanation).

- [ ] **Step 5: `GET /api/metrics/summary`**

Returns p50/p95 latency per `agent_step`, mean tokens and estimated cost per complaint, computed from `run_metrics`.

- [ ] **Step 6: `evals/results/cost_model.md`**

Compute estimated monthly inference cost **at GHMC's actual real-world load of ~600 complaints/day** (the exact figure from `ROUND2.md` §1.1 — do not round or adjust it), using the real per-complaint cost/token figures from `run_metrics` (or, if metrics data is sparse because Task 4/5 haven't produced enough real traffic yet, use NVIDIA's published rate-card figures with the assumption stated explicitly). Show the arithmetic step by step, state every assumption (calls per complaint, tokens per call, price per token/request), and produce a final ₹/month figure. This should read as something a procurement person could sanity-check, not a single unexplained number.

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck && npm run build`
Run both eval scripts against whatever data exists (real or explicitly-flagged placeholder) and confirm they produce output without crashing.
Commit: `git add -A && git commit -m "feat: eval harness + cost/latency instrumentation"`

---

### Task 6: Final pass — Definition of Done walk + demo-path defect sweep

**Files:** none predetermined — this task reads the whole repo state and fixes whatever it finds.

**Interfaces:**
- Consumes: everything from Tasks 1–5
- Produces: a written done/partial/not-done report against `ROUND2.md` §9, plus fixes for the highest-impact defects found

- [ ] **Step 1: Walk `ROUND2.md` §9 (Definition of Done) item by item**

For every checkbox in that section, check the actual code/behavior (not the git log, not task reports from earlier — verify directly) and record: done / partially done / not done, with the specific evidence (file/line, or a command run and its output).

- [ ] **Step 2: Walk the six demo-path screens from `ROUND2.md` §6**

In a clean browser profile (or at least a hard-refreshed one with cache/localStorage cleared) at mobile width, walk: City Admin hero stat → Report Issue with trace reveal → Officer Leads Board claim flow → TrackMyReports verify card → a disputed verdict reopening a complaint → the chat question "which closures in Kukatpally circle look suspicious?" (substitute a real circle name from `ghmc_wards.json` if "Kukatpally" isn't one of the loaded circles — check Orientation Finding #2, the loaded zone/circle names are the legacy ones, not the 6-name list `ROUND2.md`'s example question assumes; use whichever real circle is standing in as this build's demo hotspot from Task 1 Step 4). List every visual or functional defect found, ranked by how likely a judge is to notice it.

- [ ] **Step 3: Fix the highest-ranked defects**

Fix what's fixable in scope; for anything not fixed, state clearly in the report why (time, genuine infeasibility, needs human input) rather than leaving it unmentioned.

- [ ] **Step 4: Final verify and commit**

Run: `npm run typecheck && npm run build`
Commit: `git add -A && git commit -m "fix: Round 2 final pass — DoD verification and demo-path defect fixes"`
