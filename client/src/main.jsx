import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, Link } from 'react-router-dom';
import './styles.css';
import { api, setToken, browserTz } from './lib.js';
import { AuthCtx, useAuth } from './auth.js';
import { ToastProvider, Button, Field, Spinner } from './components/ui.jsx';
import { ProfilePage, EventPage, SingleUseLinkPage, ReschedulePage, BookingPage, PollPage, RoutingFormPage } from './public/Pages.jsx';
import AppLayout from './app/Layout.jsx';
import EventTypes from './app/EventTypes.jsx';
import EventTypeEditor from './app/EventTypeEditor.jsx';
import Troubleshoot from './app/Troubleshoot.jsx';
import Scheduled from './app/Scheduled.jsx';
import Availability from './app/Availability.jsx';
import Polls from './app/Polls.jsx';
import RoutingForms from './app/RoutingForms.jsx';
import Workflows from './app/Workflows.jsx';
import { Contacts, Analytics, Outbox } from './app/Insights.jsx';
import Integrations from './app/Integrations.jsx';
import { Team, Settings } from './app/Account.jsx';


function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, me: null });
  const refresh = useCallback(async () => {
    try { const me = await api('/me'); setState({ loading: false, me }); return me; } catch { setState({ loading: false, me: null }); return null; }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const login = async (email, password) => { const r = await api('/auth/login', { method: 'POST', body: { email, password } }); setToken(r.token); return refresh(); };
  const signup = async (body) => { const r = await api('/auth/signup', { method: 'POST', body }); setToken(r.token); return refresh(); };
  const logout = async () => { try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ } setToken(null); setState({ loading: false, me: null }); };
  return <AuthCtx.Provider value={{ ...state, refresh, login, signup, logout }}>{children}</AuthCtx.Provider>;
}

function RequireAuth({ children }) {
  const { loading, me } = useAuth();
  if (loading) return <Spinner center />;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}

function Landing() {
  const { me } = useAuth();
  const features = [
    ['🗓️', 'Booking pages', 'Beautiful booking pages with month calendar, time-zone detection, 12h/24h and multiple durations.'],
    ['👥', 'Team scheduling', 'One-on-one, group (with seat limits), round robin (availability or equal distribution) and collective events.'],
    ['⏰', 'Smart availability', 'Multiple schedules, date overrides, time off, buffers, minimum notice, date ranges and daily/weekly/monthly caps.'],
    ['🔍', 'Availability troubleshooter', 'See exactly why any slot is unavailable — buffer, calendar conflict, limit, notice, range and more.'],
    ['🔁', 'Reschedule & cancel', 'Self-serve links for invitees with reasons, "former time" display and automatic notifications.'],
    ['📊', 'Polls & routing forms', 'Meeting polls with time reservation, and qualification forms that route people to the right event.'],
    ['✉️', 'Workflows & reminders', 'Automated reminders and follow-ups with template variables, plus confirmation emails with .ics invites.'],
    ['🔌', 'Webhooks, API & embeds', 'Signed webhooks, personal API tokens, ICS calendar sync, and inline/popup/badge embed widgets.'],
  ];
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="logo"><span className="logo-mark">≡</span> Cadence</div>
        <div className="row gap">
          {me ? <Link className="btn btn-primary" to="/app">Go to dashboard</Link> : <><Link className="btn btn-ghost" to="/login">Log in</Link><Link className="btn btn-primary" to="/signup">Get started</Link></>}
        </div>
      </header>
      <section className="hero">
        <h1>Easy scheduling <span className="grad">ahead</span></h1>
        <p>Cadence is an open, self-hostable scheduling platform. Share your link, let people pick a time, and never play email ping-pong again.</p>
        <div className="row gap center-x">
          <Link className="btn btn-primary btn-lg" to="/signup">Sign up free</Link>
          <Link className="btn btn-outline btn-lg" to="/alex">View a demo booking page →</Link>
        </div>
        <div className="demo-creds">Demo login: <code>demo@cadence.app</code> / <code>demo1234</code></div>
      </section>
      <section className="feature-grid">
        {features.map(([i, t, d]) => <div key={t} className="feature"><div className="feature-icon">{i}</div><h3>{t}</h3><p className="muted">{d}</p></div>)}
      </section>
      <footer className="landing-foot muted small">Cadence · built as a clean-room scheduling platform · MIT</footer>
    </div>
  );
}

function AuthPage({ mode }) {
  const { login, signup, me } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: mode === 'login' ? 'demo@cadence.app' : '', password: mode === 'login' ? 'demo1234' : '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (me) nav('/app'); }, [me, nav]);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { mode === 'login' ? await login(f.email, f.password) : await signup({ ...f, timezone: browserTz() }); nav('/app'); } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <Link to="/" className="logo"><span className="logo-mark">≡</span> Cadence</Link>
        <h2>{mode === 'login' ? 'Log in to your account' : 'Sign up for free'}</h2>
        {mode === 'signup' && <Field label="Full name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>}
        <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : undefined}><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
        {err && <div className="alert alert-error">{err}</div>}
        <Button type="submit" loading={busy} className="full">{mode === 'login' ? 'Log in' : 'Create account'}</Button>
        <p className="small muted center">{mode === 'login' ? <>New to Cadence? <Link className="link" to="/signup">Sign up</Link></> : <>Already have an account? <Link className="link" to="/login">Log in</Link></>}</p>
        {mode === 'login' && <p className="small muted center">Demo account prefilled — just click Log in.</p>}
      </form>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
              <Route index element={<EventTypes />} />
              <Route path="event-types/:id" element={<EventTypeEditor />} />
              <Route path="event-types/:id/troubleshoot" element={<Troubleshoot />} />
              <Route path="scheduled" element={<Scheduled />} />
              <Route path="availability" element={<Availability />} />
              <Route path="polls" element={<Polls />} />
              <Route path="routing" element={<RoutingForms />} />
              <Route path="workflows" element={<Workflows />} />
              <Route path="contacts" element={<Contacts />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="integrations" element={<Integrations />} />
              <Route path="team" element={<Team />} />
              <Route path="outbox" element={<Outbox />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="/booking/:uid" element={<BookingPage />} />
            <Route path="/cancel/:uid" element={<BookingPage cancelMode />} />
            <Route path="/reschedule/:uid" element={<ReschedulePage />} />
            <Route path="/d/:token" element={<SingleUseLinkPage />} />
            <Route path="/poll/:token" element={<PollPage />} />
            <Route path="/form/:token" element={<RoutingFormPage />} />
            <Route path="/:slug" element={<ProfilePage />} />
            <Route path="/:slug/:eslug" element={<EventPage />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')).render(<App />);
