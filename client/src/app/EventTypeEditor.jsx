import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, absUrl, durLabel, KIND_LABELS, LOCATION_TYPES } from '../lib.js';
import { useAuth } from '../auth.js';
import { Button, Field, Toggle, Spinner, useToast, Badge } from '../components/ui.jsx';
import ShareModal from './ShareModal.jsx';

const COLORS = ['#4f46e5', '#0891b2', '#db2777', '#ea580c', '#16a34a', '#7c3aed', '#dc2626', '#ca8a04', '#0f172a'];
const Q_TYPES = { text: 'One line', textarea: 'Multiple lines', radio: 'Radio buttons', checkbox: 'Checkboxes', select: 'Dropdown', phone: 'Phone number' };
const PRESET_DURATIONS = [15, 20, 30, 45, 60, 90, 120];

function Section({ title, subtitle, children, open: o = true }) {
  const [open, setOpen] = useState(o);
  return (
    <div className="card section">
      <button className="section-head" onClick={() => setOpen(!open)}><div><h3>{title}</h3>{subtitle && <div className="small muted">{subtitle}</div>}</div><span className="caret">{open ? '▾' : '▸'}</span></button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export default function EventTypeEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { me } = useAuth();
  const [et, setEt] = useState(null);
  const [payments, setPayments] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [share, setShare] = useState(false);
  const [customDur, setCustomDur] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([api(`/event-types/${id}`), api('/schedules')]).then(([a, b]) => { setEt(a.event_type); setPayments(!!a.payments); setSchedules(b.schedules); }).catch(() => nav('/app'));
  }, [id, nav]);
  if (!et) return <Spinner center />;
  const st = et.settings;
  const up = (patch) => { setEt({ ...et, ...patch }); setDirty(true); };
  const ups = (patch) => up({ settings: { ...st, ...patch } });
  const save = async () => {
    setSaving(true); setErr('');
    try {
      const r = await api(`/event-types/${id}`, { method: 'PATCH', body: pickBody(et) });
      setEt(r.event_type); setDirty(false); toast('Changes saved');
    } catch (e) { setErr(e.message); toast(e.message, 'err'); }
    setSaving(false);
  };
  const noticeUnit = st.min_notice_minutes % 1440 === 0 && st.min_notice_minutes ? 'days' : st.min_notice_minutes % 60 === 0 && st.min_notice_minutes ? 'hours' : 'minutes';
  const noticeVal = noticeUnit === 'days' ? st.min_notice_minutes / 1440 : noticeUnit === 'hours' ? st.min_notice_minutes / 60 : st.min_notice_minutes;
  const mult = { minutes: 1, hours: 60, days: 1440 };
  const isTeam = et.kind === 'round_robin' || et.kind === 'collective';

  return (
    <div className="editor">
      <div className="page-head sticky-head">
        <div className="row gap">
          <Link to="/app" className="icon-btn" aria-label="Back">←</Link>
          <div><div className="small muted">{KIND_LABELS[et.kind]}</div><h1 className="ellipsis">{et.name}</h1></div>
        </div>
        <div className="row gap wrap">
          <a className="btn btn-ghost" href={et.url_path} target="_blank" rel="noreferrer">Preview ↗</a>
          <Link className="btn btn-ghost" to={`/app/event-types/${id}/troubleshoot`}>🔍 Troubleshoot</Link>
          <Button variant="secondary" onClick={() => setShare(true)}>Share</Button>
          <Button onClick={save} loading={saving} disabled={!dirty}>{dirty ? 'Save changes' : 'Saved'}</Button>
        </div>
      </div>
      {err && <div className="alert alert-error">{err}</div>}

      <Section title="Event details" subtitle="Name, link, description and color">
        <div className="grid-2">
          <Field label="Event name"><input value={et.name} onChange={(e) => up({ name: e.target.value })} /></Field>
          <Field label="Event link" hint={absUrl(`/${me.user.slug}/${et.slug}`)}>
            <div className="prefix-input"><span>/{me.user.slug}/</span><input value={et.slug} onChange={(e) => up({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></div>
          </Field>
        </div>
        <Field label="Description / instructions"><textarea rows={4} value={et.description} onChange={(e) => up({ description: e.target.value })} placeholder="Write a summary and any details your invitee should know about the event." /></Field>
        <div className="grid-2">
          <Field label="Event type">
            <select value={et.kind} onChange={(e) => up({ kind: e.target.value })}>{Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field label="Event color">
            <div className="color-row">{COLORS.map((c) => <button key={c} className={`swatch ${et.color === c ? 'sel' : ''}`} style={{ background: c }} onClick={() => up({ color: c })} aria-label={c} />)}<input type="color" value={et.color} onChange={(e) => up({ color: e.target.value })} /></div>
          </Field>
        </div>
        <div className="row gap-lg wrap">
          <Toggle checked={et.active} onChange={(v) => up({ active: v })} label="Active (accepting bookings)" />
          <Toggle checked={et.secret} onChange={(v) => up({ secret: v })} label="Secret — hide from my profile page" />
        </div>
      </Section>

      <Section title="Duration" subtitle={et.durations.map(durLabel).join(' / ')}>
        <p className="small muted">Select one or more durations. With multiple options, invitees choose the length they want.</p>
        <div className="chip-row">
          {[...new Set([...PRESET_DURATIONS, ...et.durations])].sort((a, b) => a - b).map((d) => {
            const on = et.durations.includes(d);
            return <button key={d} className={`chip ${on ? 'active' : ''}`} onClick={() => {
              const next = on ? et.durations.filter((x) => x !== d) : [...et.durations, d].sort((a, b) => a - b);
              if (!next.length) return; up({ durations: next, duration: next.includes(et.duration) ? et.duration : next[0] });
            }}>{durLabel(d)}</button>;
          })}
          <input className="small-input" type="number" min="5" max="720" placeholder="Custom min" value={customDur} onChange={(e) => setCustomDur(e.target.value)} />
          <Button size="sm" variant="ghost" onClick={() => { const n = Number(customDur); if (n >= 5 && n <= 720) { up({ durations: [...new Set([...et.durations, n])].sort((a, b) => a - b) }); setCustomDur(''); } }}>Add</Button>
        </div>
        {et.durations.length > 1 && <Field label="Default duration" className="mt"><select value={et.duration} onChange={(e) => up({ duration: Number(e.target.value) })}>{et.durations.map((d) => <option key={d} value={d}>{durLabel(d)}</option>)}</select></Field>}
      </Section>

      <Section title="Location" subtitle={et.locations.length ? et.locations.map((l) => LOCATION_TYPES[l.type]?.label).join(', ') : 'No location'}>
        {et.locations.map((l, i) => (
          <div key={i} className="loc-row">
            <select value={l.type} onChange={(e) => { const arr = [...et.locations]; arr[i] = { type: e.target.value, label: '', value: '' }; up({ locations: arr }); }}>
              {Object.entries(LOCATION_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
            {LOCATION_TYPES[l.type]?.needsValue && <input title={LOCATION_TYPES[l.type].placeholder} placeholder={LOCATION_TYPES[l.type].placeholder} value={l.value || ''} onChange={(e) => { const arr = [...et.locations]; arr[i] = { ...l, value: e.target.value }; up({ locations: arr }); }} />}
            <input placeholder="Display label (optional)" value={l.label || ''} onChange={(e) => { const arr = [...et.locations]; arr[i] = { ...l, label: e.target.value }; up({ locations: arr }); }} />
            <button className="icon-btn" onClick={() => up({ locations: et.locations.filter((_, j) => j !== i) })} aria-label="Remove">✕</button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => up({ locations: [...et.locations, { type: 'jitsi', label: '' }] })}>+ Add a location option</Button>
        <p className="small muted mt-sm">With more than one option, invitees choose the location when booking. Jitsi generates a unique video link for every meeting.</p>
      </Section>

      {isTeam && (
        <Section title="Hosts" subtitle={`${et.hosts.length} host(s) · ${et.kind === 'round_robin' ? 'Round robin' : 'Collective'}`}>
          <p className="small muted">{et.kind === 'round_robin' ? 'Meetings rotate between the selected hosts.' : 'All selected hosts attend; only times when everyone is free are offered.'} Each host uses their own default availability.</p>
          <div className="host-pick">
            {me.members.map((m) => (
              <label key={m.id} className="opt"><input type="checkbox" checked={et.hosts.includes(m.id)} onChange={(e) => up({ hosts: e.target.checked ? [...et.hosts, m.id] : et.hosts.filter((x) => x !== m.id) })} /> {m.name} <span className="muted small">{m.email}</span></label>
            ))}
          </div>
          {me.members.length < 2 && <p className="small muted">Add teammates on the <Link className="link" to="/app/team">Team</Link> page.</p>}
          {et.kind === 'round_robin' && (
            <Field label="Distribution" className="mt">
              <select value={st.rr_strategy} onChange={(e) => ups({ rr_strategy: e.target.value })}>
                <option value="availability">Optimize for availability — show times when any host is free</option>
                <option value="equal">Optimize for equal distribution — only offer hosts with the fewest meetings</option>
              </select>
            </Field>
          )}
        </Section>
      )}

      {et.kind === 'group' && (
        <Section title="Group settings">
          <div className="grid-2">
            <Field label="Max invitees per time slot"><input type="number" min="2" max="1000" value={st.max_invitees} onChange={(e) => ups({ max_invitees: Number(e.target.value) })} /></Field>
            <div className="field"><span className="field-label">&nbsp;</span><Toggle checked={st.show_spots_left} onChange={(v) => ups({ show_spots_left: v })} label='Display remaining spots ("3 spots left")' /></div>
          </div>
        </Section>
      )}

      <Section title="Scheduling settings" subtitle="Availability, notice, buffers, limits">
        <div className="grid-2">
          <Field label="Availability schedule" hint="Which hours this event can be booked (owner).">
            <select value={et.schedule_id || ''} onChange={(e) => up({ schedule_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Default schedule</option>
              {schedules.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.timezone})</option>)}
            </select>
          </Field>
          <Field label="Date range — invitees can schedule…">
            <div className="row gap-sm">
              <select value={st.date_range?.type || 'rolling'} onChange={(e) => ups({ date_range: { ...st.date_range, type: e.target.value } })}>
                <option value="rolling">Calendar days into the future</option><option value="fixed">Within a date range</option><option value="indefinite">Indefinitely</option>
              </select>
              {st.date_range?.type === 'rolling' && <input className="small-input" type="number" min="1" max="730" value={st.date_range.days || 60} onChange={(e) => ups({ date_range: { ...st.date_range, days: Number(e.target.value) } })} />}
            </div>
            {st.date_range?.type === 'fixed' && <div className="row gap-sm mt-sm"><input type="date" value={st.date_range.start || ''} onChange={(e) => ups({ date_range: { ...st.date_range, start: e.target.value } })} /><span>to</span><input type="date" value={st.date_range.end || ''} onChange={(e) => ups({ date_range: { ...st.date_range, end: e.target.value } })} /></div>}
          </Field>
          <Field label="Minimum scheduling notice" hint="Prevent last-minute bookings.">
            <div className="row gap-sm"><input className="small-input" type="number" min="0" value={noticeVal} onChange={(e) => ups({ min_notice_minutes: Number(e.target.value) * mult[noticeUnit] })} />
              <select value={noticeUnit} onChange={(e) => ups({ min_notice_minutes: noticeVal * mult[e.target.value] })}><option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option></select></div>
          </Field>
          <Field label="Start time increments" hint="How often slots are offered.">
            <select value={st.increment} onChange={(e) => ups({ increment: Number(e.target.value) })}>{[5, 10, 15, 20, 30, 45, 60, 90, 120, 180].map((n) => <option key={n} value={n}>{durLabel(n)}</option>)}</select>
          </Field>
          <Field label="Buffer before event"><select value={st.buffer_before} onChange={(e) => ups({ buffer_before: Number(e.target.value) })}>{[0, 5, 10, 15, 30, 45, 60, 90, 120].map((n) => <option key={n} value={n}>{n ? durLabel(n) : 'No buffer'}</option>)}</select></Field>
          <Field label="Buffer after event"><select value={st.buffer_after} onChange={(e) => ups({ buffer_after: Number(e.target.value) })}>{[0, 5, 10, 15, 30, 45, 60, 90, 120].map((n) => <option key={n} value={n}>{n ? durLabel(n) : 'No buffer'}</option>)}</select></Field>
        </div>
        <div className="small strong mt">Limit bookings of this event</div>
        <div className="grid-3">
          {[['daily_limit', 'per day'], ['weekly_limit', 'per week'], ['monthly_limit', 'per month']].map(([k, l]) => (
            <Field key={k} label={`Max ${l}`}><input type="number" min="0" placeholder="No limit" value={st[k] || ''} onChange={(e) => ups({ [k]: e.target.value ? Number(e.target.value) : null })} /></Field>
          ))}
        </div>
        <Toggle checked={st.lock_timezone} onChange={(v) => ups({ lock_timezone: v })} label="Lock time zone (show times in my time zone — best for in-person events)" />
      </Section>

      <Section title="Invitee questions" subtitle={`Name, Email${et.questions.length ? ` + ${et.questions.length} custom` : ''}`}>
        <div className="q-fixed"><span>Name</span><Badge>Required</Badge></div>
        <div className="q-fixed"><span>Email</span><Badge>Required</Badge></div>
        {et.questions.map((q, i) => (
          <div key={q.id} className="q-row">
            <div className="grid-q">
              <input value={q.label} placeholder="Question" onChange={(e) => { const a = [...et.questions]; a[i] = { ...q, label: e.target.value }; up({ questions: a }); }} />
              <select value={q.type} onChange={(e) => { const a = [...et.questions]; a[i] = { ...q, type: e.target.value }; up({ questions: a }); }}>{Object.entries(Q_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <Toggle checked={q.required} onChange={(v) => { const a = [...et.questions]; a[i] = { ...q, required: v }; up({ questions: a }); }} label="Required" />
              <div className="row gap-sm">
                <button className="icon-btn" disabled={i === 0} onClick={() => { const a = [...et.questions]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; up({ questions: a }); }} aria-label="Up">↑</button>
                <button className="icon-btn" disabled={i === et.questions.length - 1} onClick={() => { const a = [...et.questions]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; up({ questions: a }); }} aria-label="Down">↓</button>
                <button className="icon-btn" onClick={() => up({ questions: et.questions.filter((_, j) => j !== i) })} aria-label="Delete">✕</button>
              </div>
            </div>
            {['radio', 'checkbox', 'select'].includes(q.type) && (
              <input className="mt-sm" placeholder="Options, comma separated (e.g. Small, Medium, Large)" value={(q.options || []).join(', ')}
                onChange={(e) => { const a = [...et.questions]; a[i] = { ...q, options: e.target.value.split(',').map((s) => s.trimStart()) }; up({ questions: a }); }}
                onBlur={() => { const a = [...et.questions]; a[i] = { ...q, options: (q.options || []).map((s) => s.trim()).filter(Boolean) }; up({ questions: a }); }} />
            )}
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => up({ questions: [...et.questions, { id: Math.random().toString(36).slice(2, 8), label: '', type: 'text', required: false, options: [] }] })}>+ Add new question</Button>
        <div className="row gap-lg wrap mt">
          <Toggle checked={st.allow_guests} onChange={(v) => ups({ allow_guests: v })} label="Allow invitees to add guests" />
          {st.allow_guests && <Field label="Max guests"><input className="small-input" type="number" min="1" max="50" value={st.max_guests} onChange={(e) => ups({ max_guests: Number(e.target.value) })} /></Field>}
        </div>
      </Section>

      <Section title="Booking page & confirmation" open={false}>
        <Field label="On confirmation">
          <select value={st.confirmation?.type || 'default'} onChange={(e) => ups({ confirmation: { ...st.confirmation, type: e.target.value } })}>
            <option value="default">Display Cadence confirmation page</option><option value="redirect">Redirect to an external site</option>
          </select>
        </Field>
        {st.confirmation?.type === 'redirect' && (
          <>
            <Field label="Redirect URL"><input placeholder="https://example.com/thanks" value={st.confirmation.redirect_url || ''} onChange={(e) => ups({ confirmation: { ...st.confirmation, redirect_url: e.target.value } })} /></Field>
            <Toggle checked={st.confirmation.pass_details} onChange={(v) => ups({ confirmation: { ...st.confirmation, pass_details: v } })} label="Pass event details to the redirected page (query params)" />
          </>
        )}
        <div className="row gap-lg wrap mt">
          <Toggle checked={st.allow_invitee_cancel} onChange={(v) => ups({ allow_invitee_cancel: v })} label="Invitees can cancel" />
          <Toggle checked={st.allow_invitee_reschedule} onChange={(v) => ups({ allow_invitee_reschedule: v })} label="Invitees can reschedule" />
        </div>
      </Section>

      <Section title="Payment" subtitle={payments ? (st.price_cents > 0 ? `${(st.price_cents / 100).toFixed(2)} ${st.currency} via Stripe` : 'Free') : 'Free (Stripe not configured)'} open={false}>
        {!payments && <div className="alert mb">To charge for meetings, the site administrator needs to add <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_WEBHOOK_SECRET</code>.</div>}
        <div className="grid-2">
          <Field label="Price" hint="0 = free. Invitees pay on Stripe Checkout before the booking is confirmed."><input type="number" min="0" step="0.01" disabled={!payments} value={(st.price_cents || 0) / 100} onChange={(e) => ups({ price_cents: Math.max(0, Math.round(Number(e.target.value) * 100)) })} /></Field>
          <Field label="Currency"><select disabled={!payments} value={st.currency} onChange={(e) => ups({ currency: e.target.value })}>{['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'SGD', 'JPY'].map((c) => <option key={c}>{c}</option>)}</select></Field>
        </div>
      </Section>
      {share && <ShareModal et={et} onClose={() => setShare(false)} />}
    </div>
  );
}

function pickBody(et) {
  const { name, slug, description, color, kind, durations, duration, locations, questions, hosts, settings, schedule_id, active, secret } = et;
  return { name, slug, description, color, kind, durations, duration, locations, questions: questions.map((q) => ({ ...q, options: (q.options || []).map((o) => o.trim()).filter(Boolean) })), hosts, settings, schedule_id, active, secret };
}
