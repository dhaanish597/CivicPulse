import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
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
import { loadWardReference } from './data/localities.mjs';
import {
  listComplaints,
  getComplaintById,
  listStatusEvents,
  insertEvidence,
  getLatestEvidenceByKind,
  getLatestProofEvidence,
  updateVerification,
  getVerificationStats,
} from './db.mjs';
import { classifyImage } from './nvidia.mjs';
import { runResolution } from './agents/resolutionAgent.mjs';
import { runRouteAdvisor } from './agents/routeAgent.mjs';
import { runVerification } from './agents/verificationAgent.mjs';
import { seedIfEmpty } from './seed.mjs';
import { startTelegramBot } from './telegramBot.mjs';
import { generateId, getStatus, normalizeImageInput, redactError } from './utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const EVIDENCE_KINDS = ['intake', 'officer_proof', 'citizen_proof'];
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = extFromMime(file.mimetype) || path.extname(file.originalname) || '.jpg';
      cb(null, `${generateId('EVD')}${ext}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 }, // ~4MB cap, per task-2 brief Step 2
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      const error = new Error('Only image uploads are allowed.');
      error.status = 400;
      return cb(error);
    }
    cb(null, true);
  },
});

function extFromMime(mimeType) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  return map[mimeType] ?? null;
}

dotenv.config({ path: path.join(root, '.env'), quiet: true });
seedIfEmpty();
startTelegramBot().catch((error) => {
  console.error('Telegram bot failed to start:', redactError(error));
});

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '16mb' }));

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || (process.env.NODE_ENV === 'production' ? false : '*'),
}));

// Serves uploaded evidence photos (server/uploads/) so they're viewable by URL —
// e.g. by the verificationAgent's own vision call and, later, the Task 3 frontend.
app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/localities', (_req, res) => {
  // Serves the real GHMC zone/circle/ward reference when available, or a clearly
  // labelled fallback (see server/data/localities.mjs#loadWardReference). No
  // frontend code depended on the previous flat 20-locality shape here, so this
  // route was free to repurpose for Ward Officer circle-scoping (Round 2 §2).
  res.json(loadWardReference());
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

app.get('/api/complaints/:id', (req, res) => {
  const complaint = getComplaintById(req.params.id);
  if (!complaint) return res.status(404).json({ error: 'Not found' });
  const status_events = listStatusEvents(req.params.id);
  res.json({ ...complaint, status_events });
});

app.patch('/api/complaints/:id/status', async (req, res) => {
  try {
    const complaint = getComplaintById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Not found' });

    const { status, note } = req.body;
    if (!['reported', 'acknowledged', 'in_progress', 'resolution_claimed', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Task 2: an officer can no longer close a complaint themselves — closing
    // requires a prior 'verified' verdict from the verification agent.
    if (status === 'resolved' && complaint.verificationStatus !== 'verified') {
      return res.status(409).json({
        error: 'Cannot close a complaint without verified proof of resolution.',
        verification_status: complaint.verificationStatus,
      });
    }

    await runResolution(complaint, status, 'officer', note);

    // Claiming a resolution starts the verification cycle — evidence isn't
    // submitted yet, so the complaint is now explicitly awaiting proof.
    if (status === 'resolution_claimed') {
      updateVerification(req.params.id, { verificationStatus: 'awaiting_proof', verifiedAt: null });
    }

    res.json(getComplaintById(req.params.id));
  } catch (error) {
    console.error('PATCH /api/complaints/:id/status failed:', redactError(error));
    res.status(500).json({ error: 'Update failed' });
  }
});

app.post('/api/complaints/:id/evidence', (req, res) => {
  upload.single('image')(req, res, (uploadError) => {
    if (uploadError) {
      const status = uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : getStatus(uploadError);
      const message = uploadError.code === 'LIMIT_FILE_SIZE'
        ? 'Image exceeds the 4MB upload limit.'
        : uploadError.message || 'Unable to upload evidence image.';
      return res.status(status).json({ error: message });
    }

    try {
      const complaint = getComplaintById(req.params.id);
      if (!complaint) return res.status(404).json({ error: 'Not found' });

      if (!req.file) {
        return res.status(400).json({ error: 'An image file is required.' });
      }

      const kind = req.body?.kind;
      if (!EVIDENCE_KINDS.includes(kind)) {
        return res.status(400).json({ error: `kind must be one of ${EVIDENCE_KINDS.join(', ')}.` });
      }

      const submittedBy = typeof req.body?.submitted_by === 'string' && req.body.submitted_by.trim()
        ? req.body.submitted_by.trim()
        : (kind === 'citizen_proof' ? 'citizen' : 'officer');

      const row = insertEvidence({
        id: generateId('EVD'),
        complaintId: req.params.id,
        kind,
        imagePath: `/uploads/${req.file.filename}`,
        submittedBy,
      });

      res.status(201).json(row);
    } catch (error) {
      console.error('POST /api/complaints/:id/evidence failed:', redactError(error));
      res.status(getStatus(error)).json({ error: 'Unable to save evidence.' });
    }
  });
});

app.post('/api/complaints/:id/verify', async (req, res) => {
  try {
    const complaint = getComplaintById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Not found' });

    const intake = getLatestEvidenceByKind(req.params.id, 'intake');
    const proof = getLatestProofEvidence(req.params.id);

    if (!intake || !proof) {
      return res.status(400).json({
        error: 'Both intake evidence and proof evidence (officer_proof or citizen_proof) are required before verification.',
      });
    }

    const result = await runVerification(complaint, intake.imagePath, proof.imagePath);

    updateVerification(req.params.id, {
      verificationStatus: result.verdict,
      verificationReasoning: result.reasoning,
      verifiedAt: new Date().toISOString(),
    });

    const updated = getComplaintById(req.params.id);

    res.json({
      verdict: result.verdict,
      confidence: result.confidence,
      reasoning: result.reasoning,
      newStatus: updated.status,
    });
  } catch (error) {
    console.error('POST /api/complaints/:id/verify failed:', redactError(error));
    res.status(getStatus(error)).json({ error: 'Verification failed.' });
  }
});

app.get('/api/verification-stats', (_req, res) => {
  res.json(getVerificationStats());
});

app.post('/api/route-check', async (req, res) => {
  try {
    const { originLat, originLng, destLat, destLng } = req.body;
    if (!originLat || !originLng || !destLat || !destLng) {
      return res.status(400).json({ error: 'Missing origin or destination coordinates' });
    }
    const result = await runRouteAdvisor(originLat, originLng, destLat, destLng);
    res.json(result);
  } catch (error) {
    console.error('POST /api/route-check failed:', redactError(error));
    res.status(500).json({ error: 'Route check failed' });
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
  const filters = req.query.circle
    ? { circle: req.query.circle }
    : req.query.ward
      ? { ward: req.query.ward }
      : {};
  const complaints = listComplaints(filters);
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

    res.json(await classifyImage({ textNote, image }));
  } catch (error) {
    console.error('/api/classify failed:', redactError(error));
    res.status(getStatus(error)).json({ error: 'NVIDIA classification is unavailable.' });
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
    res.status(getStatus(error)).json({ error: 'NVIDIA chat is unavailable.' });
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
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`CivicPulse dev server running at http://0.0.0.0:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && !process.env.PORT) {
      startServer(port + 1);
      return;
    }

    throw error;
  });
}

export default app;
