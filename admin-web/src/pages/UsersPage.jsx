import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Users as UsersIcon, UploadCloud, MapPin } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import DataGrid from '../components/DataGrid';
import Card from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';

const ROLE_OPTIONS = [
  { key: 'super_admin', label: 'Super Admin' },
  { key: 'manager', label: 'State/District Manager' },
  { key: 'surveyor', label: 'Surveyor' },
];

const emptyForm = { name: '', email: '', phone: '', password: '', roleKey: 'surveyor', scopeStateId: '', scopeDistrictId: '' };

// Bulk surveyor import: Excel preview -> commit, same two-step pattern as the main
// Excel Import page. Dedupes by mobile and aggregates every district seen for that
// mobile; status (Active/Inactive/Delete) drives create/reactivate/deactivate/delete.
// See backend/src/services/surveyorImportService.js + ROADMAP.md for the full rules.
function BulkSurveyorImportCard({ onImported }) {
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/users/bulk-import/preview', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPreview(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Preview failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function handleCommit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/users/bulk-import/commit', { sessionId: preview.sessionId });
      setResult(res.data);
      setPreview(null);
      onImported?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Bulk Surveyor Import" icon={UploadCloud} accent="teal">
      <p className="help-text">
        Upload an Excel file with columns <code>districtName, surveyorName, surveyorMobile,
        Status (Active/Inactive/Delete)</code>. Rows are deduped by mobile number
        (names can collide, mobile is the stable identifier); every district seen for a
        mobile is collected into that surveyor's home-district list. Status drives the
        account lifecycle: Active creates/reactivates, Inactive deactivates, Delete
        soft-deletes. A mobile not mentioned in a later upload is left untouched.
      </p>
      <input type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={busy} />
      {error && <div className="error-text">{error}</div>}

      {preview && (
        <div style={{ marginTop: 14 }}>
          <p>
            {preview.totalRows} rows → <strong>{preview.uniqueSurveyors}</strong> unique surveyors.
            {preview.conflictCount > 0 && <span className="error-text"> {preview.conflictCount} have conflicting status values across their rows (resolved to the last value seen — see warnings after commit).</span>}
            {preview.noStatusCount > 0 && <span> {preview.noStatusCount} have no usable status value and will be skipped.</span>}
          </p>
          <button type="button" className="primary" disabled={busy} onClick={handleCommit}>Commit Import</button>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 14 }}>
          <h3>Import complete</h3>
          <div className="stat-grid">
            <div className="stat-card" style={{ '--accent': 'var(--p3-dot)' }}>
              <span className="stat-label">Created</span><span className="stat-value">{result.summary.created}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--info)' }}>
              <span className="stat-label">Updated / Reactivated</span><span className="stat-value">{result.summary.updated + result.summary.reactivated}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--amber)' }}>
              <span className="stat-label">Deactivated</span><span className="stat-value">{result.summary.deactivated}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--p1-dot)' }}>
              <span className="stat-label">Deleted</span><span className="stat-value">{result.summary.deleted}</span>
            </div>
            <div className="stat-card" style={{ '--accent': 'var(--neutral-500)' }}>
              <span className="stat-label">Skipped (no status)</span><span className="stat-value">{result.summary.skippedNoStatus}</span>
            </div>
          </div>
          {result.warnings.length > 0 && (
            <>
              <h4>Data-quality warnings: conflicting status values</h4>
              <table>
                <thead><tr><th>Mobile</th><th>Name</th><th>Status values seen</th><th>Resolved to</th></tr></thead>
                <tbody>
                  {result.warnings.map((w) => (
                    <tr key={w.mobile}>
                      <td>{w.mobile}</td><td>{w.name}</td><td>{w.statusValuesSeen.join(', ')}</td><td>{w.resolvedTo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// The district chip editor (chips + text input + Add button) is taller than a fixed
// AG Grid row and was previously rendered inline in the cell — for a surveyor with
// several districts that overflowed the row and visually bled into the row below it
// (a real layout bug, not a style nitpick). Moved out of the grid entirely into a
// small fixed-position popover (portaled to document.body, so the grid's cell overflow
// clipping/row-height model never has to accommodate it) triggered by a compact button
// in the cell — the grid only ever renders a one-line summary.
function HomeDistrictsEditor({ user, districtDraft, setDistrictDraft, onAdd, onRemove }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);

  function openPopover() {
    const rect = btnRef.current.getBoundingClientRect();
    setCoords({ top: rect.bottom + 6, left: rect.left });
    setOpen(true);
  }

  const districts = user.home_district_ids || [];

  return (
    <>
      <button ref={btnRef} type="button" className="secondary" style={{ padding: '4px 10px', fontSize: 12.5 }} onClick={openPopover}>
        <MapPin size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
        {districts.length > 0 ? `${districts.length} district${districts.length === 1 ? '' : 's'}` : 'None set'}
      </button>

      {open && coords && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
            onClick={() => setOpen(false)}
          />
          <div
            className="panel"
            style={{
              position: 'fixed', top: coords.top, left: coords.left, zIndex: 1001,
              width: 300, boxShadow: 'var(--shadow-lg)', margin: 0,
            }}
          >
            <div className="panel-body" style={{ padding: 14 }}>
              <strong style={{ fontSize: 13 }}>Home districts — {user.name}</strong>
              <div className="chip-select" style={{ margin: '10px 0' }}>
                {districts.length === 0 && <span className="help-text">none set</span>}
                {districts.map((d) => (
                  <span className="chip selected" key={d}>
                    {d}
                    <button type="button" onClick={() => onRemove(user, d)} title="Remove">×</button>
                  </span>
                ))}
              </div>
              <div className="flex-row" style={{ gap: 6 }}>
                <input
                  autoFocus
                  placeholder="District ID"
                  value={districtDraft[user.id] || ''}
                  onChange={(e) => setDistrictDraft({ ...districtDraft, [user.id]: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd(user); } }}
                />
                <button type="button" className="secondary sm" onClick={() => onAdd(user)}>Add</button>
              </div>
              <button type="button" className="primary sm" style={{ marginTop: 10, width: '100%' }} onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

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
      <BulkSurveyorImportCard onImported={load} />

      <Card title="Create User" icon={UserPlus} accent="violet">
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
      </Card>

      <Card title="All Users" icon={UsersIcon} accent="navy">
        <p className="help-text">
          Deactivating a user revokes their access immediately (checked fresh on every
          request, not just at next login). Deleting is a soft delete — their past
          actions remain in the audit trail. You cannot deactivate or delete your own
          account.
        </p>
        <DataGrid
          searchKeys={['name', 'email', 'role_key']}
          columns={[
            { key: 'name', label: 'Name', sortable: true },
            { key: 'email', label: 'Email', sortable: true },
            { key: 'phone', label: 'Phone', render: (u) => u.phone || '-' },
            { key: 'role_key', label: 'Role', sortable: true },
            { key: 'scope', label: 'Scope', render: (u) => u.scope_district_id || u.scope_state_id || '-' },
            {
              key: 'home_district_ids',
              label: 'Home Districts',
              sortable: false,
              render: (u) => (u.role_key !== 'surveyor' ? <span className="help-text">n/a</span> : (
                <HomeDistrictsEditor
                  user={u}
                  districtDraft={districtDraft}
                  setDistrictDraft={setDistrictDraft}
                  onAdd={addHomeDistrict}
                  onRemove={removeHomeDistrict}
                />
              )),
            },
            { key: 'is_active', label: 'Status', render: (u) => <StatusBadge status={u.is_active ? 'active' : 'deactivated'} /> },
            {
              key: 'actions',
              label: '',
              render: (u) => (u.id !== currentUser?.id ? (
                <>
                  <button className="secondary sm" onClick={() => toggleActive(u)}>
                    {u.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                  {' '}
                  <button className="secondary sm" onClick={() => handleDelete(u)}>Delete</button>
                </>
              ) : <span className="help-text">(you)</span>),
            },
          ]}
          rows={users}
          emptyMessage="No users yet."
        />
      </Card>
    </div>
  );
}
