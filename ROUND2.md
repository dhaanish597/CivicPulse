# CivicPulse — Round 2 Spec (Top 100 → Top 10)

**Read this entire file before writing any code. Read `PROJECT_SPEC.md` (v2) and
`CIVICPULSE_V3_SPEC.md` (v3) first for context — everything in them is already
built and working. This document supersedes them where they conflict.**

Submission format for this round: **demo video + live prototype link + pitch deck.**
Asynchronous. Judges will open the prototype link cold, days after submission, on
their own network and possibly on a phone. Optimise for that, not for a live pitch.

Time budget: **7 days.** Do not re-architect anything. This document is five
changes, in strict priority order.

---

## 0. What changed since v3, and why

v2 fixed the architecture. v3 fixed the surface and migrated to NVIDIA. Both were
correct. The remaining problem is not technical — it is **positioning**.

Right now CivicPulse reads as: *"an AI that classifies civic complaint photos, with
a map, a chat agent, and some extra workflows."* Every remaining team in the top 100
has a working demo. Feature count is no longer a differentiator; at this stage
breadth reads as lack of focus.

Round 2 rebuilds the pitch around a single documented failure in Hyderabad's actual
civic system, and adds the one feature that solves it. Everything already built
becomes supporting infrastructure for that one thesis.

---

## 1. THE REFRAME (P0 — do this before touching code)

### 1.1 The real problem

These are sourced, verifiable facts about GHMC's grievance system. **Use these
numbers. Do not invent, round, or embellish them. Do not add statistics that are
not in this section.**

| Fact | Source |
|---|---|
| ~600 new grievances registered **per day** in GHMC's Centralised Grievance Redressal System (CGRS), via call centre, MyGHMC app, and representations at HQ/circle/zonal offices | Deccan Chronicle, "GHMC body's redressal mechanism appalling" |
| 74,112 GHMC-related complaints registered on the Prajavani portal between January 2024 and January 2026; ~600 still pending; 1,000+ stuck in ambiguous status categories | RTI disclosure by GHMC PIO, 22 Jan 2026 (filed by RTI activist Kareem Ansari), reported by HyderabadMail |
| Officials were found **marking complaints closed without attending to them**, to impress higher authorities. 170 officials were served show-cause notices after one internal study | Deccan Chronicle |
| A senior GHMC official (anonymous): of every 1,000 grievances received, ~800 are closed as "resolved" without the issue being attended to | Deccan Chronicle |
| GHMC decided to implement a **third-party verification system** to confirm complaints were actually resolved. **Those plans were never implemented.** | Deccan Chronicle |
| GHMC spans 650 sq km, 6 zones, 30 circles, 150 wards (increased to 300 wards after the 2025 delimitation) | GHMC official circles document / Wikipedia, Administrative divisions of Hyderabad |

### 1.2 The new one-line pitch

> **CivicPulse is the closure-verification layer GHMC said it needed and never built.**
>
> A civic complaint system's real failure mode is not intake — GHMC already has four
> intake channels. It is that "resolved" is an unverified claim made by the same
> person accountable for resolving it. CivicPulse makes closure evidence-based:
> the citizen's camera is the auditor, and an AI agent adjudicates.

### 1.3 What this means for existing features

Nothing gets deleted. Everything gets **re-narrated** as serving the verification loop:

- **Classification** → establishes the baseline evidence at intake. Not the product.
- **Agent pipeline / traces** → the audit trail. This is why traces matter: an
  auditable record of *why* the system reached each judgement.
- **Dedup** → prevents the same issue being counted (and closed) multiple times.
- **Hotspot / Forecast / Urgency** → prioritisation of which unverified closures
  and open clusters matter most.
- **Officer Leads Board** → where closure is *requested*, not granted.
- **TrackMyReports** → where the citizen supplies the counter-evidence.
- **Telegram** → second channel, one line of mention, no demo time.
- **Route Advisor** → keep it working, demote to a 10-second mention.
- **Neighborhood Digest (v3 §3.3)** → **CUT. Do not build. Remove if partially built.**

Update `README.md` to lead with §1.1 and §1.2. Cite sources plainly. Keep the
existing "synthetic seed data" disclosure — it is now *more* important, because the
pitch is grounded in real reporting and the two must not be confused.

---

## 2. Real GHMC administrative structure (P0)

The current 20 invented "Ward N — Locality" entries are the most obvious
credibility hole in the build. A Hyderabad-based judge will spot it immediately.

