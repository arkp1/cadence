import express from 'express';
import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import {
  db, J, S, uid, sha256, mapEventType, mapBooking, mapSchedule, publicUser, createUser, uniqueUserSlug,
  uniqueEventSlug, verifyPassword, hashPassword, DEFAULT_SETTINGS, DEFAULT_RULES, slugify,
} from './db.js';
import { requireUser, startSession, endSession } from './auth.js';
import { HttpError, cancelBooking, publicBooking } from './bookings.js';
import { syncCalendar, deliver, notifyBooking, scheduleWorkflows, fireWebhook, bookingPayload, smtpEnabled, BASE_URL } from './notify.js';
import { computeSlots, hostIdsOf } from './slots.js';

export const api = express.Router();
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Record exists.' });
    console.error(e); res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
const validTz = (tz) => { try { return DateTime.local().setZone(tz).isValid; } catch { return false; } };
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// ---------------- auth ----------------
api.post('/auth/signup', wrap((req, res) => {
  const { name, email, password, timezone } = req.body || {};
  if (!name || !email || !password) throw new HttpError(400, 'Name, email and password are required.');
  if (String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase().trim())) throw new HttpError(409, 'An account with this email already exists.');
  const id = createUser({ email, password, name: String(name).trim(), slug: uniqueUserSlug(name), timezone: validTz(timezone) ? timezone : 'UTC' });
  // starter event type
  db.prepare(`INSERT INTO event_types (user_id, name, slug, description, duration, durations, locations, settings, color) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, '30 Minute Meeting', '30min', 'A quick 30 minute chat.', 30, '[30]', S([{ type: 'jitsi', label: 'Video call' }]), S(DEFAULT_SETTINGS), '#4f46e5');
  const token = startSession(req, res, id);
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)), token });
}));
api.post('/auth/login', wrap((req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase().trim());
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'Incorrect email or password.');
  const token = startSession(req, res, u.id);
  res.json({ user: publicUser(u), token });
}));
api.post('/auth/logout', (req, res) => { endSession(req, res); res.json({ ok: true }); });

api.use(requireUser);

api.get('/me', wrap((req, res) => {
  const members = db.prepare('SELECT id, name, email, slug, role, avatar_color, timezone FROM users WHERE org_id=? ORDER BY id').all(req.user.org_id);
  const org = db.prepare('SELECT * FROM orgs WHERE id=?').get(req.user.org_id);
  res.json({ user: { ...publicUser(req.user), feed_url: `${BASE_URL()}/feed/${req.user.feed_token}.ics`, feed_path: `/feed/${req.user.feed_token}.ics` }, org, members, smtp: smtpEnabled() });
}));
api.patch('/me', wrap((req, res) => {
  const b = req.body || {};
  const up = pick(b, ['name', 'timezone', 'time_format', 'welcome', 'brand_color', 'avatar_color', 'phone', 'max_meetings_per_day', 'hide_branding']);
  if (up.timezone && !validTz(up.timezone)) throw new HttpError(400, 'Invalid time zone');
  if (b.slug && b.slug !== req.user.slug) {
    const s = slugify(b.slug);
    if (s !== b.slug) throw new HttpError(400, 'URL may only contain lowercase letters, numbers and dashes.');
    if (uniqueUserSlug(s) !== s) throw new HttpError(409, 'That URL is taken.');
    up.slug = s;
  }
  if (b.email && b.email !== req.user.email) up.email = String(b.email).toLowerCase().trim();
  if ('hide_branding' in up) up.hide_branding = up.hide_branding ? 1 : 0;
  if ('max_meetings_per_day' in up) up.max_meetings_per_day = Number(up.max_meetings_per_day) || null;
  const keys = Object.keys(up);
  if (keys.length) db.prepare(`UPDATE users SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => up[k]), req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
}));
api.post('/me/password', wrap((req, res) => {
  const { current, next } = req.body || {};
  if (!verifyPassword(String(current || ''), req.user.password_hash)) throw new HttpError(400, 'Current password is incorrect.');
  if (String(next || '').length < 8) throw new HttpError(400, 'New password must be at least 8 characters.');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(next), req.user.id);
  res.json({ ok: true });
}));
api.post('/me/feed-token', wrap((req, res) => {
  db.prepare('UPDATE users SET feed_token=? WHERE id=?').run(uid(24), req.user.id);
  res.json({ ok: true });
}));

