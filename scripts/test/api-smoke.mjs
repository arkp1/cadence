// End-to-end API smoke test against a running server with DEV_LOGIN=1 (local only).
const B = process.env.BASE || 'http://localhost:3000';
const jar = {};
async function call(who, method, path, body, extra = {}) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', origin: B, cookie: jar[who] || '', ...extra }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
let fails = 0;
const ok = (cond, msg, extra) => { console.log(`${cond ? '✓' : '✗'} ${msg}`, cond ? '' : JSON.stringify(extra)?.slice(0, 400)); if (!cond) fails++; };

const stamp = Date.now();
const cfg = await call('anon', 'GET', '/api/public/config');
const payments = cfg.body.features.payments;
const hostEmail = `host${stamp}@example.com`;
await call('host', 'POST', '/api/auth/dev-login', { email: hostEmail, name: 'Hana Host', timezone: 'Asia/Kolkata' });
let me = await call('host', 'GET', '/api/me');
ok(me.status === 200 && me.body.user.onboarded === false, 'new user not onboarded');
const slug = `hana-${stamp}`;
let r = await call('host', 'PATCH', '/api/me', { slug, onboarded: true, timezone: 'Asia/Kolkata' });
ok(r.status === 200 && r.body.user.slug === slug && r.body.user.onboarded, 'onboarding PATCH', r.body);
r = await call('host', 'PATCH', '/api/me', { brand_color: 'red;}' });
ok(r.status === 400, 'rejects bad colour');
// 24/7 availability so the test is time-independent
const sch = await call('host', 'GET', '/api/schedules');
const all = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ start: '00:00', end: '24:00' }]]));
r = await call('host', 'PATCH', `/api/schedules/${sch.body.default_schedule_id}`, { rules: all });
ok(r.status === 200, 'schedule updated');
const ets = await call('host', 'GET', '/api/event-types');
const et = ets.body.event_types[0];
if (!payments) {
  r = await call('host', 'PATCH', `/api/event-types/${et.id}`, { settings: { price_cents: 5000 } });
  ok(r.status === 200 && r.body.event_type.settings.price_cents === 0, 'price forced to 0 without Stripe', r.body.event_type?.settings);
}
r = await call('host', 'PATCH', `/api/event-types/${et.id}`, { settings: { min_notice_minutes: 0, price_cents: 0 }, locations: [{ type: 'jitsi' }] });
ok(r.status === 200, 'event type updated');

// public pages
const prof = await call('anon', 'GET', `/api/public/profile/${slug}`);
ok(prof.status === 200 && prof.body.event_types.length === 1, 'public profile');
const start = new Date(Date.now() + 2 * 86400000); start.setUTCHours(0, 0, 0, 0);
const end = new Date(start.getTime() + 86400000);
const sl = await call('anon', 'GET', `/api/public/slots/${et.id}?start=${start.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}&tz=UTC`);
const days = sl.body.days || {}; const firstDay = Object.keys(days).find((d) => days[d].length);
ok(sl.status === 200 && firstDay, 'slots returned', sl.body);
const slot = days[firstDay][0].start || days[firstDay][0];

// race: 5 concurrent bookings for the same slot → exactly one wins
const attempts = await Promise.all([0, 1, 2, 3, 4].map((i) => call(`inv${i}`, 'POST', '/api/public/bookings', { event_type_id: et.id, start: slot, timezone: 'Europe/London', name: `Invitee ${i}`, email: `inv${i}@example.com` })));
const wins = attempts.filter((a) => a.status === 201);
ok(wins.length === 1 && attempts.filter((a) => a.status === 409).length === 4, `concurrency: 1 winner, 4 conflicts (got ${attempts.map((a) => a.status)})`, attempts.map((a) => a.body));
const booking = wins[0]?.body.booking;
ok(booking?.location?.value?.startsWith('https://meet.jit.si/'), 'jitsi link generated');

