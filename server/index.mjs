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
  listEvidence,
  getLatestEvidenceByKind,
  getLatestCitizenProofEvidence,
  updateVerification,
  getVerificationStats,
  getDemoReportCandidates,
  getMetricsSummary,
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

// Round 2 Task 4 (ROUND2.md §4.3): CORS must survive the actual deployment
// topology — frontend on Vercel (production domain + unpredictable
// per-branch/per-PR preview subdomains a judge could be sent to), backend on
// Render. `ALLOWED_ORIGIN` (see .env.example) holds a comma-separated list
// of exact production origin(s), e.g. "https://civicpulse.vercel.app". On
// top of whatever's configured there, every "*.vercel.app" origin is always
// trusted — Vercel preview URLs can't be enumerated in advance, so refusing
// them all would silently break the exact judge-clicks-a-preview-link
// scenario this task exists to protect against. `cors`'s own array-based
// `origin` option supports a mix of exact strings and RegExp entries
// natively (see node_modules/cors/lib/index.js#isOriginAllowed) — no custom
// origin callback needed.
//
// In development (default, no NODE_ENV=production) this stays wide open
// ('*'), unchanged from the pre-Task-4 behavior, so local iteration across
// devices on the same network (e.g. testing from a phone against a laptop
// dev server) keeps working without any env var setup.
const VERCEL_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

function buildCorsOptions(isProd) {
  if (!isProd) {
    return { origin: '*' };
  }

  const configuredOrigins = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  // Not `false`-on-empty like the pre-Task-4 default: even with
  // ALLOWED_ORIGIN unset (e.g. a human forgot to fill in Render's
  // `sync: false` env var — a real, documented failure mode in render.yaml),
  // the Vercel preview pattern alone still lets the actual deployed frontend
  // through, since this app's frontend is always hosted on Vercel per
  // vercel.json/render.yaml's split topology.
  return { origin: [...configuredOrigins, VERCEL_PREVIEW_ORIGIN] };
}

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

app.use(cors(buildCorsOptions(isProduction)));

// Serves uploaded evidence photos (server/uploads/) so they're viewable by URL —
// e.g. by the verificationAgent's own vision call and, later, the Task 3 frontend.
app.use('/uploads', express.static(uploadsDir));

