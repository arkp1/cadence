// Postgres data layer (Neon / any Postgres 13+).
// A thin async wrapper keeps the call sites readable: db.prepare(sql).get/all/run(...)
// with `?` or `@name` placeholders, plus db.tx() for transactions (AsyncLocalStorage-scoped).
import pg from 'pg';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { attachDatabasePool } from '@vercel/functions';
import { config } from './config.js';

pg.types.setTypeParser(20, (v) => (v == null ? null : parseInt(v, 10))); // int8 (COUNT) -> number
pg.types.setTypeParser(1700, (v) => (v == null ? null : parseFloat(v))); // numeric -> number

let pool = null;
function getPool() {
  if (!config.databaseUrl) throw Object.assign(new Error('DATABASE_URL is not configured'), { status: 503 });
  if (!pool) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(config.databaseUrl);
    pool = new pg.Pool({
      connectionString: config.databaseUrl.replace(/[?&]sslmode=[^&]*/, '').replace(/[?&]channel_binding=[^&]*/, ''),
      ssl: local ? false : { rejectUnauthorized: true },
      max: process.env.VERCEL ? 4 : 10, idleTimeoutMillis: 15000, connectionTimeoutMillis: 10000,
    });
    pool.on('error', (e) => console.error('pg pool error', e.message));
    if (process.env.VERCEL) { try { attachDatabasePool(pool); } catch { /* older runtime */ } }
  }
  return pool;
}
const als = new AsyncLocalStorage();
const client = () => als.getStore() || getPool();

function translate(sql, args) {
  let values = [];
  let text = sql;
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && /@\w+/.test(sql)) {
    const named = args[0]; const idx = {};
    text = sql.replace(/@(\w+)/g, (_, k) => { if (!(k in idx)) { values.push(named[k] ?? null); idx[k] = values.length; } return `$${idx[k]}`; });
  } else {
    let i = 0; values = args.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
    text = sql.replace(/\?/g, () => `$${++i}`);
  }
  return { text, values };
}

export async function query(sql, ...args) {
  const { text, values } = translate(sql, args);
  return client().query(text, values);
}

