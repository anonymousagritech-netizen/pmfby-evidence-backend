import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FileSpreadsheet, Users as UsersIcon, ClipboardList,
  Workflow, MessageSquare, Camera, Archive, ShieldAlert, History, LogOut, Sprout,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { to: '/', end: true, label: 'Dashboard', icon: LayoutDashboard },
  { to: '/import', label: 'Excel Import', icon: FileSpreadsheet },
  { to: '/farmers', label: 'Farmers & Cases', icon: ClipboardList },
  { to: '/assignments', label: 'Assignments', icon: Workflow },
  { to: '/auto-assign', label: 'Auto-Assign', icon: Workflow },
  { to: '/users', label: 'Users', icon: UsersIcon },
  { to: '/templates', label: 'Message Templates', icon: MessageSquare },
  { to: '/evidence', label: 'Evidence Monitoring', icon: Camera },
  { to: '/zips', label: 'ZIP Archives', icon: Archive },
  { to: '/review', label: 'Review Queue', icon: ShieldAlert },
  { to: '/audit', label: 'Audit Logs', icon: History },
];

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
        <h1><Sprout size={18} /> PMFBY Evidence</h1>
        <nav>
          {NAV_ITEMS.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end}>
              <Icon size={17} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="main">
        <div className="topbar">
          <div>
            <strong>{user?.name}</strong> <span className="help-text">({user?.roleName})</span>
          </div>
          <button onClick={handleLogout}><LogOut size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Log out</button>
        </div>
        {children}
      </div>
    </div>
  );
}
