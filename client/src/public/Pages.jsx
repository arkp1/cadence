import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api, browserTz, fmtTime, fmtDate, durLabel, googleCalUrl, outlookUrl, LOCATION_TYPES, locationLabel, isEmbed, fmtMoney } from '../lib.js';
import { Avatar, Button, Field, Spinner, useAsync, TimezoneSelect } from '../components/ui.jsx';
import BookingFlow, { PublicShell, EventSummary } from './BookingFlow.jsx';

function NotFound({ title = 'Page not found', message }) {
  return <PublicShell><div className="center-pad"><h2>{title}</h2><p className="muted">{message || 'The link may be incorrect or no longer available.'}</p><Link className="link" to="/">Go to Cadence</Link></div></PublicShell>;
}

export function ProfilePage() {
  const { slug } = useParams();
  const { data, loading, error } = useAsync(() => api(`/api/public/profile/${slug}`), [slug]);
  if (loading) return <PublicShell><Spinner center /></PublicShell>;
  if (error) return <NotFound />;
  const { profile, event_types } = data;
  return (
    <PublicShell owner={profile} wide>
      <div className="profile-head">
        <Avatar name={profile.name} color={profile.avatar_color} src={profile.avatar_url} size={64} />
        <h1>{profile.name}</h1>
        {profile.welcome && <p className="muted">{profile.welcome}</p>}
      </div>
      <div className="profile-grid">
        {event_types.map((e) => (
          <Link key={e.id} to={`/${slug}/${e.slug}${window.location.search}`} className="profile-event">
            <span className="dot" style={{ background: e.color }} />
            <div><div className="strong">{e.name}</div><div className="small muted">{e.durations.map(durLabel).join(' / ')}{e.kind !== 'one_on_one' ? ` · ${e.kind.replace('_', ' ')}` : ''}</div></div>
            <span className="arrow">›</span>
          </Link>
        ))}
        {!event_types.length && <p className="muted center">No event types are available right now.</p>}
      </div>
    </PublicShell>
  );
}

export function EventPage() {
  const { slug, eslug } = useParams();
  const loc = useLocation();
  const { data, loading, error } = useAsync(() => api(`/api/public/event/${slug}/${eslug}`), [slug, eslug]);
  if (loading) return <PublicShell><Spinner center /></PublicShell>;
  if (error) return <NotFound title="This event type does not exist" />;
  const ev = data.event;
  if (!ev.active) return <NotFound title="This event is currently unavailable" message="The host has turned this event type off." />;
  return (
    <PublicShell owner={ev.owner}>
      {!isEmbed() && !ev.secret && <Link to={`/${slug}`} className="back-btn abs" aria-label="Go to previous page">←</Link>}
      <BookingFlow event={ev} routing={loc.state?.routing} />
    </PublicShell>
  );
}

export function SingleUseLinkPage() {
  const { token } = useParams();
  const { data, loading, error } = useAsync(() => api(`/api/public/link/${token}`), [token]);
  if (loading) return <PublicShell><Spinner center /></PublicShell>;
  if (error) return <NotFound title={error.status === 410 ? 'This link has already been used' : 'Invalid link'} message={error.status === 410 ? 'Single-use links expire after one booking. Please ask the host for a new link.' : undefined} />;
  return <PublicShell owner={data.event.owner}><BookingFlow event={data.event} linkToken={token} /></PublicShell>;
}

export function ReschedulePage() {
  const { uid } = useParams();
  const { data, loading, error } = useAsync(async () => {
    const { booking } = await api(`/api/public/bookings/${uid}`);
    if (!booking.event_type) throw new Error('This meeting cannot be rescheduled online.');
    const { event } = await api(`/api/public/event/${booking.owner.slug}/${booking.event_type.slug}`);
    return { booking, event };
  }, [uid]);
  if (loading) return <PublicShell><Spinner center /></PublicShell>;
  if (error) return <NotFound title="Unable to reschedule" message={error.message} />;
  const { booking, event } = data;
  if (booking.status !== 'active') return <BookingStatus booking={booking} />;
  if (!booking.event_type.allow_invitee_reschedule) return <NotFound title="Rescheduling disabled" message="Please contact the host to change this meeting." />;
  if (new Date(booking.start_utc) < new Date()) return <NotFound title="This event has already happened" />;
  return <PublicShell owner={event.owner}><BookingFlow event={{ ...event, active: true }} reschedule={booking} /></PublicShell>;
}

