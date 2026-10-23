import { db, uid, sha256 } from './db.js';
import { config } from './config.js';

export const COOKIE = 'cadence_session';
const SESSION_DAYS = 30;

async function userFromReq(req) {
  const auth = req.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const tok = auth.slice(7).trim();
    const row = await db.prepare('SELECT * FROM api_tokens WHERE token_hash=?').get(sha256(tok));
    if (!row) return null;
    db.prepare('UPDATE api_tokens SET last_used_at=now_iso() WHERE id=?').run(row.id).catch(() => {});
    req.authVia = 'token';
    return db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  }
  const s = req.cookies?.[COOKIE];
  if (!s) return null;
  const row = await db.prepare('SELECT * FROM sessions WHERE token=? AND expires_at > now_iso()').get(sha256(s));
  if (!row) return null;
  req.authVia = 'cookie';
  return db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
}

export async function requireUser(req, res, next) {
  try {
    const u = await userFromReq(req);
    if (!u) return res.status(401).json({ error: 'Please sign in.' });
    // CSRF defence for cookie sessions: mutating requests must come from our own origin.
    if (req.authVia === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const host = req.get('x-forwarded-host') || req.get('host');
      if (origin && new URL(origin).host !== host) return res.status(403).json({ error: 'Cross-site request blocked.' });
    }
    req.user = u; next();
  } catch (e) { next(e); }
}
export async function optionalUser(req, _res, next) {
  try { req.user = await userFromReq(req); } catch { req.user = null; }
  next();
}

const secureReq = (req) => req.secure || req.get('x-forwarded-proto') === 'https';

export async function startSession(req, res, userId) {
  const token = uid(40);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at, user_agent) VALUES (?,?,?,?)')
    .run(sha256(token), userId, expires, String(req.get('user-agent') || '').slice(0, 200));
  await db.prepare('UPDATE users SET last_login_at=now_iso() WHERE id=?').run(userId);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureReq(req) || config.isProd, maxAge: SESSION_DAYS * 86400000, path: '/' });
  return token;
}
export async function endSession(req, res) {
  const s = req.cookies?.[COOKIE];
  if (s) await db.prepare('DELETE FROM sessions WHERE token=?').run(sha256(s));
  res.clearCookie(COOKIE, { path: '/' });
}
