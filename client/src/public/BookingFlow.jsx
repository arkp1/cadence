import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { useNavigate } from 'react-router-dom';
import { api, browserTz, fmtTime, fmtDate, durLabel, fmtMoney, locationLabel, locationIcon, isEmbed, postToParent, KIND_LABELS } from '../lib.js';
import { Avatar, Button, Field, TimezoneSelect, Spinner } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';

const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export function PublicShell({ owner, children, wide }) {
  const embed = isEmbed();
  return (
    <div className={`public-shell ${embed ? 'embed' : ''}`} style={{ '--brand': owner?.brand_color || '#4f46e5' }}>
      <div className={`public-card ${wide ? 'wide' : ''}`}>
        {!owner?.hide_branding && !embed && <a className="powered" href="/" target="_blank" rel="noreferrer">powered by <b>Cadence</b></a>}
        {children}
      </div>
    </div>
  );
}

export function EventSummary({ event, duration, reschedule, selected, tz, timeFormat, children }) {
  const st = event.settings || {};
  const locType = event.locations?.[0]?.type;
  const locIcon = locationIcon(locType);
  return (
    <div className="event-summary">
      <div className="host-row">
        {event.hosts?.length > 1
          ? <div className="avatar-stack">{event.hosts.slice(0, 4).map((h) => <Avatar key={h.id} name={h.name} color={h.avatar_color} size={36} />)}</div>
          : <Avatar name={event.owner?.name} color={event.owner?.avatar_color} src={event.owner?.avatar_url} size={44} />}
      </div>
      <div className="muted host-name">{event.kind === 'round_robin' ? `${event.owner?.name} · Team` : event.hosts?.length > 1 ? event.hosts.map((h) => h.name).join(', ') : event.owner?.name}</div>
      <h1 className="event-title">{event.name}</h1>
      <ul className="meta-list">
        <li><Icon name="clock" size={16} /><span>{durLabel(duration || event.duration)}</span></li>
        {event.locations?.length === 1 && <li><Icon name={locIcon} size={16} /><span>{locationLabel(event.locations[0])}{event.locations[0].value ? ` — ${event.locations[0].value}` : ''}</span></li>}
        {event.locations?.length > 1 && <li><Icon name="map-pin" size={16} /><span>{event.locations.length} location options</span></li>}
        {['jitsi', 'zoom', 'google_meet', 'teams'].includes(event.locations?.[0]?.type) && <li className="muted small"><Icon name="info" size={15} /><span>Web conferencing details provided upon confirmation.</span></li>}
        {st.price_cents > 0 && <li><Icon name="credit-card" size={16} /><span>{fmtMoney(st.price_cents, st.currency)}</span></li>}
        {event.kind !== 'one_on_one' && <li><Icon name="users" size={16} /><span>{KIND_LABELS[event.kind]}{event.kind === 'group' && st.max_invitees ? ` · up to ${st.max_invitees} invitees` : ''}</span></li>}
        {selected && <li className="strong"><Icon name="calendar-check" size={16} /><span>{fmtTime(selected, tz, timeFormat)} – {fmtTime(DateTime.fromISO(selected).plus({ minutes: duration }).toISO(), tz, timeFormat)}, {fmtDate(selected, tz)}</span></li>}
        {selected && <li><Icon name="globe" size={16} /><span>{tz.replace(/_/g, ' ')}</span></li>}
      </ul>
      {reschedule && (
        <div className="former-time">
          <div className="small strong">Former Time</div>
          <div className="strike">{fmtTime(reschedule.start_utc, tz, timeFormat)} – {fmtTime(reschedule.end_utc, tz, timeFormat)}, {fmtDate(reschedule.start_utc, tz)}</div>
        </div>
      )}
      {event.description && <Description text={event.description} />}
      {children}
    </div>
  );
}
function Description({ text }) {
  const [more, setMore] = useState(false);
  const long = text.length > 220;
  return <div className="desc">{long && !more ? `${text.slice(0, 220)}…` : text}{long && <button className="link" onClick={() => setMore(!more)}>{more ? ' Show less' : ' Show more'}</button>}</div>;
}

