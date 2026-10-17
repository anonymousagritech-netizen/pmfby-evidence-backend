import { useEffect, useState } from 'react';
import { Workflow, ClipboardList } from 'lucide-react';
import { api } from '../api/client';
import Card from '../components/Card';
import DataGrid from '../components/DataGrid';

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState([]);
  const [farmers, setFarmers] = useState([]);
  const [users, setUsers] = useState([]);
  const [farmerId, setFarmerId] = useState('');
  const [userId, setUserId] = useState('');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  async function loadAll() {
    const [a, f, u] = await Promise.all([
      api.get('/assignments'),
      api.get('/farmers'),
      api.get('/users'),
    ]);
    setAssignments(a.data.assignments);
    setFarmers(f.data.farmers);
    setUsers(u.data.users.filter((usr) => usr.role_key === 'surveyor'));
  }

  useEffect(() => { loadAll(); }, []);

  async function handleAssign(e) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.post('/assignments', { farmerId, userId });
      setMessage('Assigned successfully.');
      await loadAll();
    } catch (err) {
      setError(err.response?.data?.error || 'Assignment failed');
    }
  }

  return (
    <div>
      <Card title="Assign / Reassign Farmer" icon={Workflow} accent="violet">
        <form onSubmit={handleAssign} className="flex-row" style={{ flexWrap: 'wrap' }}>
          <select value={farmerId} onChange={(e) => setFarmerId(e.target.value)} required>
            <option value="">Select farmer...</option>
            {farmers.map((f) => <option key={f.id} value={f.id}>{f.farmer_name} ({f.village_name})</option>)}
          </select>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">Select surveyor...</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button className="primary" type="submit">Assign</button>
        </form>
        {error && <div className="error-text">{error}</div>}
        {message && <div style={{ color: 'var(--success)', marginTop: 8 }}>{message}</div>}
      </Card>

      <Card title="Active Assignments" icon={ClipboardList} accent="teal">
        <DataGrid
          columns={[
            { key: 'farmer_name', label: 'Farmer', sortable: true },
            { key: 'village_name', label: 'Village', sortable: true },
            { key: 'assigned_to_name', label: 'Assigned To', sortable: true },
            { key: 'assigned_at', label: 'Assigned At', sortable: true, render: (a) => new Date(a.assigned_at).toLocaleString() },
          ]}
          rows={assignments}
          searchKeys={['farmer_name', 'village_name', 'assigned_to_name']}
          emptyMessage="No active assignments."
        />
      </Card>
    </div>
  );
}
