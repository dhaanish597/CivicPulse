import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLocalityByWard, localities, populateWardReferenceTable } from './data/localities.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'civicpulse.db');

let db;

export function getDb() {
  if (!db) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }

  return db;
}

export function initSchema(database = getDb()) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      ward INTEGER NOT NULL,
      locality TEXT NOT NULL,
      category TEXT NOT NULL,
      severity INTEGER NOT NULL,
      reported_at TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      days_open INTEGER NOT NULL DEFAULT 0,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      source TEXT NOT NULL,
      description TEXT,
      reasoning TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_traces (
      id TEXT PRIMARY KEY,
      complaint_id TEXT NOT NULL,
      step_name TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_complaints_ward ON complaints (ward);
    CREATE INDEX IF NOT EXISTS idx_complaints_resolved ON complaints (resolved);
    CREATE INDEX IF NOT EXISTS idx_complaints_reported_at ON complaints (reported_at);
    CREATE INDEX IF NOT EXISTS idx_complaints_category ON complaints (category);
    CREATE INDEX IF NOT EXISTS idx_agent_traces_complaint_id ON agent_traces (complaint_id);
  `);

  const cols = database.prepare("PRAGMA table_info(complaints)").all();
  if (!cols.some(c => c.name === 'status')) {
    database.exec(`
      ALTER TABLE complaints ADD COLUMN status TEXT NOT NULL DEFAULT 'reported';
      ALTER TABLE complaints ADD COLUMN lead TEXT;
      ALTER TABLE complaints ADD COLUMN status_updated_at TEXT;
      
      CREATE TABLE IF NOT EXISTS status_events (
        id TEXT PRIMARY KEY,
        complaint_id TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      
      UPDATE complaints SET status = 'resolved' WHERE resolved = 1;
    `);
  } else {
    database.exec(`
      CREATE TABLE IF NOT EXISTS status_events (
        id TEXT PRIMARY KEY,
        complaint_id TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  // Round 2: real GHMC zone/circle/ward hierarchy (ROUND2.md §2.2). Mirrors the
  // PRAGMA table_info-guarded shape above so a restart against an existing DB is safe.
  if (!cols.some(c => c.name === 'zone')) {
    database.exec(`
      ALTER TABLE complaints ADD COLUMN zone TEXT;
      ALTER TABLE complaints ADD COLUMN circle TEXT;
      ALTER TABLE complaints ADD COLUMN ward_name TEXT;
    `);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS ghmc_wards (
      ward_no INTEGER PRIMARY KEY,
      ward_name TEXT NOT NULL,
      circle TEXT NOT NULL,
      zone TEXT NOT NULL,
      lat REAL,
      lng REAL
    );

    CREATE INDEX IF NOT EXISTS idx_complaints_zone ON complaints(zone);
    CREATE INDEX IF NOT EXISTS idx_complaints_circle ON complaints(circle);
    CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
  `);

  // Round 2 Task 2: resolution verification (ROUND2.md §2 headline feature).
  // Same PRAGMA table_info guard pattern as the zone/circle/ward_name migration
  // above, so restarting against an existing DB is safe and idempotent.
  const verificationCols = database.prepare("PRAGMA table_info(complaints)").all();
  if (!verificationCols.some((c) => c.name === 'verification_status')) {
    database.exec(`
      ALTER TABLE complaints ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'not_required';
      ALTER TABLE complaints ADD COLUMN verification_reasoning TEXT;
      ALTER TABLE complaints ADD COLUMN verified_at TEXT;

      UPDATE complaints SET verification_status = 'unverified'
        WHERE status = 'resolved' AND verification_status = 'not_required';
    `);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      complaint_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      image_path TEXT NOT NULL,
      submitted_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_complaint_id ON evidence (complaint_id);
    CREATE INDEX IF NOT EXISTS idx_complaints_verification_status ON complaints (verification_status);
  `);

  // Round 2 Task 4: shared LLM response cache (server/cache.mjs#withCache),
  // reliability hardening against NVIDIA free-tier rate limits (ROUND2.md
  // §4.2). A brand-new table, so it uses the same plain
  // CREATE-TABLE-IF-NOT-EXISTS shape as evidence/agent_traces/status_events
  // above rather than the PRAGMA table_info-guarded ALTER pattern (that
  // pattern is only needed when adding a column to a table that may already
  // exist with rows in it).
  database.exec(`
    CREATE TABLE IF NOT EXISTS llm_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_llm_cache_created_at ON llm_cache (created_at);
  `);

  // Round 2 Task 5 (ROUND2.md §5.3): cost/latency instrumentation. One row
  // per REAL NVIDIA call (never a cache hit — see server/metrics.mjs), across
  // every NVIDIA-calling agent step: 'classification' (classifyImage, via
  // server/nvidia.mjs), 'verification_describe' and 'verification_adjudicate'
  // (server/agents/verificationAgent.mjs — 2 vision + 1 chat call per
  // verification, a proven-necessary deviation from a 1-call design; see
  // task-2-report.md), 'resolution_lead' (server/agents/resolutionAgent.mjs),
  // and 'route_advisory' (server/agents/routeAgent.mjs). Brand-new table, so
  // it uses the same plain CREATE-TABLE-IF-NOT-EXISTS shape as
  // llm_cache/evidence/agent_traces above rather than the PRAGMA
  // table_info-guarded ALTER pattern (that pattern is only needed when adding
  // a column to a table that may already exist with rows in it). Schema
  // exactly matches the Task 5 brief.
  database.exec(`
    CREATE TABLE IF NOT EXISTS run_metrics (
      id TEXT PRIMARY KEY,
      complaint_id TEXT,
      agent_step TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      estimated_cost_usd REAL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_run_metrics_agent_step ON run_metrics (agent_step);
    CREATE INDEX IF NOT EXISTS idx_run_metrics_complaint_id ON run_metrics (complaint_id);
  `);

  populateWardReferenceTable(database);
}

export function countComplaints(database = getDb()) {
  return database.prepare('SELECT COUNT(*) AS count FROM complaints').get().count;
}

export function listComplaints(filters = {}, database = getDb()) {
  const where = [];
  const params = {};

  if (filters.ward) {
    where.push('ward = @ward');
    params.ward = Number(filters.ward);
  }

  if (filters.circle) {
    where.push('circle = @circle');
    params.circle = String(filters.circle);
  }

  if (filters.resolved !== undefined && filters.resolved !== '') {
    where.push('resolved = @resolved');
    params.resolved = parseBoolean(filters.resolved) ? 1 : 0;
  }

  if (filters.since) {
    where.push('reported_at >= @since');
    params.since = new Date(String(filters.since)).toISOString();
  }

  const sql = `
    SELECT * FROM complaints
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY reported_at DESC
  `;

  return database.prepare(sql).all(params).map(rowToComplaint);
}

export function getComplaintById(id, database = getDb()) {
  const row = database.prepare('SELECT * FROM complaints WHERE id = ?').get(id);
  return row ? rowToComplaint(row) : null;
}

export function insertComplaint(complaint, database = getDb()) {
  const locality = complaint.locality || getLocalityByWard(complaint.ward).locality;
  const status = complaint.status || (complaint.resolved ? 'resolved' : 'reported');
  // Mirrors the one-time migration backfill in initSchema() (`verification_status =
  // 'unverified' WHERE status = 'resolved' AND verification_status = 'not_required'`)
  // at the insertion chokepoint itself. That migration only ever runs once, against
  // whatever rows already exist in the table at that moment — it can't retroactively
  // catch rows inserted afterward in the same process (e.g. seed.mjs's seedIfEmpty()
  // runs immediately after initSchema() on a fresh DB, so its synthetic 'resolved'
  // rows would otherwise land on the raw column DEFAULT of 'not_required' instead of
  // 'unverified'). Any caller can still override by passing verificationStatus
  // explicitly.
  const verificationStatus = complaint.verificationStatus
    ?? complaint.verification_status
    ?? (status === 'resolved' ? 'unverified' : 'not_required');
  const row = {
    id: complaint.id,
    ward: complaint.ward,
    locality,
    category: complaint.category,
    severity: complaint.severity,
    reported_at: complaint.reportedAt ?? complaint.reported_at ?? new Date().toISOString(),
    resolved: complaint.resolved ? 1 : 0,
    days_open: complaint.daysOpen ?? complaint.days_open ?? 0,
    lat: complaint.lat,
    lng: complaint.lng,
    source: complaint.source,
    description: complaint.description ?? null,
    reasoning: complaint.reasoning ?? null,
    status: status,
    lead: complaint.lead ?? null,
    status_updated_at: complaint.statusUpdatedAt ?? new Date().toISOString(),
    zone: complaint.zone ?? null,
    circle: complaint.circle ?? null,
    ward_name: complaint.wardName ?? complaint.ward_name ?? null,
    verification_status: verificationStatus,
  };

  database
    .prepare(`
      INSERT INTO complaints (
        id, ward, locality, category, severity, reported_at, resolved, days_open,
        lat, lng, source, description, reasoning, status, lead, status_updated_at,
        zone, circle, ward_name, verification_status
      ) VALUES (
        @id, @ward, @locality, @category, @severity, @reported_at, @resolved,
        @days_open, @lat, @lng, @source, @description, @reasoning, @status, @lead, @status_updated_at,
        @zone, @circle, @ward_name, @verification_status
      )
    `)
    .run(row);

  return getComplaintById(row.id, database);
}

export function updateComplaintStatus(id, updates, database = getDb()) {
  const row = {
    id,
    status: updates.status,
    lead: updates.lead ?? null,
    status_updated_at: new Date().toISOString(),
    resolved: updates.status === 'resolved' ? 1 : 0,
  };
  
  database.prepare(`
    UPDATE complaints 
    SET status = @status, lead = COALESCE(@lead, lead), status_updated_at = @status_updated_at, resolved = @resolved
    WHERE id = @id
  `).run(row);
}

export function updateVerification(id, updates, database = getDb()) {
  const row = {
    id,
    verification_status: updates.verificationStatus,
    verification_reasoning: updates.verificationReasoning ?? null,
    verified_at: updates.verifiedAt ?? new Date().toISOString(),
  };

  database.prepare(`
    UPDATE complaints
    SET verification_status = @verification_status,
        verification_reasoning = @verification_reasoning,
        verified_at = @verified_at
    WHERE id = @id
  `).run(row);

  return getComplaintById(id, database);
}

// Fixed escalation applied when a claimed resolution is disputed (Round 2 Task 2,
// server/agents/verificationAgent.mjs). Severity is the dominant weighted term in
// analytics.mjs#scoreUrgency (severity * 8 vs. daysOpen * 2 and recurrence * 1.5),
// so bumping it by a documented +1 (capped at 5) makes the dispute's urgency
// escalation durable and visible anywhere scoreUrgency is recomputed (dispatch
// list, forecast, etc.) without needing a persisted urgency column that doesn't
// otherwise exist on this table. See task-2-report.md for the full rationale.
export function escalateSeverity(id, database = getDb()) {
  database.prepare(`
    UPDATE complaints SET severity = MIN(severity + 1, 5) WHERE id = ?
  `).run(id);

  return getComplaintById(id, database);
}

export function insertAgentTrace(trace, database = getDb()) {
  const row = {
    id: trace.id,
    complaint_id: trace.complaintId,
    step_name: trace.stepName,
    step_order: trace.stepOrder,
    detail: trace.detail,
    created_at: trace.createdAt ?? new Date().toISOString(),
  };

  database
    .prepare(`
      INSERT INTO agent_traces (id, complaint_id, step_name, step_order, detail, created_at)
      VALUES (@id, @complaint_id, @step_name, @step_order, @detail, @created_at)
    `)
    .run(row);

  return rowToTrace(row);
}

export function listAgentTraces(complaintId, database = getDb()) {
  return database
    .prepare('SELECT * FROM agent_traces WHERE complaint_id = ? ORDER BY step_order ASC')
    .all(complaintId)
    .map(rowToTrace);
}

export function insertStatusEvent(event, database = getDb()) {
  const row = {
    id: event.id,
    complaint_id: event.complaintId,
    status: event.status,
    note: event.note ?? null,
    actor: event.actor,
    created_at: event.createdAt ?? new Date().toISOString(),
  };
  database.prepare(`
    INSERT INTO status_events (id, complaint_id, status, note, actor, created_at)
    VALUES (@id, @complaint_id, @status, @note, @actor, @created_at)
  `).run(row);
}

export function listStatusEvents(complaintId, database = getDb()) {
  return database
    .prepare('SELECT * FROM status_events WHERE complaint_id = ? ORDER BY created_at ASC')
    .all(complaintId)
    .map(row => ({
      id: row.id,
      complaintId: row.complaint_id,
      status: row.status,
      note: row.note ?? undefined,
      actor: row.actor,
      createdAt: row.created_at,
    }));
}

export function clearSeedData(database = getDb()) {
  database.exec('DELETE FROM agent_traces; DELETE FROM complaints;');
}

export function insertEvidence(evidence, database = getDb()) {
  const row = {
    id: evidence.id,
    complaint_id: evidence.complaintId,
    kind: evidence.kind,
    image_path: evidence.imagePath,
    submitted_by: evidence.submittedBy,
    created_at: evidence.createdAt ?? new Date().toISOString(),
  };

  database.prepare(`
    INSERT INTO evidence (id, complaint_id, kind, image_path, submitted_by, created_at)
    VALUES (@id, @complaint_id, @kind, @image_path, @submitted_by, @created_at)
  `).run(row);

  return rowToEvidence(row);
}

export function listEvidence(complaintId, database = getDb()) {
  return database
    .prepare('SELECT * FROM evidence WHERE complaint_id = ? ORDER BY created_at ASC')
    .all(complaintId)
    .map(rowToEvidence);
}

// Latest evidence row of exactly one kind (used for 'intake').
export function getLatestEvidenceByKind(complaintId, kind, database = getDb()) {
  const row = database
    .prepare('SELECT * FROM evidence WHERE complaint_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1')
    .get(complaintId, kind);
  return row ? rowToEvidence(row) : null;
}

// Latest citizen_proof evidence row — and ONLY citizen_proof. Verification
// must adjudicate the intake photo against the citizen's independent
// counter-evidence, never the officer's own officer_proof photo (an officer
// re-uploading officer_proof must have zero effect on verification — see
// task-2-report.md "Fix round 1" for the Critical finding this closes: the
// prior getLatestProofEvidence() unioned both kinds by recency, which let an
// officer satisfy verification with self-submitted evidence alone).
export function getLatestCitizenProofEvidence(complaintId, database = getDb()) {
  const row = database
    .prepare(`
      SELECT * FROM evidence
      WHERE complaint_id = ? AND kind = 'citizen_proof'
      ORDER BY created_at DESC LIMIT 1
    `)
    .get(complaintId);
  return row ? rowToEvidence(row) : null;
}

export function getVerificationStats(database = getDb()) {
  const rows = database
    .prepare('SELECT verification_status, COUNT(*) AS count FROM complaints GROUP BY verification_status')
    .all();

  const counts = {
    not_required: 0,
    awaiting_proof: 0,
    verified: 0,
    disputed: 0,
    inconclusive: 0,
    unverified: 0,
  };

  rows.forEach((row) => {
    counts[row.verification_status] = row.count;
  });

  const verifiedOrDisputed = counts.verified + counts.disputed;
  const disputedRate = verifiedOrDisputed > 0 ? round4(counts.disputed / verifiedOrDisputed) : 0;

  return {
    counts,
    disputed_rate: disputedRate,
    unverified_legacy_count: counts.unverified,
  };
}

// Round 2 Task 4, Step 8 (ROUND2.md §4.6): backs GET /api/demo-reports. A
// judge arriving fresh has empty localStorage, so TrackMyReports starts
// blank — the "Demo data" button needs 3 real complaint IDs spanning
// different states, including one 'resolution_claimed' (awaiting
// verification) and one 'disputed'. Seeding alone (server/seed.mjs) never
// produces either of those two states — they only exist once the real
// claim/verify/dispute flow has actually been exercised through the app or
// API — so these are looked up dynamically against whatever's really in the
// DB right now rather than shipping hardcoded IDs that would silently stop
// existing the moment the DB is reseeded fresh. Any slot with no matching
// row yet is simply omitted (never fabricated), so the caller can render
// however many of the 3 target states genuinely exist.
export function getDemoReportCandidates(database = getDb()) {
  const active = database
    .prepare(`
      SELECT * FROM complaints
      WHERE status IN ('reported', 'acknowledged', 'in_progress')
      ORDER BY reported_at DESC
      LIMIT 1
    `)
    .get();

  const awaitingVerification = database
    .prepare(`
      SELECT * FROM complaints
      WHERE status = 'resolution_claimed'
      ORDER BY status_updated_at DESC
      LIMIT 1
    `)
    .get();

  const disputed = database
    .prepare(`
      SELECT * FROM complaints
      WHERE verification_status = 'disputed'
      ORDER BY verified_at DESC
      LIMIT 1
    `)
    .get();

  return [active, awaitingVerification, disputed]
    .filter(Boolean)
    .map(rowToComplaint);
}

export function getDisputedClosures({ circle, limit = 10 } = {}, database = getDb()) {
  const where = ["verification_status = 'disputed'"];
  const params = {};

  if (circle) {
    where.push('circle = @circle');
    params.circle = String(circle);
  }

  params.limit = Number(limit) || 10;

  const rows = database
    .prepare(`
      SELECT id, category, circle, ward_name, verification_reasoning, verified_at
      FROM complaints
      WHERE ${where.join(' AND ')}
      ORDER BY verified_at DESC
      LIMIT @limit
    `)
    .all(params);

  return rows.map((row) => ({
    complaint_id: row.id,
    category: row.category,
    circle: row.circle,
    ward_name: row.ward_name,
    verification_reasoning: row.verification_reasoning,
    verified_at: row.verified_at,
  }));
}

export function insertRunMetric(metric, database = getDb()) {
  const row = {
    id: metric.id,
    complaint_id: metric.complaintId ?? null,
    agent_step: metric.agentStep,
    duration_ms: metric.durationMs,
    prompt_tokens: metric.promptTokens ?? null,
    completion_tokens: metric.completionTokens ?? null,
    estimated_cost_usd: metric.estimatedCostUsd ?? null,
    created_at: metric.createdAt ?? new Date().toISOString(),
  };

  database
    .prepare(`
      INSERT INTO run_metrics (
        id, complaint_id, agent_step, duration_ms, prompt_tokens, completion_tokens, estimated_cost_usd, created_at
      ) VALUES (
        @id, @complaint_id, @agent_step, @duration_ms, @prompt_tokens, @completion_tokens, @estimated_cost_usd, @created_at
      )
    `)
    .run(row);

  return row;
}

// Round 2 Task 5, Step 5 (ROUND2.md §5.3): backs GET /api/metrics/summary.
// p50/p95 latency per agent_step (nearest-rank percentile — simple, standard,
// no interpolation needed at this data volume), plus mean total tokens and
// mean estimated cost PER COMPLAINT (summed across every agent_step row that
// shares a complaint_id, then averaged across complaints — a complaint that
// went through classification + a 3-call verification counts all 4 rows
// toward its own total). Rows with a null complaint_id (route_advisory, and
// any classification call made outside the complaint pipeline, e.g. the
// eval scripts or the raw /api/classify preview route) are included in the
// per-agent_step latency stats but excluded from the per-complaint tokens/
// cost average, since they can't be attributed to one complaint.
export function getMetricsSummary(database = getDb()) {
  const rows = database.prepare('SELECT * FROM run_metrics').all();

  const rowsByStep = new Map();
  for (const row of rows) {
    if (!rowsByStep.has(row.agent_step)) rowsByStep.set(row.agent_step, []);
    rowsByStep.get(row.agent_step).push(row);
  }

  const by_agent_step = {};
  for (const [step, stepRows] of rowsByStep) {
    const durations = stepRows.map((r) => r.duration_ms).sort((a, b) => a - b);
    const costs = stepRows.map((r) => r.estimated_cost_usd).filter((c) => c !== null);
    by_agent_step[step] = {
      count: stepRows.length,
      p50_duration_ms: percentile(durations, 0.5),
      p95_duration_ms: percentile(durations, 0.95),
      mean_estimated_cost_usd: costs.length ? round6(costs.reduce((s, c) => s + c, 0) / costs.length) : null,
    };
  }

  const byComplaint = new Map();
  for (const row of rows) {
    if (!row.complaint_id) continue;
    if (!byComplaint.has(row.complaint_id)) byComplaint.set(row.complaint_id, { tokens: 0, cost: 0 });
    const bucket = byComplaint.get(row.complaint_id);
    bucket.tokens += (row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0);
    bucket.cost += row.estimated_cost_usd ?? 0;
  }

  const complaintBuckets = Array.from(byComplaint.values());
  const mean_tokens_per_complaint = complaintBuckets.length
    ? Math.round(complaintBuckets.reduce((s, b) => s + b.tokens, 0) / complaintBuckets.length)
    : null;
  const mean_estimated_cost_usd_per_complaint = complaintBuckets.length
    ? round6(complaintBuckets.reduce((s, b) => s + b.cost, 0) / complaintBuckets.length)
    : null;

  return {
    total_calls: rows.length,
    complaints_with_metrics: complaintBuckets.length,
    by_agent_step,
    mean_tokens_per_complaint,
    mean_estimated_cost_usd_per_complaint,
  };
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const idx = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil(p * sortedValues.length) - 1));
  return sortedValues[idx];
}