export default function BookingFlow({ event, linkToken, reschedule, routing }) {
  const nav = useNavigate();
  const qs = new URLSearchParams(window.location.search);
  const st = event.settings || {};
  const ownerTz = event.owner?.timezone || 'UTC';
  const [tz, setTz] = useState(st.lock_timezone ? ownerTz : (reschedule?.invitee_tz || browserTz()));
  const [timeFormat, setTimeFormat] = useState(event.owner?.time_format || '12h');
  const [duration, setDuration] = useState(reschedule?.duration && event.durations?.includes(reschedule.duration) ? reschedule.duration : event.duration);
  const [month, setMonth] = useState(() => DateTime.now().setZone(tz).startOf('month'));
  const [days, setDays] = useState({});
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(null);
  const [slot, setSlot] = useState(null);
  const [step, setStep] = useState('pick');
  const autoAdvanced = useRef(0);

  useEffect(() => {
    let cancel = false;
    const today = DateTime.now().setZone(tz).startOf('day');
    const start = DateTime.max(month.startOf('month'), today);
    const end = month.endOf('month');
    if (end < today) { setDays({}); setLoading(false); return; }
    setLoading(true);
    const p = new URLSearchParams({ start: start.toISODate(), end: end.toISODate(), tz, duration: String(duration) });
    if (reschedule) p.set('reschedule', reschedule.uid);
    if (linkToken) p.set('link', linkToken);
    api(`/api/public/slots/${event.id}?${p}`).then((r) => {
      if (cancel) return;
      setDays(r.days || {}); setLoading(false);
      if (!Object.keys(r.days || {}).length && autoAdvanced.current < 2 && !date) { autoAdvanced.current++; setMonth((m) => m.plus({ months: 1 })); }
      else if (!date && !isMobile()) { const first = Object.keys(r.days || {}).sort()[0]; if (first && autoAdvanced.current >= 0) setDate(first); }
    }).catch(() => { if (!cancel) { setDays({}); setLoading(false); } });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, tz, duration, event.id]);

  useEffect(() => { postToParent('cadence.page_height', { height: document.body.scrollHeight }); });

  const grid = useMemo(() => {
    const first = month.startOf('month'); const pad = first.weekday - 1; const cells = [];
    for (let i = 0; i < pad; i++) cells.push(null);
    for (let d = 1; d <= month.daysInMonth; d++) cells.push(first.set({ day: d }));
    return cells;
  }, [month]);
  const today = DateTime.now().setZone(tz).startOf('day');

  if (step === 'form') {
    return (
      <div className="booking-layout form-step">
        <aside className="booking-left">
          <button className="back-btn abs step-back" onClick={() => setStep('pick')} aria-label="Go to previous page"><Icon name="arrow-left" size={18} /></button>
          <EventSummary event={event} duration={duration} reschedule={reschedule} selected={slot.start} tz={tz} timeFormat={timeFormat} />
        </aside>
        <section className="booking-right">
          <BookingForm event={event} slot={slot} duration={duration} tz={tz} linkToken={linkToken} reschedule={reschedule} routing={routing}
            prefill={{ name: routing?.prefill?.name || qs.get('name') || '', email: routing?.prefill?.email || qs.get('email') || '' }}
            onDone={(b) => {
              postToParent('cadence.event_scheduled', { uid: b.uid, start: b.start_utc, end: b.end_utc, invitee: { name: b.invitee_name, email: b.invitee_email } });
              const c = st.confirmation || {};
              if (c.type === 'redirect' && c.redirect_url) {
                const u = new URL(c.redirect_url);
                if (c.pass_details) { u.searchParams.set('invitee_name', b.invitee_name); u.searchParams.set('invitee_email', b.invitee_email); u.searchParams.set('event_start_time', b.start_utc); u.searchParams.set('event_type', event.name); u.searchParams.set('booking_uid', b.uid); }
                window.top.location.href = u.toString(); return;
              }
              nav(`/booking/${b.uid}?new=1${isEmbed() ? '&embed=1' : ''}`);
            }} />
        </section>
      </div>
    );
  }

  return (
    <div className="booking-layout">
      <aside className="booking-left">
        <EventSummary event={event} duration={duration} reschedule={reschedule} tz={tz} timeFormat={timeFormat}>
          {event.durations?.length > 1 && (
            <div className="duration-picker">
              <div className="small strong">Duration</div>
              <div className="chip-row">{event.durations.map((d) => <button key={d} className={`chip ${d === duration ? 'active' : ''}`} onClick={() => { setDuration(d); setSlot(null); }}>{durLabel(d)}</button>)}</div>
            </div>
          )}
        </EventSummary>
      </aside>
      <section className="booking-right">
        <h2 className="step-title">Select a Date &amp; Time</h2>
        <div className={`picker ${date ? 'with-times' : ''}`}>
          <div className="calendar">
            <div className="cal-head">
              <button className="cal-nav" disabled={month <= today.startOf('month')} onClick={() => { setMonth(month.minus({ months: 1 })); setDate(null); }} aria-label="Go to previous month"><Icon name="chevron-left" size={19} /></button>
              <div className="cal-month" aria-live="polite">{month.toFormat('LLLL yyyy')}</div>
              <button className="cal-nav" onClick={() => { setMonth(month.plus({ months: 1 })); setDate(null); autoAdvanced.current = 99; }} aria-label="Go to next month"><Icon name="chevron-right" size={19} /></button>
            </div>
            <div className="cal-grid">
              {WEEK.map((w) => <div key={w} className="cal-wd">{w}</div>)}
              {grid.map((d, i) => {
                if (!d) return <div key={i} />;
                const key = d.toISODate(); const avail = !!days[key]; const sel = date === key;
                return (
                  <button key={i} disabled={!avail} className={`cal-day ${avail ? 'avail' : ''} ${sel ? 'sel' : ''} ${d.hasSame(today, 'day') ? 'today' : ''}`}
                    onClick={() => { setDate(key); setSlot(null); }} aria-label={`${d.toFormat('cccc, LLLL d')} - ${avail ? 'Times available' : 'No times available'}`}>
                    {d.day}
                  </button>
                );
              })}
            </div>
            {loading && <div className="cal-loading"><Spinner /></div>}
            {!loading && !Object.keys(days).length && (
              <div className="no-times">No times in {month.toFormat('LLLL')} <button className="link" onClick={() => setMonth(month.plus({ months: 1 }))}>View next month</button></div>
            )}
            <div className="tz-row">
              <div className="small strong">Time zone</div>
              {st.lock_timezone
                ? <div className="small muted">Available times locked to {ownerTz.replace(/_/g, ' ')}</div>
                : <TimezoneSelect value={tz} onChange={(z) => { setTz(z); setSlot(null); }} compact />}
              <div className="fmt-toggle">
                <button className={timeFormat === '12h' ? 'active' : ''} onClick={() => setTimeFormat('12h')}>am/pm</button>
                <button className={timeFormat === '24h' ? 'active' : ''} onClick={() => setTimeFormat('24h')}>24h</button>
              </div>
            </div>
          </div>
          {date && (
            <div className="times">
              <div className="times-head">{DateTime.fromISO(date).toFormat('cccc, LLLL d')}</div>
              <div className="times-list">
                {(days[date] || []).map((s) => (
                  <div key={s.start} className="time-row">
                    <button className={`time-btn ${slot?.start === s.start ? 'sel' : ''}`} onClick={() => setSlot(s)}>
                      {fmtTime(s.start, tz, timeFormat)}
                      {s.spots_left != null && <span className="spots">{s.spots_left} spot{s.spots_left === 1 ? '' : 's'} left</span>}
                    </button>
                    {slot?.start === s.start && <button className="time-next" onClick={() => setStep('form')}>Next</button>}
                  </div>
                ))}
                {!(days[date] || []).length && <div className="muted">No times available</div>}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
const isMobile = () => window.innerWidth < 700;

function Question({ q, value, onChange }) {
  const opts = q.options || [];
  if (q.type === 'textarea') return <textarea rows={4} value={value || ''} onChange={(e) => onChange(e.target.value)} required={q.required} />;
  if (q.type === 'radio') return <div className="opt-list">{opts.map((o) => <label key={o} className="opt"><input type="radio" name={q.id} checked={value === o} onChange={() => onChange(o)} required={q.required} /> {o}</label>)}</div>;
  if (q.type === 'checkbox') {
    const v = Array.isArray(value) ? value : [];
    return <div className="opt-list">{opts.map((o) => <label key={o} className="opt"><input type="checkbox" checked={v.includes(o)} onChange={(e) => onChange(e.target.checked ? [...v, o] : v.filter((x) => x !== o))} /> {o}</label>)}</div>;
  }
  if (q.type === 'select') return <select value={value || ''} onChange={(e) => onChange(e.target.value)} required={q.required}><option value="">Select…</option>{opts.map((o) => <option key={o}>{o}</option>)}</select>;
  return <input type={q.type === 'phone' ? 'tel' : 'text'} value={value || ''} onChange={(e) => onChange(e.target.value)} required={q.required} placeholder={q.type === 'phone' ? '+1 555 123 4567' : ''} />;
}

function BookingForm({ event, slot, duration, tz, linkToken, reschedule, routing, prefill, onDone }) {
  const st = event.settings || {};
  const [name, setName] = useState(reschedule?.invitee_name || prefill.name);
  const [email, setEmail] = useState(reschedule?.invitee_email || prefill.email);
  const [guests, setGuests] = useState(reschedule?.guests || []);
  const [showGuests, setShowGuests] = useState(false);
  const [guestInput, setGuestInput] = useState('');
  const [answers, setAnswers] = useState(() => Object.fromEntries((reschedule?.answers || []).map((a) => [a.id, a.value])));
  const [locIdx, setLocIdx] = useState(0);
  const [locValue, setLocValue] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const reqId = useMemo(() => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)), []);
  const loc = event.locations?.[locIdx];
  const addGuest = () => { const g = guestInput.trim().replace(/,$/, ''); if (g && !guests.includes(g)) setGuests([...guests, g]); setGuestInput(''); };

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const allGuests = guestInput.trim() ? [...guests, guestInput.trim()] : guests;
    try {
      const r = await api('/api/public/bookings', {
        method: 'POST', headers: { 'Booking-Request-ID': reqId },
        body: { event_type_id: event.id, start: slot.start, duration, timezone: tz, name, email, guests: allGuests,
          answers: Object.entries(answers).map(([id, value]) => ({ id, value })), location: { index: locIdx, value: locValue },
          link_token: linkToken, reschedule_uid: reschedule?.uid, reschedule_reason: reason, routing_submission_id: routing?.submission_id, embed: isEmbed() },
      });
      if (r.checkout_url) {
        // Paid event: the slot is held while the invitee pays on Stripe Checkout (which can't run inside an iframe).
        if (isEmbed()) { try { window.top.location.href = r.checkout_url; } catch { window.open(r.checkout_url, '_blank'); } } else window.location.href = r.checkout_url;
        return;
      }
      onDone(r.booking);
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };

  return (
    <form className="booking-form" onSubmit={submit}>
      <h2 className="step-title">Enter Details</h2>
      <Field label="Name *"><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus={!name} /></Field>
      <Field label="Email *"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      {st.allow_guests && (
        <div className="field">
          {!showGuests && !guests.length ? <Button type="button" variant="outline" size="sm" onClick={() => setShowGuests(true)}>Add Guests</Button> : (
            <>
              <span className="field-label">Guest Email(s)</span>
              <div className="guest-box">
                {guests.map((g) => <span key={g} className="guest-chip">{g}<button type="button" onClick={() => setGuests(guests.filter((x) => x !== g))} aria-label={`Remove ${g}`}><Icon name="x" size={10} /></button></span>)}
                <input value={guestInput} placeholder="name@example.com" onChange={(e) => setGuestInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addGuest(); } }} onBlur={addGuest} />
              </div>
              <span className="field-hint">Notify up to {st.max_guests || 10} additional guests of the scheduled event.</span>
            </>
          )}
        </div>
      )}
      {!reschedule && event.locations?.length > 1 && (
        <Field label="Location *">
          <div className="opt-list">
            {event.locations.map((l, i) => <label key={i} className="opt"><input type="radio" checked={locIdx === i} onChange={() => setLocIdx(i)} /> <Icon name={locationIcon(l.type)} size={15} /> {locationLabel(l)}{l.value ? ` — ${l.value}` : ''}</label>)}
          </div>
        </Field>
      )}
      {!reschedule && loc?.type === 'phone_outbound' && <Field label="Phone number *" hint="The host will call you at this number."><input type="tel" value={locValue} onChange={(e) => setLocValue(e.target.value)} required placeholder="+1 555 123 4567" /></Field>}
      {!reschedule && loc?.type === 'ask_invitee' && <Field label="Where should we meet? *"><input value={locValue} onChange={(e) => setLocValue(e.target.value)} required /></Field>}
      {(event.questions || []).map((q) => (
        <Field key={q.id} label={`${q.label}${q.required ? ' *' : ''}`}>
          <Question q={q} value={answers[q.id]} onChange={(v) => setAnswers({ ...answers, [q.id]: v })} />
        </Field>
      ))}
      {reschedule && <Field label="Reason for rescheduling"><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      {st.price_cents > 0 && !reschedule && (
        <div className="pay-box">
          <div className="strong">Payment: {fmtMoney(st.price_cents, st.currency)}</div>
          <div className="small muted">You'll pay securely on Stripe. Your time is held for 30 minutes while you complete payment.</div>
        </div>
      )}
      <p className="small muted">By proceeding, you confirm that you have read and agree to the host's terms and privacy notice.</p>
      {err && <div className="alert alert-error">{err}</div>}
      <Button type="submit" loading={busy} className="btn-pill">{reschedule ? 'Reschedule Event' : st.price_cents > 0 ? 'Continue to payment' : 'Schedule Event'}</Button>
    </form>
  );
}
