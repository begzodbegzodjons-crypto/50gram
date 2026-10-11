// v112 JONLI BRAUZER E2E — REELS: fon = FAQAT logotip, video = FAQAT alohida oynada
// Isbotlaydi: (1) lenta kartalarida <video> UMUMAN YO'Q, faqat 50 Gram logotipi;
// (2) karta bosilganda to'liq ekran oyna ochiladi va FAQAT 1 ta media o'ynaydi;
// (3) oyna yopilganda jimlik tiklanadi. Mobil viewport (APK WebView o'lchami).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const WEB = '/home/z/my-project/web';
const PORT = 8931;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.apk': 'application/vnd.android.package-archive' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(WEB, p);
  if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('yo\'q'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const mp4 = fs.readFileSync('/home/z/my-project/scripts/test_media/reels_tiny.mp4');
const b64 = mp4.toString('base64');

let ok = 0, fail = 0;
const T = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ XATO: ' + name + (extra ? ' — ' + extra : '')); } };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // APK/telefon o'lchami
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1200); // modul init

  // FAKT POST: media keshi to'g'ridan-to'g'ri urug'lanadi (blob URL) — tarmoq/ kalit kerak emas
  await page.evaluate(async (bb) => {
    const bytes = Uint8Array.from(atob(bb), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'video/mp4' });
    mediaCache.set('m1', Promise.resolve(URL.createObjectURL(blob)));
    reelPosts = [{ id: 101, media_id: 'm1', media_kind: 'video', text_body: 'Test reel — v112', author: { id: 9, first_name: 'Test' }, like_count: 2, comment_count: 1, views: 5 }];
    reelTrend = [];
    renderReels();
    // vizual tekshiruv uchun auth ekranni yashirib reels bo'limini ko'rsatamiz (tabGo mantiqiga o'xshash)
    const au = document.querySelector('#auth'); if (au) au.classList.add('hide');
    const mn = document.querySelector('#main'); if (mn) mn.classList.remove('hide');
    qsa('.tab').forEach((t) => t.classList.toggle('on', t.id === 't-reels'));
    qsa('.dock button').forEach((b) => b.classList.toggle('on', b.dataset.t === 't-reels'));
  }, b64);
  await page.waitForTimeout(600);

  console.log('--- 1. LENTA (fon): FAQAT LOGOTIP ---');
  const list = await page.evaluate(() => ({
    videos: qsa('#reelslist .reel video').length,
    logos: qsa('#reelslist .reel .rl-bg img').length,
    cards: qsa('#reelslist .reel[data-reel]').length,
    imgSrc: (qs('#reelslist .reel .rl-bg img') || {}).getAttribute ? qs('#reelslist .reel .rl-bg img').getAttribute('src') : '',
  }));
  T('lenta kartalari chizildi', list.cards === 1, 'topildi: ' + list.cards);
  T('lentada <video> YO\'Q (fon jim)', list.videos === 0, 'topildi: ' + list.videos);
  T('lentada logotip fon bor', list.logos === 1 && list.imgSrc === 'logo.png');
  await page.screenshot({ path: '/home/z/my-project/scripts/reels_v112_list.png' });

  console.log('--- 2. KARTA BOSILDI → ALOHIDA OYNA ---');
  await page.evaluate(() => qs('#reelslist .reel .rtap').click());
  const opened = await page.waitForSelector('#shorts .sh-slide', { timeout: 8000 }).then(() => true).catch(() => false);
  T('to\'liq ekran oyna ochildi', opened);
  if (opened) {
    const win = await page.evaluate(() => ({ slides: qsa('#shorts .sh-slide').length, vids: qsa('#shorts .sh-slide video').length, title: (qs('#shorts .sh-top b') || {}).textContent || '' }));
    T('oynada 1 slayd', win.slides === 1, 'topildi: ' + win.slides);
    T('oynada video BOR (ijro bu yerda)', win.vids === 1, 'topildi: ' + win.vids);
    T('oyna sarlavhasi Reels', win.title.includes('Reels'));

    console.log('--- 3. BIR VAQTDFAQAT 1 TA MEDIA O\'YNAYDI (aralashish YO\'Q) ---');
    let playing = -1, muted = null;
    for (let i = 0; i < 40; i++) { // ~8s: yuklanish + ijro
      const st = await page.evaluate(() => {
        const all = qsa('video,audio', document.body);
        return { n: all.filter((m) => !m.paused && !m.ended).length, m: all.length, cur: (qs('#shorts .sh-slide video') || { currentTime: -1 }).currentTime };
      });
      playing = st.n; muted = st.m;
      if (playing === 1 && st.cur > 0.3) { break; }
      await page.waitForTimeout(200);
    }
    T('butun sahifada FAQAT 1 ta media o\'ynaydi', playing === 1, 'o\'ynaydi: ' + playing + ' / jami: ' + muted);
    const t1 = await page.evaluate(() => (qs('#shorts .sh-slide video') || { currentTime: -1 }).currentTime);
    T('video haqiqatan o\'ynaydi (currentTime > 0.3s)', t1 > 0.3, 'currentTime: ' + t1);
    const listStill = await page.evaluate(() => qsa('#reelslist .reel video').length);
    T('oyna ochiqligida lenta baribir videosiz', listStill === 0, 'topildi: ' + listStill);
    await page.screenshot({ path: '/home/z/my-project/scripts/reels_v112_viewer.png' });

    console.log('--- 4. OYNA YOPILDI → JIMLIK ---');
    await page.evaluate(() => qs('#sh-x').click());
    await page.waitForTimeout(500);
    const closed = await page.evaluate(() => !document.querySelector('#shorts') && qsa('video,audio', document.body).filter((m) => !m.paused).length === 0);
    T('oyna yopildi va sahifa JIM', closed);
  }

  console.log('--- 5. DESKTOP VIEWPORT (kompyuter) ---');
  const d = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await d.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await d.waitForTimeout(800);
  await d.evaluate(async (bb) => {
    const bytes = Uint8Array.from(atob(bb), (c) => c.charCodeAt(0));
    mediaCache.set('m1', Promise.resolve(URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))));
    reelPosts = [{ id: 101, media_id: 'm1', media_kind: 'video', text_body: 'Desktop test', author: { id: 9, first_name: 'Test' } }];
    reelTrend = [];
    renderReels();
  }, b64);
  await d.waitForTimeout(400);
  const dlist = await d.evaluate(() => ({ v: qsa('#reelslist .reel video').length, l: qsa('#reelslist .reel .rl-bg img').length }));
  T('desktop: lentada video YO\'Q, logotip bor', dlist.v === 0 && dlist.l === 1, JSON.stringify(dlist));
  await d.screenshot({ path: '/home/z/my-project/scripts/reels_v112_desktop.png' });

  const appErrors = errors.filter((e) => !e.includes('ResizeObserver') && !e.includes('net::ERR') && !e.includes('Failed to fetch'));
  T('JS xatolar YO\'Q (pageerror)', appErrors.length === 0, appErrors.join(' | ').slice(0, 200));
} finally {
  await browser.close();
  server.close();
}
console.log('\n════════ E2E NATIJA: ' + ok + ' ✓ / ' + fail + ' ✗ ' + (fail === 0 ? '— HAMMASI YASHIL ✅' : '— XATOLAR BOR ❌'));
process.exit(fail === 0 ? 0 : 1);
