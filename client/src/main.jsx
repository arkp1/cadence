import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import './styles.css';
import { api, googleSignIn, isDemo, startDemo, exitDemo } from './lib.js';
import { AuthCtx, useAuth, ConfigCtx, useConfig } from './auth.js';
import { ToastProvider, Spinner, Badge, Button } from './components/ui.jsx';
import { Icon, Logo, LogoMark } from './components/icons.jsx';
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

const DEMO_CONFIG = {
  configured: true,
  missing_config: [],
  features: { google_login: true, google_calendar: true, microsoft_calendar: true, email: true, payments: true },
};

function ConfigGate({ children }) {
  const demo = isDemo();
  const location = useLocation();
  const [cfg, setCfg] = useState(demo ? DEMO_CONFIG : null);
  useEffect(() => {
    if (demo) { setCfg(DEMO_CONFIG); return; }
    fetch('/api/public/config')
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => setCfg({ configured: false, missing_config: ['(server unreachable)'] }));
  }, [demo]);
  if (!cfg) return <Spinner center />;
  // The marketing page and sign-in screen don't need a database, so they stay
  // reachable while a deployment is still being configured.
  const isPublicEntry = location.pathname === '/' || location.pathname === '/login';
  if (!demo && !cfg.configured && !isPublicEntry && cfg.missing_config?.some((k) => ['DATABASE_URL', 'APP_SECRET', '(server unreachable)'].includes(k))) {
    return <SetupPage missing={cfg.missing_config} />;
  }
  return <ConfigCtx.Provider value={demo ? DEMO_CONFIG : cfg}>{children}</ConfigCtx.Provider>;
}

