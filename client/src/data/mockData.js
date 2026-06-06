export const STATUS_COLORS = {
  pending:         '#6366f1',
  available:       '#22c55e',
  dispatched:      '#eab308',
  acknowledged:    '#a78bfa',
  en_route:        '#3b82f6',
  on_scene:        '#f97316',
  patient_contact: '#ef4444',
  transporting:    '#f472b6',
  cleared:         '#9ca3af',
  out_of_service:  '#6b7280'
};

export const STATUS_LABELS = {
  pending:         'Pending',
  available:       'Available',
  dispatched:      'Dispatched',
  acknowledged:    'Acknowledged',
  en_route:        'En Route',
  on_scene:        'On Scene',
  patient_contact: 'Patient Contact',
  transporting:    'Transporting',
  cleared:         'Cleared',
  out_of_service:  'Out of Service'
};

export const STATUS_SEQUENCE = [
  'dispatched', 'en_route', 'on_scene', 'patient_contact', 'cleared', 'available'
];

export const CALL_TYPES = [
  'Cardiac Arrest', 'Chest Pain', 'Difficulty Breathing', 'Trauma / Injury',
  'Altered Mental Status', 'Allergic Reaction / Anaphylaxis', 'Seizure',
  'Syncope / Fainting', 'Heat Emergency', 'Diabetic Emergency',
  'Pediatric Emergency', 'Behavioral / Psychiatric', 'Assist Guest (non-medical)',
  'First Aid (minor)', 'MCI (Mass Casualty Incident)', 'Standby', 'Lift Assist', 'Other'
];

const ago  = (min) => new Date(Date.now() - min * 60000).toISOString();
const hago = (h, extraMin = 0) => ago(h * 60 + extraMin);

export const MOCK_UNITS = [
  { id: 'u1', unit_number: 'EMS-1', unit_name: 'Medic 1', unit_type: 'ALS', status: 'available',       last_lat: 32.7538, last_lng: -97.0688 },
  { id: 'u2', unit_number: 'EMS-2', unit_name: 'Medic 2', unit_type: 'BLS', status: 'en_route',        last_lat: 32.7555, last_lng: -97.0638 },
  { id: 'u3', unit_number: 'EMS-3', unit_name: 'Medic 3', unit_type: 'ALS', status: 'on_scene',        last_lat: 32.7562, last_lng: -97.0622 },
  { id: 'u4', unit_number: 'EMS-4', unit_name: 'Bike A',  unit_type: 'Bike', status: 'dispatched',     last_lat: 32.7549, last_lng: -97.0658 },
  { id: 'u5', unit_number: 'EMS-5', unit_name: 'Cart 1',  unit_type: 'Cart', status: 'out_of_service', last_lat: 32.7543, last_lng: -97.0672 }
];

