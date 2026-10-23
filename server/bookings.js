import { DateTime } from 'luxon';
import { db, uid, S, J, mapBooking, mapEventType } from './db.js';
import { checkAndAssign, settingsOf } from './slots.js';
import { notifyBooking, scheduleWorkflows, cancelWorkflows, fireWebhook, bookingPayload } from './notify.js';

export class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolveLocation(et, sel) {
  const locs = et.locations || [];
  if (!locs.length) return {};
  let loc = locs.find((l, i) => (sel?.index != null ? i === Number(sel.index) : l.type === sel?.type)) || locs[0];
  const out = { type: loc.type, label: loc.label || '' };
  if (loc.type === 'jitsi') out.value = `https://meet.jit.si/Cadence-${uid(10)}`;
  else if (['zoom', 'google_meet', 'teams', 'in_person', 'custom', 'phone_inbound'].includes(loc.type)) out.value = loc.value || '';
  else if (loc.type === 'phone_outbound' || loc.type === 'ask_invitee') {
    if (!sel?.value || !String(sel.value).trim()) throw new HttpError(400, loc.type === 'phone_outbound' ? 'Please enter your phone number.' : 'Please enter a location.');
    out.value = String(sel.value).slice(0, 300);
  }
  return out;
}

function validateAnswers(et, answers) {
  const out = [];
  for (const q of et.questions || []) {
    const a = (answers || []).find((x) => x.id === q.id);
    let v = a?.value;
    const empty = v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');
    if (q.required && empty) throw new HttpError(400, `"${q.label}" is required.`);
    if (empty) continue;
    if (q.type === 'phone' && !/^[+()\d\s.-]{6,}$/.test(String(v))) throw new HttpError(400, `"${q.label}" must be a valid phone number.`);
    if (Array.isArray(v)) v = v.map((x) => String(x).slice(0, 500)); else v = String(v).slice(0, 5000);
    out.push({ id: q.id, label: q.label, value: v });
  }
  return out;
}

/**
 * Create a booking. input: { eventTypeId, start, duration, tz, name, email, guests, answers, location, linkToken, rescheduleUid, routingSubmissionId, requestId, source, skipChecks }
 */
