import { useEffect, useState } from 'react';
import { MessageSquare, Plus, Trash2, Edit3, Check, X } from 'lucide-react';
import { api } from '../api/client';
import Card from '../components/Card';

const CHANNELS = ['sms', 'internal'];

function TemplateCard({ t, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(t.body_template);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await api.patch(`/templates/${t.id}`, { bodyTemplate: draft });
    setSaving(false);
    setEditing(false);
    onUpdated();
  }

  async function del() {
    if (!window.confirm(`Delete template "${t.name}"? It will be hidden from the app.`)) return;
    await api.delete(`/templates/${t.id}`);
    onDeleted();
  }

  const accentColors = {
    FORMAT_1_DENIED: '#ef4444', FORMAT_2_POSTPONED: '#f59e0b',
    FORMAT_3_WRONG_NUMBER: '#8b5cf6', FORMAT_4_INCIDENT: '#3b82f6',
  };
  const accent = accentColors[t.code] || '#0d9488';

  return (
    <div style={{
      background: '#fff', borderRadius: 14, marginBottom: 18,
      boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
      border: `1px solid #f0f0f0`, overflow: 'hidden',
    }}>
      <div style={{
        background: accent, padding: '14px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{t.name}</div>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 }}>
            {t.code} · {t.channel?.toUpperCase()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!editing && (
            <button onClick={() => { setEditing(true); setDraft(t.body_template); }} style={{
              background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8,
              padding: '6px 12px', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
            }}>
              <Edit3 size={13} /> Edit
            </button>
          )}
          <button onClick={del} style={{
            background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 8,
            padding: '6px 12px', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
          }}>
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
      <div style={{ padding: 18 }}>
        {editing ? (
          <>
            <textarea rows={10} value={draft} onChange={(e) => setDraft(e.target.value)}
              style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, borderRadius: 8, border: '1.5px solid #e0e0e0', padding: 10, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={save} disabled={saving} style={{
                background: accent, color: '#fff', border: 'none', borderRadius: 8,
                padding: '8px 18px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <Check size={14} /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} style={{
                background: '#f3f4f6', border: 'none', borderRadius: 8,
                padding: '8px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <X size={14} /> Cancel
              </button>
            </div>
          </>
        ) : (
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: '#374151', margin: 0 }}>
            {t.body_template}
          </pre>
        )}
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', channel: 'sms', bodyTemplate: '' });
  const [error, setError] = useState(null);

  async function load() {
    const res = await api.get('/templates');
    setTemplates(res.data.templates);
  }
  useEffect(() => { load(); }, []);

  async function createTemplate(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/templates', form);
      setCreating(false);
      setForm({ name: '', code: '', channel: 'sms', bodyTemplate: '' });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create template');
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        borderRadius: 16, padding: '24px 28px', marginBottom: 24, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 12, padding: 10 }}>
            <MessageSquare size={24} />
          </div>
          <div>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 20 }}>Message Templates</h2>
            <p style={{ margin: 0, opacity: 0.85, fontSize: 13 }}>
              {templates.length} templates · All are shown in the mobile app automatically
            </p>
          </div>
        </div>
        <button onClick={() => setCreating(!creating)} style={{
          background: 'rgba(255,255,255,0.2)', border: '1.5px solid rgba(255,255,255,0.4)',
          borderRadius: 10, padding: '10px 20px', color: '#fff', cursor: 'pointer',
          fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14,
        }}>
          <Plus size={16} /> New Template
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div style={{
          background: '#fff', borderRadius: 14, padding: 24, marginBottom: 20,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)', border: '2px solid #667eea',
        }}>
          <h3 style={{ margin: '0 0 16px', color: '#4c1d95' }}>Create New Template</h3>
          {error && <div style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 13 }}>{error}</div>}
          <form onSubmit={createTemplate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4 }}>Template Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Survey Reminder" required style={{ borderRadius: 8, border: '1.5px solid #e0e0e0', padding: '8px 12px', fontSize: 13, width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4 }}>Code (unique)</label>
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. FORMAT_5_REMINDER" required style={{ borderRadius: 8, border: '1.5px solid #e0e0e0', padding: '8px 12px', fontSize: 13, width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4 }}>Channel</label>
                <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}
                  style={{ borderRadius: 8, border: '1.5px solid #e0e0e0', padding: '8px 12px', fontSize: 13, width: '100%' }}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                Template Body <span style={{ color: '#9ca3af', fontWeight: 400 }}>(use {'{Farmer_Name}'}, {'{Attempt_No}'}, {'{Village_Name}'}, {'{Original_Survey_Date}'}, {'{Surveyor_Name}'}, {'{Surveyor_Mobile}'} etc.)</span>
              </label>
              <textarea rows={8} value={form.bodyTemplate} onChange={(e) => setForm({ ...form, bodyTemplate: e.target.value })}
                placeholder="किसान सर्वे की सूचना:&#10;किसान का नाम: {Farmer_Name}&#10;..." required
                style={{ width: '100%', borderRadius: 8, border: '1.5px solid #e0e0e0', padding: 10, fontSize: 13, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" style={{
                background: 'linear-gradient(135deg, #667eea, #764ba2)', color: '#fff', border: 'none',
                borderRadius: 8, padding: '10px 24px', fontWeight: 700, cursor: 'pointer', fontSize: 14,
              }}>Create Template</button>
              <button type="button" onClick={() => setCreating(false)} style={{
                background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontSize: 14,
              }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      {templates.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          No templates yet. Click <strong>New Template</strong> to create one.
        </div>
      )}
      {templates.map((t) => (
        <TemplateCard key={t.id} t={t} onUpdated={load} onDeleted={load} />
      ))}
    </div>
  );
}
