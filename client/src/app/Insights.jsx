import React, { useState } from 'react';
import { DateTime } from 'luxon';
import { api, ts } from '../lib.js';
import { useAuth } from '../auth.js';
import { Spinner, useAsync, Empty, Badge, Modal, Tabs } from '../components/ui.jsx';

export function Contacts() {
  const { data, loading } = useAsync(() => api('/contacts'), []);
  const [q, setQ] = useState('');
  if (loading) return <Spinner center />;
  const list = data.contacts.filter((c) => !q || `${c.name} ${c.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="page-head"><div><h1>Contacts</h1><p className="muted">Everyone who has booked with you.</p></div><input className="search" placeholder="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="card">
        {!list.length ? <Empty icon="👥" title="No contacts yet" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Meetings</th><th>Canceled</th><th>No-shows</th><th>Time zone</th><th>Last meeting</th></tr></thead>
            <tbody>{list.map((c) => (
              <tr key={c.email}><td className="strong">{c.name}</td><td><a className="link" href={`mailto:${c.email}`}>{c.email}</a></td><td>{c.active}</td><td>{c.canceled || 0}</td><td>{c.no_shows ? <Badge color="gray">{c.no_shows}</Badge> : 0}</td><td className="small">{c.timezone}</td><td className="small">{DateTime.fromISO(c.last_meeting).toLocal().toFormat('LLL d, yyyy')}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

function Bars({ items, color = 'var(--brand)', labelW = 150 }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return <div className="bars">{items.map((i) => <div key={i.label} className="bar-row"><div className="bar-label" style={{ width: labelW }}>{i.label}</div><div className="bar-track"><div className="bar" style={{ width: `${(i.value / max) * 100}%`, background: color }} /></div><div className="bar-val">{i.value}</div></div>)}</div>;
}
function LineChart({ series }) {
  const W = 700, H = 180, P = 24;
  const max = Math.max(1, ...series.map((s) => Math.max(s.created, s.canceled)));
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, series.length - 1);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const path = (k) => series.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(s[k])}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      {[0, 0.5, 1].map((t) => <g key={t}><line x1={P} x2={W - P} y1={y(max * t)} y2={y(max * t)} stroke="#e5e7eb" /><text x={2} y={y(max * t) + 4} fontSize="10" fill="#9ca3af">{Math.round(max * t)}</text></g>)}
      <path d={`${path('created')} L${x(series.length - 1)},${H - P} L${x(0)},${H - P} Z`} fill="var(--brand)" opacity="0.08" />
      <path d={path('created')} fill="none" stroke="var(--brand)" strokeWidth="2.5" />
      <path d={path('canceled')} fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="4 4" />
      {series.map((s, i) => (i % Math.ceil(series.length / 7) === 0 ? <text key={i} x={x(i)} y={H - 6} fontSize="10" fill="#9ca3af" textAnchor="middle">{DateTime.fromISO(s.date).toFormat('LLL d')}</text> : null))}
    </svg>
  );
}

export function Analytics() {
  const [days, setDays] = useState(30);
  const { data, loading } = useAsync(() => api(`/analytics?days=${days}`), [days]);
  return (
    <div>
      <div className="page-head"><div><h1>Analytics</h1><p className="muted">Booking activity for events created in the selected period.</p></div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select></div>
      {loading ? <Spinner center /> : (
        <>
          <div className="stat-grid">
            {[['Created', data.totals.created, '📅'], ['Completed / upcoming', data.totals.active, '✅'], ['Canceled', data.totals.canceled, '✕'], ['Rescheduled', data.totals.rescheduled, '🔁'], ['No-shows', data.totals.no_shows, '👻']].map(([l, v, i]) => (
              <div key={l} className="card stat"><div className="stat-icon">{i}</div><div className="stat-val">{v}</div><div className="small muted">{l}</div></div>
            ))}
          </div>
          <div className="card pad mt"><div className="row between"><h3>Events over time</h3><div className="small"><span className="legend" style={{ background: 'var(--brand)' }} /> created <span className="legend" style={{ background: '#ef4444' }} /> canceled</div></div><LineChart series={data.series} /></div>
          <div className="grid-2 mt">
            <div className="card pad"><h3>Popular event types</h3><Bars items={Object.entries(data.by_event_type).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} /></div>
            <div className="card pad"><h3>Meetings by host</h3><Bars items={Object.entries(data.by_host).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))} color="#0891b2" /></div>
            <div className="card pad"><h3>Popular days</h3><Bars items={data.by_weekday.map((d) => ({ label: d.day, value: d.count }))} color="#db2777" labelW={50} /></div>
            <div className="card pad"><h3>Popular times ({data.timezone})</h3>
              <div className="hours">{data.by_hour.map((h) => { const max = Math.max(1, ...data.by_hour.map((x) => x.count)); return <div key={h.hour} className="hour" title={`${h.hour}:00 — ${h.count}`}><div className="hour-bar" style={{ height: `${(h.count / max) * 100}%` }} /><div className="hour-l">{h.hour % 3 === 0 ? h.hour : ''}</div></div>; })}</div>
            </div>
            <div className="card pad"><h3>Booking sources</h3><Bars items={Object.entries(data.by_source).map(([label, value]) => ({ label: label.replace(/_/g, ' '), value }))} color="#16a34a" /></div>
          </div>
        </>
      )}
    </div>
  );
}

export function Outbox() {
  const { me } = useAuth();
  const { data, loading } = useAsync(() => api('/outbox'), []);
  const [view, setView] = useState(null);
  const [filter, setFilter] = useState('all');
  if (loading) return <Spinner center />;
  const list = data.emails.filter((e) => filter === 'all' || e.kind.startsWith(filter));
  return (
    <div>
      <div className="page-head"><div><h1>Email log</h1><p className="muted">{data.email_enabled ? 'Every email Cadence sends for you (confirmations, reminders, cancellations) is logged here.' : 'Email delivery isn\'t configured on this server yet, so emails are logged here but not sent. The administrator can add RESEND_API_KEY (or SMTP settings) to turn on delivery.'}</p></div></div>
      <Tabs value={filter} onChange={setFilter} tabs={[{ value: 'all', label: 'All' }, { value: 'invitee', label: 'To invitees' }, { value: 'host', label: 'To hosts' }, { value: 'workflow', label: 'Workflows' }]} />
      <div className="card">
        {!list.length ? <Empty icon="✉️" title="No emails yet" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Sent</th><th>To</th><th>Subject</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>{list.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => api(`/outbox/${e.id}`).then((r) => setView(r.email))}>
                <td className="small">{ts(e.created_at).setZone(me.user.timezone).toFormat('LLL d, h:mma')}</td><td>{e.to_email}</td><td className="strong">{e.subject}</td>
                <td><Badge color={e.kind.startsWith('workflow') ? 'purple' : e.kind.includes('cancel') ? 'red' : 'blue'}>{e.kind.replace(/_/g, ' ')}</Badge></td>
                <td title={e.error || ''}>{e.delivered ? <Badge color="green">Sent</Badge> : e.error ? <Badge color={data.email_enabled ? 'red' : 'gray'}>{data.email_enabled ? 'Failed' : 'Not sent'}</Badge> : <Badge color="yellow">Sending</Badge>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      <Modal open={!!view} onClose={() => setView(null)} title={view?.subject} width={680}>
        {view && <><div className="small muted mb">To: {view.to_email}</div><iframe className="email-frame" title="email" srcDoc={view.html} sandbox="" /></>}
      </Modal>
    </div>
  );
}
