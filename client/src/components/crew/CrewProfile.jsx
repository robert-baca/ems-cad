import { useState } from 'react';

const CERT_LEVELS = ['First Responder', 'EMT-B', 'AEMT', 'Paramedic'];
const EXTRA_CERTS = ['ACLS', 'BLS', 'PALS', 'ITLS', 'PHTLS', 'CPR-I', 'Basic VOP', 'Advanced VOP', 'Restricted/Danger Zone', 'LOTO'];

export default function CrewProfile({ unit, currentProfile, token, onSave, onClose }) {
  const [name, setName] = useState(currentProfile?.name || '');
  const [certLevel, setCertLevel] = useState(currentProfile?.cert_level || '');
  const [certs, setCerts] = useState(currentProfile?.certifications || []);
  const [employeeId, setEmployeeId] = useState(currentProfile?.employee_id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleCert = (cert) => {
    setCerts(prev => prev.includes(cert) ? prev.filter(c => c !== cert) : [...prev, cert]);
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!certLevel) { setError('Select your certification level.'); return; }
    setSaving(true);
    setError('');
    try {
      const profile = {
        name: name.trim(),
        cert_level: certLevel,
        certifications: certs,
        employee_id: employeeId.trim()
      };
      const res = await fetch(`/api/units/${unit.unit_id}/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(profile)
      });
      if (!res.ok) throw new Error('Failed to save profile');
      onSave(profile);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl w-full max-w-sm shadow-2xl border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div>
            <div className="text-white font-bold text-base">Crew Profile</div>
            <div className="text-gray-400 text-xs">{unit?.unit_number} — {unit?.unit_name}</div>
          </div>
          {onClose && (
            <button onClick={onClose}
              className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
              ×
            </button>
          )}
        </div>

        <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
          {/* Name */}
          <div>
            <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">Full Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="J. Rodriguez"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
              autoFocus
            />
          </div>

          {/* Employee ID */}
          <div>
            <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">Employee ID</label>
            <input
              type="text"
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              placeholder="SF-12345"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            />
          </div>

          {/* Cert level */}
          <div>
            <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">Certification Level *</label>
            <div className="grid grid-cols-2 gap-2">
              {CERT_LEVELS.map(level => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setCertLevel(level)}
                  className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors text-left
                    ${certLevel === level
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Extra certifications */}
          <div>
            <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">Additional Certifications</label>
            <div className="flex flex-wrap gap-2">
              {EXTRA_CERTS.map(cert => (
                <button
                  key={cert}
                  type="button"
                  onClick={() => toggleCert(cert)}
                  className={`py-1 px-2.5 rounded-full text-xs font-bold transition-colors
                    ${certs.includes(cert)
                      ? 'bg-green-700 text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
                >
                  {cert}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-700 flex gap-3">
          {onClose && (
            <button onClick={onClose}
              className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-semibold text-sm rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  );
}
