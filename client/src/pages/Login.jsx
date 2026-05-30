import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login }  = useAuth();
  const navigate   = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const [showPin,  setShowPin]  = useState(false);
  const [pin,      setPin]      = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username || !password) { setError('Enter credentials to continue.'); return; }
    setLoading(true);
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password, role: 'dispatcher' })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      login({ ...data.user, token: data.token });
      navigate('/dispatcher');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = async (e) => {
    e.preventDefault();
    setPinError('');
    if (!pin) { setPinError('Enter PIN.'); return; }
    setPinLoading(true);
    try {
      const res  = await fetch('/api/display/auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pin })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid PIN');
      sessionStorage.setItem('display_token', data.token);
      navigate('/display');
    } catch (err) {
      setPinError(err.message);
      setPin('');
    } finally {
      setPinLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🚑</div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Six Flags EMS CAD</h1>
          <p className="text-gray-400 text-sm mt-1">Computer Aided Dispatch — Over Texas</p>
        </div>

        {!showPin ? (
          <>
            <form onSubmit={handleSubmit} className="bg-gray-800 rounded-2xl p-6 space-y-4">
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
            </form>

            <button
              onClick={() => { setShowPin(true); setPin(''); setPinError(''); }}
              className="mt-4 w-full py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white text-sm font-medium rounded-2xl transition-colors"
            >
              📺 Display Board
            </button>
          </>
        ) : (
          <form onSubmit={handlePinSubmit} className="bg-gray-800 rounded-2xl p-6 space-y-4">
            <div className="text-center mb-2">
              <div className="text-2xl mb-1">📺</div>
              <div className="text-white font-semibold">Display Board Access</div>
              <div className="text-gray-500 text-xs mt-1">Enter PIN to open the live map display</div>
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={e => setPin(e.target.value)}
                placeholder="••••"
                autoFocus
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500 text-center text-xl tracking-widest"
              />
            </div>
            {pinError && <p className="text-red-400 text-sm text-center">{pinError}</p>}
            <button type="submit" disabled={pinLoading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white font-semibold rounded-lg transition-colors">
              {pinLoading ? 'Checking…' : 'Open Display'}
            </button>
            <button type="button" onClick={() => setShowPin(false)}
              className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm transition-colors">
              ← Back to login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
