import express from 'express';
import { DateTime } from 'luxon';
import { db, J, S, mapEventType, mapBooking, uid } from './db.js';
import { computeSlots, settingsOf, hostIdsOf } from './slots.js';
import { createBooking, cancelBooking, publicBooking, afterBookingConfirmed, HttpError } from './bookings.js';
import { bookingICS, fireWebhook, sendEmail } from './notify.js';
import { optionalUser } from './auth.js';
import { ensureFreshBusy } from './calendars.js';
import { paymentsEnabled, confirmPayment } from './payments.js';
import { rateLimit } from './security.js';
import { background } from './background.js';
import { hasHost } from './db.js';

const limitPost = rateLimit({ windowMs: 60000, max: 20 });
const escHtml = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const pub = express.Router();

const profileOf = (u) => u && ({
  id: u.id, name: u.name, slug: u.slug, timezone: u.timezone, welcome: u.welcome, brand_color: u.brand_color,
  avatar_color: u.avatar_color, avatar_url: u.avatar_url, time_format: u.time_format, hide_branding: !!u.hide_branding,
});

export async function publicEvent(et) {
  const st = settingsOf(et);
  const owner = await await db.prepare('SELECT * FROM users WHERE id=?').get(et.user_id);
  const hosts = (await Promise.all(hostIdsOf(et).map((id) => db.prepare('SELECT id, name, avatar_color, avatar_url FROM users WHERE id=?').get(id)))).filter(Boolean);
  return {
    id: et.id, kind: et.kind, name: et.name, slug: et.slug, description: et.description, color: et.color,
    duration: et.duration, durations: et.durations, active: et.active, secret: et.secret,
    locations: et.locations.map((l, i) => ({ index: i, type: l.type, label: l.label || '', value: ['in_person', 'custom'].includes(l.type) ? l.value : undefined })),
    questions: et.questions,
    settings: {
      allow_guests: st.allow_guests, max_guests: st.max_guests, lock_timezone: st.lock_timezone, show_spots_left: st.show_spots_left,
      max_invitees: et.kind === 'group' ? st.max_invitees : undefined, price_cents: paymentsEnabled() ? Number(st.price_cents) || 0 : 0, currency: st.currency,
      confirmation: st.confirmation, date_range: st.date_range,
    },
    owner: profileOf(owner), hosts,
  };
}

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
    console.error(e); res.status(500).json({ error: 'Server error. Please try again.' });
  }
};

pub.get('/profile/:slug', wrap(async (req, res) => {
  const u = await db.prepare('SELECT * FROM users WHERE slug=?').get(req.params.slug);
  if (!u) throw new HttpError(404, 'Page not found');
  const ets = (await db.prepare('SELECT * FROM event_types WHERE user_id=? AND active=1 AND secret=0 ORDER BY position, id').all(u.id)).map(mapEventType);
  res.json({ profile: profileOf(u), event_types: await Promise.all(ets.map(publicEvent)) });
}));

pub.get('/event/:slug/:eslug', wrap(async (req, res) => {
  const u = await db.prepare('SELECT * FROM users WHERE slug=?').get(req.params.slug);
  if (!u) throw new HttpError(404, 'Page not found');
  const et = mapEventType(await db.prepare('SELECT * FROM event_types WHERE user_id=? AND slug=?').get(u.id, req.params.eslug));
  if (!et) throw new HttpError(404, 'This event type does not exist.');
  res.json({ event: await publicEvent(et) });
}));

pub.get('/link/:token', wrap(async (req, res) => {
  const l = await db.prepare('SELECT * FROM scheduling_links WHERE token=?').get(req.params.token);
  if (!l) throw new HttpError(404, 'This link is invalid.');
  if (l.used_at) throw new HttpError(410, 'This single-use link has already been used.');
  const et = mapEventType(await db.prepare('SELECT * FROM event_types WHERE id=?').get(l.event_type_id));
  if (!et) throw new HttpError(404, 'This link is invalid.');
  res.json({ event: await publicEvent({ ...et, active: true }), token: l.token });
}));

pub.get('/slots/:id', optionalUser, wrap(async (req, res) => {
  const et = mapEventType(await db.prepare('SELECT * FROM event_types WHERE id=?').get(req.params.id));
  if (!et) throw new HttpError(404, 'Event type not found');
  const { start, end, tz, duration, reschedule, link } = req.query;
  if (!start) throw new HttpError(400, 'start is required');
  if (!et.active && !link) return res.json({ timezone: tz, days: {}, inactive: true });
  const span = DateTime.fromISO(end || start).diff(DateTime.fromISO(start), 'days').days;
  if (!(span >= 0 && span <= 62)) throw new HttpError(400, 'Range must be 0–62 days');
  let diagnostics = false;
  if (req.query.diagnostics && req.user) {
    diagnostics = req.user.id === et.user_id || hostIdsOf(et).includes(req.user.id) || await db.prepare('SELECT 1 FROM users WHERE id=? AND org_id=?').get(et.user_id, req.user.org_id);
  }
  await ensureFreshBusy(hostIdsOf(et));
  const r = await computeSlots(et, { start, end, tz, duration, excludeUid: reschedule || null, diagnostics: !!diagnostics });
  delete r._slots;
  res.json(r);
}));

