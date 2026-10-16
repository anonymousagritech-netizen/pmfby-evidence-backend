import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function FarmersPage() {
  const [farmers, setFarmers] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [cases, setCases] = useState([]);

  async function load() {
    const res = await api.get('/farmers', { params: { search: search || undefined } });
    setFarmers(res.data.farmers);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openFarmer(id) {
    const res = await api.get(`/farmers/${id}`);
    setSelected(res.data.farmer);
    setCases(res.data.cases);
  }

  return (
    <div>
      <div className="card">
        <h2>Farmers &amp; Case Database</h2>
        <div className="flex-row" style={{ marginBottom: 12 }}>
          <input placeholder="Search by name or village" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="secondary" onClick={load}>Search</button>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Village</th><th>District</th><th>Mobile</th><th>Assigned To</th><th></th></tr></thead>
          <tbody>
            {farmers.map((f) => (
              <tr key={f.id}>
                <td>{f.farmer_name}</td>
                <td>{f.village_name}</td>
                <td>{f.district_name}</td>
                <td>{f.farmer_mobile || <span className="help-text">not entered</span>}</td>
                <td>{f.assigned_user_id ? 'Assigned' : <span className="help-text">Unassigned</span>}</td>
                <td><button className="secondary" onClick={() => openFarmer(f.id)}>View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="card">
          <h3>{selected.farmer_name} — {selected.village_name}</h3>
          <table>
            <thead><tr><th>Docket</th><th>Scheme</th><th>Status</th><th>Attempts</th><th>Contact Status</th></tr></thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td>{c.docket_id2}</td>
                  <td>{c.scheme_name}</td>
                  <td>{c.survey_status}</td>
                  <td>{c.attempt_count}</td>
                  <td><span className={`badge ${c.contact_status}`}>{c.contact_status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
