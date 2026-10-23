import React, { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { api, download, fmtTime, fmtDate, absUrl, LOCATION_TYPES, locationLabel, durLabel, ts } from '../lib.js';
import { useAuth } from '../auth.js';
import { Button, Tabs, Spinner, Empty, Badge, Confirm, Field, Toggle, CopyButton, useToast } from '../components/ui.jsx';

export default function Scheduled() {
  const { me } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('upcoming');
  const [q, setQ] = useState('');
  const [etFilter, setEtFilter] = useState('');
  const [ets, setEts] = useState([]);
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [reason, setReason] = useState('');
  const tz = me.user.timezone; const fmt = me.user.time_format;

  const load = () => {
    const p = new URLSearchParams({ status }); if (q) p.set('q', q); if (etFilter) p.set('event_type_id', etFilter);
    api(`/bookings?${p}`).then((r) => setList(r.bookings));
  };
  useEffect(() => { setList(null); load(); /* eslint-disable-next-line */ }, [status, etFilter]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q]);
  useEffect(() => { api('/event-types').then((r) => setEts([...r.event_types, ...r.team_event_types])); }, []);
  useEffect(() => { if (open) { setDetail(null); api(`/bookings/${open}`).then((r) => setDetail(r.booking)); } }, [open]);

  const groups = {};
  for (const b of list || []) { const k = DateTime.fromISO(b.start_utc).setZone(tz).toISODate(); (groups[k] ||= []).push(b); }

  return (
    <div>
      <div className="page-head">
        <div><h1>Scheduled events</h1><p className="muted">Times shown in {tz.replace(/_/g, ' ')}</p></div>
        <Button variant="secondary" onClick={() => download(`/bookings.csv?status=${status}`, `scheduled-events-${status}.csv`)}>⬇ Export CSV</Button>
      </div>
      <div className="card">
        <div className="row between wrap gap pad-x">
          <Tabs value={status} onChange={setStatus} tabs={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }, { value: 'canceled', label: 'Canceled' }, { value: 'all', label: 'All' }]} />
          <div className="row gap-sm wrap">
            <select value={etFilter} onChange={(e) => setEtFilter(e.target.value)}><option value="">All event types</option>{ets.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            <input className="search" placeholder="Search invitee name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {!list ? <Spinner center /> : !list.length ? <Empty title={`No ${status === 'all' ? '' : status} events`}>Share your booking link to get meetings on your calendar.</Empty> : (
          Object.entries(groups).map(([day, items]) => (
            <div key={day}>
              <div className="day-head">{DateTime.fromISO(day).toFormat('cccc, d LLLL yyyy')}</div>
              {items.map((b) => (
                <div key={b.uid} className={`bk-row ${open === b.uid ? 'open' : ''}`}>
                  <button className="bk-main" onClick={() => setOpen(open === b.uid ? null : b.uid)}>
                    <span className="dot lg" style={{ background: b.event_type?.color || '#94a3b8' }} />
                    <div className="bk-time">{fmtTime(b.start_utc, tz, fmt)} – {fmtTime(b.end_utc, tz, fmt)}</div>
                    <div className="bk-who">
                      <div className="strong">{b.invitee_name}{b.guests.length ? <span className="muted small"> +{b.guests.length} guest{b.guests.length > 1 ? 's' : ''}</span> : null}</div>
                      <div className="small muted">Event type <b>{b.event_type?.name || 'Meeting'}</b>{b.host_names.length && (b.host_ids.length > 1 || b.host_ids[0] !== me.user.id) ? ` · Host: ${b.host_names.join(', ')}` : ''}</div>
                    </div>
                    <div className="row gap-sm">
                      {b.status === 'canceled' && <Badge color="red">Canceled</Badge>}
                      {b.status === 'rescheduled' && <Badge color="yellow">Rescheduled</Badge>}
                      {b.no_show && <Badge color="gray">No-show</Badge>}
                      {b.rescheduled_from && b.status === 'active' && <Badge color="blue">Rescheduled</Badge>}
                      <span className="caret">{open === b.uid ? '▾' : '▸'}</span>
                    </div>
                  </button>
                  {open === b.uid && (
                    <div className="bk-detail">
                      {!detail ? <Spinner /> : (
                        <div className="bk-detail-grid">
                          <div className="bk-actions">
                            {detail.status === 'active' && new Date(detail.start_utc) > new Date() && <>
                              <CopyButton text={absUrl(`/reschedule/${detail.uid}`)} label="🔁 Copy reschedule link" />
                              <Button size="sm" variant="danger-outline" onClick={() => { setReason(''); setCancel(detail); }}>✕ Cancel</Button>
                            </>}
                            {detail.status === 'active' && new Date(detail.start_utc) <= new Date() && (
                              <Toggle checked={detail.no_show} label="Mark as no-show" onChange={async (v) => { await api(`/bookings/${detail.uid}`, { method: 'PATCH', body: { no_show: v } }); setDetail({ ...detail, no_show: v }); load(); toast(v ? 'Marked as no-show' : 'No-show removed'); }} />
                            )}
                            <a className="btn btn-ghost btn-sm" href={`/booking/${detail.uid}`} target="_blank" rel="noreferrer">Invitee view ↗</a>
                          </div>
                          <div className="kv">
                            <div><span>Email</span><a className="link" href={`mailto:${detail.invitee_email}`}>{detail.invitee_email}</a></div>
                            {detail.guests.length > 0 && <div><span>Guests</span>{detail.guests.join(', ')}</div>}
                            <div><span>When</span>{fmtDate(detail.start_utc, tz)} · {durLabel(detail.duration)}</div>
                            <div><span>Invitee time zone</span>{detail.invitee_tz} ({fmtTime(detail.start_utc, detail.invitee_tz || 'UTC', fmt)} their time)</div>
                            {detail.location?.type && <div><span>Location</span>{LOCATION_TYPES[detail.location.type]?.icon} {locationLabel(detail.location)} {detail.location.value && (/^https?:/.test(detail.location.value) ? <a className="link" href={detail.location.value} target="_blank" rel="noreferrer">{detail.location.value}</a> : detail.location.value)}</div>}
                            <div><span>Hosts</span>{detail.hosts.map((h) => h.name).join(', ')}</div>
                            {detail.answers.map((a) => <div key={a.id}><span>{a.label}</span>{Array.isArray(a.value) ? a.value.join(', ') : a.value}</div>)}
                            {detail.routing && <div><span>Routing form</span>{detail.routing.form}: {detail.routing.answers.map((a) => `${a.label}: ${a.value}`).join(' · ')}</div>}
                            {detail.payment_status && <div><span>Payment</span>{(detail.price_cents / 100).toFixed(2)} {detail.currency} — {detail.payment_status}</div>}
                            {detail.cancel_reason && <div><span>Cancel reason</span>{detail.cancel_reason} ({detail.canceled_by})</div>}
                            <div><span>Booked</span>{ts(detail.created_at).setZone(tz).toFormat('LLL d, yyyy h:mma')} via {detail.source.replace(/_/g, ' ')}</div>
                            {detail.emails?.length > 0 && <div><span>Emails sent</span>{detail.emails.length} ({[...new Set(detail.emails.map((e) => e.kind.split(':')[0]))].join(', ')})</div>}
                          </div>
                          <Field label="Meeting notes (private)">
                            <textarea rows={3} defaultValue={detail.host_notes} onBlur={async (e) => { if (e.target.value !== detail.host_notes) { await api(`/bookings/${detail.uid}`, { method: 'PATCH', body: { host_notes: e.target.value } }); toast('Notes saved'); } }} placeholder="Add private notes about this meeting…" />
                          </Field>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      <Confirm open={!!cancel} danger title="Cancel event" confirmLabel="Yes, cancel" onClose={() => setCancel(null)}
        onConfirm={async () => { await api(`/bookings/${cancel.uid}/cancel`, { method: 'POST', body: { reason } }); setCancel(null); setOpen(null); load(); toast('Event canceled — invitee notified'); }}>
        <p className="muted">{cancel?.invitee_name} will receive a cancellation email.</p>
        <Field label="Reason for canceling"><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Shared with the invitee" /></Field>
      </Confirm>
    </div>
  );
}
