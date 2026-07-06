import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDispatchList,
  computeDailyCounts,
  detectHotspots,
  forecastNext7Days,
  getNearbyIssues,
} from './analytics.mjs';
import { answerWithTools } from './agents/conversationalAgent.mjs';
import { runPipeline } from './agents/orchestrator.mjs';
import { localities } from './data/localities.mjs';
import { listComplaints } from './db.mjs';
import { classifyWithGemini } from './gemini.mjs';
import { seedIfEmpty } from './seed.mjs';
import { startTelegramBot } from './telegramBot.mjs';
import { getStatus, normalizeImageInput, redactError } from './utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(root, '.env'), quiet: true });
seedIfEmpty();
startTelegramBot().catch((error) => {
  console.error('Telegram bot failed to start:', redactError(error));
});

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '16mb' }));

app.get('/api/localities', (_req, res) => {
  res.json(localities);
});

app.get('/api/complaints', (req, res) => {
  res.json(listComplaints(req.query));
});

app.post('/api/complaints', async (req, res) => {
  try {
    const result = await runPipeline(req.body ?? {});
    res.status(201).json(result);
  } catch (error) {
    console.error('/api/complaints failed:', redactError(error));
    res.status(getStatus(error)).json({ error: 'Unable to create complaint.' });
  }
});

app.get('/api/hotspots', (req, res) => {
  const limit = Number(req.query.limit) || 20;
  res.json(detectHotspots(listComplaints(req.query), 30).slice(0, limit));
});

app.get('/api/forecast', (req, res) => {
  const ward = req.query.ward ? Number(req.query.ward) : null;
  const complaints = listComplaints(ward ? { ward } : {});
  const dailyCounts = computeDailyCounts(complaints.map((complaint) => complaint.reportedAt));
  const forecast = forecastNext7Days(dailyCounts.map((day) => day.count));

  res.json({ ward, historicalData: dailyCounts, forecast });
});

app.get('/api/dispatch', (req, res) => {
  const limit = Number(req.query.limit) || 8;
  const complaints = listComplaints(req.query.ward ? { ward: req.query.ward } : {});
  res.json(buildDispatchList(complaints, limit));
});

app.get('/api/nearby', (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radiusKm = Number(req.query.radius_km) || 2;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng query parameters are required.' });
  }

  res.json(getNearbyIssues(listComplaints(), lat, lng, radiusKm));
});

app.post('/api/classify', async (req, res) => {
  try {
    const textNote = typeof req.body?.textNote === 'string' ? req.body.textNote : '';
    const image = normalizeImageInput(req.body?.image ?? req.body);

    if (!image && textNote.trim().length === 0) {
      return res.status(400).json({ error: 'Provide an image or a text note to classify.' });
    }

    res.json(await classifyWithGemini({ textNote, image }));
  } catch (error) {
    console.error('/api/classify failed:', redactError(error));
    res.status(getStatus(error)).json({ error: 'Gemini classification is unavailable.' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';

    if (!question) {
      return res.status(400).json({ error: 'Question is required.' });
    }

    const result = await answerWithTools({
      question,
      lat: req.body?.lat,
      lng: req.body?.lng,
    });

    res.json(result);
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
