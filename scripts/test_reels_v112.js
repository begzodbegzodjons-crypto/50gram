// v112 mahalliy tekshiruv — REELS: fon = FAQAT logotip, video = FAQAT alohida oynada
// Foydalanuvchi shikoyati: "reels bo'limida fonda video avtomatik ko'rsatib ketmoqda va
// alohida video ko'rsatish oynasi ochilib yana video ko'rsatmoqda — 2 ta video bir vaqtda
// ovozi aralashib ketyapti". Yechim: lenta kartasida video YO'Q (faqat 50 Gram logotipi),
// avto-ijro kuzatuvchisi olib tashlandi; video faqat to'liq ekran oynada.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const WEB = '/home/z/my-project/web';
const ROOT = '/home/z/my-project';
let ok = 0, fail = 0;
function T(name, cond, extra) {
  if (cond) { ok++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ XATO: ' + name + (extra ? ' — ' + extra : '')); }
}
const rd = (p) => fs.readFileSync(path.join(WEB, p), 'utf8');
const soc = rd('social.js'), css = rd('style.css'), sw = rd('sw.js'), core = rd('core.js'), idx = rd('index.html');

console.log('--- 1. VERSIYA UCHLIGI v112 ---');
T('worker BUILD_V = v112', /const BUILD_V = "v112"/.test(fs.readFileSync(ROOT + '/worker/src/index.ts', 'utf8')));
T('core __50BUILD = v112', /window\.__50BUILD = 'v112'/.test(core));
T('sw V = 50gram-v112', /const V = '50gram-v112'/.test(sw));

console.log('--- 2. LENTA KARTASI: VIDEO YO\'Q, FAQAT LOGOTIP (reelHTML) ---');
const mReel = soc.match(/function reelHTML\(p\) \{[\s\S]*?\n\}/);
T('reelHTML topildi', !!mReel);
const reel = mReel ? mReel[0] : '';
T('reelHTML ichida <video> YO\'Q', !reel.includes('<video'));
T('reelHTML ichida data-media YO\'Q', !reel.includes('data-media'));
T('rl-bg logotip fon bor', reel.includes('<div class="rl-bg"><img src="logo.png" alt="50 Gram"></div>'));
T('like tugmasi saqlangan (data-like)', reel.includes('data-like'));
T('izoh tugmasi saqlangan (data-cmt)', reel.includes('data-cmt'));
T('ulashish saqlangan (data-psh)', reel.includes('data-psh'));
T('o\'chirish saqlangan (data-pdel)', reel.includes("data-pdel"));
T('bosish qatlami saqlangan (rtap)', reel.includes('class="rtap"'));
T('muallif bloki saqlangan (rbot)', reel.includes('class="rbot"'));
T('soya saqlangan (rshade)', reel.includes('rshade'));
T('karta data-reel saqlangan', reel.includes('data-reel="${p.id}"'));

console.log('--- 3. AVTO-IJRO KUZATUVCHISI OLIB TASHLANGAN (renderReels) ---');
const mRr = soc.match(/function renderReels\(inc\) \{[\s\S]*?\n\}/);
T('renderReels topildi', !!mRr);
const rr = mRr ? mRr[0] : '';
T('renderReels ichida IntersectionObserver YO\'Q', !rr.includes('new IntersectionObserver'));
T('renderReels ichida .play() YO\'Q (fon ijro yo\'q)', !rr.includes('.play('));
T('renderReels ichida preload=none tsikli YO\'Q', !rr.includes("preload = 'none'"));
T('eski kuzatuvchi disconnect+null qilinadi', rr.includes('reelsObserver.disconnect()'));
T('reelsObserver faqat disconnect qilinadi (boshqa assign YO\'Q)', (soc.match(/reelsObserver = (?!null)/g) || []).length === 0, 'faqat boshlang\'ich let = null');

console.log('--- 4. ALOHIDA OYNA SAQLANGAN (shortsStart/openShorts/shActivate) ---');
T('shortsStart mavjud', soc.includes('async function shortsStart(opt = {})'));
T('openShorts mavjud', soc.includes('function openShorts(list, startIdx = 0)'));
T('shActivate mavjud', soc.includes('function shActivate('));
T('oyna slaydida video BOR (shSlideHTML)', soc.includes('<video data-media="${p.media_id}" loop playsinline preload="metadata"></video>'));
T('oyna ochilganda tashqi media pauza (aralashish himoyasi)', soc.includes("qsa('video,audio', document.body).forEach((m) => { if (!w.contains(m) && !m.paused)"));
T('shauto pref oynada ISHLAYDI (2 joyda)', (soc.match(/S\.prefs\.shauto/g) || []).length >= 2);
T('tabGo reels avto-oyna SAQLANGAN (core.js)', core.includes("if (id === 't-reels') { loadReels(true); shortsStart({ reelsOnly: true }) }"));

console.log('--- 5. CSS: .rl-bg USLUBLARI ---');
T('.reel .rl-bg qoidasi bor', css.includes('.reel .rl-bg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center'));
T('.reel .rl-bg img logotip o\'lchami', css.includes('.reel .rl-bg img{width:min(46vw,200px)'));
T('rlfloat animatsiyasi bor', css.includes('@keyframes rlfloat'));
T('eski .reel video qoidasi buzilmagan', css.includes('.reel video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000}'));
T('.reel.rlogo qoidasi saqlangan', css.includes('.reel.rlogo{display:flex'));

console.log('--- 6. MATN/MANTIQ O\'ZGARMAGAN ---');
T('"Pastga suring — yana videolar 🎬"', soc.includes('Pastga suring — yana videolar 🎬'));
T('"Hammasi ko‘rildi ✨"', soc.includes('Hammasi ko‘rildi ✨'));
T('"Hali Reels yo‘q" (logoSlide)', soc.includes('Hali Reels yo‘q'));
T('logoSlide o\'zgarmagan', soc.includes("function logoSlide() {"));
T('reelTrendHTML o\'zgarmagan (trend kartalari)', soc.includes('function reelTrendHTML(x) {'));
T('kliklar bloki saqlangan (reelslist click)', soc.includes("$('reelslist').addEventListener('click'"));
T('shortsStart({ post: p, reelsOnly: true }) saqlangan', soc.includes('shortsStart({ post: p, reelsOnly: true })'));
T('loadReels o\'zgarmagan', soc.includes('async function loadReels(reset) {'));
T('index.html Reels tab saqlangan', idx.includes('id="t-reels"') && idx.includes('<span>Reels</span>'));
T('manage.js reels pref sahifasi tegilmagan', fs.readFileSync(path.join(WEB, 'manage.js'), 'utf8').includes("if (a === 'reels') pgReels()"));

console.log('--- 7. MAXFIYLIK + SHIFRLASH TEGILMAGAN ---');
T('social.js da panel izi YO\'Q', !soc.toLowerCase().includes('adminpanel') && !soc.includes('ADMIN_HTML'));
T('style.css da panel izi YO\'Q', !css.toLowerCase().includes('adminpanel'));
T('mediaUrl (kalit/shifr) core.js da O\'ZGARMAGAN', core.includes("function mediaUrl(id) {") && core.includes("Faylni ochish kaliti yo‘q"));
T('Eskiz SMS tegilmagan', !/ESKIZ|SMS_MODE/.test(soc + css));

console.log('--- 8. FAYLLAR + KESH ---');
T('logo.png mavjud', fs.existsSync(path.join(WEB, 'logo.png')));
T('APK TEGILMAGAN (763312 bayt)', fs.statSync(path.join(WEB, '50gram.apk')).size === 763312, fs.statSync(path.join(WEB, '50gram.apk')).size + ' bayt');
T('sw SHELL social.js + style.css + logo.png', sw.includes("'social.js'") && sw.includes("'style.css'") && sw.includes("'logo.png'"));

console.log('--- 9. SINTAKSIS ---');
for (const f of ['social.js', 'core.js', 'sw.js', 'chat.js', 'manage.js', 'rtc.js', 'p2p.js', 'storage.js', 'config.js']) {
  try { execSync('node --check ' + path.join(WEB, f), { stdio: 'pipe' }); T('node --check ' + f, true); }
  catch (e) { T('node --check ' + f, false, String(e.stderr || e).slice(0, 120)); }
}

console.log('\n════════ NATIJA: ' + ok + ' ✓ / ' + fail + ' ✗ ' + (fail === 0 ? '— HAMMASI YASHIL ✅' : '— XATOLAR BOR ❌'));
process.exit(fail === 0 ? 0 : 1);
