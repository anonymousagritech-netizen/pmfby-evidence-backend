import { useEffect, useState } from 'react';
import { api } from '../api/client';
import DataTable from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';

export default function ZipArchivesPage() {
  const [zips, setZips] = useState([]);

  async function load() {
    const res = await api.get('/zip-archives');
    setZips(res.data.zipArchives);
  }
  useEffect(() => { load(); }, []);

  async function download(id, filename) {
    const res = await api.get(`/zip-archives/${id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'archive.zip';
    a.click();
  }

  const columns = [
    { key: 'filename', label: 'Filename', sortable: true, render: (z) => z.filename || <span className="help-text">(not yet named)</span> },
    { key: 'status', label: 'Status', sortable: true, render: (z) => <StatusBadge status={z.status} /> },
    { key: 'size_bytes', label: 'Size', sortable: true, render: (z) => (z.size_bytes ? `${Math.round(z.size_bytes / 1024)} KB` : '-') },
    { key: 'created_at', label: 'Created', sortable: true, render: (z) => new Date(z.created_at).toLocaleString() },
    { key: 'actions', label: '', render: (z) => (z.status === 'ready' ? <button className="secondary" onClick={() => download(z.id, z.filename)}>Download</button> : null) },
  ];

  return (
    <div className="card">
      <h2>ZIP Archive Management</h2>
      <p className="help-text">One ZIP per contact attempt (call_event). Status is async: pending → processing → ready/failed.</p>
      <DataTable columns={columns} rows={zips} searchKeys={['filename', 'status']} emptyMessage="No ZIP archives yet." />
    </div>
  );
}
