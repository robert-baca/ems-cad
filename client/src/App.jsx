import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import SSOLanding from './pages/SSOLanding';
import DispatcherDashboard from './pages/DispatcherDashboard';
import WayfindingAdmin from './pages/WayfindingAdmin';
import DisplayBoard from './pages/DisplayBoard';
import CrewMobile from './pages/CrewMobile';

// `allow` restricts the route to specific roles — without it, any logged-in
// session could land on e.g. /dispatcher with the wrong role (say, a crew
// session on a shared device) and render the full dashboard while every
// dispatcher-only request silently 403s server-side.
function ProtectedRoute({ children, allow }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (allow && !allow.includes(user.role)) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  // This app is dark-themed throughout (login, dispatcher, crew, display,
  // wayfinding) -- one call at the root covers every screen, no per-page logic.
  useEffect(() => {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    // Purely cosmetic -- must never surface an error or block anything else.
    // A retry-once covers a native-bridge-not-ready-yet race right after a
    // fresh page load (this app is reached via allowNavigation from the
    // portal rather than being the configured server.url origin, so its
    // plugin bridge may finish wiring up a beat later than the portal's own).
    const apply = () =>
      import('@capacitor/status-bar').then(({ StatusBar, Style }) =>
        Promise.all([
          StatusBar.setStyle({ style: Style.Light }),
          StatusBar.setBackgroundColor({ color: '#111827' }),
        ])
      );
    apply().catch(() => { setTimeout(() => { apply().catch(() => {}); }, 1000); });
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/sso" element={<SSOLanding />} />
      <Route
        path="/dispatcher"
        element={
          <ProtectedRoute allow={['dispatcher', 'overwatch']}>
            <DispatcherDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/crew"
        element={
          <ProtectedRoute allow={['crew']}>
            <CrewMobile />
          </ProtectedRoute>
        }
      />
      <Route path="/display" element={<DisplayBoard />} />
      <Route
        path="/wayfinding"
        element={
          <ProtectedRoute allow={['wayfinding_admin']}>
            <WayfindingAdmin />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
