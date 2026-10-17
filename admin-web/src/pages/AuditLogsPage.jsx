import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { api } from '../api/client';
import DataGrid from '../components/DataGrid';
import Card from '../components/Card';

export default function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;

  useEffect(() => {
    api.get('/audit-logs', { params: { page, pageSize } }).then((res) => {
      setLogs(res.data.auditLogs);
      setTotal(res.data.total ?? res.data.auditLogs.length);
    });
  }, [page]);

  const columns = [
    { key: 'action', label: 'Action', sortable: true },
    { key: 'resource_type', label: 'Resource Type', sortable: true },
    { key: 'resource_id', label: 'Resource ID' },
    { key: 'user_id', label: 'User' },
    { key: 'created_at', label: 'At', sortable: true, render: (l) => new Date(l.created_at).toLocaleString() },
  ];

  return (
    <Card title="Audit Logs" icon={History} accent="sky">
      <DataGrid
        columns={columns}
        rows={logs}
        serverPagination={{ page, pageSize, total, onPageChange: setPage }}
        emptyMessage="No audit log entries."
      />
    </Card>
  );
}
