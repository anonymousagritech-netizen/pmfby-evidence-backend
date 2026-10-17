import { useEffect, useState } from 'react';
import { Archive } from 'lucide-react';
import { api } from '../api/client';
import DataGrid from '../components/DataGrid';
import Card from '../components/Card';
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
    { key: 'actions', label: '', sortable: false, render: (z) => (z.status === 'ready' ? <button className="secondary" onClick={() => download(z.id, z.filename)}>Download</button> : null) },
  ];

  return (
    <Card title="ZIP Archive Management" icon={Archive} accent="amber">
      <p className="help-text">One ZIP per contact attempt (call_event). Status is async: pending → processing → ready/failed.</p>
      <DataGrid columns={columns} rows={zips} searchKeys={['filename', 'status']} emptyMessage="No ZIP archives yet." />
    </Card>
  );
}
