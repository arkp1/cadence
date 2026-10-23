// OAuth: "Sign in with Google" + connecting Google Calendar / Microsoft Outlook calendars.
// Redirect URIs to register with the providers:
//   {PUBLIC_URL}/api/auth/google/callback
//   {PUBLIC_URL}/api/auth/microsoft/callback
import express from 'express';
import { DateTime } from 'luxon';
import { db, createUser, uid } from './db.js';
import { config, baseUrl, features } from './config.js';
import { sign, verify, rateLimit } from './security.js';
import { requireUser, startSession, endSession } from './auth.js';
import { exchangeCode, saveAccount, http, GOOGLE_CAL_SCOPES, MS_SCOPES } from './calendars.js';

export const oauth = express.Router();
const STATE_COOKIE = 'cadence_oauth';
const validTz = (tz) => { try { return !!tz && DateTime.local().setZone(tz).isValid; } catch { return false; } };
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n.slice(0, 300) : null);

/** Make sure the whole OAuth round-trip happens on the canonical host (cookie + redirect_uri must match). */
function canonical(req, res) {
  if (!config.publicUrl) return false;
  const want = new URL(config.publicUrl).host;
  const have = req.get('x-forwarded-host') || req.get('host');
  if (have && have !== want) { res.redirect(302, `${config.publicUrl}${req.originalUrl}`); return true; }
  return false;
}
function setState(req, res, data) {
  const nonce = uid(24);
  res.cookie(STATE_COOKIE, sign({ ...data, nonce }, 900), { httpOnly: true, sameSite: 'lax', secure: config.isProd || req.secure, maxAge: 900000, path: '/api/auth' });
  return nonce;
}
function readState(req, res) {
  const st = verify(req.cookies?.[STATE_COOKIE]);
  res.clearCookie(STATE_COOKIE, { path: '/api/auth' });
  if (!st || !req.query.state || st.nonce !== req.query.state) return null;
  return st;
}
const fail = (res, where, msg) => res.redirect(302, `${where}${where.includes('?') ? '&' : '?'}error=${encodeURIComponent(msg)}`);

