import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

const STATUS_COLORS = {
  completed: 'var(--p3-dot)',
  pending_contact: 'var(--neutral-300)',
  postponed: 'var(--info)',
  wrong_number: 'var(--info)',
  denied: 'var(--p1-dot)',
  dispute_incident: 'var(--p1-dot)',
};
const PRIORITY_COLORS = { P1: 'var(--p1-dot)', P2: 'var(--p2-dot)', P3: 'var(--p3-dot)', unknown: 'var(--neutral-300)' };

function BarChart({ rows, colorMap, labelKey, valueKey }) {
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  return (
    <div>
      {rows.map((r) => (
        <div className="bar-chart-row" key={r[labelKey]}>
          <span className="bar-chart-label">{r[labelKey].replace(/_/g, ' ')}</span>
          <div className="bar-chart-track">
            <div
              className="bar-chart-fill"
              style={{ width: `${(r[valueKey] / max) * 100}%`, background: colorMap[r[labelKey]] || 'var(--navy-light)' }}
            />
          </div>
          <span className="bar-chart-value">{r[valueKey]}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/reports/dashboard-summary')
      .then((res) => setSummary(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load dashboard summary'));
  }, []);

  const completed = summary?.byStatus.find((s) => s.contact_status === 'completed')?.count || 0;
  const pending = (summary?.totalCases || 0) - completed;

  return (
    <div>
      <h2 style={{ marginBottom: 4 }}>Welcome, {user?.name}</h2>
      <p className="help-text" style={{ marginBottom: 20 }}>
        Role: {user?.roleName}. Overview of survey cases across your scope.
      </p>

      {error && <div className="card error-text">{error}</div>}

      {summary && (
        <>
          <div className="stat-grid">
            <div className="stat-card" style={{ '--accent': 'var(--navy)' }}>
              <span className="stat-label">Total Cases</span>
              <span className="stat-value">{summary.totalCases}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--p3-dot)' }}>
              <span className="stat-label">Completed</span>
              <span className="stat-value">{completed}</span>
              <span className="stat-sub">{summary.totalCases ? Math.round((completed / summary.totalCases) * 100) : 0}% of total</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--amber)' }}>
              <span className="stat-label">Pending / Open</span>
              <span className="stat-value">{pending}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--p1-dot)' }}>
              <span className="stat-label">Emergency Reviews Pending</span>
              <span className="stat-value">{summary.pendingEmergencyReviews}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--violet)' }}>
              <span className="stat-label">Discrepancy Flags Pending</span>
              <span className="stat-value">{summary.pendingDiscrepancyFlags}</span>
            </div>
          </div>

          <div className="flex-row" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
            <div className="card" style={{ flex: 1, minWidth: 320 }}>
              <h3>Cases by Status</h3>
              <BarChart rows={summary.byStatus} colorMap={STATUS_COLORS} labelKey="contact_status" valueKey="count" />
            </div>
            <div className="card" style={{ flex: 1, minWidth: 320 }}>
              <h3>Open Cases by Priority</h3>
              <BarChart rows={summary.byPriority} colorMap={PRIORITY_COLORS} labelKey="priority" valueKey="count" />
              <p className="help-text" style={{ marginTop: 10 }}>
                Priority here uses a default 10-day TAT for a quick at-a-glance view —
                an actual Auto-Assign run uses the TAT/cutoffs you set for that run.
              </p>
            </div>
          </div>
        </>
      )}

      {!summary && !error && <div className="card help-text">Loading dashboard...</div>}
    </div>
  );
}
