import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from './config.js';

// Derive independent keys from APP_SECRET.
const derive = (label) => crypto.createHash('sha256').update(`${label}:${config.appSecret || 'dev-insecure-secret'}`).digest();
const ENC_KEY = derive('enc');
const MAC_KEY = derive('mac');

/** AES-256-GCM encrypt (for OAuth tokens at rest). */
export function encrypt(plain) {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}
export function decrypt(blob) {
  if (!blob) return null;
  const [v, iv, tag, data] = String(blob).split('.');
  if (v !== 'v1') return null;
  const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

/** Signed, expiring payloads (OAuth state cookies). */
export function sign(obj, ttlSec = 600) {
  const body = Buffer.from(JSON.stringify({ ...obj, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  const mac = crypto.createHmac('sha256', MAC_KEY).update(body).digest('base64url');
  return `${body}.${mac}`;
}
export function verify(token) {
  if (!token || !String(token).includes('.')) return null;
  const [body, mac] = String(token).split('.');
  const exp = crypto.createHmac('sha256', MAC_KEY).update(body).digest('base64url');
  if (mac.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(exp))) return null;
  try {
    const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!o.exp || o.exp < Date.now() / 1000) return null;
    return o;
  } catch { return null; }
}

// ---- SSRF guard for user-supplied URLs (webhooks, ICS feeds) ----
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:') && privateIp(l.slice(7));
}
export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw Object.assign(new Error('Invalid URL'), { status: 400 }); }
  if (!['http:', 'https:'].includes(u.protocol)) throw Object.assign(new Error('URL must start with https://'), { status: 400 });
  if (config.isProd && u.protocol !== 'https:') throw Object.assign(new Error('URL must use https://'), { status: 400 });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw Object.assign(new Error('Could not resolve that host'), { status: 400 });
  if (config.isProd && addrs.some((a) => privateIp(a.address))) throw Object.assign(new Error('That address is not allowed'), { status: 400 });
  return u.toString();
}

// ---- simple per-instance rate limiter ----
const buckets = new Map();
export function rateLimit({ windowMs = 60000, max = 20, key = (req) => req.ip } = {}) {
  const limit = Number(process.env.RATE_LIMIT_PER_MIN) > 0 ? Math.round(Number(process.env.RATE_LIMIT_PER_MIN) * max / 20) : max;
  return (req, res, next) => {
    const k = `${req.baseUrl}${req.route?.path || ''}:${key(req)}`;
    const now = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(k, b); }
    if (++b.n > limit) { res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000))); return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' }); }
    if (buckets.size > 5000) for (const [kk, v] of buckets) if (v.reset < now) buckets.delete(kk);
    next();
  };
}