### 2.1 New hierarchy

Replace the flat `ward INTEGER` model with the real three-level structure:

```
Zone (6)  →  Circle (30)  →  Ward (150)
```

The six zones are: **Charminar, L. B. Nagar, Serilingampally, Kukatpally,
Secunderabad, Khairatabad.**

The **circle** is the real operational unit — each is headed by a Deputy
Commissioner. Therefore:
- **Ward Officer** role scopes to a **circle**, not a made-up ward number.
- **City Admin** compares across **zones**.
- Individual complaints still carry a ward name (the finest-grained unit).

### 2.2 Schema migration

Guard with `PRAGMA table_info` checks so restart against an existing DB is safe.

```sql
ALTER TABLE complaints ADD COLUMN zone TEXT;
ALTER TABLE complaints ADD COLUMN circle TEXT;
ALTER TABLE complaints ADD COLUMN ward_name TEXT;
-- keep the legacy `ward INTEGER` and `locality` columns populated for
-- backwards compatibility; do not drop them mid-week.

CREATE TABLE IF NOT EXISTS ghmc_wards (
  ward_no INTEGER PRIMARY KEY,
  ward_name TEXT NOT NULL,
  circle TEXT NOT NULL,
  zone TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL
);
```

### 2.3 Ward reference data

A verified ward reference file will be placed at `server/data/ghmc_wards.json`
**by the human operator** (see §10, task H1). It is authoritative — do not
generate, guess, or pad it.

Until that file exists, code defensively: load it if present, otherwise fall back
to the existing 20-locality table and log a clear one-line warning. **Do not
invent ward names to fill the gap.** If the file is missing at the end of the
build, say so plainly rather than shipping fabricated administrative data.

Coordinates in that file are **approximate locality centroids, not surveyed ward
boundaries** — state this in a code comment and in the README, exactly as v2 did.

### 2.4 Re-seed

Rewrite `server/seed.mjs` to generate complaints against the real structure:
- Volume calibrated to the real figure: **~600 complaints/day** citywide. Seed
  **30 days ≈ 18,000 complaints** (if that's too slow to seed or render, seed 30
  days at a scaled-down but clearly-labelled rate and note the scaling in the
  README — never silently misrepresent the volume).
- Distribute across zones/circles with a deliberate skew so hotspots are real
  signal, not noise. Keep one standout cluster for the demo.
- **New:** seed a realistic proportion of complaints with
  `status = 'resolved'` but `verification_status = 'unverified'` (see §3) —
  this is the *existing state of the world* the pitch describes, and the City
  Admin dashboard should be able to show it on day one.

Any place the UI shows totals, make sure it still performs at this row count
(index `complaints(zone)`, `complaints(circle)`, `complaints(status)`,
`complaints(reported_at)`).

---

## 3. Resolution Verification (P0 — the headline feature)

This is the single feature that wins the round. Build it completely before §4.

### 3.1 The loop

```
Citizen reports  →  agent pipeline (existing)  →  officer works it
       →  officer marks RESOLUTION CLAIMED (not "resolved")
       →  citizen is prompted for a proof photo
       →  VerificationAgent compares intake photo vs proof photo
       →  verified / disputed / inconclusive
       →  only `verified` closes the complaint
```

The critical inversion: **an officer can no longer close a complaint alone.**
Closure requires evidence plus adjudication. That is the product.

### 3.2 Schema

```sql
ALTER TABLE complaints ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'not_required';
-- 'not_required' | 'awaiting_proof' | 'verified' | 'disputed' | 'inconclusive' | 'unverified'
ALTER TABLE complaints ADD COLUMN verification_reasoning TEXT;
ALTER TABLE complaints ADD COLUMN verified_at TEXT;

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  complaint_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'intake' | 'officer_proof' | 'citizen_proof'
  image_path TEXT NOT NULL,    -- relative path on disk, NOT base64 in the DB
  submitted_by TEXT NOT NULL,  -- 'citizen' | 'officer'
  created_at TEXT NOT NULL
);
```

Extend the `status` enum from v3 §3.1 with `resolution_claimed`, sitting between
`in_progress` and `resolved`. Backfill: existing `resolved` rows get
`verification_status = 'unverified'` — they represent the legacy, unaudited world.

**Store images as files on disk under `server/uploads/`, not as base64 blobs in
SQLite.** Serve them via a static route. Cap upload size (~4MB) and reject
non-image mime types.

