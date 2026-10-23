// Authenticated dashboard API (/api/...). Everything is scoped to req.user / their org.
import express from 'express';
import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import {
  db, J, S, uid, sha256, mapEventType, mapBooking, mapSchedule, publicUser, uniqueUserSlug,
  uniqueEventSlug, DEFAULT_SETTINGS, DEFAULT_RULES, slugify, hasHost,
} from './db.js';
import { requireUser } from './auth.js';
import { HttpError, cancelBooking, publicBooking, afterBookingConfirmed, lockHosts } from './bookings.js';
import { deliver, fireWebhook, bookingPayload, sendEmail, emailEnabled } from './notify.js';
import { scheduleWorkflows } from './notify.js';
import { computeSlots, hostIdsOf } from './slots.js';
import { syncCalendar, refreshCalendarList, ensureFreshBusy } from './calendars.js';
import { features, BASE_URL } from './config.js';
import { assertPublicUrl } from './security.js';
import { paymentsEnabled } from './payments.js';
import { background } from './background.js';

export const api = express.Router();
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
    if (e?.code === '23505') return res.status(409).json({ error: 'That already exists.' });
    if (e?.code === '22P02') return res.status(400).json({ error: 'Invalid input.' });
    console.error(e); res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
const validTz = (tz) => { try { return !!tz && DateTime.local().setZone(tz).isValid; } catch { return false; } };
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX = /^#[0-9a-f]{6}$/i;
const escHtml = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const intId = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Not found'); return n; };
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);

api.use(requireUser);

