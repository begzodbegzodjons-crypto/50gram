// v119 DOCK DIZAYN TEKSHIRUVI — Telegram/Instagram-uslubi vizual + funksional
// (1) dock 7 tugma SVG bilan chiziladi, emoji YO'Q; (2) faol tugma aksent rangda;
// (3) badge ishlaydi; (4) tab almashtirish ishlaydi; (5) 0 pageerror.
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
let fails = 0;
const ok = (c, l, e = '') => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + l + (e ? ' — ' + e : '')); if (!c) fails++; };
(async () => {
  await new Promise((r) => srv.listen(8901, r));
  const b = await chromium.launch();
  const errors = [];
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  m.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await m.goto('http://127.0.0.1:8901/', { waitUntil: 'networkidle' });
  await m.evaluate(() => {
    document.getElementById('auth').classList.add('hide');
    document.getElementById('main').classList.remove('hide');
    document.getElementById('dialog').classList.remove('hide');
    document.getElementById('chatlist').innerHTML = '<div class="item act"><div class="av">A</div><div class="mid"><div class="t1"><b>Aziz Karimov</b><span class="tm">12:30</span></div><div class="t2"><span class="prev">Salom!</span><span class="cnt">2</span></div></div></div>';
  });
  await m.waitForTimeout(300);
  // 1) DOCK TUZILISHI
  const d = await m.evaluate(() => {
    const dock = document.querySelector('.dock');
    const btns = [...dock.querySelectorAll('button')];
    return {
      n: btns.length,
      svg: btns.filter((x) => x.querySelector('svg')).length,
      emoji: btns.filter((x) => /[💬👥📰🎬📢🏆🌐👤]/.test(x.querySelector('i').textContent)).length,
      badge: !!dock.querySelector('#badge'),
      onColor: getComputedStyle(dock.querySelector('button.on')).color,
      barBg: getComputedStyle(dock).backgroundColor,
      radius: getComputedStyle(dock).borderRadius,
      svgSize: (btns[0].querySelector('svg') ? getComputedStyle(btns[0].querySelector('svg')).width : 'yoq'),
    };
  });
  ok(d.n === 7, 'dock: 7 tugma', d.n + ' ta');
  ok(d.svg === 7, 'dock: 7 SVG ikonka', d.svg + ' ta');
  ok(d.emoji === 0, 'dock: emoji YO\'Q');
  ok(d.badge, 'dock: badge bor');
  ok(d.radius === '0px', 'dock: tekis panel (radius 0)', d.radius);
  ok(d.svgSize === '25px', 'dock: SVG 25px', d.svgSize);
  console.log('  ℹ faol rang=' + d.onColor + ' bar-fon=' + d.barBg);
  ok(d.onColor === 'rgb(21, 106, 58)', 'dock: faol tugma — aksent (yashil)', d.onColor);
  const iBg = await m.evaluate(() => getComputedStyle(document.querySelector('.dock button.on i')).backgroundImage);
  ok(iBg === 'none', 'dock: faol ikonka — gradient-blob YO\'Q', iBg);
  // 2) TAB ALMASHTIRISH
  const tab2 = await m.evaluate(() => {
    const b = document.querySelector('.dock button[data-t="t-contacts"]');
    b.click();
    return { on: document.querySelector('.dock button.on').dataset.t, tabOn: document.getElementById('t-contacts').classList.contains('on') };
  });
  ok(tab2.on === 't-contacts' && tab2.tabOn, 'dock: tab almashtirish ishlaydi');
  // 3) BADGE KO'RINISHI
  await m.evaluate(() => { const bd = document.getElementById('badge'); bd.textContent = '3'; bd.classList.remove('hide'); });
  const bdg = await m.evaluate(() => { const bd = document.getElementById('badge'); return getComputedStyle(bd).display !== 'none' && bd.textContent === '3'; });
  ok(bdg, 'dock: badge matn bilan ko\'rinadi');
  // 4) REYTING YO'Q
  ok(await m.evaluate(() => !document.getElementById('t-rating') && !document.querySelector('[data-t="t-rating"]')), 'reyting tab/tugmasi DOM\'da YO\'Q');
  // 5) DARK MODE KO'RINISHI
  await m.evaluate(() => { document.body.classList.add('dark'); document.querySelector('.dock button[data-t="t-chats"]').click(); });
  await m.waitForTimeout(400);
  const dk = await m.evaluate(() => ({ bg: getComputedStyle(document.querySelector('.dock')).backgroundColor, on: getComputedStyle(document.querySelector('.dock button.on')).color }));
  ok(dk.bg === 'rgba(11, 19, 13, 0.94)', 'dock: dark fon (Pine Green dark)', dk.bg);
  ok(dk.on === 'rgb(126, 216, 168)', 'dock: dark faol — och yashil aksent', dk.on);
  // SCREENSHOT: light + dark
  await m.evaluate(() => document.body.classList.remove('dark'));
  await m.waitForTimeout(120);
  await m.screenshot({ path: '/home/z/my-project/scripts/shot_v119_dock_light.png' });
  await m.evaluate(() => document.body.classList.add('dark'));
  await m.waitForTimeout(120);
  await m.screenshot({ path: '/home/z/my-project/scripts/shot_v119_dock_dark.png' });
  ok(errors.length === 0, '0 pageerror', errors.join(' | ').slice(0, 120));
  await b.close();
  srv.close();
  console.log(fails ? fails + ' TA TEST YIQILDI' : 'BARCHA DOCK-TESTLAR YASHIL');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
