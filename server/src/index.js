const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const http       = require('http');
const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const { Pool }   = require('pg');
const { scrypt, timingSafeEqual } = require('crypto');
const { promisify } = require('util');
require('dotenv').config();

const scryptAsync = promisify(scrypt);
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let _supabase = null;
function getSupabase() {
  if (!_supabase && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
    } catch (e) {
      console.error('[supabase] createClient failed:', e.message);
    }
  }
  return _supabase;
}

async function verifyPersonnelPin(plain, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const buf = await scryptAsync(String(plain), salt, 64);
    return timingSafeEqual(buf, Buffer.from(hash, 'hex'));
  } catch { return false; }
}

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
app.use(express.urlencoded({ extended: false })); // Traccar Client POSTs form-encoded params

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
warnIfWeak('DISPLAY_PIN',         process.env.DISPLAY_PIN,         undefined);

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
let parkPaths    = [];
let currentShift = null;
let nextCallNum  = 100;
const gpsDiscardLastLog  = new Map(); // unit_id → last discard log timestamp

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
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS additional_units_added_at JSONB DEFAULT '{}'`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS chief_complaint TEXT`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS notes TEXT`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS park_zone TEXT`);
  await pool.query(`ALTER TABLE calls ADD COLUMN IF NOT EXISTS additional_unit_timestamps JSONB DEFAULT '{}'`);
  await pool.query(`ALTER TABLE locations ADD COLUMN IF NOT EXISTS location_type TEXT DEFAULT 'permanent'`);
  await pool.query(`ALTER TABLE units ADD COLUMN IF NOT EXISTS last_gps_fix_ts TEXT`);

  // Prune calls older than 90 days
  const pruneDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const pruned = await pool.query('DELETE FROM calls WHERE received_at < $1', [pruneDate]);
  if (pruned.rowCount > 0) console.log(`[db] pruned ${pruned.rowCount} calls older than 90 days`);

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
    CREATE TABLE IF NOT EXISTS gps_history (
      id SERIAL PRIMARY KEY,
      call_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      unit_number TEXT,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      recorded_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS gps_history_call_id_idx ON gps_history(call_id)
  `);

  // ── Wayfinding path curation (admin-only tool, fed by real crew GPS history) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS park_paths (
      id TEXT PRIMARY KEY,
      name TEXT,
      coordinates JSONB NOT NULL,
      created_at TEXT,
      created_by TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    )
  `);

  const unitsRes = await pool.query('SELECT * FROM units ORDER BY unit_number');
  units = unitsRes.rows.map(u => ({ ...u }));

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
    co_unit_ids:         r.co_unit_ids         || [],
    additional_units_added_at:   r.additional_units_added_at   || {},
    additional_unit_timestamps:  r.additional_unit_timestamps  || {}
  }));
  // Query global max so call numbers never reset after a restart
  const maxRes = await pool.query('SELECT MAX(call_number) AS max_num FROM calls');
  nextCallNum = (maxRes.rows[0]?.max_num || 99) + 1;

  const shiftRes = await pool.query("SELECT * FROM shifts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1");
  currentShift = shiftRes.rows[0] || null;
  if (currentShift) currentShift.unit_staffing = currentShift.unit_staffing || [];

  const locsRes = await pool.query("SELECT * FROM locations ORDER BY name");
  locations = locsRes.rows;

  const parkPathsRes = await pool.query('SELECT * FROM park_paths ORDER BY created_at');
  parkPaths = parkPathsRes.rows.map(p => ({ ...p, coordinates: p.coordinates || [] }));

  console.log(`[db] loaded ${units.length} units, ${calls.length} calls, ${locations.length} locations, ${parkPaths.length} park paths, shift: ${currentShift?.shift_label || 'none'}`);
}

async function saveUnit(unit) {
  await pool.query(`
    INSERT INTO units (id, unit_number, unit_name, unit_type, status, crew, station,
      last_lat, last_lng, last_gps_at, last_gps_fix_ts, password_hash, profile)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (id) DO UPDATE SET
      unit_number=EXCLUDED.unit_number, unit_name=EXCLUDED.unit_name, unit_type=EXCLUDED.unit_type,
      status=EXCLUDED.status, crew=EXCLUDED.crew, station=EXCLUDED.station,
      last_lat=EXCLUDED.last_lat, last_lng=EXCLUDED.last_lng,
      last_gps_at=EXCLUDED.last_gps_at, last_gps_fix_ts=EXCLUDED.last_gps_fix_ts,
      password_hash=EXCLUDED.password_hash, profile=EXCLUDED.profile
  `, [unit.id, unit.unit_number, unit.unit_name, unit.unit_type, unit.status,
      unit.crew, unit.station, unit.last_lat, unit.last_lng,
      unit.last_gps_at, unit.last_gps_fix_ts || null, unit.password_hash,
      unit.profile ? JSON.stringify(unit.profile) : null]);
}

async function deleteUnitFromDb(id) {
  await pool.query('DELETE FROM units WHERE id=$1', [id]);
}