// ---------------- me / account ----------------
async function calendarState(userId) {
  const accounts = await all('SELECT id, provider, email, last_error, created_at FROM calendar_accounts WHERE user_id=? ORDER BY id', userId);
  const calendars = await all(`SELECT id, account_id, provider, name, url, color, is_primary, can_write, check_conflicts, last_synced_at, last_error,
      json_array_length(busy::json) busy_count FROM calendars WHERE user_id=? ORDER BY account_id NULLS LAST, is_primary DESC, name`, userId);
  return { accounts, calendars: calendars.map((c) => ({ ...c, check_conflicts: !!c.check_conflicts, can_write: !!c.can_write, is_primary: !!c.is_primary })) };
}
api.get('/me', wrap(async (req, res) => {
  const u = req.user;
  const [members, org, invites, pendingInvites, cal] = await Promise.all([
    all('SELECT id, name, email, slug, role, avatar_color, avatar_url, timezone FROM users WHERE org_id=? ORDER BY id', u.org_id),
    get('SELECT * FROM orgs WHERE id=?', u.org_id),
    all('SELECT id, email, role, created_at FROM invites WHERE org_id=? AND accepted_at IS NULL ORDER BY id DESC', u.org_id),
    all(`SELECT i.id, i.role, o.name org_name, inv.name invited_by FROM invites i JOIN orgs o ON o.id=i.org_id
         LEFT JOIN users inv ON inv.id=i.invited_by WHERE i.email=? AND i.accepted_at IS NULL AND i.org_id<>?`, u.email, u.org_id),
    calendarState(u.id),
  ]);
  res.json({
    user: { ...publicUser(u), feed_url: `${BASE_URL()}/feed/${u.feed_token}.ics`, feed_path: `/feed/${u.feed_token}.ics` },
    org, members, invites, pending_invites: pendingInvites, features: features(), email: emailEnabled(),
    calendar_accounts: cal.accounts.length, write_calendar_id: u.write_calendar_id,
  });
}));
api.patch('/me', wrap(async (req, res) => {
  const b = req.body || {};
  const up = pick(b, ['name', 'timezone', 'time_format', 'welcome', 'brand_color', 'avatar_color', 'phone', 'max_meetings_per_day', 'hide_branding', 'onboarded']);
  if (up.name !== undefined && !String(up.name).trim()) throw new HttpError(400, 'Name is required.');
  if (up.name) up.name = String(up.name).trim().slice(0, 120);
  if (up.timezone && !validTz(up.timezone)) throw new HttpError(400, 'Invalid time zone');
  if (up.time_format && !['12h', '24h'].includes(up.time_format)) throw new HttpError(400, 'Invalid time format');
  for (const k of ['brand_color', 'avatar_color']) if (up[k] !== undefined && !HEX.test(up[k])) throw new HttpError(400, 'Colors must look like #4f46e5');
  if (up.welcome !== undefined) up.welcome = String(up.welcome).slice(0, 2000);
  if (up.phone !== undefined) up.phone = String(up.phone).slice(0, 40);
  if (b.slug !== undefined && b.slug !== req.user.slug) {
    const s = slugify(b.slug);
    if (!s || s !== b.slug) throw new HttpError(400, 'URL may only contain lowercase letters, numbers and dashes.');
    if ((await uniqueUserSlug(s, req.user.id)) !== s) throw new HttpError(409, 'That URL is taken.');
    up.slug = s;
  }
  if ('hide_branding' in up) up.hide_branding = up.hide_branding ? 1 : 0;
  if ('onboarded' in up) up.onboarded = up.onboarded ? 1 : 0;
  if ('max_meetings_per_day' in up) up.max_meetings_per_day = Number(up.max_meetings_per_day) > 0 ? Math.min(100, Number(up.max_meetings_per_day)) : null;
  if (b.timezone && b.sync_schedule_timezone) await run('UPDATE schedules SET timezone=? WHERE user_id=?', b.timezone, req.user.id);
  const keys = Object.keys(up);
  if (keys.length) await run(`UPDATE users SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => up[k]), req.user.id);
  res.json({ user: publicUser(await get('SELECT * FROM users WHERE id=?', req.user.id)) });
}));
api.get('/me/slug-available', wrap(async (req, res) => {
  const s = slugify(String(req.query.slug || ''));
  res.json({ slug: s, available: !!s && s === req.query.slug && (await uniqueUserSlug(s, req.user.id)) === s });
}));
api.post('/me/feed-token', wrap(async (req, res) => { await run('UPDATE users SET feed_token=? WHERE id=?', uid(24), req.user.id); res.json({ ok: true }); }));
api.get('/me/sessions', wrap(async (req, res) => {
  res.json({ sessions: await all('SELECT created_at, expires_at, user_agent FROM sessions WHERE user_id=? AND expires_at > now_iso() ORDER BY created_at DESC LIMIT 20', req.user.id) });
}));
api.post('/me/sessions/revoke-others', wrap(async (req, res) => {
  const cur = sha256(req.cookies?.cadence_session || '');
  await run('DELETE FROM sessions WHERE user_id=? AND token<>?', req.user.id, cur);
  res.json({ ok: true });
}));
api.delete('/me', wrap(async (req, res) => {
  if (String(req.body?.confirm || '').toLowerCase() !== req.user.email.toLowerCase()) throw new HttpError(400, 'Type your email address to confirm.');
  const others = await get('SELECT COUNT(*) c FROM users WHERE org_id=? AND id<>?', req.user.org_id, req.user.id);
  if (req.user.role === 'owner' && others.c > 0) throw new HttpError(400, 'Remove the other team members (or transfer ownership) before deleting your account.');
  await db.tx(async () => {
    await run("UPDATE bookings SET status='canceled', canceled_by='host', cancel_reason='Host account deleted', canceled_at=now_iso() WHERE owner_id=? AND status IN ('active','pending_payment') AND start_utc > now_iso()", req.user.id);
    await run('DELETE FROM users WHERE id=?', req.user.id);
    if (!others.c) await run('DELETE FROM orgs WHERE id=?', req.user.org_id);
  });
  res.clearCookie('cadence_session', { path: '/' });
  res.json({ ok: true });
}));

// ---------------- team ----------------
const ownerOnly = (req) => { if (req.user.role !== 'owner' && req.user.role !== 'admin') throw new HttpError(403, 'Only workspace owners and admins can manage the team.'); };
api.patch('/team', wrap(async (req, res) => {
  ownerOnly(req);
  const name = String(req.body?.name || '').trim();
  if (!name) throw new HttpError(400, 'Team name is required.');
  await run('UPDATE orgs SET name=? WHERE id=?', name.slice(0, 120), req.user.org_id);
  res.json({ ok: true });
}));
api.post('/team/invites', wrap(async (req, res) => {
  ownerOnly(req);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = ['member', 'admin'].includes(req.body?.role) ? req.body.role : 'member';
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const existing = await get('SELECT id, org_id FROM users WHERE email=?', email);
  if (existing?.org_id === req.user.org_id) throw new HttpError(409, 'That person is already on your team.');
  await run(`INSERT INTO invites (org_id, email, role, invited_by) VALUES (?,?,?,?)
    ON CONFLICT (org_id, email) DO UPDATE SET role=EXCLUDED.role, invited_by=EXCLUDED.invited_by, accepted_at=NULL, created_at=now_iso()`, req.user.org_id, email, role, req.user.id);
  const org = await get('SELECT name FROM orgs WHERE id=?', req.user.org_id);
  const link = `${BASE_URL()}/login`;
  background(sendEmail({
    userId: req.user.id, to: email, kind: 'team_invite', subject: `${req.user.name} invited you to ${org.name} on Cadence`,
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:520px"><h2>${escHtml(req.user.name)} invited you to join <b>${escHtml(org.name)}</b></h2>
      <p>Cadence is a scheduling tool. Sign in with your Google account (<b>${escHtml(email)}</b>) to accept.</p>
      <p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Accept invitation</a></p></div>`,
  }));
  res.status(201).json({ ok: true, existing_user: !!existing, email_sent: emailEnabled() });
}));
api.delete('/team/invites/:id', wrap(async (req, res) => {
  ownerOnly(req);
  await run('DELETE FROM invites WHERE id=? AND org_id=?', intId(req.params.id), req.user.org_id);
  res.json({ ok: true });
}));
api.post('/invites/:id/accept', wrap(async (req, res) => {
  const inv = await get('SELECT * FROM invites WHERE id=? AND email=? AND accepted_at IS NULL', intId(req.params.id), req.user.email);
  if (!inv) throw new HttpError(404, 'Invitation not found.');
  const others = await get('SELECT COUNT(*) c FROM users WHERE org_id=? AND id<>?', req.user.org_id, req.user.id);
  if (req.user.role === 'owner' && others.c > 0) throw new HttpError(400, 'You own a team with other members. Remove them before joining another team.');
  await db.tx(async () => {
    await run('UPDATE users SET org_id=?, role=? WHERE id=?', inv.org_id, inv.role || 'member', req.user.id);
    await run('UPDATE invites SET accepted_at=now_iso() WHERE id=?', inv.id);
    if (!others.c) await run('DELETE FROM orgs WHERE id=? AND NOT EXISTS (SELECT 1 FROM users WHERE org_id=?)', req.user.org_id, req.user.org_id);
  });
  res.json({ ok: true });
}));
api.post('/invites/:id/decline', wrap(async (req, res) => {
  await run('DELETE FROM invites WHERE id=? AND email=?', intId(req.params.id), req.user.email);
  res.json({ ok: true });
}));
api.patch('/team/members/:id', wrap(async (req, res) => {
  if (req.user.role !== 'owner') throw new HttpError(403, 'Only the owner can change roles.');
  const role = req.body?.role;
  if (!['member', 'admin'].includes(role)) throw new HttpError(400, 'Invalid role');
  const r = await run("UPDATE users SET role=? WHERE id=? AND org_id=? AND role<>'owner'", role, intId(req.params.id), req.user.org_id);
  if (!r.changes) throw new HttpError(404, 'Member not found');
  res.json({ ok: true });
}));
api.delete('/team/members/:id', wrap(async (req, res) => {
  ownerOnly(req);
  const m = await get('SELECT * FROM users WHERE id=? AND org_id=?', intId(req.params.id), req.user.org_id);
  if (!m || m.id === req.user.id || m.role === 'owner') throw new HttpError(400, 'Cannot remove this member.');
  // Removed members keep their account and data, in a workspace of their own.
  await db.tx(async () => {
    const org = (await run('INSERT INTO orgs (name) VALUES (?)', `${m.name}'s team`)).lastInsertRowid;
    await run("UPDATE users SET org_id=?, role='owner' WHERE id=?", org, m.id);
    const ets = await all(`SELECT id, hosts FROM event_types WHERE user_id IN (SELECT id FROM users WHERE org_id=?) AND ${hasHost('event_types.hosts')}`, req.user.org_id, m.id);
    for (const e of ets) await run('UPDATE event_types SET hosts=? WHERE id=?', S(J(e.hosts, []).filter((h) => h !== m.id)), e.id);
  });
  res.json({ ok: true });
}));

