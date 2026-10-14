// v116 PDF KO'RINISH TEKSHIRUVI — xitoy+o'zbek aralash matn → PDF → pdf.js render → PNG
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const WEB = '/home/z/my-project/web';
const PORT = 8958;
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

// Ko'p paragrafli test: manba PDF lotin (pdf.js o'qiydi), TARJIMA xitoy+o'zbek
// aralash — aynan PDF ga chiziladigan matn shu bo'lgani uchun CJK render tekshiriladi
const tarjima = [];
for (let i = 1; i <= 20; i++) tarjima.push('第' + i + '段。上海是中国最大的经济中心城市，人口超过两千四百万。火车站怎么走？今天天气很好。 Bu ' + i + '-paragraf: Shanxay — Xitoyning iqtisodiy markazi, aholisi 24 milliondan oshadi. Vokzalga qanday borish mumkin? Bugun ob-havo juda yaxshi, birga nonushtaga boramiz — bu uzun gapning davomi, sahifa bolinishini tekshiramiz.');

// Test PDF — lotin matnli (pdf.js xar bir belgini o'qiydi)
function testPdfYasa() {
  const enc = (s) => Buffer.from(s, 'binary');
  const paras = [];
  for (let i = 1; i <= 20; i++) paras.push('Test document paragraph number ' + i + '. Shanghai is one of the largest economic centers in Asia with more than twenty four million people living in the metropolitan area. How do I get to the railway station from here? The weather is very nice today so we can walk together and have breakfast in that small cafe near the main square.');
  const qismlar = []; const xref = []; let ofset = 0;
  const yoz = (b) => { qismlar.push(b); ofset += b.length };
  const matnlar = paras.map((p) => `(${p}) Tj T*`).join('\n');
  const k = `BT /F1 12 Tf 72 720 Td 22 TL\n${matnlar}\nET`;
  const objlar = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    { kont: k },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  yoz(enc('%PDF-1.4\n'));
  for (let i = 0; i < objlar.length; i++) {
    xref[i + 1] = ofset;
    if (typeof objlar[i] === 'string') yoz(enc(`${i + 1} 0 obj\n${objlar[i]}\nendobj\n`));
    else yoz(enc(`${i + 1} 0 obj\n<< /Length ${Buffer.byteLength(objlar[i].kont)} >>\nstream\n${objlar[i].kont}\nendstream\nendobj\n`));
  }
  const xp = ofset;
  let xr = 'xref\n0 ' + (objlar.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i <= objlar.length; i++) xr += String(xref[i]).padStart(10, '0') + ' 00000 n \n';
  xr += `trailer\n<< /Size ${objlar.length + 1} /Root 1 0 R >>\nstartxref\n${xp}\n%%EOF`;
  yoz(enc(xr));
  return Buffer.concat(qismlar);
}

const browser = await chromium.launch();
let fail = 0;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const j = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/build') return j({ v: 'v116', now: Date.now() });
    if (p === '/me') return j({ id: 1, phone: '+998901234567', first_name: 'Test', avatar_ver: 0, prefs: {} });
    if (p === '/translate') return j({ ok: true, translated: tarjima.shift() || 'tarjima', from: 'zh', to: 'uz' });
    return j({ ok: true, items: [], list: [] });
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('g50_token', 't'); localStorage.setItem('g50_me', JSON.stringify({ id: 1, first_name: 'Test' })) });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => tabGo('t-translate'));
  await page.evaluate(() => { document.querySelector('#trseg [data-m="pdf"]').click() });
  // Manba PDF: 20 paragraf oddiy lotin matni (pdf.js bemalol o'qiydi)
  const paras = [];
  for (let i = 1; i <= 20; i++) paras.push('Test document paragraph number ' + i + '. Shanghai is one of the largest economic centers in Asia with more than twenty four million people living in the metropolitan area. How do I get to the railway station from here? The weather is very nice today so we can walk together and have breakfast in that small cafe near the main square of the old city district.');
  fs.writeFileSync('/tmp/test_doc_lat.pdf', testPdfYasa());
  await page.setInputFiles('#trp-file', '/tmp/test_doc_lat.pdf');
  await page.waitForSelector('#trp-res:not(.hide)', { timeout: 40000 });
  // Mock tarjima 20 marta ketma-ket keladi — PDF yaratish
  const yuk = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#trp-print');
  const download = await yuk;
  const bayt = fs.readFileSync(await download.path());
  console.log('PDF baytlar:', bayt.length, '| sahifa obyektlari:', (bayt.toString('binary').match(/\/Type \/Page[^s]/g) || []).length);
  // pdf.js bilan 1-sahifani canvasga chizib PNG olish
  const b64 = bayt.toString('base64');
  const dataUrl = await page.evaluate(async (b) => {
    const lib = await import('./pdfjs/pdf.min.mjs');
    const raw = atob(b);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    const doc = await lib.getDocument({ data: arr }).promise;
    const pg = await doc.getPage(1);
    const vp = pg.getViewport({ scale: 0.62 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return c.toDataURL('image/png');
  }, b64);
  fs.writeFileSync('/home/z/my-project/scripts/v116_pdf_sahifa1.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('✓ 1-sahifa render qilindi → scripts/v116_pdf_sahifa1.png');
} catch (e) {
  fail = 1; console.log('✗ XATO: ' + String(e).slice(0, 400));
}
await browser.close();
server.close();
process.exit(fail);
