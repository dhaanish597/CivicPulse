# CivicPulse Round 2 — Claude Code Prompts + Your Own Task List

Put `ROUND2.md` in the repo root next to `PROJECT_SPEC.md` and
`CIVICPULSE_V3_SPEC.md`. Run the prompts below **in order**, one session per
phase. Don't paste two at once — the phases depend on each other and a single
mega-prompt will produce shallow work on the later ones.

Between every phase: `npm run typecheck && npm run build`, then commit.

---

## Prompt 0 — Orientation (run once, cheap, worth it)

```
Read ROUND2.md in full, then read PROJECT_SPEC.md and CIVICPULSE_V3_SPEC.md
for context. Then read the actual repo — server/, src/, the DB schema — and
tell me:

1. Anything in ROUND2.md that conflicts with what's actually built, or that's
   already done.
2. Anything in ROUND2.md you think is a bad idea, with your reasoning.
3. The files you'd touch for each of ROUND2.md sections 2, 3, 4, and 5.
4. Anything you'd need from me before you can start.

Do not write any code yet. Just report.
```

Read the answer properly before continuing. If it flags a conflict, resolve it
now, not at 2am on day six.

---

## Prompt 1 — Reframe + GHMC structure (ROUND2.md §1 and §2)

```
Implement ROUND2.md sections 1 and 2 only. Do not start section 3.

Specifically:
- Rewrite README.md to lead with the closure-verification thesis (§1.2) and the
  sourced facts table (§1.1). Cite sources exactly as written there. Do not add
  any statistic not in that table.
- Remove Neighborhood Digest (v3 §3.3) entirely, including any partial
  implementation and dead imports.
- Migrate the schema to the Zone -> Circle -> Ward hierarchy per §2.2, guarded
  by PRAGMA table_info so restarts are safe.
- Load server/data/ghmc_wards.json if it exists. If it does not exist, fall back
  to the current 20-locality table and log ONE clear warning line. Do not invent
  ward names under any circumstances.
- Rewrite server/seed.mjs per §2.4, including seeding legacy resolved-but-
  unverified complaints.
- Scope the Ward Officer role to a CIRCLE instead of a ward number, server-side,
  with real query filtering — not UI hiding.
- Add the indexes listed in §2.4.

Run npm run typecheck and npm run build when done, fix anything broken, and
report what you changed. If seeding at the specified volume makes any screen
slow, tell me rather than silently reducing the volume.
```

---

## Prompt 2 — Verification feature, backend (ROUND2.md §3.1–3.5)

This is the important one. Give it a fresh session with full context.

```
Implement ROUND2.md section 3, BACKEND ONLY (3.1 through 3.5). Do not touch
frontend components yet.

Build:
- The schema changes and evidence table in §3.2, with images stored as files on
  disk under server/uploads/, served via a static route. Enforce the size and
  mime-type limits.
- server/agents/verificationAgent.mjs per §3.3. Both images in a single NVIDIA
  vision call. Reuse the existing stripCodeFence / validate / retry-once pattern
  from server/nvidia.mjs. Apply the confidence and same_location guardrails in
  CODE, not in the prompt. On repeated model failure return 'inconclusive' with
  honest reasoning text — never fabricate a verdict.
- Write agent_traces and status_events rows for the verification step so it
  shows up in the existing trace UI.
- 'disputed' must reopen the complaint and escalate its urgency score.
- The four endpoints in §3.4, including the 409 on PATCH to 'resolved' without
  a verified status. The 409 body must carry a message the UI can display.
- The two new tools in §3.5, wired into the existing tool-calling loop.

Then verify end to end before reporting: submit a complaint, claim resolution
with a proof photo, run verification with a genuinely different photo, and
confirm you get a 'disputed' verdict that reopens the complaint. Show me the
actual request/response log from that run, not a description of it.
```

---

## Prompt 3 — Verification feature, frontend (ROUND2.md §3.6 and §7)

```
Implement ROUND2.md section 3.6 and section 7.

Build VerificationPanel.tsx first — the side-by-side before/after comparison
with the verdict badge and reasoning. It's reused in three places and it's the
most-watched component in the demo, so make it the best-looking thing in the app.

Then wire it into OfficerLeadsBoard.tsx (Claim Resolution + proof upload,
button greys out to 'Awaiting citizen verification') and TrackMyReports.tsx
(the 'Verify this fix' card).

Then the City Admin hero stat card: "X% of closures in the last 30 days are
unverified", fed by GET /api/verification-stats, with a drill-down list. It has
to be legible as a still frame in a slide deck — treat it as a poster, not a
widget.

Follow the visual direction already established in the v3 UI pass. Do NOT start
a new design direction. Read the ui-ux-pro-max and frontend-design skills first.

Mobile-usable for the citizen screens. Designed empty and loading states for
everything new.
```

---

## Prompt 4 — Reliability hardening (ROUND2.md §4)

```
Implement ROUND2.md section 4 in full.

Priorities in order:
1. GET /health, plus the public/snapshot.json cold-start fallback and the
   'npm run snapshot' script. The app must render a complete-looking UI
   instantly even if the backend takes 50 seconds to wake, with an honest
   loading badge that changes to 'Showing cached data' on total failure.
2. Server-side LLM response cache keyed by input hash, long TTL, covering
   classification, leads, advisories, and verification verdicts. Verify the
   429 retry-with-backoff from v3 is actually implemented.
3. Rule-based fallback text for every LLM-dependent surface. No raw error
   strings rendered where prose belongs.
4. Remove the dead dist/index.html static-serving code.
5. OSRM: hard 5-second timeout, clean 'Routing service unavailable' state.
6. The 'Load demo reports' button in TrackMyReports per §4.6, seeding three
   reports including one awaiting verification and one disputed.

Then simulate a cold backend (stop the local server) and load the frontend.
Screenshot what a judge would see. If it looks broken, fix it and repeat.
```