// ---------------- team ----------------
api.post('/team/members', wrap((req, res) => {
  if (req.user.role !== 'owner') throw new HttpError(403, 'Only the workspace owner can add members.');
  const { name, email, password, timezone } = req.body || {};
  if (!name || !email || String(password || '').length < 8) throw new HttpError(400, 'Name, email and an 8+ character password are required.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) throw new HttpError(409, 'A user with this email already exists.');
  const id = createUser({ email, password, name, slug: uniqueUserSlug(name), timezone: validTz(timezone) ? timezone : req.user.timezone, orgId: req.user.org_id, role: 'member' });
  res.status(201).json({ member: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
}));
api.delete('/team/members/:id', wrap((req, res) => {
  if (req.user.role !== 'owner') throw new HttpError(403, 'Only the workspace owner can remove members.');
  const m = db.prepare('SELECT * FROM users WHERE id=? AND org_id=?').get(req.params.id, req.user.org_id);
  if (!m || m.id === req.user.id) throw new HttpError(400, 'Cannot remove this member.');
  db.prepare('DELETE FROM users WHERE id=?').run(m.id);
  res.json({ ok: true });
}));

// ---------------- event types ----------------
function ownEt(req) {
  const et = mapEventType(db.prepare('SELECT * FROM event_types WHERE id=?').get(req.params.id));
  if (!et || et.user_id !== req.user.id) throw new HttpError(404, 'Event type not found');
  return et;
}
function sanitizeEt(b, userId, existing) {
  const out = {};
  if (b.name !== undefined) { if (!String(b.name).trim()) throw new HttpError(400, 'Name is required'); out.name = String(b.name).slice(0, 120); }
  if (b.slug !== undefined || (b.name && !existing)) out.slug = uniqueEventSlug(userId, b.slug || b.name, existing?.id || 0);
  for (const k of ['description', 'color', 'kind']) if (b[k] !== undefined) out[k] = String(b[k]);
  if (out.kind && !['one_on_one', 'group', 'round_robin', 'collective'].includes(out.kind)) throw new HttpError(400, 'Invalid kind');
  if (b.durations !== undefined) {
    const d = [...new Set((b.durations || []).map(Number).filter((n) => n >= 5 && n <= 720))].sort((a, c) => a - c);
    if (!d.length) throw new HttpError(400, 'At least one duration is required');
    out.durations = S(d);
    const def = Number(b.duration ?? existing?.duration);
    out.duration = d.includes(def) ? def : d[0];
  } else if (b.duration !== undefined) { out.duration = Number(b.duration); out.durations = S([Number(b.duration)]); }
  if (b.locations !== undefined) out.locations = S((b.locations || []).slice(0, 10));
  if (b.questions !== undefined) out.questions = S((b.questions || []).map((q) => ({ id: q.id || uid(6), label: String(q.label || 'Question'), type: q.type || 'text', required: !!q.required, options: q.options || [] })));
  if (b.hosts !== undefined) {
    const me = db.prepare('SELECT org_id FROM users WHERE id=?').get(userId);
    out.hosts = S((b.hosts || []).map(Number).filter((id) => db.prepare('SELECT 1 FROM users WHERE id=? AND org_id=?').get(id, me.org_id)));
  }
  if (b.settings !== undefined) out.settings = S({ ...DEFAULT_SETTINGS, ...(existing?.settings || {}), ...b.settings });
  if (b.schedule_id !== undefined) out.schedule_id = b.schedule_id ? Number(b.schedule_id) : null;
  if (b.active !== undefined) out.active = b.active ? 1 : 0;
  if (b.secret !== undefined) out.secret = b.secret ? 1 : 0;
  return out;
}
const etWithMeta = (et) => ({ ...et, url_path: `/${db.prepare('SELECT slug FROM users WHERE id=?').get(et.user_id)?.slug}/${et.slug}`,
  upcoming: db.prepare("SELECT COUNT(*) c FROM bookings WHERE event_type_id=? AND status='active' AND start_utc > ?").get(et.id, new Date().toISOString()).c });

api.get('/event-types', wrap((req, res) => {
  const own = db.prepare('SELECT * FROM event_types WHERE user_id=? ORDER BY position, id').all(req.user.id).map(mapEventType);
  const team = db.prepare(`SELECT * FROM event_types WHERE user_id<>? AND kind IN ('round_robin','collective') AND EXISTS (SELECT 1 FROM json_each(event_types.hosts) WHERE value=?)`).all(req.user.id, req.user.id).map(mapEventType);
  res.json({ event_types: own.map(etWithMeta), team_event_types: team.map(etWithMeta) });
}));
api.post('/event-types', wrap((req, res) => {
  const b = { durations: [30], duration: 30, locations: [{ type: 'jitsi', label: 'Video call' }], settings: {}, ...req.body };
  const f = sanitizeEt(b, req.user.id, null);
  f.user_id = req.user.id; f.settings ||= S(DEFAULT_SETTINGS);
  f.position = (db.prepare('SELECT MAX(position) m FROM event_types WHERE user_id=?').get(req.user.id).m || 0) + 1;
  if ((f.kind === 'round_robin' || f.kind === 'collective') && !J(f.hosts || '[]').length) f.hosts = S([req.user.id]);
  const keys = Object.keys(f);
  const info = db.prepare(`INSERT INTO event_types (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => f[k]));
  res.status(201).json({ event_type: etWithMeta(mapEventType(db.prepare('SELECT * FROM event_types WHERE id=?').get(info.lastInsertRowid))) });
}));
api.get('/event-types/:id', wrap((req, res) => res.json({ event_type: etWithMeta(ownEt(req)) })));
api.patch('/event-types/:id', wrap((req, res) => {
  const et = ownEt(req); const f = sanitizeEt(req.body || {}, req.user.id, et); const keys = Object.keys(f);
  if (keys.length) db.prepare(`UPDATE event_types SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => f[k]), et.id);
  res.json({ event_type: etWithMeta(mapEventType(db.prepare('SELECT * FROM event_types WHERE id=?').get(et.id))) });
}));
api.delete('/event-types/:id', wrap((req, res) => { const et = ownEt(req); db.prepare('DELETE FROM event_types WHERE id=?').run(et.id); res.json({ ok: true }); }));
api.post('/event-types/:id/duplicate', wrap((req, res) => {
  const et = ownEt(req);
  const info = db.prepare(`INSERT INTO event_types (user_id, kind, name, slug, description, color, durations, duration, locations, schedule_id, settings, questions, hosts, active, secret, position)
    SELECT user_id, kind, name || ' (copy)', ?, description, color, durations, duration, locations, schedule_id, settings, questions, hosts, 0, secret, position + 1 FROM event_types WHERE id=?`)
    .run(uniqueEventSlug(req.user.id, `${et.slug}-copy`), et.id);
  res.status(201).json({ event_type: mapEventType(db.prepare('SELECT * FROM event_types WHERE id=?').get(info.lastInsertRowid)) });
}));
api.post('/event-types/reorder', wrap((req, res) => {
  const st = db.prepare('UPDATE event_types SET position=? WHERE id=? AND user_id=?');
  (req.body?.ids || []).forEach((id, i) => st.run(i, id, req.user.id));
  res.json({ ok: true });
}));
api.get('/event-types/:id/links', wrap((req, res) => {
  const et = ownEt(req);
  res.json({ links: db.prepare('SELECT * FROM scheduling_links WHERE event_type_id=? ORDER BY id DESC LIMIT 50').all(et.id) });
}));
api.post('/event-types/:id/links', wrap((req, res) => {
  const et = ownEt(req); const token = uid(12);
  db.prepare('INSERT INTO scheduling_links (token, event_type_id, user_id) VALUES (?,?,?)').run(token, et.id, req.user.id);
  res.status(201).json({ link: { token, path: `/d/${token}` } });
}));
api.get('/event-types/:id/troubleshoot', wrap((req, res) => {
  const et = mapEventType(db.prepare('SELECT * FROM event_types WHERE id=?').get(req.params.id));
  if (!et || (et.user_id !== req.user.id && !hostIdsOf(et).includes(req.user.id))) throw new HttpError(404, 'Event type not found');
  const { start, end, tz, duration } = req.query;
  const r = computeSlots(et, { start, end: end || start, tz: tz || req.user.timezone, duration, diagnostics: true });
  delete r._slots; res.json(r);
}));

// ---------------- schedules & time off ----------------
api.get('/schedules', wrap((req, res) => {
  res.json({ schedules: db.prepare('SELECT * FROM schedules WHERE user_id=? ORDER BY id').all(req.user.id).map(mapSchedule), default_schedule_id: req.user.default_schedule_id,
    time_off: db.prepare('SELECT * FROM time_off WHERE user_id=? ORDER BY start_date').all(req.user.id) });
}));
function cleanRules(rules) {
  const out = {}; const re = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    out[d] = (rules?.[d] || []).filter((iv) => re.test(iv.start) && re.test(iv.end) && iv.start < iv.end).sort((a, b) => a.start.localeCompare(b.start));
  }
  return out;
}
function cleanOverrides(ov) {
  const out = {}; for (const [k, v] of Object.entries(ov || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) out[k] = (v || []).filter((iv) => iv.start < iv.end); return out;
}
api.post('/schedules', wrap((req, res) => {
  const { name, timezone, rules, overrides } = req.body || {};
  const info = db.prepare('INSERT INTO schedules (user_id, name, timezone, rules, overrides) VALUES (?,?,?,?,?)')
    .run(req.user.id, name || 'New schedule', validTz(timezone) ? timezone : req.user.timezone, S(cleanRules(rules || DEFAULT_RULES)), S(cleanOverrides(overrides)));
  res.status(201).json({ schedule: mapSchedule(db.prepare('SELECT * FROM schedules WHERE id=?').get(info.lastInsertRowid)) });
}));
api.patch('/schedules/:id', wrap((req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!s) throw new HttpError(404, 'Schedule not found');
  const b = req.body || {};
  if (b.timezone && !validTz(b.timezone)) throw new HttpError(400, 'Invalid time zone');
  db.prepare('UPDATE schedules SET name=?, timezone=?, rules=?, overrides=? WHERE id=?').run(b.name ?? s.name, b.timezone ?? s.timezone,
    b.rules ? S(cleanRules(b.rules)) : s.rules, b.overrides ? S(cleanOverrides(b.overrides)) : s.overrides, s.id);
  if (b.make_default) db.prepare('UPDATE users SET default_schedule_id=? WHERE id=?').run(s.id, req.user.id);
  res.json({ schedule: mapSchedule(db.prepare('SELECT * FROM schedules WHERE id=?').get(s.id)) });
}));
api.delete('/schedules/:id', wrap((req, res) => {
  if (Number(req.params.id) === req.user.default_schedule_id) throw new HttpError(400, 'You cannot delete your default schedule.');
  db.prepare('UPDATE event_types SET schedule_id=NULL WHERE schedule_id=? AND user_id=?').run(req.params.id, req.user.id);
  db.prepare('DELETE FROM schedules WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true });
}));
api.post('/time-off', wrap((req, res) => {
  const { start_date, end_date, label } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end_date || start_date || '')) throw new HttpError(400, 'Invalid dates');
  const e = end_date || start_date; if (e < start_date) throw new HttpError(400, 'End date must be after start date');
  const info = db.prepare('INSERT INTO time_off (user_id, start_date, end_date, label) VALUES (?,?,?,?)').run(req.user.id, start_date, e, label || 'Time off');
  res.status(201).json({ time_off: db.prepare('SELECT * FROM time_off WHERE id=?').get(info.lastInsertRowid) });
}));
api.delete('/time-off/:id', wrap((req, res) => { db.prepare('DELETE FROM time_off WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); }));

// ---------------- bookings ----------------
function visibleBooking(req, uidv) {
  const b = mapBooking(db.prepare('SELECT * FROM bookings WHERE uid=?').get(uidv));
  if (!b || (b.owner_id !== req.user.id && !b.host_ids.includes(req.user.id))) throw new HttpError(404, 'Booking not found');
  return b;
}
function listBookings(req) {
  const { status = 'upcoming', q, event_type_id, from, to, limit = 500 } = req.query;
  const now = new Date().toISOString();
  const where = ['(owner_id=@me OR EXISTS (SELECT 1 FROM json_each(bookings.host_ids) WHERE value=@me))'];
  const p = { me: req.user.id, now, limit: Math.min(2000, Number(limit) || 500) };
  if (status === 'upcoming') where.push("status='active' AND end_utc >= @now");
  if (status === 'past') where.push("status='active' AND end_utc < @now");
  if (status === 'canceled') where.push("status IN ('canceled','rescheduled')");
  if (event_type_id) { where.push('event_type_id=@et'); p.et = Number(event_type_id); }
  if (from) { where.push('start_utc >= @from'); p.from = from; }
  if (to) { where.push('start_utc <= @to'); p.to = to; }
  if (q) { where.push('(invitee_name LIKE @q OR invitee_email LIKE @q)'); p.q = `%${q}%`; }
  const order = status === 'upcoming' ? 'ASC' : 'DESC';
  return db.prepare(`SELECT * FROM bookings WHERE ${where.join(' AND ')} ORDER BY start_utc ${order} LIMIT @limit`).all(p).map(mapBooking);
}
const etNames = () => Object.fromEntries(db.prepare('SELECT id, name, color, kind FROM event_types').all().map((e) => [e.id, e]));
const userNames = () => Object.fromEntries(db.prepare('SELECT id, name FROM users').all().map((u) => [u.id, u.name]));
api.get('/bookings', wrap((req, res) => {
  const ets = etNames(), us = userNames();
  res.json({ bookings: listBookings(req).map((b) => ({ ...b, event_type: ets[b.event_type_id] || (b.poll_id ? { name: db.prepare('SELECT title FROM polls WHERE id=?').get(b.poll_id)?.title || 'Meeting poll', color: '#64748b' } : null), host_names: b.host_ids.map((id) => us[id]) })) });
}));
api.get('/bookings.csv', wrap((req, res) => {
  const ets = etNames(), us = userNames();
  const rows = listBookings(req);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Event Type', 'Start (UTC)', 'End (UTC)', 'Invitee', 'Email', 'Invitee Time Zone', 'Hosts', 'Location', 'Status', 'Cancel Reason', 'No-show', 'Guests', 'Answers', 'Created'];
  const lines = [head.map(q).join(',')];
  for (const b of rows) lines.push([ets[b.event_type_id]?.name, b.start_utc, b.end_utc, b.invitee_name, b.invitee_email, b.invitee_tz, b.host_ids.map((i) => us[i]).join('; '),
    [b.location?.type, b.location?.value].filter(Boolean).join(': '), b.status, b.cancel_reason, b.no_show ? 'yes' : '', b.guests.join('; '),
    b.answers.map((a) => `${a.label}: ${Array.isArray(a.value) ? a.value.join('/') : a.value}`).join(' | '), b.created_at].map(q).join(','));
  res.set('Content-Type', 'text/csv').set('Content-Disposition', 'attachment; filename="scheduled-events.csv"').send(lines.join('\n'));
}));
api.get('/bookings/:uid', wrap((req, res) => {
  const b = visibleBooking(req, req.params.uid);
  const sub = b.routing_submission_id ? db.prepare('SELECT * FROM routing_submissions WHERE id=?').get(b.routing_submission_id) : null;
  res.json({ booking: { ...b, ...publicBooking(b), host_notes: b.host_notes, no_show: b.no_show, source: b.source, created_at: b.created_at,
    routing: sub ? { answers: J(sub.answers, []), form: db.prepare('SELECT name FROM routing_forms WHERE id=?').get(sub.form_id)?.name } : null,
    emails: db.prepare('SELECT id, to_email, subject, kind, created_at FROM outbox WHERE booking_uid=? ORDER BY id').all(b.uid) } });
}));
api.post('/bookings/:uid/cancel', wrap((req, res) => {
  visibleBooking(req, req.params.uid);
  res.json({ booking: cancelBooking(req.params.uid, { reason: req.body?.reason, by: 'host' }) });
}));
api.patch('/bookings/:uid', wrap((req, res) => {
  const b = visibleBooking(req, req.params.uid);
  if (req.body.no_show !== undefined) {
    db.prepare('UPDATE bookings SET no_show=? WHERE id=?').run(req.body.no_show ? 1 : 0, b.id);
    fireWebhook([b.owner_id], req.body.no_show ? 'invitee.no_show_marked' : 'invitee.no_show_unmarked', bookingPayload({ ...b, no_show: !!req.body.no_show }));
  }
  if (req.body.host_notes !== undefined) db.prepare('UPDATE bookings SET host_notes=? WHERE id=?').run(String(req.body.host_notes).slice(0, 5000), b.id);
  res.json({ booking: mapBooking(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id)) });
}));

// ---------------- calendars ----------------
api.get('/calendars', wrap((req, res) => res.json({ calendars: db.prepare('SELECT id, name, url, check_conflicts, last_synced_at, last_error, json_array_length(busy) busy_count FROM calendars WHERE user_id=?').all(req.user.id) })));
api.post('/calendars', wrap(async (req, res) => {
  const { name, url } = req.body || {};
  if (!/^(https?|webcal):\/\//.test(url || '')) throw new HttpError(400, 'Enter a valid ICS URL (https:// or webcal://)');
  const info = db.prepare('INSERT INTO calendars (user_id, name, url) VALUES (?,?,?)').run(req.user.id, name || 'My calendar', url);
  const cal = db.prepare('SELECT * FROM calendars WHERE id=?').get(info.lastInsertRowid);
  const r = await syncCalendar(cal);
  res.status(201).json({ calendar: { id: cal.id }, sync: r });
}));
api.post('/calendars/:id/sync', wrap(async (req, res) => {
  const cal = db.prepare('SELECT * FROM calendars WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!cal) throw new HttpError(404, 'Not found');
  res.json(await syncCalendar(cal));
}));
api.patch('/calendars/:id', wrap((req, res) => {
  db.prepare('UPDATE calendars SET check_conflicts=COALESCE(?, check_conflicts), name=COALESCE(?, name) WHERE id=? AND user_id=?')
    .run(req.body.check_conflicts === undefined ? null : (req.body.check_conflicts ? 1 : 0), req.body.name ?? null, req.params.id, req.user.id);
  res.json({ ok: true });
}));
api.delete('/calendars/:id', wrap((req, res) => { db.prepare('DELETE FROM calendars WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); }));

// ---------------- meeting polls ----------------
const pollOut = (p) => {
  const votes = db.prepare('SELECT * FROM poll_votes WHERE poll_id=? ORDER BY id').all(p.id).map((v) => ({ ...v, choices: J(v.choices, []) }));
  return { ...p, options: J(p.options, []), location: J(p.location, {}), booking_uids: J(p.booking_uids, []), votes, path: `/poll/${p.token}` };
};
api.get('/polls', wrap((req, res) => res.json({ polls: db.prepare('SELECT * FROM polls WHERE user_id=? ORDER BY id DESC').all(req.user.id).map(pollOut) })));
api.post('/polls', wrap((req, res) => {
  const { title, description, duration, location, options, reserve_times } = req.body || {};
  if (!title || !Array.isArray(options) || options.length < 1) throw new HttpError(400, 'A title and at least one time option are required.');
  const opts = options.map((o) => ({ id: o.id || uid(6), start: DateTime.fromISO(o.start).toUTC().toISO() })).filter((o) => o.start);
  const info = db.prepare('INSERT INTO polls (token, user_id, title, description, duration, location, options, reserve_times) VALUES (?,?,?,?,?,?,?,?)')
    .run(uid(12), req.user.id, title, description || '', Number(duration) || 30, S(location || {}), S(opts), reserve_times === false ? 0 : 1);
  res.status(201).json({ poll: pollOut(db.prepare('SELECT * FROM polls WHERE id=?').get(info.lastInsertRowid)) });
}));
api.delete('/polls/:id', wrap((req, res) => { db.prepare('DELETE FROM polls WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); }));
api.post('/polls/:id/close', wrap((req, res) => { db.prepare("UPDATE polls SET status='closed' WHERE id=? AND user_id=?").run(req.params.id, req.user.id); res.json({ ok: true }); }));
api.post('/polls/:id/book', wrap((req, res) => {
  const p = db.prepare('SELECT * FROM polls WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!p) throw new HttpError(404, 'Poll not found');
  if (p.status === 'booked') throw new HttpError(400, 'This poll is already booked.');
  const opt = J(p.options, []).find((o) => o.id === req.body?.option_id);
  if (!opt) throw new HttpError(400, 'Choose a time option');
  const voters = db.prepare('SELECT * FROM poll_votes WHERE poll_id=? ORDER BY id').all(p.id).filter((v) => J(v.choices, []).includes(opt.id));
  if (!voters.length) throw new HttpError(400, 'Nobody has voted for this time yet.');
  const loc = J(p.location, {});
  if (loc.type === 'jitsi' && !loc.value) loc.value = `https://meet.jit.si/Cadence-${uid(10)}`;
  const start = DateTime.fromISO(opt.start, { zone: 'utc' });
  const b = { uid: uid(18), event_type_id: null, owner_id: req.user.id, host_ids: S([req.user.id]), start_utc: start.toISO(), end_utc: start.plus({ minutes: p.duration }).toISO(),
    duration: p.duration, invitee_name: voters[0].name, invitee_email: voters[0].email, invitee_tz: req.user.timezone, guests: S(voters.slice(1).map((v) => v.email)),
    answers: '[]', location: S(loc), source: 'meeting_poll', poll_id: p.id };
  const cols = Object.keys(b);
  const info = db.prepare(`INSERT INTO bookings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => b[c]));
  db.prepare("UPDATE polls SET status='booked', booked_option=?, booking_uids=? WHERE id=?").run(opt.id, S([b.uid]), p.id);
  const booking = mapBooking(db.prepare('SELECT * FROM bookings WHERE id=?').get(info.lastInsertRowid));
  notifyBooking(booking, 'created'); scheduleWorkflows(booking);
  fireWebhook([req.user.id], 'invitee.created', bookingPayload(booking));
  res.json({ poll: pollOut(db.prepare('SELECT * FROM polls WHERE id=?').get(p.id)), booking_uid: b.uid });
}));

// ---------------- routing forms ----------------
const formOut = (f) => ({ ...f, active: !!f.active, questions: J(f.questions, []), rules: J(f.rules, []), fallback: J(f.fallback, {}), path: `/form/${f.token}`,
  submissions: db.prepare('SELECT COUNT(*) c FROM routing_submissions WHERE form_id=?').get(f.id).c });
api.get('/routing-forms', wrap((req, res) => res.json({ forms: db.prepare('SELECT * FROM routing_forms WHERE user_id=? ORDER BY id DESC').all(req.user.id).map(formOut) })));
api.post('/routing-forms', wrap((req, res) => {
  const b = req.body || {};
  const info = db.prepare('INSERT INTO routing_forms (token, user_id, name, description, questions, rules, fallback) VALUES (?,?,?,?,?,?,?)')
    .run(uid(12), req.user.id, b.name || 'Untitled form', b.description || '', S(b.questions || [{ id: uid(6), type: 'name', label: 'Name', required: true }, { id: uid(6), type: 'email', label: 'Email', required: true }]),
      S(b.rules || []), S(b.fallback || { type: 'message', message: 'Thanks for reaching out! We will get back to you shortly.' }));
  res.status(201).json({ form: formOut(db.prepare('SELECT * FROM routing_forms WHERE id=?').get(info.lastInsertRowid)) });
}));
api.patch('/routing-forms/:id', wrap((req, res) => {
  const f = db.prepare('SELECT * FROM routing_forms WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!f) throw new HttpError(404, 'Form not found');
  const b = req.body || {};
  db.prepare('UPDATE routing_forms SET name=?, description=?, questions=?, rules=?, fallback=?, active=? WHERE id=?').run(b.name ?? f.name, b.description ?? f.description,
    b.questions ? S(b.questions) : f.questions, b.rules ? S(b.rules) : f.rules, b.fallback ? S(b.fallback) : f.fallback, b.active === undefined ? f.active : (b.active ? 1 : 0), f.id);
  res.json({ form: formOut(db.prepare('SELECT * FROM routing_forms WHERE id=?').get(f.id)) });
}));
api.delete('/routing-forms/:id', wrap((req, res) => { db.prepare('DELETE FROM routing_forms WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); }));
api.get('/routing-forms/:id/submissions', wrap((req, res) => {
  const f = db.prepare('SELECT * FROM routing_forms WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!f) throw new HttpError(404, 'Form not found');
  res.json({ submissions: db.prepare('SELECT * FROM routing_submissions WHERE form_id=? ORDER BY id DESC LIMIT 500').all(f.id).map((s) => ({ ...s, answers: J(s.answers, []), result: J(s.result, {}) })) });
}));

// ---------------- workflows ----------------
const wfOut = (w) => ({ ...w, active: !!w.active, event_type_ids: J(w.event_type_ids, []) });
api.get('/workflows', wrap((req, res) => res.json({ workflows: db.prepare('SELECT * FROM workflows WHERE user_id=? ORDER BY id').all(req.user.id).map(wfOut) })));
function wfFields(b) {
  if (b.trigger && !['booked', 'before_start', 'after_end', 'canceled'].includes(b.trigger)) throw new HttpError(400, 'Invalid trigger');
  if (b.action && !['email_invitee', 'email_host'].includes(b.action)) throw new HttpError(400, 'Invalid action');
  return b;
}
api.post('/workflows', wrap((req, res) => {
  const b = wfFields(req.body || {});
  const info = db.prepare('INSERT INTO workflows (user_id, name, trigger, offset_minutes, action, subject, body, event_type_ids, active) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.user.id, b.name || 'New workflow', b.trigger || 'before_start', Number(b.offset_minutes) || 0, b.action || 'email_invitee', b.subject || '', b.body || '', S(b.event_type_ids || []), b.active === false ? 0 : 1);
  res.status(201).json({ workflow: wfOut(db.prepare('SELECT * FROM workflows WHERE id=?').get(info.lastInsertRowid)) });
}));
api.patch('/workflows/:id', wrap((req, res) => {
  const w = db.prepare('SELECT * FROM workflows WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!w) throw new HttpError(404, 'Workflow not found');
  const b = wfFields(req.body || {});
  db.prepare('UPDATE workflows SET name=?, trigger=?, offset_minutes=?, action=?, subject=?, body=?, event_type_ids=?, active=? WHERE id=?').run(
    b.name ?? w.name, b.trigger ?? w.trigger, b.offset_minutes ?? w.offset_minutes, b.action ?? w.action, b.subject ?? w.subject, b.body ?? w.body,
    b.event_type_ids ? S(b.event_type_ids) : w.event_type_ids, b.active === undefined ? w.active : (b.active ? 1 : 0), w.id);
  // re-schedule pending jobs for upcoming bookings
  const ups = db.prepare(`SELECT * FROM bookings WHERE status='active' AND start_utc > ? AND (owner_id=? OR EXISTS (SELECT 1 FROM json_each(bookings.host_ids) WHERE value=?))`).all(new Date().toISOString(), req.user.id, req.user.id).map(mapBooking);
  for (const bk of ups) scheduleWorkflows(bk);
  res.json({ workflow: wfOut(db.prepare('SELECT * FROM workflows WHERE id=?').get(w.id)) });
}));
api.delete('/workflows/:id', wrap((req, res) => { db.prepare('DELETE FROM workflows WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); }));

// ---------------- webhooks ----------------
export const WEBHOOK_EVENTS = ['invitee.created', 'invitee.canceled', 'invitee.rescheduled', 'invitee.no_show_marked', 'invitee.no_show_unmarked', 'routing_form_submission.created', 'poll.vote_created'];
api.get('/webhooks', wrap((req, res) => res.json({ events: WEBHOOK_EVENTS, webhooks: db.prepare('SELECT * FROM webhooks WHERE user_id=? ORDER BY id DESC').all(req.user.id).map((w) => ({ ...w, active: !!w.active, events: J(w.events, []) })) })));
api.post('/webhooks', wrap((req, res) => {
  const { url, events } = req.body || {};
  if (!/^https?:\/\//.test(url || '')) throw new HttpError(400, 'Enter a valid URL');
  const ev = (events || []).filter((e) => WEBHOOK_EVENTS.includes(e)); if (!ev.length) throw new HttpError(400, 'Pick at least one event');
  const info = db.prepare('INSERT INTO webhooks (user_id, url, events, secret) VALUES (?,?,?,?)').run(req.user.id, url, S(ev), `whsec_${crypto.randomBytes(18).toString('hex')}`);
  res.status(201).json({ webhook: db.prepare('SELECT * FROM webhooks WHERE id=?').get(info.lastInsertRowid) });
}));
api.patch('/webhooks/:id', wrap((req, res) => {
  db.prepare('UPDATE webhooks SET active=COALESCE(?, active) WHERE id=? AND user_id=?').run(req.body.active === undefined ? null : (req.body.active ? 1 : 0), req.params.id, req.user.id);
  res.json({ ok: true });
}));
api.delete('/webhooks/:id', wrap((req, res) => { db.prepare('DELETE FROM webhooks WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); }));
api.get('/webhooks/:id/deliveries', wrap((req, res) => {
  const w = db.prepare('SELECT * FROM webhooks WHERE id=? AND user_id=?').get(req.params.id, req.user.id); if (!w) throw new HttpError(404, 'Not found');
  res.json({ deliveries: db.prepare('SELECT * FROM webhook_deliveries WHERE webhook_id=? ORDER BY id DESC LIMIT 50').all(w.id) });
}));
api.post('/webhooks/:id/test', wrap(async (req, res) => {
  const w = db.prepare('SELECT * FROM webhooks WHERE id=? AND user_id=?').get(req.params.id, req.user.id); if (!w) throw new HttpError(404, 'Not found');
  res.json(await deliver(w, 'ping', { message: 'Test delivery from Cadence', user: req.user.email }));
}));

// ---------------- api tokens ----------------
api.get('/tokens', wrap((req, res) => res.json({ tokens: db.prepare('SELECT id, name, prefix, last_used_at, created_at FROM api_tokens WHERE user_id=?').all(req.user.id) })));
api.post('/tokens', wrap((req, res) => {
  const token = `cad_${crypto.randomBytes(24).toString('hex')}`;
  db.prepare('INSERT INTO api_tokens (user_id, name, token_hash, prefix) VALUES (?,?,?,?)').run(req.user.id, req.body?.name || 'API token', sha256(token), token.slice(0, 10));
  res.status(201).json({ token });
}));
api.delete('/tokens/:id', wrap((req, res) => { db.prepare('DELETE FROM api_tokens WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); }));

// ---------------- outbox ----------------
api.get('/outbox', wrap((req, res) => res.json({ smtp: smtpEnabled(), emails: db.prepare('SELECT id, to_email, subject, kind, booking_uid, delivered, error, created_at FROM outbox WHERE user_id=? ORDER BY id DESC LIMIT 300').all(req.user.id) })));
api.get('/outbox/:id', wrap((req, res) => {
  const m = db.prepare('SELECT * FROM outbox WHERE id=? AND user_id=?').get(req.params.id, req.user.id); if (!m) throw new HttpError(404, 'Not found');
  res.json({ email: m });
}));

// ---------------- contacts ----------------
api.get('/contacts', wrap((req, res) => {
  const rows = db.prepare(`SELECT invitee_email email, MAX(invitee_name) name, COUNT(*) total,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active, SUM(CASE WHEN status='canceled' THEN 1 ELSE 0 END) canceled, SUM(no_show) no_shows,
      MAX(start_utc) last_meeting, MIN(created_at) first_seen, MAX(invitee_tz) timezone
    FROM bookings WHERE owner_id=? OR EXISTS (SELECT 1 FROM json_each(bookings.host_ids) WHERE value=?) GROUP BY invitee_email ORDER BY last_meeting DESC`).all(req.user.id, req.user.id);
  res.json({ contacts: rows });
}));

// ---------------- analytics ----------------
api.get('/analytics', wrap((req, res) => {
  const days = Math.min(365, Number(req.query.days) || 30);
  const tz = req.user.timezone || 'UTC';
  const since = DateTime.utc().minus({ days }).toISO();
  const rows = db.prepare(`SELECT * FROM bookings WHERE created_at >= datetime(?) AND (owner_id=? OR EXISTS (SELECT 1 FROM json_each(bookings.host_ids) WHERE value=?))`)
    .all(since.replace('T', ' ').slice(0, 19), req.user.id, req.user.id).map(mapBooking);
  const ets = etNames(), us = userNames();
  const tally = (f) => { const m = {}; for (const r of rows) { const k = f(r); if (k == null) continue; m[k] = (m[k] || 0) + 1; } return m; };
  const series = {}; for (let i = days - 1; i >= 0; i--) series[DateTime.now().setZone(tz).minus({ days: i }).toISODate()] = { created: 0, canceled: 0 };
  for (const r of rows) {
    const d = DateTime.fromSQL(r.created_at, { zone: 'utc' }).setZone(tz).toISODate(); if (series[d]) series[d].created++;
    if (r.status === 'canceled' && r.canceled_at) { const c = DateTime.fromSQL(r.canceled_at, { zone: 'utc' }).setZone(tz).toISODate(); if (series[c]) series[c].canceled++; }
  }
  const WDN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  res.json({
    days, timezone: tz,
    totals: { created: rows.length, active: rows.filter((r) => r.status === 'active').length, canceled: rows.filter((r) => r.status === 'canceled').length,
      rescheduled: rows.filter((r) => r.status === 'rescheduled').length, no_shows: rows.filter((r) => r.no_show).length },
    by_event_type: tally((r) => ets[r.event_type_id]?.name || (r.poll_id ? 'Meeting polls' : 'Other')),
    by_weekday: WDN.map((d, i) => ({ day: d, count: rows.filter((r) => r.status !== 'canceled' && DateTime.fromISO(r.start_utc).setZone(tz).weekday === i + 1).length })),
    by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: rows.filter((r) => r.status !== 'canceled' && DateTime.fromISO(r.start_utc).setZone(tz).hour === h).length })),
    by_host: tally((r) => us[r.host_ids[0]]), by_source: tally((r) => r.source),
    series: Object.entries(series).map(([date, v]) => ({ date, ...v })),
  });
}));
