import { useEffect, useState } from 'react';
import { api } from '../api/client';

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
      <div className="card">
        <h2>Assign / Reassign Farmer</h2>
        <form onSubmit={handleAssign} className="flex-row">
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
      </div>

      <div className="card">
        <h3>Active Assignments</h3>
        <table>
          <thead><tr><th>Farmer</th><th>Village</th><th>Assigned To</th><th>Assigned At</th></tr></thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id}>
                <td>{a.farmer_name}</td>
                <td>{a.village_name}</td>
                <td>{a.assigned_to_name}</td>
                <td>{new Date(a.assigned_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