---

## Prompt 5 — Evals and instrumentation (ROUND2.md §5)

```
Implement ROUND2.md section 5.

- evals/run_classification_eval.mjs reading from evals/labelled/, producing
  evals/results/classification_report.json and a readable markdown table with
  per-category precision, recall, F1, a confusion matrix, and mean latency.
  Rate-limit to stay under the NVIDIA free quota and cache results so re-runs
  are free.
- evals/run_verification_eval.mjs reading before/after pairs from evals/pairs/,
  reporting the verdict distribution against my labels.
- run_metrics table + GET /api/metrics/summary with p50/p95 per agent step and
  mean tokens/cost per complaint.
- evals/results/cost_model.md computing the monthly inference cost at 600
  complaints/day, with the arithmetic and assumptions shown explicitly.

Report the REAL numbers including the bad ones. If a category performs poorly,
say so and suggest why. Do not tune the prompt to game the eval and then report
the tuned number as the baseline — if you improve the prompt, report both.
```

---

## Prompt 6 — Final pass (day 6–7)

```
Read ROUND2.md section 9 (definition of done) and walk the entire checklist
against the actual repo. For each item, tell me: done / partially done / not
done, with the evidence. Don't take the git log's word for it — check the code.

Then walk the six demo-path screens in section 6 in a clean browser profile at
mobile width, and list every visual or functional defect you find, ranked by
how likely a judge is to notice it.

Fix the top defects. Report anything you couldn't fix and why.
```

---

# Your own tasks (don't delegate these)

## Day 1
- [ ] **H1 — GHMC ward data.** Go to `ghmc.gov.in`, find the Circles/Wards
      documents, build `server/data/ghmc_wards.json`
      (`ward_no, ward_name, circle, zone, lat, lng`). 30 wards across all 6
      zones is the minimum useful version; do more if it's fast. Get
      approximate coordinates from Google Maps — label them approximate.
      **Claude Code is blocked on nothing without this, but the credibility
      win is real. Do it first.**
- [ ] Read Prompt 0's output properly.

## Day 2
- [ ] **H3a — Eval photo set.** 40–60 photos of real civic issues, sorted into
      category subfolders under `evals/labelled/`. Shoot them yourself around
      Gummidipundi / Chennai. That they're not Hyderabad doesn't matter and is
      easy to justify; that they're real, unstaged, and yours matters a lot.
- [ ] **H2 — Uptime pinger.** cron-job.org free account → `GET /health` every
      10 minutes. Two minutes of work, prevents the worst failure mode.

## Day 3
- [ ] **H3b — Verification pairs.** ~20 before/after pairs under `evals/pairs/`.
      Photograph a bin full then emptied, a puddle then dry ground, litter then
      cleared. Include deliberately hard cases: same place different angle,
      different time of day, a *partial* fix. Each folder gets `before.jpg`,
      `after.jpg`, `label.txt`.
- [ ] Test the deployed link from your phone on **mobile data**, not wifi.

## Day 4
- [ ] Read the eval results yourself. Decide which numbers go on the deck and
      how you'll narrate the weak ones. Weakness narrated well beats strength
      claimed vaguely.

## Day 5
- [ ] **Write the video script before you record.** 3 minutes, one continuous
      loop, the six screens in ROUND2.md §6. Structure:
      - 0:00–0:25 — the problem, with the RTI number and the "800 of 1,000
        closed without being attended to" line. No product yet.
      - 0:25–0:35 — one sentence: what CivicPulse is.
      - 0:35–2:20 — the loop, uninterrupted. Report → lead → claim → verify →
        disputed → reopened.
      - 2:20–2:40 — the chat question, the eval numbers, the cost figure.
      - 2:40–3:00 — architecture in one frame, what's real vs simulated, close.
- [ ] Pre-warm the LLM cache along the exact demo path.

## Day 6
- [ ] Record. Do a silent dry run first to catch dead air. Record in one take
      per segment; don't try for one take overall.
- [ ] Build the deck. Slide order that works: Problem (with sources) → the
      unimplemented verification system GHMC promised → CivicPulse in one line →
      the loop (screenshots) → architecture → eval numbers → cost at real load →
      what's real vs simulated → roadmap.

## Day 7
- [ ] Open the prototype link in a **fresh incognito profile on a phone on
      mobile data**, having not touched the app for an hour so Render is cold.
      Click through as a judge would. This is the single highest-value 10
      minutes of the week.
- [ ] Submit early. Portal queues at deadline are a real and stupid way to lose.

---

## Two things worth saying plainly

**On the eval numbers:** if classification accuracy comes back mediocre in some
categories, that goes on the slide. A team that measured its model and knows
where it's weak reads as more competent than one claiming a number nobody
believes. This is also just true, which matters.

**On the verification claim:** a vision model comparing two photos flags
suspicious closures — it doesn't prove fraud. Say exactly that. The honest
version of the claim ("audits closures at a scale humans can't") is stronger
than the overclaimed one, and it survives a judge's follow-up question. The
overclaimed one doesn't.
