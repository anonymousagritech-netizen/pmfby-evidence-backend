import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { api } from '../api/client';
import Card from '../components/Card';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');

  async function load() {
    const res = await api.get('/templates');
    setTemplates(res.data.templates);
  }
  useEffect(() => { load(); }, []);

  function startEdit(t) {
    setEditing(t.id);
    setDraft(t.body_template);
  }

  async function save(id) {
    await api.patch(`/templates/${id}`, { bodyTemplate: draft });
    setEditing(null);
    await load();
  }

  return (
    <Card title="Message Templates" icon={MessageSquare} accent="sky">
      <p className="help-text">4 Hindi formats, seeded verbatim. Format 4 (Incident) is internal-only.</p>
      {templates.length === 0 && (
        <div style={{ minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--neutral-500)', fontSize: 13 }}>
          No templates loaded yet.
        </div>
      )}
      {templates.map((t) => (
        <div key={t.id} className="card" style={{ background: 'var(--neutral-50)' }}>
          <strong>{t.name}</strong> <span className="help-text">({t.code} · {t.channel})</span>
          {editing === t.id ? (
            <>
              <textarea rows={10} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ marginTop: 8 }} />
              <div style={{ marginTop: 8 }}>
                <button className="primary sm" onClick={() => save(t.id)}>Save</button>{' '}
                <button className="secondary sm" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13 }}>{t.body_template}</pre>
              <button className="secondary sm" onClick={() => startEdit(t)}>Edit</button>
            </>
          )}
        </div>
      ))}
    </Card>
  );
}
