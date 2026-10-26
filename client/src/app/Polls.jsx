import React, { useState } from 'react';
import { DateTime } from 'luxon';
import { api, absUrl, fmtTime, fmtDate, durLabel, LOCATION_TYPES } from '../lib.js';
import { useAuth } from '../auth.js';
import { Button, Field, Modal, Spinner, useAsync, useToast, Empty, Badge, CopyButton, Toggle, Confirm } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';

export default function Polls() {
  const { me } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api('/polls'), []);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const [del, setDel] = useState(null);
  const tz = me.user.timezone; const fmt = me.user.time_format;
  if (loading) return <Spinner center />;
  return (
    <div>
      <div className="page-head">
        <div><h1>Meeting polls</h1><p className="muted">Propose times, let invitees vote, then book the time that works best for everyone.</p></div>
        <Button onClick={() => setCreating(true)}>+ New meeting poll</Button>
      </div>
      {!data.polls.length ? <div className="card"><Empty icon="poll" title="No meeting polls yet" action={<Button onClick={() => setCreating(true)}>Create a poll</Button>}>Polls are great for finding a time across several people.</Empty></div> : (
        <div className="stack">
          {data.polls.map((p) => {
            const counts = Object.fromEntries(p.options.map((o) => [o.id, p.votes.filter((v) => v.choices.includes(o.id)).length]));
            const best = Math.max(0, ...Object.values(counts));
            return (
              <div key={p.id} className="card">
                <button className="poll-row" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <div><div className="strong">{p.title}</div><div className="small muted">{durLabel(p.duration)} · {p.options.length} options · {p.votes.length} participant{p.votes.length === 1 ? '' : 's'}</div></div>
                  <div className="row gap-sm">{p.status === 'open' ? <Badge color="green">Open</Badge> : p.status === 'booked' ? <Badge color="blue">Booked</Badge> : <Badge>Closed</Badge>}{p.reserve_times ? <Badge color="purple">Times reserved</Badge> : null}<span className="caret"><Icon name={open === p.id ? 'chevron-down' : 'chevron-right'} size={16} /></span></div>
                </button>
                {open === p.id && (
                  <div className="pad">
                    <div className="row gap wrap mb">
                      <CopyButton text={absUrl(p.path)} label="Copy poll link" />
                      <a className="btn btn-ghost btn-sm" href={p.path} target="_blank" rel="noreferrer">Open poll ↗</a>
                      {p.status === 'open' && <Button size="sm" variant="ghost" onClick={async () => { await api(`/polls/${p.id}/close`, { method: 'POST' }); reload(); }}>Close poll</Button>}
                      <Button size="sm" variant="danger-outline" onClick={() => setDel(p)}>Delete</Button>
                    </div>
                    <div className="table-wrap">
                      <table className="table poll-table">
                        <thead><tr><th>Participant</th>{p.options.map((o) => <th key={o.id} className={counts[o.id] === best && best > 0 ? 'best' : ''}><div>{fmtDate(o.start, tz, 'ccc LLL d')}</div><div className="small">{fmtTime(o.start, tz, fmt)}</div></th>)}</tr></thead>
                        <tbody>
                          {p.votes.map((v) => <tr key={v.id}><td><div className="strong">{v.name}</div><div className="small muted">{v.email}</div></td>{p.options.map((o) => <td key={o.id} className="center">{v.choices.includes(o.id) ? <Icon name="check" size={15} className="green" /> : <span className="muted">—</span>}</td>)}</tr>)}
                          <tr className="totals"><td>Total</td>{p.options.map((o) => <td key={o.id} className="center strong">{counts[o.id]}</td>)}</tr>
                          {p.status === 'open' && <tr><td></td>{p.options.map((o) => <td key={o.id} className="center"><Button size="sm" variant={counts[o.id] === best && best > 0 ? 'primary' : 'outline'} disabled={!counts[o.id]}
                            onClick={async () => { try { await api(`/polls/${p.id}/book`, { method: 'POST', body: { option_id: o.id } }); toast('Meeting booked — invites sent'); reload(); } catch (e) { toast(e.message, 'err'); } }}>Book</Button></td>)}</tr>}
                        </tbody>
                      </table>
                    </div>
                    {!p.votes.length && <p className="muted small">No votes yet — share the link with participants.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {creating && <CreatePoll tz={tz} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); toast('Poll created'); }} />}
      <Confirm open={!!del} danger title="Delete poll?" confirmLabel="Delete" onClose={() => setDel(null)} onConfirm={async () => { await api(`/polls/${del.id}`, { method: 'DELETE' }); setDel(null); reload(); }} />
    </div>
  );
}

function CreatePoll({ tz, onClose, onCreated }) {
  const base = DateTime.now().setZone(tz).plus({ days: 2 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const [f, setF] = useState({ title: '', description: '', duration: 60, location: { type: 'jitsi' }, reserve_times: true,
    options: [0, 1, 2].map((i) => base.plus({ days: i, hours: i * 2 }).toFormat("yyyy-MM-dd'T'HH:mm")) });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New meeting poll" width={600}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => {
        setBusy(true); setErr('');
        try { await api('/polls', { method: 'POST', body: { ...f, options: f.options.filter(Boolean).map((o) => ({ start: DateTime.fromISO(o, { zone: tz }).toUTC().toISO() })) } }); onCreated(); } catch (e) { setErr(e.message); setBusy(false); }
      }}>Create poll</Button></>}>
      <div className="stack">
        <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Quarterly planning" /></Field>
        <Field label="Description"><textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid-2">
          <Field label="Duration"><select value={f.duration} onChange={(e) => setF({ ...f, duration: Number(e.target.value) })}>{[15, 30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{durLabel(d)}</option>)}</select></Field>
          <Field label="Location"><select value={f.location.type} onChange={(e) => setF({ ...f, location: { type: e.target.value } })}>{['jitsi', 'zoom', 'google_meet', 'in_person', 'phone_inbound', 'custom'].map((k) => <option key={k} value={k}>{LOCATION_TYPES[k].label}</option>)}</select></Field>
        </div>
        {LOCATION_TYPES[f.location.type]?.needsValue && <Field label="Location details"><input value={f.location.value || ''} onChange={(e) => setF({ ...f, location: { ...f.location, value: e.target.value } })} placeholder={LOCATION_TYPES[f.location.type].placeholder} /></Field>}
        <div className="small strong">Time options ({tz})</div>
        {f.options.map((o, i) => (
          <div key={i} className="row gap-sm"><input type="datetime-local" value={o} onChange={(e) => { const a = [...f.options]; a[i] = e.target.value; setF({ ...f, options: a }); }} /><button className="icon-btn" onClick={() => setF({ ...f, options: f.options.filter((_, j) => j !== i) })} aria-label="Remove option"><Icon name="x" size={14} /></button></div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setF({ ...f, options: [...f.options, DateTime.fromISO(f.options[f.options.length - 1] || base.toISO()).plus({ days: 1 }).toFormat("yyyy-MM-dd'T'HH:mm")] })}>+ Add time option</Button>
        <Toggle checked={f.reserve_times} onChange={(v) => setF({ ...f, reserve_times: v })} label="Reserve these times on my calendar until the poll is booked (blocks other bookings)" />
        {err && <div className="alert alert-error">{err}</div>}
      </div>
    </Modal>
  );
}
