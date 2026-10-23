import { DateTime } from 'luxon';
import { db, uid, S, J, mapBooking, mapEventType } from './db.js';
import { checkAndAssign, settingsOf, hostIdsOf } from './slots.js';
import { notifyBooking, scheduleWorkflows, cancelWorkflows, fireWebhook, bookingPayload } from './notify.js';
import { ensureFreshBusy, createExternalEvents, deleteExternalEvents } from './calendars.js';
import { paymentsEnabled, createCheckout, HOLD_MINUTES } from './payments.js';
import { background } from './background.js';

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

/** Serialize bookings per host so two invitees can't grab the same slot (transaction-scoped lock). */
export async function lockHosts(ids) {
  for (const id of [...new Set(ids.map(Number))].sort((a, b) => a - b)) await db.query('SELECT pg_advisory_xact_lock(7262100, ?::int)', id);
}
const hostPool = (et) => hostIdsOf(et);

/**
 * Create a booking. input: { eventTypeId, start, duration, tz, name, email, guests, answers, location, linkToken,
 *   rescheduleUid, routingSubmissionId, requestId, source, skipChecks, hostIds, pollId }
 * Returns { booking, checkout_url? }.
 */
export async function createBooking(input) {
  const et = mapEventType(await db.prepare('SELECT * FROM event_types WHERE id=?').get(input.eventTypeId));
  if (!et) throw new HttpError(404, 'Event type not found');
  if (!et.active && !input.skipChecks) throw new HttpError(400, 'This event type is not currently accepting bookings.');
  const st = settingsOf(et);
  if (input.requestId) {
    const ex = await db.prepare('SELECT * FROM bookings WHERE request_id=?').get(input.requestId);
    if (ex) return { booking: mapBooking(ex), idempotent: true };
  }
  const name = String(input.name || '').trim(); const email = String(input.email || '').trim().toLowerCase();
  if (!name) throw new HttpError(400, 'Name is required.');
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Enter an email with a valid format, like name@example.com');
  let guests = [];
  if (st.allow_guests && Array.isArray(input.guests)) {
    guests = [...new Set(input.guests.map((g) => String(g).trim().toLowerCase()).filter(Boolean))];
    for (const g of guests) if (!EMAIL_RE.test(g)) throw new HttpError(400, `Guest email "${g}" is invalid.`);
    guests = guests.slice(0, Number(st.max_guests) || 10);
  }
  const durations = et.durations?.length ? et.durations : [et.duration];
  const duration = durations.includes(Number(input.duration)) ? Number(input.duration) : et.duration;
  const answers = validateAnswers(et, input.answers);
  const startDt = DateTime.fromISO(String(input.start || ''), { zone: 'utc' });
  if (!startDt.isValid) throw new HttpError(400, 'Invalid start time.');

  let old = null;
  if (input.rescheduleUid) {
    old = mapBooking(await db.prepare('SELECT * FROM bookings WHERE uid=?').get(input.rescheduleUid));
    if (!old || old.status !== 'active') throw new HttpError(400, 'The original booking can no longer be rescheduled.');
    if (old.event_type_id !== et.id) throw new HttpError(400, 'Mismatched event type.');
  }
  let link = null;
  if (input.linkToken) {
    link = await db.prepare('SELECT * FROM scheduling_links WHERE token=?').get(input.linkToken);
    if (!link || link.event_type_id !== et.id) throw new HttpError(404, 'Invalid scheduling link.');
    if (link.used_at) throw new HttpError(410, 'This single-use link has already been used.');
  }

  // Price is only honoured when Stripe is configured. Reschedules keep the original payment.
  const price = paymentsEnabled() ? Math.max(0, Math.round(Number(st.price_cents) || 0)) : 0;
  const needsPayment = price > 0 && !old && !input.skipChecks;

  // Pull fresh busy times from connected calendars before we check (network — outside the lock).
  if (!input.skipChecks) await ensureFreshBusy(hostPool(et));

  const id = await db.tx(async () => {
    await lockHosts(input.skipChecks ? (input.hostIds || [et.user_id]) : hostPool(et));
    if (link) {
      const fresh = await db.prepare('SELECT used_at FROM scheduling_links WHERE id=? FOR UPDATE').get(link.id);
      if (fresh?.used_at) throw new HttpError(410, 'This single-use link has already been used.');
    }
    let hostIds;
    if (input.skipChecks) hostIds = input.hostIds || [et.user_id];
    else {
      const chk = await checkAndAssign(et, startDt.toISO(), duration, old?.uid);
      if (!chk.ok) throw new HttpError(409, chk.reason, { code: chk.code });
      hostIds = chk.hostIds;
      // round robin reschedule: keep same host if still available
      if (old && et.kind === 'round_robin' && old.host_ids?.[0] && chk.hostIds[0] !== old.host_ids[0]) {
        const keep = await checkAndAssign({ ...et, hosts: [old.host_ids[0]] }, startDt.toISO(), duration, old.uid);
        if (keep.ok) hostIds = [old.host_ids[0]];
      }
    }
    const location = old && old.location?.type ? { ...old.location, ...(['google_meet', 'teams'].includes(old.location.type) && old.location.auto ? { value: '' } : {}) } : resolveLocation(et, input.location);
    const b = {
      uid: uid(18), event_type_id: et.id, owner_id: et.user_id, host_ids: S(hostIds),
      start_utc: startDt.toISO(), end_utc: startDt.plus({ minutes: duration }).toISO(), duration,
      buffer_before: Number(st.buffer_before) || 0, buffer_after: Number(st.buffer_after) || 0,
      invitee_name: name.slice(0, 120), invitee_email: email, invitee_tz: String(input.tz || 'UTC').slice(0, 64), guests: S(guests), answers: S(answers),
      location: S(location),
      price_cents: old ? old.price_cents : price, currency: old ? old.currency : (st.currency || 'USD'),
      payment_status: old ? old.payment_status : (needsPayment ? 'unpaid' : null), payment_ref: old ? old.payment_ref : null,
      status: needsPayment ? 'pending_payment' : 'active',
      hold_expires_at: needsPayment ? DateTime.utc().plus({ minutes: HOLD_MINUTES }).toISO() : null,
      source: input.source || (link ? 'single_use_link' : 'booking_page'), link_id: link?.id ?? null, poll_id: input.pollId ?? null,
      routing_submission_id: input.routingSubmissionId ?? null, request_id: input.requestId || null, rescheduled_from: old?.uid ?? null,
    };
    const cols = Object.keys(b);
    const info = await db.prepare(`INSERT INTO bookings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => b[c]));
    if (old) await db.prepare("UPDATE bookings SET status='rescheduled', rescheduled_to=?, canceled_at=now_iso() WHERE id=?").run(b.uid, old.id);
    if (link) await db.prepare('UPDATE scheduling_links SET used_at=now_iso(), booking_uid=? WHERE id=?').run(b.uid, link.id);
    if (input.routingSubmissionId) await db.prepare('UPDATE routing_submissions SET booking_uid=? WHERE id=?').run(b.uid, input.routingSubmissionId);
    return info.lastInsertRowid;
  });
  let booking = mapBooking(await db.prepare('SELECT * FROM bookings WHERE id=?').get(id));

  if (needsPayment) {
    try {
      const checkout_url = await createCheckout(booking, et);
      return { booking, checkout_url };
    } catch (e) {
      await db.prepare("UPDATE bookings SET status='expired', hold_expires_at=NULL WHERE id=?").run(booking.id);
      throw new HttpError(502, `Could not start payment: ${e.message}`);
    }
  }
  booking = await afterBookingConfirmed(booking, { old });
  return { booking };
}

/**
 * Side effects of a confirmed booking (fresh, rescheduled, paid, or from a poll):
 * write to hosts' calendars (awaited so the Meet/Teams link is on the confirmation page), then
 * emails, workflows and webhooks in the background.
 */
export async function afterBookingConfirmed(booking, { old = null } = {}) {
  if (old) {
    const oldRow = mapBooking(await db.prepare('SELECT * FROM bookings WHERE id=?').get(old.id));
    await deleteExternalEvents(oldRow).catch((e) => console.error('delete old external events', e.message));
  }
  try { booking = await createExternalEvents(booking); } catch (e) { console.error('external calendar write failed', e.message); }
  const owners = [booking.owner_id, ...booking.host_ids];
  background(async () => {
    await scheduleWorkflows(booking);
    if (old) {
      await db.prepare("UPDATE jobs SET status='canceled' WHERE booking_id=? AND status='pending'").run(old.id);
      const host = await db.prepare('SELECT timezone FROM users WHERE id=?').get(booking.host_ids[0]) || {};
      const f = (z) => DateTime.fromISO(old.start_utc).setZone(z).toFormat('h:mma – cccc, LLLL d, yyyy');
      const oldRow = mapBooking(await db.prepare('SELECT * FROM bookings WHERE id=?').get(old.id));
      await Promise.allSettled([
        notifyBooking(booking, 'rescheduled', { formerTime: f(booking.invitee_tz || 'UTC'), formerTimeHost: f(host.timezone || 'UTC') }),
        fireWebhook(owners, 'invitee.rescheduled', (async () => ({ ...(await bookingPayload(booking)), old: await bookingPayload(oldRow) }))()),
      ]);
    } else {
      await notifyBooking(booking, 'created');
    }
    await fireWebhook(owners, 'invitee.created', bookingPayload(booking));
  });
  return booking;
}

export async function cancelBooking(uidv, { reason, by = 'invitee' } = {}) {
  const b = mapBooking(await db.prepare('SELECT * FROM bookings WHERE uid=?').get(uidv));
  if (!b) throw new HttpError(404, 'Booking not found');
  if (b.status === 'pending_payment') {
    await db.prepare("UPDATE bookings SET status='expired', hold_expires_at=NULL WHERE id=?").run(b.id);
    return mapBooking(await db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id));
  }
  if (b.status !== 'active') throw new HttpError(400, 'This booking is already canceled.');
  if (by === 'invitee') {
    const et = b.event_type_id ? mapEventType(await db.prepare('SELECT * FROM event_types WHERE id=?').get(b.event_type_id)) : null;
    if (et && settingsOf(et).allow_invitee_cancel === false) throw new HttpError(403, 'Cancellation is disabled for this event. Please contact the host.');
    if (new Date(b.start_utc) < new Date()) throw new HttpError(400, 'Past events cannot be canceled.');
  }
  const upd = await db.prepare("UPDATE bookings SET status='canceled', cancel_reason=?, canceled_by=?, canceled_at=now_iso() WHERE id=? AND status='active'")
    .run(String(reason || '').slice(0, 1000), by, b.id);
  if (!upd.changes) throw new HttpError(400, 'This booking is already canceled.');
  if (b.link_id) await db.prepare('UPDATE scheduling_links SET used_at=NULL, booking_uid=NULL WHERE id=?').run(b.link_id); // free single-use link again
  const nb = mapBooking(await db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id));
  background(async () => {
    await deleteExternalEvents(nb).catch((e) => console.error('delete external events', e.message));
    await cancelWorkflows(nb);
    await notifyBooking(nb, 'canceled');
    await fireWebhook([nb.owner_id, ...nb.host_ids], 'invitee.canceled', bookingPayload(nb));
  });
  return nb;
}

export async function publicBooking(b) {
  if (!b) return null;
  const et = b.event_type_id ? mapEventType(await db.prepare('SELECT * FROM event_types WHERE id=?').get(b.event_type_id)) : null;
  const hosts = (await Promise.all((b.host_ids || []).map((id) => db.prepare('SELECT id, name, slug, avatar_color, avatar_url, timezone FROM users WHERE id=?').get(id)))).filter(Boolean);
  const owner = await db.prepare('SELECT id, name, slug, brand_color, avatar_color, avatar_url, time_format, hide_branding FROM users WHERE id=?').get(b.owner_id);
  const st = et ? settingsOf(et) : {};
  return {
    uid: b.uid, status: b.status, start_utc: b.start_utc, end_utc: b.end_utc, duration: b.duration,
    invitee_name: b.invitee_name, invitee_email: b.invitee_email, invitee_tz: b.invitee_tz, guests: b.guests,
    answers: b.answers, location: b.location, cancel_reason: b.cancel_reason, canceled_by: b.canceled_by,
    rescheduled_to: b.rescheduled_to, rescheduled_from: b.rescheduled_from, price_cents: b.price_cents, currency: b.currency, payment_status: b.payment_status,
    hold_expires_at: b.hold_expires_at,
    event_type: et ? { id: et.id, name: et.name, slug: et.slug, color: et.color, kind: et.kind, description: et.description,
      allow_invitee_cancel: st.allow_invitee_cancel !== false, allow_invitee_reschedule: st.allow_invitee_reschedule !== false, confirmation: st.confirmation } : null,
    hosts, owner: owner ? { ...owner, hide_branding: !!owner.hide_branding } : null,
  };
}
