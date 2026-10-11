// v111 mahalliy tekshiruv — DIZAYN «PINE GREEN»
// Nima tekshiriladi: versiya-uchligi, tw.css ulanishi, yangi fayllar,
// auth ID/lar va matnlar SAQLANGANI, yashil tokenlar, maxfiylik, node --check.
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
const idx = rd('index.html'), tw = rd('tw.css'), twi = rd('tw-input.css'), sw = rd('sw.js'), core = rd('core.js');

console.log('--- 1. VERSIYA UCHLIGI v111 ---');
T('worker BUILD_V = v111', /const BUILD_V = "v111"/.test(fs.readFileSync(ROOT + '/worker/src/index.ts', 'utf8')));
T('core __50BUILD = v111', /window\.__50BUILD = 'v111'/.test(core));
T('sw V = 50gram-v111', /const V = '50gram-v111'/.test(sw));

console.log('--- 2. TW.CSS ULANISHI + TAILWIND ---');
T('index.html tw.css ni ulaydi', /<link rel="stylesheet" href="style\.css">\s*<link rel="stylesheet" href="tw\.css">/.test(idx));
T('tw.css style.css dan KEYIN', idx.indexOf('style.css') < idx.indexOf('tw.css'));
T('tw-input.css mavjud (manba)', fs.existsSync(WEB + '/tw-input.css'));
T('tailwind.config.js mavjud', fs.existsSync(WEB + '/tailwind.config.js'));
T('config preflight=false', /preflight:\s*\{\s*preflight/.test(twi) || /preflight:\s*false/.test(fs.readFileSync(WEB + '/tailwind.config.js', 'utf8')));
T('tw.css @layer siz (tree-shake xavfi yo‘q)', !/@layer/.test(tw));
T('tw.css yashil tokenlar', tw.includes('#1e8e4d') && tw.includes('#e9f1e5'));
T('utilities kompilyatsiya bo‘lgan (.items-center)', tw.includes('.items-center'));
T('landing classlari tw.css da', tw.includes('.kirish-btn') && tw.includes('.ab-top') && tw.includes('.brand-hero'));
T('dark qoidalari tw.css da', tw.includes('body.dark #auth') && tw.includes('body.dark .ab-h'));

console.log('--- 3. YANGI ASSETLAR ---');
const stat = (p) => fs.statSync(path.join(WEB, p));
T('hero.jpg bor < 400KB', fs.existsSync(WEB + '/hero.jpg') && stat('hero.jpg').size < 400000, stat('hero.jpg').size + ' bayt');
T('logo.png yangi (yashil, 300-600KB)', fs.existsSync(WEB + '/logo.png') && stat('logo.png').size > 300000 && stat('logo.png').size < 600000);
for (const f of ['icon-192.png', 'icon-512.png', 'maskable-192.png', 'maskable-512.png', 'apple-touch-icon.png', 'favicon.png'])
  T(f + ' mavjud', fs.existsSync(WEB + '/' + f));
T('APK TEGILMAGAN (763312 bayt)', stat('50gram.apk').size === 763312, stat('50gram.apk').size + '');
T('sw SHELL tw.css + hero.jpg', sw.includes("'tw.css'") && sw.includes("'hero.jpg'"));

console.log('--- 4. AUTH — BARCHA ID LAR SAQLANGAN (funksiyalar buzilmagan) ---');
const ids = ['a-phone', 'a-code', 'a-prof', 'phone', 'cc-btn', 'cc-flag', 'cc-code', 'b-otp', 'band-note', 'band-msg', 'b-band-yes', 'b-band-no', 'code', 'b-verify', 'b-resend', 'b-back', 'ap-av', 'ap-first', 'ap-last', 'b-prof', 'apk-dl', 'ios-dl', 'b-kirish'];
for (const id of ids) T('#' + id, idx.includes('id="' + id + '"'));
const classes = ['auth-hero', 'auth-brand', 'auth-box', 'brand-feats', 'step', 'phone-in', 'code-in', 'av-pick', 'apk-btn', 'ios-btn'];
for (const c of classes) T('.' + c, idx.includes(c));

console.log('--- 5. MATNLAR O‘ZGARMAGAN (faqat dizayn) ---');
const texts = ['50 Gram', 'Telefon raqamingiz', 'Kod olish', 'Kodni kiriting', 'Tasdiqlash', 'Qayta yuborish', 'Raqamni o‘zgartirish', 'Profilingiz', 'Davom etish', 'Dasturga kirish', 'Tezkor, xavfsiz va o‘zbekcha messenjer', 'Androidlar uchun ilovani yuklab oling', 'Iphonelar uchun ilovani yuklab oling', 'Chatlar', 'Kontaktlar', 'Lenta', 'Reels', 'Kanallar', 'Profil', 'Suhbatni tanlang'];
for (const t of texts) T('«' + t + '»', idx.includes(t));
T('brend nomi ab-name bilan', idx.includes('class="ab-name'));
T('Finora so‘zi YOQ', !idx.includes('Finora') && !twi.includes('Finora'));

console.log('--- 6. LANDING OQIMI (1-oyna kabi) ---');
T('#auth landing klassi boshlanishda', idx.includes('class="scr hide landing"'));
T('#auth.landing .auth-box yashirin (mobil)', tw.includes('#auth.landing .auth-box{display:none}'));
T('b-kirish handler mavjud', idx.includes("sessionStorage.setItem('g50_kir'"));
T('hero rasm landingda', idx.includes('src="hero.jpg"') && idx.includes('class="brand-hero'));

console.log('--- 7. MAXFIYLIK (web/ da panel izi YOQ) ---');
const scan = (dir) => {
  let bad = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const fp = path.join(d, f); const st = fs.statSync(fp); if (st.isDirectory()) walk(fp); else if (/\.(js|css|html|json)$/.test(f)) { const c = fs.readFileSync(fp, 'utf8'); if (/adminpanel|panel\/|fwtoggle|adm_log|DEV_PHONES/.test(c)) bad.push(fp); } } };
  walk(dir); return bad;
};
const badFiles = scan(WEB).filter((f) => !f.includes('node_modules'));
T('web/ da maxfiy panel izi 0', badFiles.length === 0, badFiles.join(', '));
T('tw-input.css da maxfiylik izi yo‘q', !/adminpanel|fwtoggle/.test(twi));

