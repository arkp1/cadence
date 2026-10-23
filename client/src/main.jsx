import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import './styles.css';
import { api, googleSignIn } from './lib.js';
import { AuthCtx, useAuth, ConfigCtx, useConfig } from './auth.js';
import { ToastProvider, Spinner, Badge } from './components/ui.jsx';
import Welcome from './app/Welcome.jsx';
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


function ConfigGate({ children }) {
  const [cfg, setCfg] = useState(null);
  useEffect(() => { fetch('/api/public/config').then((r) => r.json()).then(setCfg).catch(() => setCfg({ configured: false, missing_config: ['(server unreachable)'] })); }, []);
  if (!cfg) return <Spinner center />;
  if (!cfg.configured && cfg.missing_config?.some((k) => ['DATABASE_URL', 'APP_SECRET', '(server unreachable)'].includes(k))) return <SetupPage missing={cfg.missing_config} />;
  return <ConfigCtx.Provider value={cfg}>{children}</ConfigCtx.Provider>;
}

function SetupPage({ missing }) {
  const rows = [
    ['DATABASE_URL', 'Postgres connection string — add a Neon database from the Vercel Marketplace (Storage → Neon) and it is set automatically.'],
    ['APP_SECRET', 'A random string of at least 32 characters, used to encrypt calendar tokens and sign cookies. Generate one with: openssl rand -base64 48'],
    ['GOOGLE_CLIENT_ID', 'From Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).'],
    ['GOOGLE_CLIENT_SECRET', 'The secret of the same OAuth client.'],
  ];
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 640 }}>
        <div className="logo"><span className="logo-mark">≡</span> Cadence</div>
        <h2>Finish setting up Cadence</h2>
        <p className="muted">This deployment is missing required configuration. Add these environment variables (Vercel → Project → Settings → Environment Variables), then redeploy.</p>
        <table className="table"><tbody>{rows.map(([k, d]) => (
          <tr key={k}><td style={{ whiteSpace: 'nowrap' }}><code>{k}</code></td><td>{missing.includes(k) ? <Badge color="red">missing</Badge> : <Badge color="green">set</Badge>}</td><td className="small muted">{d}</td></tr>
        ))}</tbody></table>
        <p className="small muted">The full checklist (Google/Microsoft OAuth redirect URIs, Resend email, Stripe, cron) is in the README.</p>
      </div>
    </div>
  );
}

function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, me: null });
  const refresh = useCallback(async () => {
    try { const me = await api('/me'); setState({ loading: false, me }); return me; } catch { setState({ loading: false, me: null }); return null; }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const logout = async () => { try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ } setState({ loading: false, me: null }); window.location.href = '/'; };
  return <AuthCtx.Provider value={{ ...state, refresh, logout }}>{children}</AuthCtx.Provider>;
}

function RequireAuth({ children, allowUnonboarded }) {
  const { loading, me } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner center />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!me.user.onboarded && !allowUnonboarded) return <Navigate to="/app/welcome" replace />;
  return children;
}

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
);
export function GoogleButton({ next, label = 'Continue with Google', className = '' }) {
  return <button type="button" className={`btn btn-google ${className}`} onClick={() => googleSignIn(next)}><GoogleG /> {label}</button>;
}

function Landing() {
  const { me } = useAuth();
  const features = [
    ['🗓️', 'Booking pages', 'Share one link. Invitees see your real availability in their own time zone and book in seconds.'],
    ['📆', 'Google & Outlook sync', 'Connect Google Calendar or Outlook: busy times block bookings, and new meetings land on your calendar with a Meet or Teams link.'],
    ['👥', 'Team scheduling', 'One-on-one, group, round robin and collective events, with seat limits and fair distribution.'],
    ['⏰', 'Smart availability', 'Multiple schedules, date overrides, time off, buffers, minimum notice and daily/weekly/monthly caps.'],
    ['🔁', 'Reschedule & cancel', 'Self-serve links for invitees. Calendars and notifications update automatically.'],
    ['💳', 'Paid meetings', 'Collect payment with Stripe Checkout before the meeting is confirmed.'],
    ['✉️', 'Workflows & reminders', 'Automatic confirmations, reminders and follow-ups with calendar invites attached.'],
    ['🔌', 'Webhooks, API & embeds', 'Signed webhooks, personal API tokens, and inline/popup embeds for your website.'],
  ];
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="logo"><span className="logo-mark">≡</span> Cadence</div>
        <div className="row gap">
          {me ? <Link className="btn btn-primary" to="/app">Go to dashboard</Link> : <><Link className="btn btn-ghost" to="/login">Log in</Link><Link className="btn btn-primary" to="/login">Get started</Link></>}
        </div>
      </header>
      <section className="hero">
        <h1>Easy scheduling <span className="grad">ahead</span></h1>
        <p>Share your link, let people pick a time that works, and never play email ping-pong again. Cadence syncs with Google Calendar and Outlook.</p>
        <div className="row gap center-x">
          {me ? <Link className="btn btn-primary btn-lg" to="/app">Open dashboard</Link> : <GoogleButton className="btn-lg" next="/app" label="Sign up with Google" />}
        </div>
        <p className="small muted mt">Free to use · No credit card</p>
      </section>
      <section className="feature-grid">
        {features.map(([i, t, d]) => <div key={t} className="feature"><div className="feature-icon">{i}</div><h3>{t}</h3><p className="muted">{d}</p></div>)}
      </section>
      <footer className="landing-foot muted small">© {new Date().getFullYear()} Cadence</footer>
    </div>
  );
}

function LoginPage() {
  const { me } = useAuth();
  const cfg = useConfig();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/app';
  const error = params.get('error');
  useEffect(() => { if (me) nav(next.startsWith('/') && !next.startsWith('//') ? next : '/app', { replace: true }); }, [me, nav, next]);
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Link to="/" className="logo"><span className="logo-mark">≡</span> Cadence</Link>
        <h2>Sign in to Cadence</h2>
        <p className="muted">New here? Signing in creates your account. If a teammate invited you, use the Google account that received the invite.</p>
        {error && <div className="alert alert-error">{error}</div>}
        {cfg.features.google_login
          ? <GoogleButton next={next} className="full btn-lg" />
          : <div className="alert alert-error">Google sign-in isn't configured on this server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).</div>}
        <p className="small muted center">By continuing you agree to let Cadence read your name, email and profile picture from Google.</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ConfigGate>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<Navigate to="/login" replace />} />
            <Route path="/app/welcome" element={<RequireAuth allowUnonboarded><Welcome /></RequireAuth>} />
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
      </ConfigGate>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')).render(<App />);
