import { useState } from 'react';
import { api } from '../api/client';

export default function ImportPage() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handlePreview(e) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/import/preview', form);
      setPreview(res.data);
      const initialMapping = {};
      for (const [header, proposal] of Object.entries(res.data.proposedMapping)) {
        if (proposal.field) initialMapping[header] = proposal.field;
      }
      setMapping(initialMapping);
      setResult(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    setError(null);
    setBusy(true);
    try {
      const res = await api.post('/import/commit', { sessionId: preview.sessionId, confirmedMapping: mapping });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Excel Import</h2>
        <p className="help-text">
          Upload the daily survey Excel. Columns are auto-mapped (exact + fuzzy header
          matching) — review and override below before committing. Re-uploading the same
          Docket_ID2 + Application_No updates the existing case instead of duplicating it.
        </p>
        <form onSubmit={handlePreview} className="flex-row">
          <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files[0])} />
          <button className="primary" type="submit" disabled={busy || !file}>Upload &amp; Preview</button>
        </form>
        {error && <div className="error-text">{error}</div>}
      </div>

      {preview && (
        <div className="card">
          <h3>Column Mapping ({preview.totalRows} data rows found)</h3>
          <table>
            <thead>
              <tr><th>Source Column</th><th>Proposed App Field</th><th>Confidence</th><th>Sample Value</th></tr>
            </thead>
            <tbody>
              {preview.headers.map((header) => (
                <tr key={header}>
                  <td>{header}</td>
                  <td>
                    <input
                      value={mapping[header] || ''}
                      onChange={(e) => setMapping({ ...mapping, [header]: e.target.value || undefined })}
                      placeholder="(unmapped — will be ignored)"
                    />
                  </td>
                  <td>{preview.proposedMapping[header]?.confidence}</td>
                  <td>{String(preview.previewRows[0]?.[header] ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 16 }}>
            <button className="primary" onClick={handleCommit} disabled={busy}>
              Confirm Mapping &amp; Commit Import
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="card">
          <h3>Import Summary</h3>
          <p>
            Inserted: {result.summary.inserted} | Updated: {result.summary.updated} |
            Unchanged: {result.summary.unchanged} | Errors: {result.summary.errored}
          </p>
          {result.rowLog.filter((r) => r.status === 'error').length > 0 && (
            <>
              <h4>Row Errors</h4>
              <table>
                <thead><tr><th>Row</th><th>Error</th></tr></thead>
                <tbody>
                  {result.rowLog.filter((r) => r.status === 'error').map((r) => (
                    <tr key={r.row}><td>{r.row}</td><td>{r.error}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
