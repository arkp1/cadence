// Stripe Checkout for paid event types (REST API via fetch — no SDK needed).
// Flow: booking is inserted as `pending_payment` with a 32-minute hold → invitee pays on Stripe →
// success redirect (verified server-side) or the webhook confirms it → normal booking side effects run.
import crypto from 'node:crypto';
import express from 'express';
import { db, mapBooking } from './db.js';
import { config, BASE_URL } from './config.js';

export const HOLD_MINUTES = 32; // Stripe requires Checkout sessions to live ≥ 30 minutes
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
export const paymentsEnabled = () => !!config.stripe.secretKey;

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
async function stripe(path, { method = 'GET', body } = {}) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method, body: body ? form(body) : undefined,
    headers: { Authorization: `Bearer ${config.stripe.secretKey}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data?.error?.message || `Stripe error ${r.status}`), { status: 502 });
  return data;
}

/** Create a Checkout session for a pending booking; returns the hosted payment URL. */
export async function createCheckout(b, et) {
  const cents = Number(b.price_cents);
  const currency = String(b.currency || 'USD').toUpperCase();
  const unit = ZERO_DECIMAL.has(currency) ? Math.round(cents / 100) : cents;
  const session = await stripe('/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'payment',
      customer_email: b.invitee_email,
      client_reference_id: b.uid,
      metadata: { booking_uid: b.uid },
      payment_intent_data: { metadata: { booking_uid: b.uid }, description: `${et.name} — ${b.start_utc}` },
      line_items: { 0: { quantity: 1, price_data: { currency: currency.toLowerCase(), unit_amount: unit, product_data: { name: et.name, description: `${b.duration} min · ${new Date(b.start_utc).toUTCString()}` } } } },
      success_url: `${BASE_URL()}/booking/${b.uid}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL()}/booking/${b.uid}?payment=canceled`,
      expires_at: Math.floor(Date.now() / 1000) + (HOLD_MINUTES - 1) * 60,
    },
  });
  await db.prepare('UPDATE bookings SET payment_ref=? WHERE id=?').run(session.id, b.id);
  return session.url;
}

/**
 * Mark a pending booking as paid if Stripe says so. Idempotent: only the first caller flips the status
 * and gets the booking back (so side effects run exactly once).
 */
export async function confirmPayment(sessionOrId) {
  const s = typeof sessionOrId === 'string' ? await stripe(`/checkout/sessions/${encodeURIComponent(sessionOrId)}`) : sessionOrId;
  if (s.payment_status !== 'paid') return null;
  const uidv = s.metadata?.booking_uid || s.client_reference_id;
  const row = await db.prepare(`UPDATE bookings SET status='active', payment_status='paid', payment_ref=?, hold_expires_at=NULL
      WHERE uid=? AND status IN ('pending_payment','expired') RETURNING *`).get(s.payment_intent || s.id, uidv);
  return row ? mapBooking(row) : null;
}

export async function refundPayment(b) {
  if (!paymentsEnabled() || b.payment_status !== 'paid' || !String(b.payment_ref || '').startsWith('pi_')) return false;
  await stripe('/refunds', { method: 'POST', body: { payment_intent: b.payment_ref, metadata: { booking_uid: b.uid } } });
  await db.prepare("UPDATE bookings SET payment_status='refunded' WHERE id=?").run(b.id);
  return true;
}

function verifySignature(raw, header, secret) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')));
  const sigs = String(header || '').split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

/** Mounted BEFORE express.json() so we get the raw body for signature checks. */
export function stripeWebhook(onPaid) {
  const r = express.Router();
  r.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    if (!config.stripe.webhookSecret) return res.status(503).json({ error: 'Stripe webhook secret not configured' });
    const raw = req.body?.toString('utf8') || '';
    if (!verifySignature(raw, req.get('stripe-signature'), config.stripe.webhookSecret)) return res.status(400).json({ error: 'Bad signature' });
    try {
      const evt = JSON.parse(raw);
      const s = evt.data?.object;
      if (evt.type === 'checkout.session.completed' || evt.type === 'checkout.session.async_payment_succeeded') {
        const b = await confirmPayment(s);
        if (b) await onPaid(b);
      } else if (evt.type === 'checkout.session.expired') {
        await db.prepare("UPDATE bookings SET status='expired', hold_expires_at=NULL WHERE uid=? AND status='pending_payment'").run(s.metadata?.booking_uid || s.client_reference_id);
      }
      res.json({ received: true });
    } catch (e) {
      console.error('stripe webhook', e.message);
      res.status(500).json({ error: 'Webhook handling failed' });
    }
  });
  return r;
}
