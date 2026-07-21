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

// Latest evidence row across officer_proof OR citizen_proof — whichever proof was
// submitted most recently is the freshest evidence being adjudicated (mirrors the
// task-2 brief's "latest officer_proof/citizen_proof row" phrasing). See
// verificationAgent.mjs / task-2-report.md for the full rationale.
export function getLatestProofEvidence(complaintId, database = getDb()) {
  const row = database
    .prepare(`
      SELECT * FROM evidence
      WHERE complaint_id = ? AND kind IN ('officer_proof', 'citizen_proof')
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
