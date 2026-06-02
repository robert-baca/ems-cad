const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const http       = require('http');
const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const { Pool }   = require('pg');
require('dotenv').config();

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'PUT'] }
});

app.use(cors({ origin: '*' }));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

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

let units        = [];
let calls        = [];
let locations    = [];
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
  await pool.query(`ALTER TABLE locations ADD COLUMN IF NOT EXISTS location_type TEXT DEFAULT 'permanent'`);
  await pool.query(`ALTER TABLE units ADD COLUMN IF NOT EXISTS tracki_device_id TEXT`);
  // Migrate data from old tracki_device_id column if it still exists
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='units' AND column_name='tracki_device_id') THEN
        UPDATE units SET tracki_device_id = tracki_device_id WHERE tracki_device_id IS NULL AND tracki_device_id IS NOT NULL;
      END IF;
    END $$
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

  const unitsRes = await pool.query('SELECT * FROM units ORDER BY unit_number');
  units = unitsRes.rows;

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const callsRes = await pool.query(
    'SELECT * FROM calls WHERE received_at > $1 ORDER BY received_at DESC',
    [cutoff]
  );
  calls = callsRes.rows.map(r => ({
    ...r,
    comments:             r.comments             || [],
    additional_unit_ids:  r.additional_unit_ids  || [],
    mutual_aid_agencies:  r.mutual_aid_agencies  || []
  }));
  nextCallNum = calls.length > 0 ? Math.max(...calls.map(c => c.call_number)) + 1 : 100;

  const shiftRes = await pool.query("SELECT * FROM shifts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1");
  currentShift = shiftRes.rows[0] || null;
  if (currentShift) currentShift.unit_staffing = currentShift.unit_staffing || [];

  const locsRes = await pool.query("SELECT * FROM locations ORDER BY name");
  locations = locsRes.rows;

  console.log(`[db] loaded ${units.length} units, ${calls.length} calls, ${locations.length} locations, shift: ${currentShift?.shift_label || 'none'}`);
}

async function saveUnit(unit) {
  await pool.query(`
    INSERT INTO units (id, unit_number, unit_name, unit_type, status, crew, station,
      tracki_device_id, last_lat, last_lng, last_gps_at, password_hash, profile)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (id) DO UPDATE SET
      unit_number=EXCLUDED.unit_number, unit_name=EXCLUDED.unit_name, unit_type=EXCLUDED.unit_type,
      status=EXCLUDED.status, crew=EXCLUDED.crew, station=EXCLUDED.station,
      tracki_device_id=EXCLUDED.tracki_device_id, last_lat=EXCLUDED.last_lat, last_lng=EXCLUDED.last_lng,
      last_gps_at=EXCLUDED.last_gps_at, password_hash=EXCLUDED.password_hash, profile=EXCLUDED.profile
  `, [unit.id, unit.unit_number, unit.unit_name, unit.unit_type, unit.status,
      unit.crew, unit.station, unit.tracki_device_id, unit.last_lat, unit.last_lng,
      unit.last_gps_at, unit.password_hash, unit.profile ? JSON.stringify(unit.profile) : null]);
}

async function deleteUnitFromDb(id) {
  await pool.query('DELETE FROM units WHERE id=$1', [id]);
}

