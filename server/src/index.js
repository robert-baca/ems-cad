const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const http       = require('http');
const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const { Pool }   = require('pg');
require('dotenv').config();

// CORS_ORIGIN can be set to a comma-separated allowlist; defaults to '*' (current behavior)
const CORS_ORIGIN = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : '*';

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST', 'PATCH', 'PUT'] }
});

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// ── Startup security checks — loud warnings, not hard failures ─────
// (avoid taking down a live dispatch system over a missing env var;
//  these print prominently in Railway logs so they're hard to miss)
function warnIfWeak(name, value, fallback) {
  if (!value || value === fallback) {
    console.warn(`\n⚠️  [security] ${name} is not set — using an insecure default. Set it in Railway env vars.\n`);
  }
}
warnIfWeak('JWT_SECRET',          process.env.JWT_SECRET,          undefined);
warnIfWeak('CREW_PIN',            process.env.CREW_PIN,            undefined);
warnIfWeak('DISPLAY_PIN',         process.env.DISPLAY_PIN,         undefined);
warnIfWeak('GPS_WEBHOOK_SECRET',  process.env.GPS_WEBHOOK_SECRET,  undefined);

// ── Database ──────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});
pool.on('error', (err) => console.error('[db] pool error:', err.message));

// ── In-memory store (seeded from DB on startup) ───────────────────
const PW = 'ems2024';
const dispatchers = [
  { id: 'd1', username: 'dispatch',  full_name: 'Command Dispatch', password_hash: bcrypt.hashSync(PW, 8) },
  { id: 'd2', username: 'dispatch2', full_name: 'Dispatch 2',       password_hash: bcrypt.hashSync(PW, 8) }
];
const overwatches = [
  { id: 'ow1', username: 'overwatch', full_name: 'Overwatch', password_hash: bcrypt.hashSync(PW, 8) }
];

let units        = [];
let calls        = [];
let locations    = [];
let trackers     = [];
let currentShift = null;
let nextCallNum  = 100;
const unknownGpsDevices = new Set();

