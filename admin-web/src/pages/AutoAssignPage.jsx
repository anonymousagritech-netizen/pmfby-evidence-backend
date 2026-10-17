import { useState } from 'react';
import { api } from '../api/client';

// Village-based auto-assignment: admin sets params for a district (or comma-separated
// list of districts), runs a dry-run Preview to see the per-surveyor breakdown, then
// Commit to actually write farmer_assignments. See ROADMAP.md for what's intentionally
// NOT built here yet (map view, full visual redesign) and why.
export default function AutoAssignPage() {
  const [districtIds, setDistrictIds] = useState('');
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [tatDays, setTatDays] = useState(10);
  const [minCases, setMinCases] = useState(40);
  const [p1CutoffDays, setP1CutoffDays] = useState(5);
  const [p2CutoffDays, setP2CutoffDays] = useState(7);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  function payload() {
    return {
      districtIds: districtIds.split(',').map((s) => s.trim()).filter(Boolean),
      reportDate,
      tatDays: Number(tatDays),
      minCases: Number(minCases),
      p1CutoffDays: Number(p1CutoffDays),
      p2CutoffDays: Number(p2CutoffDays),
    };
  }

  async function run(mode) {
    setError(null);
    setLoading(true);
    try {
      const res = await api.post(`/auto-assign/${mode}`, payload());
      setResult({ mode, ...res.data });
    } catch (err) {
      setError(err.response?.data?.error || `Auto-assign ${mode} failed`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Auto-Assign (village-based)</h2>
        <p style={{ color: 'var(--muted, #666)' }}>
          One village is always given whole to a single surveyor. Preview is a dry run —
          nothing is written until you Commit.
        </p>
        <div className="flex-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <label>District ID(s), comma-separated
            <input value={districtIds} onChange={(e) => setDistrictIds(e.target.value)} placeholder="D1,D2" />
          </label>
          <label>Report date
            <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
          </label>
          <label>TAT days
            <input type="number" value={tatDays} onChange={(e) => setTatDays(e.target.value)} />
          </label>
          <label>Min cases/surveyor
            <input type="number" value={minCases} onChange={(e) => setMinCases(e.target.value)} />
          </label>
          <label>P1 cutoff days
            <input type="number" value={p1CutoffDays} onChange={(e) => setP1CutoffDays(e.target.value)} />
          </label>
          <label>P2 cutoff days
            <input type="number" value={p2CutoffDays} onChange={(e) => setP2CutoffDays(e.target.value)} />
          </label>
        </div>
        <div className="flex-row" style={{ marginTop: 12 }}>
          <button type="button" disabled={loading} onClick={() => run('preview')}>Preview</button>
          <button type="button" className="primary" disabled={loading || !result || result.mode !== 'preview'}
            onClick={() => run('commit')}>
            Commit Assignment
          </button>
        </div>
        {error && <div className="error-text">{error}</div>}
      </div>

      {result && (
        <div className="card">
          <h3>{result.mode === 'commit' ? 'Committed' : 'Preview'} result</h3>
          <p>
            Total cases: {result.totalCases} — Assigned: {result.totalAssigned} — Unassigned: {result.totalUnassigned}
          </p>
          {result.underMinimumSurveyors?.length > 0 && (
            <div className="error-text">
              Under minimum caseload: {result.underMinimumSurveyors.length} surveyor(s)
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>Surveyor</th><th>Districts</th><th>Villages</th><th>Total</th>
                <th>P1</th><th>P2</th><th>P3</th><th>Under min?</th>
              </tr>
            </thead>
            <tbody>
              {result.perSurveyor?.map((s) => (
                <tr key={s.surveyorId}>
                  <td>{s.surveyorId}</td>
                  <td>{s.districtCount}</td>
                  <td>{s.villageCount}</td>
                  <td>{s.totalCases}</td>
                  <td>{s.p1}</td>
                  <td>{s.p2}</td>
                  <td>{s.p3}</td>
                  <td>{s.underMinimum ? 'Yes' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
