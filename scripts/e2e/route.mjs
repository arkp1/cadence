import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs=[]; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:3000/form/get-started', { waitUntil: 'networkidle' });
await p.fill('.routing-form input[type=text]', 'Linus T'); await p.fill('.routing-form input[type=email]', 'linus@example.com');
await p.selectOption('.routing-form select', '51-200'); await p.check('text=A product demo');
await p.click('.routing-form button[type=submit]'); await p.waitForTimeout(1500);
console.log('routed to', p.url(), '| prefill:', await p.inputValue('input >> nth=0').catch(()=> 'n/a'), '|', (await p.textContent('.event-title').catch(()=>'')));
console.log('errors', JSON.stringify(errs)); await b.close();