// ── DB setup & seed ───────────────────────────────────────────────
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY,
      unit_number TEXT NOT NULL,
      unit_name TEXT,
      unit_type TEXT DEFAULT 'ALS',
      status TEXT DEFAULT 'available',
      crew TEXT,
      station TEXT,
      tracki_device_id TEXT,
      last_lat DOUBLE PRECISION,
      last_lng DOUBLE PRECISION,
      last_gps_at TEXT,
      password_hash TEXT,
      profile JSONB
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      call_number INTEGER,
      status TEXT DEFAULT 'pending',
      call_type TEXT,
      priority INTEGER DEFAULT 2,
      location_name TEXT,
      location_lat DOUBLE PRECISION,
      location_lng DOUBLE PRECISION,
      assigned_unit_id TEXT,
      received_at TEXT,
      dispatched_at TEXT,
      acknowledged_at TEXT,
      en_route_at TEXT,
      on_scene_at TEXT,
      patient_contact_at TEXT,
      cleared_at TEXT,
      available_at TEXT,
      closed_at TEXT,
      disposition TEXT,
      close_notes TEXT,
      comments JSONB DEFAULT '[]',
      narrative TEXT
    )
  `);

  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS narrative TEXT`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS additional_unit_ids JSONB DEFAULT '[]'`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS response_mode TEXT`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS parent_call_id TEXT`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS mutual_aid_agencies JSONB DEFAULT '[]'`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS arrived_first_aid_at TEXT`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS transporting_at TEXT`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS co_unit_ids JSONB DEFAULT '[]'`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS assigned_unit_number TEXT`);
  await pool.query(`ALTER TABLE locations ADD COLUMN IF NOT EXISTS location_type TEXT DEFAULT 'permanent'`);
  await pool.query(`ALTER TABLE units ADD COLUMN IF NOT EXISTS tracki_device_id TEXT`);
  await pool.query(`ALTER TABLE units ADD COLUMN IF NOT EXISTS tracker_name TEXT`);

  // Prune calls older than 90 days
  const pruneDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const pruned = await pool.query('DELETE FROM calls WHERE received_at < $1', [pruneDate]);
  if (pruned.rowCount > 0) console.log(`[db] pruned ${pruned.rowCount} calls older than 90 days`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trackers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      device_id TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      color TEXT DEFAULT '#6366f1',
      location_type TEXT DEFAULT 'permanent'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      shift_label TEXT,
      date TEXT,
      started_at TEXT,
      ended_at TEXT,
      started_by TEXT,
      unit_staffing JSONB DEFAULT '[]'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trackimo_tokens (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT
    )
  `);

  const unitsRes = await pool.query('SELECT * FROM units ORDER BY unit_number');
  units = unitsRes.rows;

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const callsRes = await pool.query(
    'SELECT * FROM calls WHERE received_at > $1 ORDER BY received_at DESC',
    [cutoff]
  );
  calls = callsRes.rows.map(r => ({
    ...r,
    comments:            r.comments            || [],
    additional_unit_ids: r.additional_unit_ids || [],
    mutual_aid_agencies: r.mutual_aid_agencies || [],
    co_unit_ids:         r.co_unit_ids         || []
  }));
  // Query global max so call numbers never reset after a restart
  const maxRes = await pool.query('SELECT MAX(call_number) AS max_num FROM calls');
  nextCallNum = (maxRes.rows[0]?.max_num || 99) + 1;

  const shiftRes = await pool.query("SELECT * FROM shifts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1");
  currentShift = shiftRes.rows[0] || null;
  if (currentShift) currentShift.unit_staffing = currentShift.unit_staffing || [];

  const locsRes = await pool.query("SELECT * FROM locations ORDER BY name");
  locations = locsRes.rows;

  const trackersRes = await pool.query('SELECT * FROM trackers ORDER BY name');
  trackers = trackersRes.rows;

  console.log(`[db] loaded ${units.length} units, ${calls.length} calls, ${locations.length} locations, ${trackers.length} trackers, shift: ${currentShift?.shift_label || 'none'}`);
}

async function saveUnit(unit) {
  await pool.query(`
    INSERT INTO units (id, unit_number, unit_name, unit_type, status, crew, station,
      tracki_device_id, tracker_name, last_lat, last_lng, last_gps_at, password_hash, profile)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (id) DO UPDATE SET
      unit_number=EXCLUDED.unit_number, unit_name=EXCLUDED.unit_name, unit_type=EXCLUDED.unit_type,
      status=EXCLUDED.status, crew=EXCLUDED.crew, station=EXCLUDED.station,
      tracki_device_id=EXCLUDED.tracki_device_id, tracker_name=EXCLUDED.tracker_name,
      last_lat=EXCLUDED.last_lat, last_lng=EXCLUDED.last_lng,
      last_gps_at=EXCLUDED.last_gps_at, password_hash=EXCLUDED.password_hash, profile=EXCLUDED.profile
  `, [unit.id, unit.unit_number, unit.unit_name, unit.unit_type, unit.status,
      unit.crew, unit.station, unit.tracki_device_id, unit.tracker_name || null, unit.last_lat, unit.last_lng,
      unit.last_gps_at, unit.password_hash, unit.profile ? JSON.stringify(unit.profile) : null]);
}

async function deleteUnitFromDb(id) {
  await pool.query('DELETE FROM units WHERE id=$1', [id]);
}

async function saveCall(call) {
  await pool.query(`
    INSERT INTO calls (id, call_number, status, call_type, priority, location_name,
      location_lat, location_lng, assigned_unit_id, assigned_unit_number, received_at, dispatched_at, acknowledged_at,
      en_route_at, on_scene_at, patient_contact_at, arrived_first_aid_at, transporting_at,
      cleared_at, available_at, closed_at,
      disposition, close_notes, comments, narrative, additional_unit_ids, response_mode,
      parent_call_id, mutual_aid_agencies, co_unit_ids)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
    ON CONFLICT (id) DO UPDATE SET
      status=EXCLUDED.status, call_type=EXCLUDED.call_type, priority=EXCLUDED.priority,
      location_name=EXCLUDED.location_name, location_lat=EXCLUDED.location_lat,
      location_lng=EXCLUDED.location_lng, assigned_unit_id=EXCLUDED.assigned_unit_id,
      assigned_unit_number=EXCLUDED.assigned_unit_number,
      dispatched_at=EXCLUDED.dispatched_at, acknowledged_at=EXCLUDED.acknowledged_at,
      en_route_at=EXCLUDED.en_route_at, on_scene_at=EXCLUDED.on_scene_at,
      patient_contact_at=EXCLUDED.patient_contact_at,
      arrived_first_aid_at=EXCLUDED.arrived_first_aid_at, transporting_at=EXCLUDED.transporting_at,
      cleared_at=EXCLUDED.cleared_at, available_at=EXCLUDED.available_at, closed_at=EXCLUDED.closed_at,
      disposition=EXCLUDED.disposition, close_notes=EXCLUDED.close_notes,
      comments=EXCLUDED.comments, narrative=EXCLUDED.narrative,
      additional_unit_ids=EXCLUDED.additional_unit_ids, response_mode=EXCLUDED.response_mode,
      parent_call_id=EXCLUDED.parent_call_id, mutual_aid_agencies=EXCLUDED.mutual_aid_agencies,
      co_unit_ids=EXCLUDED.co_unit_ids
  `, [call.id, call.call_number, call.status, call.call_type, call.priority,
      call.location_name, call.location_lat, call.location_lng, call.assigned_unit_id,
      call.assigned_unit_number || null,
      call.received_at, call.dispatched_at, call.acknowledged_at, call.en_route_at,
      call.on_scene_at, call.patient_contact_at, call.arrived_first_aid_at || null,
      call.transporting_at || null, call.cleared_at, call.available_at,
      call.closed_at, call.disposition, call.close_notes, JSON.stringify(call.comments || []),
      call.narrative || null, JSON.stringify(call.additional_unit_ids || []),
      call.response_mode || null, call.parent_call_id || null,
      JSON.stringify(call.mutual_aid_agencies || []),
      JSON.stringify(call.co_unit_ids || [])]);
}

async function saveLocation(loc) {
  await pool.query(`
    INSERT INTO locations (id, name, lat, lng, color, location_type)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, lat=EXCLUDED.lat, lng=EXCLUDED.lng,
      color=EXCLUDED.color, location_type=EXCLUDED.location_type
  `, [loc.id, loc.name, loc.lat, loc.lng, loc.color, loc.location_type]);
}

async function deleteLocationFromDb(id) {
  await pool.query('DELETE FROM locations WHERE id=$1', [id]);
}

async function saveTracker(t) {
  await pool.query(`
    INSERT INTO trackers (id, name, device_id) VALUES ($1,$2,$3)
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, device_id=EXCLUDED.device_id
  `, [t.id, t.name, t.device_id]);
}

async function deleteTrackerFromDb(id) {
  await pool.query('DELETE FROM trackers WHERE id=$1', [id]);
}

async function saveShift(shift) {
  if (!shift) return;
  await pool.query(`
    INSERT INTO shifts (id, shift_label, date, started_at, ended_at, started_by, unit_staffing)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (id) DO UPDATE SET
      shift_label=EXCLUDED.shift_label, ended_at=EXCLUDED.ended_at,
      unit_staffing=EXCLUDED.unit_staffing
  `, [shift.id, shift.shift_label, shift.date, shift.started_at, shift.ended_at,
      shift.started_by, JSON.stringify(shift.unit_staffing || [])]);
}

// ── JWT helpers ───────────────────────────────────────────────────
// Long-lived on purpose: crew/dispatcher devices stay logged in across
// shifts and backgrounded phone time instead of getting bounced to login.
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Auth ──────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  if (role === 'dispatcher') {
    const d = dispatchers.find(x => x.username === username);
    if (d && bcrypt.compareSync(password, d.password_hash)) {
      const token = signToken({ dispatcher_id: d.id, username: d.username, role: 'dispatcher' });
      return res.json({ token, user: { role: 'dispatcher', username: d.username, name: d.full_name } });
    }
    const ow = overwatches.find(x => x.username === username);
    if (ow && bcrypt.compareSync(password, ow.password_hash)) {
      const token = signToken({ id: ow.id, username: ow.username, role: 'overwatch' });
      return res.json({ token, user: { role: 'overwatch', username: ow.username, name: ow.full_name } });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (role === 'crew') {
    const unit = units.find(u => u.unit_number.toLowerCase() === username.toLowerCase());
    if (!unit || !bcrypt.compareSync(password, unit.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken({ unit_id: unit.id, unit_number: unit.unit_number, role: 'crew' });
    return res.json({
      token,
      user: { role: 'crew', unit_id: unit.id, unit_number: unit.unit_number, profile: unit.profile }
    });
  }

  res.status(400).json({ error: 'Unknown role' });
});

const VALID_UNIT_STATUSES = new Set([
  'available', 'dispatched', 'acknowledged', 'en_route',
  'on_scene', 'patient_contact', 'transporting', 'cleared', 'out_of_service'
]);

// ── Units ─────────────────────────────────────────────────────────
app.get('/api/units', verifyToken, (req, res) => {
  res.json(units.map(u => ({ ...u, password_hash: undefined })));
});

app.patch('/api/units/:id/status', verifyToken, async (req, res) => {
  const unit = units.find(u => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: 'Not found' });

  if (req.user.role === 'crew' &&
      req.user.unit_id !== unit.id &&
      req.user.unit_number !== unit.unit_number)
    return res.status(403).json({ error: 'Forbidden' });

  if (!VALID_UNIT_STATUSES.has(req.body.status))
    return res.status(400).json({ error: 'Invalid status' });

  unit.status = req.body.status;
  saveUnit(unit).catch(console.error);
  io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: unit.status });
  io.to(`crew:${unit.id}`).emit('unit:status_change', { unit_id: unit.id, status: unit.status });
  res.json({ ok: true, unit });
});

app.put('/api/units/:id/profile', verifyToken, async (req, res) => {
  const unit = units.find(u => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'crew' &&
      req.user.unit_id !== unit.id &&
      req.user.unit_number !== unit.unit_number)
    return res.status(403).json({ error: 'Forbidden' });

  unit.profile = { ...req.body };
  saveUnit(unit).catch(console.error);
  io.to('dispatchers').emit('unit:profile_update', { unit_id: unit.id, profile: unit.profile });
  res.json({ ok: true, profile: unit.profile });
});

app.post('/api/units', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const { unit_number, unit_name, unit_type = 'ALS', tracker_name } = req.body;
  if (!unit_number?.trim() || !unit_name?.trim())
    return res.status(400).json({ error: 'unit_number and unit_name are required' });
  const newUnit = {
    id:              `u-${Date.now()}`,
    unit_number:     unit_number.trim(),
    unit_name:       unit_name.trim(),
    unit_type,
    status:          'available',
    last_lat:        null,
    last_lng:        null,
    tracki_device_id: null,
    tracker_name:    tracker_name || null,
    password_hash:   bcrypt.hashSync('ems2024', 8),
    profile:         null,
    crew:            null,
    station:         null
  };
  units.push(newUnit);
  await saveUnit(newUnit).catch(console.error);
  const sanitized = { ...newUnit, password_hash: undefined };
  io.to('dispatchers').emit('unit:updated', sanitized);
  res.status(201).json(sanitized);
});

app.put('/api/units/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const unit = units.find(u => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: 'Not found' });

  const { unit_number, unit_name, unit_type, password, tracker_name } = req.body;
  if (unit_number !== undefined)    unit.unit_number  = unit_number;
  if (unit_name   !== undefined)    unit.unit_name    = unit_name;
  if (unit_type   !== undefined)    unit.unit_type    = unit_type;
  if (password)                     unit.password_hash = bcrypt.hashSync(password, 8);

  if ('tracker_name' in req.body) {
    const newTracker = tracker_name || null;
    // Clear this tracker from any other unit that currently has it
    if (newTracker) {
      units.forEach(u => {
        if (u.id !== unit.id && u.tracker_name === newTracker) {
          u.tracker_name = null;
          saveUnit(u).catch(console.error);
          io.to('dispatchers').emit('unit:updated', { ...u, password_hash: undefined });
        }
      });
    }
    unit.tracker_name = newTracker;
  }

  await saveUnit(unit).catch(console.error);
  const sanitized = { ...unit, password_hash: undefined };
  io.to('dispatchers').emit('unit:updated', sanitized);
  res.json(sanitized);
});

app.delete('/api/units/:id/gps', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const unit = units.find(u => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: 'Not found' });
  unit.last_lat    = null;
  unit.last_lng    = null;
  unit.last_gps_at = null;
  saveUnit(unit).catch(console.error);
  const sanitized = { ...unit, password_hash: undefined };
  io.to('dispatchers').emit('unit:updated', sanitized);
  // Explicit null GPS update so ParkMap on display board removes the dot
  io.to('dispatchers').emit('unit:gps_update', { unit_id: unit.id, unit_number: unit.unit_number, lat: null, lng: null, timestamp: null });
  res.json({ ok: true });
});

app.delete('/api/units/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const idx = units.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  units.splice(idx, 1);
  deleteUnitFromDb(req.params.id).catch(console.error);
  io.to('dispatchers').emit('unit:removed', { unit_id: req.params.id });
  res.json({ ok: true });
});

// ── Calls ─────────────────────────────────────────────────────────
app.get('/api/calls', verifyToken, (req, res) => {
  if (req.user.role === 'crew') {
    const mine = calls.filter(c => c.assigned_unit_id === req.user.unit_id && c.status !== 'closed');
    return res.json(mine);
  }
  res.json(calls);
});

app.get('/api/calls/history', verifyToken, async (req, res) => {
  if (!['dispatcher', 'overwatch'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const result = await pool.query(
      'SELECT * FROM calls WHERE received_at > $1 ORDER BY received_at DESC',
      [cutoff]
    );
    res.json(result.rows.map(r => ({
      ...r,
      comments:            r.comments            || [],
      additional_unit_ids: r.additional_unit_ids || [],
      mutual_aid_agencies: r.mutual_aid_agencies || [],
      co_unit_ids:         r.co_unit_ids         || []
    })));
  } catch (err) {
    console.error('[history] query error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/calls', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const hasUnit        = !!req.body.assigned_unit_id;
  const additionalIds  = Array.isArray(req.body.additional_unit_ids) ? req.body.additional_unit_ids : [];

  if (hasUnit) {
    const conflict = getUnitActiveCall(req.body.assigned_unit_id);
    if (conflict) return res.status(409).json({ error: `Unit already on call #${conflict.call_number}` });
  }
  const id         = `call-${Date.now()}`;
  const callNumber = nextCallNum++;
  const call = {
    ...req.body,
    // Protected fields — never overrideable by the client
    id,
    call_number:          callNumber,
    status:               hasUnit ? 'dispatched' : 'pending',
    received_at:          new Date().toISOString(),
    dispatched_at:        hasUnit ? new Date().toISOString() : null,
    acknowledged_at:      null, en_route_at: null, on_scene_at: null,
    patient_contact_at:   null, transporting_at: null, arrived_first_aid_at: null,
    cleared_at:           null, available_at: null,
    closed_at:            null, disposition: null, close_notes: null,
    comments:             [],
    additional_unit_ids:  additionalIds,
    co_unit_ids:          additionalIds,   // units in the initial dispatch travel together
    assigned_unit_number: hasUnit ? (units.find(u => u.id === req.body.assigned_unit_id)?.unit_number || null) : null
  };
  calls.unshift(call);
  await saveCall(call).catch(console.error);

  io.to('dispatchers').emit('call:created', call);
  if (hasUnit) {
    io.to(`crew:${call.assigned_unit_id}`).emit('call:assigned_to_me', call);
    const unit = units.find(u => u.id === call.assigned_unit_id);
    if (unit) {
      unit.status = 'dispatched';
      saveUnit(unit).catch(console.error);
      io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: 'dispatched' });
      io.to(`crew:${unit.id}`).emit('unit:status_change', { unit_id: unit.id, status: 'dispatched' });
    }
  }
  additionalIds.forEach(uid => {
    const u = units.find(u => u.id === uid);
    if (u) {
      u.status = 'dispatched';
      saveUnit(u).catch(console.error);
      io.to('dispatchers').emit('unit:status_change', { unit_id: u.id, status: 'dispatched' });
      io.to(`crew:${uid}`).emit('unit:status_change', { unit_id: u.id, status: 'dispatched' });
      io.to(`crew:${uid}`).emit('call:assigned_to_me', call);
    }
  });

  res.status(201).json(call);
});

