// Integration test for OAuth sign-in, Google/Outlook calendar connect + sync + event writes, Stripe checkout.
// Run the server with: node --import ./scripts/test/mock-upstream.mjs server/index.js  (+ test env vars)
import crypto from 'node:crypto';
import fs from 'node:fs';
const B = process.env.BASE || 'http://localhost:3000';
const jars = {};
function store(who, res) {
  const j = (jars[who] ||= {});
  for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (!v || /Expires=Thu, 01 Jan 1970/i.test(c)) delete j[k]; else j[k] = v; }
}
const cookie = (who) => Object.entries(jars[who] || {}).map(([k, v]) => `${k}=${v}`).join('; ');
async function call(who, method, path, body, extra = {}) {
  const r = await fetch(B + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', origin: B, cookie: cookie(who), ...extra }, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  store(who, r);
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j, location: r.headers.get('location') };
}
let fails = 0;
const ok = (c, m, x) => { console.log(`${c ? '✓' : '✗'} ${m}`, c ? '' : JSON.stringify(x)?.slice(0, 500)); if (!c) fails++; };
const stamp = Date.now();

// ---- Google sign-in (OAuth round trip) ----
async function googleLogin(who, email, next = '') {
  const s = await call(who, 'GET', `/api/auth/google?tz=Asia/Kolkata${next ? `&next=${encodeURIComponent(next)}` : ''}`);
  const state = new URL(s.location).searchParams.get('state');
  return call(who, 'GET', `/api/auth/google/callback?state=${state}&code=${encodeURIComponent(`login:${email}`)}`);
}
const email = `gina${stamp}@example.com`;
let r = await googleLogin('g', email);
ok(r.status === 302 && r.location === '/app/welcome', 'new Google user → /app/welcome', r);
let me = await call('g', 'GET', '/api/me');
ok(me.status === 200 && me.body.user.email === email && me.body.user.timezone === 'Asia/Kolkata' && me.body.user.avatar_url, 'session + profile from Google', me.body.user);
await call('g', 'PATCH', '/api/me', { onboarded: true });
r = await googleLogin('g2', email, '/app/scheduled');
ok(r.location === '/app/scheduled', 'returning user honours ?next', r.location);
r = await call('x', 'GET', `/api/auth/google/callback?state=forged&code=login:${email}`);
ok(r.status === 302 && r.location.startsWith('/login?error='), 'forged state rejected', r.location);
r = await googleLogin('u', `unverified${stamp}@example.com`);
ok(r.location.includes('error=') && r.location.includes('verified'), 'unverified email rejected', r.location);
r = await call('x', 'GET', '/api/auth/google?next=//evil.com');
const st = new URL(r.location).searchParams.get('state');
r = await call('x', 'GET', `/api/auth/google/callback?state=${st}&code=login:open${stamp}@example.com`);
ok(r.location === '/app/welcome', 'open-redirect next ignored', r.location);

// ---- connect Google Calendar ----
r = await call('g', 'GET', '/api/auth/calendar/google');
const cs = new URL(r.location);
ok(cs.searchParams.get('access_type') === 'offline' && cs.searchParams.get('scope').includes('calendar.events') && cs.searchParams.get('login_hint') === email, 'calendar consent URL', r.location);
r = await call('g', 'GET', `/api/auth/google/callback?state=${cs.searchParams.get('state')}&code=${encodeURIComponent(`cal:${email}`)}`);
ok(r.location === '/app/integrations?connected=google', 'calendar connected redirect', r);
let cals = await call('g', 'GET', '/api/calendars');
const work = cals.body.calendars.find((c) => c.name === 'Work');
ok(cals.body.accounts.length === 1 && cals.body.calendars.length === 2 && work.check_conflicts && work.can_write && !cals.body.calendars.find((c) => c.name === 'Holidays').can_write, 'calendar list imported', cals.body);
ok(cals.body.write_calendar_id === work.id, 'primary calendar set as write target');
ok(work.busy_count === 1, 'free/busy synced', work);
// tokens stored encrypted
const { default: pg } = await import('pg');
const pc = new pg.Client({ connectionString: process.env.DATABASE_URL }); await pc.connect();
const acct = (await pc.query('SELECT access_token, refresh_token FROM calendar_accounts WHERE email=$1', [email])).rows[0];
ok(acct.access_token.startsWith('v1.') && !acct.access_token.includes('g-at') && acct.refresh_token.startsWith('v1.'), 'OAuth tokens encrypted at rest', acct);

