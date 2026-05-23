const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const http       = require('http');
const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
require('dotenv').config();

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'PUT'] }
});

app.use(cors({ origin: '*' }));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// ── In-memory store ───────────────────────────────────────────────
const PW = 'ems2024'; // default password for all accounts

const dispatchers = [
  { id: 'd1', username: 'dispatch',  full_name: 'Command Dispatch', password_hash: bcrypt.hashSync(PW, 8) },
  { id: 'd2', username: 'dispatch2', full_name: 'Dispatch 2',       password_hash: bcrypt.hashSync(PW, 8) }
];

let units = [];

let calls = []; // starts empty — dispatchers create calls live

// ── JWT helpers ───────────────────────────────────────────────────
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
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

// ── Units ─────────────────────────────────────────────────────────
app.get('/api/units', (req, res) => {
  res.json(units.map(u => ({ ...u, password_hash: undefined })));
});

app.patch('/api/units/:id/status', verifyToken, (req, res) => {
  const unit = units.find(u => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: 'Not found' });

  // Crew can only update their own unit
  if (req.user.role === 'crew' && req.user.unit_id !== unit.id)
    return res.status(403).json({ error: 'Forbidden' });

  unit.status = req.body.status;
  io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: unit.status });
  res.json({ ok: true, unit });
});

app.put('/api/units/:id/profile', verifyToken, (req, res) => {
  const unit = units.find(u => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'crew' && req.user.unit_id !== unit.id)
    return res.status(403).json({ error: 'Forbidden' });

  unit.profile = { ...req.body };
  // Notify dispatchers of profile update
  io.to('dispatchers').emit('unit:profile_update', { unit_id: unit.id, profile: unit.profile });
  res.json({ ok: true, profile: unit.profile });
});

// ── Calls ─────────────────────────────────────────────────────────
app.get('/api/calls', verifyToken, (req, res) => {
  if (req.user.role === 'crew') {
    const mine = calls.filter(c => c.assigned_unit_id === req.user.unit_id && c.status !== 'closed');
    return res.json(mine);
  }
  res.json(calls);
});

app.post('/api/calls', verifyToken, (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const hasUnit = !!req.body.assigned_unit_id;
  const call = {
    id: `call-${Date.now()}`,
    call_number: 100 + calls.length,
    status: hasUnit ? 'dispatched' : 'pending',
    received_at: new Date().toISOString(),
    dispatched_at: hasUnit ? new Date().toISOString() : null,
    acknowledged_at: null, en_route_at: null, on_scene_at: null,
    patient_contact_at: null, cleared_at: null, available_at: null,
    comments: [],
    ...req.body
  };
  calls.push(call);

  io.to('dispatchers').emit('call:created', call);
  if (hasUnit) {
    io.to(`crew:${call.assigned_unit_id}`).emit('call:assigned_to_me', call);
    const unit = units.find(u => u.id === call.assigned_unit_id);
    if (unit) {
      unit.status = 'dispatched';
      io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: 'dispatched' });
    }
  }

  res.status(201).json(call);
});

app.patch('/api/calls/:id/assign', verifyToken, (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });

  call.assigned_unit_id = req.body.unit_id;
  call.status           = 'dispatched';
  call.dispatched_at    = call.dispatched_at || new Date().toISOString();

  const unit = units.find(u => u.id === req.body.unit_id);
  if (unit) {
    unit.status = 'dispatched';
    io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: 'dispatched' });
  }

  io.to('dispatchers').emit('call:assigned', { call_id: call.id, unit_id: req.body.unit_id });
  io.to(`crew:${req.body.unit_id}`).emit('call:assigned_to_me', call);
  res.json(call);
});

app.patch('/api/calls/:id/status', verifyToken, (req, res) => {
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });

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

  const payload = { call_id: call.id, status: call.status, timestamp: new Date().toISOString() };
  io.to('dispatchers').emit('call:status_change', payload);
  io.to(`crew:${call.assigned_unit_id}`).emit('call:updated', { call_id: call.id, changes: { status: call.status } });

  // Sync unit status
  if (call.assigned_unit_id) {
    const unit = units.find(u => u.id === call.assigned_unit_id);
    if (unit) {
      unit.status = req.body.status === 'closed' ? 'available' : req.body.status;
      io.to('dispatchers').emit('unit:status_change', { unit_id: unit.id, status: unit.status });
    }
  }
  res.json(call);
});

app.post('/api/calls/:id/comments', verifyToken, (req, res) => {
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Not found' });
  const comment = {
    id: `cmt-${Date.now()}`,
    text: req.body.text,
    author: req.body.author || (req.user.role === 'crew' ? req.user.unit_number : 'Dispatcher'),
    created_at: new Date().toISOString()
  };
  call.comments.push(comment);
  io.to('dispatchers').emit('call:comment_added', { call_id: call.id, comment });
  if (call.assigned_unit_id) {
    io.to(`crew:${call.assigned_unit_id}`).emit('call:comment_added', { call_id: call.id, comment });
  }
  res.json(comment);
});

app.post('/api/units', verifyToken, (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const { unit_number, unit_name, unit_type = 'ALS', trak4_device_id } = req.body;
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
    trak4_device_id: trak4_device_id || null,
    password_hash:   bcrypt.hashSync('ems2024', 8),
    profile:         null,
    crew:            null,
    station:         null
  };
  units.push(newUnit);
  const sanitized = { ...newUnit, password_hash: undefined };
  io.to('dispatchers').emit('unit:updated', sanitized);
  res.status(201).json(sanitized);
});

