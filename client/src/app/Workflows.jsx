import React, { useState } from 'react';
import { api } from '../lib.js';
import { Button, Field, Modal, Spinner, useAsync, useToast, Empty, Toggle, Confirm, Badge } from '../components/ui.jsx';

const TRIGGERS = { booked: 'When event is booked', before_start: 'Before event starts', after_end: 'After event ends', canceled: 'When event is canceled' };
const ACTIONS = { email_invitee: 'Send email to invitee', email_host: 'Send email to host' };
const VARS = ['event_name', 'event_time', 'event_time_host', 'invitee_name', 'invitee_first_name', 'invitee_email', 'invitee_timezone', 'host_name', 'host_email', 'duration', 'location', 'reschedule_url', 'cancel_url', 'booking_page_url', 'cancel_reason', 'answers'];
const TEMPLATES = [
  { name: 'Email reminder 1 hour before', trigger: 'before_start', offset_minutes: 60, action: 'email_invitee', subject: 'Starting soon: {{event_name}} with {{host_name}}', body: 'Hi {{invitee_first_name}},\n\nJust a reminder that {{event_name}} starts at {{event_time}}.\n\nJoin here: {{location}}\n\nSee you soon!' },
  { name: 'Host summary on booking', trigger: 'booked', offset_minutes: 0, action: 'email_host', subject: 'Prep notes: {{invitee_name}}', body: '{{invitee_name}} ({{invitee_email}}) booked {{event_name}} for {{event_time_host}}.\n\nTheir answers:\n{{answers}}' },
  { name: 'Win-back after cancellation', trigger: 'canceled', offset_minutes: 0, action: 'email_invitee', subject: 'Sorry we missed you, {{invitee_first_name}}', body: 'Hi {{invitee_first_name}},\n\nNo worries about canceling. Whenever you are ready, grab a new time here: {{booking_page_url}}' },
];
const offsetLabel = (m) => (m % 1440 === 0 && m ? `${m / 1440} day(s)` : m % 60 === 0 && m ? `${m / 60} hour(s)` : `${m} min`);

export default function Workflows() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => Promise.all([api('/workflows'), api('/event-types')]).then(([a, b]) => ({ workflows: a.workflows, ets: b.event_types })), []);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  if (loading) return <Spinner center />;
  return (
    <div>
      <div className="page-head">
        <div><h1>Workflows</h1><p className="muted">Automate reminders, follow-ups and notifications around your events. Confirmation, reschedule and cancellation emails are always sent automatically.</p></div>
        <Button onClick={() => setEdit({ name: '', trigger: 'before_start', offset_minutes: 1440, action: 'email_invitee', subject: '', body: '', event_type_ids: [], active: true })}>+ New workflow</Button>
      </div>
      <div className="small strong mb-sm">Start from a template</div>
      <div className="tpl-row">{TEMPLATES.map((t) => <button key={t.name} className="tpl" onClick={() => setEdit({ ...t, event_type_ids: [], active: true })}><div className="strong">{t.name}</div><div className="small muted">{TRIGGERS[t.trigger]} · {ACTIONS[t.action]}</div></button>)}</div>
      {!data.workflows.length ? <div className="card"><Empty icon="⚡" title="No workflows yet" /></div> : (
        <div className="wf-grid">
          {data.workflows.map((w) => (
            <div key={w.id} className={`card wf ${w.active ? '' : 'off'}`}>
              <div className="row between"><div className="strong">{w.name}</div><Toggle checked={w.active} onChange={async (v) => { await api(`/workflows/${w.id}`, { method: 'PATCH', body: { active: v } }); reload(); toast(v ? 'Workflow on' : 'Workflow off'); }} /></div>
              <div className="wf-steps">
                <div className="wf-step">⏱ {w.trigger === 'before_start' ? `${offsetLabel(w.offset_minutes)} before event starts` : w.trigger === 'after_end' ? `${offsetLabel(w.offset_minutes)} after event ends` : TRIGGERS[w.trigger]}</div>
                <div className="wf-step">✉️ {ACTIONS[w.action]}</div>
              </div>
              <div className="small muted">{w.event_type_ids.length ? `${w.event_type_ids.length} event type(s)` : 'All event types'}</div>
              <div className="row gap-sm mt-sm"><Button size="sm" variant="secondary" onClick={() => setEdit(w)}>Edit</Button><Button size="sm" variant="danger-outline" onClick={() => setDel(w)}>Delete</Button></div>
            </div>
          ))}
        </div>
      )}
      {edit && <WorkflowModal wf={edit} ets={data.ets} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); toast('Workflow saved'); }} />}
      <Confirm open={!!del} danger title="Delete workflow?" confirmLabel="Delete" onClose={() => setDel(null)} onConfirm={async () => { await api(`/workflows/${del.id}`, { method: 'DELETE' }); setDel(null); reload(); }} />
    </div>
  );
}

function WorkflowModal({ wf, ets, onClose, onSaved }) {
  const [f, setF] = useState(wf);
  const [unit, setUnit] = useState(wf.offset_minutes % 1440 === 0 && wf.offset_minutes ? 1440 : wf.offset_minutes % 60 === 0 && wf.offset_minutes ? 60 : 1);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  return (
    <Modal open onClose={onClose} title={wf.id ? 'Edit workflow' : 'New workflow'} width={640}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => {
        setBusy(true); setErr('');
        try { await api(wf.id ? `/workflows/${wf.id}` : '/workflows', { method: wf.id ? 'PATCH' : 'POST', body: f }); onSaved(); } catch (e) { setErr(e.message); setBusy(false); }
      }}>Save</Button></>}>
      <div className="stack">
        <Field label="Workflow name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid-2">
          <Field label="When this happens"><select value={f.trigger} onChange={(e) => setF({ ...f, trigger: e.target.value })}>{Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {['before_start', 'after_end'].includes(f.trigger) && <Field label="Timing"><div className="row gap-sm"><input className="small-input" type="number" min="0" value={f.offset_minutes / unit} onChange={(e) => setF({ ...f, offset_minutes: Number(e.target.value) * unit })} />
            <select value={unit} onChange={(e) => { const u = Number(e.target.value); setF({ ...f, offset_minutes: (f.offset_minutes / unit) * u }); setUnit(u); }}><option value={1}>minutes</option><option value={60}>hours</option><option value={1440}>days</option></select></div></Field>}
        </div>
        <Field label="Do this"><select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Which event types?">
          <div className="host-pick">
            <label className="opt"><input type="checkbox" checked={!f.event_type_ids.length} onChange={() => setF({ ...f, event_type_ids: [] })} /> All event types</label>
            {ets.map((e) => <label key={e.id} className="opt"><input type="checkbox" checked={f.event_type_ids.includes(e.id)} onChange={(ev) => setF({ ...f, event_type_ids: ev.target.checked ? [...f.event_type_ids, e.id] : f.event_type_ids.filter((x) => x !== e.id) })} /> {e.name}</label>)}
          </div>
        </Field>
        <Field label="Subject"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Message"><textarea rows={7} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <div className="vars">{VARS.map((v) => <button key={v} type="button" className="var" onClick={() => setF({ ...f, body: `${f.body}{{${v}}}` })}>{`{{${v}}}`}</button>)}</div>
        {err && <div className="alert alert-error">{err}</div>}
      </div>
    </Modal>
  );
}
