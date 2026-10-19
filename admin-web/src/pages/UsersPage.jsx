import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Users as UsersIcon, UploadCloud, MapPin, KeyRound, Download } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import DataGrid from '../components/DataGrid';
import Card from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';

// mobile,email,temp_password CSV for the credentials just shown once after a bulk
// import commit — this is the ONLY export path for these plaintext passwords; nothing
// server-side ever stores or re-serves them after the commit response.
function downloadCredentialsCsv(credentials) {
  const header = 'mobile,email,temp_password\n';
  const rows = credentials.map((c) => `${c.mobile},${c.email},${c.tempPassword}`).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `surveyor-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Downloads a server-generated blank/example .xlsx (template) for an Excel upload
// feature — reused by both the case-import and bulk-surveyor-import "Download
// Template" buttons.
async function downloadTemplate(path, filename) {
  const res = await api.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
        Columns: districtName, surveyorName, surveyorMobile, Status (+ optional email, password). Deduped by mobile; Status drives create/activate/deactivate/delete.
      </p>
      <div className="flex-row" style={{ flexWrap: 'wrap' }}>
        <input type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={busy} />
        <button type="button" className="secondary sm" onClick={() => downloadTemplate('/users/bulk-import/template', 'surveyor-import-template.xlsx')}>
          <Download size={12} style={{ verticalAlign: -1, marginRight: 4 }} />Download Template
        </button>
      </div>
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
          {result.credentials.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="flex-row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <KeyRound size={14} /> New login credentials ({result.credentials.length})
                </h3>
                <button type="button" className="secondary sm" onClick={() => downloadCredentialsCsv(result.credentials)}>
                  <Download size={12} style={{ verticalAlign: -1, marginRight: 4 }} />Download CSV
                </button>
              </div>
              <p className="help-text">Shown once — not recoverable after you leave this page. Save or share now.</p>
              <DataGrid
                columns={[
                  { key: 'mobile', label: 'Mobile', sortable: true },
                  { key: 'name', label: 'Name', sortable: true },
                  { key: 'email', label: 'Login Email', sortable: true },
                  { key: 'tempPassword', label: 'Temp Password', sortable: false, render: (c) => <code>{c.tempPassword}</code> },
                ]}
                rows={result.credentials}
                emptyMessage="No new accounts created."
                height={Math.min(300, 60 + result.credentials.length * 42)}
              />
            </div>
          )}
          {result.warnings.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3>Data-quality warnings</h3>
              <DataGrid
                columns={[
                  { key: 'mobile', label: 'Mobile', sortable: true },
                  { key: 'name', label: 'Name', sortable: true },
                  { key: 'statusValuesSeen', label: 'Status values seen', sortable: false, render: (w) => w.statusValuesSeen.join(', ') },
                  { key: 'resolvedTo', label: 'Resolved to', sortable: true },
                ]}
                rows={result.warnings}
                emptyMessage="No conflicts."
                height={Math.min(280, 60 + result.warnings.length * 42)}
              />
            </div>
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
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [resetResult, setResetResult] = useState(null);
  const [resetting, setResetting] = useState(false);

  async function load() {
    const res = await api.get('/users');
    setUsers(res.data.users);
  }
  useEffect(() => { load(); }, []);

  // Bootstraps accounts whose password nobody has (e.g. the 121 real surveyors
  // created by the first bulk import, before the show-once-at-creation fix existed —
  // their passwords were generated, hashed, and never shown to anyone, so a reset is
  // the only way back in). Works for one selected user or many at once.
  async function handleBulkReset() {
    if (selectedUsers.length === 0) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Reset the password for ${selectedUsers.length} user(s)? Their current password (whatever it is) will stop working immediately.`)) return;
    setResetting(true);
    setError(null);
    setResetResult(null);
    try {
      const res = await api.post('/users/bulk-reset-password', { userIds: selectedUsers.map((u) => u.id) });
      setResetResult(res.data);
      setSelectedUsers([]);
    } catch (err) {
      setError(err.response?.data?.error || 'Password reset failed');
    } finally {
      setResetting(false);
    }
  }

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

      {/* Create User – colorful card */}
      <div style={{
        background: '#fff', borderRadius: 16, marginBottom: 22,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)', overflow: 'hidden',
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #6d28d9, #4f46e5)',
          padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 10, padding: 9 }}>
            <UserPlus size={20} style={{ color: '#fff' }} />
          </div>
          <div>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 17 }}>Create New User</h2>
            <p style={{ margin: 0, opacity: 0.8, fontSize: 12.5 }}>Add a surveyor, manager or admin account</p>
          </div>
        </div>
        <div style={{ padding: 24 }}>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <label>Full Name *</label>
                <input placeholder="e.g. Ramesh Kumar" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label>Email Address *</label>
                <input type="email" placeholder="user@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </div>
              <div>
                <label>Mobile Phone</label>
                <input placeholder="+91XXXXXXXXXX" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div>
                <label>Temporary Password *</label>
                <input type="password" placeholder="Min 8 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </div>
              <div>
                <label>Role *</label>
                <select value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
                  {ROLE_OPTIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label>Scope District ID <span style={{ fontWeight: 400, textTransform: 'none' }}>(managers)</span></label>
                <input placeholder="e.g. D001" value={form.scopeDistrictId} onChange={(e) => setForm({ ...form, scopeDistrictId: e.target.value })} />
              </div>
            </div>
            {error && <div style={{ background: '#fee2e2', color: '#b42318', borderRadius: 10, padding: '10px 16px', marginBottom: 14, fontSize: 13, fontWeight: 600 }}>{error}</div>}
            {message && <div style={{ background: '#dcfce7', color: '#15803d', borderRadius: 10, padding: '10px 16px', marginBottom: 14, fontSize: 13, fontWeight: 600 }}>{message}</div>}
            <button type="submit" style={{
              background: 'linear-gradient(135deg, #6d28d9, #4f46e5)', color: '#fff', border: 'none',
              borderRadius: 10, padding: '11px 28px', fontWeight: 700, cursor: 'pointer', fontSize: 14,
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              <UserPlus size={15} /> Create User
            </button>
          </form>
        </div>
      </div>

      <Card title="All Users" icon={UsersIcon} accent="navy">
        <p className="help-text">Deactivate/delete revoke access immediately; both are reversible. You can't act on your own account.</p>

        <div className="flex-row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
          <span className="help-text">{selectedUsers.length} selected</span>
          <button type="button" className="secondary sm" disabled={selectedUsers.length === 0 || resetting} onClick={handleBulkReset}>
            <KeyRound size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
            Reset Password{selectedUsers.length === 1 ? '' : 's'} for Selected
          </button>
        </div>

        {resetResult && (
          <div style={{ marginBottom: 16 }}>
            <div className="flex-row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <KeyRound size={14} /> New passwords ({resetResult.resetCount})
              </h3>
              <button type="button" className="secondary sm" onClick={() => downloadCredentialsCsv(resetResult.credentials)}>
                <Download size={12} style={{ verticalAlign: -1, marginRight: 4 }} />Download CSV
              </button>
            </div>
            <p className="help-text">Shown once — not recoverable after you leave this page.</p>
            <DataGrid
              columns={[
                { key: 'mobile', label: 'Mobile', sortable: true, render: (c) => c.mobile || '-' },
                { key: 'name', label: 'Name', sortable: true },
                { key: 'email', label: 'Login Email', sortable: true },
                { key: 'tempPassword', label: 'New Password', sortable: false, render: (c) => <code>{c.tempPassword}</code> },
              ]}
              rows={resetResult.credentials}
              emptyMessage="No passwords reset."
              height={Math.min(300, 60 + resetResult.credentials.length * 42)}
            />
          </div>
        )}

        <DataGrid
          selectable
          onSelectionChanged={setSelectedUsers}
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