// ---------------- event types ----------------
async function ownEt(req) {
  const et = mapEventType(await get('SELECT * FROM event_types WHERE id=?', intId(req.params.id)));
  if (!et || et.user_id !== req.user.id) throw new HttpError(404, 'Event type not found');
  return et;
}
const LOC_TYPES = ['jitsi', 'zoom', 'google_meet', 'teams', 'in_person', 'phone_outbound', 'phone_inbound', 'custom', 'ask_invitee'];
const Q_TYPES = ['text', 'textarea', 'phone', 'select', 'radio', 'checkbox', 'checkboxes', 'email', 'number', 'url'];
async function sanitizeEt(b, user, existing) {
  const out = {};
  if (b.name !== undefined) { if (!String(b.name).trim()) throw new HttpError(400, 'Name is required'); out.name = String(b.name).trim().slice(0, 120); }
  if (b.slug !== undefined || (b.name && !existing)) out.slug = await uniqueEventSlug(user.id, b.slug || b.name, existing?.id || 0);
  if (b.description !== undefined) out.description = String(b.description).slice(0, 5000);
  if (b.color !== undefined) { if (!HEX.test(b.color)) throw new HttpError(400, 'Invalid color'); out.color = b.color; }
  if (b.kind !== undefined) { if (!['one_on_one', 'group', 'round_robin', 'collective'].includes(b.kind)) throw new HttpError(400, 'Invalid kind'); out.kind = b.kind; }
  if (b.durations !== undefined) {
    const d = [...new Set((b.durations || []).map(Number).filter((n) => Number.isInteger(n) && n >= 5 && n <= 720))].sort((a, c) => a - c);
    if (!d.length) throw new HttpError(400, 'At least one duration is required');
    out.durations = S(d);
    const def = Number(b.duration ?? existing?.duration);
    out.duration = d.includes(def) ? def : d[0];
  } else if (b.duration !== undefined) {
    const n = Number(b.duration); if (!(n >= 5 && n <= 720)) throw new HttpError(400, 'Duration must be 5–720 minutes');
    out.duration = n; out.durations = S([n]);
  }
  if (b.locations !== undefined) {
    out.locations = S((b.locations || []).filter((l) => LOC_TYPES.includes(l?.type)).slice(0, 10)
      .map((l) => ({ type: l.type, label: String(l.label || '').slice(0, 100), value: String(l.value || '').slice(0, 500) })));
  }
  if (b.questions !== undefined) {
    out.questions = S((b.questions || []).slice(0, 30).map((q) => ({ id: String(q.id || uid(6)).slice(0, 20), label: String(q.label || 'Question').slice(0, 300),
      type: Q_TYPES.includes(q.type) ? q.type : 'text', required: !!q.required, options: (q.options || []).slice(0, 50).map((o) => String(o).slice(0, 200)) })));
  }
  if (b.hosts !== undefined) {
    const ids = [...new Set((b.hosts || []).map(Number).filter(Number.isInteger))];
    const ok = ids.length ? (await all('SELECT id FROM users WHERE org_id=? AND id = ANY(?::int[])', user.org_id, ids)).map((r) => r.id) : [];
    out.hosts = S(ids.filter((id) => ok.includes(id)));
  }
  if (b.settings !== undefined) {
    const st = { ...DEFAULT_SETTINGS, ...(existing?.settings || {}), ...(b.settings || {}) };
    st.price_cents = paymentsEnabled() ? Math.max(0, Math.min(10_000_000, Math.round(Number(st.price_cents) || 0))) : 0;
    st.currency = /^[A-Z]{3}$/.test(String(st.currency || '').toUpperCase()) ? String(st.currency).toUpperCase() : 'USD';
    if (st.confirmation?.type === 'redirect' && st.confirmation.url && !/^https?:\/\//.test(st.confirmation.url)) throw new HttpError(400, 'Redirect URL must start with https://');
    out.settings = S(st);
  }
  if (b.schedule_id !== undefined) {
    if (b.schedule_id && !(await get('SELECT 1 FROM schedules WHERE id=? AND user_id=?', Number(b.schedule_id), user.id))) throw new HttpError(400, 'Unknown schedule');
    out.schedule_id = b.schedule_id ? Number(b.schedule_id) : null;
  }
  if (b.active !== undefined) out.active = b.active ? 1 : 0;
  if (b.secret !== undefined) out.secret = b.secret ? 1 : 0;
  return out;
}
async function etWithMeta(ets) {
  if (!ets.length) return [];
  const ids = ets.map((e) => e.id);
  const owners = Object.fromEntries((await all('SELECT id, slug FROM users WHERE id = ANY(?::int[])', [...new Set(ets.map((e) => e.user_id))])).map((u) => [u.id, u.slug]));
  const counts = Object.fromEntries((await all("SELECT event_type_id id, COUNT(*) c FROM bookings WHERE event_type_id = ANY(?::int[]) AND status='active' AND start_utc > now_iso() GROUP BY event_type_id", ids)).map((r) => [r.id, r.c]));
  return ets.map((et) => ({ ...et, url_path: `/${owners[et.user_id]}/${et.slug}`, upcoming: counts[et.id] || 0 }));
}
api.get('/event-types', wrap(async (req, res) => {
  const own = (await all('SELECT * FROM event_types WHERE user_id=? ORDER BY position, id', req.user.id)).map(mapEventType);
  const team = (await all(`SELECT * FROM event_types WHERE user_id<>? AND kind IN ('round_robin','collective') AND ${hasHost('event_types.hosts')}`, req.user.id, req.user.id)).map(mapEventType);
  res.json({ event_types: await etWithMeta(own), team_event_types: await etWithMeta(team), payments: paymentsEnabled() });
}));
api.post('/event-types', wrap(async (req, res) => {
  const b = { durations: [30], duration: 30, locations: [{ type: 'google_meet', label: '' }], settings: {}, ...req.body };
  const f = await sanitizeEt(b, req.user, null);
  f.user_id = req.user.id; f.settings ||= S(DEFAULT_SETTINGS);
  f.position = ((await get('SELECT MAX(position) m FROM event_types WHERE user_id=?', req.user.id)).m || 0) + 1;
  if ((f.kind === 'round_robin' || f.kind === 'collective') && !J(f.hosts || '[]').length) f.hosts = S([req.user.id]);
  const keys = Object.keys(f);
  const info = await run(`INSERT INTO event_types (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => f[k]));
  const [et] = await etWithMeta([mapEventType(await get('SELECT * FROM event_types WHERE id=?', info.lastInsertRowid))]);
  res.status(201).json({ event_type: et });
}));
api.post('/event-types/reorder', wrap(async (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Number.isInteger);
  await db.tx(async () => { for (let i = 0; i < ids.length; i++) await run('UPDATE event_types SET position=? WHERE id=? AND user_id=?', i, ids[i], req.user.id); });
  res.json({ ok: true });
}));
api.get('/event-types/:id', wrap(async (req, res) => { const [et] = await etWithMeta([await ownEt(req)]); res.json({ event_type: et, payments: paymentsEnabled() }); }));
api.patch('/event-types/:id', wrap(async (req, res) => {
  const et = await ownEt(req); const f = await sanitizeEt(req.body || {}, req.user, et); const keys = Object.keys(f);
  if (keys.length) await run(`UPDATE event_types SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => f[k]), et.id);
  const [out] = await etWithMeta([mapEventType(await get('SELECT * FROM event_types WHERE id=?', et.id))]);
  res.json({ event_type: out });
}));
api.delete('/event-types/:id', wrap(async (req, res) => { const et = await ownEt(req); await run('DELETE FROM event_types WHERE id=?', et.id); res.json({ ok: true }); }));
api.post('/event-types/:id/duplicate', wrap(async (req, res) => {
  const et = await ownEt(req);
  const info = await run(`INSERT INTO event_types (user_id, kind, name, slug, description, color, durations, duration, locations, schedule_id, settings, questions, hosts, active, secret, position)
    SELECT user_id, kind, name || ' (copy)', ?, description, color, durations, duration, locations, schedule_id, settings, questions, hosts, 0, secret, position + 1 FROM event_types WHERE id=?`,
  await uniqueEventSlug(req.user.id, `${et.slug}-copy`), et.id);
  res.status(201).json({ event_type: mapEventType(await get('SELECT * FROM event_types WHERE id=?', info.lastInsertRowid)) });
}));
api.get('/event-types/:id/links', wrap(async (req, res) => {
  const et = await ownEt(req);
  res.json({ links: await all('SELECT * FROM scheduling_links WHERE event_type_id=? ORDER BY id DESC LIMIT 50', et.id) });
}));
api.post('/event-types/:id/links', wrap(async (req, res) => {
  const et = await ownEt(req); const token = uid(12);
  await run('INSERT INTO scheduling_links (token, event_type_id, user_id) VALUES (?,?,?)', token, et.id, req.user.id);
  res.status(201).json({ link: { token, path: `/d/${token}` } });
}));
api.get('/event-types/:id/troubleshoot', wrap(async (req, res) => {
  const et = mapEventType(await get('SELECT * FROM event_types WHERE id=?', intId(req.params.id)));
  if (!et || (et.user_id !== req.user.id && !hostIdsOf(et).includes(req.user.id))) throw new HttpError(404, 'Event type not found');
  const { start, end, tz, duration } = req.query;
  if (!start) throw new HttpError(400, 'start is required');
  await ensureFreshBusy(hostIdsOf(et));
  const r = await computeSlots(et, { start, end: end || start, tz: tz || req.user.timezone, duration, diagnostics: true });
  delete r._slots; res.json(r);
}));

