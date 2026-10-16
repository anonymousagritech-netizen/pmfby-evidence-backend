import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function ReviewQueuePage() {
  const { user } = useAuth();
  const [flags, setFlags] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [concerns, setConcerns] = useState([]);
  const [surveyorHistory, setSurveyorHistory] = useState([]);

  async function load() {
    const [f, i, c, h] = await Promise.all([
      api.get('/cases/discrepancy-flags'),
      api.get('/emergency-incidents'),
      api.get('/cases/reports/docket-conflicts'),
      api.get('/reports/surveyor-history'),
    ]);
    setFlags(f.data.flags);
    setIncidents(i.data.incidents);
    setConflicts(c.data.conflicts);
    setSurveyorHistory(h.data.surveyorHistory);
    if (user?.roleKey === 'super_admin') {
      const concernsRes = await api.get('/integrity-concerns');
      setConcerns(concernsRes.data.concerns);
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function resolveIncident(id) {
    await api.patch(`/emergency-incidents/${id}/resolve`, { resolutionNotes: 'Reviewed by manager/admin via admin-web' });
    await load();
  }

  async function reviewFlag(id) {
    await api.patch(`/cases/discrepancy-flags/${id}/review`, { resolutionNotes: 'Reviewed via admin-web' });
    await load();
  }

  return (
    <div>
      <div className="card">
        <h2>Emergency / Forceful-Survey Incidents</h2>
        <p className="help-text">
          A flagged case cannot be reassigned or closed until resolved here (enforced
          server-side).
        </p>
        <table>
          <thead><tr><th>Type</th><th>Status</th><th>Started</th><th>Review</th><th></th></tr></thead>
          <tbody>
            {incidents.map((i) => (
              <tr key={i.id}>
                <td>{i.incident_type}</td>
                <td><span className="badge">{i.status}</span></td>
                <td>{new Date(i.started_at).toLocaleString()}</td>
                <td>{i.resolved_at ? 'Resolved' : <span style={{ color: 'var(--danger)' }}>Needs review</span>}</td>
                <td>{!i.resolved_at && <button className="secondary" onClick={() => resolveIncident(i.id)}>Mark Reviewed</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Suspected Discrepancy Flags</h2>
        <table>
          <thead><tr><th>Reason</th><th>Description</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.id}>
                <td>{f.reason}</td>
                <td>{f.description}</td>
                <td><span className="badge">{f.status}</span></td>
                <td>{f.status === 'pending' && <button className="secondary" onClick={() => reviewFlag(f.id)}>Mark Reviewed</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Docket Conflict Warnings</h2>
        <p className="help-text">Same Docket_ID2 appearing across multiple source surveyors — possible stale attempts.</p>
        <table>
          <thead><tr><th>Docket_ID2</th><th>Case rows</th><th>Distinct source surveyors</th></tr></thead>
          <tbody>
            {conflicts.map((c) => (
              <tr key={c.docket_id2}>
                <td>{c.docket_id2}</td>
                <td>{c.case_row_count}</td>
                <td>{c.distinct_source_surveyors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Per-Surveyor History</h2>
        <table>
          <thead><tr><th>Surveyor</th><th>Disputes</th><th>Fraud flags raised</th><th>Emergencies</th></tr></thead>
          <tbody>
            {surveyorHistory.map((s) => (
              <tr key={s.user_id}>
                <td>{s.name}</td><td>{s.disputes_count}</td><td>{s.fraud_flags_raised_count}</td><td>{s.emergencies_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {user?.roleKey === 'super_admin' && (
        <div className="card">
          <h2>Integrity Concerns (Confidential — Super Admin only)</h2>
          <table>
            <thead><tr><th>Description</th><th>Reported At</th></tr></thead>
            <tbody>
              {concerns.map((c) => (
                <tr key={c.id}><td>{c.description}</td><td>{new Date(c.created_at).toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