export const db = {
  query,
  prepare(sql) {
    return {
      get: async (...a) => (await query(sql, ...a)).rows[0],
      all: async (...a) => (await query(sql, ...a)).rows,
      run: async (...a) => {
        let s = sql;
        const m = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(s);
        if (m && !/RETURNING/i.test(s) && !NO_ID.has(m[1].toLowerCase())) s += ' RETURNING id';
        const r = await query(s, ...a);
        return { changes: r.rowCount, lastInsertRowid: r.rows?.[0]?.id };
      },
    };
  },
  /** Run fn inside a transaction. Nested calls join the outer transaction. */
  async tx(fn) {
    if (als.getStore()) return fn();
    const c = await getPool().connect();
    try {
      await c.query('BEGIN');
      const out = await als.run(c, fn);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { c.release(); }
  },
};
const NO_ID = new Set(['sessions', 'meta']);

// ---------------- schema / migrations ----------------
const NOW = `to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const MIGRATIONS = [
  // v1 — initial schema
  `
  CREATE OR REPLACE FUNCTION now_iso() RETURNS text AS $$ SELECT ${NOW} $$ LANGUAGE sql STABLE;
  CREATE TABLE IF NOT EXISTS orgs (id SERIAL PRIMARY KEY, name TEXT NOT NULL, created_at TEXT DEFAULT now_iso());
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, org_id INTEGER REFERENCES orgs(id) ON DELETE SET NULL, role TEXT DEFAULT 'owner',
    email TEXT UNIQUE NOT NULL, google_sub TEXT UNIQUE, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, avatar_url TEXT,
    timezone TEXT DEFAULT 'UTC', time_format TEXT DEFAULT '12h', welcome TEXT DEFAULT '',
    brand_color TEXT DEFAULT '#4f46e5', avatar_color TEXT DEFAULT '#4f46e5', hide_branding INTEGER DEFAULT 0,
    phone TEXT DEFAULT '', max_meetings_per_day INTEGER, default_schedule_id INTEGER, write_calendar_id INTEGER,
    feed_token TEXT UNIQUE, onboarded INTEGER DEFAULT 0, last_login_at TEXT, created_at TEXT DEFAULT now_iso()
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL,
    user_agent TEXT, created_at TEXT DEFAULT now_iso()
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS invites (
    id SERIAL PRIMARY KEY, org_id INTEGER REFERENCES orgs(id) ON DELETE CASCADE, email TEXT NOT NULL, role TEXT DEFAULT 'member',
    invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL, accepted_at TEXT, created_at TEXT DEFAULT now_iso(), UNIQUE(org_id, email)
  );
  CREATE TABLE IF NOT EXISTS api_tokens (
    id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name TEXT, token_hash TEXT UNIQUE,
    prefix TEXT, last_used_at TEXT, created_at TEXT DEFAULT now_iso()
  );
  CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
    timezone TEXT NOT NULL, rules TEXT NOT NULL, overrides TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS time_off (
    id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, label TEXT DEFAULT 'Time off'
  );
  CREATE TABLE IF NOT EXISTS event_types (
    id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'one_on_one', name TEXT NOT NULL, slug TEXT NOT NULL, description TEXT DEFAULT '',
    color TEXT DEFAULT '#4f46e5', durations TEXT NOT NULL DEFAULT '[30]', duration INTEGER NOT NULL DEFAULT 30,
    locations TEXT NOT NULL DEFAULT '[]', schedule_id INTEGER, settings TEXT NOT NULL DEFAULT '{}',
    questions TEXT NOT NULL DEFAULT '[]', hosts TEXT NOT NULL DEFAULT '[]', active INTEGER DEFAULT 1, secret INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0, created_at TEXT DEFAULT now_iso(), UNIQUE(user_id, slug)
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY, uid TEXT UNIQUE NOT NULL, event_type_id INTEGER REFERENCES event_types(id) ON DELETE SET NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE, host_ids TEXT NOT NULL DEFAULT '[]',
    start_utc TEXT NOT NULL, end_utc TEXT NOT NULL, duration INTEGER NOT NULL, buffer_before INTEGER DEFAULT 0, buffer_after INTEGER DEFAULT 0,
    invitee_name TEXT NOT NULL, invitee_email TEXT NOT NULL, invitee_tz TEXT, guests TEXT DEFAULT '[]', answers TEXT DEFAULT '[]',
    location TEXT DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active', cancel_reason TEXT, canceled_by TEXT, canceled_at TEXT,
    rescheduled_from TEXT, rescheduled_to TEXT, no_show INTEGER DEFAULT 0, host_notes TEXT DEFAULT '',
    price_cents INTEGER DEFAULT 0, currency TEXT, payment_status TEXT, payment_ref TEXT, hold_expires_at TEXT,
    external_events TEXT DEFAULT '[]', source TEXT DEFAULT 'booking_page',
    link_id INTEGER, poll_id INTEGER, routing_submission_id INTEGER, request_id TEXT UNIQUE,
    created_at TEXT DEFAULT now_iso()
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_time ON bookings(start_utc, end_utc);
  CREATE INDEX IF NOT EXISTS idx_bookings_owner ON bookings(owner_id);
  CREATE INDEX IF NOT EXISTS idx_bookings_et ON bookings(event_type_id, status);
  CREATE INDEX IF NOT EXISTS idx_bookings_hosts ON bookings USING gin ((host_ids::jsonb));
  CREATE TABLE IF NOT EXISTS calendar_accounts (
    id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL, email TEXT,
    access_token TEXT, refresh_token TEXT, expires_at BIGINT, scope TEXT, last_error TEXT, created_at TEXT DEFAULT now_iso(),
    UNIQUE(user_id, provider, email)
  );
  CREATE TABLE IF NOT EXISTS calendars (
    id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    account_id INTEGER REFERENCES calendar_accounts(id) ON DELETE CASCADE, provider TEXT NOT NULL DEFAULT 'ics',
    external_id TEXT, name TEXT, url TEXT, color TEXT, is_primary INTEGER DEFAULT 0, can_write INTEGER DEFAULT 0,
    check_conflicts INTEGER DEFAULT 1, busy TEXT DEFAULT '[]', last_synced_at TEXT, last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_calendars_user ON calendars(user_id);
  CREATE TABLE IF NOT EXISTS scheduling_links (
    id SERIAL PRIMARY KEY, token TEXT UNIQUE NOT NULL, event_type_id INTEGER REFERENCES event_types(id) ON DELETE CASCADE,
    user_id INTEGER, used_at TEXT, booking_uid TEXT, created_at TEXT DEFAULT now_iso()
  );
  CREATE TABLE IF NOT EXISTS polls (
    id SERIAL PRIMARY KEY, token TEXT UNIQUE NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, description TEXT DEFAULT '', duration INTEGER NOT NULL, location TEXT DEFAULT '{}',
    options TEXT NOT NULL, reserve_times INTEGER DEFAULT 1, status TEXT DEFAULT 'open', booked_option TEXT,
    booking_uids TEXT DEFAULT '[]', created_at TEXT DEFAULT now_iso()
  );
  CREATE TABLE IF NOT EXISTS poll_votes (
    id SERIAL PRIMARY KEY, poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE, name TEXT, email TEXT,
    choices TEXT NOT NULL, created_at TEXT DEFAULT now_iso()
  );
  CREATE TABLE IF NOT EXISTS routing_forms (
    id SERIAL PRIMARY KEY, token TEXT UNIQUE NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, description TEXT DEFAULT '', questions TEXT NOT NULL DEFAULT '[]', rules TEXT NOT NULL DEFAULT '[]',
    fallback TEXT NOT NULL DEFAULT '{}', active INTEGER DEFAULT 1, created_at TEXT DEFAULT now_iso()
  );
  CREATE TABLE IF NOT EXISTS routing_submissions (
    id SERIAL PRIMARY KEY, form_id INTEGER REFERENCES routing_forms(id) ON DELETE CASCADE, answers TEXT,
    result TEXT, booking_uid TEXT, created_at TEXT DEFAULT now_iso()
  );
  CREATE TABLE IF NOT EXISTS workflows (
    id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
    trigger TEXT NOT NULL, offset_minutes INTEGER DEFAULT 0, action TEXT NOT NULL, subject TEXT, body TEXT,
    event_type_ids TEXT DEFAULT '[]', active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY, run_at TEXT NOT NULL, workflow_id INTEGER REFERENCES workflows(id) ON DELETE CASCADE,
    booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE, status TEXT DEFAULT 'pending', ran_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, run_at);
  CREATE TABLE IF NOT EXISTS webhooks (
    id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, url TEXT NOT NULL,
    events TEXT NOT NULL, secret TEXT NOT NULL, active INTEGER DEFAULT 1, created_at TEXT DEFAULT now_iso()
  );
  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id SERIAL PRIMARY KEY, webhook_id INTEGER REFERENCES webhooks(id) ON DELETE CASCADE, event TEXT, status INTEGER,
    response TEXT, payload TEXT, created_at TEXT DEFAULT now_iso()
  );
  CREATE TABLE IF NOT EXISTS outbox (
    id SERIAL PRIMARY KEY, user_id INTEGER, to_email TEXT, subject TEXT, html TEXT, kind TEXT, booking_uid TEXT,
    delivered INTEGER DEFAULT 0, error TEXT, created_at TEXT DEFAULT now_iso()
  );
  CREATE INDEX IF NOT EXISTS idx_outbox_user ON outbox(user_id, id);
  `,
];

let ready = null;
/** Apply pending migrations once per process (advisory-locked so concurrent cold starts are safe). */
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const c = await getPool().connect();
      try {
        await c.query('SELECT pg_advisory_lock(7262001)');
        await c.query('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
        const v = Number((await c.query("SELECT value FROM meta WHERE key='schema_version'")).rows[0]?.value || 0);
        for (let i = v; i < MIGRATIONS.length; i++) {
          await c.query('BEGIN');
          await c.query(MIGRATIONS[i]);
          await c.query("INSERT INTO meta (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [String(i + 1)]);
          await c.query('COMMIT');
          console.log(`migrated schema to v${i + 1}`);
        }
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); ready = null; throw e; } finally {
        await c.query('SELECT pg_advisory_unlock(7262001)').catch(() => {});
        c.release();
      }
    })();
  }
  return ready;
}

// ---------------- helpers ----------------
export const uid = (n = 16) => crypto.randomBytes(n).toString('base64url').slice(0, n + 6).replace(/[-_]/g, 'x');
export const J = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
export const S = (o) => JSON.stringify(o ?? null);
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const nowIso = () => new Date().toISOString();
/** SQL fragment: JSON-array column contains the integer placeholder. */
export const hasHost = (col = 'bookings.host_ids') => `(${col})::jsonb @> jsonb_build_array(?::int)`;

// ---------- row mappers ----------
export function mapEventType(r) {
  if (!r) return null;
  return {
    ...r, active: !!r.active, secret: !!r.secret,
    durations: J(r.durations, [r.duration]), locations: J(r.locations, []), settings: J(r.settings, {}),
    questions: J(r.questions, []), hosts: J(r.hosts, []),
  };
}
export function mapBooking(r) {
  if (!r) return null;
  return {
    ...r, no_show: !!r.no_show, host_ids: J(r.host_ids, []), guests: J(r.guests, []),
    answers: J(r.answers, []), location: J(r.location, {}), external_events: J(r.external_events, []),
  };
}
export function mapSchedule(r) {
  if (!r) return null;
  return { ...r, rules: J(r.rules, {}), overrides: J(r.overrides, {}) };
}
export function publicUser(u) {
  if (!u) return null;
  const { feed_token, google_sub, ...rest } = u;
  return { ...rest, hide_branding: !!u.hide_branding, onboarded: !!u.onboarded };
}

export const DEFAULT_SETTINGS = {
  min_notice_minutes: 240, buffer_before: 0, buffer_after: 0, increment: 30,
  date_range: { type: 'rolling', days: 60 }, daily_limit: null, weekly_limit: null, monthly_limit: null,
  max_invitees: 10, show_spots_left: true, allow_guests: true, max_guests: 10,
  rr_strategy: 'availability', lock_timezone: false,
  confirmation: { type: 'default', redirect_url: '', pass_details: true },
  price_cents: 0, currency: 'USD',
  allow_invitee_cancel: true, allow_invitee_reschedule: true,
};

export const DEFAULT_RULES = {
  mon: [{ start: '09:00', end: '17:00' }], tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }], thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }], sat: [], sun: [],
};

const COLORS = ['#4f46e5', '#0891b2', '#db2777', '#ea580c', '#16a34a', '#7c3aed'];

/** Create a user with default schedule, workflows and a starter event type. */
export async function createUser({ email, googleSub, name, avatarUrl, timezone = 'UTC', orgId = null, role = 'owner' }) {
  return db.tx(async () => {
    let org = orgId;
    if (!org) org = (await db.prepare('INSERT INTO orgs (name) VALUES (?)').run(`${name}'s team`)).lastInsertRowid;
    const slug = await uniqueUserSlug(name || email.split('@')[0]);
    const userId = (await db.prepare(`INSERT INTO users (org_id, role, email, google_sub, name, slug, avatar_url, timezone, avatar_color, feed_token)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(org, role, email.toLowerCase().trim(), googleSub || null, name, slug, avatarUrl || null, timezone,
      COLORS[Math.floor(Math.random() * COLORS.length)], uid(24))).lastInsertRowid;
    const sid = (await db.prepare('INSERT INTO schedules (user_id, name, timezone, rules, overrides) VALUES (?,?,?,?,?)')
      .run(userId, 'Working hours', timezone, S(DEFAULT_RULES), '{}')).lastInsertRowid;
    await db.prepare('UPDATE users SET default_schedule_id=? WHERE id=?').run(sid, userId);
    await db.prepare(`INSERT INTO event_types (user_id, name, slug, description, duration, durations, locations, settings, color, position) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(userId, '30 Minute Meeting', '30min', 'A quick 30 minute chat.', 30, '[30]', S([{ type: 'google_meet', label: '' }]), S(DEFAULT_SETTINGS), '#4f46e5', 1);
    await db.prepare(`INSERT INTO workflows (user_id, name, trigger, offset_minutes, action, subject, body, active) VALUES (?,?,?,?,?,?,?,?)`)
      .run(userId, 'Email reminder to invitee', 'before_start', 1440, 'email_invitee',
        'Reminder: {{event_name}} with {{host_name}} tomorrow',
        'Hi {{invitee_first_name}},\n\nThis is a friendly reminder that your {{event_name}} with {{host_name}} is at {{event_time}} ({{invitee_timezone}}).\n\nLocation: {{location}}\n\nNeed to make a change? Reschedule: {{reschedule_url}}\nCancel: {{cancel_url}}', 1);
    await db.prepare(`INSERT INTO workflows (user_id, name, trigger, offset_minutes, action, subject, body, active) VALUES (?,?,?,?,?,?,?,?)`)
      .run(userId, 'Thank-you follow-up', 'after_end', 60, 'email_invitee',
        'Thanks for meeting, {{invitee_first_name}}!',
        'Hi {{invitee_first_name}},\n\nThanks for taking the time to meet for {{event_name}}. If you would like to book another session, you can do so here: {{booking_page_url}}\n\n— {{host_name}}', 0);
    return userId;
  });
}

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48) || 'user';
}
export const RESERVED_SLUGS = new Set(['app', 'api', 'login', 'signup', 'logout', 'booking', 'reschedule', 'cancel', 'poll', 'form', 'd', 'embed', 'assets', 'embed.js', 'feed', 'meet', 'admin', 'settings', 'privacy', 'terms', 'about', 'pricing', 'help', 'support', 'static', 'favicon.ico', 'robots.txt']);
export async function uniqueUserSlug(base, exceptId = 0) {
  const b = slugify(base); let slug = b; let i = 1;
  while (RESERVED_SLUGS.has(slug) || await db.prepare('SELECT 1 FROM users WHERE slug=? AND id<>?').get(slug, exceptId)) slug = `${b}-${++i}`;
  return slug;
}
export async function uniqueEventSlug(userId, base, exceptId = 0) {
  const b = slugify(base); let slug = b; let i = 1;
  while (await db.prepare('SELECT 1 FROM event_types WHERE user_id=? AND slug=? AND id<>?').get(userId, slug, exceptId)) slug = `${b}-${++i}`;
  return slug;
}
