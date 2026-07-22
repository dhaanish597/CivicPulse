// Round 2 Task 5 (ROUND2.md §5.3) — records one run_metrics row per REAL
// NVIDIA call. Deliberately never called on a cache hit (server/cache.mjs's
// withCache short-circuits before the wrapped fn — and therefore before any
// call site below — ever runs), because a cache hit makes zero NVIDIA calls
// and has no genuine duration/tokens/cost to attribute. run_metrics is
// consumed by GET /api/metrics/summary (server/index.mjs) and
// evals/results/cost_model.md.
import { insertRunMetric } from './db.mjs';
import { generateId } from './utils.mjs';
import { estimateCostUsd } from './pricing.mjs';

/**
 * @param {object} params
 * @param {string} params.agentStep - one of 'classification', 'verification_describe',
 *   'verification_adjudicate', 'resolution_lead', 'route_advisory'.
 * @param {string|null} [params.complaintId]
 * @param {string} params.model - the exact NVIDIA model string sent in the request body.
 * @param {number} params.durationMs
 * @param {{ prompt_tokens?: number, completion_tokens?: number }|undefined} params.usage -
 *   the `usage` object NVIDIA's chat-completions response returns.
 */
export function recordRunMetric({ agentStep, complaintId = null, model, durationMs, usage }) {
  const promptTokens = Number.isFinite(usage?.prompt_tokens) ? usage.prompt_tokens : null;
  const completionTokens = Number.isFinite(usage?.completion_tokens) ? usage.completion_tokens : null;

  if (promptTokens === null || completionTokens === null) {
    // Defensive-only path. Every real NVIDIA call made while building and
    // testing this instrumentation (both meta/llama-3.1-70b-instruct and
    // meta/llama-3.2-11b-vision-instruct, see task-5-report.md) returned a
    // populated `usage` object, so this should not normally fire. Left null
    // rather than guessed from character length — an un-attributable cost is
    // reported as unknown, never invented (ROUND2.md §8's "never invent
    // statistics").
    console.warn(`run_metrics: NVIDIA response for agent_step="${agentStep}" had no usage data — prompt_tokens/completion_tokens/estimated_cost_usd left null for this row.`);
  }

  insertRunMetric({
    id: generateId('MET'),
    complaintId,
    agentStep,
    durationMs,
    promptTokens,
    completionTokens,
    estimatedCostUsd: (promptTokens !== null && completionTokens !== null)
      ? estimateCostUsd(model, promptTokens, completionTokens)
      : null,
  });
}
