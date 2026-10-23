// Vercel Function entry (Build Output API). All state lives in Postgres (Neon).
const { app } = await import('./app.js');

export default function handler(req, res) {
  return app(req, res);
}