app.patch('/api/calls/:id/assign', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });

  const conflict = getUnitActiveCall(req.body.unit_id, req.params.id);
  if (conflict) return res.status(409).json({ error: `Unit already on call #${conflict.call_number}` });

  call.assigned_unit_id     = req.body.unit_id;
  call.assigned_unit_number = units.find(u => u.id === req.body.unit_id)?.unit_number || null;
  call.status               = 'dispatched';
  call.dispatched_at        = call.dispatched_at || new Date().toISOString();

  const unit = units.find(u => u.id === req.body.unit_id);
  if (unit) {
    unit.status = 'dispatched';
    saveUnit(unit).catch(console.error);
    io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: 'dispatched' });
  }

  saveCall(call).catch(console.error);
  io.to('dispatchers').emit('call:assigned', { call_id: call.id, unit_id: req.body.unit_id });
  io.to(`crew:${req.body.unit_id}`).emit('call:assigned_to_me', call);
  res.json(call);
});

app.post('/api/calls/:id/add-unit', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });
  const { unit_id } = req.body;
  if (!unit_id) return res.status(400).json({ error: 'unit_id required' });

  const conflict = getUnitActiveCall(unit_id, req.params.id);
  if (conflict) return res.status(409).json({ error: `Unit already on call #${conflict.call_number}` });

  if (!call.additional_unit_ids) call.additional_unit_ids = [];
  if (!call.additional_unit_ids.includes(unit_id) && call.assigned_unit_id !== unit_id) {
    call.additional_unit_ids.push(unit_id);
  }
  const unit = units.find(u => u.id === unit_id);
  if (unit) {
    // Start the additional unit at the current call status so they join the flow at the right point.
    // 'pending' has no unit equivalent → use 'dispatched'; closed should never reach here.
    const joinStatus = call.status === 'pending' ? 'dispatched' : call.status;
    unit.status = joinStatus;
    saveUnit(unit).catch(console.error);
    io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: joinStatus });
    io.to(`crew:${unit_id}`).emit('unit:status_change', { unit_id: unit.id, status: joinStatus });
    io.to(`crew:${unit_id}`).emit('call:assigned_to_me', call);
  }
  saveCall(call).catch(console.error);
  io.to('dispatchers').emit('call:updated', { call_id: call.id, changes: { additional_unit_ids: call.additional_unit_ids } });
  res.json(call);
});

app.delete('/api/calls/:id/units/:unit_id', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });
  call.additional_unit_ids = (call.additional_unit_ids || []).filter(id => id !== req.params.unit_id);
  const unit = units.find(u => u.id === req.params.unit_id);
  if (unit) {
    unit.status = 'available';
    saveUnit(unit).catch(console.error);
    io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: 'available' });
  }
  saveCall(call).catch(console.error);
  io.to('dispatchers').emit('call:updated', { call_id: call.id, changes: { additional_unit_ids: call.additional_unit_ids } });
  res.json(call);
});