// ---------- Google sign-in ----------
oauth.get('/google', rateLimit({ max: 30 }), (req, res) => {
  if (canonical(req, res)) return;
  if (!features().google_login) return fail(res, '/login', 'Google sign-in is not configured on this server yet.');
  const nonce = setState(req, res, { kind: 'login', next: safeNext(req.query.next), tz: validTz(req.query.tz) ? req.query.tz : null });
  const p = new URLSearchParams({
    client_id: config.google.clientId, redirect_uri: `${baseUrl(req)}/api/auth/google/callback`, response_type: 'code',
    scope: 'openid email profile', state: nonce, prompt: 'select_account', access_type: 'online',
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${p}`);
});

oauth.get('/google/callback', async (req, res) => {
  const st = readState(req, res);
  const back = st?.kind === 'connect' ? '/app/integrations' : '/login';
  if (req.query.error) return fail(res, back, req.query.error === 'access_denied' ? 'Access was not granted.' : String(req.query.error));
  if (!st) return fail(res, '/login', 'Your sign-in session expired. Please try again.');
  try {
    const tokens = await exchangeCode('google', String(req.query.code || ''), `${baseUrl(req)}/api/auth/google/callback`);
    const info = await http('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!info.email || info.email_verified === false) return fail(res, back, 'Your Google account email is not verified.');
    const email = String(info.email).toLowerCase();

    if (st.kind === 'connect') {
      const user = await db.prepare('SELECT * FROM users WHERE id=?').get(st.uid);
      if (!user) return fail(res, '/login', 'Please sign in again.');
      if (!String(tokens.scope || '').includes('calendar')) return fail(res, back, 'Calendar permission was not granted. Please tick the calendar boxes on the Google consent screen.');
      await saveAccount(user.id, 'google', tokens, email);
      return res.redirect(302, `${st.next || '/app/integrations'}${(st.next || '').includes('?') ? '&' : '?'}connected=google`);
    }

    // login / signup
    let user = await db.prepare('SELECT * FROM users WHERE google_sub=?').get(info.sub)
      || await db.prepare('SELECT * FROM users WHERE email=?').get(email);
    let isNew = false;
    if (!user) {
      const invite = await db.prepare('SELECT * FROM invites WHERE email=? AND accepted_at IS NULL ORDER BY id DESC LIMIT 1').get(email);
      const id = await createUser({ email, googleSub: info.sub, name: info.name || email.split('@')[0], avatarUrl: info.picture, timezone: st.tz || 'UTC', orgId: invite?.org_id || null, role: invite ? (invite.role || 'member') : 'owner' });
      if (invite) await db.prepare('UPDATE invites SET accepted_at=now_iso() WHERE id=?').run(invite.id);
      user = await db.prepare('SELECT * FROM users WHERE id=?').get(id);
      isNew = true;
    } else {
      await db.prepare('UPDATE users SET google_sub=COALESCE(google_sub, ?), avatar_url=COALESCE(?, avatar_url) WHERE id=?').run(info.sub, info.picture || null, user.id);
    }
    await startSession(req, res, user.id);
    res.redirect(302, isNew || !user.onboarded ? '/app/welcome' : (st.next || '/app'));
  } catch (e) {
    console.error('google oauth', e.message, e.data || '');
    fail(res, back, 'Google sign-in failed. Please try again.');
  }
});

oauth.post('/logout', async (req, res) => { await endSession(req, res); res.json({ ok: true }); });

// ---------- connect calendars ----------
oauth.get('/calendar/google', requireUser, (req, res) => {
  if (!features().google_calendar) return fail(res, '/app/integrations', 'Google Calendar is not configured on this server.');
  const nonce = setState(req, res, { kind: 'connect', uid: req.user.id, next: safeNext(req.query.next) });
  const p = new URLSearchParams({
    client_id: config.google.clientId, redirect_uri: `${baseUrl(req)}/api/auth/google/callback`, response_type: 'code',
    scope: GOOGLE_CAL_SCOPES, state: nonce, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', login_hint: req.user.email,
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${p}`);
});

oauth.get('/calendar/microsoft', requireUser, (req, res) => {
  if (!features().microsoft_calendar) return fail(res, '/app/integrations', 'Outlook calendar is not configured on this server.');
  const nonce = setState(req, res, { kind: 'connect', uid: req.user.id, next: safeNext(req.query.next) });
  const p = new URLSearchParams({
    client_id: config.microsoft.clientId, redirect_uri: `${baseUrl(req)}/api/auth/microsoft/callback`, response_type: 'code', response_mode: 'query',
    scope: MS_SCOPES, state: nonce, prompt: 'select_account',
  });
  res.redirect(302, `https://login.microsoftonline.com/${config.microsoft.tenant}/oauth2/v2.0/authorize?${p}`);
});

oauth.get('/microsoft/callback', async (req, res) => {
  const st = readState(req, res);
  const back = '/app/integrations';
  if (req.query.error) return fail(res, back, String(req.query.error_description || req.query.error).slice(0, 200));
  if (!st || st.kind !== 'connect') return fail(res, back, 'Your session expired. Please try again.');
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id=?').get(st.uid);
    if (!user) return fail(res, '/login', 'Please sign in again.');
    const tokens = await exchangeCode('microsoft', String(req.query.code || ''), `${baseUrl(req)}/api/auth/microsoft/callback`);
    const me = await http('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    await saveAccount(user.id, 'microsoft', tokens, String(me.mail || me.userPrincipalName || 'outlook').toLowerCase());
    const dest = st.next || back;
    res.redirect(302, `${dest}${dest.includes('?') ? '&' : '?'}connected=microsoft`);
  } catch (e) {
    console.error('microsoft oauth', e.message, e.data || '');
    fail(res, back, 'Connecting Outlook failed. Please try again.');
  }
});
