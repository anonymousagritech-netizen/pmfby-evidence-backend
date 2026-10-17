import { useState } from 'react';
import { FileSpreadsheet, ListChecks, AlertTriangle, Download } from 'lucide-react';
import { api } from '../api/client';
import Card from '../components/Card';
import DataGrid from '../components/DataGrid';

async function downloadTemplate(path, filename) {
  const res = await api.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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

  const mappingRows = preview ? preview.headers.map((header) => ({
    header,
    confidence: preview.proposedMapping[header]?.confidence,
    sample: String(preview.previewRows[0]?.[header] ?? ''),
  })) : [];
  const errorRows = result ? result.rowLog.filter((r) => r.status === 'error') : [];

  return (
    <div>
      <Card title="Excel Import" icon={FileSpreadsheet} accent="teal">
        <p className="help-text">Auto-mapped columns, reviewable below. Re-uploading the same Docket_ID2+Application_No updates instead of duplicating.</p>
        <form onSubmit={handlePreview} className="flex-row" style={{ flexWrap: 'wrap' }}>
          <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files[0])} />
          <button className="primary" type="submit" disabled={busy || !file}>Upload &amp; Preview</button>
          <button type="button" className="secondary sm" onClick={() => downloadTemplate('/import/template', 'case-import-template.xlsx')}>
            <Download size={12} style={{ verticalAlign: -1, marginRight: 4 }} />Download Template
          </button>
        </form>
        {error && <div className="error-text">{error}</div>}
      </Card>

      {preview && (
        <Card title={`Column Mapping (${preview.totalRows} data rows found)`} icon={ListChecks} accent="violet">
          <DataGrid
            columns={[
              { key: 'header', label: 'Source Column', sortable: true },
              {
                key: 'mapped', label: 'Proposed App Field', sortable: false,
                render: (r) => (
                  <input
                    value={mapping[r.header] || ''}
                    onChange={(e) => setMapping({ ...mapping, [r.header]: e.target.value || undefined })}
                    placeholder="(unmapped — ignored)"
                  />
                ),
              },
              { key: 'confidence', label: 'Confidence', sortable: true },
              { key: 'sample', label: 'Sample Value', sortable: false },
            ]}
            rows={mappingRows}
            searchKeys={['header']}
            emptyMessage="No columns found."
            rowHeight={44}
          />
          <div style={{ marginTop: 16 }}>
            <button className="primary" onClick={handleCommit} disabled={busy}>
              Confirm Mapping &amp; Commit Import
            </button>
          </div>
        </Card>
      )}

      {result && (
        <Card title="Import Summary" icon={ListChecks} accent="navy">
          <div className="stat-grid">
            <div className="stat-card" style={{ '--accent': 'var(--p3-dot)' }}>
              <span className="stat-label">Inserted</span><span className="stat-value">{result.summary.inserted}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--info)' }}>
              <span className="stat-label">Updated</span><span className="stat-value">{result.summary.updated}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--neutral-500)' }}>
              <span className="stat-label">Unchanged</span><span className="stat-value">{result.summary.unchanged}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--p1-dot)' }}>
              <span className="stat-label">Errors</span><span className="stat-value">{result.summary.errored}</span>
            </div>
          </div>
          {errorRows.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> Row Errors</h3>
              <DataGrid
                columns={[
                  { key: 'row', label: 'Row', sortable: true },
                  { key: 'error', label: 'Error', sortable: false, flex: 2 },
                ]}
                rows={errorRows}
                emptyMessage="No row errors."
                height={Math.min(300, 60 + errorRows.length * 42)}
              />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