function BookingStatus({ booking }) {
  const tz = booking.invitee_tz || browserTz();
  return (
    <PublicShell owner={booking.owner}>
      <div className="confirm">
        <div className="confirm-icon gray">✕</div>
        <h1>{booking.status === 'rescheduled' ? 'This event was rescheduled' : 'This event has been canceled'}</h1>
        {booking.rescheduled_to && <p><Link className="link" to={`/booking/${booking.rescheduled_to}`}>View the new time →</Link></p>}
        <DetailCard booking={booking} tz={tz} strike />
        {booking.cancel_reason && <p className="muted">Reason: {booking.cancel_reason}</p>}
        <Link className="btn btn-primary btn-pill" to={`/${booking.owner.slug}`}>Schedule a new event</Link>
      </div>
    </PublicShell>
  );
}

function DetailCard({ booking, tz, strike }) {
  const fmt = booking.owner?.time_format || '12h';
  return (
    <div className={`detail-card ${strike ? 'strike-all' : ''}`}>
      <div className="strong big">{booking.event_type?.name || 'Meeting'}</div>
      <ul className="meta-list">
        <li>👤 {booking.hosts.map((h) => h.name).join(', ')}</li>
        <li>🗓 {fmtTime(booking.start_utc, tz, fmt)} – {fmtTime(booking.end_utc, tz, fmt)}, {fmtDate(booking.start_utc, tz)}</li>
        <li>🌐 {tz.replace(/_/g, ' ')}</li>
        {booking.location?.type && <li>{LOCATION_TYPES[booking.location.type]?.icon} {locationLabel(booking.location)}{booking.location.value ? <>: {/^https?:/.test(booking.location.value) ? <a className="link" href={booking.location.value} target="_blank" rel="noreferrer">{booking.location.value}</a> : booking.location.value}</> : ''}</li>}
        {booking.guests?.length > 0 && <li>✉️ Guests: {booking.guests.join(', ')}</li>}
        {booking.payment_status && booking.price_cents > 0 && <li>💳 {fmtMoney(booking.price_cents, booking.currency)} · {booking.payment_status === 'paid' ? 'Paid' : booking.payment_status === 'refunded' ? 'Refunded' : 'Awaiting payment'}</li>}
      </ul>
    </div>
  );
}

function PaymentPending({ booking, canceled }) {
  const eventUrl = booking.event_type && booking.owner ? `/${booking.owner.slug}/${booking.event_type.slug}` : `/${booking.owner?.slug || ''}`;
  const tz = booking.invitee_tz || browserTz();
  if (booking.status === 'expired' || canceled) {
    return (
      <PublicShell owner={booking.owner}>
        <div className="confirm">
          <div className="confirm-icon gray">!</div>
          <h1>{canceled ? 'Payment not completed' : 'Reservation expired'}</h1>
          <p className="muted">{canceled ? 'You left checkout before paying, so this time is not booked.' : 'Payment wasn\'t completed in time, so the held slot was released.'} You haven't been charged.</p>
          <DetailCard booking={booking} tz={tz} strike />
          <Link className="btn btn-primary btn-pill" to={eventUrl}>Pick a time again</Link>
        </div>
      </PublicShell>
    );
  }
  return (
    <PublicShell owner={booking.owner}>
      <div className="confirm">
        <Spinner />
        <h1>Confirming your payment…</h1>
        <p className="muted">This usually takes a few seconds. Please keep this page open.</p>
        <DetailCard booking={booking} tz={tz} />
      </div>
    </PublicShell>
  );
}

