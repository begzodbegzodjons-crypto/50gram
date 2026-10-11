// v111 dizayn tekshiruvi: mobil + desktop skrinshotlar
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WEB = '/home/z/my-project/web';
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = path.join(WEB, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => srv.listen(8899, r));
  const b = await chromium.launch();
  const errors = [];

  // 1) MOBIL landing (390x844)
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  m.on('pageerror', (e) => errors.push('MOB pageerror: ' + e.message));
  m.on('console', (msg) => { if (msg.type() === 'error') errors.push('MOB console: ' + msg.text()); });
  await m.goto('http://127.0.0.1:8899/', { waitUntil: 'networkidle' });
  await m.waitForTimeout(600);
  await m.screenshot({ path: '/home/z/my-project/scripts/shot_m1_landing.png' });
  // landing holati: auth-box yashirin bo'lishi kerak
  const landingState = await m.evaluate(() => {
    const a = document.getElementById('auth');
    const box = document.querySelector('#auth .auth-box');
    const bk = document.getElementById('b-kirish');
    return {
      authHide: a.classList.contains('hide'), landing: a.classList.contains('landing'),
      boxDisplay: getComputedStyle(box).display, kirishVisible: !!bk && getComputedStyle(bk).display !== 'none',
      heroLoaded: (() => { const h = document.querySelector('.brand-hero'); return h && h.complete && h.naturalWidth > 0; })(),
    };
  });
  console.log('MOB landing holati:', JSON.stringify(landingState));
  // 2) «Dasturga kirish» bosilgach
  await m.click('#b-kirish');
  await m.waitForTimeout(700);
  await m.screenshot({ path: '/home/z/my-project/scripts/shot_m2_form.png' });
  const formState = await m.evaluate(() => {
    const box = document.querySelector('#auth .auth-box');
    return { landing: document.getElementById('auth').classList.contains('landing'), boxDisplay: getComputedStyle(box).display };
  });
  console.log('MOB forma holati:', JSON.stringify(formState));

  // 3) DESKTOP (1360x900) — ikki ustun
  const d = await b.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1.5 });
  d.on('pageerror', (e) => errors.push('DESK pageerror: ' + e.message));
  d.on('console', (msg) => { if (msg.type() === 'error') errors.push('DESK console: ' + msg.text()); });
  await d.goto('http://127.0.0.1:8899/', { waitUntil: 'networkidle' });
  await d.waitForTimeout(600);
  await d.screenshot({ path: '/home/z/my-project/scripts/shot_d1_landing.png' });
  const deskState = await d.evaluate(() => {
    const box = document.querySelector('#auth .auth-box');
    return { landing: document.getElementById('auth').classList.contains('landing'), boxDisplay: getComputedStyle(box).display };
  });
  console.log('DESK holati:', JSON.stringify(deskState));
  // 4) DESKTOP kirish bosilgach (forma fokus)
  await d.click('#b-kirish');
  await d.waitForTimeout(600);
  await d.screenshot({ path: '/home/z/my-project/scripts/shot_d2_form.png' });

  // 5) MOBIL DARK rejim tekshiruv
  const md = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await md.goto('http://127.0.0.1:8899/', { waitUntil: 'networkidle' });
  await md.evaluate(() => { document.body.classList.add('dark'); document.getElementById('auth').classList.remove('landing'); });
  await md.waitForTimeout(400);
  await md.screenshot({ path: '/home/z/my-project/scripts/shot_m3_dark.png' });

  await b.close();
  srv.close();
  console.log('XATOLAR:', errors.length ? errors.join(' | ') : '0');
})().catch((e) => { console.error(e); process.exit(1); });
