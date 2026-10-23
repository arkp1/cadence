import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api, fmtTime, durLabel } from '../lib.js';
import { useAuth } from '../auth.js';
import { Spinner, TimezoneSelect, Badge, Button } from '../components/ui.jsx';

const CODE_COLORS = { PAST: 'gray', TOOSOON: 'yellow', RANGE: 'gray', BUFFER: 'yellow', CALENDAR: 'red', EVENT: 'red', OVERLAP: 'red', DAYMAX: 'purple', WEEKMAX: 'purple', MONTHMAX: 'purple', GROUP: 'purple', BLOCK_OUT_DATE: 'blue', HOSTS: 'red', ROUNDROBIN: 'red', UNFAIR: 'yellow', USER_EVENT_LIMITS: 'purple', RESERVED: 'blue', OUTSIDE_HOURS: 'gray' };

export default function Troubleshoot() {
  const { id } = useParams();
  const { me } = useAuth();
  const [tz, setTz] = useState(me.user.timezone);
  const [date, setDate] = useState(DateTime.now().setZone(me.user.timezone).toISODate());
  const [duration, setDuration] = useState('');
  const [et, setEt] = useState(null);
  const [res, setRes] = useState(null);
  useEffect(() => { api(`/event-types/${id}`).then((r) => setEt(r.event_type)).catch(() => setEt({ id, name: 'Team event', durations: [] })); }, [id]);
  useEffect(() => {
    setRes(null);
    api(`/event-types/${id}/troubleshoot?start=${date}&end=${date}&tz=${encodeURIComponent(tz)}${duration ? `&duration=${duration}` : ''}`).then(setRes);
  }, [id, date, tz, duration]);
  const fmt = me.user.time_format;
  const shift = (n) => setDate(DateTime.fromISO(date).plus({ days: n }).toISODate());
  const dayNote = res && Object.entries(res.day_notes || {}).find(([k]) => k === date || (k.includes('..') && date >= k.split('..')[0] && date <= k.split('..')[1]));
  const avail = res?.diagnostics?.filter((d) => d.available).length || 0;
  const visible = (res?.diagnostics || []).filter((d) => DateTime.fromISO(d.start).setZone(tz).toISODate() === date);

  return (
    <div>
      <div className="page-head">
        <div className="row gap"><Link to={`/app/event-types/${id}`} className="icon-btn">←</Link>
          <div><div className="small muted">Troubleshooting availability</div><h1>{et?.name || '…'}</h1></div></div>
      </div>
      <div className="card pad">
        <p className="muted small">See why specific times are not available on your booking page. Don't worry — your invitees will never see this information.</p>
        <div className="row gap wrap">
          <Button variant="ghost" size="sm" onClick={() => shift(-1)}>‹</Button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Button variant="ghost" size="sm" onClick={() => shift(1)}>›</Button>
          {et?.durations?.length > 1 && <select value={duration} onChange={(e) => setDuration(e.target.value)}><option value="">Default ({durLabel(et.duration)})</option>{et.durations.map((d) => <option key={d} value={d}>{durLabel(d)}</option>)}</select>}
          <TimezoneSelect value={tz} onChange={setTz} compact />
        </div>
      </div>
      {!res ? <Spinner center /> : (
        <div className="card pad mt">
          <div className="row between wrap mb">
            <h3>{DateTime.fromISO(date).toFormat('cccc, LLLL d, yyyy')}</h3>
            <div className="row gap-sm"><Badge color="green">{avail} available</Badge><Badge color="red">{visible.length - avail} unavailable</Badge></div>
          </div>
          {dayNote && <div className="alert alert-info mb">{describeNote(dayNote[1], res.owner_timezone)}</div>}
          {!visible.length && !dayNote && <p className="muted">No time slots are generated for this day by your schedule.</p>}
          <div className="diag-list">
            {visible.map((d) => (
              <div key={d.start} className={`diag-row ${d.available ? 'ok' : 'no'}`}>
                <div className="diag-time">{fmtTime(d.start, tz, fmt)}</div>
                <div className="diag-status">{d.available ? <span className="green strong">Available{d.spots_left != null ? ` · ${d.spots_left} spots left` : ''}</span> : (
                  <div className="diag-reasons">
                    {d.reasons.map((r, i) => (
                      <div key={i} className="diag-reason"><Badge color={CODE_COLORS[r.code] || 'gray'}>{r.code.replace('_', ' ')}</Badge> <span>{r.host ? <b>{r.host}: </b> : null}{r.message}{r.detail && !r.detail.includes('buffer') ? ` (${r.detail})` : r.detail ? ` (${r.detail.replace(/_/g, ' ')})` : ''}</span></div>
                    ))}
                  </div>
                )}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function describeNote(n, tz) {
  if (n.startsWith('no_rules:')) return `${{ mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' }[n.split(':')[1]]} are set to unavailable in this event type's availability settings in ${tz}.`;
  if (n === 'blackout') return `This date is set to unavailable by a date override in ${tz}.`;
  if (n.startsWith('time_off:')) return `This date is marked as Time Off (${n.split(':')[1]}).`;
  return n;
}
