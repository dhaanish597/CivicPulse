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
  };

  database
    .prepare(`
      INSERT INTO complaints (
        id, ward, locality, category, severity, reported_at, resolved, days_open,
        lat, lng, source, description, reasoning, status, lead, status_updated_at,
        zone, circle, ward_name
      ) VALUES (
        @id, @ward, @locality, @category, @severity, @reported_at, @resolved,
        @days_open, @lat, @lng, @source, @description, @reasoning, @status, @lead, @status_updated_at,
        @zone, @circle, @ward_name
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

function parseBoolean(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return String(value).toLowerCase() === 'true';
}
