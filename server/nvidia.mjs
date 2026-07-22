import { categories } from './data/localities.mjs';
import { recordRunMetric } from './metrics.mjs';

export const NVIDIA_VISION_MODEL = 'meta/llama-3.2-11b-vision-instruct';
export const NVIDIA_CHAT_MODEL = 'meta/llama-3.1-70b-instruct';
const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

// Round 2 Task 5: `complaintId` is a new, optional field — every existing
// caller (the /api/classify raw-preview route, the eval scripts) omits it
// and behaves exactly as before; classifyImage()'s return shape is
// unchanged. It exists only so run_metrics rows produced by the pipeline
// path (server/agents/classificationAgent.mjs, called with the complaint's
// real id) can be attributed to that complaint — see server/metrics.mjs.
export async function classifyImage({ textNote = '', image = null, complaintId = null }) {
  const content = [];
  content.push({ type: 'text', text: buildClassificationPrompt(textNote) });

  if (image) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${image.mimeType};base64,${image.data}` }
    });
  }

  const messages = [{ role: 'user', content }];

  let text = await callNvidia({
    model: NVIDIA_VISION_MODEL,
    messages,
    max_tokens: 1024,
    temperature: 0.2,
  }, { agentStep: 'classification', complaintId });

  try {
    return validateClassification(JSON.parse(stripCodeFence(text)));
  } catch (error) {
    // Retry once with a stricter message if validation/parsing fails. This is
    // a second real NVIDIA call — it gets its own run_metrics row (agent_step
    // 'classification' again), which is the honest reflection of what
    // actually happened: 2 real calls, not 1 (see task-5-report.md's call-
    // count notes).
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: 'Your previous response was invalid. Return ONLY a valid JSON object matching the schema. Do not include prose or code fences.' });

    text = await callNvidia({
      model: NVIDIA_VISION_MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.1,
    }, { agentStep: 'classification', complaintId });
    return validateClassification(JSON.parse(stripCodeFence(text)));
  }
}

// Round 2 Task 5: `meta` is new and optional (`{ agentStep, complaintId }`).
// Every pre-existing call site is updated below to pass it so its real
// duration/tokens/cost land in run_metrics (server/metrics.mjs) — but the
// function's return value (just `text`, same as before) is unchanged, so
// nothing about its existing contract breaks for any caller that doesn't
// pass `meta`. Only successful calls are recorded: a failed call returns no
// `usage` to attribute a real cost to, and the existing fallback paths in
// each caller already handle failure without needing a metrics row.
export async function callNvidia(body, meta = {}) {
  const startedAt = Date.now();
  const data = await generateNvidiaContent(body);
  const text = extractText(data);

  if (meta.agentStep) {
    recordRunMetric({
      agentStep: meta.agentStep,
      complaintId: meta.complaintId ?? null,
      model: body.model,
      durationMs: Date.now() - startedAt,
      usage: data.usage,
    });
  }

  if (!text) {
    throw new Error('NVIDIA API returned no text.');
  }

  return text;
}

// Round 2 Task 4, Step 2 (Orientation Finding #9 / ROUND2.md §4.2): this
// retry loop was already live before Task 4 (confirmed by reading it, not
// assumed) — linear backoff (`attempt * 1000`ms: 1s, 2s), 2 retries, only
// on 429/5xx. Decision: bumped to true exponential backoff (1s, 2s, 4s) with
// one extra retry (3 total), rather than left as-is or made much more
// aggressive. Reasoning:
//   - The new response cache (server/cache.mjs, wrapped around every
//     NVIDIA-calling agent) is now the primary defense against the actual
//     stated risk in ROUND2.md §4.2 ("judges clicking around will burn the
//     free-tier quota") — repeat views of the same demo complaint no longer
//     call NVIDIA at all, so this retry loop's job shrinks to just
//     absorbing genuine first-time transient failures.
//   - A hackathon judge's session is bursty-but-light, not sustained
//     concurrent load — 1s+2s+4s (7s worst case across 3 retries) covers
//     more of a per-second-bucket 429 than the old 1s+2s (3s) did, without
//     making a judge stare at a spinner long enough to read as broken (still
//     comfortably under classificationService.ts's 20s client-side
//     AbortController timeout, the tightest budget any caller currently has).
//   - True unbounded/steeper exponential (e.g. 1s,2s,4s,8s,16s+) was
//     considered and rejected: NVIDIA free-tier 429 windows are typically
//     per-minute, so no bounded in-request backoff fully absorbs a sustained
//     block anyway — past ~7s added latency it stops helping and just makes
//     a broken-looking wait longer.
export async function generateNvidiaContent(body, retries = 3) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    const error = new Error('NVIDIA_API_KEY is not configured.');
    error.status = 500;
    throw error;
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(2 ** (attempt - 1) * 1000, 8000);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const response = await fetch(NVIDIA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return response.json();
    }

    const details = await response.text();
    lastError = new Error(`NVIDIA API returned ${response.status}: ${details.slice(0, 500)}`);
    lastError.status = response.status;
    
    // Only retry on 429 (Too Many Requests) or 5xx
    if (response.status !== 429 && (response.status < 500 || response.status >= 600)) {
      throw lastError;
    }
  }

  throw lastError;
}

export function extractText(data) {
  return data.choices?.[0]?.message?.content?.trim() || '';
}

function buildClassificationPrompt(textNote) {
  return [
    'You are classifying a civic complaint for the CivicPulse municipal operations dashboard.',
    `Return ONLY a JSON object with this exact shape: {"category": one of ${JSON.stringify(categories)}, "severity": integer 1-5, "reasoning": short explanation}.`,
    'Severity 1 means low impact, 3 means moderate operational impact, and 5 means urgent public safety or service disruption.',
    'Use the image when present and the citizen note as supporting context.',
    'Do not wrap the JSON in markdown code blocks. Return just the JSON string.',
    `Citizen note: ${textNote.trim() || '(none provided)'}`,
  ].join('\n');
}

export function stripCodeFence(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
}

function validateClassification(value) {
  const category = value?.category;
  const severity = Number(value?.severity);
  const reasoning = typeof value?.reasoning === 'string' ? value.reasoning : '';

  if (!categories.includes(category) || !Number.isInteger(severity) || severity < 1 || severity > 5) {
    throw new Error('NVIDIA model returned an invalid classification payload.');
  }

  return { category, severity, reasoning };
}
