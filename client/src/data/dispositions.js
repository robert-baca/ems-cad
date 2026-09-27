// Every way a call can be closed out -- shared by the dispatcher's Close
// Case window and the crew app, so both offer the same choices. `transport`
// groups them in the crew app's close-out sheet.
export const DISPOSITIONS = [
  { id: 'transported_station7', label: 'Transported to Station 7',      icon: '🏥', transport: true },
  { id: 'handover_ems',         label: 'Hand over to EMS Transport',    icon: '🚑', transport: true },
  { id: 'transferred',          label: 'Transferred to Other Agency',   icon: '🔄', transport: true },
  { id: 'treated_refused',      label: 'Treated / Refused Transport',   icon: '🩺' },
  { id: 'refused_care',         label: 'Patient Refused Care',          icon: '🚫' },
  { id: 'no_patient',           label: 'No Patient Found (UTL)',        icon: '🔍' },
  { id: 'cancelled',            label: 'Cancelled / False Alarm',       icon: '❌' },
  { id: 'standby',              label: 'Standby / No Treatment Needed', icon: '✅' },
  { id: 'doa',                  label: 'Patient DOA',                   icon: '🕯️' },
];
