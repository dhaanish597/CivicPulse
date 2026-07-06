import { categories } from './data/localities.mjs';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export async function classifyWithGemini({ textNote = '', image = null }) {
  const parts = [{ text: buildClassificationPrompt(textNote) }];
  if (image) {
    parts.push({
      inline_data: {
        mime_type: image.mimeType,
        data: image.data,
      },
    });
  }

  const text = await callGemini({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: {
        type: 'OBJECT',
        properties: {
          category: {
            type: 'STRING',
            enum: categories,
          },
          severity: {
            type: 'INTEGER',
            minimum: 1,
            maximum: 5,
          },
          reasoning: {
            type: 'STRING',
          },
        },
        required: ['category', 'severity', 'reasoning'],
      },
    },
  });

  return validateClassification(JSON.parse(stripCodeFence(text)));
}

export async function callGemini(body) {
  const data = await generateGeminiContent(body);
  const text = extractText(data);

  if (!text) {
    const blockReason = data.promptFeedback?.blockReason;
    throw new Error(blockReason ? `Gemini returned no text: ${blockReason}` : 'Gemini returned no text.');
  }

  return text;
}

export async function generateGeminiContent(body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is not configured.');
    error.status = 500;
    throw error;
  }

  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const details = await response.text();
    const error = new Error(`Gemini API returned ${response.status}: ${details.slice(0, 500)}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

export function extractText(data) {
  return data.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildClassificationPrompt(textNote) {
  return [
    'You are classifying a civic complaint for the CivicPulse municipal operations dashboard.',
    `Return JSON only with: {"category": one of ${JSON.stringify(categories)}, "severity": integer 1-5, "reasoning": short explanation}.`,
    'Severity 1 means low impact, 3 means moderate operational impact, and 5 means urgent public safety or service disruption.',
    'Use the image when present and the citizen note as supporting context.',
    `Citizen note: ${textNote.trim() || '(none provided)'}`,
  ].join('\n');
}

function stripCodeFence(text) {
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
    throw new Error('Gemini returned an invalid classification payload.');
  }

  return { category, severity, reasoning };
}