// ---- availability respects Google busy time, booking writes event + Meet link ----
const all = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ start: '00:00', end: '24:00' }]]));
const sch = await call('g', 'GET', '/api/schedules');
await call('g', 'PATCH', `/api/schedules/${sch.body.default_schedule_id}`, { rules: all, timezone: 'UTC' });
const ets = await call('g', 'GET', '/api/event-types');
const et = ets.body.event_types[0];
await call('g', 'PATCH', `/api/event-types/${et.id}`, { settings: { min_notice_minutes: 0 } });
const d3 = new Date(); d3.setUTCHours(0, 0, 0, 0); d3.setUTCDate(d3.getUTCDate() + 3);
const dayStr = d3.toISOString().slice(0, 10);
const sl = await call('anon', 'GET', `/api/public/slots/${et.id}?start=${dayStr}&end=${dayStr}&tz=UTC`);
const times = (sl.body.days[dayStr] || []).map((x) => (x.start || x).slice(11, 16));
ok(times.length && !times.includes('09:00') && !times.includes('10:30') && times.includes('11:00') && times.includes('08:30'), 'Google busy 09:00–11:00 blocked', times);
const slotIso = `${dayStr}T13:00:00.000Z`;
r = await call('anon', 'POST', '/api/public/bookings', { event_type_id: et.id, start: slotIso, timezone: 'UTC', name: 'Ivan Invitee', email: 'ivan@example.com' });
ok(r.status === 201 && r.body.booking.location.type === 'google_meet' && r.body.booking.location.value?.startsWith('https://meet.google.com/mock-'), 'Meet link created via Google Calendar', r.body);
const uid1 = r.body.booking.uid;
r = await call('anon', 'POST', '/api/public/bookings', { event_type_id: et.id, start: `${dayStr}T09:30:00.000Z`, timezone: 'UTC', name: 'X', email: 'x@example.com' });
ok(r.status === 409 && r.body.code === 'CALENDAR', 'booking into Google busy time rejected', r.body);
const det = await call('g', 'GET', `/api/bookings/${uid1}`);
ok(det.body.booking.external_events?.[0]?.provider === 'google', 'booking linked to Google event', det.body.booking.external_events);
// reschedule → old event deleted, new created (Meet link regenerated)
r = await call('anon', 'POST', '/api/public/bookings', { event_type_id: et.id, start: `${dayStr}T15:00:00.000Z`, timezone: 'UTC', name: 'Ivan Invitee', email: 'ivan@example.com', reschedule_uid: uid1 });
ok(r.status === 201 && r.body.booking.location.value?.startsWith('https://meet.google.com/mock-') && r.body.booking.location.value !== det.body.booking.location.value, 'reschedule recreates event + new Meet link', r.body.booking?.location);
const uid2 = r.body.booking.uid;
r = await call('g', 'POST', `/api/bookings/${uid2}/cancel`, { reason: 'sick' });
ok(r.status === 200 && r.body.booking.status === 'canceled', 'host cancel');

// ---- Outlook ----
r = await call('g', 'GET', '/api/auth/calendar/microsoft');
const ms = new URL(r.location);
ok(ms.hostname === 'login.microsoftonline.com' && ms.searchParams.get('scope').includes('Calendars.ReadWrite'), 'Microsoft consent URL', r.location);
r = await call('g', 'GET', `/api/auth/microsoft/callback?state=${ms.searchParams.get('state')}&code=abc`);
ok(r.location === '/app/integrations?connected=microsoft', 'Outlook connected', r);
cals = await call('g', 'GET', '/api/calendars');
const outlook = cals.body.calendars.find((c) => c.provider === 'microsoft');
ok(cals.body.accounts.some((a) => a.email === 'outlook.user@contoso.com') && outlook?.busy_count === 1, 'Outlook calendars + busy (free events ignored)', cals.body);
r = await call('g', 'PUT', '/api/calendars/write-target', { calendar_id: outlook.id });
ok(r.status === 200, 'write target → Outlook');
await call('g', 'PATCH', `/api/event-types/${et.id}`, { locations: [{ type: 'teams' }] });
r = await call('anon', 'POST', '/api/public/bookings', { event_type_id: et.id, start: `${dayStr}T17:00:00.000Z`, timezone: 'UTC', name: 'Tia', email: 'tia@example.com' });
ok(r.status === 201 && r.body.booking.location.value?.startsWith('https://teams.microsoft.com/'), 'Teams link created via Outlook', r.body.booking?.location);
r = await call('g', 'PUT', '/api/calendars/write-target', { calendar_id: cals.body.calendars.find((c) => c.name === 'Holidays').id });
ok(r.status === 400, 'read-only calendar cannot be write target');
r = await call('g', 'DELETE', `/api/calendar-accounts/${cals.body.accounts.find((a) => a.provider === 'microsoft').id}`);
cals = await call('g', 'GET', '/api/calendars');
ok(r.status === 200 && !cals.body.calendars.some((c) => c.provider === 'microsoft') && cals.body.write_calendar_id === null, 'disconnect Outlook clears its calendars + write target', cals.body);