app.put('/api/units/:id', verifyToken, (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const unit = units.find(u => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: 'Not found' });

  const { unit_number, unit_name, unit_type, password, trak4_device_id } = req.body;
  if (unit_number !== undefined)    unit.unit_number      = unit_number;
  if (unit_name   !== undefined)    unit.unit_name        = unit_name;
  if (unit_type   !== undefined)    unit.unit_type        = unit_type;
  if ('trak4_device_id' in req.body) unit.trak4_device_id = trak4_device_id;
  if (password)                     unit.password_hash    = bcrypt.hashSync(password, 8);

  const sanitized = { ...unit, password_hash: undefined };
  io.to('dispatchers').emit('unit:updated', sanitized);
  res.json(sanitized);
});

app.delete('/api/units/:id', verifyToken, (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  const idx = units.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  units.splice(idx, 1);
  io.to('dispatchers').emit('unit:removed', { unit_id: req.params.id });
  res.json({ ok: true });
});

// ── Shift ─────────────────────────────────────────────────────────
let currentShift = null;

app.get('/api/shift/current', verifyToken, (req, res) => {
  res.json(currentShift);
});

app.post('/api/shift/start', verifyToken, (req, res) => {
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
  });

  const sanitizedUnits = units.map(u => ({ ...u, password_hash: undefined }));
  io.to('dispatchers').emit('shift:started', { shift: currentShift, units: sanitizedUnits });
  res.json({ shift: currentShift, units: sanitizedUnits });
});

app.post('/api/shift/end', verifyToken, (req, res) => {
  if (req.user.role !== 'dispatcher') return res.status(403).json({ error: 'Forbidden' });
  if (!currentShift || currentShift.ended_at)
    return res.status(404).json({ error: 'No active shift' });

  currentShift.ended_at = new Date().toISOString();
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

  io.to('dispatchers').emit('shift:ended', summary);
  res.json(summary);
});

app.patch('/api/shift/units/:unit_id', verifyToken, (req, res) => {
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
  }
  const sanitized = { ...unit, password_hash: undefined };
  io.to('dispatchers').emit('unit:updated', sanitized);
  res.json(sanitized);
});

// ── GPS webhook ───────────────────────────────────────────────────
app.post('/api/gps/webhook', (req, res) => {
  const body = req.body;

  // Log every incoming ping so we can verify the format on first use
  console.log('[gps] incoming ping:', JSON.stringify(body));

  // Normalise field names across common GPS tracker formats
  const device_id = body.device_id ?? body.serial_number ?? body.serial ?? body.imei ?? body.id ?? null;
  const lat       = parseFloat(body.lat ?? body.latitude  ?? body.Latitude  ?? 0);
  const lng       = parseFloat(body.lng ?? body.longitude ?? body.Longitude ?? body.lon ?? 0);
  const timestamp = body.timestamp ?? body.gps_time ?? body.time ?? new Date().toISOString();

  const unit = units.find(u => u.trak4_device_id && u.trak4_device_id === String(device_id));
  if (unit && lat && lng) {
    unit.last_lat    = lat;
    unit.last_lng    = lng;
    unit.last_gps_at = timestamp;
    io.to('dispatchers').emit('unit:gps_update', {
      unit_id: unit.id, unit_number: unit.unit_number, lat, lng, timestamp
    });
    console.log(`[gps] updated ${unit.unit_number} → ${lat}, ${lng}`);
  } else if (!unit) {
    console.log(`[gps] unknown device_id: ${device_id} — set this in Edit Unit → Trak-4 Device ID`);
  }

  res.json({ ok: true });
});

// ── Health ────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Socket.io ─────────────────────────────────────────────────────
io.use((socket, next) => {
  // Optionally verify JWT on connect (crew/dispatcher token in auth)
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
    socket.join('dispatchers');
    // Send current state to this dispatcher
    socket.emit('init:state', {
      units: units.map(u => ({ ...u, password_hash: undefined })),
      calls
    });
  });

  socket.on('join:crew', ({ unit_id }) => {
    socket.join(`crew:${unit_id}`);
    // Send crew their active call
    const myCall = calls.find(c => c.assigned_unit_id === unit_id && c.status !== 'closed');
    if (myCall) socket.emit('call:assigned_to_me', myCall);
  });

  // Crew taps a status button
  socket.on('crew:status_update', ({ unit_id, status }) => {
    const unit = units.find(u => u.id === unit_id);
    if (unit) {
      unit.status = status;
      io.to('dispatchers').emit('unit:status_change', { unit_id, status });
      // Also advance the active call
      const activeCall = calls.find(c => c.assigned_unit_id === unit_id && c.status !== 'closed');
      if (activeCall) {
        const TS_MAP = { en_route: 'en_route_at', on_scene: 'on_scene_at', patient_contact: 'patient_contact_at', cleared: 'cleared_at' };
        activeCall.status = status;
        if (TS_MAP[status] && !activeCall[TS_MAP[status]]) activeCall[TS_MAP[status]] = new Date().toISOString();
        io.to('dispatchers').emit('call:status_change', { call_id: activeCall.id, status, timestamp: new Date().toISOString() });
      }
    }
  });

  // Crew updates profile
  socket.on('crew:profile_update', ({ unit_id, profile }) => {
    const unit = units.find(u => u.id === unit_id);
    if (unit) {
      unit.profile = profile;
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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚑 EMS CAD Server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Default login — dispatchers: "dispatch" / "ems2024"`);
  console.log(`   Default login — crews: "EMS-1" through "EMS-5" / "ems2024"\n`);
});