pub.post('/bookings', limitPost, wrap(async (req, res) => {
  const b = req.body || {};
  const { booking, checkout_url } = await createBooking({
    eventTypeId: Number(b.event_type_id), start: b.start, duration: b.duration, tz: b.timezone, name: b.name, email: b.email,
    guests: b.guests, answers: b.answers, location: b.location, linkToken: b.link_token, rescheduleUid: b.reschedule_uid,
    routingSubmissionId: b.routing_submission_id ? Number(b.routing_submission_id) : null,
    requestId: req.get('Booking-Request-ID') || b.request_id, source: b.embed ? 'embed' : undefined,
  });
  res.status(201).json({ booking: await publicBooking(booking), checkout_url: checkout_url || null });
}));

pub.get('/bookings/:uid', wrap(async (req, res) => {
  let b = mapBooking(await db.prepare('SELECT * FROM bookings WHERE uid=?').get(req.params.uid));
  if (!b) throw new HttpError(404, 'Booking not found');
  // Returning from Stripe Checkout: verify the payment server-side (the webhook may not have landed yet).
  if (b.status === 'pending_payment' && paymentsEnabled() && req.query.session_id && req.query.session_id === b.payment_ref) {
    try {
      const paid = await confirmPayment(String(req.query.session_id));
      if (paid) b = await afterBookingConfirmed(paid);
    } catch (e) { console.error('payment confirm', e.message); }
  }
  res.json({ booking: await publicBooking(b) });
}));

pub.post('/bookings/:uid/cancel', limitPost, wrap(async (req, res) => {
  const b = await cancelBooking(req.params.uid, { reason: req.body?.reason, by: 'invitee' });
  res.json({ booking: await publicBooking(b) });
}));

pub.get('/bookings/:uid/ics', wrap(async (req, res) => {
  const b = mapBooking(await db.prepare('SELECT * FROM bookings WHERE uid=?').get(req.params.uid));
  if (!b) throw new HttpError(404, 'Booking not found');
  res.set('Content-Type', 'text/calendar; charset=utf-8').set('Content-Disposition', `attachment; filename="invite-${b.uid}.ics"`).send(await bookingICS([b]));
}));

// ---- meeting polls ----
async function publicPoll(p) {
  const owner = await db.prepare('SELECT * FROM users WHERE id=?').get(p.user_id);
  const votes = (await db.prepare('SELECT name, choices, created_at FROM poll_votes WHERE poll_id=? ORDER BY id').all(p.id)).map((v) => ({ ...v, choices: J(v.choices, []) }));
  return { token: p.token, title: p.title, description: p.description, duration: p.duration, location: J(p.location, {}),
    options: J(p.options, []), status: p.status, booked_option: p.booked_option, owner: profileOf(owner), votes };
}
pub.get('/polls/:token', wrap(async (req, res) => {
  const p = await db.prepare('SELECT * FROM polls WHERE token=?').get(req.params.token);
  if (!p) throw new HttpError(404, 'Poll not found');
  res.json({ poll: await publicPoll(p) });
}));
pub.post('/polls/:token/vote', limitPost, wrap(async (req, res) => {
  const p = await db.prepare('SELECT * FROM polls WHERE token=?').get(req.params.token);
  if (!p) throw new HttpError(404, 'Poll not found');
  if (p.status !== 'open') throw new HttpError(400, 'This poll is closed.');
  const { name, email, choices } = req.body || {};
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw new HttpError(400, 'Name and a valid email are required.');
  const valid = new Set(J(p.options, []).map((o) => o.id));
  const ch = (choices || []).filter((c) => valid.has(c));
  await db.prepare('DELETE FROM poll_votes WHERE poll_id=? AND email=?').run(p.id, email.toLowerCase());
  await db.prepare('INSERT INTO poll_votes (poll_id, name, email, choices) VALUES (?,?,?,?)').run(p.id, String(name).slice(0, 120), email.toLowerCase(), S(ch));
  const owner = await db.prepare('SELECT * FROM users WHERE id=?').get(p.user_id);
  background(Promise.allSettled([
    sendEmail({ userId: p.user_id, to: owner.email, subject: `${String(name).slice(0, 80)} voted on "${p.title}"`, html: `<p>${escHtml(name)} (${escHtml(email)}) selected ${ch.length} time option(s) on your poll <b>${escHtml(p.title)}</b>.</p>`, kind: 'poll_vote' }),
    fireWebhook([p.user_id], 'poll.vote_created', { poll: p.token, name, email, choices: ch }),
  ]));
  res.json({ poll: await publicPoll(await db.prepare('SELECT * FROM polls WHERE id=?').get(p.id)) });
}));

