import React, { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { api, absUrl, ts } from '../lib.js';
import { Button, Field, Spinner, useAsync, useToast, Empty, Badge, CopyButton, Toggle, Confirm, Tabs } from '../components/ui.jsx';

const QT = { name: 'Name', email: 'Email', text: 'Short text', textarea: 'Long text', select: 'Dropdown', radio: 'Radio', phone: 'Phone', number: 'Number' };
const OPS = { equals: 'is', not_equals: 'is not', contains: 'contains', any_of: 'is any of (comma list)', gte: '≥', lte: '≤', is_empty: 'is empty' };
const rid = () => Math.random().toString(36).slice(2, 8);

export default function RoutingForms() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => Promise.all([api('/routing-forms'), api('/event-types')]).then(([a, b]) => ({ forms: a.forms, ets: [...b.event_types, ...b.team_event_types] })), []);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  if (loading) return <Spinner center />;
  if (edit) return <FormEditor id={edit} ets={data.ets} onBack={() => { setEdit(null); reload(); }} />;
  return (
    <div>
      <div className="page-head">
        <div><h1>Routing forms</h1><p className="muted">Qualify and route invitees to the right event type, page or message based on their answers.</p></div>
        <Button onClick={async () => { const r = await api('/routing-forms', { method: 'POST', body: { name: 'New routing form' } }); setEdit(r.form.id); }}>+ New routing form</Button>
      </div>
      {!data.forms.length ? <div className="card"><Empty icon="🧭" title="No routing forms yet" /></div> : (
        <div className="card">
          <table className="table">
            <thead><tr><th>Name</th><th>Questions</th><th>Rules</th><th>Submissions</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.forms.map((f) => (
              <tr key={f.id}>
                <td><button className="link strong" onClick={() => setEdit(f.id)}>{f.name}</button></td>
                <td>{f.questions.length}</td><td>{f.rules.length}</td><td>{f.submissions}</td>
                <td>{f.active ? <Badge color="green">Active</Badge> : <Badge>Off</Badge>}</td>
                <td className="row gap-sm right"><CopyButton text={absUrl(f.path)} /><a className="btn btn-ghost btn-sm" href={f.path} target="_blank" rel="noreferrer">Open ↗</a><Button size="sm" variant="danger-outline" onClick={() => setDel(f)}>Delete</Button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Confirm open={!!del} danger title="Delete routing form?" confirmLabel="Delete" onClose={() => setDel(null)} onConfirm={async () => { await api(`/routing-forms/${del.id}`, { method: 'DELETE' }); setDel(null); reload(); toast('Deleted'); }} />
    </div>
  );
}

function Action({ value, onChange, ets }) {
  return (
    <div className="row gap-sm wrap">
      <select value={value.type} onChange={(e) => onChange({ type: e.target.value })}>
        <option value="event_type">Show event type</option><option value="url">Redirect to URL</option><option value="message">Show custom message</option>
      </select>
      {value.type === 'event_type' && <select value={value.event_type_id || ''} onChange={(e) => onChange({ ...value, event_type_id: Number(e.target.value) })}><option value="">Choose…</option>{ets.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>}
      {value.type === 'url' && <input placeholder="https://…" value={value.url || ''} onChange={(e) => onChange({ ...value, url: e.target.value })} />}
      {value.type === 'message' && <input placeholder="Message" value={value.message || ''} onChange={(e) => onChange({ ...value, message: e.target.value })} />}
    </div>
  );
}

function FormEditor({ id, ets, onBack }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  const [tab, setTab] = useState('questions');
  const [subs, setSubs] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api('/routing-forms').then((r) => setF(r.forms.find((x) => x.id === id))); }, [id]);
  useEffect(() => { if (tab === 'subs') api(`/routing-forms/${id}/submissions`).then((r) => setSubs(r.submissions)); }, [tab, id]);
  if (!f) return <Spinner center />;
  const up = (p) => setF({ ...f, ...p });
  const save = async () => { setSaving(true); try { await api(`/routing-forms/${id}`, { method: 'PATCH', body: f }); toast('Form saved'); } catch (e) { toast(e.message, 'err'); } setSaving(false); };
  const choiceQs = f.questions;
  return (
    <div>
      <div className="page-head">
        <div className="row gap"><button className="icon-btn" onClick={onBack}>←</button><div><div className="small muted">Routing form</div><h1>{f.name}</h1></div></div>
        <div className="row gap"><CopyButton text={absUrl(f.path)} /><a className="btn btn-ghost" href={f.path} target="_blank" rel="noreferrer">Preview ↗</a><Button onClick={save} loading={saving}>Save</Button></div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'questions', label: 'Questions' }, { value: 'routing', label: 'Routing logic' }, { value: 'subs', label: 'Submissions', count: f.submissions }]} />
      {tab === 'questions' && (
        <div className="card pad stack">
          <div className="grid-2"><Field label="Form name"><input value={f.name} onChange={(e) => up({ name: e.target.value })} /></Field><div className="field"><span className="field-label">&nbsp;</span><Toggle checked={f.active} onChange={(v) => up({ active: v })} label="Form is active" /></div></div>
          <Field label="Description"><textarea rows={2} value={f.description} onChange={(e) => up({ description: e.target.value })} /></Field>
          {f.questions.map((q, i) => (
            <div key={q.id} className="q-row">
              <div className="grid-q">
                <input value={q.label} placeholder="Question" onChange={(e) => { const a = [...f.questions]; a[i] = { ...q, label: e.target.value }; up({ questions: a }); }} />
                <select value={q.type} onChange={(e) => { const a = [...f.questions]; a[i] = { ...q, type: e.target.value }; up({ questions: a }); }}>{Object.entries(QT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <Toggle checked={q.required} onChange={(v) => { const a = [...f.questions]; a[i] = { ...q, required: v }; up({ questions: a }); }} label="Required" />
                <button className="icon-btn" onClick={() => up({ questions: f.questions.filter((_, j) => j !== i) })}>✕</button>
              </div>
              {['select', 'radio'].includes(q.type) && <input className="mt-sm" placeholder="Options, comma separated" defaultValue={(q.options || []).join(', ')} onBlur={(e) => { const a = [...f.questions]; a[i] = { ...q, options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }; up({ questions: a }); }} />}
              <div className="small muted mt-sm">ID: <code>{q.id}</code></div>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => up({ questions: [...f.questions, { id: rid(), type: 'text', label: '', required: false }] })}>+ Add question</Button>
          <p className="small muted">Tip: "Name" and "Email" answers are pre-filled into the booking form when routed to an event type.</p>
        </div>
      )}
      {tab === 'routing' && (
        <div className="card pad stack">
          <p className="muted small">Rules are evaluated top to bottom; the first matching rule wins.</p>
          {f.rules.map((r, i) => (
            <div key={i} className="rule">
              <div className="row between"><input className="rule-name" value={r.name || ''} placeholder={`Rule ${i + 1}`} onChange={(e) => { const a = [...f.rules]; a[i] = { ...r, name: e.target.value }; up({ rules: a }); }} />
                <button className="icon-btn" onClick={() => up({ rules: f.rules.filter((_, j) => j !== i) })}>✕</button></div>
              <div className="row gap-sm small">If <select value={r.match} onChange={(e) => { const a = [...f.rules]; a[i] = { ...r, match: e.target.value }; up({ rules: a }); }}><option value="all">all</option><option value="any">any</option></select> of these conditions match:</div>
              {(r.conditions || []).map((c, k) => (
                <div key={k} className="row gap-sm wrap cond">
                  <select value={c.question_id} onChange={(e) => { const a = structuredClone(f.rules); a[i].conditions[k].question_id = e.target.value; up({ rules: a }); }}>{choiceQs.map((q) => <option key={q.id} value={q.id}>{q.label || q.id}</option>)}</select>
                  <select value={c.op} onChange={(e) => { const a = structuredClone(f.rules); a[i].conditions[k].op = e.target.value; up({ rules: a }); }}>{Object.entries(OPS).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}</select>
                  {c.op !== 'is_empty' && (() => { const q = f.questions.find((x) => x.id === c.question_id); return q?.options?.length && ['equals', 'not_equals'].includes(c.op)
                    ? <select value={c.value} onChange={(e) => { const a = structuredClone(f.rules); a[i].conditions[k].value = e.target.value; up({ rules: a }); }}><option value="">Choose…</option>{q.options.map((o) => <option key={o}>{o}</option>)}</select>
                    : <input value={c.value} onChange={(e) => { const a = structuredClone(f.rules); a[i].conditions[k].value = e.target.value; up({ rules: a }); }} />; })()}
                  <button className="icon-btn" onClick={() => { const a = structuredClone(f.rules); a[i].conditions.splice(k, 1); up({ rules: a }); }}>✕</button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => { const a = structuredClone(f.rules); a[i].conditions = [...(a[i].conditions || []), { question_id: choiceQs[0]?.id, op: 'equals', value: '' }]; up({ rules: a }); }}>+ Condition</Button>
              <div className="small strong">Then</div>
              <Action value={r.action || { type: 'event_type' }} ets={ets} onChange={(v) => { const a = [...f.rules]; a[i] = { ...r, action: v }; up({ rules: a }); }} />
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => up({ rules: [...f.rules, { name: '', match: 'all', conditions: [{ question_id: choiceQs[0]?.id, op: 'equals', value: '' }], action: { type: 'event_type' } }] })}>+ Add routing rule</Button>
          <div className="rule fallback"><div className="small strong">Otherwise (fallback)</div><Action value={f.fallback || { type: 'message' }} ets={ets} onChange={(v) => up({ fallback: v })} /></div>
        </div>
      )}
      {tab === 'subs' && (
        <div className="card">
          {!subs ? <Spinner center /> : !subs.length ? <Empty icon="📭" title="No submissions yet" /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Submitted</th>{f.questions.map((q) => <th key={q.id}>{q.label}</th>)}<th>Routed to</th><th>Booked</th></tr></thead>
              <tbody>{subs.map((s) => (
                <tr key={s.id}><td className="small">{ts(s.created_at).toLocal().toFormat('LLL d, h:mma')}</td>
                  {f.questions.map((q) => <td key={q.id}>{String(s.answers.find((a) => a.id === q.id)?.value ?? '')}</td>)}
                  <td className="small">{s.result.type === 'event_type' ? `📅 ${ets.find((e) => e.id === s.result.event_type_id)?.name || 'Event'}` : s.result.type === 'url' ? `🔗 ${s.result.url}` : '💬 Message'}{s.result.matched_rule ? '' : ' (fallback)'}</td>
                  <td>{s.booking_uid ? <Badge color="green">Yes</Badge> : <Badge>No</Badge>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}