export function createBooking(input) {
  const et = mapEventType(db.prepare('SELECT * FROM event_types WHERE id=?').get(input.eventTypeId));
  if (!et) throw new HttpError(404, 'Event type not found');
  if (!et.active && !input.skipChecks) throw new HttpError(400, 'This event type is not currently accepting bookings.');
  const st = settingsOf(et);
  if (input.requestId) {
    const ex = db.prepare('SELECT * FROM bookings WHERE request_id=?').get(input.requestId);
    if (ex) return { booking: mapBooking(ex), idempotent: true };
  }
  const name = String(input.name || '').trim(); const email = String(input.email || '').trim().toLowerCase();
  if (!name) throw new HttpError(400, 'Name is required.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter an email with a valid format, like name@example.com');
  let guests = [];
  if (st.allow_guests && Array.isArray(input.guests)) {
    guests = [...new Set(input.guests.map((g) => String(g).trim().toLowerCase()).filter(Boolean))];
    for (const g of guests) if (!EMAIL_RE.test(g)) throw new HttpError(400, `Guest email "${g}" is invalid.`);
    guests = guests.slice(0, Number(st.max_guests) || 10);
  }
  const durations = et.durations?.length ? et.durations : [et.duration];
  const duration = durations.includes(Number(input.duration)) ? Number(input.duration) : et.duration;
  const answers = validateAnswers(et, input.answers);

  let old = null;
  if (input.rescheduleUid) {
    old = mapBooking(db.prepare('SELECT * FROM bookings WHERE uid=?').get(input.rescheduleUid));
    if (!old || old.status !== 'active') throw new HttpError(400, 'The original booking can no longer be rescheduled.');
    if (old.event_type_id !== et.id) throw new HttpError(400, 'Mismatched event type.');
  }
  let link = null;
  if (input.linkToken) {
    link = db.prepare('SELECT * FROM scheduling_links WHERE token=?').get(input.linkToken);
    if (!link || link.event_type_id !== et.id) throw new HttpError(404, 'Invalid scheduling link.');
    if (link.used_at) throw new HttpError(410, 'This single-use link has already been used.');
  } else if (et.secret && !input.rescheduleUid && !input.skipChecks && !input.allowSecret) {
    // secret events are bookable via direct link — allowed (Calendly semantics: hidden from profile only)
  }

  const tx = db.transaction(() => {
    let hostIds;
    if (input.skipChecks) hostIds = input.hostIds || [et.user_id];
    else {
      const chk = checkAndAssign(et, input.start, duration, old?.uid);
      if (!chk.ok) throw new HttpError(409, chk.reason, { code: chk.code });
      hostIds = chk.hostIds;
      // round robin reschedule: keep same host if still available
      if (old && et.kind === 'round_robin' && old.host_ids?.[0] && chk.hostIds[0] !== old.host_ids[0]) {
        const keep = checkAndAssign({ ...et, hosts: [old.host_ids[0]] }, input.start, duration, old.uid);
        if (keep.ok) hostIds = [old.host_ids[0]];
      }
    }
    const location = old && old.location?.type ? old.location : resolveLocation(et, input.location);
    const start = DateTime.fromISO(input.start, { zone: 'utc' });
    const b = {
      uid: uid(18), event_type_id: et.id, owner_id: et.user_id, host_ids: S(hostIds),
      start_utc: start.toISO(), end_utc: start.plus({ minutes: duration }).toISO(), duration,
      buffer_before: Number(st.buffer_before) || 0, buffer_after: Number(st.buffer_after) || 0,
      invitee_name: name.slice(0, 120), invitee_email: email, invitee_tz: input.tz || 'UTC', guests: S(guests), answers: S(answers),
      location: S(location), price_cents: Number(st.price_cents) || 0, currency: st.currency || 'USD',
      payment_status: Number(st.price_cents) > 0 ? (input.paymentStatus || 'paid_demo') : null,
      source: input.source || (link ? 'single_use_link' : 'booking_page'), link_id: link?.id ?? null, poll_id: input.pollId ?? null,
      routing_submission_id: input.routingSubmissionId ?? null, request_id: input.requestId || null, rescheduled_from: old?.uid ?? null,
    };
    const cols = Object.keys(b);
    const info = db.prepare(`INSERT INTO bookings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => b[c]));
    if (old) db.prepare("UPDATE bookings SET status='rescheduled', rescheduled_to=?, canceled_at=datetime('now') WHERE id=?").run(b.uid, old.id);
    if (link) db.prepare("UPDATE scheduling_links SET used_at=datetime('now'), booking_uid=? WHERE id=?").run(b.uid, link.id);
    if (input.routingSubmissionId) db.prepare('UPDATE routing_submissions SET booking_uid=? WHERE id=?').run(b.uid, input.routingSubmissionId);
    return info.lastInsertRowid;
  });
  const id = tx();
  const booking = mapBooking(db.prepare('SELECT * FROM bookings WHERE id=?').get(id));
  // side effects
  scheduleWorkflows(booking);
  if (old) {
    db.prepare("UPDATE jobs SET status='canceled' WHERE booking_id=? AND status='pending'").run(old.id);
    const host = db.prepare('SELECT timezone FROM users WHERE id=?').get(booking.host_ids[0]) || {};
    const f = (z) => DateTime.fromISO(old.start_utc).setZone(z).toFormat('h:mma – cccc, LLLL d, yyyy');
    notifyBooking(booking, 'rescheduled', { formerTime: f(booking.invitee_tz || 'UTC'), formerTimeHost: f(host.timezone || 'UTC') });
    fireWebhook([et.user_id, ...booking.host_ids], 'invitee.rescheduled', { ...bookingPayload(booking), old: bookingPayload(mapBooking(db.prepare('SELECT * FROM bookings WHERE id=?').get(old.id))) });
  } else {
    notifyBooking(booking, 'created');
  }
  fireWebhook([et.user_id, ...booking.host_ids], 'invitee.created', bookingPayload(booking));
  return { booking };
}

export function cancelBooking(uidv, { reason, by = 'invitee' } = {}) {
  const b = mapBooking(db.prepare('SELECT * FROM bookings WHERE uid=?').get(uidv));
  if (!b) throw new HttpError(404, 'Booking not found');
  if (b.status !== 'active') throw new HttpError(400, 'This booking is already canceled.');
  if (by === 'invitee') {
    const et = mapEventType(db.prepare('SELECT * FROM event_types WHERE id=?').get(b.event_type_id));
    if (et && settingsOf(et).allow_invitee_cancel === false) throw new HttpError(403, 'Cancellation is disabled for this event. Please contact the host.');
    if (new Date(b.start_utc) < new Date()) throw new HttpError(400, 'Past events cannot be canceled.');
  }
  db.prepare("UPDATE bookings SET status='canceled', cancel_reason=?, canceled_by=?, canceled_at=datetime('now') WHERE id=?")
    .run(String(reason || '').slice(0, 1000), by, b.id);
  const nb = mapBooking(db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id));
  cancelWorkflows(nb);
  notifyBooking(nb, 'canceled');
  fireWebhook([nb.owner_id, ...nb.host_ids], 'invitee.canceled', bookingPayload(nb));
  if (nb.link_id) db.prepare('UPDATE scheduling_links SET used_at=NULL, booking_uid=NULL WHERE id=?').run(nb.link_id); // free single-use link again
  return nb;
}

export function publicBooking(b) {
  if (!b) return null;
  const et = mapEventType(db.prepare('SELECT * FROM event_types WHERE id=?').get(b.event_type_id));
  const hosts = (b.host_ids || []).map((id) => db.prepare('SELECT id, name, slug, avatar_color, timezone FROM users WHERE id=?').get(id)).filter(Boolean);
  const owner = db.prepare('SELECT id, name, slug, brand_color, avatar_color, time_format, hide_branding FROM users WHERE id=?').get(b.owner_id);
  const st = et ? settingsOf(et) : {};
  return {
    uid: b.uid, status: b.status, start_utc: b.start_utc, end_utc: b.end_utc, duration: b.duration,
    invitee_name: b.invitee_name, invitee_email: b.invitee_email, invitee_tz: b.invitee_tz, guests: b.guests,
    answers: b.answers, location: b.location, cancel_reason: b.cancel_reason, canceled_by: b.canceled_by,
    rescheduled_to: b.rescheduled_to, rescheduled_from: b.rescheduled_from, price_cents: b.price_cents, currency: b.currency, payment_status: b.payment_status,
    event_type: et ? { id: et.id, name: et.name, slug: et.slug, color: et.color, kind: et.kind, description: et.description,
      allow_invitee_cancel: st.allow_invitee_cancel !== false, allow_invitee_reschedule: st.allow_invitee_reschedule !== false, confirmation: st.confirmation } : null,
    hosts, owner: owner ? { ...owner, hide_branding: !!owner.hide_branding } : null,
  };
}
