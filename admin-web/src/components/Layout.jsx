import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <div className="sidebar">
        <h1>PMFBY Evidence</h1>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/import">Excel Import</NavLink>
          <NavLink to="/farmers">Farmers &amp; Cases</NavLink>
          <NavLink to="/assignments">Assignments</NavLink>
          <NavLink to="/users">Users</NavLink>
          <NavLink to="/templates">Message Templates</NavLink>
          <NavLink to="/evidence">Evidence Monitoring</NavLink>
          <NavLink to="/zips">ZIP Archives</NavLink>
          <NavLink to="/review">Review Queue</NavLink>
          <NavLink to="/audit">Audit Logs</NavLink>
        </nav>
      </div>
      <div className="main">
        <div className="topbar">
          <div>
            <strong>{user?.name}</strong> <span className="help-text">({user?.roleName})</span>
          </div>
          <button onClick={handleLogout}>Log out</button>
        </div>
        {children}
      </div>
    </div>
  );
}
