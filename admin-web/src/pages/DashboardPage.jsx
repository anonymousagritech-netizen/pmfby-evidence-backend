import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, AlertTriangle, ShieldAlert, BarChart3, TrendingUp, Leaf } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

const STATUS_COLORS = {
  completed: '#22c55e',
  pending_contact: '#94a3b8',
  postponed: '#3b82f6',
  wrong_number: '#8b5cf6',
  denied: '#ef4444',
  dispute_incident: '#f97316',
};
const PRIORITY_COLORS = { P1: '#ef4444', P2: '#f59e0b', P3: '#22c55e', unknown: '#94a3b8' };

const STAT_CONFIG = [
  { key: 'totalCases',              label: 'Total Cases',                 gradient: 'linear-gradient(135deg,#1e4976,#0f2a4a)', icon: BarChart3 },
  { key: 'completed',               label: 'Completed',                   gradient: 'linear-gradient(135deg,#059669,#047857)', icon: CheckCircle2 },
  { key: 'pending',                 label: 'Pending / Open',              gradient: 'linear-gradient(135deg,#d97706,#b45309)', icon: Clock },
  { key: 'pendingEmergencyReviews', label: 'Emergency Reviews',           gradient: 'linear-gradient(135deg,#dc2626,#b91c1c)', icon: AlertTriangle },
  { key: 'pendingDiscrepancyFlags', label: 'Discrepancy Flags',           gradient: 'linear-gradient(135deg,#7c3aed,#6d28d9)', icon: ShieldAlert },
];

function BarChart({ rows, colorMap, labelKey, valueKey, emptyMessage = 'No data yet.' }) {
  if (!rows || rows.length === 0) {
    return (
      <div style={{
        minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#94a3b8', fontSize: 13, padding: '0 20px', textAlign: 'center',
      }}>
        {emptyMessage}
      </div>
    );
  }
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey])));
  return (
    <div style={{ minHeight: 140 }}>
      {rows.map((r) => (
        <div key={r[labelKey]} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
          <span style={{ width: 130, fontSize: 12.5, color: '#374151', flexShrink: 0, textTransform: 'capitalize' }}>
            {String(r[labelKey]).replace(/_/g, ' ')}
          </span>
          <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 8, height: 16, overflow: 'hidden' }}>
            <div style={{
              width: `${(Number(r[valueKey]) / max) * 100}%`, height: '100%',
              background: colorMap[r[labelKey]] || '#4f46e5',
              borderRadius: 8, transition: 'width 0.6s ease',
            }} />
          </div>
          <span style={{ width: 44, textAlign: 'right', fontSize: 13, fontWeight: 800, color: '#0f2a4a' }}>{r[valueKey]}</span>
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
      .catch((err) => setError(err.response?.data?.error || 'Failed to load dashboard'));
  }, []);

  const completed = summary?.byStatus.find((s) => s.contact_status === 'completed')?.count || 0;
  const pending = (summary?.totalCases || 0) - completed;

  const statValues = {
    totalCases: summary?.totalCases || 0,
    completed,
    pending,
    pendingEmergencyReviews: summary?.pendingEmergencyReviews || 0,
    pendingDiscrepancyFlags: summary?.pendingDiscrepancyFlags || 0,
  };

  return (
    <div style={{ animation: 'fadeIn 0.25s ease' }}>
      {/* Hero banner */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2a4a 0%, #1e4976 50%, #0d9488 100%)',
        borderRadius: 18, padding: '26px 32px', marginBottom: 28, color: '#fff',
        boxShadow: '0 8px 32px rgba(15,42,74,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 12, padding: 10 }}>
              <Leaf size={22} />
            </div>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 22 }}>Welcome, {user?.name}</h2>
          </div>
          <p style={{ margin: 0, opacity: 0.8, fontSize: 13.5 }}>
            Role: {user?.roleName} · PMFBY Crop Insurance Survey Overview
          </p>
        </div>
        <div style={{ textAlign: 'right', opacity: 0.75, fontSize: 13 }}>
          <div>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 12, padding: '12px 18px', color: '#b42318', marginBottom: 20 }}>
          {error}
        </div>
      )}

      {!summary && !error && (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>Loading dashboard...</div>
      )}

      {summary && (
        <>
          {/* Big stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 18, marginBottom: 28 }}>
            {STAT_CONFIG.map(({ key, label, gradient, icon: Icon }) => (
              <div key={key} style={{
                background: gradient, borderRadius: 16, padding: '22px 20px',
                color: '#fff', position: 'relative', overflow: 'hidden',
                boxShadow: '0 6px 24px rgba(0,0,0,0.15)',
                transition: 'transform 0.15s, box-shadow 0.15s',
                cursor: 'default',
              }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 12px 36px rgba(0,0,0,0.22)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.15)'; }}>
                {/* Background circle */}
                <div style={{
                  position: 'absolute', top: -15, right: -15, width: 80, height: 80,
                  borderRadius: '50%', background: 'rgba(255,255,255,0.12)',
                }} />
                <div style={{
                  position: 'absolute', top: 16, right: 16, width: 38, height: 38,
                  borderRadius: 10, background: 'rgba(255,255,255,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={18} />
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.8, marginBottom: 8 }}>
                  {label}
                </div>
                <div style={{ fontSize: 38, fontWeight: 900, lineHeight: 1, marginBottom: 4 }}>
                  {statValues[key]}
                </div>
                {key === 'completed' && summary.totalCases > 0 && (
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {Math.round((completed / summary.totalCases) * 100)}% of total
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, flexWrap: 'wrap' }}>
            <div style={{
              background: '#fff', borderRadius: 16, overflow: 'hidden',
              boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #f0f0f0',
            }}>
              <div style={{
                background: 'linear-gradient(135deg, #0d9488, #059669)',
                padding: '15px 20px', display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: 7 }}>
                  <BarChart3 size={16} style={{ color: '#fff' }} />
                </div>
                <h3 style={{ margin: 0, color: '#fff', fontSize: 15 }}>Cases by Status</h3>
              </div>
              <div style={{ padding: 20 }}>
                <BarChart rows={summary.byStatus} colorMap={STATUS_COLORS} labelKey="contact_status" valueKey="count"
                  emptyMessage="No case data yet — import an Excel file to get started." />
                <p style={{ margin: '10px 0 0', fontSize: 12, color: '#94a3b8' }}>Every imported case, grouped by contact status.</p>
              </div>
            </div>

            <div style={{
              background: '#fff', borderRadius: 16, overflow: 'hidden',
              boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #f0f0f0',
            }}>
              <div style={{
                background: 'linear-gradient(135deg, #d97706, #b45309)',
                padding: '15px 20px', display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: 7 }}>
                  <TrendingUp size={16} style={{ color: '#fff' }} />
                </div>
                <h3 style={{ margin: 0, color: '#fff', fontSize: 15 }}>Open Cases by Priority</h3>
              </div>
              <div style={{ padding: 20 }}>
                <BarChart rows={summary.byPriority} colorMap={PRIORITY_COLORS} labelKey="priority" valueKey="count"
                  emptyMessage="No open cases — great work!" />
                <p style={{ margin: '10px 0 0', fontSize: 12, color: '#94a3b8' }}>Default 10-day TAT view.</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