// ---- Stripe checkout ----
const pe = await call('g', 'PATCH', `/api/event-types/${et.id}`, { settings: { price_cents: 2500, currency: 'usd' }, locations: [{ type: 'jitsi' }] });
ok(pe.body.event_type.settings.price_cents === 2500 && pe.body.event_type.settings.currency === 'USD', 'price saved when Stripe configured');
const pub = await call('anon', 'GET', `/api/public/event/${me.body.user.slug}/${et.slug}`);
ok(pub.body.event.settings.price_cents === 2500, 'public page shows price');
r = await call('anon', 'POST', '/api/public/bookings', { event_type_id: et.id, start: `${dayStr}T19:00:00.000Z`, timezone: 'UTC', name: 'Paula Payer', email: 'paula@example.com' });
ok(r.status === 201 && r.body.checkout_url?.startsWith('https://checkout.stripe.com/') && r.body.booking.status === 'pending_payment', 'checkout session created', r.body);
const puid = r.body.booking.uid; const sid = r.body.checkout_url.split('/').pop();
r = await call('anon', 'POST', '/api/public/bookings', { event_type_id: et.id, start: `${dayStr}T19:00:00.000Z`, timezone: 'UTC', name: 'Other', email: 'o@example.com' });
ok(r.status === 409, 'payment hold blocks the slot');
r = await call('anon', 'GET', `/api/public/bookings/${puid}?session_id=${sid}`);
ok(r.body.booking.status === 'pending_payment', 'unpaid session stays pending');
fs.writeFileSync(`/tmp/mock-paid-${sid}`, '1');
r = await call('anon', 'GET', `/api/public/bookings/${puid}?session_id=${sid}`);
ok(r.body.booking.status === 'active' && r.body.booking.payment_status === 'paid', 'paid on return from Checkout', r.body.booking);
// webhook path (second paid booking)
r = await call('anon', 'POST', '/api/public/bookings', { event_type_id: et.id, start: `${dayStr}T20:00:00.000Z`, timezone: 'UTC', name: 'Webhook Will', email: 'will@example.com' });
const wuid = r.body.booking.uid;
const evt = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_x', payment_status: 'paid', payment_intent: 'pi_w', metadata: { booking_uid: wuid } } } });
const t = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${evt}`).digest('hex');
r = await call('anon', 'POST', '/api/stripe/webhook', evt, { 'stripe-signature': `t=${t},v1=${sig}` });
ok(r.status === 200, 'webhook accepted', r.body);
r = await call('anon', 'POST', '/api/stripe/webhook', evt, { 'stripe-signature': `t=${t},v1=${'0'.repeat(64)}` });
ok(r.status === 400, 'bad webhook signature rejected');
r = await call('anon', 'GET', `/api/public/bookings/${wuid}`);
ok(r.body.booking.status === 'active' && r.body.booking.payment_status === 'paid', 'paid via webhook');
// expired hold
r = await call('anon', 'POST', '/api/public/bookings', { event_type_id: et.id, start: `${dayStr}T21:00:00.000Z`, timezone: 'UTC', name: 'Late', email: 'late@example.com' });
await pc.query("UPDATE bookings SET hold_expires_at='2000-01-01T00:00:00.000Z' WHERE uid=$1", [r.body.booking.uid]);
r = await call('anon', 'POST', '/api/public/bookings', { event_type_id: et.id, start: `${dayStr}T21:00:00.000Z`, timezone: 'UTC', name: 'Next', email: 'next@example.com' });
ok(r.status === 201, 'expired hold frees the slot');
await pc.end();

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
