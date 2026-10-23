import { db, uid, sha256 } from './db.js';

export const COOKIE = 'cadence_session';

function userFromReq(req) {
  const auth = req.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const tok = auth.slice(7).trim();
    const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash=?').get(sha256(tok));
    if (row) {
      db.prepare("UPDATE api_tokens SET last_used_at=datetime('now') WHERE id=?").run(row.id);
      return db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
    }
    const sess = db.prepare('SELECT * FROM sessions WHERE token=?').get(sha256(tok));
    if (sess) return db.prepare('SELECT * FROM users WHERE id=?').get(sess.user_id);
    return null;
  }
  const s = req.cookies?.[COOKIE];
  if (!s) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token=?').get(sha256(s));
  if (!row) return null;
  return db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
}

export function requireUser(req, res, next) {
  const u = userFromReq(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
  req.user = u; next();
}
export function optionalUser(req, _res, next) { req.user = userFromReq(req); next(); }

export function startSession(req, res, userId) {
  const token = uid(32);
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(sha256(token), userId);
  const https = req.secure || req.get('x-forwarded-proto') === 'https';
  // SameSite=None+Partitioned lets the session survive inside embedded/iframed previews; the token is also
  // returned so the SPA can send it as a Bearer header when third-party cookies are blocked.
  res.cookie(COOKIE, token, https
    ? { httpOnly: true, sameSite: 'none', secure: true, partitioned: true, maxAge: 1000 * 60 * 60 * 24 * 30, path: '/' }
    : { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30, path: '/' });
  return token;
}
export function endSession(req, res) {
  const s = req.cookies?.[COOKIE];
  if (s) db.prepare('DELETE FROM sessions WHERE token=?').run(sha256(s));
  const auth = req.get('authorization') || '';
  if (auth.startsWith('Bearer ')) db.prepare('DELETE FROM sessions WHERE token=?').run(sha256(auth.slice(7).trim()));
  res.clearCookie(COOKIE, { path: '/' });
}
