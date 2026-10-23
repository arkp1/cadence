// Keep the serverless function alive until background work (emails, webhooks, syncs) finishes.
import { waitUntil } from '@vercel/functions';

export function background(promiseOrFn) {
  const p = Promise.resolve().then(() => (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn))
    .catch((e) => console.error('background task failed:', e?.message || e));
  try { waitUntil(p); } catch { /* not on Vercel */ }
  return p;
}