async function saveCall(call) {
  await pool.query(`
    INSERT INTO calls (id, call_number, status, call_type, priority, location_name, park_zone,
      location_lat, location_lng, assigned_unit_id, assigned_unit_number, received_at, dispatched_at, acknowledged_at,
      en_route_at, on_scene_at, patient_contact_at, arrived_first_aid_at, transporting_at,
      cleared_at, available_at, closed_at,
      disposition, close_notes, comments, narrative, additional_unit_ids, response_mode,
      parent_call_id, mutual_aid_agencies, co_unit_ids, additional_units_added_at,
      chief_complaint, notes, additional_unit_timestamps)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
    ON CONFLICT (id) DO UPDATE SET
      status=EXCLUDED.status, call_type=EXCLUDED.call_type, priority=EXCLUDED.priority,
      location_name=EXCLUDED.location_name, park_zone=EXCLUDED.park_zone,
      location_lat=EXCLUDED.location_lat, location_lng=EXCLUDED.location_lng,
      assigned_unit_id=EXCLUDED.assigned_unit_id, assigned_unit_number=EXCLUDED.assigned_unit_number,
      dispatched_at=EXCLUDED.dispatched_at, acknowledged_at=EXCLUDED.acknowledged_at,
      en_route_at=EXCLUDED.en_route_at, on_scene_at=EXCLUDED.on_scene_at,
      patient_contact_at=EXCLUDED.patient_contact_at,
      arrived_first_aid_at=EXCLUDED.arrived_first_aid_at, transporting_at=EXCLUDED.transporting_at,
      cleared_at=EXCLUDED.cleared_at, available_at=EXCLUDED.available_at, closed_at=EXCLUDED.closed_at,
      disposition=EXCLUDED.disposition, close_notes=EXCLUDED.close_notes,
      comments=EXCLUDED.comments, narrative=EXCLUDED.narrative,
      additional_unit_ids=EXCLUDED.additional_unit_ids, response_mode=EXCLUDED.response_mode,
      parent_call_id=EXCLUDED.parent_call_id, mutual_aid_agencies=EXCLUDED.mutual_aid_agencies,
      co_unit_ids=EXCLUDED.co_unit_ids, additional_units_added_at=EXCLUDED.additional_units_added_at,
      chief_complaint=EXCLUDED.chief_complaint, notes=EXCLUDED.notes,
      additional_unit_timestamps=EXCLUDED.additional_unit_timestamps
  `, [call.id, call.call_number, call.status, call.call_type, call.priority,
      call.location_name, call.park_zone || null,
      call.location_lat, call.location_lng, call.assigned_unit_id,
      call.assigned_unit_number || null,
      call.received_at, call.dispatched_at, call.acknowledged_at, call.en_route_at,
      call.on_scene_at, call.patient_contact_at, call.arrived_first_aid_at || null,
      call.transporting_at || null, call.cleared_at, call.available_at,
      call.closed_at, call.disposition, call.close_notes, JSON.stringify(call.comments || []),
      call.narrative || null, JSON.stringify(call.additional_unit_ids || []),
      call.response_mode || null, call.parent_call_id || null,
      JSON.stringify(call.mutual_aid_agencies || []),
      JSON.stringify(call.co_unit_ids || []),
      JSON.stringify(call.additional_units_added_at || {}),
      call.chief_complaint || null, call.notes || null,
      JSON.stringify(call.additional_unit_timestamps || {})]);
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

async function saveParkPath(p) {
  await pool.query(`
    INSERT INTO park_paths (id, name, coordinates, created_at, created_by) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, coordinates=EXCLUDED.coordinates
  `, [p.id, p.name, JSON.stringify(p.coordinates), p.created_at, p.created_by]);
}

async function deleteParkPathFromDb(id) {
  await pool.query('DELETE FROM park_paths WHERE id=$1', [id]);
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

// ── Crew personal login (EMS credentials) ─────────────────────────
app.post('/api/auth/crew-login', async (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) return res.status(400).json({ error: 'Username and PIN required' });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Crew login not configured on server' });
  }

  try {
    const cleanUsername = username.trim().toLowerCase();
    const cleanPin      = String(pin).replace(/\D/g, '');

    const supabase = getSupabase();
    if (!supabase) return res.status(503).json({ error: 'Crew login not configured on server' });

    const { data: person, error: sbErr } = await supabase
      .from('personnel')
      .select('id, name, username, pin_hash, failed_attempts, locked_until')
      .eq('username', cleanUsername)
      .maybeSingle();

    if (sbErr) {
      console.error('[crew-login] supabase error:', sbErr.message);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!person || !person.pin_hash)
      return res.status(401).json({ error: 'Incorrect username or PIN' });

    if (person.locked_until && new Date(person.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(person.locked_until) - Date.now()) / 60000);
      return res.status(401).json({ error: `Account locked. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.` });
    }

    const valid = await verifyPersonnelPin(cleanPin, person.pin_hash);

    const patchPersonnel = (fields) =>
      supabase.from('personnel').update(fields).eq('id', person.id);

    if (!valid) {
      await patchPersonnel({ failed_attempts: (person.failed_attempts || 0) + 1 });
      return res.status(401).json({ error: 'Incorrect username or PIN' });
    }

    await patchPersonnel({ failed_attempts: 0, locked_until: null });

    const token = signToken({
      personnel_id: person.id,
      name:         person.name,
      username:     person.username,
      role:         'crew',
    });
    return res.json({ token, user: { role: 'crew', name: person.name, username: person.username } });
  } catch (err) {
    console.error('[crew-login]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── SSO — sfotems.com single sign-on ─────────────────────────────
// dest=dispatcher: validates can_dispatch flag, issues dispatcher JWT
// dest=crew: issues pre-auth crew JWT (caller still picks a unit via /crew/select-unit)
// dest=display: caller should just navigate to /display directly (no server auth needed)
const EMS_PORTAL = process.env.EMS_PORTAL_URL || 'https://sfotems.com';
app.post('/api/auth/sso', async (req, res) => {
  const { token, dest } = req.body;
  if (!token || !dest) return res.status(400).json({ error: 'token and dest required' });

  let identity;
  try {
    const r = await fetch(`${EMS_PORTAL}/api/resolve-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await r.json();
    if (!data.valid) return res.status(401).json({ error: 'Session invalid or expired — please log in to sfotems.com again' });
    identity = data;
  } catch (err) {
    console.error('[sso] resolve-session failed:', err.message);
    return res.status(503).json({ error: 'Could not verify identity — please try again' });
  }

  if (dest === 'dispatcher') {
    if (!identity.can_dispatch && identity.access_role !== 'admin') {
      return res.status(403).json({ error: 'Your account does not have dispatcher access' });
    }
    const cadToken = signToken({
      dispatcher_id: `sso:${identity.id}`,
      username: identity.name,
      role: 'dispatcher',
      sso: true,
    });
    return res.json({ token: cadToken, user: { role: 'dispatcher', username: identity.name, name: identity.name } });
  }

  if (dest === 'crew') {
    // Pre-auth token — no unit assigned yet; caller uses /crew/select-unit to complete login
    const cadToken = signToken({
      personnel_id: identity.id,
      name: identity.name,
      username: identity.name,
      role: 'crew',
      sso: true,
    });
    return res.json({ token: cadToken, user: { role: 'crew', name: identity.name, sso: true } });
  }

  if (dest === 'wayfinding') {
    // Admin-only, and a dedicated role — this token can't reach any other
    // dispatcher/crew endpoint, only the wayfinding ones below.
    if (identity.access_role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const cadToken = signToken({
      admin_id: identity.id,
      name: identity.name,
      role: 'wayfinding_admin',
      sso: true,
    });
    return res.json({ token: cadToken, user: { role: 'wayfinding_admin', name: identity.name, sso: true } });
  }

  return res.status(400).json({ error: 'Unknown dest — expected dispatcher, crew, display, or wayfinding' });
});

const VALID_UNIT_STATUSES = new Set([
  'available', 'dispatched', 'acknowledged', 'en_route',
  'on_scene', 'patient_contact', 'transporting', 'cleared', 'out_of_service'
]);

const VALID_CALL_STATUSES = new Set([
  'pending', 'dispatched', 'acknowledged', 'en_route', 'on_scene',
  'patient_contact', 'transporting', 'cleared', 'available', 'closed'
]);

// Derives call.status from whichever timestamp was set last.
const TS_TO_STATUS = [
  ['closed_at',           'closed'],
  ['available_at',        'available'],
  ['cleared_at',          'cleared'],
  ['transporting_at',     'transporting'],
  ['patient_contact_at',  'patient_contact'],
  ['on_scene_at',         'on_scene'],
  ['en_route_at',         'en_route'],
  ['acknowledged_at',     'acknowledged'],
  ['dispatched_at',       'dispatched'],
];
function recalcCallStatus(call) {
  for (const [field, status] of TS_TO_STATUS) {
    if (call[field]) return status;
  }
  return 'pending';
}

// Maps unit status values to their additional_unit_timestamps field name
const UNIT_STATUS_TO_TS_FIELD = {
  en_route:        'en_route_at',
  on_scene:        'on_scene_at',
  patient_contact: 'patient_contact_at',
  transporting:    'transporting_at',
  cleared:         'cleared_at',
};

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

  // Record milestone timestamp for additional units on active calls
  const tsField = UNIT_STATUS_TO_TS_FIELD[unit.status];
  if (tsField) {
    const activeCall = calls.find(c =>
      c.assigned_unit_id !== unit.id &&
      (c.additional_unit_ids || []).includes(unit.id) &&
      c.status !== 'closed'
    );
    if (activeCall) {
      if (!activeCall.additional_unit_timestamps) activeCall.additional_unit_timestamps = {};
      if (!activeCall.additional_unit_timestamps[unit.id]) activeCall.additional_unit_timestamps[unit.id] = {};
      activeCall.additional_unit_timestamps[unit.id][tsField] = new Date().toISOString();
      saveCall(activeCall).catch(console.error);
      io.to('dispatchers').emit('call:updated', {
        call_id: activeCall.id,
        changes: { additional_unit_timestamps: activeCall.additional_unit_timestamps }
      });
    }
  }

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
  const { unit_number, unit_name, unit_type = 'ALS' } = req.body;
  if (!unit_number?.trim() || !unit_name?.trim())
    return res.status(400).json({ error: 'unit_number and unit_name are required' });
  if (units.some(u => u.unit_number.trim().toLowerCase() === unit_number.trim().toLowerCase()))
    return res.status(409).json({ error: `A unit named "${unit_number.trim()}" already exists` });
  const newUnit = {
    id:              `u-${Date.now()}`,
    unit_number:     unit_number.trim(),
    unit_name:       unit_name.trim(),
    unit_type,
    status:          'available',
    last_lat:        null,
    last_lng:        null,
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

  const { unit_number, unit_name, unit_type, password } = req.body;
  if (unit_number !== undefined) {
    if (units.some(u => u.id !== unit.id && u.unit_number.trim().toLowerCase() === unit_number.trim().toLowerCase()))
      return res.status(409).json({ error: `A unit named "${unit_number.trim()}" already exists` });
    unit.unit_number = unit_number;
  }
  if (unit_name   !== undefined)    unit.unit_name    = unit_name;
  if (unit_type   !== undefined)    unit.unit_type    = unit_type;
  if (password)                     unit.password_hash = bcrypt.hashSync(password, 8);

  await saveUnit(unit).catch(console.error);
  const sanitized = { ...unit, password_hash: undefined };
  io.to('dispatchers').emit('unit:updated', sanitized);
  res.json(sanitized);
});

// ── Beacon (crew ↔ crew finder) ───────────────────────────────────
app.patch('/api/units/:id/beacon', verifyToken, (req, res) => {
  if (req.user.role !== 'crew') return res.status(403).json({ error: 'Forbidden' });
  if (req.user.unit_id !== req.params.id) return res.status(403).json({ error: 'Can only toggle your own beacon' });
  const unit = units.find(u => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: 'Not found' });
  unit.beacon_active = !!req.body.active;
  const sanitized = { ...unit, password_hash: undefined };
  io.to('dispatchers').emit('unit:updated', sanitized);
  io.to('crew_all').emit('unit:updated', sanitized);
  res.json({ ok: true, beacon_active: unit.beacon_active });
});

app.delete('/api/units/:id/gps', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const unit = units.find(u => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: 'Not found' });
  unit.last_lat        = null;
  unit.last_lng        = null;
  unit.last_gps_at     = null;
  unit.last_gps_fix_ts = null; // reset dedup so next ping always lands
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

// Returns Traccar Client setup info for a unit (dispatcher only)
app.get('/api/units/:id/tracking-setup', verifyToken, (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const unit = units.find(u => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: 'Not found' });
  const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json({ device_id: unit.unit_number, server_url: baseUrl });
});

// ── Calls ─────────────────────────────────────────────────────────
app.get('/api/calls', verifyToken, (req, res) => {
  if (req.user.role === 'crew') {
    const mine = calls.filter(c =>
      c.status !== 'closed' &&
      (c.assigned_unit_id === req.user.unit_id || (c.additional_unit_ids || []).includes(req.user.unit_id))
    );
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
      co_unit_ids:         r.co_unit_ids         || [],
      additional_units_added_at: r.additional_units_added_at || {}
    })));
  } catch (err) {
    console.error('[history] query error:', err.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// A crew member's own case history (primary or additional unit), for chart reference.
app.get('/api/crew/calls/history', verifyToken, async (req, res) => {
  if (req.user.role !== 'crew') return res.status(403).json({ error: 'Forbidden' });
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const result = await pool.query(
      `SELECT * FROM calls
       WHERE received_at > $1
         AND (assigned_unit_id = $2 OR additional_unit_ids @> $3::jsonb)
       ORDER BY received_at DESC`,
      [cutoff, req.user.unit_id, JSON.stringify([req.user.unit_id])]
    );
    res.json(result.rows.map(r => ({
      ...r,
      comments:            r.comments            || [],
      additional_unit_ids: r.additional_unit_ids || [],
      mutual_aid_agencies: r.mutual_aid_agencies || [],
      co_unit_ids:         r.co_unit_ids         || [],
      additional_units_added_at: r.additional_units_added_at || {}
    })));
  } catch (err) {
    console.error('[crew history] query error:', err.message);
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
  for (const uid of additionalIds) {
    const conflict = getUnitActiveCall(uid);
    if (conflict) return res.status(409).json({ error: `Unit already on call #${conflict.call_number}` });
  }
  const id         = `call-${Date.now()}`;
  const callNumber = nextCallNum++;
  const now        = new Date().toISOString();
  const call = {
    ...req.body,
    // Protected fields — never overrideable by the client
    id,
    call_number:          callNumber,
    status:               hasUnit ? 'dispatched' : 'pending',
    received_at:          now,
    dispatched_at:        hasUnit ? now : null,
    acknowledged_at:      null, en_route_at: null, on_scene_at: null,
    patient_contact_at:   null, transporting_at: null, arrived_first_aid_at: null,
    cleared_at:           null, available_at: null,
    closed_at:            null, disposition: null, close_notes: null,
    comments:             [],
    additional_unit_ids:  additionalIds,
    co_unit_ids:          additionalIds,   // units in the initial dispatch travel together
    additional_units_added_at: Object.fromEntries(additionalIds.map(uid => [uid, now])),
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

  const previousUnitId = call.assigned_unit_id;
  const wasPending      = call.status === 'pending';

  call.assigned_unit_id     = req.body.unit_id;
  call.assigned_unit_number = units.find(u => u.id === req.body.unit_id)?.unit_number || null;
  // Only a first-time assignment (call was pending) bumps the call to 'dispatched'.
  // Swapping a unit mid-call should keep the call wherever it already was.
  if (wasPending) call.status = 'dispatched';
  call.dispatched_at = call.dispatched_at || new Date().toISOString();

  const unit = units.find(u => u.id === req.body.unit_id);
  if (unit) {
    // New unit picks up the call's current status, not a hardcoded 'dispatched',
    // so swapping mid-call (e.g. while en route) doesn't strand it a step behind.
    unit.status = call.status;
    saveUnit(unit).catch(console.error);
    io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: unit.status });
    io.to(`crew:${unit.id}`).emit('unit:status_change', { unit_id: unit.id, status: unit.status });
  }

  // The unit being replaced is freed, not left stranded at its last status.
  if (previousUnitId && previousUnitId !== req.body.unit_id) {
    const previousUnit = units.find(u => u.id === previousUnitId);
    if (previousUnit) {
      previousUnit.status = 'available';
      saveUnit(previousUnit).catch(console.error);
      io.to('dispatchers').emit('unit:status_change', { unit_id: previousUnit.id, status: 'available' });
      io.to(`crew:${previousUnitId}`).emit('unit:status_change', { unit_id: previousUnitId, status: 'available' });
      io.to(`crew:${previousUnitId}`).emit('call:updated', { call_id: call.id, changes: { assigned_unit_id: call.assigned_unit_id } });
    }
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
  const { unit_id, initial_status } = req.body;
  if (!unit_id) return res.status(400).json({ error: 'unit_id required' });

  const joinStatus = (initial_status && VALID_UNIT_STATUSES.has(initial_status))
    ? initial_status
    : 'dispatched';

  const conflict = getUnitActiveCall(unit_id, req.params.id);
  if (conflict) return res.status(409).json({ error: `Unit already on call #${conflict.call_number}` });

  if (!call.additional_unit_ids) call.additional_unit_ids = [];
  if (!call.additional_unit_ids.includes(unit_id) && call.assigned_unit_id !== unit_id) {
    call.additional_unit_ids.push(unit_id);
    if (!call.additional_units_added_at) call.additional_units_added_at = {};
    call.additional_units_added_at[unit_id] = new Date().toISOString();
  }
  const unit = units.find(u => u.id === unit_id);
  if (unit) {
    unit.status = joinStatus;
    saveUnit(unit).catch(console.error);
    io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: joinStatus });
    io.to(`crew:${unit_id}`).emit('unit:status_change', { unit_id: unit.id, status: joinStatus });
    io.to(`crew:${unit_id}`).emit('call:assigned_to_me', call);
  }
  saveCall(call).catch(console.error);
  io.to('dispatchers').emit('call:updated', {
    call_id: call.id,
    changes: { additional_unit_ids: call.additional_unit_ids, additional_units_added_at: call.additional_units_added_at }
  });
  res.json(call);
});

app.delete('/api/calls/:id/units/:unit_id', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });
  call.additional_unit_ids = (call.additional_unit_ids || []).filter(id => id !== req.params.unit_id);
  // Units dispatched together with the primary start out in both arrays (see
  // POST /api/calls) — without also clearing co_unit_ids here, a "removed"
  // unit stayed subscribed to the call's status sync and could have its
  // status silently reassigned again the next time the call advanced.
  call.co_unit_ids = (call.co_unit_ids || []).filter(id => id !== req.params.unit_id);
  if (call.additional_units_added_at) delete call.additional_units_added_at[req.params.unit_id];
  const unit = units.find(u => u.id === req.params.unit_id);
  if (unit) {
    unit.status = 'available';
    saveUnit(unit).catch(console.error);
    io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: 'available' });
    io.to(`crew:${unit.id}`).emit('unit:status_change', { unit_id: unit.id, status: 'available' });
  }
  saveCall(call).catch(console.error);
  io.to('dispatchers').emit('call:updated', {
    call_id: call.id,
    changes: {
      additional_unit_ids: call.additional_unit_ids,
      co_unit_ids: call.co_unit_ids,
      additional_units_added_at: call.additional_units_added_at,
    }
  });
  res.json(call);
});

