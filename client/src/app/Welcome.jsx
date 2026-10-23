import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, absUrl, browserTz } from '../lib.js';
import { useAuth, useConfig } from '../auth.js';
import { Button, Field, TimezoneSelect, useToast, Spinner } from '../components/ui.jsx';

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

export default function Welcome() {
  const { me, refresh } = useAuth();
  const cfg = useConfig();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const step = Math.min(3, Math.max(1, Number(params.get('step')) || 1));
  const go = (n) => setParams({ step: String(n) });
  const u = me.user;

  // step 1
  const [f, setF] = useState({ name: u.name, slug: u.slug, timezone: u.timezone && u.timezone !== 'UTC' ? u.timezone : browserTz() });
  const [slugState, setSlugState] = useState({ ok: true, checking: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (f.slug === u.slug) { setSlugState({ ok: true, checking: false }); return undefined; }
    setSlugState({ ok: false, checking: true });
    const t = setTimeout(async () => {
      try { const r = await api(`/me/slug-available?slug=${encodeURIComponent(f.slug)}`); setSlugState({ ok: r.available, checking: false }); } catch { setSlugState({ ok: false, checking: false }); }
    }, 350);
    return () => clearTimeout(t);
  }, [f.slug, u.slug]);

  // step 2
  const [cals, setCals] = useState(null);
  useEffect(() => {
    if (step !== 2) return;
    api('/calendars').then(setCals).catch(() => setCals({ accounts: [], calendars: [] }));
    if (params.get('connected')) toast(`${params.get('connected') === 'google' ? 'Google Calendar' : 'Outlook'} connected`);
    if (params.get('error')) toast(params.get('error'), 'err');
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // step 3
  const [hours, setHours] = useState({ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' });

  const saveProfile = async () => {
    setBusy(true);
    try { await api('/me', { method: 'PATCH', body: { ...f, sync_schedule_timezone: true } }); await refresh(); go(2); } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const finish = async () => {
    setBusy(true);
    try {
      if (hours.start >= hours.end) throw new Error('End time must be after start time.');
      const rules = Object.fromEntries(DAYS.map(([d]) => [d, hours.days.includes(d) ? [{ start: hours.start, end: hours.end }] : []]));
      await api(`/schedules/${u.default_schedule_id}`, { method: 'PATCH', body: { rules, timezone: f.timezone } });
      await api('/me', { method: 'PATCH', body: { onboarded: true } });
      await refresh();
      nav('/app', { replace: true });
    } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  const connect = (provider) => { window.location.href = `/api/auth/calendar/${provider}?next=${encodeURIComponent('/app/welcome?step=2')}`; };

  return (
    <div className="wizard">
      <div className="logo"><span className="logo-mark">≡</span> Cadence</div>
      <div className="wizard-steps">{[1, 2, 3].map((n) => <span key={n} className={n <= step ? 'on' : ''} />)}</div>

      {step === 1 && (
        <div className="card pad stack">
          <h2>Welcome to Cadence, {u.name.split(' ')[0]} 👋</h2>
          <p className="muted">Let's set up your booking page. You can change all of this later.</p>
          <Field label="Your name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Your Cadence link" hint={slugState.checking ? 'Checking…' : slugState.ok ? absUrl(`/${f.slug}`) : 'That link is taken or invalid. Use lowercase letters, numbers and dashes.'}
            error={!slugState.checking && !slugState.ok ? ' ' : undefined}>
            <div className="prefix-input"><span>{window.location.host}/</span><input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} /></div>
          </Field>
          <Field label="Time zone"><TimezoneSelect value={f.timezone} onChange={(z) => setF({ ...f, timezone: z })} /></Field>
          <div className="row gap"><Button onClick={saveProfile} loading={busy} disabled={!slugState.ok || !f.name.trim()}>Continue</Button></div>
        </div>
      )}

      {step === 2 && (
        <div className="card pad stack">
          <h2>Connect your calendar</h2>
          <p className="muted">Cadence checks your calendar for conflicts so people can only book when you're free. New meetings are added to your calendar automatically, with a Google Meet or Teams link.</p>
          {!cals ? <Spinner /> : (
            <>
              <div className="connect-card">
                <div className="connect-logo">📅</div>
                <div className="grow"><div className="strong">Google Calendar</div><div className="small muted">{cals.accounts.filter((a) => a.provider === 'google').map((a) => a.email).join(', ') || 'Gmail & Google Workspace'}</div></div>
                {cfg.features.google_calendar ? <Button variant={cals.accounts.some((a) => a.provider === 'google') ? 'secondary' : 'primary'} onClick={() => connect('google')}>{cals.accounts.some((a) => a.provider === 'google') ? 'Connect another' : 'Connect'}</Button> : <span className="small muted">Not configured</span>}
              </div>
              <div className="connect-card">
                <div className="connect-logo">📨</div>
                <div className="grow"><div className="strong">Outlook / Microsoft 365</div><div className="small muted">{cals.accounts.filter((a) => a.provider === 'microsoft').map((a) => a.email).join(', ') || 'Outlook.com, Hotmail & Microsoft 365'}</div></div>
                {cfg.features.microsoft_calendar ? <Button variant={cals.accounts.some((a) => a.provider === 'microsoft') ? 'secondary' : 'primary'} onClick={() => connect('microsoft')}>{cals.accounts.some((a) => a.provider === 'microsoft') ? 'Connect another' : 'Connect'}</Button> : <span className="small muted">Not configured</span>}
              </div>
              {cals.accounts.length > 0 && <div className="alert alert-success">✓ {cals.calendars.filter((c) => c.check_conflicts).length} calendar(s) checked for conflicts. Bookings will be added to <b>{cals.calendars.find((c) => c.id === cals.write_calendar_id)?.name || '—'}</b>.</div>}
            </>
          )}
          <div className="row gap"><Button variant="ghost" onClick={() => go(1)}>Back</Button><Button onClick={() => go(3)}>{cals?.accounts.length ? 'Continue' : 'Skip for now'}</Button></div>
        </div>
      )}

      {step === 3 && (
        <div className="card pad stack">
          <h2>When are you available?</h2>
          <p className="muted">Pick your usual working hours ({f.timezone.replace(/_/g, ' ')}). You can add more schedules, breaks and date overrides later under Availability.</p>
          <div className="day-pills">{DAYS.map(([d, l]) => (
            <button key={d} type="button" className={`day-pill ${hours.days.includes(d) ? 'on' : ''}`}
              onClick={() => setHours({ ...hours, days: hours.days.includes(d) ? hours.days.filter((x) => x !== d) : [...hours.days, d] })}>{l}</button>
          ))}</div>
          <div className="row gap">
            <Field label="From"><input type="time" value={hours.start} onChange={(e) => setHours({ ...hours, start: e.target.value })} /></Field>
            <Field label="To"><input type="time" value={hours.end} onChange={(e) => setHours({ ...hours, end: e.target.value })} /></Field>
          </div>
          <div className="row gap"><Button variant="ghost" onClick={() => go(2)}>Back</Button><Button onClick={finish} loading={busy} disabled={!hours.days.length}>Finish setup</Button></div>
        </div>
      )}
    </div>
  );
}
