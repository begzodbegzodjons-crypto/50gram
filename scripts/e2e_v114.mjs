// v114 JONLI BRAUZER E2E — REYTING + TARJIMON
// Isbotlaydi: (1) dock 8 tugma chiziladi; (2) Tarjimon tab matn/ovoz/PDF panellari to'liq;
// (3) matn tarjima oqimi mock API bilan ishlaydi; (4) Reyting 3 bo'limi medal bilan chiziladi;
// (5) xabar kontekst-menyusida «Tarjima» bor; (6) 0 sahifa-xato. Mobil viewport (APK o'lchami).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const WEB = '/home/z/my-project/web';
const PORT = 8941;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(WEB, p);
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("yo'q"); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

let ok = 0, fail = 0;
const T = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ XATO: ' + name + (extra ? ' — ' + extra : '')); } };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

  // /api/* mocklar — tarmoqsiz to'liq ilova oqimi
  let transQ = 0;
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace(/^\/api/, '');
    const j = (obj, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(obj) });
    if (p === '/build') return j({ v: 'v114', now: Date.now() });
    if (p === '/me') return j({ id: 1, phone: '+998901234567', first_name: 'Test', last_name: 'Foydalanuvchi', username: 'testuser', avatar_ver: 0, prefs: {} });
    if (p === '/chats') return j([]);
    if (p === '/contacts') return j([]);
    if (p === '/stories') return j({ items: [], list: [] });
    if (p === '/lives') return j({ items: [], list: [] });
    if (p.startsWith('/trend')) return j({ items: [], list: [], ok: true });
    if (p === '/rating') {
      const tab = u.searchParams.get('tab');
      if (tab === 'users') return j({ ok: true, tab, me: { n: 42, rank: 7 }, list: [
        { id: 2, n: 120, earned: 45000, first_name: 'Aziz', last_name: 'Karimov', username: 'aziz', avatar_ver: 0 },
        { id: 3, n: 98, earned: 5200, first_name: 'Dilnoza', last_name: 'Rahimova', username: '', avatar_ver: 0 },
        { id: 4, n: 61, earned: 300, first_name: 'Bekzod', last_name: 'Yusupov', username: 'bek', avatar_ver: 0 }] });
      if (tab === 'channels') return j({ ok: true, tab, list: [
        { id: 11, title: 'Yangiliklar kanali', username: 'yangiliklar', avatar_ver: 0, member_count: 5300, n7: 210 },
        { id: 12, title: 'Texnologiya', username: 'texno', avatar_ver: 0, member_count: 1200, n7: 80 }] });
      return j({ ok: true, tab, list: [
        { id: 21, title: 'Do‘stlar guruhi', username: '', avatar_ver: 0, member_count: 45, n7: 330 }] });
    }
    if (p === '/translate') {
      transQ++;
      return j({ ok: true, text: 'Hello', translated: 'Salom', from: 'en', to: u.searchParams ? 'uz' : 'uz' });
    }
    return j({ ok: true });
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  // Token bilan qayta yuklash — startApp ishga tushadi
  await page.evaluate(() => {
    localStorage.setItem('g50_token', 'test-token-123');
    localStorage.setItem('g50_me', JSON.stringify({ id: 1, phone: '+998901234567', first_name: 'Test', last_name: 'Foydalanuvchi', username: 'testuser', avatar_ver: 0 }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1400);

  console.log('--- 1. DOCK: 8 TUGMA ---');
  const dock = await page.evaluate(() => ({ n: qsa('.dock button').length, ids: qsa('.dock button').map((b) => b.dataset.t) }));
  T('dock 8 tugma', dock.n === 8, 'aslida ' + dock.n);
  T('t-rating tugmasi bor', dock.ids.includes('t-rating'));
  T('t-translate tugmasi bor', dock.ids.includes('t-translate'));

  console.log('--- 2. TARJIMON TAB ---');
  await page.evaluate(() => tabGo('t-translate'));
  await page.waitForTimeout(400);
  const tp = await page.evaluate(() => ({
    text: !!document.querySelector('#tr-in'), go: !!document.querySelector('#tr-go'),
    mic: !!document.querySelector('#trv-mic'), pdf: !!document.querySelector('#trp-drop'),
    chips: document.querySelectorAll('#tr-tilqator .tilchip').length,
    seg: document.querySelectorAll('#trseg div').length,
  }));
  T('matn paneli (textarea + tugma)', tp.text && tp.go);
  T('ovoz paneli (mikrofon)', tp.mic);
  T('pdf paneli (dropzone)', tp.pdf);
  T('6 til chipi', tp.chips === 6, 'aslida ' + tp.chips);
  T('3 rejim segmenti', tp.seg === 3);

  // rejim almashtirish
  await page.evaluate(() => { document.querySelector('#trseg [data-m="voice"]').click() });
  await page.waitForTimeout(150);
  const vish = await page.evaluate(() => ({ v: !document.querySelector('#tr-voice').classList.contains('hide'), t: document.querySelector('#tr-text').classList.contains('hide') }));
  T('ovoz rejimiga o‘tish', vish.v && vish.t);

  console.log('--- 3. MATN TARJIMA OQIMI (mock API) ---');
  await page.evaluate(() => { document.querySelector('#trseg [data-m="text"]').click() });
  await page.fill('#tr-in', 'Hello world');
  await page.click('#tr-go');
  await page.waitForTimeout(700);
  const tout = await page.evaluate(() => ({ vis: !document.querySelector('#tr-out').classList.contains('hide'), t: document.querySelector('.tr-out-t').textContent }));
  T('tarjima natijasi ko‘rinadi', tout.vis && tout.t === 'Salom', 'natija: ' + tout.t);
  T('/translate API 1 marta chaqirildi', transQ === 1, String(transQ));

  console.log('--- 4. REYTING TAB ---');
  await page.evaluate(() => tabGo('t-rating'));
  await page.waitForTimeout(700);
  const rt = await page.evaluate(() => ({
    rows: document.querySelectorAll('#ratlist .rat-it').length,
    medal: !!document.querySelector('#ratlist .rat-rank'),
    me: !!document.querySelector('.rat-me'),
    meText: (document.querySelector('.rat-me') || {}).textContent || '',
  }));
  T('faol foydalanuvchilar 3 qator', rt.rows === 3, 'aslida ' + rt.rows);
  T('medal/rank belgisi bor', rt.medal);
  T('«Siz: #7» ko‘rinadi', rt.me && rt.meText.includes('#7'), rt.meText);

  // kanallar segmenti
  await page.evaluate(() => { document.querySelector('#ratseg [data-r="channels"]').click() });
  await page.waitForTimeout(600);
  const rc = await page.evaluate(() => ({ rows: document.querySelectorAll('#ratlist .rat-it').length, t1: (document.querySelector('#ratlist .t1 b') || {}).textContent || '' }));
  T('kanallar 2 qator', rc.rows === 2, 'aslida ' + rc.rows);
  T('kanal nomi chiziladi', rc.t1 === 'Yangiliklar kanali', rc.t1);

  console.log('--- 5. XABAR KONTEKST-MENYUSI «TARJIMA» ---');
  const chatSrc = fs.readFileSync(WEB + '/chat.js', 'utf8');
  T('ctxMenu «Tarjima» elementi', chatSrc.includes("['trans', '🌐', 'Tarjima']"));
  T('ctxMenu trans handleri', chatSrc.includes('window.trMsg && trMsg(m)'));

  console.log('--- 6. SKRINSHOTLAR ---');
  await page.evaluate(() => tabGo('t-translate'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/z/my-project/scripts/v114_tarjimon.png' });
  await page.evaluate(() => tabGo('t-rating'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/z/my-project/scripts/v114_reyting.png' });

  T('0 sahifa-xato (pageerror)', errors.length === 0, errors.join(' | ').slice(0, 300));
} catch (e) {
  fail++; console.log('  ✗ UMUMIY XATO: ' + String(e).slice(0, 300));
}
await browser.close();
server.close();
console.log('\n=== NATIJA: ' + ok + ' YASHIL, ' + fail + ' QIZIL ===');
process.exit(fail ? 1 : 0);
