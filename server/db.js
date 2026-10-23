import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new Database(path.join(DATA_DIR, 'cadence.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, org_id INTEGER REFERENCES orgs(id), role TEXT DEFAULT 'owner',
  email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
  timezone TEXT DEFAULT 'UTC', time_format TEXT DEFAULT '12h', welcome TEXT DEFAULT '',
  brand_color TEXT DEFAULT '#4f46e5', avatar_color TEXT DEFAULT '#4f46e5', hide_branding INTEGER DEFAULT 0,
  phone TEXT DEFAULT '', max_meetings_per_day INTEGER, default_schedule_id INTEGER,
  feed_token TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name TEXT, token_hash TEXT UNIQUE,
  prefix TEXT, last_used_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  timezone TEXT NOT NULL, rules TEXT NOT NULL, overrides TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS time_off (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, label TEXT DEFAULT 'Time off'
);
CREATE TABLE IF NOT EXISTS event_types (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'one_on_one', name TEXT NOT NULL, slug TEXT NOT NULL, description TEXT DEFAULT '',
  color TEXT DEFAULT '#4f46e5', durations TEXT NOT NULL DEFAULT '[30]', duration INTEGER NOT NULL DEFAULT 30,
  locations TEXT NOT NULL DEFAULT '[]', schedule_id INTEGER, settings TEXT NOT NULL DEFAULT '{}',
  questions TEXT NOT NULL DEFAULT '[]', hosts TEXT NOT NULL DEFAULT '[]', active INTEGER DEFAULT 1, secret INTEGER DEFAULT 0,
  position INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, slug)
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, event_type_id INTEGER REFERENCES event_types(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE, host_ids TEXT NOT NULL DEFAULT '[]',
  start_utc TEXT NOT NULL, end_utc TEXT NOT NULL, duration INTEGER NOT NULL, buffer_before INTEGER DEFAULT 0, buffer_after INTEGER DEFAULT 0,
  invitee_name TEXT NOT NULL, invitee_email TEXT NOT NULL, invitee_tz TEXT, guests TEXT DEFAULT '[]', answers TEXT DEFAULT '[]',
  location TEXT DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active', cancel_reason TEXT, canceled_by TEXT, canceled_at TEXT,
  rescheduled_from TEXT, rescheduled_to TEXT, no_show INTEGER DEFAULT 0, host_notes TEXT DEFAULT '',
  price_cents INTEGER DEFAULT 0, currency TEXT, payment_status TEXT, source TEXT DEFAULT 'booking_page',
  link_id INTEGER, poll_id INTEGER, routing_submission_id INTEGER, request_id TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_time ON bookings(start_utc, end_utc);
CREATE TABLE IF NOT EXISTS calendars (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name TEXT, url TEXT NOT NULL,
  check_conflicts INTEGER DEFAULT 1, busy TEXT DEFAULT '[]', last_synced_at TEXT, last_error TEXT
);
CREATE TABLE IF NOT EXISTS scheduling_links (
  id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, event_type_id INTEGER REFERENCES event_types(id) ON DELETE CASCADE,
  user_id INTEGER, used_at TEXT, booking_uid TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT DEFAULT '', duration INTEGER NOT NULL, location TEXT DEFAULT '{}',
  options TEXT NOT NULL, reserve_times INTEGER DEFAULT 1, status TEXT DEFAULT 'open', booked_option TEXT,
  booking_uids TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS poll_votes (
  id INTEGER PRIMARY KEY, poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE, name TEXT, email TEXT,
  choices TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS routing_forms (
  id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT DEFAULT '', questions TEXT NOT NULL DEFAULT '[]', rules TEXT NOT NULL DEFAULT '[]',
  fallback TEXT NOT NULL DEFAULT '{}', active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS routing_submissions (
  id INTEGER PRIMARY KEY, form_id INTEGER REFERENCES routing_forms(id) ON DELETE CASCADE, answers TEXT,
  result TEXT, booking_uid TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS workflows (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  trigger TEXT NOT NULL, offset_minutes INTEGER DEFAULT 0, action TEXT NOT NULL, subject TEXT, body TEXT,
  event_type_ids TEXT DEFAULT '[]', active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY, run_at TEXT NOT NULL, workflow_id INTEGER REFERENCES workflows(id) ON DELETE CASCADE,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE, status TEXT DEFAULT 'pending', ran_at TEXT
);
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, url TEXT NOT NULL,
  events TEXT NOT NULL, secret TEXT NOT NULL, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY, webhook_id INTEGER REFERENCES webhooks(id) ON DELETE CASCADE, event TEXT, status INTEGER,
  response TEXT, payload TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, user_id INTEGER, to_email TEXT, subject TEXT, html TEXT, kind TEXT, booking_uid TEXT,
  delivered INTEGER DEFAULT 0, error TEXT, created_at TEXT DEFAULT (datetime('now'))
);
`);

export const uid = (n = 16) => crypto.randomBytes(n).toString('base64url').slice(0, n + 6).replace(/[-_]/g, 'x');
export const J = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
export const S = (o) => JSON.stringify(o ?? null);

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${h}`;
}
export function verifyPassword(pw, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const c = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(c, Buffer.from(h, 'hex'));
}
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

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
    answers: J(r.answers, []), location: J(r.location, {}),
  };
}
export function mapSchedule(r) {
  if (!r) return null;
  return { ...r, rules: J(r.rules, {}), overrides: J(r.overrides, {}) };
}
export function publicUser(u) {
  if (!u) return null;
  const { password_hash, feed_token, ...rest } = u;
  return { ...rest, hide_branding: !!u.hide_branding };
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

export function createUser({ email, password, name, slug, timezone = 'UTC', orgId = null, role = 'owner' }) {
  const tx = db.transaction(() => {
    let org = orgId;
    if (!org) org = db.prepare('INSERT INTO orgs (name) VALUES (?)').run(`${name}'s team`).lastInsertRowid;
    const colors = ['#4f46e5', '#0891b2', '#db2777', '#ea580c', '#16a34a', '#7c3aed'];
    const info = db.prepare(`INSERT INTO users (org_id, role, email, password_hash, name, slug, timezone, avatar_color, feed_token)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(org, role, email.toLowerCase().trim(), hashPassword(password), name, slug, timezone,
      colors[Math.floor(Math.random() * colors.length)], uid(24));
    const userId = info.lastInsertRowid;
    const sid = db.prepare('INSERT INTO schedules (user_id, name, timezone, rules, overrides) VALUES (?,?,?,?,?)')
      .run(userId, 'Working hours', timezone, S(DEFAULT_RULES), '{}').lastInsertRowid;
    db.prepare('UPDATE users SET default_schedule_id=? WHERE id=?').run(sid, userId);
    // default workflows (Calendly-style default notifications are built-in; these are editable extras)
    db.prepare(`INSERT INTO workflows (user_id, name, trigger, offset_minutes, action, subject, body, active) VALUES (?,?,?,?,?,?,?,?)`)
      .run(userId, 'Email reminder to invitee', 'before_start', 1440, 'email_invitee',
        'Reminder: {{event_name}} with {{host_name}} tomorrow',
        'Hi {{invitee_first_name}},\n\nThis is a friendly reminder that your {{event_name}} with {{host_name}} is at {{event_time}} ({{invitee_timezone}}).\n\nLocation: {{location}}\n\nNeed to make a change? Reschedule: {{reschedule_url}}\nCancel: {{cancel_url}}', 1);
    db.prepare(`INSERT INTO workflows (user_id, name, trigger, offset_minutes, action, subject, body, active) VALUES (?,?,?,?,?,?,?,?)`)
      .run(userId, 'Thank-you follow-up', 'after_end', 60, 'email_invitee',
        'Thanks for meeting, {{invitee_first_name}}!',
        'Hi {{invitee_first_name}},\n\nThanks for taking the time to meet for {{event_name}}. If you would like to book another session, you can do so here: {{booking_page_url}}\n\n— {{host_name}}', 0);
    return userId;
  });
  return tx();
}

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48) || 'user';
}
export function uniqueUserSlug(base) {
  let slug = slugify(base); let i = 1;
  const RESERVED = new Set(['app', 'api', 'login', 'signup', 'logout', 'booking', 'reschedule', 'cancel', 'poll', 'form', 'd', 'embed', 'assets', 'embed.js', 'feed', 'meet', 'admin', 'settings']);
  while (RESERVED.has(slug) || db.prepare('SELECT 1 FROM users WHERE slug=?').get(slug)) slug = `${slugify(base)}-${++i}`;
  return slug;
}
export function uniqueEventSlug(userId, base, exceptId = 0) {
  let slug = slugify(base); let i = 1;
  while (db.prepare('SELECT 1 FROM event_types WHERE user_id=? AND slug=? AND id<>?').get(userId, slug, exceptId)) slug = `${slugify(base)}-${++i}`;
  return slug;
}
