import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import SSOLanding from './pages/SSOLanding';
import DispatcherDashboard from './pages/DispatcherDashboard';
import WayfindingAdmin from './pages/WayfindingAdmin';
import DisplayBoard from './pages/DisplayBoard';
import CrewMobile from './pages/CrewMobile';

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/sso" element={<SSOLanding />} />
      <Route
        path="/dispatcher"
        element={
          <ProtectedRoute>
            <DispatcherDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/crew"
        element={
          <ProtectedRoute>
            <CrewMobile />
          </ProtectedRoute>
        }
      />
      <Route path="/display" element={<DisplayBoard />} />
      <Route
        path="/wayfinding"
        element={
          <ProtectedRoute>
            <WayfindingAdmin />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