export const MOCK_ALL_CALLS = [
  {
    id: 'c1', call_number: 42, status: 'on_scene',
    location_lat: 32.7562, location_lng: -97.0622,
    location_name: 'Near Superman: Tower of Power', park_zone: 'Zone B',
    call_type: 'Cardiac Arrest', chief_complaint: 'Unresponsive male, approximately 50s',
    priority: 1, assigned_unit_id: 'u3',
    received_at: ago(8), dispatched_at: ago(7.5), acknowledged_at: ago(7),
    en_route_at: ago(6.5), on_scene_at: ago(3),
    patient_contact_at: null, cleared_at: null, available_at: null,
    comments: [
      { id: 'cm1', text: 'AED deployed on scene. 3 rounds CPR in progress.', author: 'Dispatcher', created_at: ago(2.5) },
      { id: 'cm2', text: 'ACLS protocol initiated. Requesting ALS backup.', author: 'EMS-3', created_at: ago(1.5) }
    ]
  },
  {
    id: 'c2', call_number: 43, status: 'en_route',
    location_lat: 32.7535, location_lng: -97.0690,
    location_name: 'Main Entrance — Front Gate', park_zone: 'Zone A',
    call_type: 'Trauma / Injury', chief_complaint: 'Guest fell near ride exit, possible ankle fracture',
    priority: 2, assigned_unit_id: 'u2',
    received_at: ago(4), dispatched_at: ago(3.5), acknowledged_at: ago(3),
    en_route_at: ago(2.5), on_scene_at: null,
    patient_contact_at: null, cleared_at: null, available_at: null,
    comments: []
  },
  // Pending — no unit assigned yet
  {
    id: 'c3', call_number: 44, status: 'pending',
    location_lat: 32.7550, location_lng: -97.0645,
    location_name: 'Zone C — Texas Giant queue', park_zone: 'Zone C',
    call_type: 'Seizure', chief_complaint: 'Guest having active seizure in ride queue',
    priority: 1, assigned_unit_id: null,
    received_at: ago(1), dispatched_at: null, acknowledged_at: null,
    en_route_at: null, on_scene_at: null, patient_contact_at: null,
    cleared_at: null, available_at: null,
    comments: []
  },
  // Historical / closed
  {
    id: 'h1', call_number: 41, status: 'closed',
    location_lat: 32.7558, location_lng: -97.0633,
    location_name: 'Ride exit — Texas SlingShot', park_zone: 'Zone C',
    call_type: 'Chest Pain', chief_complaint: '62yo male, substernal chest pressure, diaphoretic',
    priority: 1, assigned_unit_id: 'u2',
    received_at: hago(1, 5), dispatched_at: hago(1, 4), acknowledged_at: hago(1, 3.5),
    en_route_at: hago(1, 3), on_scene_at: hago(1), patient_contact_at: hago(0, 58),
    cleared_at: hago(0, 30), available_at: hago(0, 28),
    comments: [{ id: 'cm3', text: '12-lead shows ST elevation. Cath lab notified.', author: 'EMS-2', created_at: hago(0, 45) }]
  },
  {
    id: 'h2', call_number: 40, status: 'closed',
    location_lat: 32.7544, location_lng: -97.0662,
    location_name: 'Zone B food court area', park_zone: 'Zone B',
    call_type: 'Heat Emergency', chief_complaint: 'Guest collapsed, hot/dry skin, confused',
    priority: 2, assigned_unit_id: 'u1',
    received_at: hago(2, 30), dispatched_at: hago(2, 29), acknowledged_at: hago(2, 28),
    en_route_at: hago(2, 27), on_scene_at: hago(2, 23), patient_contact_at: hago(2, 22),
    cleared_at: hago(2), available_at: hago(1, 58),
    comments: [{ id: 'cm4', text: 'Active cooling initiated. IV access x2.', author: 'EMS-1', created_at: hago(2, 10) }]
  },
  {
    id: 'h3', call_number: 39, status: 'closed',
    location_lat: 32.7571, location_lng: -97.0618,
    location_name: 'Zone D waterpark entrance', park_zone: 'Zone D',
    call_type: 'Syncope / Fainting', chief_complaint: 'Teenage female, syncopal episode in line',
    priority: 2, assigned_unit_id: 'u4',
    received_at: hago(3, 45), dispatched_at: hago(3, 44), acknowledged_at: hago(3, 43),
    en_route_at: hago(3, 42), on_scene_at: hago(3, 37), patient_contact_at: hago(3, 36),
    cleared_at: hago(3, 15), available_at: hago(3, 14), comments: []
  },
  {
    id: 'h4', call_number: 38, status: 'closed',
    location_lat: 32.7540, location_lng: -97.0678,
    location_name: 'Zone A — parking lot G', park_zone: 'Zone A',
    call_type: 'Trauma / Injury', chief_complaint: 'Guest slipped, laceration to forehead',
    priority: 3, assigned_unit_id: 'u5',
    received_at: hago(5), dispatched_at: hago(4, 59), acknowledged_at: hago(4, 58),
    en_route_at: hago(4, 57), on_scene_at: hago(4, 52), patient_contact_at: hago(4, 51),
    cleared_at: hago(4, 35), available_at: hago(4, 33),
    comments: [{ id: 'cm5', text: 'Wound closure strips applied. Refused transport.', author: 'EMS-5', created_at: hago(4, 40) }]
  },
  {
    id: 'h5', call_number: 37, status: 'closed',
    location_lat: 32.7560, location_lng: -97.0648,
    location_name: 'Ride queue — Superman area', park_zone: 'Zone B',
    call_type: 'First Aid (minor)', chief_complaint: 'Blister and sunburn treatment',
    priority: 3, assigned_unit_id: 'u1',
    received_at: hago(6, 20), dispatched_at: hago(6, 19), acknowledged_at: hago(6, 18),
    en_route_at: hago(6, 18), on_scene_at: hago(6, 14), patient_contact_at: hago(6, 13),
    cleared_at: hago(6), available_at: hago(5, 58), comments: []
  },
  {
    id: 'h6', call_number: 36, status: 'closed',
    location_lat: 32.7547, location_lng: -97.0655,
    location_name: 'Zone C — Texas Giant queue', park_zone: 'Zone C',
    call_type: 'Allergic Reaction / Anaphylaxis', chief_complaint: 'Guest stung by bee, known allergy',
    priority: 1, assigned_unit_id: 'u3',
    received_at: hago(7, 10), dispatched_at: hago(7, 9), acknowledged_at: hago(7, 8),
    en_route_at: hago(7, 7), on_scene_at: hago(7, 3), patient_contact_at: hago(7, 2),
    cleared_at: hago(6, 35), available_at: hago(6, 33),
    comments: [{ id: 'cm6', text: 'Epi-pen used prior to arrival. Secondary dose administered.', author: 'EMS-3', created_at: hago(6, 50) }]
  },
  {
    id: 'h7', call_number: 35, status: 'closed',
    location_lat: 32.7535, location_lng: -97.0682,
    location_name: 'Zone A — main entrance plaza', park_zone: 'Zone A',
    call_type: 'Lift Assist', chief_complaint: 'Elderly guest fell from scooter, no injury',
    priority: 3, assigned_unit_id: 'u4',
    received_at: hago(8), dispatched_at: hago(7, 59), acknowledged_at: hago(7, 58),
    en_route_at: hago(7, 57), on_scene_at: hago(7, 53), patient_contact_at: hago(7, 52),
    cleared_at: hago(7, 40), available_at: hago(7, 39), comments: []
  }
];

export const MOCK_CALLS = MOCK_ALL_CALLS.filter(c => c.status !== 'closed');

// Default saved map locations (first-run seed — user can add/remove their own)
export const DEFAULT_LOCATIONS = [
  { id: 'dl1', name: 'First Aid Station A', lat: 32.7540, lng: -97.0683, color: '#ef4444' },
  { id: 'dl2', name: 'First Aid Station B', lat: 32.7563, lng: -97.0628, color: '#ef4444' },
  { id: 'dl3', name: 'AED — Main Gate',     lat: 32.7534, lng: -97.0690, color: '#22c55e' },
  { id: 'dl4', name: 'Security Post 1',     lat: 32.7558, lng: -97.0650, color: '#3b82f6' },
];