// Round 2 Task 4 (ROUND2.md §4.1): a bare, un-namespaced health route — cheap,
// no DB write, no auth — meant purely as an uptime-pinger target (see H2 in
// ROUND2.md §10) to keep Render's free-tier instance from spinning down
// between judge visits. GET /api/health above already exists and is kept
// as-is since other things may depend on its `{ status: 'ok' }` shape; this
// is deliberately a separate, minimal route rather than a replacement.
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

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
  // Complaint-existence is checked BEFORE multer runs (it only needs
  // req.params.id, not the multipart body), so a request for a nonexistent
  // complaint never touches disk at all. `kind` still can't be validated this
  // early — it only becomes readable once multer has parsed the multipart
  // body — so that check stays below and cleans up its own orphaned file on
  // failure (see task-2-report.md "Fix round 1" for the Minor finding this
  // closes).
  const complaint = getComplaintById(req.params.id);
  if (!complaint) return res.status(404).json({ error: 'Not found' });

  upload.single('image')(req, res, (uploadError) => {
    if (uploadError) {
      const status = uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : getStatus(uploadError);
      const message = uploadError.code === 'LIMIT_FILE_SIZE'
        ? 'Image exceeds the 4MB upload limit.'
        : uploadError.message || 'Unable to upload evidence image.';
      return res.status(status).json({ error: message });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'An image file is required.' });
      }

      const kind = req.body?.kind;
      if (!EVIDENCE_KINDS.includes(kind)) {
        // multer already wrote this file to server/uploads/ before `kind` was
        // readable — delete it rather than leaving an orphan behind.
        fs.unlink(req.file.path, (unlinkError) => {
          if (unlinkError) console.error('Failed to remove orphaned evidence upload:', redactError(unlinkError));
        });
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

// Fix round 1 (Finding 2): Task 2 never built a way to list a complaint's
// evidence from the server, so the Task 3 frontend was relying solely on a
// client-side localStorage cache of URLs seen during the same browser
// session — real evidence photos, but invisible to a second browser/device
// (e.g. a judge opening the prototype cold) that didn't make the original
// upload. Read-only and additive: returns the same per-row shape as POST
// .../evidence's response ({ id, complaintId, kind, imagePath, submittedBy,
// createdAt }), ordered oldest-to-newest same as listEvidence() elsewhere.
// Does not touch what POST .../verify itself adjudicates (still only reads
// intake + the latest citizen_proof via getLatestEvidenceByKind /
// getLatestCitizenProofEvidence, untouched below).
app.get('/api/complaints/:id/evidence', (req, res) => {
  const complaint = getComplaintById(req.params.id);
  if (!complaint) return res.status(404).json({ error: 'Not found' });

  res.json(listEvidence(req.params.id));
});

app.post('/api/complaints/:id/verify', async (req, res) => {
  try {
    const complaint = getComplaintById(req.params.id);
    if (!complaint) return res.status(404).json({ error: 'Not found' });

    const intake = getLatestEvidenceByKind(req.params.id, 'intake');
    if (!intake) {
      return res.status(400).json({
        error: 'Intake evidence is required before verification.',
      });
    }

    // Verification adjudicates intake vs. the citizen's counter-evidence
    // ONLY — never officer_proof. This is the fix for the Critical finding:
    // previously the "latest proof" query unioned officer_proof and
    // citizen_proof by recency, which let an officer satisfy verification
    // with a self-submitted photo alone, or silently discard a citizen's
    // counter-evidence by re-uploading officer_proof afterward. An officer
    // re-uploading officer_proof now has no effect on this endpoint at all —
    // officer_proof is simply never read here. See task-2-report.md "Fix
    // round 1" for the full rationale.
    const citizenProof = getLatestCitizenProofEvidence(req.params.id);
    if (!citizenProof) {
      return res.status(400).json({
        error: "Verification requires the citizen's counter-evidence photo. No citizen_proof evidence has been uploaded for this complaint yet.",
      });
    }

    const result = await runVerification(complaint, intake.imagePath, citizenProof.imagePath);

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

// Round 2 Task 5 (ROUND2.md §5.3): p50/p95 latency per agent_step, plus mean
// tokens and estimated cost per complaint, computed live from run_metrics —
// see getMetricsSummary() in server/db.mjs for the exact aggregation. No
// auth, read-only, cheap (run_metrics stays small — one row per real NVIDIA
// call, never per cache hit).
app.get('/api/metrics/summary', (_req, res) => {
  res.json(getMetricsSummary());
});

// Round 2 Task 4, Step 8: backs TrackMyReports.tsx's "Demo data — load
// sample reports" button. Returns up to 3 real complaints currently in the
// DB — one in an early/active state, one 'resolution_claimed', one
// 'disputed' — omitting any slot that doesn't exist yet (see
// getDemoReportCandidates in db.mjs for why this is looked up dynamically
// rather than hardcoded). No DB write, no auth, read-only.
app.get('/api/demo-reports', (_req, res) => {
  res.json(getDemoReportCandidates());
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

// Round 2 Task 4 (Orientation audit, server/index.mjs:172-192): the
// isProduction branch that used to serve dist/ here was dead code in this
// app's actual deployment topology — the backend (Render) and frontend
// (Vercel, serving dist/ itself via vercel.json's rewrite-to-index.html) are
// two separate services, so this server process never needs to serve the
// production frontend build at all; the old branch only produced a
// startup-time ENOENT when a fresh checkout had no dist/ present. It is
// simply deleted, not replaced — in production this backend is API-only
// (server/index.mjs's /health, /api/*, /uploads/* routes above), with no
// static/SPA fallback registered.
//
// The Vite dev-middleware branch below is kept guarded behind !isProduction
// exactly as before (just de-nested from the removed if/else) — it's what
// lets `npm run dev` serve the full SPA locally in one process, and `vite`
// is a devDependency that a production install may not even have present,
// so this must never run when NODE_ENV=production.
if (!isProduction) {
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
