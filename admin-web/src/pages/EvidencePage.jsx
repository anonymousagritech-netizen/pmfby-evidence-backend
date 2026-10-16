import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function EvidencePage() {
  const [caseId, setCaseId] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/audit-logs', { params: { resourceType: 'evidence_files' } })
      .then((res) => setAuditLogs(res.data.auditLogs))
      .catch(() => {});
  }, []);

  async function load(e) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.get(`/evidence/case/${caseId}`);
      setEvidenceFiles(res.data.evidenceFiles);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load evidence');
    }
  }

  async function download(id, filename) {
    const res = await api.get(`/evidence/${id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'evidence';
    a.click();
  }

  return (
    <div>
      <div className="card">
        <h2>Evidence Monitoring</h2>
        <p className="help-text">Look up evidence/contact attempts for a case by case ID.</p>
        <form onSubmit={load} className="flex-row">
          <input placeholder="Case ID (UUID)" value={caseId} onChange={(e) => setCaseId(e.target.value)} />
          <button className="primary" type="submit">Load</button>
        </form>
        {error && <div className="error-text">{error}</div>}
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Kind</th><th>Filename</th><th>Status</th><th>Checksum</th><th></th></tr></thead>
          <tbody>
            {evidenceFiles.map((f) => (
              <tr key={f.id}>
                <td>{f.kind}</td>
                <td>{f.original_filename}</td>
                <td><span className={`badge ${f.upload_status}`}>{f.upload_status}</span></td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{f.checksum_sha256?.slice(0, 16)}...</td>
                <td><button className="secondary" onClick={() => download(f.id, f.original_filename)}>Download</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Recent Evidence Access (Audit Trail)</h3>
        <table>
          <thead><tr><th>Action</th><th>Resource</th><th>User</th><th>At</th></tr></thead>
          <tbody>
            {auditLogs.slice(0, 20).map((l) => (
              <tr key={l.id}>
                <td>{l.action}</td>
                <td>{l.resource_id}</td>
                <td>{l.user_id}</td>
                <td>{new Date(l.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
