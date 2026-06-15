import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLES = [
  { key: 'dispatcher', label: 'Dispatcher',    icon: '🎛️', description: 'Command & dispatch'      },
  { key: 'crew',       label: 'Crew',           icon: '🚑', description: 'Unit / medic login'       },
  { key: 'overwatch',  label: 'Overwatch',      icon: '👁️', description: 'Read-only observer view' },
  { key: 'display',    label: 'Display Board',  icon: '📺', description: 'Live map display'         }
];

const UNIT_TYPES = ['ALS', 'BLS', 'Cart'];
const TYPE_COLORS = { ALS: 'text-red-400', BLS: 'text-blue-400', Cart: 'text-green-400' };

// ── Crew login sub-flow ───────────────────────────────────────────
function CrewLogin({ onBack, onSuccess }) {
  // step: pin → pick → confirm | add
  const [step,       setStep]      = useState('pin');
  const [pin,        setPin]       = useState('');
  const [shiftUnits, setShiftUnits] = useState([]);
  const [selected,   setSelected]  = useState(null);
  const [newNumber,  setNewNumber] = useState('');
  const [newType,    setNewType]   = useState('ALS');
  const [error,      setError]     = useState('');
  const [loading,    setLoading]   = useState(false);

  const handlePinSubmit = async (e) => {
    e.preventDefault();
    if (!pin) { setError('Enter your PIN.'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/crew/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Invalid PIN'); }
      const units = await fetch('/api/shift/units').then(r => r.json()).catch(() => []);
      setShiftUnits(Array.isArray(units) ? units : []);
      setStep('pick');
    } catch (err) { setError(err.message); setPin(''); }
    finally { setLoading(false); }
  };

  const pickUnit = (unit) => {
    setSelected(unit);
    setError('');
    setStep('confirm');
  };

  const confirmUnit = async () => {
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/crew/select-unit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, unit_id: selected.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      onSuccess({ ...data.user, token: data.token }, '/crew');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleAddUnit = async (e) => {
    e.preventDefault();
    if (!newNumber.trim()) { setError('Enter a unit number.'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/crew/add-unit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_number: newNumber.trim(), unit_type: newType, pin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      onSuccess({ ...data.user, token: data.token }, '/crew');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  // ── PIN entry ──
  if (step === 'pin') {
    return (
      <form onSubmit={handlePinSubmit} className="bg-gray-800 rounded-2xl p-6 space-y-4 border border-gray-700">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">🚑</span>
          <div>
            <div className="text-white font-bold">Crew Access</div>
            <div className="text-gray-500 text-xs">Enter your crew PIN to continue</div>
          </div>
        </div>
        <div>
          <label className="block text-gray-400 text-sm mb-1">PIN</label>
          <input
            type="password" inputMode="numeric" maxLength={8}
            value={pin} onChange={e => setPin(e.target.value)}
            placeholder="••••" autoFocus
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500 text-center text-xl tracking-widest" />
        </div>
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full py-3 bg-green-700 hover:bg-green-600 disabled:bg-green-900 text-white font-semibold rounded-lg transition-colors">
          {loading ? 'Checking…' : 'Continue'}
        </button>
        <button type="button" onClick={onBack}
          className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
          ← Back
        </button>
      </form>
    );
  }

  // ── Unit picker ──
  if (step === 'pick') {
    return (
      <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-3">
          <span className="text-2xl">🚑</span>
          <div>
            <div className="text-white font-bold">Select Your Unit</div>
            <div className="text-gray-500 text-xs">
              {shiftUnits.length > 0 ? "Tap the unit you've been assigned" : 'No units on shift yet'}
            </div>
          </div>
        </div>

        {error && <p className="text-red-400 text-xs text-center py-2">{error}</p>}

        <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
          {shiftUnits.map(u => (
            <button key={u.id} onClick={() => pickUnit(u)} disabled={loading}
              className="w-full flex items-center gap-3 bg-gray-750 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 rounded-xl px-4 py-3 text-left transition-all group disabled:opacity-50">
              <div className="flex-1">
                <div className="text-white font-bold text-sm group-hover:text-green-300 transition-colors">
                  {u.unit_number}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs font-bold ${TYPE_COLORS[u.unit_type] || 'text-gray-400'}`}>
                    {u.unit_type}
                  </span>
                  {u.crew    && <span className="text-gray-400 text-xs">· {u.crew}</span>}
                  {u.station && <span className="text-gray-500 text-xs">· {u.station}</span>}
                </div>
              </div>
              <span className="text-gray-600 group-hover:text-gray-400 text-lg">›</span>
            </button>
          ))}
          {shiftUnits.length === 0 && (
            <div className="text-center py-4 text-gray-500 text-sm">No units listed for this shift.</div>
          )}
        </div>

        <div className="px-3 pb-3 border-t border-gray-700 pt-3 space-y-2">
          <button onClick={() => { setStep('add'); setError(''); setNewNumber(''); }}
            className="w-full py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 hover:text-white text-sm font-medium transition-colors">
            + My unit isn't listed
          </button>
          <button onClick={onBack}
            className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
            ← Back
          </button>
        </div>
      </div>
    );
  }

  // ── Confirm selected unit ──
  if (step === 'confirm') {
    const TYPE_BG = { ALS: 'bg-red-900/40 border-red-700 text-red-300', BLS: 'bg-blue-900/40 border-blue-700 text-blue-300', Cart: 'bg-green-900/40 border-green-700 text-green-300' };
    return (
      <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700">
          <div className="text-white font-bold">Is this you?</div>
          <div className="text-gray-500 text-xs mt-0.5">Confirm the unit dispatch assigned you</div>
        </div>

        <div className="p-5 space-y-4">
          {/* Unit card */}
          <div className="rounded-xl border border-gray-600 bg-gray-750 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-white font-bold text-2xl">{selected.unit_number}</div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${TYPE_BG[selected.unit_type] || 'bg-gray-700 border-gray-600 text-gray-300'}`}>
                {selected.unit_type}
              </span>
            </div>
            {selected.crew && (
              <div>
                <div className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">Assigned Medic</div>
                <div className="text-white font-semibold text-lg">{selected.crew}</div>
              </div>
            )}
            {selected.station && (
              <div>
                <div className="text-gray-500 text-xs uppercase tracking-wider mb-0.5">Based out of</div>
                <div className="text-gray-300 text-sm">{selected.station}</div>
              </div>
            )}
            {!selected.crew && (
              <div className="text-gray-500 text-sm italic">No medic name set by dispatch</div>
            )}
          </div>

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <button onClick={confirmUnit} disabled={loading}
            className="w-full py-3.5 bg-green-700 hover:bg-green-600 disabled:bg-green-900 text-white font-bold text-base rounded-xl transition-colors">
            {loading ? 'Signing in…' : "Yes, that's me — Sign In"}
          </button>
          <button onClick={() => { setStep('pick'); setError(''); }} disabled={loading}
            className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-xl transition-colors">
            Not me — go back
          </button>
        </div>
      </div>
    );
  }

  // ── Add unit ──
  if (step === 'add') {
    return (
      <form onSubmit={handleAddUnit} className="bg-gray-800 rounded-2xl p-6 space-y-4 border border-gray-700">
        <button type="button" onClick={() => { setStep('pick'); setError(''); }}
          className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
          ← Back to units
        </button>
        <div>
          <div className="text-white font-bold mb-0.5">Add Your Unit</div>
          <div className="text-gray-500 text-xs">Enter the unit number dispatch assigned you</div>
        </div>
        <div>
          <label className="block text-gray-400 text-sm mb-1">Unit Number</label>
          <input type="text" value={newNumber} onChange={e => setNewNumber(e.target.value)}
            placeholder="e.g. Medic 3, Cart 2" autoFocus
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500" />
        </div>
        <div>
          <label className="block text-gray-400 text-sm mb-1">Unit Type</label>
          <div className="flex gap-2">
            {UNIT_TYPES.map(t => (
              <button key={t} type="button" onClick={() => setNewType(t)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors
                  ${newType === t
                    ? (t === 'ALS' ? 'bg-red-600 text-white' : t === 'BLS' ? 'bg-blue-600 text-white' : 'bg-green-700 text-white')
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full py-3 bg-green-700 hover:bg-green-600 disabled:bg-green-900 text-white font-semibold rounded-lg transition-colors">
          {loading ? 'Adding…' : 'Add Unit & Sign In'}
        </button>
        <button type="button" onClick={onBack}
          className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
          ← Back
        </button>
      </form>
    );
  }
}

// ── Main login page ───────────────────────────────────────────────
export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();

  const [role,     setRole]    = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin,      setPin]     = useState('');
  const [error,    setError]   = useState('');
  const [loading,  setLoading] = useState(false);

  const back = () => { setRole(null); setError(''); setUsername(''); setPassword(''); setPin(''); };

  const handleCrewSuccess = (userData, path) => {
    login(userData);
    navigate(path);
  };

  const handleDispatcherLogin = async (e) => {
    e.preventDefault();
    if (!username || !password) { setError('Enter your username and password.'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role: 'dispatcher' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      login({ ...data.user, token: data.token });
      navigate('/dispatcher');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleOverwatchLogin = async (e) => {
    e.preventDefault();
    if (!username || !password) { setError('Enter username and password.'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role: 'overwatch' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      login({ ...data.user, token: data.token });
      navigate('/dispatcher');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleDisplayLogin = async (e) => {
    e.preventDefault();
    if (!pin) { setError('Enter PIN.'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/display/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid PIN');
      sessionStorage.setItem('display_token', data.token);
      navigate('/display');
    } catch (err) { setError(err.message); setPin(''); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🚑</div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Six Flags EMS CAD</h1>
          <p className="text-gray-400 text-sm mt-1">Computer Aided Dispatch — Over Texas</p>
        </div>

        {/* ── Role picker ── */}
        {!role && (
          <div className="space-y-3">
            {ROLES.map(r => (
              <button key={r.key} onClick={() => setRole(r.key)}
                className="w-full flex items-center gap-4 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-500 rounded-2xl px-5 py-4 transition-all text-left group">
                <span className="text-3xl">{r.icon}</span>
                <div>
                  <div className="text-white font-bold text-base group-hover:text-blue-300 transition-colors">{r.label}</div>
                  <div className="text-gray-500 text-sm">{r.description}</div>
                </div>
                <span className="ml-auto text-gray-600 group-hover:text-gray-400 text-lg">›</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Crew ── */}
        {role === 'crew' && (
          <CrewLogin onBack={back} onSuccess={handleCrewSuccess} />
        )}

        {/* ── Dispatcher ── */}
        {role === 'dispatcher' && (
          <form onSubmit={handleDispatcherLogin} className="bg-gray-800 rounded-2xl p-6 space-y-4 border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🎛️</span>
              <div>
                <div className="text-white font-bold">Dispatcher Login</div>
                <div className="text-gray-500 text-xs">Command & dispatch access</div>
              </div>
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="dispatch" autoFocus
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500" />
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500" />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-semibold rounded-lg transition-colors">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
            <button type="button" onClick={back}
              className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
              ← Back
            </button>
          </form>
        )}

        {/* ── Overwatch ── */}
        {role === 'overwatch' && (
          <form onSubmit={handleOverwatchLogin} className="bg-gray-800 rounded-2xl p-6 space-y-4 border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">👁️</span>
              <div>
                <div className="text-white font-bold">Overwatch Login</div>
                <div className="text-gray-500 text-xs">Read-only observer — view only, no controls</div>
              </div>
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="overwatch" autoFocus
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-purple-500 placeholder-gray-500" />
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-purple-500 placeholder-gray-500" />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-3 bg-purple-700 hover:bg-purple-600 disabled:bg-purple-900 text-white font-semibold rounded-lg transition-colors">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
            <button type="button" onClick={back}
              className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
              ← Back
            </button>
          </form>
        )}

        {/* ── Display board ── */}
        {role === 'display' && (
          <form onSubmit={handleDisplayLogin} className="bg-gray-800 rounded-2xl p-6 space-y-4 border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">📺</span>
              <div>
                <div className="text-white font-bold">Display Board</div>
                <div className="text-gray-500 text-xs">Live map display — PIN required</div>
              </div>
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">PIN</label>
              <input type="password" inputMode="numeric" maxLength={8}
                value={pin} onChange={e => setPin(e.target.value)}
                placeholder="••••" autoFocus
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500 text-center text-xl tracking-widest" />
            </div>
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white font-semibold rounded-lg transition-colors">
              {loading ? 'Checking…' : 'Open Display'}
            </button>
            <button type="button" onClick={back}
              className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
              ← Back
            </button>
          </form>
        )}

      </div>
    </div>
  );
}
