import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiBase } from '../lib/native';

const UNIT_TYPES = ['ALS', 'BLS', 'Cart'];
const TYPE_COLORS = { ALS: 'text-red-400', BLS: 'text-blue-400', Cart: 'text-green-400' };

// Handles the /sso?token=xxx&dest=dispatcher|crew|display route.
// sfotems.com passes the session token here so users land directly
// into the right CAD view without a second login.
export default function SSOLanding() {
  const navigate       = useNavigate();
  const [params]       = useSearchParams();
  const { login }      = useAuth();

  const token = params.get('token');
  const dest  = params.get('dest');

  const [step,         setStep]         = useState('verifying'); // verifying | pick | add | error
  const [errorMsg,     setErrorMsg]     = useState('');
  const [preAuthToken, setPreAuthToken] = useState('');
  const [crewName,     setCrewName]     = useState('');
  const [shiftUnits,   setShiftUnits]   = useState([]);
  const [selected,     setSelected]     = useState(null);
  const [newNumber,    setNewNumber]    = useState('');
  const [newType,      setNewType]      = useState('ALS');
  const [loading,      setLoading]      = useState(false);
  const [unitError,    setUnitError]    = useState('');

  useEffect(() => {
    if (!token || !dest) { setErrorMsg('Missing token or destination.'); setStep('error'); return; }

    if (dest === 'display') {
      navigate('/display', { replace: true });
      return;
    }

    const verify = async () => {
      try {
        const r    = await fetch(`${apiBase()}/auth/sso`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ token, dest }),
        });
        const data = await r.json();
        if (!r.ok) { setErrorMsg(data.error || 'Sign-in failed.'); setStep('error'); return; }

        if (dest === 'dispatcher') {
          login({ ...data.user, token: data.token });
          navigate('/dispatcher', { replace: true });
          return;
        }

        if (dest === 'crew') {
          // Pre-auth token received; now show the unit picker
          setPreAuthToken(data.token);
          setCrewName(data.user.name || '');
          const ur = await fetch(`${apiBase()}/shift/units`);
          const units = await ur.json();
          setShiftUnits(Array.isArray(units) ? units : []);
          setStep('pick');
        }
      } catch (err) {
        setErrorMsg('Could not connect — please try again.');
        setStep('error');
      }
    };
    verify();
  }, []);

  const confirmUnit = async (unit) => {
    setLoading(true); setUnitError('');
    try {
      const r    = await fetch(`${apiBase()}/crew/select-unit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${preAuthToken}` },
        body:    JSON.stringify({ unit_id: unit.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to select unit');
      login({ ...data.user, token: data.token });
      navigate('/crew', { replace: true });
    } catch (err) { setUnitError(err.message); }
    finally { setLoading(false); }
  };

  const handleAddUnit = async (e) => {
    e.preventDefault();
    if (!newNumber.trim()) { setUnitError('Enter a unit number.'); return; }
    setLoading(true); setUnitError('');
    try {
      const r    = await fetch(`${apiBase()}/crew/add-unit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${preAuthToken}` },
        body:    JSON.stringify({ unit_number: newNumber.trim(), unit_type: newType }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed');
      login({ ...data.user, token: data.token });
      navigate('/crew', { replace: true });
    } catch (err) { setUnitError(err.message); }
    finally { setLoading(false); }
  };

  // ── Verifying spinner ──
  if (step === 'verifying') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">🚑</div>
          <p className="text-gray-400 text-sm">Signing you in…</p>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-gray-800 rounded-2xl p-6 border border-gray-700 text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <p className="text-white font-bold">Sign-in failed</p>
          <p className="text-gray-400 text-sm">{errorMsg}</p>
          <a href="https://sfotems.com" className="block w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors text-sm">
            ← Back to sfotems.com
          </a>
        </div>
      </div>
    );
  }

  // ── Unit picker (crew SSO) ──
  if (step === 'pick') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">🚑</div>
            <h1 className="text-2xl font-bold text-white">Six Flags EMS CAD</h1>
            {crewName && <p className="text-gray-400 text-sm mt-1">Signed in as {crewName}</p>}
          </div>

          <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700">
              <div className="text-white font-bold">Select Your Unit</div>
              <div className="text-gray-500 text-xs mt-0.5">
                {shiftUnits.length > 0 ? "Tap the unit you've been assigned" : 'No units on shift yet'}
              </div>
            </div>

            {unitError && <p className="text-red-400 text-xs text-center py-2 px-4">{unitError}</p>}

            <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
              {shiftUnits.map(u => (
                <button key={u.id} onClick={() => confirmUnit(u)} disabled={loading}
                  className="w-full flex items-center gap-3 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 rounded-xl px-4 py-3 text-left transition-all group disabled:opacity-50">
                  <div className="flex-1">
                    <div className="text-white font-bold text-sm group-hover:text-green-300 transition-colors">{u.unit_number}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs font-bold ${TYPE_COLORS[u.unit_type] || 'text-gray-400'}`}>{u.unit_type}</span>
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

            <div className="px-3 pb-3 border-t border-gray-700 pt-3">
              <button onClick={() => { setStep('add'); setUnitError(''); setNewNumber(''); }}
                className="w-full py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 hover:text-white text-sm font-medium transition-colors">
                + My unit isn&apos;t listed
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Add unit ──
  if (step === 'add') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <form onSubmit={handleAddUnit} className="bg-gray-800 rounded-2xl p-6 space-y-4 border border-gray-700">
            <button type="button" onClick={() => { setStep('pick'); setUnitError(''); }}
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
            {unitError && <p className="text-red-400 text-sm">{unitError}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-3 bg-green-700 hover:bg-green-600 disabled:bg-green-900 text-white font-semibold rounded-lg transition-colors">
              {loading ? 'Adding…' : 'Add Unit & Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  }
}