// idempotency
const rid = `req-${stamp}`;
const slot2 = days[firstDay][1].start || days[firstDay][1];
const i1 = await call('anon', 'POST', '/api/public/bookings', { event_type_id: et.id, start: slot2, timezone: 'UTC', name: 'Idem', email: 'idem@example.com' }, { 'Booking-Request-ID': rid });
const i2 = await call('anon', 'POST', '/api/public/bookings', { event_type_id: et.id, start: slot2, timezone: 'UTC', name: 'Idem', email: 'idem@example.com' }, { 'Booking-Request-ID': rid });
ok(i1.status === 201 && i2.status === 201 && i1.body.booking.uid === i2.body.booking.uid, 'idempotent booking request');

// reschedule
const slot3 = days[firstDay][3].start || days[firstDay][3];
const rs = await call('anon', 'POST', '/api/public/bookings', { event_type_id: et.id, start: slot3, timezone: 'UTC', name: 'Invitee', email: 'x@example.com', reschedule_uid: booking.uid });
ok(rs.status === 201 && rs.body.booking.rescheduled_from === booking.uid, 'reschedule', rs.body);
const old = await call('anon', 'GET', `/api/public/bookings/${booking.uid}`);
ok(old.body.booking.status === 'rescheduled', 'old booking marked rescheduled');

// cancel by invitee
const cx = await call('anon', 'POST', `/api/public/bookings/${i1.body.booking.uid}/cancel`, { reason: 'conflict' });
ok(cx.status === 200 && cx.body.booking.status === 'canceled', 'invitee cancel');
const cx2 = await call('anon', 'POST', `/api/public/bookings/${i1.body.booking.uid}/cancel`, {});
ok(cx2.status === 400, 'double cancel rejected');

// ICS
const ics = await fetch(`${B}/api/public/bookings/${rs.body.booking.uid}/ics`).then((x) => x.text());
ok(ics.includes('BEGIN:VEVENT') && ics.includes('STATUS:CONFIRMED'), 'ICS download');

// dashboard
await new Promise((res) => setTimeout(res, 800));
const up = await call('host', 'GET', '/api/bookings?status=upcoming');
ok(up.status === 200 && up.body.bookings.length === 1, `upcoming bookings (${up.body.bookings?.length})`);
const search = await call('host', 'GET', '/api/bookings?status=canceled&q=IDEM');
ok(search.body.bookings?.length === 1, 'case-insensitive search (ILIKE)');
const detail = await call('host', 'GET', `/api/bookings/${rs.body.booking.uid}`);
ok(detail.status === 200 && Array.isArray(detail.body.booking.emails), 'booking detail', detail.body);
const outbox = await call('host', 'GET', '/api/outbox');
ok(outbox.body.emails?.length > 0 && outbox.body.emails.every((e) => e.error === 'Email delivery is not configured'), `outbox logged (${outbox.body.emails?.length}) w/o email provider`);
const csv = await fetch(`${B}/api/bookings.csv?status=canceled`, { headers: { cookie: jar.host } }).then((x) => x.text());
ok(csv.split('\n').length >= 2 && csv.startsWith('"Event Type"'), 'CSV export');
const contacts = await call('host', 'GET', '/api/contacts');
ok(contacts.status === 200 && contacts.body.contacts.length >= 2, 'contacts', contacts.body);
const an = await call('host', 'GET', '/api/analytics?days=30');
ok(an.status === 200 && an.body.totals.created >= 3, 'analytics', an.body.totals);
const other = await call('anon2', 'POST', '/api/auth/dev-login', { email: `other${stamp}@example.com` });
const leak = await call('anon2', 'GET', `/api/bookings/${rs.body.booking.uid}`);
ok(leak.status === 404, 'other users cannot read bookings');
const csrf = await call('host', 'PATCH', '/api/me', { name: 'Evil' }, { origin: 'https://evil.example' });
ok(csrf.status === 403, 'cross-origin mutation blocked');

// workflows: reminder job scheduled for the upcoming booking
const wf = await call('host', 'GET', '/api/workflows');
ok(wf.body.workflows.length === 2, 'default workflows');

