import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowRight, CalendarDays, Check, Clock3, CreditCard, Globe2, Link2, Mail, Play,
  ShieldCheck, Sparkles, Users, Video, Zap,
} from 'lucide-react';
import './styles.css';
import { api, googleSignIn, isDemo, startDemo, exitDemo } from './lib.js';
import { AuthCtx, useAuth, ConfigCtx, useConfig } from './auth.js';
import { ToastProvider, Spinner, Badge, Button } from './components/ui.jsx';
import { buttonVariants } from '@/components/ui/button';
import { Logo, LogoMark } from './components/icons.jsx';
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
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-3xl rounded-3xl border border-border/70 bg-card p-7 shadow-[0_30px_80px_-40px_rgba(28,25,23,0.35)] sm:p-10">
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="logo"><Logo /></Link>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-[11px] font-medium text-muted-foreground">
            <Sparkles className="size-3" /> Local setup
          </span>
        </div>
        <h1 className="mt-7 font-serif text-[38px] leading-[1.02] tracking-[-0.03em] sm:text-[46px]">Finish setting up Cadence</h1>
        {offline && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
            Can’t reach the API server. Start it with <code>npm run dev</code> and reload this page — or preview the interface below, which runs entirely in your browser.
          </div>
        )}
        <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
          This deployment is missing required configuration. Add the environment variables below
          (Vercel → Project → Settings → Environment Variables), then redeploy. Want to look around first?
          The preview runs entirely in your browser and needs no database.
        </p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <Button onClick={() => startDemo('/app')}>Preview the interface <ArrowRight className="size-4" /></Button>
          <Button variant="secondary" onClick={() => window.open('/api/health', '_blank', 'noopener')}>Check /api/health</Button>
        </div>
        <div className="mt-8 space-y-2.5">
          {rows.map(([k, d]) => (
            <div key={k} className="grid gap-2 rounded-xl border border-border/70 bg-secondary/40 px-4 py-3 sm:grid-cols-[190px_92px_1fr] sm:items-center sm:gap-4">
              <code>{k}</code>
              {offline ? <Badge color="gray">unknown</Badge> : missing.includes(k) ? <Badge color="red">missing</Badge> : <Badge color="green">set</Badge>}
              <span className="text-xs leading-relaxed text-muted-foreground">{d}</span>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs text-muted-foreground">The full checklist (Google/Microsoft OAuth redirect URIs, Resend email, Stripe, cron) is in the README.</p>
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
  return (
    <Button variant="google" size="lg" className={cn('w-full', className)} onClick={() => googleSignIn(next)}>
      <GoogleG /> {label}
    </Button>
  );
}

const FEATURES = [
  { icon: CalendarDays, title: 'Booking pages', text: 'Share one link. Invitees see your real availability in their own time zone and book in seconds.' },
  { icon: Zap, title: 'Google & Outlook sync', text: 'Busy times block bookings, and new meetings land on your calendar with a Meet or Teams link.' },
  { icon: Users, title: 'Team scheduling', text: 'One-on-one, group, round robin and collective events, with seat limits and fair distribution.' },
  { icon: Clock3, title: 'Smart availability', text: 'Multiple schedules, date overrides, time off, buffers, minimum notice and booking caps.' },
  { icon: CreditCard, title: 'Paid meetings', text: 'Collect payment with Stripe Checkout before the meeting is confirmed.' },
  { icon: Mail, title: 'Workflows & reminders', text: 'Automatic confirmations, reminders and follow-ups with calendar invites attached.' },
];

const STEPS = [
  { icon: Link2, title: 'Share one link', text: 'Every event you offer behind a single, memorable booking page.' },
  { icon: CalendarDays, title: 'They pick a time', text: 'Only the slots that work for everyone, shown in the invitee’s time zone.' },
  { icon: Check, title: 'Everyone is booked', text: 'The meeting lands on your calendar with confirmations, reminders and video links.' },
];

function BookingPreview() {
  const days = [
    ['M', 5], ['T', 6], ['W', 7], ['T', 8], ['F', 9], ['S', 10], ['S', 11],
    ['M', 12], ['T', 13], ['W', 14], ['T', 15], ['F', 16], ['S', 17], ['S', 18],
    ['M', 19], ['T', 20], ['W', 21], ['T', 22], ['F', 23], ['S', 24], ['S', 25],
  ];
  const times = ['9:00 am', '9:30 am', '10:00 am', '10:30 am', '11:00 am', '11:30 am'];
  return (
    <div className="relative">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[36px] bg-gradient-to-br from-primary/15 via-amber-100/50 to-rose-100/40 blur-2xl" />
      <Card className="relative overflow-hidden gap-0 rounded-[26px] border-border/80 bg-card/95 p-0 shadow-[0_40px_90px_-40px_rgba(28,25,23,0.55)] backdrop-blur">
        <div className="grid sm:grid-cols-[0.9fr_1.1fr]">
          <div className="border-b border-border/70 bg-gradient-to-b from-secondary/50 to-card p-6 sm:border-r sm:border-b-0">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground shadow-sm">AL</span>
              <div>
                <div className="text-[11px] font-medium text-muted-foreground">Ada Lovelace</div>
                <div className="font-serif text-[26px] leading-tight tracking-[-0.02em]">30 Minute Meeting</div>
              </div>
            </div>
            <div className="mt-5 space-y-2.5 text-[12.5px] text-muted-foreground">
              <div className="flex items-center gap-2"><Clock3 className="size-3.5" /> 30 min</div>
              <div className="flex items-center gap-2"><Video className="size-3.5" /> Google Meet</div>
              <div className="flex items-center gap-2"><Globe2 className="size-3.5" /> Asia/Calcutta</div>
            </div>
            <p className="mt-5 text-[12.5px] leading-relaxed text-muted-foreground">
              A focused half hour on the things that matter. Bring a question, I’ll bring the whiteboard.
            </p>
            <div className="mt-5 flex -space-x-2">
              {['#5b57d1', '#e08b61', '#6b9b7c'].map((c) => <span key={c} className="size-7 rounded-full border-2 border-card" style={{ background: c }} />)}
              <span className="grid size-7 place-items-center rounded-full border-2 border-card bg-secondary text-[9px] font-semibold text-muted-foreground">+3</span>
            </div>
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium">Select a time</span>
              <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-medium text-muted-foreground">October</span>
            </div>
            <div className="mt-4 grid grid-cols-7 gap-1 text-center">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="pb-1 text-[9px] font-medium text-muted-foreground">{d}</div>)}
              {days.map(([d, n]) => (
                <div key={n} className={cn(
                  'grid aspect-square place-items-center rounded-full text-[11px]',
                  n === 21 ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : [12, 13, 14, 19, 20, 22, 23].includes(n) ? 'bg-primary/[0.07] font-medium text-primary' : 'text-muted-foreground/50',
                )}>{n}</div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-1.5">
              {times.map((t) => (
                <div key={t} className={cn(
                  'rounded-lg border px-2 py-2 text-center text-[11px] font-medium',
                  t === '10:00 am' ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border/70 bg-card text-muted-foreground',
                )}>{t}</div>
              ))}
            </div>
          </div>
        </div>
      </Card>
      <div className="absolute -bottom-5 -left-4 flex items-center gap-2.5 rounded-2xl border border-border/70 bg-card/95 px-3.5 py-2.5 shadow-xl backdrop-blur sm:-left-8">
        <span className="grid size-8 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Check className="size-4" /></span>
        <div>
          <div className="text-[11px] font-semibold">Booked by Priya</div>
          <div className="text-[10px] text-muted-foreground">Tue · 10:00 am</div>
        </div>
      </div>
      <div className="absolute -top-4 -right-3 hidden items-center gap-2.5 rounded-2xl border border-border/70 bg-card/95 px-3.5 py-2.5 shadow-xl backdrop-blur sm:flex sm:-right-6">
        <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary"><CalendarDays className="size-4" /></span>
        <div>
          <div className="text-[11px] font-semibold">Calendar synced</div>
          <div className="text-[10px] text-muted-foreground">Google · just now</div>
        </div>
      </div>
    </div>
  );
}

function Landing() {
  const { me } = useAuth();
  return (
    <div className="landing min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between gap-5 px-5 sm:px-8">
          <Link to="/" className="logo"><Logo /></Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Landing navigation">
            <a className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" href="#features">Features</a>
            <a className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" href="#how">How it works</a>
            <a className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" href="#preview">Preview</a>
          </nav>
          <div className="flex items-center gap-2">
            {me ? (
              <Link to="/app" className={cn(buttonVariants({ size: 'sm' }))}>Open dashboard <ArrowRight className="size-3.5" /></Link>
            ) : (
              <>
                <Link to="/login" className="hidden rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:block">Log in</Link>
                <Link to="/login" className={cn(buttonVariants({ size: 'sm' }))}>Get started</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-48 -right-32 -z-10 size-[560px] rounded-full bg-primary/[0.09] blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute top-72 -left-32 -z-10 size-[420px] rounded-full bg-amber-200/30 blur-3xl" />
        <div className="mx-auto grid max-w-6xl gap-14 px-5 pt-14 pb-20 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-16 lg:pt-24 lg:pb-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card/70 py-1.5 pr-3 pl-1.5 text-[11.5px] font-medium text-muted-foreground shadow-xs backdrop-blur">
              <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-primary"><Sparkles className="size-3" /></span>
              Scheduling, without the back-and-forth
            </span>
            <h1 className="mt-6 font-serif text-[clamp(3.1rem,6.4vw,5.4rem)] leading-[0.92] tracking-[-0.035em]">
              Make time for<br /><span className="italic text-primary">better</span> conversations.
            </h1>
            <p className="mt-6 max-w-[34rem] text-[16.5px] leading-relaxed text-muted-foreground">
              Cadence turns “when are you free?” into a booked meeting. Share one link, sync the
              calendars that matter, and keep the rest of your day yours.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {me ? (
                <Link to="/app" className={cn(buttonVariants({ size: 'lg' }))}>Open dashboard <ArrowRight className="size-4" /></Link>
              ) : (
                <GoogleButton className="w-auto" label="Sign up with Google" next="/app" />
              )}
              <Button variant="outline" size="lg" onClick={() => startDemo('/app')}><Play className="size-4" /> Explore the preview</Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-emerald-600" /> Free to use</span>
              <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-emerald-600" /> No credit card</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-600" /> Google &amp; Outlook sync</span>
            </div>
          </div>
          <BookingPreview />
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-5 pb-8 pt-10 sm:px-8 sm:pt-16">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Everything you need</div>
            <h2 className="mt-3 max-w-xl font-serif text-[clamp(2rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.03em]">The whole scheduling toolkit, without the busywork.</h2>
          </div>
          <p className="max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">Booking pages, team routing, payments and reminders — one calm, considered interface.</p>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="group gap-0 border-border/70 bg-card p-6 shadow-none transition-all duration-300 hover:-translate-y-0.5 hover:border-border hover:shadow-[0_20px_45px_-32px_rgba(28,25,23,0.3)]">
              <div className="grid size-10 place-items-center rounded-xl border border-primary/10 bg-primary/[0.06] text-primary transition-colors group-hover:bg-primary/10">
                <f.icon className="size-[18px]" strokeWidth={1.8} />
              </div>
              <h3 className="mt-4 text-[14.5px] font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{f.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="rounded-[32px] border border-border/70 bg-gradient-to-br from-secondary/60 via-card to-card p-7 sm:p-12">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">How it works</div>
              <h2 className="mt-3 font-serif text-[clamp(2rem,3.6vw,3rem)] leading-[1.02] tracking-[-0.03em]">Three steps. That’s it.</h2>
              <p className="mt-4 text-[13.5px] leading-relaxed text-muted-foreground">Set it up once. Cadence quietly handles the link, the availability, the invite and the reminders.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {STEPS.map((s, i) => (
                <div key={s.title} className="rounded-2xl border border-border/70 bg-card/80 p-5">
                  <div className="flex items-center justify-between">
                    <span className="grid size-9 place-items-center rounded-xl bg-primary/[0.07] text-primary"><s.icon className="size-4" /></span>
                    <span className="font-serif text-[22px] text-border">0{i + 1}</span>
                  </div>
                  <h3 className="mt-4 text-[13px] font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="preview" className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <div className="relative overflow-hidden rounded-[32px] bg-[#17151b] px-7 py-10 text-white sm:px-12 sm:py-14">
          <div aria-hidden className="pointer-events-none absolute -top-24 right-0 size-[420px] rounded-full bg-primary/30 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 size-[360px] rounded-full bg-amber-400/10 blur-3xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-8">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Try it now</div>
              <h2 className="mt-3 max-w-xl font-serif text-[clamp(2rem,4vw,3.4rem)] leading-[1.02] tracking-[-0.03em] text-white">Your calendar, a little lighter.</h2>
              <p className="mt-4 max-w-lg text-[13.5px] leading-relaxed text-white/60">Open a fully interactive preview with sample data — no sign-in, no database, nothing to configure.</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button size="lg" className="bg-white text-[#17151b] hover:bg-white/90" onClick={() => startDemo('/app')}>Launch preview <ArrowRight className="size-4" /></Button>
              <Link to="/login" className="inline-flex h-11 items-center rounded-xl border border-white/20 px-5 text-[13.5px] font-medium text-white transition-colors hover:bg-white/10">Sign in with Google</Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60 bg-background/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 px-5 py-8 sm:px-8">
          <Link to="/" className="logo"><Logo /></Link>
          <div className="flex flex-wrap items-center gap-5 text-[12px] text-muted-foreground">
            <a className="transition-colors hover:text-foreground" href="#features">Features</a>
            <a className="transition-colors hover:text-foreground" href="#how">How it works</a>
            <Link className="transition-colors hover:text-foreground" to="/login">Sign in</Link>
            <a className="transition-colors hover:text-foreground" href="/api/health">Status</a>
          </div>
          <span className="text-[11.5px] text-muted-foreground">© {new Date().getFullYear()} Cadence. Scheduling, simplified.</span>
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 sm:px-6">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_40px_100px_-50px_rgba(28,25,23,0.45)] lg:grid-cols-[1fr_1.06fr]">
        <main className="order-2 flex flex-col justify-center gap-7 p-7 sm:p-12 lg:order-1">
          <Link to="/" className="logo self-start"><Logo /></Link>
          <div>
            <h1 className="text-[30px] leading-tight tracking-[-0.035em]">Sign in to Cadence</h1>
            <p className="mt-3 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
              New here? Signing in creates your account. If a teammate invited you, use the Google
              account that received the invite.
            </p>
          </div>
          {error && <div className="rounded-xl border border-destructive/20 bg-destructive/[0.06] px-4 py-3 text-[13px] text-destructive">{error}</div>}
          {cfg.features.google_login
            ? <GoogleButton next={next} />
            : <div className="rounded-xl border border-destructive/20 bg-destructive/[0.06] px-4 py-3 text-[12.5px] leading-relaxed text-destructive">Google sign-in isn’t configured on this server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).</div>}
          {!demo && (
            <>
              <div className="flex items-center gap-3"><Separator className="flex-1" /><span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">or</span><Separator className="flex-1" /></div>
              <Button variant="outline" onClick={() => startDemo('/app')}><Play className="size-4" /> Open the interface preview</Button>
            </>
          )}
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            By continuing you agree to let Cadence read your name, email and profile picture from Google.
          </p>
        </main>
        <aside className="relative order-1 hidden min-h-[560px] flex-col justify-between overflow-hidden bg-[#17151b] p-10 text-white lg:order-2 lg:flex">
          <div aria-hidden className="pointer-events-none absolute -top-20 right-0 size-[360px] rounded-full bg-primary/35 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 size-[320px] rounded-full bg-amber-400/10 blur-3xl" />
          <Link to="/" className="relative flex items-center gap-2.5 text-white">
            <LogoMark size={30} /><span className="text-[17px] font-semibold tracking-[-0.03em]">Cadence</span>
          </Link>
          <div className="relative">
            <div className="font-serif text-[34px] leading-[1.08] tracking-[-0.03em]">“The shortest path between ‘let’s meet’ and a booked meeting.”</div>
            <ul className="mt-7 space-y-3 text-[12.5px] text-white/65">
              {['One link for every event you offer', 'Real-time Google & Outlook availability', 'Automatic reminders and calendar invites'].map((line) => (
                <li key={line} className="flex items-center gap-2.5">
                  <span className="grid size-5 place-items-center rounded-full bg-white/10 text-white"><Check className="size-3" /></span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative text-[11.5px] text-white/40">Built for people who live in their calendars.</div>
        </aside>
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
