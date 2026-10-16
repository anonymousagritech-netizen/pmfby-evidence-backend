import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    api.get('/audit-logs').then((res) => setLogs(res.data.auditLogs));
  }, []);

  return (
    <div className="card">
      <h2>Audit Logs</h2>
      <table>
        <thead><tr><th>Action</th><th>Resource Type</th><th>Resource ID</th><th>User</th><th>At</th></tr></thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td>{l.action}</td><td>{l.resource_type}</td><td>{l.resource_id}</td><td>{l.user_id}</td>
              <td>{new Date(l.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