### 3.3 New agent: `server/agents/verificationAgent.mjs`

Input: complaint record + intake image + proof image.

1. Send **both images in one NVIDIA vision call** with a prompt that asks for a
   strict JSON verdict:
   ```json
   {
     "verdict": "verified" | "disputed" | "inconclusive",
     "confidence": 0.0-1.0,
     "reasoning": "one or two sentences, plain language",
     "same_location_likely": true | false
   }
   ```
2. Reuse the existing `stripCodeFence` / validate / retry-once defensive pattern
   from `server/nvidia.mjs`. If the model returns malformed JSON twice, return
   `inconclusive` with reasoning `"Automated verification unavailable — flagged for
   manual review."` **Never fabricate a verdict.**
3. Apply guardrails in code, not in the prompt:
   - confidence < 0.6 → force `inconclusive` regardless of the model's verdict
   - `same_location_likely === false` → force `disputed`
4. Write a `status_events` row and an `agent_traces` row for the verification step
   so it appears in the existing trace UI.
5. `disputed` must **reopen** the complaint (`status` back to `in_progress`) and
   escalate its urgency score. This is the teeth of the feature — show it in the demo.

**Honesty requirement:** a general-purpose vision model comparing two photos is a
*decision-support signal*, not proof. Say this in the README and on the deck slide.
Frame it as "flags suspicious closures for human review, at a scale humans can't
audit manually" — which is both true and a stronger claim than "detects fraud."

### 3.4 Endpoints

- `POST /api/complaints/:id/evidence` — multipart image upload, body includes
  `kind`. Returns the stored evidence record.
- `POST /api/complaints/:id/verify` — runs `verificationAgent` against the latest
  intake + proof pair, persists the verdict, returns
  `{ verdict, confidence, reasoning, newStatus }`.
- Modify `PATCH /api/complaints/:id/status` — moving to `resolved` is **rejected
  with 409** unless `verification_status === 'verified'`. Officers move to
  `resolution_claimed` instead. Return a clear error message the UI can display.
- `GET /api/verification-stats` — citywide counts by `verification_status`, plus
  a `disputed_rate` and `unverified_legacy_count`. Powers the City Admin hero stat.

### 3.5 New tool for the conversational agent

Add to `server/agents/tools.mjs`:
```
get_verification_status({ complaint_id })
get_disputed_closures({ circle, limit })
```
So a judge can type *"which closures in Kukatpally circle look suspicious?"* into
the chat and get a grounded, tool-backed answer. **Test this exact question works
before submitting** — it is the best possible thing for a judge to try unprompted.

### 3.6 Frontend

- **`OfficerLeadsBoard.tsx`** — the `Resolve` button becomes `Claim Resolution`,
  and opens a proof-photo upload. After upload it shows `Awaiting citizen
  verification`, greyed out. The officer visibly cannot self-close.
- **`TrackMyReports.tsx`** — a report in `resolution_claimed` shows a prominent
  `Verify this fix` card: side-by-side intake photo vs officer proof photo, an
  `Upload your photo` control, and `Confirm fixed` / `Still not fixed` actions.
  After verification, show the agent's verdict, confidence, and reasoning inline.
- **New `VerificationPanel.tsx`** — reusable side-by-side before/after comparison
  with the verdict badge (green verified / red disputed / amber inconclusive) and
  the reasoning text. Used in both places above and in the officer detail view.
- **City Admin** — add one hero stat card above everything else:
  **"X% of closures in the last 30 days are unverified"**, with a drill-down list.
  This is the slide-worthy screen. Make it the best-looking thing in the app.

---

## 4. Reliability hardening (P0 — this silently kills async submissions)

The prototype link must work when a stranger clicks it, cold, on mobile data,
two weeks from now. Ranked by risk:

### 4.1 Backend cold start
Render's free tier spins the service down after inactivity; first request can take
~50s. A judge will not wait.
- Add `GET /health` returning `{ ok: true, ts }` — cheap, no DB write.
- **Human task H2:** register a free uptime pinger against it (see §10).
- **Frontend must never show a blank screen or a bare spinner while waiting.**
  Ship a static snapshot at `public/snapshot.json` (generated at build time from
  the seeded DB — add an `npm run snapshot` script). On load, render from the
  snapshot immediately with a small, honest `Live data loading…` badge, then
  swap to live data when the API responds. If the API never responds, the app
  still looks complete and the badge changes to `Showing cached data`.