console.log('--- 8. ESKIZ + ISHXONA TEGILMAGAN ---');
const workerSrc = fs.readFileSync(ROOT + '/worker/src/index.ts', 'utf8');
T('SMS_MODE="app" saqlangan', workerSrc.includes('SMS_MODE="app"'));
T('Eskiz sozlamalari saqlangan', workerSrc.includes('ESKIZ_EMAIL') && workerSrc.includes('ESKIZ_PASSWORD'));
T('worker build brief: v110→v111 faqat versiya', !workerSrc.includes('"v110"'));

console.log('--- 9. node --check (barcha web JS) ---');
for (const f of ['core.js', 'chat.js', 'manage.js', 'social.js', 'rtc.js', 'p2p.js', 'storage.js', 'local-store.js', 'config.js', 'sw.js']) {
  try { execSync('node --check ' + WEB + '/' + f, { stdio: 'pipe' }); T(f, true); }
  catch (e) { T(f, false, e.message.slice(0, 120)); }
}

console.log('--- 10. index.html strukturaviy sog‘liq ---');
T('html yopilgan', idx.trim().endsWith('</html>'));
T('script bloklari soni o‘zgarmagan (>=8)', (idx.match(/<script/g) || []).length >= 8, (idx.match(/<script/g) || []).length + ' ta');
T('theme-color yashil', idx.includes('content="#1E8E4D"'));
T('manifest tema yashil', rd('manifest.json').includes('#1E8E4D'));

console.log('\n===== NATIJA: ' + ok + ' YASHIL, ' + fail + ' XATO =====');
process.exit(fail ? 1 : 0);
