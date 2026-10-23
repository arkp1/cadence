// Central runtime configuration. Everything comes from environment variables.
const env = process.env;

/** Postgres URL. Accepts DATABASE_URL / POSTGRES_URL, or the prefixed names Vercel's Neon
 *  integration creates when a custom prefix is chosen (e.g. MYAPP_DATABASE_URL). */
export function findDatabaseUrl(e = process.env) {
  if (e.DATABASE_URL) return e.DATABASE_URL;
  if (e.POSTGRES_URL) return e.POSTGRES_URL;
  const key = Object.keys(e).sort().find((k) => /_DATABASE_URL$/.test(k) && e[k])
    || Object.keys(e).sort().find((k) => /_POSTGRES_URL$/.test(k) && e[k]);
  return key ? e[key] : '';
}

export const config = {
  databaseUrl: findDatabaseUrl(env),
  appSecret: env.APP_SECRET || '',
  publicUrl: (env.PUBLIC_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/$/, ''),
  google: { clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '' },
  microsoft: { clientId: env.MICROSOFT_CLIENT_ID || '', clientSecret: env.MICROSOFT_CLIENT_SECRET || '', tenant: env.MICROSOFT_TENANT || 'common' },
  email: {
    from: env.EMAIL_FROM || env.SMTP_FROM || '',
    resendKey: env.RESEND_API_KEY || '',
    smtp: env.SMTP_HOST ? { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true', user: env.SMTP_USER, pass: env.SMTP_PASS } : null,
  },
  stripe: { secretKey: env.STRIPE_SECRET_KEY || '', webhookSecret: env.STRIPE_WEBHOOK_SECRET || '' },
  cronSecret: env.CRON_SECRET || '',
  isProd: env.NODE_ENV === 'production' || !!env.VERCEL,
};

export const features = () => ({
  google_login: !!(config.google.clientId && config.google.clientSecret),
  google_calendar: !!(config.google.clientId && config.google.clientSecret),
  microsoft_calendar: !!(config.microsoft.clientId && config.microsoft.clientSecret),
  email: !!(config.email.resendKey || config.email.smtp),
  payments: !!config.stripe.secretKey,
});

/** Required settings that are missing (names only — never values). */
export function missingConfig() {
  const m = [];
  if (!config.databaseUrl) m.push('DATABASE_URL');
  if (!config.appSecret || config.appSecret.length < 32) m.push('APP_SECRET');
  if (!config.google.clientId) m.push('GOOGLE_CLIENT_ID');
  if (!config.google.clientSecret) m.push('GOOGLE_CLIENT_SECRET');
  return m;
}

/** Public base URL: pinned PUBLIC_URL, else derived from the request. */
export function baseUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  if (req) return `${req.get('x-forwarded-proto') || req.protocol}://${req.get('x-forwarded-host') || req.get('host')}`;
  return 'http://localhost:3000';
}
let lastBase = '';
export const rememberBase = (req) => { lastBase = baseUrl(req); };
export const BASE_URL = () => config.publicUrl || lastBase || 'http://localhost:3000';
