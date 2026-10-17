import { Routes, Route } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ImportPage from './pages/ImportPage';
import FarmersPage from './pages/FarmersPage';
import AssignmentsPage from './pages/AssignmentsPage';
import AutoAssignPage from './pages/AutoAssignPage';
import UsersPage from './pages/UsersPage';
import TemplatesPage from './pages/TemplatesPage';
import EvidencePage from './pages/EvidencePage';
import ZipArchivesPage from './pages/ZipArchivesPage';
import ReviewQueuePage from './pages/ReviewQueuePage';
import AuditLogsPage from './pages/AuditLogsPage';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';

function Protected({ children }) {
  return (
    <RequireAuth>
      <Layout>{children}</Layout>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Protected><DashboardPage /></Protected>} />
      <Route path="/import" element={<Protected><ImportPage /></Protected>} />
      <Route path="/farmers" element={<Protected><FarmersPage /></Protected>} />
      <Route path="/assignments" element={<Protected><AssignmentsPage /></Protected>} />
      <Route path="/auto-assign" element={<Protected><AutoAssignPage /></Protected>} />
      <Route path="/users" element={<Protected><UsersPage /></Protected>} />
      <Route path="/templates" element={<Protected><TemplatesPage /></Protected>} />
      <Route path="/evidence" element={<Protected><EvidencePage /></Protected>} />
      <Route path="/zips" element={<Protected><ZipArchivesPage /></Protected>} />
      <Route path="/review" element={<Protected><ReviewQueuePage /></Protected>} />
      <Route path="/audit" element={<Protected><AuditLogsPage /></Protected>} />
    </Routes>
  );
}
