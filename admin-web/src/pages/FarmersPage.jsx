import { useEffect, useState } from 'react';
import { ClipboardList, UserSquare2, Search } from 'lucide-react';
import { api } from '../api/client';
import DataGrid from '../components/DataGrid';
import Card from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';

export default function FarmersPage() {
  const [farmers, setFarmers] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;
  const [selected, setSelected] = useState(null);
  const [cases, setCases] = useState([]);

  async function load() {
    const res = await api.get('/farmers', { params: { search: search || undefined, page, pageSize } });
    setFarmers(res.data.farmers);
    setTotal(res.data.total ?? res.data.farmers.length);
  }

  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  function runSearch(e) {
    e.preventDefault();
    setPage(1);
    load();
  }

  async function openFarmer(id) {
    const res = await api.get(`/farmers/${id}`);
    setSelected(res.data.farmer);
    setCases(res.data.cases);
  }

  const columns = [
    { key: 'farmer_name', label: 'Name', sortable: true },
    { key: 'village_name', label: 'Village', sortable: true },
    { key: 'district_name', label: 'District', sortable: true },
    { key: 'farmer_mobile', label: 'Mobile', render: (f) => f.farmer_mobile || <span className="help-text">not entered</span> },
    { key: 'assigned_user_id', label: 'Assigned', render: (f) => (f.assigned_user_id ? <span className="badge active">Assigned</span> : <span className="help-text">Unassigned</span>) },
    { key: 'actions', label: '', sortable: false, render: (f) => <button className="secondary" onClick={() => openFarmer(f.id)}>View</button> },
  ];

  return (
    <div>
      <Card title="Farmers & Case Database" icon={ClipboardList} accent="navy">
        <form onSubmit={runSearch} className="flex-row" style={{ marginBottom: 14 }}>
          <input placeholder="Search by name or village" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="secondary" type="submit"><Search size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Search</button>
        </form>
        <DataGrid
          columns={columns}
          rows={farmers}
          serverPagination={{ page, pageSize, total, onPageChange: setPage }}
          emptyMessage="No farmers found."
        />
      </Card>

      {selected && (
        <Card title={`${selected.farmer_name} — ${selected.village_name}`} icon={UserSquare2} accent="teal">
          <DataGrid
            columns={[
              { key: 'docket_id2', label: 'Docket', sortable: true },
              { key: 'scheme_name', label: 'Scheme', sortable: true },
              { key: 'survey_status', label: 'Status', sortable: true },
              { key: 'attempt_count', label: 'Attempts', sortable: true },
              { key: 'contact_status', label: 'Contact Status', sortable: true, render: (c) => <StatusBadge status={c.contact_status} /> },
            ]}
            rows={cases}
            searchKeys={['docket_id2', 'scheme_name']}
            emptyMessage="No cases for this farmer."
            height={320}
          />
        </Card>
      )}
    </div>
  );
}
