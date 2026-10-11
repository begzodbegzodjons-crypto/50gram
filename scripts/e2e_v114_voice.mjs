// v114 OVOZLI TARJIMA E2E — soxta mikrofon + MediaRecorder + /translate/speech mock
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const WEB = '/home/z/my-project/web';
const PORT = 8955;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
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

// 0.5s tinch ovoz (webm) — MediaRecorder o'zi yozadi, bu faqat zaxira
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  let speechBody = null;
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const j = (o, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/build') return j({ v: 'v114', now: Date.now() });
    if (p === '/me') return j({ id: 1, phone: '+998901234567', first_name: 'Test', avatar_ver: 0, prefs: {} });
    if (p === '/translate/speech') {
      const req = route.request();
      try { speechBody = req.postDataJSON(); } catch { speechBody = {} }
      // 48-byte tinch mp3 (valid header) — Audio.play() uchun
      const mp3 = Buffer.from('//uQxAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA==', 'base64');
      return j({ ok: true, text: '你好', translated: 'Salom, xush kelibsiz', from: 'zh', to: speechBody.to || 'uz', audio: 'data:audio/mpeg;base64,' + mp3.toString('base64') });
    }
    if (p.startsWith('/trend')) return j({ items: [] });
    return j({ ok: true, items: [], list: [] });
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('g50_token', 't'); localStorage.setItem('g50_me', JSON.stringify({ id: 1, first_name: 'Test' })) });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1400);
  await page.evaluate(() => tabGo('t-translate'));
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.querySelector('#trseg [data-m="voice"]').click() });
  await page.waitForTimeout(250);

  console.log('--- OVOZLI TARJIMA OQIMI ---');
  // Xitoy tilini tanlash (chip 4 = zh)
  await page.evaluate(() => { document.querySelector('#trv-tilqator [data-til="zh"]').click() });
  await page.click('#trv-mic');
  await page.waitForTimeout(1800);
  const rec = await page.evaluate(() => document.querySelector('#trv-mic').classList.contains('rec'));
  T('yozib olish boshlandi (qizil pulsatsiya)', rec);
  await page.evaluate(() => document.querySelector('#trv-mic').click()); // to'xtatish (animatsiya stable-klikka to'siq)
  await page.waitForSelector('#trv-res:not(.hide)', { timeout: 20000 });
  const r = await page.evaluate(() => ({
    src: document.querySelector('#trv-src').textContent,
    dst: document.querySelector('#trv-dst').textContent,
    to: document.querySelector('#trv-to-n').textContent,
    stat: document.querySelector('#trv-stat').textContent,
  }));
  T('aniqlangan matn ko‘rinadi (xitoycha)', r.src === '你好', r.src);
  T('o‘zbekcha tarjima ko‘rinadi', r.dst === 'Salom, xush kelibsiz', r.dst);
  T('til nomi ko‘rinadi (tuban nom)', r.to.includes('中文'), r.to);
  T('status «Tayyor»', r.stat.includes('Tayyor'), r.stat);
  T('/translate/speech body: audio base64 bor', !!(speechBody && speechBody.audio && speechBody.audio.length > 100), JSON.stringify(speechBody || {}).slice(0, 80));
  T('/translate/speech body: to=zh', !!(speechBody && speechBody.to === 'zh'));
  await page.screenshot({ path: '/home/z/my-project/scripts/v114_ovoz.png' });
  T('0 sahifa-xato (pageerror)', errors.length === 0, errors.join('|').slice(0, 200));
} catch (e) {
  fail++; console.log('  ✗ UMUMIY XATO: ' + String(e).slice(0, 300));
}
await browser.close();
server.close();
console.log('\n=== NATIJA: ' + ok + ' YASHIL, ' + fail + ' QIZIL ===');
process.exit(fail ? 1 : 0);
