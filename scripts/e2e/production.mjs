// Browser E2E for the production build against a server started with the upstream mock preload.
// Google/Stripe hosted pages are intercepted with Playwright routes.
import { chromium } from 'playwright';
import fs from 'node:fs';
import pg from 'pg';
const B = 'http://localhost:3000';
const SHOTS = '/home/user/cadence/docs/screenshots';
const pc = new pg.Client({ connectionString: process.env.DATABASE_URL }); await pc.connect();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, timezoneId: 'Asia/Kolkata' });
const errs = [];
const stamp = Date.now();
const email = `priya${stamp}@example.com`;
// fake Google consent: when our server redirects to Google, bounce straight back to the callback
// (Playwright can't route requests that follow a redirect, so intercept our own start endpoints).
await ctx.route(/\/api\/auth\/(google|calendar\/google)(\?|$)/, async (route) => {
  const resp = await route.fetch({ maxRedirects: 0 });
  const loc = resp.headers().location || '';
  if (!loc.startsWith('https://accounts.google.com/')) return route.fulfill({ response: resp });
  const u = new URL(loc);
  const cal = (u.searchParams.get('scope') || '').includes('calendar');
  const code = `${cal ? 'cal' : 'login'}:${email}`;
  const headers = { ...resp.headers(), location: `${u.searchParams.get('redirect_uri')}?state=${u.searchParams.get('state')}&code=${encodeURIComponent(code)}` };
  route.fulfill({ status: 302, headers });
});
// fake Stripe Checkout: mark paid and return to success_url
await ctx.route('https://checkout.stripe.com/**', async (route) => {
  const id = route.request().url().split('/').pop();
  fs.writeFileSync(`/tmp/mock-paid-${id}`, '1');
  const row = (await pc.query('SELECT uid FROM bookings WHERE payment_ref=$1', [id])).rows[0];
  route.fulfill({ status: 302, headers: { location: `${B}/booking/${row.uid}?session_id=${id}` } });
});
const p = await ctx.newPage();
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && !/401|Failed to load resource/.test(m.text()) && errs.push(m.text()));
const shot = (n) => p.screenshot({ path: `${SHOTS}/prod-${n}.png` });
const step = (m) => console.log('•', m);

await p.goto(B, { waitUntil: 'networkidle' });
const landing = await p.textContent('body');
step(`landing has demo creds: ${/demo1234|demo@cadence/.test(landing)}`);
await shot('01-landing');
await p.goto(`${B}/login?error=${encodeURIComponent('Access was not granted.')}`, { waitUntil: 'networkidle' });
await shot('02-login');
await p.click('button:has-text("Continue with Google")');
await p.waitForURL('**/app/welcome**');
step(`after Google sign-in → ${new URL(p.url()).pathname}`);
await p.fill('.prefix-input input', `priya-${stamp}`);
await p.waitForTimeout(700);
await shot('03-welcome-1');
await p.click('button:has-text("Continue")');
await p.waitForURL('**step=2**');
await p.click('.connect-card:has-text("Google Calendar") button');
await p.waitForURL('**connected=google**');
await p.waitForSelector('.alert-success');
step(`calendar step: ${(await p.textContent('.alert-success')).trim()}`);
await shot('04-welcome-2');
await p.click('button:has-text("Continue")');
await p.waitForURL('**step=3**');
await p.click('.day-pill:has-text("Sat")'); await p.click('.day-pill:has-text("Sun")'); // 7 days
await p.fill('input[type=time] >> nth=0', '00:00'); await p.fill('input[type=time] >> nth=1', '23:59');
await shot('05-welcome-3');
await p.click('button:has-text("Finish setup")');
await p.waitForURL((u) => u.pathname === '/app');
await p.waitForTimeout(500);
await shot('06-event-types');
await p.goto(`${B}/app/integrations`, { waitUntil: 'networkidle' });
await p.waitForSelector('.cal-group');
await shot('07-integrations');
await p.goto(`${B}/app/team`, { waitUntil: 'networkidle' });
await p.click('button:has-text("Invite member")');
await p.fill('.modal input[type=email]', `teammate${stamp}@example.com`);
await p.click('.modal button:has-text("Send invite")');
await p.waitForSelector('text=Pending invitations');
await shot('08-team');
await p.goto(`${B}/app/settings`, { waitUntil: 'networkidle' });
await shot('09-settings');

// public booking (with Meet link from the connected Google Calendar)
const slug = `priya-${stamp}`;
await pc.query(`UPDATE event_types SET settings = (settings::jsonb || '{"min_notice_minutes":0}')::text WHERE user_id=(SELECT id FROM users WHERE email=$1)`, [email]);
const book = await ctx.newPage(); book.on('pageerror', (e) => errs.push(e.message));
await book.goto(`${B}/${slug}/30min`, { waitUntil: 'networkidle' });
await book.click('.cal-day.available >> nth=1').catch(() => {});
await book.waitForTimeout(600);
await book.click('.time-btn >> nth=2'); await book.click('.time-next');
await book.fill('input >> nth=0', 'Rahul Invitee'); await book.fill('input[type=email]', 'rahul@example.com');
await book.screenshot({ path: `${SHOTS}/prod-10-booking-form.png` });
await book.click('button[type=submit]'); await book.waitForURL('**/booking/**'); await book.waitForTimeout(600);
const conf = await book.textContent('body');
step(`confirmation shows Meet link: ${/meet\.google\.com/.test(conf)}`);
await book.screenshot({ path: `${SHOTS}/prod-11-confirmation.png` });

// paid event via Stripe Checkout
await pc.query(`UPDATE event_types SET settings = (settings::jsonb || '{"price_cents":1500,"currency":"INR"}')::text, locations='[{"type":"jitsi"}]' WHERE user_id=(SELECT id FROM users WHERE email=$1)`, [email]);
await book.goto(`${B}/${slug}/30min`, { waitUntil: 'networkidle' });
await book.click('.cal-day.available >> nth=2').catch(() => {});
await book.waitForTimeout(600);
await book.click('.time-btn >> nth=4'); await book.click('.time-next');
await book.fill('input >> nth=0', 'Meera Payer'); await book.fill('input[type=email]', 'meera@example.com');
await book.screenshot({ path: `${SHOTS}/prod-12-paid-form.png` });
await book.click('button:has-text("Continue to payment")');
await book.waitForURL('**session_id=**'); await book.waitForSelector('text=Paid', { timeout: 15000 });
step(`paid booking confirmed: ${/Paid/.test(await book.textContent('body'))}`);
await book.screenshot({ path: `${SHOTS}/prod-13-paid-confirmation.png` });

await p.goto(`${B}/app/scheduled`, { waitUntil: 'networkidle' });
await p.waitForTimeout(500);
await shot('14-scheduled');
await p.goto(`${B}/app/outbox`, { waitUntil: 'networkidle' });
await shot('15-email-log');
// logout
await p.click('button:has-text("Log out")'); await p.waitForURL(B + '/');
const me = await p.evaluate(() => fetch('/api/me').then((r) => r.status));
step(`after logout /api/me → ${me}`);
console.log('errors:', JSON.stringify(errs));
await b.close(); await pc.end();
