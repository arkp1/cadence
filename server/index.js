// Long-running server (local dev / any Node host). Loads .env if present; real env vars win.
import fs from 'node:fs';
if (fs.existsSync('.env') && process.loadEnvFile) process.loadEnvFile('.env');
const { app, startJobs } = await import('./app.js');
const { missingConfig } = await import('./config.js');

const missing = missingConfig();
if (missing.length) console.warn(`⚠️  Missing configuration: ${missing.join(', ')} — see .env.example`);
startJobs();
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => console.log(`Cadence running on http://0.0.0.0:${PORT}`));