async function saveCall(call) {
  await pool.query(`
    INSERT INTO calls (id, call_number, status, call_type, priority, location_name,
      location_lat, location_lng, assigned_unit_id, received_at, dispatched_at, acknowledged_at,
      en_route_at, on_scene_at, patient_contact_at, arrived_first_aid_at, transporting_at,
      cleared_at, available_at, closed_at,
      disposition, close_notes, comments, narrative, additional_unit_ids, response_mode,
      parent_call_id, mutual_aid_agencies)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
    ON CONFLICT (id) DO UPDATE SET
      status=EXCLUDED.status, call_type=EXCLUDED.call_type, priority=EXCLUDED.priority,
      location_name=EXCLUDED.location_name, location_lat=EXCLUDED.location_lat,
      location_lng=EXCLUDED.location_lng, assigned_unit_id=EXCLUDED.assigned_unit_id,
      dispatched_at=EXCLUDED.dispatched_at, acknowledged_at=EXCLUDED.acknowledged_at,
      en_route_at=EXCLUDED.en_route_at, on_scene_at=EXCLUDED.on_scene_at,
      patient_contact_at=EXCLUDED.patient_contact_at,
      arrived_first_aid_at=EXCLUDED.arrived_first_aid_at, transporting_at=EXCLUDED.transporting_at,
      cleared_at=EXCLUDED.cleared_at, available_at=EXCLUDED.available_at, closed_at=EXCLUDED.closed_at,
      disposition=EXCLUDED.disposition, close_notes=EXCLUDED.close_notes,
      comments=EXCLUDED.comments, narrative=EXCLUDED.narrative,
      additional_unit_ids=EXCLUDED.additional_unit_ids, response_mode=EXCLUDED.response_mode,
      parent_call_id=EXCLUDED.parent_call_id, mutual_aid_agencies=EXCLUDED.mutual_aid_agencies
  `, [call.id, call.call_number, call.status, call.call_type, call.priority,
      call.location_name, call.location_lat, call.location_lng, call.assigned_unit_id,
      call.received_at, call.dispatched_at, call.acknowledged_at, call.en_route_at,
      call.on_scene_at, call.patient_contact_at, call.arrived_first_aid_at || null,
      call.transporting_at || null, call.cleared_at, call.available_at,
      call.closed_at, call.disposition, call.close_notes, JSON.stringify(call.comments || []),
      call.narrative || null, JSON.stringify(call.additional_unit_ids || []),
      call.response_mode || null, call.parent_call_id || null,
      JSON.stringify(call.mutual_aid_agencies || [])]);
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
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
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
    if (!d || !bcrypt.compareSync(password, d.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });
    const token = signToken({ dispatcher_id: d.id, username: d.username, role: 'dispatcher' });
    return res.json({ token, user: { role: 'dispatcher', username: d.username, name: d.full_name } });
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
  const { unit_number, unit_name, unit_type = 'ALS', tracki_device_id } = req.body;
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
    tracki_device_id: tracki_device_id || null,
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

  const { unit_number, unit_name, unit_type, password, tracki_device_id } = req.body;
  if (unit_number !== undefined)     unit.unit_number      = unit_number;
  if (unit_name   !== undefined)     unit.unit_name        = unit_name;
  if (unit_type   !== undefined)     unit.unit_type        = unit_type;
  if ('tracki_device_id' in req.body) unit.tracki_device_id  = tracki_device_id;
  if (password)                      unit.password_hash    = bcrypt.hashSync(password, 8);

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

app.post('/api/calls', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const hasUnit        = !!req.body.assigned_unit_id;
  const additionalIds  = Array.isArray(req.body.additional_unit_ids) ? req.body.additional_unit_ids : [];
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
    additional_unit_ids:  additionalIds
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
    }
  }
  additionalIds.forEach(uid => {
    const u = units.find(u => u.id === uid);
    if (u) {
      u.status = 'dispatched';
      saveUnit(u).catch(console.error);
      io.to('dispatchers').emit('unit:status_change', { unit_id: u.id, status: 'dispatched' });
      io.to(`crew:${uid}`).emit('call:assigned_to_me', call);
    }
  });

  res.status(201).json(call);
});

app.patch('/api/calls/:id/assign', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });

  call.assigned_unit_id = req.body.unit_id;
  call.status           = 'dispatched';
  call.dispatched_at    = call.dispatched_at || new Date().toISOString();

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
  if (!call.additional_unit_ids) call.additional_unit_ids = [];
  if (!call.additional_unit_ids.includes(unit_id) && call.assigned_unit_id !== unit_id) {
    call.additional_unit_ids.push(unit_id);
  }
  const unit = units.find(u => u.id === unit_id);
  if (unit) {
    unit.status = 'dispatched';
    saveUnit(unit).catch(console.error);
    io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: 'dispatched' });
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
    // Crew can only advance status, not close or set arbitrary values
    const CREW_ALLOWED = ['acknowledged','en_route','on_scene','patient_contact','transporting','cleared','available'];
    if (!CREW_ALLOWED.includes(req.body.status))
      return res.status(403).json({ error: 'Forbidden' });
  }

  const TS_MAP = {
    en_route: 'en_route_at', on_scene: 'on_scene_at',
    patient_contact: 'patient_contact_at', cleared: 'cleared_at', available: 'available_at'
  };
  call.status = req.body.status;
  if (req.body.disposition) call.disposition = req.body.disposition;
  if (req.body.close_notes)  call.close_notes  = req.body.close_notes;
  if (TS_MAP[req.body.status] && !call[TS_MAP[req.body.status]]) {
    call[TS_MAP[req.body.status]] = new Date().toISOString();
  }
  if (req.body.status === 'closed') call.closed_at = new Date().toISOString();

  saveCall(call).catch(console.error);

  const payload = { call_id: call.id, status: call.status, timestamp: new Date().toISOString() };
  io.to('dispatchers').emit('call:status_change', payload);
  io.to(`crew:${call.assigned_unit_id}`).emit('call:updated', { call_id: call.id, changes: { status: call.status } });

  const newUnitStatus = req.body.status === 'closed' ? 'available' : req.body.status;
  const allUnitIds = [
    call.assigned_unit_id,
    ...(call.additional_unit_ids || [])
  ].filter(Boolean);

  allUnitIds.forEach(uid => {
    const unit = units.find(u => u.id === uid);
    if (unit) {
      unit.status = newUnitStatus;
      saveUnit(unit).catch(console.error);
      io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: unit.status });
      io.to(`crew:${uid}`).emit('unit:status_change', { unit_id: uid, status: newUnitStatus });
    }
  });
  res.json(call);
});

