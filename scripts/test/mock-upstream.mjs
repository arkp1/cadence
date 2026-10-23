// Test-only preload: intercepts fetch() to Google / Microsoft / Stripe and answers with fakes.
// Usage: node --import ./scripts/test/mock-upstream.mjs server/index.js   (never in production)
const realFetch = globalThis.fetch;
const log = (globalThis.__mockLog = []);
const state = { events: new Map(), n: 0, refreshes: 0 };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const day = (d, h) => { const x = new Date(); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() + d); x.setUTCHours(h); return x.toISOString(); };

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? String(init.body) : '';
  const host = url.hostname;
  if (!/googleapis\.com|microsoftonline\.com|graph\.microsoft\.com|api\.stripe\.com/.test(host)) return realFetch(input, init);
  log.push({ method, url: url.toString(), body });
  const p = url.pathname;
  // ---- Google ----
  if (host === 'oauth2.googleapis.com' && p === '/token') {
    const f = new URLSearchParams(body);
    if (f.get('grant_type') === 'refresh_token') { state.refreshes++; return json({ access_token: `g-at-refreshed-${state.refreshes}`, expires_in: 3600 }); }
    const code = f.get('code') || '';
    const scope = code.startsWith('cal:') ? 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly' : 'openid email profile';
    return json({ access_token: `g-at-${code}`, refresh_token: code.startsWith('cal:') ? 'g-rt-1' : undefined, expires_in: code.includes('expired') ? 1 : 3600, scope, id_token: 'x' });
  }
  if (host === 'openidconnect.googleapis.com' && p === '/v1/userinfo') {
    const tok = (init.headers?.Authorization || '').replace('Bearer g-at-', '');
    const email = tok.split(':')[1] || 'someone@example.com';
    return json({ sub: `sub-${email}`, email, email_verified: !email.startsWith('unverified'), name: email.split('@')[0], picture: 'https://example.com/a.png' });
  }
  if (host === 'www.googleapis.com' && p === '/calendar/v3/users/me/calendarList') {
    return json({ items: [{ id: 'primary@example.com', summary: 'Work', primary: true, accessRole: 'owner', backgroundColor: '#0b8043' },
      { id: 'holidays@group', summary: 'Holidays', accessRole: 'reader' }] });
  }
  if (host === 'www.googleapis.com' && p === '/calendar/v3/freeBusy') {
    const req = JSON.parse(body);
    const inWin = (b) => b.start < req.timeMax && b.end > req.timeMin;
    return json({ calendars: Object.fromEntries(req.items.map((i) => [i.id, { busy: i.id === 'primary@example.com' ? [{ start: day(3, 9), end: day(3, 11) }].filter(inWin) : [] }])) });
  }
  let m;
  if (host === 'www.googleapis.com' && (m = p.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/)) && method === 'POST') {
    const ev = JSON.parse(body); const id = `gev${++state.n}`; state.events.set(id, { ...ev, sendUpdates: url.searchParams.get('sendUpdates') });
    return json({ id, hangoutLink: ev.conferenceData ? `https://meet.google.com/mock-${state.n}` : undefined });
  }
  if (host === 'www.googleapis.com' && (m = p.match(/\/events\/([^/]+)$/)) && method === 'DELETE') { state.events.delete(decodeURIComponent(m[1])); return new Response(null, { status: 204 }); }
  // ---- Microsoft ----
  if (host === 'login.microsoftonline.com' && p.endsWith('/oauth2/v2.0/token')) return json({ access_token: 'ms-at', refresh_token: 'ms-rt', expires_in: 3600, scope: 'Calendars.ReadWrite' });
  if (host === 'graph.microsoft.com' && p === '/v1.0/me') return json({ mail: null, userPrincipalName: 'Outlook.User@contoso.com' });
  if (host === 'graph.microsoft.com' && p === '/v1.0/me/calendars') return json({ value: [{ id: 'mscal1', name: 'Calendar', canEdit: true, isDefaultCalendar: true }] });
  if (host === 'graph.microsoft.com' && p.endsWith('/calendarView')) {
    return json({ value: [{ start: { dateTime: `${day(4, 14).slice(0, 19)}.0000000` }, end: { dateTime: `${day(4, 15).slice(0, 19)}.0000000` }, showAs: 'busy' },
      { start: { dateTime: `${day(4, 16).slice(0, 19)}.0000000` }, end: { dateTime: `${day(4, 17).slice(0, 19)}.0000000` }, showAs: 'free' }] });
  }
  if (host === 'graph.microsoft.com' && p.endsWith('/events') && method === 'POST') {
    const ev = JSON.parse(body); const id = `msev${++state.n}`; state.events.set(id, ev);
    return json({ id, onlineMeeting: ev.isOnlineMeeting ? { joinUrl: `https://teams.microsoft.com/l/meetup-join/mock-${state.n}` } : null });
  }
  if (host === 'graph.microsoft.com' && (m = p.match(/\/me\/events\/(.+)$/)) && method === 'DELETE') { state.events.delete(decodeURIComponent(m[1])); return new Response(null, { status: 204 }); }
  // ---- Stripe ----
  if (host === 'api.stripe.com' && p === '/v1/checkout/sessions' && method === 'POST') {
    const f = new URLSearchParams(body); const id = `cs_test_${Date.now()}_${++state.n}`;
    state.events.set(id, { uid: f.get('metadata[booking_uid]'), amount: f.get('line_items[0][price_data][unit_amount]'), currency: f.get('line_items[0][price_data][currency]'), success: f.get('success_url') });
    return json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
  }
  if (host === 'api.stripe.com' && (m = p.match(/^\/v1\/checkout\/sessions\/(.+)$/))) {
    const s = state.events.get(decodeURIComponent(m[1]));
    const fs = await import('node:fs'); const paid = fs.existsSync(`/tmp/mock-paid-${m[1]}`);
    return json({ id: m[1], payment_status: paid ? 'paid' : 'unpaid', payment_intent: 'pi_mock_1', metadata: { booking_uid: s?.uid } });
  }
  return json({ error: { message: `mock: unhandled ${method} ${url}` } }, 404);
};
// test hooks
globalThis.__mock = { state, log, markPaid: (id) => { const s = state.events.get(id); if (s) s.paid = true; } };