### 4.2 NVIDIA rate limits
Judges clicking around will burn the free-tier quota; a 429 mid-review looks like
a broken product.
- Cache every LLM output keyed by its input hash, server-side, with a long TTL.
  Classification, leads, advisories, verification verdicts — all of it.
- Retry with exponential backoff on 429 (already specified in v3 §2 — verify it's
  actually implemented).
- **Every LLM-dependent surface needs a rule-based fallback that still looks
  intentional.** Never render an error string where prose should be.
- Pre-warm the cache for the demo path before recording and before submitting.

### 4.3 CORS
Verify from a phone on mobile data, not just localhost and not just your laptop
on the same wifi. Confirm `ALLOWED_ORIGIN` covers the Vercel production domain
*and* any preview domains a judge might be sent to.

### 4.4 Leftover `dist/index.html` ENOENT
Remove the dead static-serving code from `server/index.mjs`. It's harmless but it
shows up in logs and it is thirty seconds of work.

### 4.5 OSRM
Route Advisor must degrade to a clear `Routing service unavailable` state within
5 seconds. Never a hung spinner. Never a fabricated route.

### 4.6 Empty first-visit states
A judge arriving fresh has empty `localStorage`, so `TrackMyReports` is blank —
the worst possible first impression for the headline feature.
- Add a `Load demo reports` button that populates `localStorage` with 3 seeded
  complaint IDs spanning different states, **including one in
  `resolution_claimed` awaiting verification and one `disputed`.**
- Label it honestly: `Demo data — load sample reports`.
- Every panel gets a designed empty state (v3 §1 already asked for this — verify).

---

## 5. Evaluation harness + instrumentation (P0 — reads as engineering rigour)

Almost no hackathon team does this. It is disproportionately convincing.

### 5.1 Classification eval
- **Human task H3** supplies `evals/labelled/` — 40–60 civic-issue photos in
  category subfolders, hand-labelled.
- Write `evals/run_classification_eval.mjs`: runs each image through the real
  `classifyImage()`, compares to the folder label, and emits
  `evals/results/classification_report.json` + a readable markdown table with
  **per-category precision, recall, F1, a confusion matrix, and mean latency**.
- Rate-limit to stay under the NVIDIA quota; cache results so a re-run is free.
- **Report the real numbers, including the bad ones.** If a category performs
  poorly, that goes on the slide with a one-line explanation. A team that knows
  where its model is weak is more credible than one claiming 99%.

### 5.2 Verification eval
Build a small set of before/after pairs: genuine fixes, obvious non-fixes, and
tricky cases (different angle, different time of day, partial fix). Report the
agent's verdict distribution against your labels. Even 20 pairs is enough. This
directly substantiates the headline feature.

### 5.3 Cost + latency instrumentation
- Log per pipeline run: agent step timings, prompt/completion tokens, estimated
  cost. Persist to a `run_metrics` table.
- Add `GET /api/metrics/summary` → p50/p95 latency per agent step, mean tokens
  and cost per complaint.
- Generate `evals/results/cost_model.md`: **"At GHMC's actual load of ~600
  complaints/day, CivicPulse's inference cost is approximately ₹X/month."**
  Show the arithmetic. State the assumptions. This turns a demo into a
  procurement conversation.

---

## 6. Demo path (defines what UI work matters)

**The video shows exactly one continuous loop.** Everything else is a passing
mention. Screens on the demo path, in order:

1. **City Admin** — cold open on the hero stat: *X% of closures unverified.*
2. **Report Issue** (citizen) — photo submit, agent trace reveals sequentially.
3. **Officer Leads Board** (circle-scoped) — the AI lead, `Claim Resolution`,
   proof photo upload, button greys out.
4. **TrackMyReports** (citizen) — the `Verify this fix` card, side-by-side
   comparison, citizen uploads counter-evidence.
5. **Verification verdict** — `disputed`, reasoning shown, complaint reopens and
   jumps up the officer's queue.
6. **Chat** — *"which closures in Kukatpally circle look suspicious?"* → grounded
   tool-backed answer with `used: get_disputed_closures`.

Only these six screens get UI polish time. Do not touch off-path screens.

---

## 7. UI (P1 — scoped, not another overhaul)

v3 already specified a consistent visual direction. **Do not restart it.** This
round is only:
- Apply the existing direction to the new components (`VerificationPanel`, the
  City Admin hero stat, the claim/verify flows) so they don't look bolted on.