app.post('/api/calls/:id/comments', verifyToken, async (req, res) => {
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

  // Capture unit IDs before clearing so we can notify crew sockets
  const endedUnitIds = units.map(u => u.id);

  // Clear live state so the next shift starts fresh
  calls = [];
  for (const u of [...units]) {
    deleteUnitFromDb(u.id).catch(console.error);
  }
  units = [];

  currentShift = null;
  io.to('dispatchers').emit('shift:ended', { ...summary, units: [] });
  endedUnitIds.forEach(uid => io.to(`crew:${uid}`).emit('shift:ended', { units: [] }));
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

  const unit = units.find(u => u.tracki_device_id && String(u.tracki_device_id) === String(device_id));
  if (unit && lat && lng) {
    applyGpsUpdate(unit, lat, lng, timestamp);
    console.log(`[gps] updated ${unit.unit_number} → ${lat}, ${lng}`);
  } else if (!unit && device_id !== null) {
    console.log(`[gps] unknown device_id: ${device_id} — set this in Edit Unit → GPS Device ID`);
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
  Object.entries(req.body).forEach(([k, v]) => {
    if (ALLOWED.includes(k)) call[k] = v;
  });
  saveCall(call).catch(console.error);
  res.json({ ok: true });
});

app.patch('/api/calls/:id/narrative', verifyToken, async (req, res) => {
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
// plus.trackimo.com v4 API uses Bearer token auth
const TRACKIMO_APP  = 'https://app.trackimo.com';
const TRACKIMO_PLUS = 'https://plus.trackimo.com';
let trackimoBearer    = null;
let trackimoCookie    = null;
let trackimoAccountId = null;

async function trackimoLogin() {
  const { TRACKIMO_USERNAME, TRACKIMO_PASSWORD } = process.env;

  // TRACKIMO_BEARER_TOKEN env var = immediate manual override (paste from browser DevTools)
  if (process.env.TRACKIMO_BEARER_TOKEN) {
    trackimoBearer    = process.env.TRACKIMO_BEARER_TOKEN;
    trackimoAccountId = process.env.TRACKIMO_ACCOUNT_ID || null;
    if (!trackimoAccountId) throw new Error('set TRACKIMO_ACCOUNT_ID env var alongside TRACKIMO_BEARER_TOKEN');
    console.log(`[tracki] using manual Bearer token — account_id=${trackimoAccountId}`);
    return;
  }

  // Try login on plus.trackimo.com (v4 — the API we're polling)
  const loginAttempts = [
    { url: `${TRACKIMO_PLUS}/api/v4/user/login`,           label: 'plus/v4'  },
    { url: `${TRACKIMO_PLUS}/api/internal/v2/user/login`,  label: 'plus/int' },
    { url: `${TRACKIMO_APP}/api/internal/v2/user/login`,   label: 'app/int'  }
  ];

  for (const { url, label } of loginAttempts) {
    const base = url.startsWith(TRACKIMO_PLUS) ? TRACKIMO_PLUS : TRACKIMO_APP;
    const res  = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, Referer: `${base}/` },
      body: JSON.stringify({ username: TRACKIMO_USERNAME, password: TRACKIMO_PASSWORD })
    });
    const rawCookies = (res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || ''])
      .filter(Boolean).map(c => c.split(';')[0]);
    const data = await res.json().catch(() => ({}));
    console.log(`[tracki] login ${label} (${res.status}) cookies=[${rawCookies.map(c => c.split('=')[0]).join(',')}] body=${JSON.stringify(data).slice(0, 250)}`);

    if (res.ok) {
      if (rawCookies.length && !trackimoCookie) trackimoCookie = rawCookies.join('; ');
      const tok = data.access_token ?? data.token ?? data.jwt ?? data.bearer_token ?? null;
      if (tok && !trackimoBearer) trackimoBearer = tok;
      const aid = data.account_id ?? data.accountId ?? data.id ?? null;
      if (aid && !trackimoAccountId) trackimoAccountId = String(aid);
    }
    if (trackimoBearer) break;
  }

  // account_id env var is authoritative fallback
  if (!trackimoAccountId) trackimoAccountId = process.env.TRACKIMO_ACCOUNT_ID || null;
  if (!trackimoAccountId) throw new Error('set TRACKIMO_ACCOUNT_ID env var (found in browser DevTools request URL)');

  console.log(`[tracki] auth complete — account_id=${trackimoAccountId} hasBearer=${!!trackimoBearer} hasCookie=${!!trackimoCookie}`);
}