export function BookingPage({ cancelMode }) {
  const { uid } = useParams();
  const nav = useNavigate();
  const qs = new URLSearchParams(window.location.search);
  const sessionId = qs.get('session_id');
  const paymentCanceled = qs.get('payment') === 'canceled';
  const isNew = qs.get('new') === '1' || !!sessionId;
  const { data, loading, error, setData } = useAsync(() => api(`/api/public/bookings/${uid}${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`), [uid]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pending = data?.booking?.status === 'pending_payment' && !paymentCanceled;
  useEffect(() => {
    if (!pending) return undefined;
    let n = 0;
    const t = setInterval(async () => {
      n += 1;
      try { const r = await api(`/api/public/bookings/${uid}${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`); if (r.booking.status !== 'pending_payment' || n > 40) { setData(r); clearInterval(t); } } catch { /* keep polling */ }
    }, 2500);
    return () => clearInterval(t);
  }, [pending, uid, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <PublicShell><Spinner center /></PublicShell>;
  if (error) return <NotFound title="Booking not found" />;
  const b = data.booking;
  if (b.status === 'pending_payment' || b.status === 'expired') return <PaymentPending booking={b} canceled={paymentCanceled} />;
  if (b.status !== 'active') return <BookingStatus booking={b} />;
  const tz = b.invitee_tz || browserTz();
  const title = `${b.event_type?.name || 'Meeting'} with ${b.hosts.map((h) => h.name).join(', ')}`;
  const past = new Date(b.start_utc) < new Date();

  if (cancelMode) {
    return (
      <PublicShell owner={b.owner}>
        <div className="confirm">
          <h1>Cancel event</h1>
          <DetailCard booking={b} tz={tz} />
          {past ? <p className="muted">Past events cannot be canceled.</p> : !b.event_type?.allow_invitee_cancel ? <p className="muted">Online cancellation is disabled for this event. Please contact the host.</p> : (
            <div className="cancel-box">
              <Field label="Reason for canceling"><textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Let the host know why you are canceling (optional)" /></Field>
              {err && <div className="alert alert-error">{err}</div>}
              <Button variant="danger" className="btn-pill" loading={busy} onClick={async () => {
                setBusy(true); setErr('');
                try { const r = await api(`/api/public/bookings/${uid}/cancel`, { method: 'POST', body: { reason } }); setData({ booking: r.booking }); } catch (e) { setErr(e.message); setBusy(false); }
              }}>Cancel Event</Button>
              <button className="link" onClick={() => nav(`/booking/${uid}`)}>Keep this event</button>
            </div>
          )}
        </div>
      </PublicShell>
    );
  }
  return (
    <PublicShell owner={b.owner}>
      <div className="confirm">
        <div className="confirm-icon">✓</div>
        <h1>{isNew ? (b.rescheduled_from ? 'Your event has been rescheduled' : 'You are scheduled') : 'Event details'}</h1>
        <p className="muted">A calendar invitation has been sent to {b.invitee_email}.</p>
        <DetailCard booking={b} tz={tz} />
        {!past && (
          <>
            <div className="cal-add">
              <a className="btn btn-outline btn-sm" href={googleCalUrl(b, title)} target="_blank" rel="noreferrer">Google Calendar</a>
              <a className="btn btn-outline btn-sm" href={outlookUrl(b, title)} target="_blank" rel="noreferrer">Outlook</a>
              <a className="btn btn-outline btn-sm" href={`/api/public/bookings/${b.uid}/ics`}>Apple / iCal (.ics)</a>
            </div>
            <div className="confirm-links">
              {b.event_type?.allow_invitee_reschedule && <Link className="link" to={`/reschedule/${b.uid}`}>Reschedule</Link>}
              {b.event_type?.allow_invitee_cancel && <Link className="link" to={`/cancel/${b.uid}`}>Cancel</Link>}
            </div>
          </>
        )}
        {!isEmbed() && <Link className="small muted" to={`/${b.owner.slug}`}>Book another event with {b.owner.name}</Link>}
      </div>
    </PublicShell>
  );
}

// -------- Meeting polls --------
export function PollPage() {
  const { token } = useParams();
  const { data, loading, error, setData } = useAsync(() => api(`/api/public/polls/${token}`), [token]);
  const [tz, setTz] = useState(browserTz());
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [choices, setChoices] = useState([]); const [err, setErr] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  if (loading) return <PublicShell><Spinner center /></PublicShell>;
  if (error) return <NotFound title="Poll not found" />;
  const p = data.poll; const fmt = p.owner.time_format;
  const counts = Object.fromEntries(p.options.map((o) => [o.id, p.votes.filter((v) => v.choices.includes(o.id)).length]));
  return (
    <PublicShell owner={p.owner} wide>
      <div className="poll">
        <div className="poll-head">
          <Avatar name={p.owner.name} color={p.owner.avatar_color} src={p.owner.avatar_url} size={44} />
          <div><div className="muted small">{p.owner.name} · Meeting poll</div><h1>{p.title}</h1><div className="muted small">⏱ {durLabel(p.duration)}{p.location?.type ? ` · ${locationLabel(p.location)}` : ''}</div></div>
        </div>
        {p.description && <p>{p.description}</p>}
        {p.status !== 'open' ? (
          <div className="alert alert-info">{p.status === 'booked' ? `This poll is closed — the meeting was booked for ${fmtTime(p.options.find((o) => o.id === p.booked_option)?.start, tz, fmt)}, ${fmtDate(p.options.find((o) => o.id === p.booked_option)?.start, tz)}. Check your email for the invite.` : 'This poll is closed.'}</div>
        ) : done ? (
          <div className="alert alert-success">Thanks {name.split(' ')[0]}! Your availability has been shared with {p.owner.name}. You can update your vote anytime by voting again with the same email.</div>
        ) : null}
        <div className="row between wrap"><div className="small strong">Select all times that work for you</div><TimezoneSelect value={tz} onChange={setTz} compact /></div>
        <div className="poll-options">
          {p.options.map((o) => {
            const on = choices.includes(o.id);
            return (
              <button key={o.id} disabled={p.status !== 'open'} className={`poll-option ${on ? 'on' : ''}`} onClick={() => setChoices(on ? choices.filter((c) => c !== o.id) : [...choices, o.id])}>
                <div className="poll-date">{fmtDate(o.start, tz, 'ccc, LLL d')}</div>
                <div className="strong">{fmtTime(o.start, tz, fmt)} – {fmtTime(DateTime.fromISO(o.start).plus({ minutes: p.duration }).toISO(), tz, fmt)}</div>
                <div className="small muted">{counts[o.id]} vote{counts[o.id] === 1 ? '' : 's'}</div>
                <div className="check">{on ? '✓' : ''}</div>
              </button>
            );
          })}
        </div>
        {p.status === 'open' && (
          <form className="poll-form" onSubmit={async (e) => {
            e.preventDefault(); setErr(''); setBusy(true);
            try { const r = await api(`/api/public/polls/${token}/vote`, { method: 'POST', body: { name, email, choices } }); setData({ poll: r.poll }); setDone(true); } catch (ex) { setErr(ex.message); }
            setBusy(false);
          }}>
            <Field label="Your name"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Button type="submit" loading={busy} disabled={!choices.length}>Submit vote ({choices.length})</Button>
            {err && <div className="alert alert-error">{err}</div>}
          </form>
        )}
        {p.votes.length > 0 && <div className="small muted">Participants: {p.votes.map((v) => v.name).join(', ')}</div>}
      </div>
    </PublicShell>
  );
}

// -------- Routing forms --------
export function RoutingFormPage() {
  const { token } = useParams();
  const nav = useNavigate();
  const { data, loading, error } = useAsync(() => api(`/api/public/forms/${token}`), [token]);
  const [answers, setAnswers] = useState({}); const [result, setResult] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (loading) return <PublicShell><Spinner center /></PublicShell>;
  if (error) return <NotFound title="Form not found" />;
  const f = data.form;
  const set = (id, v) => setAnswers({ ...answers, [id]: v });
  if (result) {
    return <PublicShell owner={f.owner}><div className="confirm"><div className="confirm-icon">✓</div><h1>{f.name}</h1><p style={{ whiteSpace: 'pre-wrap' }}>{result.message || 'Thanks! Your response has been recorded.'}</p></div></PublicShell>;
  }
  return (
    <PublicShell owner={f.owner}>
      <form className="routing-form" onSubmit={async (e) => {
        e.preventDefault(); setErr(''); setBusy(true);
        try {
          const r = await api(`/api/public/forms/${token}/submit`, { method: 'POST', body: { answers: Object.entries(answers).map(([id, value]) => ({ id, value })) } });
          const res = r.result;
          if (res.type === 'event_type' && res.target) nav(`${res.target}${isEmbed() ? '?embed=1' : ''}`, { state: { routing: { submission_id: r.submission_id, prefill: r.prefill } } });
          else if (res.type === 'url' && res.url) window.top.location.href = res.url;
          else setResult(res);
        } catch (ex) { setErr(ex.message); setBusy(false); }
      }}>
        <Avatar name={f.owner.name} color={f.owner.avatar_color} src={f.owner.avatar_url} size={48} />
        <h1>{f.name}</h1>
        {f.description && <p className="muted">{f.description}</p>}
        {f.questions.map((q) => (
          <Field key={q.id} label={`${q.label}${q.required ? ' *' : ''}`}>
            {q.type === 'select' ? <select value={answers[q.id] || ''} onChange={(e) => set(q.id, e.target.value)} required={q.required}><option value="">Select…</option>{(q.options || []).map((o) => <option key={o}>{o}</option>)}</select>
              : q.type === 'radio' ? <div className="opt-list">{(q.options || []).map((o) => <label className="opt" key={o}><input type="radio" name={q.id} checked={answers[q.id] === o} onChange={() => set(q.id, o)} required={q.required} /> {o}</label>)}</div>
                : q.type === 'textarea' ? <textarea rows={3} value={answers[q.id] || ''} onChange={(e) => set(q.id, e.target.value)} required={q.required} />
                  : <input type={q.type === 'email' ? 'email' : q.type === 'phone' ? 'tel' : q.type === 'number' ? 'number' : 'text'} value={answers[q.id] || ''} onChange={(e) => set(q.id, e.target.value)} required={q.required} />}
          </Field>
        ))}
        {err && <div className="alert alert-error">{err}</div>}
        <Button type="submit" loading={busy} className="btn-pill">Submit</Button>
      </form>
    </PublicShell>
  );
}
