// v111 asosiy ilova skin tekshiruvi: #main + #dialog demo kontent bilan
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
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  m.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await m.goto('http://127.0.0.1:8899/', { waitUntil: 'networkidle' });
  // Auth yashir, main ko'rsat + demo chat ro'yxati + demo dialog
  await m.evaluate(() => {
    document.getElementById('auth').classList.add('hide');
    document.getElementById('main').classList.remove('hide');
    document.getElementById('dialog').classList.remove('hide');
    // chatlist demo
    document.getElementById('chatlist').innerHTML = `
      <div class="item act"><div class="av" style="background:linear-gradient(135deg,#27A45D,#156A3A);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">A</div><div class="mid"><div class="t1"><b>Aziz Karimov</b><span class="tm">12:30</span></div><div class="t2"><span class="prev">Salom! Yubordim, ko‘rindingizmi? 👍</span><span class="cnt">2</span></div></div></div>
      <div class="item"><div class="av" style="background:#D9EEDF;color:#156A3A;display:flex;align-items:center;justify-content:center;font-weight:800">💎</div><div class="mid"><div class="t1"><b>Do‘stlar guruhı</b><span class="tm">11:04</span></div><div class="t2"><span class="prev">Dilshod: Kechqurun uchrashamizmi?</span></div></div></div>
      <div class="item"><div class="av" style="background:#D9EEDF;color:#156A3A;display:flex;align-items:center;justify-content:center;font-weight:800">📢</div><div class="mid"><div class="t1"><b>50 Gram Yangiliklar</b><span class="tm">09:15</span></div><div class="t2"><span class="prev">📢 Yangi versiya chiqdi — tezlik 2x!</span></div></div></div>`;
    // stories demo
    document.getElementById('stories').innerHTML = `
      <div class="st"><span class="ring" style="background:conic-gradient(from 200deg,#1E8E4D,#3FC57E,#156A3A,#7ED8A8,#1E8E4D)"><i class="c" style="background:linear-gradient(135deg,#27A45D,#156A3A);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;border-radius:50%">A</i></span><span class="nm">Aziz</span></div>
      <div class="st"><span class="ring"><i class="c" style="background:#D9EEDF;display:flex;align-items:center;justify-content:center;border-radius:50%">➕</i></span><span class="nm">Mening</span></div>`;
    // messages demo (dialog ochiq)
    document.getElementById('d-title').textContent = 'Aziz Karimov';
    document.getElementById('d-sub').textContent = 'oxirgi marta 12:01 da';
    document.getElementById('msgs').innerHTML = `
      <div class="day"><span>Bugun</span></div>
      <div class="mrow"><div class="m">Salom! 50 Gram yangi dizayni yoqdimi? 😊<small class="t">12:28 ✓✓</small></div></div>
      <div class="mrow me"><div class="m">Ha, juda chiroyli bo‘libdi! Yashil rang zo‘r <small class="t">12:30</small></div></div>
      <div class="mrow"><div class="m"><div class="voice"><button class="pb">▶</button><div class="vw"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><b class="vd">0:12</b></div></div></div>`;
  });
  await m.waitForTimeout(500);
  await m.screenshot({ path: '/home/z/my-project/scripts/shot_m4_main.png' });
  // Desktop main (chap panel + dialog)
  const d = await b.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1.5 });
  d.on('pageerror', (e) => errors.push('DESK pageerror: ' + e.message));
  await d.goto('http://127.0.0.1:8899/', { waitUntil: 'networkidle' });
  await d.evaluate(() => {
    document.getElementById('auth').classList.add('hide');
    document.getElementById('main').classList.remove('hide');
    document.getElementById('dialog').classList.remove('hide');
    document.getElementById('chatlist').innerHTML = document.querySelector('#chatlist').innerHTML;
  });
  await d.waitForTimeout(400);
  await d.screenshot({ path: '/home/z/my-project/scripts/shot_d3_main.png' });
  await b.close();
  srv.close();
  console.log('XATOLAR:', errors.length ? errors.join(' | ') : '0');
})().catch((e) => { console.error(e); process.exit(1); });
