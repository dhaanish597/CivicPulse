import { categories } from './data/localities.mjs';

export const NVIDIA_VISION_MODEL = 'meta/llama-3.2-11b-vision-instruct';
export const NVIDIA_CHAT_MODEL = 'meta/llama-3.1-70b-instruct';
const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

export async function classifyImage({ textNote = '', image = null }) {
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
  });

  try {
    return validateClassification(JSON.parse(stripCodeFence(text)));
  } catch (error) {
    // Retry once with a stricter message if validation/parsing fails
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: 'Your previous response was invalid. Return ONLY a valid JSON object matching the schema. Do not include prose or code fences.' });
    
    text = await callNvidia({
      model: NVIDIA_VISION_MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.1,
    });
    return validateClassification(JSON.parse(stripCodeFence(text)));
  }
}

export async function callNvidia(body) {
  const data = await generateNvidiaContent(body);
  const text = extractText(data);

  if (!text) {
    throw new Error('NVIDIA API returned no text.');
  }

  return text;
}

export async function generateNvidiaContent(body, retries = 2) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    const error = new Error('NVIDIA_API_KEY is not configured.');
    error.status = 500;
    throw error;
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
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
