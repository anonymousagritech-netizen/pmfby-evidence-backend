import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import DataTable from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';

const ROLE_OPTIONS = [
  { key: 'super_admin', label: 'Super Admin' },
  { key: 'manager', label: 'State/District Manager' },
  { key: 'surveyor', label: 'Surveyor' },
];

const emptyForm = { name: '', email: '', phone: '', password: '', roleKey: 'surveyor', scopeStateId: '', scopeDistrictId: '' };

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  async function load() {
    const res = await api.get('/users');
    setUsers(res.data.users);
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.post('/users', form);
      setMessage(`User ${form.name} created.`);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user');
    }
  }

  async function toggleActive(u) {
    setError(null);
    try {
      await api.patch(`/users/${u.id}`, { isActive: !u.is_active });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update user');
    }
  }

  const [districtDraft, setDistrictDraft] = useState({}); // userId -> text input value

  async function addHomeDistrict(u) {
    const value = (districtDraft[u.id] || '').trim();
    if (!value) return;
    const current = u.home_district_ids || [];
    if (current.includes(value)) return;
    setError(null);
    try {
      await api.patch(`/users/${u.id}`, { homeDistrictIds: [...current, value] });
      setDistrictDraft({ ...districtDraft, [u.id]: '' });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update home districts');
    }
  }

  async function removeHomeDistrict(u, districtId) {
    setError(null);
    try {
      await api.patch(`/users/${u.id}`, { homeDistrictIds: (u.home_district_ids || []).filter((d) => d !== districtId) });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update home districts');
    }
  }

  async function handleDelete(u) {
    setError(null);
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete user ${u.name}? This cannot be undone from this screen.`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete user');
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Create User</h2>
        <form onSubmit={handleCreate} className="flex-row" style={{ flexWrap: 'wrap' }}>
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input placeholder="Temporary password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <select value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
            {ROLE_OPTIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <input placeholder="Scope State ID (managers)" value={form.scopeStateId} onChange={(e) => setForm({ ...form, scopeStateId: e.target.value })} />
          <input placeholder="Scope District ID (managers)" value={form.scopeDistrictId} onChange={(e) => setForm({ ...form, scopeDistrictId: e.target.value })} />
          <button className="primary" type="submit">Create User</button>
        </form>
        {error && <div className="error-text">{error}</div>}
        {message && <div style={{ color: 'var(--success)', marginTop: 8 }}>{message}</div>}
      </div>

      <div className="card">
        <h2>All Users</h2>
        <p className="help-text">
          Deactivating a user revokes their access immediately (checked fresh on every
          request, not just at next login). Deleting is a soft delete — their past
          actions remain in the audit trail. You cannot deactivate or delete your own
          account.
        </p>
        <DataTable
          searchKeys={['name', 'email', 'role_key']}
          columns={[
            { key: 'name', label: 'Name', sortable: true },
            { key: 'email', label: 'Email', sortable: true },
            { key: 'phone', label: 'Phone', render: (u) => u.phone || '-' },
            { key: 'role_key', label: 'Role', sortable: true },
            { key: 'scope', label: 'Scope', render: (u) => u.scope_district_id || u.scope_state_id || '-' },
            {
              key: 'home_district_ids',
              label: 'Home Districts (Auto-Assign)',
              render: (u) => (u.role_key !== 'surveyor' ? <span className="help-text">n/a</span> : (
                <div>
                  <div className="chip-select" style={{ marginBottom: 6 }}>
                    {(u.home_district_ids || []).length === 0 && <span className="help-text">none set</span>}
                    {(u.home_district_ids || []).map((d) => (
                      <span className="chip selected" key={d}>
                        {d}
                        <button type="button" onClick={() => removeHomeDistrict(u, d)} title="Remove">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex-row" style={{ gap: 6 }}>
                    <input
                      style={{ width: 110 }}
                      placeholder="District ID"
                      value={districtDraft[u.id] || ''}
                      onChange={(e) => setDistrictDraft({ ...districtDraft, [u.id]: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHomeDistrict(u); } }}
                    />
                    <button type="button" className="secondary" onClick={() => addHomeDistrict(u)}>Add</button>
                  </div>
                </div>
              )),
            },
            { key: 'is_active', label: 'Status', render: (u) => <StatusBadge status={u.is_active ? 'active' : 'deactivated'} /> },
            {
              key: 'actions',
              label: '',
              render: (u) => (u.id !== currentUser?.id ? (
                <>
                  <button className="secondary" onClick={() => toggleActive(u)}>
                    {u.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                  {' '}
                  <button className="secondary" onClick={() => handleDelete(u)}>Delete</button>
                </>
              ) : <span className="help-text">(you)</span>),
            },
          ]}
          rows={users}
          emptyMessage="No users yet."
        />
      </div>
    </div>
  );
}