app.patch('/api/calls/:id/status', verifyToken, async (req, res) => {
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'overwatch') return res.status(403).json({ error: 'Forbidden' });

  if (req.user.role === 'crew') {
    const allIds = [call.assigned_unit_id, ...(call.additional_unit_ids || [])];
    if (!allIds.includes(req.user.unit_id))
      return res.status(403).json({ error: 'Forbidden' });
    const CREW_ALLOWED = ['acknowledged','en_route','on_scene','patient_contact','transporting','cleared','available'];
    const closingWithDisposition = req.body.status === 'closed' && req.body.disposition;
    if (!CREW_ALLOWED.includes(req.body.status) && !closingWithDisposition)
      return res.status(403).json({ error: 'Forbidden' });
  } else if (!VALID_CALL_STATUSES.has(req.body.status)) {
    return res.status(400).json({ error: 'Invalid status' });
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
  // Every unit on the call gets the message, not just the primary — otherwise
  // backup/additional units' chat pane never sees dispatch's replies, the
  // primary unit's messages, or even their own sent message (the client has
  // no optimistic local update and relies entirely on this echo).
  const commentUnitIds = [call.assigned_unit_id, ...(call.additional_unit_ids || [])].filter(Boolean);
  commentUnitIds.forEach(uid => {
    io.to(`crew:${uid}`).emit('call:comment_added', { call_id: call.id, comment });
  });
  res.json(comment);
});

