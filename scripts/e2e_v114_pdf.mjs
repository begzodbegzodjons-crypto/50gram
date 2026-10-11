// v114 PDF oqimi E2E — haqiqiy test PDF + pdf.js modul + tarjima oqimi
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const WEB = '/home/z/my-project/web';
const PORT = 8953;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(WEB, p);
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

let ok = 0, fail = 0;
const T = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ XATO: ' + name + (extra ? ' — ' + extra : '')); } };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const j = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/build') return j({ v: 'v114', now: Date.now() });
    if (p === '/me') return j({ id: 1, phone: '+998901234567', first_name: 'Test', avatar_ver: 0, prefs: {} });
    if (p === '/translate') return j({ ok: true, translated: 'SALOM — tarjima qilingan matn', from: 'en', to: 'uz' });
    if (p.startsWith('/trend')) return j({ items: [] });
    return j({ ok: true, items: [], list: [] });
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('g50_token', 't'); localStorage.setItem('g50_me', JSON.stringify({ id: 1, first_name: 'Test' })) });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => tabGo('t-translate'));
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.querySelector('#trseg [data-m="pdf"]').click() });
  await page.waitForTimeout(200);

  console.log('--- PDF OQIMI ---');
  await page.setInputFiles('#trp-file', '/tmp/test_doc.pdf');
  // pdf.js yuklash + 2 sahifa o'qish + tarjima (mock) — 20s kutish
  await page.waitForSelector('#trp-res:not(.hide)', { timeout: 25000 });
  const res = await page.evaluate(() => ({
    blk: document.querySelectorAll('.trp-blk').length,
    orig: (document.querySelector('.trp-orig') || {}).textContent || '',
    tr: (document.querySelector('.trp-tr') || {}).textContent || '',
    ctl: !document.querySelector('#trp-ctl').classList.contains('hide'),
  }));
  T('PDF matn chiqarildi + bloklar chizildi', res.blk >= 1, 'bloklar: ' + res.blk);
  T('asl matn ko‘rinadi', res.orig.includes('Hello world'), res.orig.slice(0, 60));
  T('tarjima bloki chiziladi', res.tr.includes('SALOM'), res.tr.slice(0, 60));
  T('nusxa/txt/print tugmalari', res.ctl);
  await page.screenshot({ path: '/home/z/my-project/scripts/v114_pdf.png' });
  T('0 sahifa-xato (pageerror)', errors.length === 0, errors.join('|').slice(0, 200));
} catch (e) {
  fail++; console.log('  ✗ UMUMIY XATO: ' + String(e).slice(0, 300));
}
await browser.close();
server.close();
console.log('\n=== NATIJA: ' + ok + ' YASHIL, ' + fail + ' QIZIL ===');
process.exit(fail ? 1 : 0);
