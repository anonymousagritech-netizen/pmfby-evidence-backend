import { useEffect, useState } from 'react';
import { api } from '../api/client';
import DataTable from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';

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
        <div style={{ marginTop: 12 }}>
          <DataTable
            columns={[
              { key: 'kind', label: 'Kind', sortable: true },
              { key: 'original_filename', label: 'Filename', sortable: true },
              { key: 'upload_status', label: 'Status', sortable: true, render: (f) => <StatusBadge status={f.upload_status} /> },
              { key: 'checksum_sha256', label: 'Checksum', render: (f) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{f.checksum_sha256?.slice(0, 16)}...</span> },
              { key: 'actions', label: '', render: (f) => <button className="secondary" onClick={() => download(f.id, f.original_filename)}>Download</button> },
            ]}
            rows={evidenceFiles}
            searchKeys={['kind', 'original_filename']}
            emptyMessage="Enter a Case ID above to load its evidence files."
          />
        </div>
      </div>

      <div className="card">
        <h3>Recent Evidence Access (Audit Trail)</h3>
        <DataTable
          columns={[
            { key: 'action', label: 'Action', sortable: true },
            { key: 'resource_id', label: 'Resource' },
            { key: 'user_id', label: 'User' },
            { key: 'created_at', label: 'At', sortable: true, render: (l) => new Date(l.created_at).toLocaleString() },
          ]}
          rows={auditLogs}
          searchKeys={['action', 'resource_id']}
          emptyMessage="No evidence access logged yet."
        />
      </div>
    </div>
  );
}