app.patch('/api/calls/:id/status', verifyToken, async (req, res) => {
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });

  if (req.user.role === 'crew') {
    const allIds = [call.assigned_unit_id, ...(call.additional_unit_ids || [])];
    if (!allIds.includes(req.user.unit_id))
      return res.status(403).json({ error: 'Forbidden' });
    const CREW_ALLOWED = ['acknowledged','en_route','on_scene','patient_contact','transporting','cleared','available'];
    const closingWithDisposition = req.body.status === 'closed' && req.body.disposition;
    if (!CREW_ALLOWED.includes(req.body.status) && !closingWithDisposition)
      return res.status(403).json({ error: 'Forbidden' });
  }

  const TS_MAP = {
    acknowledged: 'acknowledged_at', en_route: 'en_route_at', on_scene: 'on_scene_at',
    patient_contact: 'patient_contact_at', transporting: 'transporting_at',
    cleared: 'cleared_at', available: 'available_at'
  };
  call.status = req.body.status;
  if (req.body.disposition) call.disposition = req.body.disposition;
  if (req.body.close_notes)  call.close_notes  = req.body.close_notes;
  if (TS_MAP[req.body.status] && !call[TS_MAP[req.body.status]]) {
    call[TS_MAP[req.body.status]] = new Date().toISOString();
  }
  if (req.body.status === 'closed') call.closed_at = new Date().toISOString();

  saveCall(call).catch(console.error);

  const tsField = TS_MAP[req.body.status];
  const payload = { call_id: call.id, status: call.status, ...(tsField && call[tsField] ? { [tsField]: call[tsField] } : {}) };
  io.to('dispatchers').emit('call:status_change', payload);
  io.to(`crew:${call.assigned_unit_id}`).emit('call:updated', { call_id: call.id, changes: { status: call.status } });

  const isClose = req.body.status === 'closed';
  const newUnitStatus = isClose ? 'available' : req.body.status;
  // On close: all units return to available.
  // Otherwise: primary + co_unit_ids (initial dispatch) follow the call status together.
  // Units added mid-call (in additional_unit_ids but not co_unit_ids) stay independent.
  const unitIdsToUpdate = isClose
    ? [call.assigned_unit_id, ...(call.additional_unit_ids || [])].filter(Boolean)
    : [call.assigned_unit_id, ...(call.co_unit_ids || [])].filter(Boolean);

  unitIdsToUpdate.forEach(uid => {
    const unit = units.find(u => u.id === uid);
    if (unit) {
      unit.status = newUnitStatus;
      saveUnit(unit).catch(console.error);
      io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: unit.status });
      io.to(`crew:${uid}`).emit('unit:status_change', { unit_id: uid, status: newUnitStatus });
    }
  });

  // Notify co-unit crew phones of the call status update (so their call card stays in sync)
  (call.co_unit_ids || []).forEach(uid => {
    io.to(`crew:${uid}`).emit('call:updated', { call_id: call.id, changes: { status: call.status } });
  });

  res.json(call);
});

app.post('/api/calls/:id/comments', verifyToken, async (req, res) => {
  if (req.user.role === 'overwatch') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });
  if (!req.body.text?.trim()) return res.status(400).json({ error: 'text required' });
  const author = req.user.role === 'crew' ? (req.user.unit_number || 'Crew') : 'Dispatcher';
  const comment = {
    id: `cmt-${Date.now()}`,
    text: req.body.text.trim(),
    author,
    created_at: new Date().toISOString()
  };
  call.comments.push(comment);
  saveCall(call).catch(console.error);
  io.to('dispatchers').emit('call:comment_added', { call_id: call.id, comment });
  if (call.assigned_unit_id) {
    io.to(`crew:${call.assigned_unit_id}`).emit('call:comment_added', { call_id: call.id, comment });
  }
  res.json(comment);
});

// ── Crew PIN auth ─────────────────────────────────────────────────
const crewPinOk = (pin) => String(pin) === (process.env.CREW_PIN || '1234');

// Step 1: validate PIN, then client shows unit picker
app.post('/api/crew/verify-pin', (req, res) => {
  if (!crewPinOk(req.body.pin)) return res.status(401).json({ error: 'Invalid PIN' });
  res.json({ ok: true });
});

// Step 2a: pick an existing shift unit → get JWT
app.post('/api/crew/select-unit', (req, res) => {
  const { pin, unit_id } = req.body;
  if (!crewPinOk(pin)) return res.status(401).json({ error: 'Invalid PIN' });
  const unit = units.find(u => u.id === unit_id);
  if (!unit) return res.status(404).json({ error: 'Unit not found' });
  const token = signToken({ unit_id: unit.id, unit_number: unit.unit_number, role: 'crew' });
  res.json({ token, user: { role: 'crew', unit_id: unit.id, unit_number: unit.unit_number, profile: unit.profile } });
});

// ── Shift ─────────────────────────────────────────────────────────

// Public: crew login picker fetches this before authenticating
app.get('/api/shift/units', (req, res) => {
  if (!currentShift || currentShift.ended_at) return res.json([]);
  res.json(units.map(u => ({
    id: u.id, unit_number: u.unit_number, unit_type: u.unit_type,
    crew: u.crew || null, station: u.station || null
  })));
});

// Step 2b: add a unit not in the shift roster → create it + get JWT
app.post('/api/crew/add-unit', async (req, res) => {
  const { unit_number, unit_type = 'ALS', pin } = req.body;
  if (!unit_number?.trim()) return res.status(400).json({ error: 'unit_number required' });
  if (!crewPinOk(pin)) return res.status(401).json({ error: 'Invalid PIN' });

  // Re-use existing unit if it was already created
  let unit = units.find(u => u.unit_number.toLowerCase() === unit_number.trim().toLowerCase());
  if (!unit) {
    unit = {
      id: `u-${Date.now()}`,
      unit_number: unit_number.trim(), unit_name: unit_number.trim(),
      unit_type, status: 'available',
      last_lat: null, last_lng: null, last_gps_at: null, tracki_device_id: null,
      password_hash: null,
      profile: null, crew: null, station: null
    };
    units.push(unit);
    await saveUnit(unit).catch(console.error);
    io.to('dispatchers').emit('unit:updated', { ...unit, password_hash: undefined });
  }

  const token = signToken({ unit_id: unit.id, unit_number: unit.unit_number, role: 'crew' });
  res.json({ token, user: { role: 'crew', unit_id: unit.id, unit_number: unit.unit_number, profile: unit.profile } });
});

app.get('/api/shift/current', verifyToken, (req, res) => {
  res.json(currentShift);
});

app.post('/api/shift/start', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  if (currentShift && !currentShift.ended_at)
    return res.status(409).json({ error: 'A shift is already active' });

  const { shift_label, unit_staffing = [] } = req.body;
  currentShift = {
    id:          `shift-${Date.now()}`,
    shift_label: shift_label || 'Day Shift',
    date:        new Date().toISOString().split('T')[0],
    started_at:  new Date().toISOString(),
    ended_at:    null,
    started_by:  req.user.username,
    unit_staffing
  };

  unit_staffing.forEach(({ unit_id, crew, unit_type, in_service, station }) => {
    const unit = units.find(u => u.id === unit_id);
    if (!unit) return;
    unit.crew    = crew    || null;
    unit.station = station || null;
    if (unit_type) unit.unit_type = unit_type;
    unit.status = in_service ? 'available' : 'out_of_service';
    saveUnit(unit).catch(console.error);
  });

  await saveShift(currentShift).catch(console.error);

  const sanitizedUnits = units.map(u => ({ ...u, password_hash: undefined }));
  io.to('dispatchers').emit('shift:started', { shift: currentShift, units: sanitizedUnits });
  res.json({ shift: currentShift, units: sanitizedUnits });
});

