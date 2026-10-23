import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { DateTime } from 'luxon';
import { db, J, S, mapBooking, mapEventType } from './db.js';
import { config, BASE_URL } from './config.js';
import { background } from './background.js';
import { assertPublicUrl } from './security.js';

export { BASE_URL };
let mailer = null;
if (config.email.smtp) {
  const m = config.email.smtp;
  mailer = nodemailer.createTransport({ host: m.host, port: m.port, secure: m.secure, auth: m.user ? { user: m.user, pass: m.pass } : undefined });
}
export const emailEnabled = () => !!(config.email.resendKey || mailer);
const FROM = () => config.email.from || 'Cadence <onboarding@resend.dev>';
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------- ICS ----------------
const icsDate = (iso) => DateTime.fromISO(iso, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss'Z'");
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
export function locationText(loc) {
  if (!loc || !loc.type) return 'To be determined';
  const map = { jitsi: 'Jitsi video', zoom: 'Zoom', google_meet: 'Google Meet', teams: 'Microsoft Teams', in_person: 'In person', phone_outbound: 'Phone call', phone_inbound: 'Phone call', custom: '', ask_invitee: '' };
  const label = map[loc.type] ?? loc.type;
  if (loc.type === 'phone_outbound') return `Phone call — host will call ${loc.value || 'you'}`;
  if (loc.type === 'phone_inbound') return `Phone call — dial ${loc.value || ''}`;
  if (['google_meet', 'teams', 'zoom'].includes(loc.type) && !loc.value) return `${label} (link will be shared by the host)`;
  return [label, loc.value].filter(Boolean).join(': ');
}
export async function bookingICS(bookings, { method = 'PUBLISH', calName } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cadence//Scheduling//EN', 'CALSCALE:GREGORIAN', `METHOD:${method}`];
  if (calName) lines.push(`X-WR-CALNAME:${esc(calName)}`);
  for (const b of bookings) {
    const host = await db.prepare('SELECT name, email FROM users WHERE id=?').get(b.host_ids?.[0] || b.owner_id) || {};
    const et = b.event_type_id ? await db.prepare('SELECT name FROM event_types WHERE id=?').get(b.event_type_id) : (b.poll_id ? { name: (await db.prepare('SELECT title FROM polls WHERE id=?').get(b.poll_id))?.title } : null);
    const canceled = b.status !== 'active' && b.status !== 'pending_payment';
    lines.push('BEGIN:VEVENT', `UID:${b.uid}@cadence`, `DTSTAMP:${icsDate(new Date().toISOString())}`, `SEQUENCE:${canceled ? 1 : 0}`,
      `DTSTART:${icsDate(b.start_utc)}`, `DTEND:${icsDate(b.end_utc)}`,
      `SUMMARY:${esc(`${et?.name || 'Meeting'}: ${b.invitee_name} & ${host.name || ''}`)}`,
      `DESCRIPTION:${esc(`Location: ${locationText(b.location)}\nReschedule: ${BASE_URL()}/reschedule/${b.uid}\nCancel: ${BASE_URL()}/cancel/${b.uid}`)}`,
      `LOCATION:${esc(locationText(b.location))}`,
      `ORGANIZER;CN=${esc(host.name)}:mailto:${host.email || 'noreply@example.com'}`,
      `ATTENDEE;CN=${esc(b.invitee_name)};RSVP=TRUE:mailto:${b.invitee_email}`,
      `STATUS:${canceled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ---------------- templating ----------------
export async function bookingContext(b) {
  const poll = b.poll_id ? await db.prepare('SELECT title FROM polls WHERE id=?').get(b.poll_id) : null;
  const et = (b.event_type_id && mapEventType(await db.prepare('SELECT * FROM event_types WHERE id=?').get(b.event_type_id))) || { name: poll?.title || 'Meeting' };
  const host = await db.prepare('SELECT * FROM users WHERE id=?').get(b.host_ids?.[0] || b.owner_id) || {};
  const owner = await db.prepare('SELECT * FROM users WHERE id=?').get(b.owner_id) || host;
  const itz = b.invitee_tz || 'UTC';
  const fmt = (zone) => DateTime.fromISO(b.start_utc, { zone: 'utc' }).setZone(zone).toFormat("h:mma – cccc, LLLL d, yyyy").replace('AM', 'am').replace('PM', 'pm');
  return {
    event_name: et.name, host_name: host.name, host_email: host.email, invitee_name: b.invitee_name,
    invitee_first_name: String(b.invitee_name || '').split(' ')[0], invitee_email: b.invitee_email,
    event_time: fmt(itz), event_time_host: fmt(host.timezone || 'UTC'), invitee_timezone: itz, host_timezone: host.timezone,
    duration: `${b.duration} min`, location: locationText(b.location),
    reschedule_url: `${BASE_URL()}/reschedule/${b.uid}`, cancel_url: `${BASE_URL()}/cancel/${b.uid}`,
    booking_url: `${BASE_URL()}/booking/${b.uid}`, booking_page_url: `${BASE_URL()}/${owner.slug}`,
    cancel_reason: b.cancel_reason || '', answers: (b.answers || []).map((a) => `${a.label}: ${Array.isArray(a.value) ? a.value.join(', ') : a.value}`).join('\n'),
  };
}
export const render = (tpl, ctx) => String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => ctx[k] ?? '');

function wrapHtml(title, bodyText, brand = '#4f46e5', b) {
  const body = String(bodyText).split('\n').map((l) => l.trim() ? `<p style="margin:0 0 10px">${escHtml(l).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:' + brand + '">$1</a>')}</p>` : '<br/>').join('');
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
  <div style="background:${brand};color:#fff;padding:18px 24px;font-size:18px;font-weight:600">${escHtml(title)}</div>
  <div style="padding:22px 24px;color:#111827;font-size:14px;line-height:1.55">${body}</div>
  ${b ? `<div style="padding:0 24px 22px"><a href="${BASE_URL()}/reschedule/${b.uid}" style="color:${brand};margin-right:16px">Reschedule</a><a href="${BASE_URL()}/cancel/${b.uid}" style="color:${brand}">Cancel</a></div>` : ''}
  <div style="padding:12px 24px;background:#f9fafb;color:#6b7280;font-size:12px">Sent by Cadence scheduling</div></div>`;
}

export async function sendEmail({ userId, to, subject, html, kind, bookingUid, ics, icsMethod = 'REQUEST' }) {
  const info = await db.prepare('INSERT INTO outbox (user_id, to_email, subject, html, kind, booking_uid, error) VALUES (?,?,?,?,?,?,?)')
    .run(userId ?? null, to, subject, html, kind, bookingUid ?? null, emailEnabled() ? null : 'Email delivery is not configured');
  if (!emailEnabled()) return;
  try {
    if (config.email.resendKey) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${config.email.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM(), to: [to], subject, html,
          attachments: ics ? [{ filename: 'invite.ics', content: Buffer.from(ics).toString('base64'), content_type: `text/calendar; method=${icsMethod}` }] : undefined }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    } else {
      await mailer.sendMail({ from: FROM(), to, subject, html, icalEvent: ics ? { method: icsMethod, content: ics } : undefined });
    }
    await db.prepare('UPDATE outbox SET delivered=1 WHERE id=?').run(info.lastInsertRowid);
  } catch (e) {
    console.error('email failed', e.message);
    await db.prepare('UPDATE outbox SET error=? WHERE id=?').run(String(e.message).slice(0, 300), info.lastInsertRowid);
  }
}

// ---------------- built-in notifications ----------------
export async function notifyBooking(b, kind, extra = {}) {
  b = typeof b === 'string' ? mapBooking(await db.prepare('SELECT * FROM bookings WHERE uid=?').get(b)) : b;
  const ctx = await bookingContext(b);
  const owner = await db.prepare('SELECT * FROM users WHERE id=?').get(b.owner_id);
  const brand = owner?.brand_color || '#4f46e5';
  const hosts = (await Promise.all((b.host_ids.length ? b.host_ids : [b.owner_id]).map((id) => db.prepare('SELECT * FROM users WHERE id=?').get(id)))).filter(Boolean);
  const icsMethod = kind === 'canceled' ? 'CANCEL' : 'REQUEST';
  const ics = await bookingICS([b], { method: icsMethod });
  const synced = new Set((b.external_events || []).map((x) => x.user_id)); // hosts whose calendar already has the event
  const answers = ctx.answers ? `\nAnswers:\n${ctx.answers}` : '';
  const T = {
    created: {
      inv: [`Confirmed: ${ctx.event_name} with ${ctx.host_name}`, `Hi ${ctx.invitee_first_name},\n\nYour ${ctx.event_name} with ${ctx.host_name} is scheduled.\n\nWhen: ${ctx.event_time} (${ctx.invitee_timezone})\nDuration: ${ctx.duration}\nWhere: ${ctx.location}\n\nA calendar invitation is attached.`],
      host: [`New event: ${ctx.invitee_name} — ${ctx.event_name}`, `${ctx.invitee_name} (${ctx.invitee_email}) booked ${ctx.event_name}.\n\nWhen: ${ctx.event_time_host} (${ctx.host_timezone})\nWhere: ${ctx.location}${(b.guests || []).length ? `\nGuests: ${b.guests.join(', ')}` : ''}${answers}`],
    },
    canceled: {
      inv: [`Canceled: ${ctx.event_name} with ${ctx.host_name}`, `Hi ${ctx.invitee_first_name},\n\nYour ${ctx.event_name} at ${ctx.event_time} has been canceled${b.canceled_by === 'host' ? ` by ${ctx.host_name}` : ''}.${ctx.cancel_reason ? `\nReason: ${ctx.cancel_reason}` : ''}\n\nBook a new time: ${ctx.booking_page_url}`],
      host: [`Canceled: ${ctx.invitee_name} — ${ctx.event_name}`, `${ctx.event_name} with ${ctx.invitee_name} at ${ctx.event_time_host} was canceled by ${b.canceled_by === 'host' ? 'a host' : 'the invitee'}.${ctx.cancel_reason ? `\nReason: ${ctx.cancel_reason}` : ''}`],
    },
    rescheduled: {
      inv: [`Rescheduled: ${ctx.event_name} with ${ctx.host_name}`, `Hi ${ctx.invitee_first_name},\n\nYour ${ctx.event_name} has been rescheduled.\n\nFormer time: ${extra.formerTime || ''}\nNew time: ${ctx.event_time} (${ctx.invitee_timezone})\nWhere: ${ctx.location}`],
      host: [`Rescheduled: ${ctx.invitee_name} — ${ctx.event_name}`, `${ctx.invitee_name} rescheduled ${ctx.event_name}.\n\nFormer time: ${extra.formerTimeHost || ''}\nNew time: ${ctx.event_time_host} (${ctx.host_timezone})`],
    },
  }[kind];
  if (!T) return;
  const withLinks = kind !== 'canceled' ? b : null;
  const jobs = [sendEmail({ userId: b.owner_id, to: b.invitee_email, subject: T.inv[0], html: wrapHtml(T.inv[0], T.inv[1], brand, withLinks), kind: `invitee_${kind}`, bookingUid: b.uid, ics, icsMethod })];
  for (const g of b.guests || []) jobs.push(sendEmail({ userId: b.owner_id, to: g, subject: T.inv[0], html: wrapHtml(T.inv[0], T.inv[1], brand), kind: `guest_${kind}`, bookingUid: b.uid, ics, icsMethod }));
  for (const h of hosts) jobs.push(sendEmail({ userId: b.owner_id, to: h.email, subject: T.host[0], html: wrapHtml(T.host[0], T.host[1], brand), kind: `host_${kind}`, bookingUid: b.uid, ics: synced.has(h.id) ? null : ics, icsMethod }));
  await Promise.allSettled(jobs);
}

// ---------------- workflows ----------------
async function workflowsFor(b, triggers) {
  const userIds = [...new Set([b.owner_id, ...(b.host_ids || [])])];
  const out = [];
  for (const uidv of userIds) {
    for (const w of await db.prepare('SELECT * FROM workflows WHERE user_id=? AND active=1').all(uidv)) {
      const ids = J(w.event_type_ids, []);
      if (!triggers.includes(w.trigger)) continue;
      if (ids.length && !ids.includes(b.event_type_id)) continue;
      out.push(w);
    }
  }
  return out;
}
export async function scheduleWorkflows(b) {
  await db.prepare("DELETE FROM jobs WHERE booking_id=? AND status='pending'").run(b.id);
  for (const w of await workflowsFor(b, ['before_start', 'after_end', 'booked'])) {
    let at;
    if (w.trigger === 'booked') at = DateTime.utc().plus({ seconds: 2 });
    if (w.trigger === 'before_start') at = DateTime.fromISO(b.start_utc).minus({ minutes: w.offset_minutes });
    if (w.trigger === 'after_end') at = DateTime.fromISO(b.end_utc).plus({ minutes: w.offset_minutes });
    if (w.trigger !== 'booked' && at < DateTime.utc()) continue;
    await db.prepare('INSERT INTO jobs (run_at, workflow_id, booking_id) VALUES (?,?,?)').run(at.toUTC().toISO(), w.id, b.id);
  }
}
export async function cancelWorkflows(b) {
  await db.prepare("UPDATE jobs SET status='canceled' WHERE booking_id=? AND status='pending'").run(b.id);
  for (const w of await workflowsFor(b, ['canceled'])) await runWorkflow(w, b);
}
async function runWorkflow(w, b) {
  const ctx = await bookingContext(b);
  const owner = await db.prepare('SELECT brand_color FROM users WHERE id=?').get(b.owner_id);
  const subject = render(w.subject, ctx);
  const to = w.action === 'email_host' ? ctx.host_email : b.invitee_email;
  await sendEmail({ userId: b.owner_id, to, subject, html: wrapHtml(subject, render(w.body, ctx), owner?.brand_color, w.action === 'email_invitee' && b.status === 'active' ? b : null), kind: `workflow:${w.name}`, bookingUid: b.uid });
}
/** Run due workflow jobs. Claims rows atomically so concurrent ticks never double-send. */
export async function tickJobs(limit = 50) {
  const due = await db.prepare(`UPDATE jobs SET status='running', ran_at=now_iso() WHERE id IN (
      SELECT id FROM jobs WHERE status='pending' AND run_at <= ? ORDER BY run_at LIMIT ? FOR UPDATE SKIP LOCKED) RETURNING *`).all(new Date().toISOString(), limit);
  for (const j of due) {
    try {
      const w = await db.prepare('SELECT * FROM workflows WHERE id=?').get(j.workflow_id);
      const b = mapBooking(await db.prepare('SELECT * FROM bookings WHERE id=?').get(j.booking_id));
      if (w && b && b.status === 'active' && w.active) await runWorkflow(w, b);
      await db.prepare("UPDATE jobs SET status='done' WHERE id=?").run(j.id);
    } catch (e) {
      console.error('job failed', j.id, e.message);
      await db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(j.id);
    }
  }
  return due.length;
}

// ---------------- webhooks ----------------
export async function bookingPayload(b) {
  const et = b.event_type_id ? mapEventType(await db.prepare('SELECT * FROM event_types WHERE id=?').get(b.event_type_id)) : null;
  const hosts = (await Promise.all(b.host_ids.map((id) => db.prepare('SELECT id, name, email FROM users WHERE id=?').get(id)))).filter(Boolean);
  return {
    uid: b.uid, status: b.status, start_time: b.start_utc, end_time: b.end_utc, duration: b.duration,
    event_type: et ? { id: et.id, name: et.name, slug: et.slug, kind: et.kind } : null, hosts,
    invitee: { name: b.invitee_name, email: b.invitee_email, timezone: b.invitee_tz, guests: b.guests, answers: b.answers, no_show: b.no_show },
    location: b.location, cancel_reason: b.cancel_reason, canceled_by: b.canceled_by, rescheduled_from: b.rescheduled_from,
    rescheduled_to: b.rescheduled_to, reschedule_url: `${BASE_URL()}/reschedule/${b.uid}`, cancel_url: `${BASE_URL()}/cancel/${b.uid}`,
    created_at: b.created_at, source: b.source,
  };
}
export async function fireWebhook(userIds, event, payload) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const data = await payload; const tasks = [];
  for (const id of ids) {
    for (const w of await db.prepare('SELECT * FROM webhooks WHERE user_id=? AND active=1').all(id)) {
      if (!J(w.events, []).includes(event)) continue;
      tasks.push(deliver(w, event, data));
    }
  }
  await Promise.allSettled(tasks);
}
export async function deliver(w, event, payload) {
  const body = JSON.stringify({ event, created_at: new Date().toISOString(), payload });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', w.secret).update(`${t}.${body}`).digest('hex');
  let status = 0, response = '';
  try {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 8000);
    await assertPublicUrl(w.url);
    const r = await fetch(w.url, { method: 'POST', body, redirect: 'manual', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'User-Agent': 'Cadence-Webhooks/1.0', 'Cadence-Webhook-Signature': `t=${t},v1=${sig}` } });
    clearTimeout(timer);
    status = r.status; response = (await r.text()).slice(0, 500);
  } catch (e) { response = String(e.message).slice(0, 300); }
  await db.prepare('INSERT INTO webhook_deliveries (webhook_id, event, status, response, payload) VALUES (?,?,?,?,?)').run(w.id, event, status, response, body.slice(0, 20000));
  return { status, response };
}

