// Builds Cadence into Vercel's Build Output API format (.vercel/output):
//   static/                -> Vite client (served from Vercel's CDN)
//   functions/server.func  -> Express app + production node_modules (one Node.js function)
// Vercel runs this via vercel.json "buildCommand" after "npm ci".
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const sh = (cmd, cwd = ROOT) => { console.log('$ ' + cmd); execSync(cmd, { stdio: 'inherit', cwd }); };
const ROOT = process.cwd();
const OUT = path.join(ROOT, '.vercel/output');
const FN = path.join(OUT, 'functions/server.func');

// Warn early (doesn't fail the build: the app shows a setup page until configured).
const missing = ['APP_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter((k) => !process.env[k]);
if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) missing.unshift('DATABASE_URL');
if (missing.length) console.warn(`⚠️  Missing env vars: ${missing.join(', ')} — the deployed app will show its setup page.`);

// 1) client
sh('npx vite build');

// 2) function bundle
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(FN, { recursive: true });
fs.cpSync(path.join(ROOT, 'dist'), path.join(OUT, 'static'), { recursive: true });
fs.cpSync(path.join(ROOT, 'server'), path.join(FN, 'server'), { recursive: true });
fs.cpSync(path.join(ROOT, 'dist'), path.join(FN, 'dist'), { recursive: true }); // SPA fallback index.html
for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(ROOT, f), path.join(FN, f));
sh('npm ci --omit=dev --no-audit --no-fund', FN);

const major = Math.min(Math.max(Number(process.versions.node.split('.')[0]), 22), 24);
fs.writeFileSync(path.join(FN, '.vc-config.json'), JSON.stringify({
  runtime: `nodejs${major}.x`,
  handler: 'server/vercel-handler.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  supportsResponseStreaming: true,
  maxDuration: 60,
}, null, 2));

// 3) routing + cron. Hobby plans allow one run per day; Pro can use e.g. "*/5 * * * *".
// Due reminders also run opportunistically on normal traffic.
const schedule = process.env.CRON_SCHEDULE || '0 3 * * *';
fs.writeFileSync(path.join(OUT, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/$', dest: '/server' },
    { src: '^/index\\.html$', dest: '/server' },
    { handle: 'filesystem' },
    { src: '^/(.*)$', dest: '/server' },
  ],
  crons: [{ path: '/api/cron/tick', schedule }],
}, null, 2));
console.log(`✓ Build output ready (nodejs${major}.x, cron "${schedule}")`);
