import { useEffect, useState } from 'react';
import { ShieldAlert, Flag, GitMerge, History, Lock } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Card from '../components/Card';
import DataGrid from '../components/DataGrid';
import { StatusBadge } from '../components/StatusBadge';

export default function ReviewQueuePage() {
  const { user } = useAuth();
  const [flags, setFlags] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [concerns, setConcerns] = useState([]);
  const [surveyorHistory, setSurveyorHistory] = useState([]);

  async function load() {
    const [f, i, c, h] = await Promise.all([
      api.get('/cases/discrepancy-flags'),
      api.get('/emergency-incidents'),
      api.get('/cases/reports/docket-conflicts'),
      api.get('/reports/surveyor-history'),
    ]);
    setFlags(f.data.flags);
    setIncidents(i.data.incidents);
    setConflicts(c.data.conflicts);
    setSurveyorHistory(h.data.surveyorHistory);
    if (user?.roleKey === 'super_admin') {
      const concernsRes = await api.get('/integrity-concerns');
      setConcerns(concernsRes.data.concerns);
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function resolveIncident(id) {
    await api.patch(`/emergency-incidents/${id}/resolve`, { resolutionNotes: 'Reviewed by manager/admin via admin-web' });
    await load();
  }

  async function reviewFlag(id) {
    await api.patch(`/cases/discrepancy-flags/${id}/review`, { resolutionNotes: 'Reviewed via admin-web' });
    await load();
  }

  return (
    <div>
      <Card title="Emergency / Forceful-Survey Incidents" icon={ShieldAlert} accent="rose">
        <p className="help-text">A flagged case can't be reassigned/closed until resolved here.</p>
        <DataGrid
          columns={[
            { key: 'incident_type', label: 'Type', sortable: true },
            { key: 'status', label: 'Status', sortable: true, render: (i) => <StatusBadge status={i.status} /> },
            { key: 'started_at', label: 'Started', sortable: true, render: (i) => new Date(i.started_at).toLocaleString() },
            { key: 'review', label: 'Review', sortable: false, render: (i) => (i.resolved_at ? <StatusBadge status="completed" /> : <span className="badge denied">Needs review</span>) },
            { key: 'actions', label: '', sortable: false, render: (i) => (!i.resolved_at && <button className="secondary sm" onClick={() => resolveIncident(i.id)}>Mark Reviewed</button>) },
          ]}
          rows={incidents}
          emptyMessage="No emergency incidents."
          height={320}
        />
      </Card>

      <Card title="Suspected Discrepancy Flags" icon={Flag} accent="amber">
        <DataGrid
          columns={[
            { key: 'reason', label: 'Reason', sortable: true },
            { key: 'description', label: 'Description', sortable: false },
            { key: 'status', label: 'Status', sortable: true, render: (f) => <StatusBadge status={f.status} /> },
            { key: 'actions', label: '', sortable: false, render: (f) => (f.status === 'pending' && <button className="secondary sm" onClick={() => reviewFlag(f.id)}>Mark Reviewed</button>) },
          ]}
          rows={flags}
          emptyMessage="No discrepancy flags."
          height={320}
        />
      </Card>

      <Card title="Docket Conflict Warnings" icon={GitMerge} accent="violet">
        <p className="help-text">Same Docket_ID2 across multiple source surveyors — possible stale attempts.</p>
        <DataGrid
          columns={[
            { key: 'docket_id2', label: 'Docket ID2', sortable: true },
            { key: 'case_row_count', label: 'Case rows', sortable: true },
            { key: 'distinct_source_surveyors', label: 'Distinct source surveyors', sortable: true },
          ]}
          rows={conflicts}
          emptyMessage="No docket conflicts."
          height={300}
        />
      </Card>

      <Card title="Per-Surveyor History" icon={History} accent="teal">
        <DataGrid
          columns={[
            { key: 'name', label: 'Surveyor', sortable: true },
            { key: 'disputes_count', label: 'Disputes', sortable: true },
            { key: 'fraud_flags_raised_count', label: 'Fraud flags raised', sortable: true },
            { key: 'emergencies_count', label: 'Emergencies', sortable: true },
          ]}
          rows={surveyorHistory}
          emptyMessage="No surveyor history yet."
          height={320}
        />
      </Card>

      {user?.roleKey === 'super_admin' && (
        <Card title="Integrity Concerns (Confidential — Super Admin only)" icon={Lock} accent="navy">
          <DataGrid
            columns={[
              { key: 'description', label: 'Description', sortable: false, flex: 2 },
              { key: 'created_at', label: 'Reported At', sortable: true, render: (c) => new Date(c.created_at).toLocaleString() },
            ]}
            rows={concerns}
            emptyMessage="No integrity concerns reported."
            height={280}
          />
        </Card>
      )}
    </div>
  );
}