// ---- routing forms ----
pub.get('/forms/:token', wrap(async (req, res) => {
  const f = await db.prepare('SELECT * FROM routing_forms WHERE token=?').get(req.params.token);
  if (!f || !f.active) throw new HttpError(404, 'Form not found');
  const owner = await db.prepare('SELECT * FROM users WHERE id=?').get(f.user_id);
  res.json({ form: { token: f.token, name: f.name, description: f.description, questions: J(f.questions, []), owner: profileOf(owner) } });
}));

export function evaluateRouting(form, answers) {
  const get = (qid) => { const a = answers.find((x) => x.id === qid); return a ? a.value : ''; };
  const test = (c) => {
    const v = get(c.question_id); const vals = Array.isArray(v) ? v.map(String) : [String(v ?? '')];
    const target = String(c.value ?? '').toLowerCase();
    switch (c.op) {
      case 'equals': return vals.some((x) => x.toLowerCase() === target);
      case 'not_equals': return vals.every((x) => x.toLowerCase() !== target);
      case 'contains': return vals.some((x) => x.toLowerCase().includes(target));
      case 'any_of': { const set = target.split(',').map((s) => s.trim()); return vals.some((x) => set.includes(x.toLowerCase())); }
      case 'gte': return vals.some((x) => Number(x) >= Number(c.value));
      case 'lte': return vals.some((x) => Number(x) <= Number(c.value));
      case 'is_empty': return vals.every((x) => !x.trim());
      default: return false;
    }
  };
  for (const r of J(form.rules, [])) {
    const conds = r.conditions || [];
    if (!conds.length) continue;
    const ok = r.match === 'any' ? conds.some(test) : conds.every(test);
    if (ok) return { ...r.action, matched_rule: r.name || true };
  }
  return { ...J(form.fallback, { type: 'message', message: 'Thanks! We will be in touch.' }), matched_rule: null };
}

pub.post('/forms/:token/submit', limitPost, wrap(async (req, res) => {
  const f = await db.prepare('SELECT * FROM routing_forms WHERE token=?').get(req.params.token);
  if (!f || !f.active) throw new HttpError(404, 'Form not found');
  const qs = J(f.questions, []); const answers = [];
  for (const q of qs) {
    const a = (req.body?.answers || []).find((x) => x.id === q.id);
    const v = a?.value; const empty = v == null || (Array.isArray(v) ? !v.length : !String(v).trim());
    if (q.required && empty) throw new HttpError(400, `"${q.label}" is required.`);
    answers.push({ id: q.id, label: q.label, type: q.type, value: v ?? '' });
  }
  const result = evaluateRouting(f, answers);
  const info = await db.prepare('INSERT INTO routing_submissions (form_id, answers, result) VALUES (?,?,?)').run(f.id, S(answers), S(result));
  let target = null;
  if (result.type === 'event_type') {
    const et = mapEventType(await db.prepare('SELECT * FROM event_types WHERE id=?').get(result.event_type_id));
    const owner = et && await db.prepare('SELECT slug FROM users WHERE id=?').get(et.user_id);
    if (et && owner) target = `/${owner.slug}/${et.slug}`;
  }
  const nameQ = qs.find((q) => q.type === 'name') || qs.find((q) => /name/i.test(q.label));
  const emailQ = qs.find((q) => q.type === 'email');
  background(fireWebhook([f.user_id], 'routing_form_submission.created', { form: f.name, answers, result }));
  res.json({ submission_id: info.lastInsertRowid, result: { ...result, target },
    prefill: { name: nameQ ? answers.find((a) => a.id === nameQ.id)?.value : '', email: emailQ ? answers.find((a) => a.id === emailQ.id)?.value : '' } });
}));

// ---- subscription feed ----
export async function feedHandler(req, res) {
  const token = String(req.params.token).replace(/\.ics$/, '');
  if (!/^[\w-]{8,}$/.test(token)) return res.status(404).send('Not found');
  const u = await db.prepare('SELECT * FROM users WHERE feed_token=?').get(token);
  if (!u) return res.status(404).send('Not found');
  const rows = (await db.prepare(`SELECT * FROM bookings WHERE status='active' AND end_utc > ? AND
      (owner_id=? OR ${hasHost()}) ORDER BY start_utc LIMIT 2000`)
    .all(DateTime.utc().minus({ days: 60 }).toISO(), u.id, u.id)).map(mapBooking);
  res.set('Content-Type', 'text/calendar; charset=utf-8').send(await bookingICS(rows, { calName: `Cadence — ${u.name}` }));
}