app.post('/api/shift/end', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  if (!currentShift || currentShift.ended_at)
    return res.status(404).json({ error: 'No active shift' });

  currentShift.ended_at = new Date().toISOString();
  await saveShift(currentShift).catch(console.error);

  const shiftStart  = new Date(currentShift.started_at);
  const shiftCalls  = calls.filter(c => new Date(c.received_at) >= shiftStart);
  const durationMin = Math.round((Date.now() - shiftStart) / 60000);

  const byPriority    = { 1: 0, 2: 0, 3: 0 };
  const byUnit        = {};
  const byDisposition = {};
  const byType        = {};
  let totalResponse = 0, responseCount = 0;
  let totalScene    = 0, sceneCount    = 0;

  shiftCalls.forEach(c => {
    byPriority[c.priority] = (byPriority[c.priority] || 0) + 1;
    const uNum = units.find(u => u.id === c.assigned_unit_id)?.unit_number || 'Unassigned';
    byUnit[uNum] = (byUnit[uNum] || 0) + 1;
    if (c.disposition) byDisposition[c.disposition] = (byDisposition[c.disposition] || 0) + 1;
    if (c.call_type)   byType[c.call_type]           = (byType[c.call_type]   || 0) + 1;
    if (c.dispatched_at && c.on_scene_at) {
      totalResponse += (new Date(c.on_scene_at) - new Date(c.dispatched_at)) / 60000;
      responseCount++;
    }
    if (c.on_scene_at && c.cleared_at) {
      totalScene += (new Date(c.cleared_at) - new Date(c.on_scene_at)) / 60000;
      sceneCount++;
    }
  });

  const summary = {
    ...currentShift,
    duration_minutes:     durationMin,
    total_calls:          shiftCalls.length,
    by_priority:          byPriority,
    by_unit:              byUnit,
    by_disposition:       byDisposition,
    by_type:              byType,
    avg_response_minutes: responseCount > 0 ? Math.round(totalResponse / responseCount * 10) / 10 : null,
    avg_scene_minutes:    sceneCount    > 0 ? Math.round(totalScene    / sceneCount    * 10) / 10 : null,
    calls:                shiftCalls
  };

  // Clear calls (shift-scoped) but keep unit records — deleting/recreating them
  // every shift broke crew login sessions, GPS tracker assignments, and any
  // custom unit passwords. Just take everyone off-service for the next shift setup.
  calls = [];
  units.forEach(u => {
    u.status = 'out_of_service';
    saveUnit(u).catch(console.error);
  });

  currentShift = null;
  const sanitizedUnits = units.map(u => ({ ...u, password_hash: undefined }));
  io.to('dispatchers').emit('shift:ended', { ...summary, units: sanitizedUnits });
  units.forEach(u => io.to(`crew:${u.id}`).emit('shift:ended', { units: sanitizedUnits }));
  res.json(summary);
});

app.patch('/api/shift/units/:unit_id', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const unit = units.find(u => u.id === req.params.unit_id);
  if (!unit) return res.status(404).json({ error: 'Not found' });
  const { crew, unit_type, in_service, station } = req.body;
  if (crew       !== undefined) unit.crew      = crew;
  if (unit_type  !== undefined) unit.unit_type = unit_type;
  if (station    !== undefined) unit.station   = station;
  if (in_service !== undefined) unit.status    = in_service ? 'available' : 'out_of_service';
  if (currentShift) {
    const s = currentShift.unit_staffing.find(s => s.unit_id === req.params.unit_id);
    if (s) { Object.assign(s, { crew, unit_type, in_service, station }); }
    saveShift(currentShift).catch(console.error);
  }
  saveUnit(unit).catch(console.error);
  const sanitized = { ...unit, password_hash: undefined };
  io.to('dispatchers').emit('unit:updated', sanitized);
  res.json(sanitized);
});

app.get('/api/shifts', verifyToken, async (req, res) => {
  if (!['dispatcher', 'overwatch'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const result = await pool.query(
      `SELECT id, shift_label, date, started_at, ended_at, started_by
       FROM shifts WHERE ended_at IS NOT NULL ORDER BY started_at DESC LIMIT 90`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[shifts] query error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// Returns the first active (non-closed) call a unit is on, optionally ignoring one call ID.
function getUnitActiveCall(unitId, excludeCallId = null) {
  return calls.find(c =>
    c.id !== excludeCallId &&
    c.status !== 'closed' &&
    (c.assigned_unit_id === unitId || (c.additional_unit_ids || []).includes(unitId))
  ) || null;
}

// ── GPS helpers ───────────────────────────────────────────────────
function applyGpsUpdate(unit, lat, lng, timestamp) {
  unit.last_lat    = lat;
  unit.last_lng    = lng;
  unit.last_gps_at = timestamp;
  saveUnit(unit).catch(console.error);
  io.to('dispatchers').emit('unit:gps_update', {
    unit_id: unit.id, unit_number: unit.unit_number, lat, lng, timestamp
  });
}

function handleUnknownDevice(device_id) {
  const key = String(device_id);
  if (!unknownGpsDevices.has(key)) {
    unknownGpsDevices.add(key);
    io.to('dispatchers').emit('gps:unknown_device', { device_id: key });
  }
}

// ── GPS webhook (Tracki / generic hardware tracker) ───────────────
// Configure your tracker to POST to: https://<your-domain>/api/gps/webhook?secret=GPS_WEBHOOK_SECRET
// Set the unit's GPS Device ID to match the tracker's IMEI or device ID.
app.post('/api/gps/webhook', (req, res) => {
  const secret = process.env.GPS_WEBHOOK_SECRET;
  if (secret && req.query.secret !== secret)
    return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body;
  console.log('[gps] incoming ping:', JSON.stringify(body));

  const device_id = body.imei ?? body.device_id ?? body.serial_number ?? body.serial ?? body.tid ?? body.id ?? null;
  const lat       = parseFloat(body.lat ?? body.latitude  ?? 0);
  const lng       = parseFloat(body.lng ?? body.longitude ?? body.lon ?? 0);
  const timestamp = body.timestamp ?? body.gps_time ?? new Date().toISOString();

  const tracker = trackers.find(t => t.device_id && String(t.device_id) === String(device_id));
  const unit    = tracker ? units.find(u => u.tracker_name === tracker.name) : null;
  if (unit && lat && lng) {
    applyGpsUpdate(unit, lat, lng, timestamp);
    console.log(`[gps] updated ${unit.unit_number} via ${tracker.name} → ${lat}, ${lng}`);
  } else if (!tracker && device_id !== null) {
    console.log(`[gps] unknown device_id: ${device_id} — configure in Settings → GPS Trackers`);
    handleUnknownDevice(device_id);
  }

  res.json({ ok: true });
});

// ── Crew browser GPS (fallback when Tracki is stale) ─────────────
app.post('/api/crew/gps', verifyToken, (req, res) => {
  if (req.user.role !== 'crew') return res.status(403).json({ error: 'Forbidden' });
  const unit = units.find(u => u.id === req.user.unit_id);
  if (!unit) return res.status(404).json({ error: 'Not found' });
  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  applyGpsUpdate(unit, lat, lng, new Date().toISOString());
  res.json({ ok: true });
});

// ── Locations ─────────────────────────────────────────────────────
app.get('/api/locations', verifyToken, (req, res) => {
  res.json(locations);
});

app.post('/api/locations', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const { name, lat, lng, color = '#6366f1', location_type = 'permanent' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const loc = { id: `loc-${Date.now()}`, name: name.trim(), lat, lng, color, location_type };
  locations.push(loc);
  if (location_type === 'permanent') await saveLocation(loc).catch(console.error);
  res.status(201).json(loc);
});

app.delete('/api/locations/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const idx = locations.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  locations.splice(idx, 1);
  deleteLocationFromDb(req.params.id).catch(console.error);
  res.json({ ok: true });
});

// ── Trackers ──────────────────────────────────────────────────────
app.get('/api/trackers', verifyToken, (req, res) => {
  if (!['dispatcher', 'overwatch'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  res.json(trackers);
});

app.post('/api/trackers', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const { name, device_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const t = { id: `tracker-${Date.now()}`, name: name.trim(), device_id: device_id?.trim() || null };
  trackers.push(t);
  await saveTracker(t).catch(console.error);
  res.status(201).json(t);
});

app.put('/api/trackers/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const t = trackers.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const oldName = t.name;
  if (req.body.name !== undefined)  t.name      = req.body.name.trim();
  if ('device_id' in req.body)      t.device_id = req.body.device_id?.trim() || null;
  await saveTracker(t).catch(console.error);
  // Keep units in sync when tracker is renamed
  if (t.name !== oldName) {
    units.forEach(u => {
      if (u.tracker_name === oldName) {
        u.tracker_name = t.name;
        saveUnit(u).catch(console.error);
        io.to('dispatchers').emit('unit:updated', { ...u, password_hash: undefined });
      }
    });
  }
  res.json(t);
});

app.delete('/api/trackers/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const idx = trackers.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const deletedName = trackers[idx].name;
  trackers.splice(idx, 1);
  deleteTrackerFromDb(req.params.id).catch(console.error);
  // Clear tracker reference from any units that used this tracker
  units.forEach(u => {
    if (u.tracker_name === deletedName) {
      u.tracker_name = null;
      saveUnit(u).catch(console.error);
      io.to('dispatchers').emit('unit:updated', { ...u, password_hash: undefined });
    }
  });
  res.json({ ok: true });
});

app.patch('/api/calls/:id/location', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });
  const { location_name, park_zone, location_lat, location_lng } = req.body;
  const changes = {};
  if (location_name !== undefined) { call.location_name = location_name; changes.location_name = location_name; }
  if (park_zone     !== undefined) { call.park_zone     = park_zone;     changes.park_zone     = park_zone;     }
  if (location_lat  !== undefined) { call.location_lat  = location_lat;  changes.location_lat  = location_lat;  }
  if (location_lng  !== undefined) { call.location_lng  = location_lng;  changes.location_lng  = location_lng;  }
  saveCall(call).catch(console.error);
  io.to('dispatchers').emit('call:updated', { call_id: call.id, changes });
  if (call.assigned_unit_id) io.to(`crew:${call.assigned_unit_id}`).emit('call:updated', { call_id: call.id, changes });
  res.json({ ok: true });
});

app.patch('/api/calls/:id/priority', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });
  const priority = Number(req.body.priority);
  if (![1, 2, 3].includes(priority)) return res.status(400).json({ error: 'Priority must be 1, 2, or 3' });
  call.priority = priority;
  saveCall(call).catch(console.error);
  io.to('dispatchers').emit('call:updated', { call_id: call.id, changes: { priority } });
  if (call.assigned_unit_id) io.to(`crew:${call.assigned_unit_id}`).emit('call:updated', { call_id: call.id, changes: { priority } });
  res.json({ ok: true });
});

