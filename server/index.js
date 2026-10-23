import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { api } from './api.js';
import { pub, feedHandler } from './public.js';
import { tickJobs, syncAllCalendars } from './notify.js';
import { EMBED_JS } from './embed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Derive public base URL (used in emails/ICS) from the incoming host unless PUBLIC_URL is pinned.
const PINNED = !!process.env.PUBLIC_URL;
app.use((req, _res, next) => {
  if (!PINNED && req.get('host')) process.env.PUBLIC_URL = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('x-forwarded-host') || req.get('host')}`;
  next();
});
// Allow booking pages to be embedded anywhere (iframe embeds / popup widgets)
app.use((_req, res, next) => { res.removeHeader('X-Frame-Options'); res.set('Content-Security-Policy', 'frame-ancestors *'); next(); });

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/public', (req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); res.set('Access-Control-Allow-Headers', 'Content-Type, Booking-Request-ID'); if (req.method === 'OPTIONS') return res.sendStatus(204); next(); }, pub);
app.use('/api', api);
app.get('/feed/:token', feedHandler);
app.get('/embed.js', (_req, res) => res.type('application/javascript').set('Access-Control-Allow-Origin', '*').send(EMBED_JS));

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('/{*splat}', (_req, res) => res.status(503).send('Frontend not built. Run `npm run build`.'));
}

// background jobs: workflow reminders + calendar sync
setInterval(() => { try { tickJobs(); } catch (e) { console.error('jobs', e); } }, 15000);
setInterval(() => { try { syncAllCalendars(); } catch (e) { console.error('cal', e); } }, 10 * 60 * 1000);
setTimeout(() => { try { syncAllCalendars(); } catch { /* ignore */ } }, 5000);

// first run: seed demo workspace
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get() && process.env.NO_SEED !== '1') {
  const { seed } = await import('./seed.js');
  seed();
}

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => console.log(`Cadence running on http://0.0.0.0:${PORT}`));