function round6(value) {
  return Number(value.toFixed(6));
}

function round4(value) {
  return Number(value.toFixed(4));
}

export function dbTransaction(fn, database = getDb()) {
  return database.transaction(fn)();
}

export function findLocalityByWard(ward) {
  return getLocalityByWard(ward);
}

export function allLocalities() {
  return localities;
}

export function rowToComplaint(row) {
  return {
    id: row.id,
    ward: row.ward,
    locality: row.locality,
    category: row.category,
    severity: row.severity,
    reportedAt: row.reported_at,
    resolved: Boolean(row.resolved),
    daysOpen: row.days_open,
    lat: row.lat,
    lng: row.lng,
    source: row.source,
    address: row.locality,
    description: row.description ?? undefined,
    reasoning: row.reasoning ?? undefined,
    status: row.status || (row.resolved ? 'resolved' : 'reported'),
    lead: row.lead ?? undefined,
    statusUpdatedAt: row.status_updated_at ?? undefined,
    zone: row.zone ?? undefined,
    circle: row.circle ?? undefined,
    wardName: row.ward_name ?? undefined,
    verificationStatus: row.verification_status ?? 'not_required',
    verificationReasoning: row.verification_reasoning ?? undefined,
    verifiedAt: row.verified_at ?? undefined,
  };
}

function rowToTrace(row) {
  return {
    id: row.id,
    complaintId: row.complaint_id,
    stepName: row.step_name,
    stepOrder: row.step_order,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

function rowToEvidence(row) {
  return {
    id: row.id,
    complaintId: row.complaint_id,
    kind: row.kind,
    imagePath: row.image_path,
    submittedBy: row.submitted_by,
    createdAt: row.created_at,
  };
}

function parseBoolean(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return String(value).toLowerCase() === 'true';
}