app.post('/api/calls/:id/mutual-aid', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });
  const { name, unit_id, role } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const entry = { id: `ma-${Date.now()}`, name: name.trim(), unit_id: unit_id?.trim() || null, role: role?.trim() || null, arrived_at: new Date().toISOString() };
  if (!call.mutual_aid_agencies) call.mutual_aid_agencies = [];
  call.mutual_aid_agencies.push(entry);
  saveCall(call).catch(console.error);
  io.to('dispatchers').emit('call:updated', { call_id: call.id, changes: { mutual_aid_agencies: call.mutual_aid_agencies } });
  if (call.assigned_unit_id) io.to(`crew:${call.assigned_unit_id}`).emit('call:updated', { call_id: call.id, changes: { mutual_aid_agencies: call.mutual_aid_agencies } });
  res.json(entry);
});

app.delete('/api/calls/:id/mutual-aid/:entryId', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });
  call.mutual_aid_agencies = (call.mutual_aid_agencies || []).filter(e => e.id !== req.params.entryId);
  saveCall(call).catch(console.error);
  io.to('dispatchers').emit('call:updated', { call_id: call.id, changes: { mutual_aid_agencies: call.mutual_aid_agencies } });
  if (call.assigned_unit_id) io.to(`crew:${call.assigned_unit_id}`).emit('call:updated', { call_id: call.id, changes: { mutual_aid_agencies: call.mutual_aid_agencies } });
  res.json({ ok: true });
});

// ── Call timestamps & narrative ───────────────────────────────────
app.patch('/api/calls/:id/timestamps', verifyToken, async (req, res) => {
  if (req.user.role === 'overwatch') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });

  if (req.user.role === 'crew') {
    const allIds = [call.assigned_unit_id, ...(call.additional_unit_ids || [])];
    if (!allIds.includes(req.user.unit_id))
      return res.status(403).json({ error: 'Forbidden' });
  }
  const ALLOWED = ['received_at','dispatched_at','acknowledged_at','en_route_at',
                   'on_scene_at','patient_contact_at','arrived_first_aid_at','transporting_at',
                   'cleared_at','available_at','closed_at'];
  const changes = {};
  Object.entries(req.body).forEach(([k, v]) => {
    if (ALLOWED.includes(k)) { call[k] = v; changes[k] = v; }
  });
  saveCall(call).catch(console.error);
  if (Object.keys(changes).length) {
    io.to('dispatchers').emit('call:updated', { call_id: call.id, changes });
    if (call.assigned_unit_id)
      io.to(`crew:${call.assigned_unit_id}`).emit('call:updated', { call_id: call.id, changes });
  }
  res.json({ ok: true });
});

app.patch('/api/calls/:id/narrative', verifyToken, async (req, res) => {
  if (req.user.role === 'overwatch') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });

  if (req.user.role === 'crew') {
    const allIds = [call.assigned_unit_id, ...(call.additional_unit_ids || [])];
    if (!allIds.includes(req.user.unit_id))
      return res.status(403).json({ error: 'Forbidden' });
  }
  call.narrative = req.body.narrative ?? null;
  saveCall(call).catch(console.error);
  if (call.assigned_unit_id) io.to(`crew:${call.assigned_unit_id}`).emit('call:updated', { call_id: call.id, changes: { narrative: call.narrative } });
  res.json({ ok: true });
});

// ── Token refresh ─────────────────────────────────────────────────
app.post('/api/auth/refresh', verifyToken, (req, res) => {
  const { iat, exp, ...payload } = req.user;
  const token = signToken(payload);
  res.json({ token });
});

// ── Display board auth ────────────────────────────────────────────
app.post('/api/display/auth', (req, res) => {
  const correct = process.env.DISPLAY_PIN || '4567';
  if (String(req.body.pin) !== correct) return res.status(401).json({ error: 'Invalid PIN' });
  const token = signToken({ role: 'display' });
  res.json({ token });
});

// ── Trackimo GPS polling ──────────────────────────────────────────
// plus.trackimo.com v4 API — Bearer token auth, stored in DB
const TRACKIMO_APP  = 'https://app.trackimo.com';
const TRACKIMO_PLUS = 'https://plus.trackimo.com';
let trackimoBearer        = null;
let trackimoAccountId     = null;
let trackimoSessionCookie = null;   // fallback: use session cookie if bearer unavailable

async function saveTrackimoToken(key, value) {
  await pool.query(`
    INSERT INTO trackimo_tokens (key, value, updated_at) VALUES ($1,$2,$3)
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at
  `, [key, value, new Date().toISOString()]);
}