// ---------------- schedules & time off ----------------
api.get('/schedules', wrap(async (req, res) => {
  res.json({ schedules: (await all('SELECT * FROM schedules WHERE user_id=? ORDER BY id', req.user.id)).map(mapSchedule), default_schedule_id: req.user.default_schedule_id,
    time_off: await all('SELECT * FROM time_off WHERE user_id=? ORDER BY start_date', req.user.id) });
}));
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
function cleanRules(rules) {
  const out = {};
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    out[d] = (rules?.[d] || []).filter((iv) => TIME_RE.test(iv?.start) && TIME_RE.test(iv?.end) && iv.start < iv.end)
      .map((iv) => ({ start: iv.start, end: iv.end })).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 12);
  }
  return out;
}
function cleanOverrides(ov) {
  const out = {};
  for (const [k, v] of Object.entries(ov || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) out[k] = (v || []).filter((iv) => TIME_RE.test(iv?.start) && TIME_RE.test(iv?.end) && iv.start < iv.end).map((iv) => ({ start: iv.start, end: iv.end }));
  }
  return out;
}
api.post('/schedules', wrap(async (req, res) => {
  const { name, timezone, rules, overrides } = req.body || {};
  const info = await run('INSERT INTO schedules (user_id, name, timezone, rules, overrides) VALUES (?,?,?,?,?)',
    req.user.id, String(name || 'New schedule').slice(0, 120), validTz(timezone) ? timezone : req.user.timezone, S(cleanRules(rules || DEFAULT_RULES)), S(cleanOverrides(overrides)));
  res.status(201).json({ schedule: mapSchedule(await get('SELECT * FROM schedules WHERE id=?', info.lastInsertRowid)) });
}));
api.patch('/schedules/:id', wrap(async (req, res) => {
  const s = await get('SELECT * FROM schedules WHERE id=? AND user_id=?', intId(req.params.id), req.user.id);
  if (!s) throw new HttpError(404, 'Schedule not found');
  const b = req.body || {};
  if (b.timezone && !validTz(b.timezone)) throw new HttpError(400, 'Invalid time zone');
  await run('UPDATE schedules SET name=?, timezone=?, rules=?, overrides=? WHERE id=?', b.name ? String(b.name).slice(0, 120) : s.name, b.timezone ?? s.timezone,
    b.rules ? S(cleanRules(b.rules)) : s.rules, b.overrides ? S(cleanOverrides(b.overrides)) : s.overrides, s.id);
  if (b.make_default) await run('UPDATE users SET default_schedule_id=? WHERE id=?', s.id, req.user.id);
  res.json({ schedule: mapSchedule(await get('SELECT * FROM schedules WHERE id=?', s.id)) });
}));
api.delete('/schedules/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (id === req.user.default_schedule_id) throw new HttpError(400, 'You cannot delete your default schedule.');
  await run('UPDATE event_types SET schedule_id=NULL WHERE schedule_id=? AND user_id=?', id, req.user.id);
  await run('DELETE FROM schedules WHERE id=? AND user_id=?', id, req.user.id); res.json({ ok: true });
}));
api.post('/time-off', wrap(async (req, res) => {
  const { start_date, end_date, label } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end_date || start_date || '')) throw new HttpError(400, 'Invalid dates');
  const e = end_date || start_date; if (e < start_date) throw new HttpError(400, 'End date must be after start date');
  const info = await run('INSERT INTO time_off (user_id, start_date, end_date, label) VALUES (?,?,?,?)', req.user.id, start_date, e, String(label || 'Time off').slice(0, 120));
  res.status(201).json({ time_off: await get('SELECT * FROM time_off WHERE id=?', info.lastInsertRowid) });
}));
api.delete('/time-off/:id', wrap(async (req, res) => { await run('DELETE FROM time_off WHERE id=? AND user_id=?', intId(req.params.id), req.user.id); res.json({ ok: true }); }));

