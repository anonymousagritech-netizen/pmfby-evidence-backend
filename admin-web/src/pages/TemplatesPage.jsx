import { useEffect, useState } from 'react';
import { api } from '../api/client';

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
    <div className="card">
      <h2>Message Templates</h2>
      <p className="help-text">
        4 Hindi formats (seeded verbatim from spec). Format 4 (Incident) is channel
        &quot;internal&quot; — it is never offered in the mobile SMS composer flow.
      </p>
      {templates.map((t) => (
        <div key={t.id} className="card" style={{ background: 'var(--gray-50)' }}>
          <strong>{t.name}</strong> <span className="help-text">({t.code} · {t.channel})</span>
          {editing === t.id ? (
            <>
              <textarea rows={10} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ marginTop: 8 }} />
              <div style={{ marginTop: 8 }}>
                <button className="primary" onClick={() => save(t.id)}>Save</button>{' '}
                <button className="secondary" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13 }}>{t.body_template}</pre>
              <button className="secondary" onClick={() => startEdit(t)}>Edit</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