- The verdict badge and the before/after comparison get the most polish in the
  app — they're the money shot.
- The City Admin hero stat should be legible as a still frame in a slide deck.
- Mobile-usable for the citizen screens on the demo path.

---

## 8. Non-negotiables

- **Never break the build.** `npm run typecheck` and `npm run build` after every
  phase. Never leave the repo non-building between changes.
- **Never invent statistics.** The only real-world numbers permitted anywhere in
  code, UI, README, or comments are the ones in §1.1, cited as they are there.
- **Never fabricate GHMC ward data.** If `ghmc_wards.json` is absent, fall back
  and warn loudly. Do not pad a partial list with plausible-sounding names.
- **Never fabricate a verification verdict.** Model failure → `inconclusive`,
  always, with honest reasoning text.
- **Never expose `NVIDIA_API_KEY` or `TELEGRAM_BOT_TOKEN` to the client.**
- **Preserve existing contracts.** `classifyImage()` and `answerWithTools()`
  return shapes must not change.
- **Don't silently stub.** If something here is genuinely infeasible in the time,
  say so directly rather than leaving a mock in place and calling it done.
- Synthetic seed data stays clearly disclosed in the README. The pitch is now
  grounded in real reporting; the demo data is not, and conflating them would be
  the single worst thing this project could do.
- Commit in small logical chunks.

---

## 9. Definition of done

**Reframe**
- [ ] README leads with the closure-verification thesis and the §1.1 sourced facts
- [ ] Neighborhood Digest removed; no dead code left behind

**GHMC structure**
- [ ] Zone → Circle → Ward hierarchy live; officer role scopes to a circle
- [ ] `ghmc_wards.json` loaded, or absence loudly warned about
- [ ] Re-seeded at realistic volume with legacy unverified closures present
- [ ] Indexes added; dashboards still responsive at full row count

**Verification**
- [ ] `evidence` table + disk-backed image storage working
- [ ] `verificationAgent.mjs` returns a validated verdict, with guardrails applied
      in code, and `inconclusive` on model failure
- [ ] Officer **cannot** close a complaint directly — `PATCH` to `resolved`
      returns 409 without a `verified` status, and the UI explains why
- [ ] `disputed` reopens the complaint and escalates its urgency
- [ ] `VerificationPanel` before/after comparison shipped and polished
- [ ] City Admin hero stat: % unverified closures, with drill-down
- [ ] `get_disputed_closures` reachable from chat; the Kukatpally question works

**Reliability**
- [ ] `/health` endpoint live; uptime pinger configured (H2)
- [ ] `public/snapshot.json` fallback renders instantly on cold backend
- [ ] LLM response cache in place; demo path pre-warmed
- [ ] CORS verified from a phone on mobile data
- [ ] `dist/index.html` ENOENT gone
- [ ] OSRM fails gracefully within 5s
- [ ] `Load demo reports` button; every panel has a designed empty state

**Evals**
- [ ] `classification_report.json` + markdown table with real per-category numbers
- [ ] Verification eval over ≥20 before/after pairs
- [ ] `cost_model.md` with the ₹/month figure at 600 complaints/day, arithmetic shown

**Ship**
- [ ] `npm run build` and `npm run typecheck` pass clean
- [ ] Six demo-path screens polished and mobile-usable
- [ ] Prototype link tested in a clean browser profile, on mobile data

---

## 10. Human-only tasks (not for Claude Code)

These require accounts, judgement, or a camera. Claude Code should **not** attempt
them and should not block on them — code defensively around their absence.

- **H1 — GHMC ward reference file.** Get the real ward list from `ghmc.gov.in`
  (Circles/Wards documents) and build `server/data/ghmc_wards.json` with
  `ward_no, ward_name, circle, zone, lat, lng`. Approximate centroids are fine
  and must be labelled as such. 30 wards spread across all 6 zones is enough;
  150 is better if it's quick.
- **H2 — Uptime pinger.** Free account at cron-job.org (or similar), hitting
  `https://<render-backend>/health` every 10 minutes.
- **H3 — Eval photo set.** 40–60 civic issue photos, sorted into category
  subfolders under `evals/labelled/`. Your own phone, around your own city, is
  ideal and defensible. Plus ~20 before/after pairs for the verification eval
  under `evals/pairs/` (subfolders each containing `before.jpg`, `after.jpg`,
  and a `label.txt` of `verified` / `disputed`).
- **H4 — Demo video, deck, submission.** See the companion checklist.
