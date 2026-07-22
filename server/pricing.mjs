// Round 2 Task 5 (ROUND2.md §5.3) — cost-per-call pricing used by
// server/metrics.mjs (live run_metrics instrumentation) and
// evals/results/cost_model.md (the monthly cost projection).
//
// SOURCING NOTE — read before changing these numbers.
//
// build.nvidia.com's hosted NIM catalog — where this app's NVIDIA_API_KEY
// actually sends requests (see server/nvidia.mjs) — does NOT publish a
// per-token USD price for either model this app uses. Verified directly on
// 22 Jul 2026 while building this file:
//   - NVIDIA's own developer blog ("Access to NVIDIA NIM Now Available Free
//     to Developer Program Members", developer.nvidia.com/blog) describes
//     API-Catalog access as free-credit-based: "anyone can sign up to the
//     NVIDIA API Catalog for free credits to access models through
//     NVIDIA-hosted NIM endpoints" — not metered-per-token billing.
//   - NVIDIA's own developer forum thread asking exactly this question
//     (forums.developer.nvidia.com/t/nim-pricing/290144) has NVIDIA staff
//     replies that repeatedly redirect to a FAQ, with no staff reply ever
//     stating a per-token USD figure for API-Catalog models.
// So there is no official NVIDIA rate to cite for either model. Per the
// Task 5 brief's explicit guidance for this exact situation, the figures
// below are the closest published comparable instead: real, live,
// self-reported per-token rate cards from third-party hosts serving the
// SAME model IDs, cross-checked against at least one independent source
// each on 22 Jul 2026. These are ESTIMATES for planning purposes — never
// present them downstream as official NVIDIA prices.
//
// Chat model — meta/llama-3.1-70b-instruct (NVIDIA_CHAT_MODEL):
//   $0.40 / 1M input tokens, $0.40 / 1M output tokens.
//   Source: DeepInfra's live pricing page (deepinfra.com/pricing, row
//   "Meta-Llama-3.1-70B-Instruct-Turbo") and OpenRouter's live model page
//   (openrouter.ai/meta-llama/llama-3.1-70b-instruct) — independently
//   fetched on 22 Jul 2026 and found to agree exactly. Together AI hosts
//   the same model at a higher $0.88/$0.88 (together.ai/models/llama-3-1-70b,
//   fetched same day) — noted here as a documented upper bound, not used
//   in the arithmetic below.
//
// Vision model — meta/llama-3.2-11b-vision-instruct (NVIDIA_VISION_MODEL):
//   $0.20 / 1M input tokens, $0.20 / 1M output tokens (a round figure from
//   the upper half of the published spread — see below).
//   Source: llm-stats.com's aggregated provider comparison for this exact
//   model (fetched 22 Jul 2026) shows published prices ranging from
//   $0.05/$0.05 (DeepInfra, the cheapest) up to $0.15-0.20 input /
//   $0.16-0.30 output across Sambanova, Amazon Bedrock, Groq, Together AI,
//   and Fireworks AI. This file deliberately does NOT use the rock-bottom
//   DeepInfra figure — it uses $0.20/$0.20, from the upper half of that
//   spread, so evals/results/cost_model.md errs toward overestimating a
//   real procurement number rather than underestimating one.
//
// USD → INR: ₹96.4/USD, the market rate on 22 Jul 2026 (multiple FX sources
// agreed within 1% of this figure that day — see cost_model.md for the
// citation). Re-check before reusing this file's numbers on a later date;
// FX and hosted-inference rate cards both drift.
export const CHAT_MODEL_PRICE_PER_1M_USD = { input: 0.40, output: 0.40 };
export const VISION_MODEL_PRICE_PER_1M_USD = { input: 0.20, output: 0.20 };
export const USD_TO_INR = 96.4;

const PRICE_BY_MODEL = {
  'meta/llama-3.1-70b-instruct': CHAT_MODEL_PRICE_PER_1M_USD,
  'meta/llama-3.2-11b-vision-instruct': VISION_MODEL_PRICE_PER_1M_USD,
};

/**
 * Returns an estimated USD cost for one NVIDIA call, or null if the model is
 * unrecognized or the token counts aren't finite numbers (never fabricates a
 * number from incomplete data — see server/metrics.mjs).
 */
export function estimateCostUsd(model, promptTokens, completionTokens) {
  const price = PRICE_BY_MODEL[model];
  if (!price || !Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
    return null;
  }
  return (promptTokens / 1_000_000) * price.input + (completionTokens / 1_000_000) * price.output;
}
