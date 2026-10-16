import { useAuth } from '../context/AuthContext';

export default function DashboardPage() {
  const { user } = useAuth();
  return (
    <div className="card">
      <h2>Welcome, {user?.name}</h2>
      <p className="help-text">
        Role: {user?.roleName}. Use the sidebar to import survey data, manage farmer
        assignments, monitor evidence/contact attempts, and download ZIP archives.
      </p>
    </div>
  );
}