function SetupPage({ missing }) {
  const offline = missing.includes('(server unreachable)');
  const rows = [
    ['DATABASE_URL', 'Postgres connection string — add a Neon database from the Vercel Marketplace (Storage → Neon) and it is set automatically.'],
    ['APP_SECRET', 'A random string of at least 32 characters, used to encrypt calendar tokens and sign cookies. Generate one with: openssl rand -base64 48'],
    ['GOOGLE_CLIENT_ID', 'From Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).'],
    ['GOOGLE_CLIENT_SECRET', 'The secret of the same OAuth client.'],
  ];
  return (
    <div className="auth-wrap">
      <div className="auth-card plain">
        <Link to="/" className="logo"><Logo /></Link>
        <span className="eyebrow"><span className="eyebrow-dot"><Icon name="sparkles" size={11} /></span> Local setup</span>
        <h2>Finish setting up Cadence</h2>
        {offline && (
          <div className="alert alert-warn">
            Can’t reach the API server. Start it with <code>npm run dev</code> and reload this page — or
            preview the interface below, which runs entirely in your browser.
          </div>
        )}
        <p className="muted" style={{ maxWidth: 620 }}>
          This deployment is missing required configuration. Add the environment variables below
          (Vercel → Project → Settings → Environment Variables), then redeploy. You can look around
          the interface first — the preview runs entirely in your browser and needs no database.
        </p>
        <div className="row gap wrap mt">
          <Button onClick={() => startDemo('/app')}>Preview the interface <Icon name="chevron-right" size={15} /></Button>
          <a className="btn btn-secondary" href="/api/health" target="_blank" rel="noreferrer">Check /api/health</a>
        </div>
        <div className="setup-rows">
          {rows.map(([k, d]) => (
            <div key={k} className="setup-row">
              <code>{k}</code>
              {offline ? <Badge color="gray">unknown</Badge> : missing.includes(k) ? <Badge color="red">missing</Badge> : <Badge color="green">set</Badge>}
              <span className="small muted">{d}</span>
            </div>
          ))}
        </div>
        <p className="small muted mt">The full checklist (Google/Microsoft OAuth redirect URIs, Resend email, Stripe, cron) is in the README.</p>
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
  const logout = async () => {
    if (isDemo()) { exitDemo('/'); return; }
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    setState({ loading: false, me: null });
    window.location.href = '/';
  };
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

const FEATURES = [
  { icon: 'calendar', title: 'Booking pages', text: 'Share one link. Invitees see your real availability in their own time zone and book in seconds.' },
  { icon: 'refresh', title: 'Google & Outlook sync', text: 'Busy times block bookings, and new meetings land on your calendar with a Meet or Teams link.' },
  { icon: 'users', title: 'Team scheduling', text: 'One-on-one, group, round robin and collective events, with seat limits and fair distribution.' },
  { icon: 'clock', title: 'Smart availability', text: 'Multiple schedules, date overrides, time off, buffers, minimum notice and daily, weekly or monthly caps.' },
  { icon: 'calendar-check', title: 'Reschedule & cancel', text: 'Self-serve links for invitees. Calendars and notifications update automatically.' },
  { icon: 'credit-card', title: 'Paid meetings', text: 'Collect payment with Stripe Checkout before the meeting is confirmed.' },
  { icon: 'mail', title: 'Workflows & reminders', text: 'Automatic confirmations, reminders and follow-ups with calendar invites attached.' },
  { icon: 'plug', title: 'Webhooks, API & embeds', text: 'Signed webhooks, personal API tokens, and inline or popup embeds for your website.' },
];

const STEPS = [
  { icon: 'link', title: 'Share your link', text: 'One memorable link for every event you offer. Secret events stay hidden behind their own URL.' },
  { icon: 'calendar', title: 'They pick a time', text: 'A clean calendar shows only the slots that work for everyone, in the invitee’s time zone.' },
  { icon: 'check', title: 'Everyone is booked', text: 'The meeting lands on your calendar and confirmations, reminders and video links are sent.' },
];

function MockWindow() {
  const cards = [
    { t: '30 Minute Meeting', m: '30 min · One-on-One', c: '#4f46e5', pill: 'Shared' },
    { t: 'Product Demo', m: '45 min · Group', c: '#0891b2', pill: '4 spots' },
    { t: 'Team Sync', m: '20 min · Round Robin', c: '#db2777', pill: 'Team' },
    { t: 'Intro Call', m: '15 min · One-on-One', c: '#16a34a', pill: 'Paid' },
  ];
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="mock">
        <div className="mock-top">
          <span className="mock-dots"><i /><i /><i /></span>
          <span className="mock-addr">cadence.app/ada</span>
        </div>
        <div className="mock-body">
          <aside className="mock-side">
            <div className="mock-brand"><LogoMark size={20} /> Cadence</div>
            <div className="mock-nav on"><span className="mock-nav-dot" /> Event types</div>
            <div className="mock-nav"><span className="mock-nav-dot" /> Scheduled</div>
            <div className="mock-nav"><span className="mock-nav-dot" /> Availability</div>
            <div className="mock-nav"><span className="mock-nav-dot" /> Workflows</div>
            <div className="mock-spacer" />
            <div className="mock-user"><span className="mock-avatar" /> Ada Lovelace</div>
          </aside>
          <div className="mock-main">
            <div className="mock-head">
              <div>
                <div className="mock-h1">Event types</div>
                <div className="mock-sub">Share a link, get booked.</div>
              </div>
              <span className="mock-btn">+ New</span>
            </div>
            <div className="mock-grid">
              {cards.map((card) => (
                <div key={card.t} className="mock-card" style={{ '--mc': card.c }}>
                  <div className="mock-card-t">{card.t}</div>
                  <div className="mock-card-m">{card.m}</div>
                  <div className="mock-card-row">
                    <span className="mock-switch" />
                    <span className="mock-pill">{card.pill}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="float-card float-a">
        <span className="float-ico"><Icon name="check" size={14} /></span>
        <div><div className="float-t">Booked by Priya</div><div className="float-s">Tomorrow · 10:30 AM</div></div>
      </div>
      <div className="float-card float-b">
        <span className="float-ico brand"><Icon name="calendar" size={14} /></span>
        <div><div className="float-t">Calendar synced</div><div className="float-s">Google · just now</div></div>
      </div>
    </div>
  );
}

function Landing() {
  const { me } = useAuth();
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Link to="/" className="logo"><Logo /></Link>
          <div className="landing-links">
            <a className="nav-link" href="#features">Features</a>
            <a className="nav-link" href="#how">How it works</a>
            <a className="nav-link" href="#preview">Preview</a>
          </div>
          <div className="row gap-sm">
            {me ? (
              <Link className="btn btn-primary" to="/app">Open dashboard <Icon name="chevron-right" size={14} /></Link>
            ) : (
              <>
                <Link className="btn btn-ghost" to="/login">Log in</Link>
                <Link className="btn btn-primary" to="/login">Get started</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="eyebrow-dot"><Icon name="sparkles" size={11} /></span>
              Scheduling that gets out of the way
            </span>
            <h1>Easy scheduling <span className="grad">ahead</span></h1>
            <p className="lead">
              Share your link, let people pick a time that actually works, and never play email
              ping-pong again. Cadence keeps Google Calendar and Outlook in sync — automatically.
            </p>
            <div className="hero-actions">
              {me ? (
                <Link className="btn btn-primary btn-lg" to="/app">Open dashboard <Icon name="chevron-right" size={15} /></Link>
              ) : (
                <GoogleButton className="btn-lg" next="/app" label="Sign up with Google" />
              )}
              <Button variant="secondary" size="lg" onClick={() => startDemo('/app')}>
                <Icon name="play" size={15} /> Explore the preview
              </Button>
            </div>
            <div className="hero-note">
              <span><Icon name="check" size={14} /> Free to use</span>
              <span><Icon name="check" size={14} /> No credit card</span>
              <span><Icon name="check" size={14} /> Google &amp; Outlook sync</span>
            </div>
          </div>
          <MockWindow />
        </div>
      </section>

      <section className="landing-section" id="features">
        <span className="section-kicker">Everything you need</span>
        <h2 className="section-heading">The whole scheduling toolkit,<br />without the busywork.</h2>
        <p className="section-sub">Booking pages, team routing, payments, reminders and an API — all sharing one clean, fast interface.</p>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <div className="feature-icon"><Icon name={f.icon} size={20} /></div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="how">
        <span className="section-kicker">How it works</span>
        <h2 className="section-heading">Three steps. That's it.</h2>
        <div className="how-grid">
          {STEPS.map((s, i) => (
            <div className="step-card" key={s.title}>
              <div className="step-num">{i + 1}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-band" id="preview">
        <div className="cta-inner">
          <div>
            <h2>See the interface for yourself.</h2>
            <p>Open a fully interactive preview with sample data — no sign-in, no database, nothing to configure.</p>
          </div>
          <div className="cta-actions">
            <Button variant="secondary" size="lg" onClick={() => startDemo('/app')}>Launch preview <Icon name="chevron-right" size={15} /></Button>
            <Link className="btn btn-ghost btn-lg" to="/login">Sign in with Google</Link>
          </div>
        </div>
      </section>

      <footer className="landing-foot">
        <div className="landing-foot-inner">
          <Link to="/" className="logo"><Logo /></Link>
          <div className="foot-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <Link to="/login">Sign in</Link>
            <a href="/api/health">Status</a>
          </div>
          <span className="small muted">© {new Date().getFullYear()} Cadence. Scheduling, simplified.</span>
        </div>
      </footer>
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
  const demo = isDemo();
  useEffect(() => { if (me) nav(next.startsWith('/') && !next.startsWith('//') ? next : '/app', { replace: true }); }, [me, nav, next]);
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <aside className="auth-aside">
          <Link to="/" className="logo"><Logo /></Link>
          <div>
            <div className="auth-quote">“The shortest path between ‘let’s meet’ and a booked meeting.”</div>
            <ul className="auth-benefits">
              <li><span className="auth-check"><Icon name="check" size={12} /></span> One link for every event you offer</li>
              <li><span className="auth-check"><Icon name="check" size={12} /></span> Real-time Google &amp; Outlook availability</li>
              <li><span className="auth-check"><Icon name="check" size={12} /></span> Automatic reminders and calendar invites</li>
            </ul>
          </div>
          <div className="auth-meta">Built for people who live in their calendars.</div>
        </aside>
        <main className="auth-main">
          <Link to="/" className="logo"><Logo /></Link>
          <div>
            <h1>Sign in to Cadence</h1>
            <p className="muted" style={{ marginTop: 8 }}>
              New here? Signing in creates your account. If a teammate invited you, use the Google
              account that received the invite.
            </p>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          {cfg.features.google_login
            ? <GoogleButton next={next} className="btn-lg" />
            : <div className="alert alert-error">Google sign-in isn&apos;t configured on this server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).</div>}
          {!demo && (
            <div className="row between gap wrap" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              <span className="small muted">Just looking around?</span>
              <Button variant="secondary" size="sm" onClick={() => startDemo('/app')}>
                <Icon name="play" size={13} /> Open the preview
              </Button>
            </div>
          )}
          <p className="small muted center" style={{ marginTop: 4 }}>
            By continuing you agree to let Cadence read your name, email and profile picture from Google.
          </p>
        </main>
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
