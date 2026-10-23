import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, ensureSchema, createUser } from './db.js';
import { api } from './api.js';
import { oauth } from './oauth.js';
import { pub, feedHandler } from './public.js';
import { tickJobs } from './notify.js';
import { syncStaleCalendars } from './calendars.js';
import { stripeWebhook } from './payments.js';
import { afterBookingConfirmed } from './bookings.js';
import { EMBED_JS } from './embed.js';
import { config, features, missingConfig, rememberBase } from './config.js';
import { background } from './background.js';
import { startSession } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');
export const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

// ---- security headers ----
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (config.isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // The dashboard must not be framed (clickjacking); public booking pages may be embedded anywhere.
  res.set('Content-Security-Policy', req.path.startsWith('/app') || req.path.startsWith('/login') ? "frame-ancestors 'self'" : 'frame-ancestors *');
  rememberBase(req);
  next();
});

// ---- health / public config (work even before the database is configured) ----
app.get('/api/health', async (_req, res) => {
  const missing = missingConfig();
  let database = 'not_configured';
  if (config.databaseUrl) { try { await ensureSchema(); await db.query('SELECT 1'); database = 'ok'; } catch (e) { database = `error: ${e.message}`; } }
  res.status(missing.length || database !== 'ok' ? 503 : 200).json({ ok: !missing.length && database === 'ok', database, missing_config: missing, features: features() });
});
app.get('/api/public/config', (_req, res) => res.json({ features: features(), missing_config: missingConfig(), configured: !missingConfig().length }));

// Everything below needs a database + secret.
app.use('/api', (req, res, next) => {
  const missing = missingConfig().filter((k) => k === 'DATABASE_URL' || k === 'APP_SECRET');
  if (missing.length) return res.status(503).json({ error: 'Cadence is not configured yet.', setup_required: true, missing_config: missing });
  ensureSchema().then(() => next(), (e) => { console.error('schema', e); res.status(503).json({ error: 'Database unavailable. Please try again shortly.' }); });
});

// Stripe needs the raw body for signature checks — mount before the JSON parser.
app.use('/api/stripe/webhook', stripeWebhook(afterBookingConfirmed));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---- background maintenance (cron + opportunistic) ----
async function maintenance() {
  await db.query("UPDATE bookings SET status='expired', hold_expires_at=NULL WHERE status='pending_payment' AND hold_expires_at < now_iso()");
  await db.query('DELETE FROM sessions WHERE expires_at < now_iso()');
  await db.query("DELETE FROM webhook_deliveries WHERE created_at < ?", new Date(Date.now() - 30 * 86400000).toISOString());
}
export async function runTick() {
  const out = {};
  out.jobs = await tickJobs().catch((e) => `error: ${e.message}`);
  out.calendars = await syncStaleCalendars().catch((e) => `error: ${e.message}`);
  await maintenance().catch((e) => { out.maintenance = `error: ${e.message}`; });
  return out;
}
const cronAuth = (req) => {
  if (!config.cronSecret) return false;
  const a = Buffer.from(String(req.get('authorization') || '')); const b = Buffer.from(`Bearer ${config.cronSecret}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
app.all('/api/cron/tick', async (req, res) => {
  if (!cronAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ ok: true, ...(await runTick()) });
});
if (process.env.VERCEL) {
  // Serverless has no timers: piggy-back due work on regular traffic (cron is the reliable path).
  let last = 0;
  app.use('/api', (_req, _res, next) => {
    if (Date.now() - last > 60000) { last = Date.now(); background(runTick); }
    next();
  });
}

// ---- dev-only sign-in for local testing (never available in production) ----
if (!config.isProd && process.env.DEV_LOGIN === '1') {
  console.warn('⚠️  DEV_LOGIN is enabled — /api/auth/dev-login lets anyone sign in. Never enable this in production.');
  app.post('/api/auth/dev-login', async (req, res) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) return res.status(400).json({ error: 'email required' });
    let u = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!u) {
      const inv = await db.prepare('SELECT * FROM invites WHERE email=? AND accepted_at IS NULL ORDER BY id DESC LIMIT 1').get(email);
      const id = await createUser({ email, name: req.body?.name || email.split('@')[0], timezone: req.body?.timezone || 'UTC', orgId: inv?.org_id || null, role: inv ? inv.role : 'owner' });
      if (inv) await db.prepare('UPDATE invites SET accepted_at=now_iso() WHERE id=?').run(inv.id);
      u = await db.prepare('SELECT * FROM users WHERE id=?').get(id);
    }
    await startSession(req, res, u.id);
    res.json({ ok: true, user_id: u.id });
  });
}

app.use('/api/auth', oauth);
app.use('/api/public', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type, Booking-Request-ID');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}, pub);
app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.get('/feed/:token', async (req, res) => {
  if (missingConfig().includes('DATABASE_URL')) return res.status(503).send('Not configured');
  try { await ensureSchema(); await feedHandler(req, res); } catch (e) { console.error(e); res.status(500).send('Error'); }
});
app.get('/embed.js', (_req, res) => res.type('application/javascript').set('Access-Control-Allow-Origin', '*').set('Cache-Control', 'public, max-age=3600').send(EMBED_JS));

const staticFiles = express.static(DIST, { index: false, maxAge: '1h' });
app.use((req, res, next) => (fs.existsSync(DIST) ? staticFiles(req, res, next) : next()));
app.get('/{*splat}', (_req, res) => {
  const index = path.join(DIST, 'index.html');
  if (!fs.existsSync(index)) return res.status(503).send('Frontend not built. Run `npm run build`.');
  res.set('Cache-Control', 'no-cache').sendFile(index, { dotfiles: 'allow' });
});

// Final error handler (body-parser errors etc.)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(err);
  res.status(err?.status || 500).json({ error: err?.status && err.status < 500 ? err.message : 'Server error' });
});

/** Long-running server mode (node server/index.js): timers instead of cron. */
export function startJobs() {
  if (missingConfig().includes('DATABASE_URL')) return;
  const tick = () => runTick().catch((e) => console.error('tick', e.message));
  setInterval(tick, 30000);
  setTimeout(tick, 3000);
}
