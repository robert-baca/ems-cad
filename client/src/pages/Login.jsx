import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLES = [
  { key: 'dispatcher', label: 'Dispatcher', icon: '🎛️', description: 'Command & dispatch' },
  { key: 'crew',       label: 'Crew',       icon: '🚑', description: 'Unit / medic login' },
  { key: 'display',    label: 'Display Board', icon: '📺', description: 'Live map display' }
];

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();

  const [role,     setRole]    = useState(null); // null = role picker
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin,      setPin]     = useState('');
  const [error,    setError]   = useState('');
  const [loading,  setLoading] = useState(false);

  const back = () => { setRole(null); setError(''); setUsername(''); setPassword(''); setPin(''); };

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

  const handleCrewLogin = async (e) => {
    e.preventDefault();
    if (!username || !password) { setError('Enter your unit number and password.'); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role: 'crew' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      login({ ...data.user, token: data.token });
      navigate('/crew');
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

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🚑</div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Six Flags EMS CAD</h1>
          <p className="text-gray-400 text-sm mt-1">Computer Aided Dispatch — Over Texas</p>
        </div>

        {/* ── Role picker ── */}
        {!role && (
          <div className="space-y-3">
            {ROLES.map(r => (
              <button
                key={r.key}
                onClick={() => setRole(r.key)}
                className="w-full flex items-center gap-4 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-500 rounded-2xl px-5 py-4 transition-all text-left group"
              >
                <span className="text-3xl">{r.icon}</span>
                <div>
                  <div className="text-white font-bold text-base group-hover:text-blue-300 transition-colors">
                    {r.label}
                  </div>
                  <div className="text-gray-500 text-sm">{r.description}</div>
                </div>
                <span className="ml-auto text-gray-600 group-hover:text-gray-400 text-lg">›</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Dispatcher login ── */}
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

        {/* ── Crew login ── */}
        {role === 'crew' && (
          <form onSubmit={handleCrewLogin} className="bg-gray-800 rounded-2xl p-6 space-y-4 border border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🚑</span>
              <div>
                <div className="text-white font-bold">Crew Login</div>
                <div className="text-gray-500 text-xs">Unit / medic access</div>
              </div>
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">Unit Number</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="e.g. Medic 1" autoFocus
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500" />
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500" />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-3 bg-green-700 hover:bg-green-600 disabled:bg-green-900 text-white font-semibold rounded-lg transition-colors">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
            <button type="button" onClick={back}
              className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
              ← Back
            </button>
          </form>
        )}

        {/* ── Display board PIN ── */}
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
              <input
                type="password" inputMode="numeric" maxLength={8}
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
