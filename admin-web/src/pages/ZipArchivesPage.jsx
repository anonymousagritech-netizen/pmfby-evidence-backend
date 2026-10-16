import { useEffect, useState } from 'react';
import { api } from '../api/client';

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

  return (
    <div className="card">
      <h2>ZIP Archive Management</h2>
      <p className="help-text">One ZIP per contact attempt (call_event). Status is async: pending → processing → ready/failed.</p>
      <table>
        <thead><tr><th>Filename</th><th>Status</th><th>Size</th><th>Created</th><th></th></tr></thead>
        <tbody>
          {zips.map((z) => (
            <tr key={z.id}>
              <td>{z.filename || <span className="help-text">(not yet named)</span>}</td>
              <td><span className={`badge ${z.status}`}>{z.status}</span></td>
              <td>{z.size_bytes ? `${Math.round(z.size_bytes / 1024)} KB` : '-'}</td>
              <td>{new Date(z.created_at).toLocaleString()}</td>
              <td>
                {z.status === 'ready' && <button className="secondary" onClick={() => download(z.id, z.filename)}>Download</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