// ---------------- bookings ----------------
async function visibleBooking(req, uidv) {
  const b = mapBooking(await get('SELECT * FROM bookings WHERE uid=?', String(uidv)));
  if (!b || (b.owner_id !== req.user.id && !b.host_ids.includes(req.user.id))) throw new HttpError(404, 'Booking not found');
  return b;
}
async function listBookings(req) {
  const { status = 'upcoming', q, event_type_id, from, to, limit = 500 } = req.query;
  const where = [`(owner_id=@me OR ${hasHost().replace('?', '@me')})`];
  const p = { me: req.user.id, now: new Date().toISOString(), limit: Math.min(2000, Number(limit) || 500) };
  if (status === 'upcoming') where.push("status='active' AND end_utc >= @now");
  if (status === 'past') where.push("status='active' AND end_utc < @now");
  if (status === 'canceled') where.push("status IN ('canceled','rescheduled')");
  if (status === 'pending') where.push("status='pending_payment' AND hold_expires_at > @now");
  if (event_type_id) { where.push('event_type_id=@et'); p.et = Number(event_type_id) || 0; }
  if (from) { where.push('start_utc >= @from'); p.from = String(from); }
  if (to) { where.push('start_utc <= @to'); p.to = String(to); }
  if (q) { where.push('(invitee_name ILIKE @q OR invitee_email ILIKE @q)'); p.q = `%${String(q).replace(/[%_\\]/g, (m) => `\\${m}`)}%`; }
  const order = status === 'upcoming' || status === 'pending' ? 'ASC' : 'DESC';
  return (await all(`SELECT * FROM bookings WHERE ${where.join(' AND ')} ORDER BY start_utc ${order} LIMIT @limit`, p)).map(mapBooking);
}
async function lookups(rows) {
  const etIds = [...new Set(rows.map((b) => b.event_type_id).filter(Boolean))];
  const userIds = [...new Set(rows.flatMap((b) => b.host_ids))];
  const pollIds = [...new Set(rows.map((b) => b.poll_id).filter(Boolean))];
  const [ets, us, polls] = await Promise.all([
    etIds.length ? all('SELECT id, name, color, kind FROM event_types WHERE id = ANY(?::int[])', etIds) : [],
    userIds.length ? all('SELECT id, name FROM users WHERE id = ANY(?::int[])', userIds) : [],
    pollIds.length ? all('SELECT id, title FROM polls WHERE id = ANY(?::int[])', pollIds) : [],
  ]);
  return { ets: Object.fromEntries(ets.map((e) => [e.id, e])), us: Object.fromEntries(us.map((u) => [u.id, u.name])), polls: Object.fromEntries(polls.map((x) => [x.id, x.title])) };
}
api.get('/bookings', wrap(async (req, res) => {
  const rows = await listBookings(req);
  const { ets, us, polls } = await lookups(rows);
  res.json({ bookings: rows.map((b) => ({ ...b, event_type: ets[b.event_type_id] || (b.poll_id ? { name: polls[b.poll_id] || 'Meeting poll', color: '#64748b' } : null), host_names: b.host_ids.map((id) => us[id]) })) });
}));
api.get('/bookings.csv', wrap(async (req, res) => {
  const rows = await listBookings(req);
  const { ets, us, polls } = await lookups(rows);
  // Prefix cells that spreadsheet apps would treat as formulas.
  const q = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const head = ['Event Type', 'Start (UTC)', 'End (UTC)', 'Invitee', 'Email', 'Invitee Time Zone', 'Hosts', 'Location', 'Status', 'Cancel Reason', 'No-show', 'Guests', 'Answers', 'Payment', 'Created'];
  const lines = [head.map(q).join(',')];
  for (const b of rows) lines.push([ets[b.event_type_id]?.name || polls[b.poll_id], b.start_utc, b.end_utc, b.invitee_name, b.invitee_email, b.invitee_tz, b.host_ids.map((i) => us[i]).join('; '),
    [b.location?.type, b.location?.value].filter(Boolean).join(': '), b.status, b.cancel_reason, b.no_show ? 'yes' : '', b.guests.join('; '),
    b.answers.map((a) => `${a.label}: ${Array.isArray(a.value) ? a.value.join('/') : a.value}`).join(' | '),
    b.price_cents ? `${(b.price_cents / 100).toFixed(2)} ${b.currency} ${b.payment_status || ''}` : '', b.created_at].map(q).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="scheduled-events.csv"').send(lines.join('\n'));
}));
api.get('/bookings/:uid', wrap(async (req, res) => {
  const b = await visibleBooking(req, req.params.uid);
  const sub = b.routing_submission_id ? await get('SELECT * FROM routing_submissions WHERE id=?', b.routing_submission_id) : null;
  res.json({ booking: { ...b, ...(await publicBooking(b)), host_notes: b.host_notes, no_show: b.no_show, source: b.source, created_at: b.created_at,
    external_events: (b.external_events || []).map((x) => ({ provider: x.provider, user_id: x.user_id })),
    routing: sub ? { answers: J(sub.answers, []), form: (await get('SELECT name FROM routing_forms WHERE id=?', sub.form_id))?.name } : null,
    emails: await all('SELECT id, to_email, subject, kind, delivered, error, created_at FROM outbox WHERE booking_uid=? ORDER BY id', b.uid) } });
}));
api.post('/bookings/:uid/cancel', wrap(async (req, res) => {
  await visibleBooking(req, req.params.uid);
  res.json({ booking: await cancelBooking(req.params.uid, { reason: req.body?.reason, by: 'host' }) });
}));
api.patch('/bookings/:uid', wrap(async (req, res) => {
  const b = await visibleBooking(req, req.params.uid);
  if (req.body?.no_show !== undefined) {
    await run('UPDATE bookings SET no_show=? WHERE id=?', req.body.no_show ? 1 : 0, b.id);
    background(fireWebhook([b.owner_id], req.body.no_show ? 'invitee.no_show_marked' : 'invitee.no_show_unmarked', bookingPayload({ ...b, no_show: !!req.body.no_show })));
  }
  if (req.body?.host_notes !== undefined) await run('UPDATE bookings SET host_notes=? WHERE id=?', String(req.body.host_notes).slice(0, 5000), b.id);
  res.json({ booking: mapBooking(await get('SELECT * FROM bookings WHERE id=?', b.id)) });
}));

// ---------------- calendars (Google / Outlook / ICS) ----------------
api.get('/calendars', wrap(async (req, res) => {
  res.json({ ...(await calendarState(req.user.id)), write_calendar_id: req.user.write_calendar_id, features: features() });
}));
api.post('/calendars', wrap(async (req, res) => { // subscribe to an ICS feed (read-only conflict checking)
  const { name, url } = req.body || {};
  if (!/^(https?|webcal):\/\//.test(url || '')) throw new HttpError(400, 'Enter a valid ICS URL (https:// or webcal://)');
  try { await assertPublicUrl(String(url).replace(/^webcal:\/\//, 'https://')); } catch (e) { throw new HttpError(400, e.message); }
  const info = await run("INSERT INTO calendars (user_id, provider, name, url) VALUES (?,'ics',?,?)", req.user.id, String(name || 'ICS calendar').slice(0, 120), String(url).slice(0, 2000));
  const cal = await get('SELECT * FROM calendars WHERE id=?', info.lastInsertRowid);
  const r = await syncCalendar(cal);
  res.status(201).json({ calendar: { id: cal.id }, sync: r });
}));
api.post('/calendars/:id/sync', wrap(async (req, res) => {
  const cal = await get('SELECT * FROM calendars WHERE id=? AND user_id=?', intId(req.params.id), req.user.id);
  if (!cal) throw new HttpError(404, 'Not found');
  res.json(await syncCalendar(cal));
}));
api.post('/calendar-accounts/:id/refresh', wrap(async (req, res) => {
  const acct = await get('SELECT * FROM calendar_accounts WHERE id=? AND user_id=?', intId(req.params.id), req.user.id);
  if (!acct) throw new HttpError(404, 'Not found');
  await refreshCalendarList(acct);
  res.json(await calendarState(req.user.id));
}));
api.patch('/calendars/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const r = await run('UPDATE calendars SET check_conflicts=COALESCE(?, check_conflicts), name=COALESCE(?, name) WHERE id=? AND user_id=?',
    b.check_conflicts === undefined ? null : (b.check_conflicts ? 1 : 0), b.name ? String(b.name).slice(0, 120) : null, intId(req.params.id), req.user.id);
  if (!r.changes) throw new HttpError(404, 'Not found');
  res.json({ ok: true });
}));
api.put('/calendars/write-target', wrap(async (req, res) => { // where new bookings get written
  const id = req.body?.calendar_id ? Number(req.body.calendar_id) : null;
  if (id && !(await get('SELECT 1 FROM calendars WHERE id=? AND user_id=? AND can_write=1', id, req.user.id))) throw new HttpError(400, 'That calendar cannot receive events.');
  await run('UPDATE users SET write_calendar_id=? WHERE id=?', id, req.user.id);
  res.json({ ok: true, write_calendar_id: id });
}));
api.delete('/calendars/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  await run("DELETE FROM calendars WHERE id=? AND user_id=? AND provider='ics'", id, req.user.id);
  res.json({ ok: true });
}));
api.delete('/calendar-accounts/:id', wrap(async (req, res) => {
  const acct = await get('SELECT * FROM calendar_accounts WHERE id=? AND user_id=?', intId(req.params.id), req.user.id);
  if (!acct) throw new HttpError(404, 'Not found');
  await db.tx(async () => {
    await run('UPDATE users SET write_calendar_id=NULL WHERE id=? AND write_calendar_id IN (SELECT id FROM calendars WHERE account_id=?)', req.user.id, acct.id);
    await run('DELETE FROM calendar_accounts WHERE id=?', acct.id); // calendars cascade
  });
  res.json({ ok: true });
}));

