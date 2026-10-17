import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';

// Every other page pulls in the AG Grid data-grid (and AutoAssignPage additionally
// pulls in react-leaflet) — code-split them so the initial bundle (login + dashboard,
// the first thing anyone sees) stays small on Render's free static tier, and the grid/
// map libraries only download when a page that actually needs them is visited.
const ImportPage = lazy(() => import('./pages/ImportPage'));
const FarmersPage = lazy(() => import('./pages/FarmersPage'));
const AssignmentsPage = lazy(() => import('./pages/AssignmentsPage'));
const AutoAssignPage = lazy(() => import('./pages/AutoAssignPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'));
const EvidencePage = lazy(() => import('./pages/EvidencePage'));
const ZipArchivesPage = lazy(() => import('./pages/ZipArchivesPage'));
const ReviewQueuePage = lazy(() => import('./pages/ReviewQueuePage'));
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage'));

function Protected({ children }) {
  return (
    <RequireAuth>
      <Layout>
        <Suspense fallback={<div className="help-text" style={{ padding: 20 }}>Loading...</div>}>
          {children}
        </Suspense>
      </Layout>
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
