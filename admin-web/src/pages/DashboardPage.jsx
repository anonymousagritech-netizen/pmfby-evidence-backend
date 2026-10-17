import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, AlertTriangle, ShieldAlert, BarChart3, PieChart } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import Card from '../components/Card';

const STATUS_COLORS = {
  completed: 'var(--p3-dot)',
  pending_contact: 'var(--neutral-300)',
  postponed: 'var(--info)',
  wrong_number: 'var(--info)',
  denied: 'var(--p1-dot)',
  dispute_incident: 'var(--p1-dot)',
};
const PRIORITY_COLORS = { P1: 'var(--p1-dot)', P2: 'var(--p2-dot)', P3: 'var(--p3-dot)', unknown: 'var(--neutral-300)' };

// Fixed min-height regardless of data state so two chart cards side-by-side never
// end up visibly different heights (one shrinking to near-zero when its rows array is
// empty while its sibling stays tall) — the empty state fills the same space a few
// real bars would, with a centered caption instead of a collapsed blank strip.
const CHART_MIN_HEIGHT = 160;

function BarChart({ rows, colorMap, labelKey, valueKey, emptyMessage = 'No data yet.' }) {
  if (rows.length === 0) {
    return (
      <div style={{
        minHeight: CHART_MIN_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', color: 'var(--neutral-500)', fontSize: 13, padding: '0 20px',
      }}
      >
        {emptyMessage}
      </div>
    );
  }
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  return (
    <div style={{ minHeight: CHART_MIN_HEIGHT }}>
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

      {error && <Card accent="rose" title="Error"><span className="error-text">{error}</span></Card>}

      {summary && (
        <>
          <div className="stat-grid">
            <div className="stat-card" style={{ '--accent': 'var(--navy)' }}>
              <span className="stat-icon"><BarChart3 size={13} /></span>
              <span className="stat-label">Total Cases</span>
              <span className="stat-value">{summary.totalCases}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--p3-dot)' }}>
              <span className="stat-icon"><CheckCircle2 size={13} /></span>
              <span className="stat-label">Completed</span>
              <span className="stat-value">{completed}</span>
              <span className="stat-sub">{summary.totalCases ? Math.round((completed / summary.totalCases) * 100) : 0}% of total</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--amber)' }}>
              <span className="stat-icon"><Clock size={13} /></span>
              <span className="stat-label">Pending / Open</span>
              <span className="stat-value">{pending}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--p1-dot)' }}>
              <span className="stat-icon"><AlertTriangle size={13} /></span>
              <span className="stat-label">Emergency Reviews Pending</span>
              <span className="stat-value">{summary.pendingEmergencyReviews}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--violet)' }}>
              <span className="stat-icon"><ShieldAlert size={13} /></span>
              <span className="stat-label">Discrepancy Flags Pending</span>
              <span className="stat-value">{summary.pendingDiscrepancyFlags}</span>
            </div>
          </div>

          <div className="flex-row" style={{ alignItems: 'stretch', flexWrap: 'wrap', gap: 22 }}>
            <div style={{ flex: 1, minWidth: 320 }}>
              <Card title="Cases by Status" icon={BarChart3} accent="teal">
                <BarChart
                  rows={summary.byStatus} colorMap={STATUS_COLORS} labelKey="contact_status" valueKey="count"
                  emptyMessage="No case data yet — import an Excel file to get started."
                />
                <p className="help-text" style={{ marginTop: 10 }}>Every imported case, grouped by its current contact status.</p>
              </Card>
            </div>
            <div style={{ flex: 1, minWidth: 320 }}>
              <Card title="Open Cases by Priority" icon={PieChart} accent="amber">
                <BarChart
                  rows={summary.byPriority} colorMap={PRIORITY_COLORS} labelKey="priority" valueKey="count"
                  emptyMessage="No case data yet — import an Excel file to get started."
                />
                <p className="help-text" style={{ marginTop: 10 }}>Default 10-day TAT view — an Auto-Assign run uses its own TAT/cutoffs.</p>
              </Card>
            </div>
          </div>
        </>
      )}

      {!summary && !error && <Card><span className="help-text">Loading dashboard...</span></Card>}
    </div>
  );
}