// ---------------- meeting polls ----------------
async function pollOut(p) {
  const votes = (await all('SELECT * FROM poll_votes WHERE poll_id=? ORDER BY id', p.id)).map((v) => ({ ...v, choices: J(v.choices, []) }));
  return { ...p, reserve_times: !!p.reserve_times, options: J(p.options, []), location: J(p.location, {}), booking_uids: J(p.booking_uids, []), votes, path: `/poll/${p.token}` };
}
const ownPoll = async (req) => { const p = await get('SELECT * FROM polls WHERE id=? AND user_id=?', intId(req.params.id), req.user.id); if (!p) throw new HttpError(404, 'Poll not found'); return p; };
api.get('/polls', wrap(async (req, res) => {
  res.json({ polls: await Promise.all((await all('SELECT * FROM polls WHERE user_id=? ORDER BY id DESC', req.user.id)).map(pollOut)) });
}));
api.post('/polls', wrap(async (req, res) => {
  const { title, description, duration, location, options, reserve_times } = req.body || {};
  if (!String(title || '').trim() || !Array.isArray(options) || options.length < 1) throw new HttpError(400, 'A title and at least one time option are required.');
  const opts = options.slice(0, 40).map((o) => ({ id: String(o.id || uid(6)).slice(0, 20), start: DateTime.fromISO(String(o.start || '')).toUTC().toISO() })).filter((o) => o.start);
  if (!opts.length) throw new HttpError(400, 'Time options are invalid.');
  const loc = location && LOC_TYPES.includes(location.type) ? { type: location.type, value: String(location.value || '').slice(0, 500) } : {};
  const info = await run('INSERT INTO polls (token, user_id, title, description, duration, location, options, reserve_times) VALUES (?,?,?,?,?,?,?,?)',
    uid(12), req.user.id, String(title).slice(0, 200), String(description || '').slice(0, 5000), Math.min(720, Math.max(5, Number(duration) || 30)), S(loc), S(opts), reserve_times === false ? 0 : 1);
  res.status(201).json({ poll: await pollOut(await get('SELECT * FROM polls WHERE id=?', info.lastInsertRowid)) });
}));
api.delete('/polls/:id', wrap(async (req, res) => { const p = await ownPoll(req); await run('DELETE FROM polls WHERE id=?', p.id); res.json({ ok: true }); }));
api.post('/polls/:id/close', wrap(async (req, res) => { const p = await ownPoll(req); await run("UPDATE polls SET status='closed' WHERE id=? AND status='open'", p.id); res.json({ ok: true }); }));
api.post('/polls/:id/book', wrap(async (req, res) => {
  const p = await ownPoll(req);
  if (p.status === 'booked') throw new HttpError(400, 'This poll is already booked.');
  const opt = J(p.options, []).find((o) => o.id === req.body?.option_id);
  if (!opt) throw new HttpError(400, 'Choose a time option');
  const voters = (await all('SELECT * FROM poll_votes WHERE poll_id=? ORDER BY id', p.id)).filter((v) => J(v.choices, []).includes(opt.id));
  if (!voters.length) throw new HttpError(400, 'Nobody has voted for this time yet.');
  const loc = J(p.location, {});
  if (loc.type === 'jitsi' && !loc.value) loc.value = `https://meet.jit.si/Cadence-${uid(10)}`;
  const start = DateTime.fromISO(opt.start, { zone: 'utc' });
  const id = await db.tx(async () => {
    await lockHosts([req.user.id]);
    const fresh = await get('SELECT status FROM polls WHERE id=? FOR UPDATE', p.id);
    if (fresh.status === 'booked') throw new HttpError(400, 'This poll is already booked.');
    const b = { uid: uid(18), event_type_id: null, owner_id: req.user.id, host_ids: S([req.user.id]), start_utc: start.toISO(), end_utc: start.plus({ minutes: p.duration }).toISO(),
      duration: p.duration, invitee_name: voters[0].name, invitee_email: voters[0].email, invitee_tz: req.user.timezone, guests: S(voters.slice(1).map((v) => v.email)),
      answers: '[]', location: S(loc), source: 'meeting_poll', poll_id: p.id };
    const cols = Object.keys(b);
    const info = await run(`INSERT INTO bookings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => b[c]));
    await run("UPDATE polls SET status='booked', booked_option=?, booking_uids=? WHERE id=?", opt.id, S([b.uid]), p.id);
    return info.lastInsertRowid;
  });
  const booking = await afterBookingConfirmed(mapBooking(await get('SELECT * FROM bookings WHERE id=?', id)));
  res.json({ poll: await pollOut(await get('SELECT * FROM polls WHERE id=?', p.id)), booking_uid: booking.uid });
}));

// ---------------- routing forms ----------------
async function formOut(f) {
  return { ...f, active: !!f.active, questions: J(f.questions, []), rules: J(f.rules, []), fallback: J(f.fallback, {}), path: `/form/${f.token}`,
    submissions: (await get('SELECT COUNT(*) c FROM routing_submissions WHERE form_id=?', f.id)).c };
}
api.get('/routing-forms', wrap(async (req, res) => {
  res.json({ forms: await Promise.all((await all('SELECT * FROM routing_forms WHERE user_id=? ORDER BY id DESC', req.user.id)).map(formOut)) });
}));
api.post('/routing-forms', wrap(async (req, res) => {
  const b = req.body || {};
  const info = await run('INSERT INTO routing_forms (token, user_id, name, description, questions, rules, fallback) VALUES (?,?,?,?,?,?,?)',
    uid(12), req.user.id, String(b.name || 'Untitled form').slice(0, 200), String(b.description || '').slice(0, 5000),
    S(b.questions || [{ id: uid(6), type: 'name', label: 'Name', required: true }, { id: uid(6), type: 'email', label: 'Email', required: true }]),
    S(b.rules || []), S(b.fallback || { type: 'message', message: 'Thanks for reaching out! We will get back to you shortly.' }));
  res.status(201).json({ form: await formOut(await get('SELECT * FROM routing_forms WHERE id=?', info.lastInsertRowid)) });
}));
api.patch('/routing-forms/:id', wrap(async (req, res) => {
  const f = await get('SELECT * FROM routing_forms WHERE id=? AND user_id=?', intId(req.params.id), req.user.id);
  if (!f) throw new HttpError(404, 'Form not found');
  const b = req.body || {};
  if (b.fallback?.type === 'url' && b.fallback.url && !/^https?:\/\//.test(b.fallback.url)) throw new HttpError(400, 'Redirect URLs must start with https://');
  await run('UPDATE routing_forms SET name=?, description=?, questions=?, rules=?, fallback=?, active=? WHERE id=?', b.name ? String(b.name).slice(0, 200) : f.name, b.description ?? f.description,
    b.questions ? S(b.questions) : f.questions, b.rules ? S(b.rules) : f.rules, b.fallback ? S(b.fallback) : f.fallback, b.active === undefined ? f.active : (b.active ? 1 : 0), f.id);
  res.json({ form: await formOut(await get('SELECT * FROM routing_forms WHERE id=?', f.id)) });
}));
api.delete('/routing-forms/:id', wrap(async (req, res) => { await run('DELETE FROM routing_forms WHERE id=? AND user_id=?', intId(req.params.id), req.user.id); res.json({ ok: true }); }));
api.get('/routing-forms/:id/submissions', wrap(async (req, res) => {
  const f = await get('SELECT * FROM routing_forms WHERE id=? AND user_id=?', intId(req.params.id), req.user.id);
  if (!f) throw new HttpError(404, 'Form not found');
  res.json({ submissions: (await all('SELECT * FROM routing_submissions WHERE form_id=? ORDER BY id DESC LIMIT 500', f.id)).map((s) => ({ ...s, answers: J(s.answers, []), result: J(s.result, {}) })) });
}));

// ---------------- workflows ----------------
const wfOut = (w) => ({ ...w, active: !!w.active, event_type_ids: J(w.event_type_ids, []) });
api.get('/workflows', wrap(async (req, res) => res.json({ workflows: (await all('SELECT * FROM workflows WHERE user_id=? ORDER BY id', req.user.id)).map(wfOut) })));
function wfFields(b) {
  if (b.trigger && !['booked', 'before_start', 'after_end', 'canceled'].includes(b.trigger)) throw new HttpError(400, 'Invalid trigger');
  if (b.action && !['email_invitee', 'email_host'].includes(b.action)) throw new HttpError(400, 'Invalid action');
  if (b.offset_minutes !== undefined && !(Number(b.offset_minutes) >= 0 && Number(b.offset_minutes) <= 60 * 24 * 30)) throw new HttpError(400, 'Offset must be between 0 and 30 days');
  return b;
}
async function rescheduleUpcomingJobs(userId) {
  const ups = (await all(`SELECT * FROM bookings WHERE status='active' AND start_utc > now_iso() AND (owner_id=? OR ${hasHost()}) LIMIT 1000`, userId, userId)).map(mapBooking);
  for (const bk of ups) await scheduleWorkflows(bk);
}
api.post('/workflows', wrap(async (req, res) => {
  const b = wfFields(req.body || {});
  const info = await run('INSERT INTO workflows (user_id, name, trigger, offset_minutes, action, subject, body, event_type_ids, active) VALUES (?,?,?,?,?,?,?,?,?)',
    req.user.id, String(b.name || 'New workflow').slice(0, 120), b.trigger || 'before_start', Number(b.offset_minutes) || 0, b.action || 'email_invitee',
    String(b.subject || '').slice(0, 300), String(b.body || '').slice(0, 10000), S((b.event_type_ids || []).map(Number)), b.active === false ? 0 : 1);
  background(rescheduleUpcomingJobs(req.user.id));
  res.status(201).json({ workflow: wfOut(await get('SELECT * FROM workflows WHERE id=?', info.lastInsertRowid)) });
}));
api.patch('/workflows/:id', wrap(async (req, res) => {
  const w = await get('SELECT * FROM workflows WHERE id=? AND user_id=?', intId(req.params.id), req.user.id);
  if (!w) throw new HttpError(404, 'Workflow not found');
  const b = wfFields(req.body || {});
  await run('UPDATE workflows SET name=?, trigger=?, offset_minutes=?, action=?, subject=?, body=?, event_type_ids=?, active=? WHERE id=?',
    b.name ? String(b.name).slice(0, 120) : w.name, b.trigger ?? w.trigger, b.offset_minutes ?? w.offset_minutes, b.action ?? w.action,
    b.subject !== undefined ? String(b.subject).slice(0, 300) : w.subject, b.body !== undefined ? String(b.body).slice(0, 10000) : w.body,
    b.event_type_ids ? S(b.event_type_ids.map(Number)) : w.event_type_ids, b.active === undefined ? w.active : (b.active ? 1 : 0), w.id);
  background(rescheduleUpcomingJobs(req.user.id));
  res.json({ workflow: wfOut(await get('SELECT * FROM workflows WHERE id=?', w.id)) });
}));
api.delete('/workflows/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  await run("UPDATE jobs SET status='canceled' WHERE workflow_id=? AND status='pending' AND workflow_id IN (SELECT id FROM workflows WHERE user_id=?)", id, req.user.id);
  await run('DELETE FROM workflows WHERE id=? AND user_id=?', id, req.user.id); res.json({ ok: true });
}));

// ---------------- webhooks ----------------
export const WEBHOOK_EVENTS = ['invitee.created', 'invitee.canceled', 'invitee.rescheduled', 'invitee.no_show_marked', 'invitee.no_show_unmarked', 'routing_form_submission.created', 'poll.vote_created'];
api.get('/webhooks', wrap(async (req, res) => {
  res.json({ events: WEBHOOK_EVENTS, webhooks: (await all('SELECT * FROM webhooks WHERE user_id=? ORDER BY id DESC', req.user.id)).map((w) => ({ ...w, active: !!w.active, events: J(w.events, []) })) });
}));
api.post('/webhooks', wrap(async (req, res) => {
  const { url, events } = req.body || {};
  if (!/^https?:\/\//.test(url || '')) throw new HttpError(400, 'Enter a valid URL');
  try { await assertPublicUrl(url); } catch (e) { throw new HttpError(400, e.message); }
  const ev = (events || []).filter((e) => WEBHOOK_EVENTS.includes(e)); if (!ev.length) throw new HttpError(400, 'Pick at least one event');
  const info = await run('INSERT INTO webhooks (user_id, url, events, secret) VALUES (?,?,?,?)', req.user.id, String(url).slice(0, 2000), S(ev), `whsec_${crypto.randomBytes(18).toString('hex')}`);
  res.status(201).json({ webhook: await get('SELECT * FROM webhooks WHERE id=?', info.lastInsertRowid) });
}));
api.patch('/webhooks/:id', wrap(async (req, res) => {
  await run('UPDATE webhooks SET active=COALESCE(?, active) WHERE id=? AND user_id=?', req.body?.active === undefined ? null : (req.body.active ? 1 : 0), intId(req.params.id), req.user.id);
  res.json({ ok: true });
}));
api.delete('/webhooks/:id', wrap(async (req, res) => { await run('DELETE FROM webhooks WHERE id=? AND user_id=?', intId(req.params.id), req.user.id); res.json({ ok: true }); }));
api.get('/webhooks/:id/deliveries', wrap(async (req, res) => {
  const w = await get('SELECT * FROM webhooks WHERE id=? AND user_id=?', intId(req.params.id), req.user.id); if (!w) throw new HttpError(404, 'Not found');
  res.json({ deliveries: await all('SELECT * FROM webhook_deliveries WHERE webhook_id=? ORDER BY id DESC LIMIT 50', w.id) });
}));
api.post('/webhooks/:id/test', wrap(async (req, res) => {
  const w = await get('SELECT * FROM webhooks WHERE id=? AND user_id=?', intId(req.params.id), req.user.id); if (!w) throw new HttpError(404, 'Not found');
  res.json(await deliver(w, 'ping', { message: 'Test delivery from Cadence', user: req.user.email }));
}));

// ---------------- api tokens ----------------
api.get('/tokens', wrap(async (req, res) => res.json({ tokens: await all('SELECT id, name, prefix, last_used_at, created_at FROM api_tokens WHERE user_id=? ORDER BY id DESC', req.user.id) })));
api.post('/tokens', wrap(async (req, res) => {
  if (req.authVia === 'token') throw new HttpError(403, 'API tokens cannot create other tokens.');
  const token = `cad_${crypto.randomBytes(24).toString('hex')}`;
  await run('INSERT INTO api_tokens (user_id, name, token_hash, prefix) VALUES (?,?,?,?)', req.user.id, String(req.body?.name || 'API token').slice(0, 80), sha256(token), token.slice(0, 10));
  res.status(201).json({ token });
}));
api.delete('/tokens/:id', wrap(async (req, res) => { await run('DELETE FROM api_tokens WHERE id=? AND user_id=?', intId(req.params.id), req.user.id); res.json({ ok: true }); }));

// ---------------- outbox (sent email log) ----------------
api.get('/outbox', wrap(async (req, res) => {
  res.json({ email_enabled: emailEnabled(), smtp: emailEnabled(), emails: await all('SELECT id, to_email, subject, kind, booking_uid, delivered, error, created_at FROM outbox WHERE user_id=? ORDER BY id DESC LIMIT 300', req.user.id) });
}));
api.get('/outbox/:id', wrap(async (req, res) => {
  const m = await get('SELECT * FROM outbox WHERE id=? AND user_id=?', intId(req.params.id), req.user.id); if (!m) throw new HttpError(404, 'Not found');
  res.json({ email: m });
}));

// ---------------- contacts ----------------
api.get('/contacts', wrap(async (req, res) => {
  const rows = await all(`SELECT invitee_email email, MAX(invitee_name) AS name, COUNT(*) total,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active, SUM(CASE WHEN status='canceled' THEN 1 ELSE 0 END) canceled, SUM(no_show) no_shows,
      MAX(start_utc) last_meeting, MIN(created_at) first_seen, MAX(invitee_tz) timezone
    FROM bookings WHERE status <> 'pending_payment' AND status <> 'expired' AND (owner_id=? OR ${hasHost()}) GROUP BY invitee_email ORDER BY MAX(start_utc) DESC LIMIT 5000`, req.user.id, req.user.id);
  res.json({ contacts: rows });
}));

// ---------------- analytics ----------------
api.get('/analytics', wrap(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const tz = req.user.timezone || 'UTC';
  const since = DateTime.utc().minus({ days }).toISO();
  const rows = (await all(`SELECT * FROM bookings WHERE created_at >= ? AND status NOT IN ('pending_payment','expired') AND (owner_id=? OR ${hasHost()})`, since, req.user.id, req.user.id)).map(mapBooking);
  const { ets, us } = await lookups(rows);
  const tally = (f) => { const m = {}; for (const r of rows) { const k = f(r); if (k == null) continue; m[k] = (m[k] || 0) + 1; } return m; };
  const series = {}; for (let i = days - 1; i >= 0; i--) series[DateTime.now().setZone(tz).minus({ days: i }).toISODate()] = { created: 0, canceled: 0 };
  for (const r of rows) {
    const d = DateTime.fromISO(r.created_at, { zone: 'utc' }).setZone(tz).toISODate(); if (series[d]) series[d].created++;
    if (r.status === 'canceled' && r.canceled_at) { const c = DateTime.fromISO(r.canceled_at, { zone: 'utc' }).setZone(tz).toISODate(); if (series[c]) series[c].canceled++; }
  }
  const WDN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const revenue = rows.filter((r) => r.payment_status === 'paid').reduce((m, r) => { m[r.currency] = (m[r.currency] || 0) + r.price_cents; return m; }, {});
  res.json({
    days, timezone: tz,
    totals: { created: rows.length, active: rows.filter((r) => r.status === 'active').length, canceled: rows.filter((r) => r.status === 'canceled').length,
      rescheduled: rows.filter((r) => r.status === 'rescheduled').length, no_shows: rows.filter((r) => r.no_show).length },
    revenue,
    by_event_type: tally((r) => ets[r.event_type_id]?.name || (r.poll_id ? 'Meeting polls' : 'Other')),
    by_weekday: WDN.map((d, i) => ({ day: d, count: rows.filter((r) => r.status !== 'canceled' && DateTime.fromISO(r.start_utc).setZone(tz).weekday === i + 1).length })),
    by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: rows.filter((r) => r.status !== 'canceled' && DateTime.fromISO(r.start_utc).setZone(tz).hour === h).length })),
    by_host: tally((r) => us[r.host_ids[0]]), by_source: tally((r) => r.source),
    series: Object.entries(series).map(([date, v]) => ({ date, ...v })),
  });
}));
