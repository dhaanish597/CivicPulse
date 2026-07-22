# CivicPulse inference cost model

Generated: 22 Jul 2026 (Round 2, Task 5). This document shows every number and
every assumption used to reach the ₹/month figure at the end, so it can be
sanity-checked line by line rather than taken on faith.

**Headline: at GHMC's actual real-world load of ~600 complaints/day
(ROUND2.md §1.1), CivicPulse's NVIDIA inference cost is approximately
$21.17/month ≈ ₹2,041/month.**

That number is small enough to look suspicious, so this document shows the
full arithmetic and states every input plainly, including which inputs are
real measurements, which are sourced facts, and which are estimates.

---

## 1. Complaint volume

**~600 new grievances/day**, GHMC's Centralised Grievance Redressal System
(CGRS) — the exact figure from ROUND2.md §1.1 (source there: Deccan
Chronicle, "GHMC body's redressal mechanism appalling"). Used unrounded and
unadjusted, per that section's own instruction.

## 2. Real NVIDIA call shapes per complaint

Confirmed by reading each agent file directly (not assumed) during Task 5:

| Step | Model | Real call count | When it fires |
|---|---|---|---|
| Classification | vision (`meta/llama-3.2-11b-vision-instruct`) | 1 (baseline) | Every new complaint, at intake (`server/agents/classificationAgent.mjs` → `server/nvidia.mjs#classifyImage`). A 2nd call fires only if the first response fails JSON validation (`server/nvidia.mjs`'s retry-once path) — an exception, not the norm; see §6 for its effect on the total. |
| Resolution lead | chat (`meta/llama-3.1-70b-instruct`) | 1 | Once per complaint, the first time it's marked `in_progress` (`server/agents/resolutionAgent.mjs#generateLead`). **Assumption**: every complaint passes through `in_progress` exactly once — the standard workflow, not separately measured at scale. |
| Verification | 2× vision + 1× chat = **3 calls** | Once per complaint that reaches a claimed resolution | `server/agents/verificationAgent.mjs`. Originally speced as 1 call; NVIDIA's vision endpoint rejects more than 1 image per prompt (`"At most 1 image(s) may be provided in one prompt"`, a real 400 response — see task-2-report.md), so the working design is 2 single-image vision "describe" calls + 1 text adjudication call. |
| Route advisory | chat | ~1 per check | Officer-initiated, on-demand (`server/agents/routeAgent.mjs`) — not tied to a complaint 1:1. **Excluded from the per-complaint arithmetic below** (see §5). |
| Chat (`/api/chat`) | chat | ~1 per question | Citizen/officer-initiated, open-ended. **Excluded** (see §5), same as route advisory. |

### How many complaints reach verification?

Not every complaint reaches a resolution claim. Rather than invent a figure,
this model uses GHMC's own disclosed number from ROUND2.md §1.1: *"of every
1,000 grievances received, ~800 are closed as 'resolved'"* — **80%**. This
model assumes verification runs once per complaint that reaches that point.

This is very likely an **undercount** of CivicPulse's real verification call
volume: a `disputed` verdict reopens the complaint (`server/agents/verificationAgent.mjs`),
which could trigger a second verification pass later. Counting exactly one
pass per resolved complaint is the simplifying assumption, and it biases the
final figure low, not high — stated here plainly rather than buried.

## 3. Real measured token counts (Task 5 testing, 22 Jul 2026)

**Not invented.** These are the actual `usage.prompt_tokens` /
`usage.completion_tokens` NVIDIA's API returned, captured live in the new
`run_metrics` table (`server/db.mjs`) while building and mechanically
smoke-testing this task's instrumentation. NVIDIA's chat-completions response
reliably includes a populated `usage` object for both models this app uses —
confirmed directly, not assumed (verified with a raw test call to each model
before writing `server/metrics.mjs`).

| agent_step | n (real calls) | mean prompt_tokens | mean completion_tokens | mean duration_ms |
|---|---|---|---|---|
| `classification` | 6 | 1751.0 | 38.3 | 1,260 |
| `verification_describe` | 6 | 1695.5 | 74.2 | 2,174 |
| `verification_adjudicate` | 3 | 439.3 | 61.3 | 115,728 (highly variable: 2.6s–248s across the 3 samples — see caveat below) |
| `resolution_lead` | 1 | 191 | 38 | 252,250 |

**Sample-size caveat**: n is small (1–6 calls each) because this is a
hackathon demo app with no real production traffic yet, not a system with
months of logged usage. These are genuine measurements, not fabricated ones,
but they are a starting estimate, not a statistically robust production
average — re-run `evals/run_classification_eval.mjs` and
`evals/run_verification_eval.mjs` against real photos (once H3 is done) and
re-derive this table from a larger `run_metrics` sample before treating the
final ₹ figure as final.

**Image-size caveat**: the images used for this measurement were small
(64×64px) test PNGs left over from prior tasks' own testing — not real
citizen photos. Vision models typically charge image tokens based on a
resized-tile count, so a full-resolution citizen photo could carry a higher
image-token cost than what's measured here; this table's classification/
describe token counts should be read as a plausible floor, not a ceiling.

**Latency caveat**: `verification_adjudicate` and `resolution_lead` durations
above are inflated by NVIDIA free-tier queuing observed during this testing
session (a burst of ~15 calls in quick succession) — consistent with the
pre-existing note in HUMAN_CHECKLIST.md that real `/verify` calls "can take
over a minute end-to-end." Latency is not part of the cost arithmetic below
(only tokens are), so this doesn't affect the ₹ figure, but it's relevant to
`GET /api/metrics/summary`'s p95 numbers.

**Route advisory**: not separately measured (excluded from the volumetric
model — see §2). It shares `resolution_lead`'s shape closely enough for a
sanity check (same chat model, same `max_tokens: 100` cap, a similarly compact
single-paragraph context string) that its real cost is very unlikely to
change the conclusion below even if it were included.

## 4. Pricing

**build.nvidia.com does not publish a per-token USD price for either model
this app uses.** Verified directly (not assumed) while researching this
section — see `server/pricing.mjs` for the full citation trail:
NVIDIA's own developer blog describes API-Catalog access as free-credit-based,
and NVIDIA staff on NVIDIA's own developer forum, asked this exact question,
repeatedly redirect to a FAQ without ever stating a per-token figure.

So the figures below are **estimates using the closest published comparable**
— real, live, third-party rate cards for the identical model IDs, fetched
22 Jul 2026 — not official NVIDIA prices. Full sourcing lives in
`server/pricing.mjs`; summarized here:

| Model | Price (USD / 1M tokens) | Source |
|---|---|---|
| `meta/llama-3.1-70b-instruct` (chat) | $0.40 input / $0.40 output | DeepInfra + OpenRouter, independently confirmed matching, 22 Jul 2026. (Together AI hosts it higher, $0.88/$0.88 — used only in the sensitivity check below.) |
| `meta/llama-3.2-11b-vision-instruct` (vision) | $0.20 input / $0.20 output | Upper-half figure from a published spread of $0.05–$0.30 across DeepInfra/Sambanova/Bedrock/Groq/Together/Fireworks (llm-stats.com aggregation, 22 Jul 2026) — chosen deliberately high in that range so this model errs toward overestimating cost. |

**USD → INR**: ₹96.4/USD, the market rate on 22 Jul 2026 (multiple FX sources
agreed within 1% that day). Re-check before reusing this figure later — FX
drifts.

## 5. Arithmetic

Cost per call = `(prompt_tokens / 1,000,000 × price.input) + (completion_tokens / 1,000,000 × price.output)`
— exactly what `server/pricing.mjs#estimateCostUsd` computes for every real
`run_metrics` row.

```
cost(classification)          = (1751.0 + 38.3)  / 1e6 × $0.20  = $0.00035786
cost(verification_describe)   = (1695.5 + 74.2)  / 1e6 × $0.20  = $0.00035394   (× 2 calls per verification)
cost(verification_adjudicate) = (439.3  + 61.3)  / 1e6 × $0.40  = $0.00020024
cost(resolution_lead)         = (191    + 38)    / 1e6 × $0.40  = $0.00009160

cost(one verification cycle)  = 2 × $0.00035394 + $0.00020024   = $0.00090812
```

Per-complaint expected cost — classification and lead happen for every
complaint; verification happens for 80% of complaints (§2):

```
per_complaint = cost(classification) + cost(resolution_lead)
              + 0.80 × cost(one verification cycle)
            = $0.00035786 + $0.00009160 + 0.80 × $0.00090812
            = $0.00044946 + $0.00072650
            = $0.00117596
```

Daily, at the real 600 complaints/day figure:

```
daily_cost   = $0.00117596 × 600  = $0.7056
monthly_cost = $0.7056 × 30       = $21.17
monthly_cost (INR) = $21.17 × ₹96.4/USD = ₹2,041
```

## 6. Final figure

**≈ $21.17/month, or ≈ ₹2,041/month**, at GHMC's real disclosed load of ~600
complaints/day, running full classification + lead generation for every
complaint and the full 3-call verification cycle for the 80% that reach a
resolution claim.

## 7. Sensitivity (so this isn't a single unexplained number)

| Scenario | Monthly cost |
|---|---|
| Baseline above (80% verification rate, §4's pricing) | **$21.17 ≈ ₹2,041** |
| Every complaint verified once (100%, not 80%) | $24.44 ≈ ₹2,356 |
| Every classification needs the retry-once path (2 calls, not 1) | $27.61 ≈ ₹2,662 |
| Chat model priced at Together AI's higher $0.88/$0.88 instead of $0.40/$0.40 | $26.61 ≈ ₹2,565 |

Every scenario tested stays in the **₹2,000–2,700/month** range — the
conclusion (this is a very small, easily procurable line item next to GHMC's
existing CGRS operating cost) is not sensitive to any single assumption above
tipping it over by an order of magnitude.

## 8. What would move this number the most

- **Real per-token image cost for full-resolution citizen photos** (§3's
  image-size caveat) — the single biggest unknown here, since it wasn't
  measurable without real citizen photos (H3 not done yet at the time of
  writing).
- **An official NVIDIA per-token rate**, if NVIDIA ever publishes one for
  build.nvidia.com's hosted catalog — would replace the comparable-rate-card
  estimates in §4 with a real NVIDIA figure.
- **Actual verification-retry rate** (how often a `disputed` verdict leads to
  a second verification pass) — not modeled at all here (§2's undercount
  note); would need real production data to quantify.