async function loadTrackimoTokens() {
  const res = await pool.query('SELECT key, value FROM trackimo_tokens');
  const map = {};
  res.rows.forEach(r => { map[r.key] = r.value; });
  return map;
}

// Try refresh token → new access token; returns true on success
async function tryRefreshToken() {
  const stored = await loadTrackimoTokens().catch(() => ({}));
  const refreshToken = stored.refresh_token;
  if (!refreshToken || !process.env.TRACKIMO_CLIENT_ID) return false;
  for (const base of [TRACKIMO_PLUS, TRACKIMO_APP]) {
    for (const ver of ['v4', 'v3']) {
      try {
        const res  = await fetch(`${base}/api/${ver}/oauth2/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id:     process.env.TRACKIMO_CLIENT_ID,
            client_secret: process.env.TRACKIMO_CLIENT_SECRET,
            grant_type:    'refresh_token',
            refresh_token: refreshToken
          })
        });
        const data = await res.json().catch(() => ({}));
        if (data.access_token) {
          trackimoBearer = data.access_token;
          await saveTrackimoToken('access_token', data.access_token);
          if (data.refresh_token) await saveTrackimoToken('refresh_token', data.refresh_token);
          console.log('[tracki] token refreshed via refresh_token');
          return true;
        }
      } catch {}
    }
  }
  return false;
}

// Full server-side OAuth2 flow using Trackimo's internal client
// (discovered by inspecting plus.trackimo.com network traffic — overridable via env vars)
const TRACKI_INTERNAL_CLIENT   = process.env.TRACKI_INTERNAL_CLIENT   || '9092cd94-a728-47b7-86da-e15c9a3d4cdb';
const TRACKI_INTERNAL_REDIRECT = `${TRACKIMO_PLUS}/api/internal/v1/oauth_redirect`;

// From official Trackimo API sample (trackimo_api_short.py) — overridable via env var
const TRACKI_CLIENT_SECRET = process.env.TRACKI_CLIENT_SECRET || '9f540cd42ec8d3bc452ce39cdd3d6de4';

async function trackimoAutoLogin() {
  const { TRACKIMO_USERNAME, TRACKIMO_PASSWORD } = process.env;
  if (!TRACKIMO_USERNAME || !TRACKIMO_PASSWORD) return false;

  // Step 1: Login → JSESSIONID + AWSALB cookies
  const loginRes = await fetch(`${TRACKIMO_PLUS}/api/internal/v2/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TRACKIMO_USERNAME, password: TRACKIMO_PASSWORD })
  });
  const rawCookies = (loginRes.headers.getSetCookie?.() || [loginRes.headers.get('set-cookie') || ''])
    .filter(Boolean).map(c => c.split(';')[0]);
  await loginRes.text().catch(() => '');
  if (!loginRes.ok || rawCookies.length === 0) {
    console.error(`[tracki] login failed (${loginRes.status})`); return false;
  }
  const sessionCookie = rawCookies.join('; ');
  console.log(`[tracki] login OK — ${rawCookies.map(c => c.split('=')[0]).join(', ')}`);

  // Step 2: Get OAuth2 auth code
  const authParams = new URLSearchParams({
    client_id:     TRACKI_INTERNAL_CLIENT,
    redirect_uri:  TRACKI_INTERNAL_REDIRECT,
    response_type: 'code',
    scope:         'locations,notifications,devices,accounts,settings,geozones'
  });
  const authRes = await fetch(`${TRACKIMO_PLUS}/api/v3/oauth2/auth?${authParams}`, {
    redirect: 'manual',
    headers: { Cookie: sessionCookie }
  });
  const locationHdr = authRes.headers.get('location') || '';
  const authCode = locationHdr ? new URL(locationHdr, TRACKIMO_PLUS).searchParams.get('code') : null;
  console.log(`[tracki] oauth2/auth (${authRes.status}) code=${authCode ? 'ok' : 'missing'}`);
  if (!authCode) { console.error(`[tracki] no auth code`); return false; }

  // Step 3: Exchange auth code for token (official Python sample format)
  const tokRes = await fetch(`${TRACKIMO_PLUS}/api/v3/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({
      client_id:     TRACKI_INTERNAL_CLIENT,
      client_secret: TRACKI_CLIENT_SECRET,
      code:          authCode
    })
  });
  const tokBody = await tokRes.text().catch(() => '');
  console.log(`[tracki] token exchange (${tokRes.status}): ${tokBody.slice(0, 300)}`);
  let tokData = {};
  try { tokData = JSON.parse(tokBody); } catch {}
  const rawToken = tokData.access_token ?? tokData.token ?? tokData.bearer ?? null;
  if (!rawToken) { console.error('[tracki] token not found in exchange response'); return false; }

  trackimoBearer = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;
  await saveTrackimoToken('access_token', trackimoBearer).catch(console.error);
  console.log('[tracki] token acquired successfully');
  return true;
}

async function trackimoStartup() {
  trackimoAccountId = process.env.TRACKIMO_ACCOUNT_ID || null;
  if (!trackimoAccountId) { console.log('[tracki] set TRACKIMO_ACCOUNT_ID env var'); return; }

  // 1. Manual env var override
  if (process.env.TRACKIMO_BEARER_TOKEN) {
    trackimoBearer = process.env.TRACKIMO_BEARER_TOKEN;
    console.log(`[tracki] using env Bearer token — account_id=${trackimoAccountId}`);
    return;
  }

  // 2. Load persisted token/session from DB
  const stored = await loadTrackimoTokens().catch(() => ({}));
  if (stored.access_token) {
    trackimoBearer = stored.access_token;
    console.log(`[tracki] loaded bearer token from DB — account_id=${trackimoAccountId}`);
    return;
  }
  if (stored.session_cookie) {
    trackimoSessionCookie = stored.session_cookie;
    console.log(`[tracki] loaded session cookie from DB — account_id=${trackimoAccountId}`);
    return;
  }

  // 3. Auto-login with username/password → OAuth2 flow
  await trackimoAutoLogin();
}

async function pollTrackimoLocations() {
  const assignedTrackers = trackers.filter(t => t.device_id && units.some(u => u.tracker_name === t.name));
  if (assignedTrackers.length === 0 || (!trackimoBearer && !trackimoSessionCookie) || !trackimoAccountId) return;

  const deviceIds = assignedTrackers.map(t => t.device_id);
  try {
    const params = new URLSearchParams({
      comm_stat: '1',
      device_ids: deviceIds.join(','),
      fetch_is_fast_tracking_enabled: 'true'
    });
    const pollHeaders = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (trackimoBearer)        pollHeaders['Authorization'] = `Bearer ${trackimoBearer}`;
    if (trackimoSessionCookie) pollHeaders['Cookie']        = trackimoSessionCookie;

    const res = await fetch(
      `${TRACKIMO_PLUS}/api/v4/accounts/${trackimoAccountId}/locations/filter?${params}`,
      { headers: pollHeaders }
    );

    if (res.status === 401 || res.status === 403) {
      if (process.env.TRACKIMO_BEARER_TOKEN) {
        console.error('[tracki] manual Bearer token rejected — update TRACKIMO_BEARER_TOKEN in Railway');
        return;
      }
      console.log(`[tracki] auth expired (${res.status}) — re-authenticating`);
      trackimoBearer = null;
      trackimoSessionCookie = null;
      await pool.query("DELETE FROM trackimo_tokens WHERE key IN ('access_token','session_cookie')").catch(() => {});
      const ok = await trackimoAutoLogin();
      if (ok) return pollTrackimoLocations();
      console.error('[tracki] re-auth failed — will retry next poll cycle');
      return;
    }

    const payload = await res.json();
    console.log(`[tracki] poll (${res.status}): ${JSON.stringify(payload).slice(0, 400)}`);
    const results = Array.isArray(payload) ? payload : (payload.locations || payload.data || []);

    for (const loc of results) {
      const deviceId = String(loc.device_id ?? loc.id ?? loc.tracki_id ?? '');
      const lat      = parseFloat(loc.lat ?? loc.latitude  ?? 0);
      const lng      = parseFloat(loc.lng ?? loc.longitude ?? loc.lon ?? 0);
      // loc.time is Unix seconds — convert to ISO string so the client doesn't treat it as ms (Jan 1970)
      const rawTs = loc.timestamp ?? loc.time ?? null;
      const ts    = rawTs
        ? (typeof rawTs === 'number' ? new Date(rawTs * 1000).toISOString() : rawTs)
        : new Date().toISOString();
      if (!lat || !lng) continue;

      const trk  = trackers.find(t => t.device_id && String(t.device_id) === deviceId);
      const unit = trk ? units.find(u => u.tracker_name === trk.name) : null;
      if (unit) {
        applyGpsUpdate(unit, lat, lng, ts);
        console.log(`[tracki] ${unit.unit_number} via ${trk.name} → ${lat}, ${lng}`);
      } else {
        handleUnknownDevice(deviceId);
      }
    }
  } catch (err) {
    console.error('[tracki] poll error:', err.message);
  }
}

async function startTrackimoPolling() {
  if (!process.env.TRACKIMO_ACCOUNT_ID && !process.env.TRACKIMO_BEARER_TOKEN && !process.env.TRACKIMO_USERNAME) return;
  await trackimoStartup();
  setInterval(pollTrackimoLocations, 15000);
  await pollTrackimoLocations();
  console.log('[tracki] polling started — 15 s interval');
}

// ── Trackimo OAuth2 setup endpoints ──────────────────────────────
// Dispatcher visits /api/tracki/auth once to connect GPS permanently.
const TRACKI_REDIRECT = process.env.TRACKIMO_REDIRECT_URI || 'https://ems-cad-production.up.railway.app/api/tracki/callback';

app.get('/api/tracki/auth', verifyToken, (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const clientId = process.env.TRACKIMO_CLIENT_ID;
  if (!clientId) return res.status(400).send('Set TRACKIMO_CLIENT_ID env var first');
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: TRACKI_REDIRECT,
    response_type: 'code', scope: 'locations,devices'
  });
  // Try plus first (v4), fall back to app (v3)
  res.redirect(`${TRACKIMO_PLUS}/api/v4/oauth2/auth?${params}`);
});

app.get('/api/tracki/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Trackimo auth error: ${error}`);
  if (!code)  return res.status(400).send('No auth code — authorization may have failed');

  const clientId     = process.env.TRACKIMO_CLIENT_ID;
  const clientSecret = process.env.TRACKIMO_CLIENT_SECRET;
  let success = false;

  for (const base of [TRACKIMO_PLUS, TRACKIMO_APP]) {
    for (const ver of ['v4', 'v3']) {
      try {
        const tokRes  = await fetch(`${base}/api/${ver}/oauth2/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: TRACKI_REDIRECT })
        });
        const tokData = await tokRes.json().catch(() => ({}));
        console.log(`[tracki] callback token exchange ${base}/api/${ver} (${tokRes.status}): ${JSON.stringify(tokData).slice(0, 200)}`);
        if (tokData.access_token) {
          trackimoBearer = tokData.access_token;
          await saveTrackimoToken('access_token', tokData.access_token);
          if (tokData.refresh_token) await saveTrackimoToken('refresh_token', tokData.refresh_token);
          const aid = tokData.account_id ?? tokData.accountId ?? trackimoAccountId ?? process.env.TRACKIMO_ACCOUNT_ID;
          if (aid) { trackimoAccountId = String(aid); await saveTrackimoToken('account_id', trackimoAccountId); }
          console.log('[tracki] OAuth2 authorized — GPS polling active');
          success = true;
          break;
        }
      } catch (err) { console.error(`[tracki] callback error ${base}:`, err.message); }
    }
    if (success) break;
  }

  if (success) {
    return res.send(`<html><body style="background:#111;color:#fff;font-family:sans-serif;padding:40px;text-align:center">
      <h2>✅ GPS Connected!</h2><p>Trackimo is now linked. GPS will update every 15 seconds.</p>
      <p>You can close this tab.</p></body></html>`);
  }
  res.status(500).send('Token exchange failed — the OAuth2 endpoint may need adjustment. Check Railway logs.');
});

// ── GPS / Trackimo diagnostics ────────────────────────────────────
app.get('/api/tracki/status', verifyToken, (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const trackedUnits = units
    .filter(u => u.tracker_name)
    .map(u => {
      const t = trackers.find(t => t.name === u.tracker_name);
      return {
        unit_number:  u.unit_number,
        tracker_name: u.tracker_name,
        device_id:    t?.device_id || null,
        last_lat:     u.last_lat,
        last_lng:     u.last_lng,
        last_gps_at:  u.last_gps_at
      };
    });
  res.json({
    polling_active:     !!(trackimoBearer || trackimoSessionCookie),
    has_bearer:         !!trackimoBearer,
    has_session_cookie: !!trackimoSessionCookie,
    account_id:         trackimoAccountId,
    env: {
      TRACKIMO_ACCOUNT_ID:    !!process.env.TRACKIMO_ACCOUNT_ID,
      TRACKIMO_BEARER_TOKEN:  !!process.env.TRACKIMO_BEARER_TOKEN,
      TRACKIMO_USERNAME:      !!process.env.TRACKIMO_USERNAME,
      GPS_WEBHOOK_SECRET:     !!process.env.GPS_WEBHOOK_SECRET
    },
    trackers,
    tracked_units: trackedUnits
  });
});

// Manual poll trigger for testing
app.post('/api/tracki/poll', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  await pollTrackimoLocations();
  res.json({ ok: true, message: 'Poll triggered — check Railway logs' });
});

// ── Health ────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Socket.io ─────────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token) {
    try { socket.jwtUser = jwt.verify(token, JWT_SECRET); } catch {}
  }
  next();
});

io.on('connection', (socket) => {
  const who = socket.jwtUser;
  console.log('[socket] connect', socket.id, who?.role, who?.unit_number || who?.username);

  socket.on('join:dispatcher', () => {
    const role = socket.jwtUser?.role;
    if (role !== 'dispatcher' && role !== 'display' && role !== 'overwatch') {
      socket.emit('error:auth', { message: 'Unauthorized' });
      return;
    }
    socket.join('dispatchers');
    socket.emit('init:state', {
      units: units.map(u => ({ ...u, password_hash: undefined })),
      calls,
      locations,
      trackers
    });
  });

  // Only join the room for the unit your own JWT was issued for —
  // otherwise anyone could pass an arbitrary unit_id and read another crew's call/PHI traffic.
  socket.on('join:crew', ({ unit_id }) => {
    if (socket.jwtUser?.role !== 'crew' || socket.jwtUser.unit_id !== unit_id) {
      socket.emit('error:auth', { message: 'Unauthorized' });
      return;
    }
    socket.join(`crew:${unit_id}`);
    const myCall = calls.find(c => c.assigned_unit_id === unit_id && c.status !== 'closed');
    if (myCall) socket.emit('call:assigned_to_me', myCall);
  });

  socket.on('disconnect', () => {
    console.log('[socket] disconnect', socket.id);
  });
});

// ── Serve React build (production) ────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '../../client/dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT || 3001;

initDb()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚑 EMS CAD Server running on port ${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/api/health`);
      console.log(`   Default login — dispatchers: "dispatch" / "ems2024"`);
      console.log(`   Default login — crews: "EMS-1" through "EMS-5" / "ems2024"\n`);
    });
    startTrackimoPolling();
  })
  .catch(err => {
    console.error('[db] Failed to connect to database:', err.message);
    process.exit(1);
  });
