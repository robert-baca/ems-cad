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

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🚑</div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Six Flags EMS CAD</h1>
          <p className="text-gray-400 text-sm mt-1">Computer Aided Dispatch — Over Texas</p>
        </div>
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
      </div>
    </div>
  );
}