async function pollTrackimoLocations() {
  const trackedUnits = units.filter(u => u.tracki_device_id);
  if (trackedUnits.length === 0 || !trackimoCookie || !trackimoAccountId) return;

  const deviceIds = trackedUnits.map(u => u.tracki_device_id);
  try {
    const params = new URLSearchParams({
      comm_stat: '1',
      device_ids: deviceIds.join(','),
      fetch_is_fast_tracking_enabled: 'true'
    });
    const pollHeaders = {
      Origin: TRACKIMO_PLUS,
      Referer: `${TRACKIMO_PLUS}/`,
      'User-Agent': 'Mozilla/5.0'
    };
    if (trackimoBearer)  pollHeaders['Authorization'] = `Bearer ${trackimoBearer}`;
    if (trackimoCookie)  pollHeaders['Cookie']        = trackimoCookie;

    const res = await fetch(
      `${TRACKIMO_PLUS}/api/v4/accounts/${trackimoAccountId}/locations/filter?${params}`,
      { headers: pollHeaders }
    );

    if (res.status === 401 || res.status === 403) {
      if (process.env.TRACKIMO_BEARER_TOKEN) {
        console.error('[tracki] manual Bearer token rejected — update TRACKIMO_BEARER_TOKEN in Railway');
        return;
      }
      console.log(`[tracki] auth expired (${res.status}) — re-logging in`);
      trackimoBearer = null;
      trackimoCookie = null;
      await trackimoLogin();
      return pollTrackimoLocations();
    }

    const payload = await res.json();
    console.log(`[tracki] poll (${res.status}): ${JSON.stringify(payload).slice(0, 400)}`);
    const results = Array.isArray(payload) ? payload : (payload.locations || payload.data || []);

    for (const loc of results) {
      const deviceId = String(loc.device_id ?? loc.id ?? loc.tracki_id ?? '');
      const lat      = parseFloat(loc.lat ?? loc.latitude  ?? 0);
      const lng      = parseFloat(loc.lng ?? loc.longitude ?? loc.lon ?? 0);
      const ts       = loc.timestamp ?? loc.time ?? new Date().toISOString();
      if (!lat || !lng) continue;

      const unit = units.find(u => u.tracki_device_id && String(u.tracki_device_id) === deviceId);
      if (unit) {
        applyGpsUpdate(unit, lat, lng, ts);
        console.log(`[tracki] ${unit.unit_number} → ${lat}, ${lng}`);
      } else {
        handleUnknownDevice(deviceId);
      }
    }
  } catch (err) {
    console.error('[tracki] poll error:', err.message);
  }
}

async function startTrackimoPolling() {
  if (!process.env.TRACKIMO_USERNAME || !process.env.TRACKIMO_PASSWORD) return;
  try {
    await trackimoLogin();
    await pollTrackimoLocations();
    setInterval(pollTrackimoLocations, 15000);
    console.log('[tracki] polling started — 15 s interval');
  } catch (err) {
    console.error('[tracki] startup failed:', err.message);
  }
}

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
    if (role !== 'dispatcher' && role !== 'display') {
      socket.emit('error:auth', { message: 'Unauthorized' });
      return;
    }
    socket.join('dispatchers');
    socket.emit('init:state', {
      units: units.map(u => ({ ...u, password_hash: undefined })),
      calls,
      locations
    });
  });

  socket.on('join:crew', ({ unit_id }) => {
    socket.join(`crew:${unit_id}`);
    const myCall = calls.find(c => c.assigned_unit_id === unit_id && c.status !== 'closed');
    if (myCall) socket.emit('call:assigned_to_me', myCall);
  });

  socket.on('crew:status_update', ({ unit_id, status }) => {
    const unit = units.find(u => u.id === unit_id);
    if (unit) {
      unit.status = status;
      saveUnit(unit).catch(console.error);
      io.to('dispatchers').emit('unit:status_change', { unit_id, status });
      const activeCall = calls.find(c => c.assigned_unit_id === unit_id && c.status !== 'closed');
      if (activeCall) {
        const TS_MAP = { en_route: 'en_route_at', on_scene: 'on_scene_at', patient_contact: 'patient_contact_at', cleared: 'cleared_at' };
        activeCall.status = status;
        if (TS_MAP[status] && !activeCall[TS_MAP[status]]) activeCall[TS_MAP[status]] = new Date().toISOString();
        saveCall(activeCall).catch(console.error);
        io.to('dispatchers').emit('call:status_change', { call_id: activeCall.id, status, timestamp: new Date().toISOString() });
      }
    }
  });

  socket.on('crew:profile_update', ({ unit_id, profile }) => {
    const unit = units.find(u => u.id === unit_id);
    if (unit) {
      unit.profile = profile;
      saveUnit(unit).catch(console.error);
      io.to('dispatchers').emit('unit:profile_update', { unit_id, profile });
    }
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