// ── Crew login ────────────────────────────────────────────────────
// Step 1: pick an existing shift unit → get JWT
app.post('/api/crew/select-unit', (req, res) => {
  const { unit_id } = req.body;
  const unit = units.find(u => u.id === unit_id);
  if (!unit) return res.status(404).json({ error: 'Unit not found' });

  // Carry personnel identity forward from the pre-auth crew-login token (if present)
  let personnel = {};
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
      if (decoded.personnel_id) {
        personnel = { personnel_id: decoded.personnel_id, name: decoded.name, username: decoded.username };
      }
    } catch { /* no personnel info */ }
  }

  const token = signToken({ ...personnel, unit_id: unit.id, unit_number: unit.unit_number, role: 'crew' });
  res.json({ token, user: { role: 'crew', ...personnel, unit_id: unit.id, unit_number: unit.unit_number, profile: unit.profile } });
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

// Step 2: add a unit not in the shift roster → create it + get JWT
app.post('/api/crew/add-unit', async (req, res) => {
  const { unit_number, unit_type = 'ALS' } = req.body;
  if (!unit_number?.trim()) return res.status(400).json({ error: 'unit_number required' });

  // Re-use existing unit if it was already created
  let unit = units.find(u => u.unit_number.toLowerCase() === unit_number.trim().toLowerCase());
  if (!unit) {
    unit = {
      id: `u-${Date.now()}`,
      unit_number: unit_number.trim(), unit_name: unit_number.trim(),
      unit_type, status: 'available',
      last_lat: null, last_lng: null, last_gps_at: null,
      password_hash: null,
      profile: null, crew: null, station: null
    };
    units.push(unit);
    await saveUnit(unit).catch(console.error);
    io.to('dispatchers').emit('unit:updated', { ...unit, password_hash: undefined });
  }

  // Carry personnel identity forward from the pre-auth crew-login token (if present)
  let personnel = {};
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
      if (decoded.personnel_id) {
        personnel = { personnel_id: decoded.personnel_id, name: decoded.name, username: decoded.username };
      }
    } catch { /* no personnel info */ }
  }

  const token = signToken({ ...personnel, unit_id: unit.id, unit_number: unit.unit_number, role: 'crew' });
  res.json({ token, user: { role: 'crew', ...personnel, unit_id: unit.id, unit_number: unit.unit_number, profile: unit.profile } });
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
    // Don't clobber the status of a unit still working a call carried over from
    // the previous shift (e.g. still transporting) — the in-service toggle only
    // applies to units that aren't tied to a still-open call.
    if (!getUnitActiveCall(unit.id)) {
      unit.status = in_service ? 'available' : 'out_of_service';
    }
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

  // Clear closed calls (shift-scoped) but keep unit records — deleting/recreating
  // units every shift broke crew login sessions, GPS tracker assignments, and any
  // custom unit passwords. Just take everyone off-service for the next shift setup.
  //
  // Calls still open at shift end (e.g. a unit still transporting) are NOT discarded —
  // wiping them left no way to ever record a disposition/closed_at for that call. They
  // carry over into the next shift so a dispatcher can still close them out properly,
  // and the unit(s) working them keep their real status instead of being forced
  // 'out_of_service' out from under an active call.
  const openCalls   = calls.filter(c => c.status !== 'closed');
  const busyUnitIds = new Set();
  openCalls.forEach(c => {
    if (c.assigned_unit_id) busyUnitIds.add(c.assigned_unit_id);
    (c.additional_unit_ids || []).forEach(id => busyUnitIds.add(id));
  });
  calls = openCalls;
  units.forEach(u => {
    if (busyUnitIds.has(u.id)) return;
    u.status = 'out_of_service';
    saveUnit(u).catch(console.error);
  });

  currentShift = null;
  const sanitizedUnits = units.map(u => ({ ...u, password_hash: undefined }));
  io.to('dispatchers').emit('shift:ended', { ...summary, units: sanitizedUnits, open_calls: openCalls });
  units.forEach(u => io.to(`crew:${u.id}`).emit('shift:ended', { units: sanitizedUnits }));
  res.json({ ...summary, open_calls: openCalls });
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
// Returns true if the ping was accepted, false if discarded.
//
// GPS is on by default for every active-shift unit regardless of call status —
// the phone already transmits continuously the whole shift either way (nothing
// in the crew app ties sending to being on a call), so gating *display* on
// call status/a manual dispatcher toggle only hid data that was already
// flowing, for no battery/data savings. The only thing that still discards a
// ping is the crew member explicitly opting out themselves (see
// PATCH /api/crew/gps-sharing) — a dispatcher can't force a unit to be
// tracked against that.
function applyGpsUpdate(unit, lat, lng, timestamp) {
  if (unit.gps_sharing_disabled) {
    const last = gpsDiscardLastLog.get(unit.id) || 0;
    if (Date.now() - last > 5 * 60 * 1000) {
      console.log(`[gps] ${unit.unit_number} — discarded (crew disabled GPS sharing)`);
      gpsDiscardLastLog.set(unit.id, Date.now());
    }
    return false;
  }

  if (unit.last_gps_fix_ts && new Date(timestamp).getTime() <= new Date(unit.last_gps_fix_ts).getTime()) {
    console.log(`[gps:in] ${unit.unit_number} — rejected by dedup (ts ${timestamp} <= last ${unit.last_gps_fix_ts})`);
    return false;
  }
  unit.last_lat        = lat;
  unit.last_lng        = lng;
  unit.last_gps_at     = timestamp;
  unit.last_gps_fix_ts = timestamp;
  saveUnit(unit).catch(console.error);

  const activeCall = getUnitActiveCall(unit.id);
  if (activeCall) {
    pool.query(
      'INSERT INTO gps_history (call_id, unit_id, unit_number, lat, lng) VALUES ($1, $2, $3, $4, $5)',
      [activeCall.id, unit.id, unit.unit_number, lat, lng]
    ).catch(console.error);
  }
  const payload = { unit_id: unit.id, unit_number: unit.unit_number, lat, lng, timestamp };
  io.to('dispatchers').emit('unit:gps_update', payload);
  // Crew app needs this too — the browser GPS fallback hook checks last_gps_at to
  // know whether Traccar is still active. Without this emit, the hook sees a stale
  // timestamp after 3 minutes and starts sending redundant browser GPS alongside Traccar.
  io.to(`crew:${unit.id}`).emit('unit:gps_update', payload);
  return true;
}

