import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RequireAuth({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  // Mandatory first-login password change (currently: every bulk-imported surveyor
  // account, whose password was system-generated — see surveyorImportService.js).
  // Blocks every other route until they actually set their own password.
  if (user.forcePasswordChange && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}