// polls
const p = await call('host', 'POST', '/api/polls', { title: 'Planning', duration: 30, location: { type: 'jitsi' }, options: [{ start: new Date(Date.now() + 5 * 86400000).toISOString() }, { start: new Date(Date.now() + 6 * 86400000).toISOString() }] });
ok(p.status === 201, 'poll created', p.body);
const tok = p.body.poll.token; const opt = p.body.poll.options[0].id;
const v = await call('anon', 'POST', `/api/public/polls/${tok}/vote`, { name: 'Voter <b>', email: 'voter@example.com', choices: [opt] });
ok(v.status === 200 && v.body.poll.votes.length === 1, 'poll vote');
const pb = await call('host', 'POST', `/api/polls/${p.body.poll.id}/book`, { option_id: opt });
ok(pb.status === 200 && pb.body.booking_uid, 'poll booked', pb.body);
const pb2 = await call('host', 'POST', `/api/polls/${p.body.poll.id}/book`, { option_id: opt });
ok(pb2.status === 400, 'poll double-book rejected');

// routing form
const f = await call('host', 'POST', '/api/routing-forms', { name: 'Intake' });
const fq = f.body.form.questions;
await call('host', 'PATCH', `/api/routing-forms/${f.body.form.id}`, { rules: [{ name: 'all', match: 'all', conditions: [{ question_id: fq[1].id, op: 'contains', value: '@' }], action: { type: 'event_type', event_type_id: et.id } }] });
const fs = await call('anon', 'POST', `/api/public/forms/${f.body.form.token}/submit`, { answers: [{ id: fq[0].id, value: 'Ann' }, { id: fq[1].id, value: 'ann@example.com' }] });
ok(fs.status === 200 && fs.body.result.target === `/${slug}/${et.slug}`, 'routing form routes', fs.body);

// team invites
const invEmail = `member${stamp}@example.com`;
const inv = await call('host', 'POST', '/api/team/invites', { email: invEmail, role: 'member' });
ok(inv.status === 201, 'invite created', inv.body);
await call('mem', 'POST', '/api/auth/dev-login', { email: invEmail });
const mm = await call('mem', 'GET', '/api/me');
ok(mm.body.org.id === me.body.org.id && mm.body.user.role === 'member', 'invitee joined the org on first sign-in', mm.body.org);
const memId = mm.body.user.id;
const rr = await call('host', 'POST', '/api/event-types', { name: 'Team RR', kind: 'round_robin', hosts: [me.body.user.id, memId, 99999] });
ok(rr.status === 201 && rr.body.event_type.hosts.length === 2, 'round robin hosts filtered to org', rr.body.event_type?.hosts);
const del1 = await call('host', 'DELETE', '/api/me', { confirm: hostEmail });
ok(del1.status === 400, 'owner with members cannot delete account');
const rm = await call('host', 'DELETE', `/api/team/members/${memId}`);
ok(rm.status === 200, 'member removed');
const mm2 = await call('mem', 'GET', '/api/me');
ok(mm2.body.org.id !== me.body.org.id && mm2.body.user.role === 'owner', 'removed member gets own workspace');

// cron
const t401 = await call('anon', 'POST', '/api/cron/tick');
ok(t401.status === 401, 'cron requires secret');
const t = await call('anon', 'POST', '/api/cron/tick', null, { authorization: 'Bearer testcron' });
ok(t.status === 200 && t.body.ok, 'cron tick', t.body);

// feed
const feed = await fetch(`${B}${me.body.user.feed_path}`).then((x) => x.text());
ok(feed.includes('BEGIN:VCALENDAR') && feed.includes('BEGIN:VEVENT'), 'calendar feed');

// account deletion
const d2 = await call('mem', 'DELETE', '/api/me', { confirm: invEmail });
ok(d2.status === 200, 'account deleted');
const after = await call('mem', 'GET', '/api/me');
ok(after.status === 401, 'session gone after deletion');

const lo = await call('host', 'POST', '/api/auth/logout');
const meAfter = await call('host', 'GET', '/api/me');
ok(lo.status === 200 && meAfter.status === 401, 'logout');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