// ── Traccar Client GPS (phone-based, OsmAnd protocol) ────────────
// Crew setup: install Traccar Client, set Protocol=OsmAnd, Server URL=<this server>,
// Device Identifier=<unit_number>. Interval 30s recommended.
// ALWAYS returns 200 — Traccar Client retries forever on any non-2xx response.
function handleTraccarGps(req, res) {
  res.sendStatus(200); // respond first, process after
  const p      = { ...req.query, ...req.body };
  const unitId = String(p.id ?? p.deviceId ?? '').trim();
  const lat    = parseFloat(p.lat ?? p.latitude  ?? '');
  const lng    = parseFloat(p.lon ?? p.lng ?? p.longitude ?? '');
  if (!unitId || isNaN(lat) || isNaN(lng)) return;
  const norm = s => s.toLowerCase().replace(/\s+/g, '');
  const unit = units.find(u => norm(u.unit_number) === norm(unitId));
  if (!unit) { console.log(`[traccar] unknown device id: ${unitId}`); return; }
  let ts = new Date().toISOString();
  if (p.timestamp) {
    const num = Number(p.timestamp);
    let parsed;
    if (!isNaN(num) && num < 9_000_000_000) {
      parsed = new Date(num * 1000);        // Unix seconds  (~1.75e9 today)
    } else if (!isNaN(num) && num < 9_000_000_000_000) {
      parsed = new Date(num);               // Unix milliseconds (~1.75e12 today)
    } else {
      parsed = new Date(p.timestamp);       // ISO string fallback
    }
    if (!isNaN(parsed.getTime())) ts = parsed.toISOString();
  }
  const accepted = applyGpsUpdate(unit, lat, lng, ts);
  if (accepted) console.log(`[traccar] ${unit.unit_number} → ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
}
app.get('/api/gps/traccar',  handleTraccarGps);
app.post('/api/gps/traccar', handleTraccarGps);

// ── Crew browser GPS ──────────────────────────────────────────────
app.post('/api/crew/gps', verifyToken, (req, res) => {
  if (req.user.role !== 'crew') return res.status(403).json({ error: 'Forbidden' });
  const unit = units.find(u => u.id === req.user.unit_id);
  if (!unit) return res.status(404).json({ error: 'Not found' });
  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  // iOS only — lets dispatch see which phones are still stuck at "While Using"
  // (GPS drops the moment the screen locks) instead of "Always," without
  // walking around checking every phone. In-memory only, like
  // beacon_active — live device state, not meaningful to keep after a restart.
  // Only broadcast when it actually changes; this arrives on every GPS post.
  const { gpsPermission } = req.body;
  if (gpsPermission && gpsPermission !== unit.gps_permission_status) {
    unit.gps_permission_status = gpsPermission;
    io.to('dispatchers').emit('unit:updated', { ...unit, password_hash: undefined });
  }

  // TEMPORARY — diagnosing GPS issues in production: logging every inbound
  // post, including the fix's self-reported accuracy, so a wildly-off
  // position (network/cell-tower fallback) is visible instead of guessed at.
  const accuracy = req.body.accuracy != null ? parseFloat(req.body.accuracy) : null;
  console.log(`[gps:in] ${unit.unit_number} ${lat.toFixed(5)},${lng.toFixed(5)} acc=${accuracy ?? '?'}m onCall=${!!getUnitActiveCall(unit.id)}`);

  applyGpsUpdate(unit, lat, lng, new Date().toISOString());
  res.json({ ok: true });
});

// Crew-only self-service opt-out — GPS is on by default for the whole shift,
// this is the one thing that can turn it back off. In-memory only, like
// beacon_active/gps_permission_status; resets each shift.
app.patch('/api/crew/gps-sharing', verifyToken, (req, res) => {
  if (req.user.role !== 'crew') return res.status(403).json({ error: 'Forbidden' });
  const unit = units.find(u => u.id === req.user.unit_id);
  if (!unit) return res.status(404).json({ error: 'Not found' });

  unit.gps_sharing_disabled = !req.body.enabled;
  io.to('dispatchers').emit('unit:updated', { ...unit, password_hash: undefined });
  res.json({ ok: true, gps_sharing_disabled: unit.gps_sharing_disabled });
});

// ── GPS history ───────────────────────────────────────────────────
app.get('/api/calls/:id/gps-track', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT unit_id, unit_number, lat, lng, recorded_at
       FROM gps_history WHERE call_id = $1
       ORDER BY recorded_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Wayfinding path curation (admin-only) ──────────────────────────
// Raw GPS history across every call, for the review map's "real crew
// walks" overlay. Capped so the payload can't grow unbounded as data
// accumulates over months.
app.get('/api/wayfinding/traces', verifyToken, async (req, res) => {
  if (req.user.role !== 'wayfinding_admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { rows } = await pool.query(
      `SELECT call_id, unit_id, unit_number, lat, lng, recorded_at
       FROM gps_history ORDER BY recorded_at DESC LIMIT 20000`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/park-paths', verifyToken, (req, res) => {
  res.json(parkPaths);
});

app.post('/api/park-paths', verifyToken, async (req, res) => {
  if (req.user.role !== 'wayfinding_admin') return res.status(403).json({ error: 'Forbidden' });
  const { name, coordinates } = req.body;
  if (!Array.isArray(coordinates) || coordinates.length < 2)
    return res.status(400).json({ error: 'coordinates must have at least 2 points' });
  const path = {
    id: `path-${Date.now()}`,
    name: name?.trim() || null,
    coordinates,
    created_at: new Date().toISOString(),
    created_by: req.user.name || null
  };
  parkPaths.push(path);
  await saveParkPath(path).catch(console.error);
  res.status(201).json(path);
});

app.delete('/api/park-paths/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'wayfinding_admin') return res.status(403).json({ error: 'Forbidden' });
  const idx = parkPaths.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  parkPaths.splice(idx, 1);
  deleteParkPathFromDb(req.params.id).catch(console.error);
  res.json({ ok: true });
});

app.get('/api/wayfinding/settings', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'wayfinding_enabled'");
    res.json({ enabled: rows[0]?.value === 'true' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/wayfinding/settings', verifyToken, async (req, res) => {
  if (req.user.role !== 'wayfinding_admin') return res.status(403).json({ error: 'Forbidden' });
  const enabled = !!req.body.enabled;
  try {
    await pool.query(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('wayfinding_enabled', $1, $2)
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at
    `, [String(enabled), new Date().toISOString()]);
    res.json({ enabled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

app.patch('/api/calls/:id/details', verifyToken, async (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });
  const { call_type, chief_complaint, notes } = req.body;
  const changes = {};
  if (call_type       !== undefined) { call.call_type       = call_type;       changes.call_type       = call_type; }
  if (chief_complaint !== undefined) { call.chief_complaint = chief_complaint;  changes.chief_complaint = chief_complaint; }
  if (notes           !== undefined) { call.notes           = notes;            changes.notes           = notes; }
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

  // Recalc call.status from remaining timestamps and sync the primary +
  // co-dispatched units — matches PATCH /api/calls/:id/status's sync so a
  // manual time correction can't leave co-units behind at a stale status
  // (previously this only synced the primary unit).
  const newStatus = recalcCallStatus(call);
  if (newStatus !== call.status) {
    call.status = newStatus;
    changes.status = newStatus;
    if (newStatus !== 'pending' && newStatus !== 'closed') {
      const unitIdsToUpdate = [call.assigned_unit_id, ...(call.co_unit_ids || [])].filter(Boolean);
      unitIdsToUpdate.forEach(uid => {
        const unit = units.find(u => u.id === uid);
        if (unit) {
          unit.status = newStatus;
          saveUnit(unit).catch(console.error);
          io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: newStatus });
          io.to(`crew:${uid}`).emit('unit:status_change', { unit_id: uid, status: newStatus });
        }
      });
    }
  }

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
      locations
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
    socket.join('crew_all');
    const myCall = getUnitActiveCall(unit_id);
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
  })
  .catch(err => {
    console.error('[db] Failed to connect to database:', err.message);
    process.exit(1);
  });
