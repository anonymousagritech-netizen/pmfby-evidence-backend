import { useEffect, useState } from 'react';
import { MapPin, Users, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import DataGrid from '../components/DataGrid';

export default function AssignmentsPage() {
  const [villages, setVillages] = useState([]);
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [selectedVillage, setSelectedVillage] = useState(null);
  const [selectedUser, setSelectedUser] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function loadAll() {
    const [v, u, a] = await Promise.all([
      api.get('/assignments/village-summary'),
      api.get('/users'),
      api.get('/assignments'),
    ]);
    setVillages(v.data.villages || []);
    setUsers((u.data.users || []).filter((usr) => usr.role_key === 'surveyor'));
    setAssignments(a.data.assignments || []);
  }
  useEffect(() => { loadAll(); }, []);

  async function assignVillage(e) {
    e.preventDefault();
    if (!selectedVillage || !selectedUser) return;
    setAssigning(true); setError(null); setResult(null);
    try {
      const res = await api.post('/assignments/by-village', {
        villageId: selectedVillage.village_id,
        villageName: selectedVillage.village_name,
        userId: selectedUser,
      });
      setResult(`✓ Assigned ${res.data.assigned} of ${res.data.total} farmers in ${selectedVillage.village_name}`);
      setSelectedVillage(null); setSelectedUser('');
      await loadAll();
    } catch (err) {
      setError(err.response?.data?.error || 'Assignment failed');
    } finally {
      setAssigning(false);
    }
  }

  const totalCases = villages.reduce((s, v) => s + Number(v.case_count || 0), 0);
  const totalAssigned = villages.reduce((s, v) => s + Number(v.assigned_count || 0), 0);
  const totalVillages = villages.length;

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Villages', value: totalVillages, color: '#6366f1', icon: MapPin },
          { label: 'Total Cases', value: totalCases, color: '#0d9488', icon: Users },
          { label: 'Assigned Farmers', value: totalAssigned, color: '#f59e0b', icon: CheckCircle },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} style={{
            background: '#fff', borderRadius: 14, padding: '20px 24px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            borderTop: `4px solid ${color}`,
            display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <div style={{ background: color, borderRadius: 10, padding: 10, color: '#fff' }}>
              <Icon size={20} />
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#111' }}>{value}</div>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Village-wise assignment */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2a4a 0%, #1e4976 100%)',
        borderRadius: 16, padding: '24px 28px', marginBottom: 24, color: '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 10 }}>
            <MapPin size={22} />
          </div>
          <div>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 19 }}>Assign by Village</h2>
            <p style={{ margin: 0, opacity: 0.8, fontSize: 13 }}>Select a village → all farmers in it get assigned to the surveyor</p>
          </div>
        </div>

        <form onSubmit={assignVillage} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '2 1 280px' }}>
            <label style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 6 }}>
              Village (click row below to select)
            </label>
            <div style={{
              background: selectedVillage ? 'rgba(13,148,136,0.3)' : 'rgba(255,255,255,0.1)',
              border: `1.5px solid ${selectedVillage ? '#0d9488' : 'rgba(255,255,255,0.25)'}`,
              borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 14, minHeight: 40,
            }}>
              {selectedVillage
                ? `${selectedVillage.village_name} (${selectedVillage.case_count} cases)`
                : 'No village selected — click a row in the table below'}
            </div>
          </div>
          <div style={{ flex: '2 1 240px' }}>
            <label style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 6 }}>
              Assign to Surveyor
            </label>
            <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} required
              style={{ borderRadius: 10, border: '1.5px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.1)', color: '#fff', padding: '10px 14px', fontSize: 14, width: '100%' }}>
              <option value="" style={{ color: '#000' }}>Select surveyor…</option>
              {users.map((u) => <option key={u.id} value={u.id} style={{ color: '#000' }}>{u.name} ({u.phone})</option>)}
            </select>
          </div>
          <button type="submit" disabled={assigning || !selectedVillage || !selectedUser}
            style={{
              background: assigning ? '#6b7280' : 'linear-gradient(135deg, #0d9488, #0f766e)',
              border: 'none', borderRadius: 10, padding: '11px 28px', color: '#fff',
              fontWeight: 700, cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8,
              opacity: (!selectedVillage || !selectedUser) ? 0.5 : 1,
            }}>
            {assigning ? <><RefreshCw size={14} className="spin" /> Assigning…</> : 'Assign All'}
          </button>
        </form>

        {result && <div style={{ marginTop: 14, background: 'rgba(13,148,136,0.3)', borderRadius: 10, padding: '10px 16px', color: '#fff', fontWeight: 600 }}>{result}</div>}
        {error && <div style={{ marginTop: 14, background: 'rgba(239,68,68,0.3)', borderRadius: 10, padding: '10px 16px', color: '#fff' }}><AlertCircle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />{error}</div>}
      </div>

      {/* Village table */}
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', overflow: 'hidden', marginBottom: 24 }}>
        <div style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <MapPin size={18} style={{ color: '#fff' }} />
          <h3 style={{ margin: 0, color: '#fff', fontSize: 16 }}>Village-wise Case Summary</h3>
          <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>{villages.length} villages · click to select</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8f9ff' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', color: '#6366f1', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Village</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', color: '#6366f1', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Farmers</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', color: '#6366f1', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cases</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', color: '#6366f1', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Assigned</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', color: '#6366f1', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Surveyor</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', color: '#6366f1', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {villages.map((v) => {
                const isSelected = selectedVillage?.village_id === v.village_id;
                const pct = v.farmer_count > 0 ? Math.round((v.assigned_count / v.farmer_count) * 100) : 0;
                return (
                  <tr key={v.village_id || v.village_name}
                    onClick={() => setSelectedVillage(isSelected ? null : v)}
                    style={{
                      background: isSelected ? '#ede9fe' : 'transparent',
                      cursor: 'pointer', borderBottom: '1px solid #f3f4f6',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#f8f9ff'; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <MapPin size={13} style={{ color: '#8b5cf6', flexShrink: 0 }} />
                        {v.village_name || '—'}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span style={{ background: '#e0e7ff', color: '#3730a3', borderRadius: 20, padding: '2px 10px', fontWeight: 700, fontSize: 12 }}>{v.farmer_count}</span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span style={{ background: '#dcfce7', color: '#166534', borderRadius: 20, padding: '2px 10px', fontWeight: 700, fontSize: 12 }}>{v.case_count}</span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                        <div style={{ width: 60, height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#22c55e' : '#f59e0b', borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: pct === 100 ? '#16a34a' : '#92400e' }}>{v.assigned_count}/{v.farmer_count}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#6b7280', fontSize: 13 }}>
                      {v.assigned_to_name || <span style={{ color: '#d1d5db' }}>Unassigned</span>}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <button onClick={(e) => { e.stopPropagation(); setSelectedVillage(v); }}
                        style={{
                          background: isSelected ? '#7c3aed' : '#6366f1', color: '#fff',
                          border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        }}>
                        {isSelected ? '✓ Selected' : 'Select'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {villages.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>No village data. Import an Excel file first.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Current assignments */}
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)', padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle size={18} style={{ color: '#fff' }} />
          <h3 style={{ margin: 0, color: '#fff', fontSize: 16 }}>Active Assignments</h3>
          <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>{assignments.length} records</span>
        </div>
        <div style={{ padding: 0 }}>
          <DataGrid
            columns={[
              { key: 'farmer_name', label: 'Farmer', sortable: true },
              { key: 'village_name', label: 'Village', sortable: true },
              { key: 'assigned_to_name', label: 'Assigned To', sortable: true },
              { key: 'assigned_at', label: 'Assigned At', sortable: true, render: (a) => new Date(a.assigned_at).toLocaleString('en-IN') },
            ]}
            rows={assignments}
            searchKeys={['farmer_name', 'village_name', 'assigned_to_name']}
            emptyMessage="No active assignments."
          />
        </div>
      </div>
    </div>
  );
}
