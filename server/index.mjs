import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(root, '.env'), quiet: true });

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const categories = [
  'Garbage Overflow',
  'Pothole / Road Damage',
  'Water Leakage',
  'Streetlight Outage',
  'Drainage Blockage',
  'Stray Animal Hazard',
];

app.use(express.json({ limit: '16mb' }));

app.post('/api/classify', async (req, res) => {
  try {
    const textNote = typeof req.body?.textNote === 'string' ? req.body.textNote : '';
    const image = normalizeImageInput(req.body?.image ?? req.body);

    if (!image && textNote.trim().length === 0) {
      return res.status(400).json({ error: 'Provide an image or a text note to classify.' });
    }

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

    res.json(validateClassification(JSON.parse(stripCodeFence(text))));
  } catch (error) {
    console.error('/api/classify failed:', redactError(error));
    res.status(getStatus(error)).json({ error: 'Gemini classification is unavailable.' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    const summary = req.body?.summary;

    if (!question) {
      return res.status(400).json({ error: 'Question is required.' });
    }

    const summaryText = JSON.stringify(summary ?? {});
    if (summaryText.length > 20000) {
      return res.status(413).json({ error: 'Complaint summary is too large.' });
    }

    const text = await callGemini({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: buildChatPrompt(question, summaryText),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 600,
      },
    });

    res.json({ answer: text.trim() });
  } catch (error) {
    console.error('/api/chat failed:', redactError(error));
    res.status(getStatus(error)).json({ error: 'Gemini chat is unavailable.' });
  }
});

if (isProduction) {
  const distPath = path.join(root, 'dist');
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method !== 'GET') {
      next();
      return;
    }

    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);
}

startServer(Number(process.env.PORT) || 5173);

function buildClassificationPrompt(textNote) {
  return [
    'You are classifying a civic complaint for the CivicPulse municipal operations dashboard.',
    `Return JSON only with: {"category": one of ${JSON.stringify(categories)}, "severity": integer 1-5, "reasoning": short explanation}.`,
    'Severity 1 means low impact, 3 means moderate operational impact, and 5 means urgent public safety or service disruption.',
    'Use the image when present and the citizen note as supporting context.',
    `Citizen note: ${textNote.trim() || '(none provided)'}`,
  ].join('\n');
}

function buildChatPrompt(question, summaryText) {
  return [
    'You are the CivicPulse assistant for a municipal civic operations prototype.',
    'Answer the user using only the compact complaint summary below. Do not invent complaint rows, addresses, sources, or live data that are not present in the summary.',
    'If the summary cannot answer the question, say what is missing and offer a related answer from the available aggregates.',
    'Keep the answer concise and operational. Markdown bullets are fine.',
    `Complaint summary JSON: ${summaryText}`,
    `User question: ${question}`,
  ].join('\n\n');
}

async function callGemini(body) {
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

  const data = await response.json();
  const text = data.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!text) {
    const blockReason = data.promptFeedback?.blockReason;
    throw new Error(blockReason ? `Gemini returned no text: ${blockReason}` : 'Gemini returned no text.');
  }

  return text;
}

function normalizeImageInput(input) {
  if (!input || typeof input !== 'object') return null;

  const rawData =
    typeof input.data === 'string'
      ? input.data
      : typeof input.imageBase64 === 'string'
        ? input.imageBase64
        : null;

  if (!rawData) return null;

  const dataUrlMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = dataUrlMatch?.[1] ?? input.mimeType ?? input.mime_type ?? 'image/jpeg';
  const data = (dataUrlMatch?.[2] ?? rawData).replace(/\s/g, '');

  if (!data) {
    const error = new Error('Image data is empty.');
    error.status = 400;
    throw error;
  }

  return { data, mimeType };
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

function redactError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  const apiKey = process.env.GEMINI_API_KEY;
  return apiKey ? raw.replaceAll(apiKey, '[redacted]') : raw;
}

function getStatus(error) {
  const status = Number(error?.status);
  if (Number.isInteger(status) && status >= 400 && status < 600) {
    return status;
  }
  return 500;
}

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`CivicPulse dev server running at http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && !process.env.PORT) {
      startServer(port + 1);
      return;
    }

    throw error;
  });
}
