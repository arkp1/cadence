import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1360, height: 900 }, timezoneId: 'Asia/Kolkata' });
let errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && !m.text().includes('401') && errs.push(m.text()));
await p.goto('http://localhost:3000/login'); await p.click('button[type=submit]'); await p.waitForURL('**/app**');
const pages = process.argv.slice(2);
for (const path of pages) {
  errs = [];
  await p.goto('http://localhost:3000' + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(600);
  const name = path.replace(/\//g,'_').replace(/^_/,'') || 'root';
  await p.screenshot({ path: `/home/user/shots/${name}-${process.env.V||1}.png` });
  const txt = (await p.textContent('.content').catch(()=>''))?.slice(0,90);
  console.log(path, '|', JSON.stringify(errs), '|', txt);
}
await b.close();
