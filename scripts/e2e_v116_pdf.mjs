// v116 PDF yuklab olish E2E — uzluk hujjat + HAQIQIY .pdf fayl yuklab olish.
// Tekshiruvlar: (1) uzluk .trp-doc korinishi, (2) blob yuklab olish ishlaydi,
// (3) yuklangan fayl HAQIQIY PDF (bayt tekshiruv + xref ofsetlari),
// (4) pdf.js yuklangan faylni QAYTA ochadi (numPages >= 1) — toliq validatsiya.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const WEB = '/home/z/my-project/web';
const PORT = 8957;
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

// Test PDF — 2 sahifali, matnli (qolda yig'ilgan minimal PDF)
function testPdfYasa() {
  const enc = (s) => Buffer.from(s, 'binary');
  const sahifa = (matn) => {
    const kont = `BT /F1 18 Tf 72 720 Td (${matn}) Tj ET`;
    return { kont };
  };
  const objs = [];
  const p1 = sahifa('Hello world. This is page one of the test document.');
  const p2 = sahifa('Second page text. Goodbye world.');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');
  objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>');
  objs.push({ kont: p1.kont });
  objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>');
  objs.push({ kont: p2.kont });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const qismlar = [];
  let ofset = 0;
  const xref = [];
  const yoz = (b) => { qismlar.push(b); ofset += b.length };
  yoz(enc('%PDF-1.4\n'));
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    xref[i + 1] = ofset;
    if (typeof o === 'string') yoz(enc(`${i + 1} 0 obj\n${o}\nendobj\n`));
    else yoz(enc(`${i + 1} 0 obj\n<< /Length ${o.kont.length} >>\nstream\n${o.kont}\nendstream\nendobj\n`));
  }
  const xp = ofset;
  let xr = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i <= objs.length; i++) xr += String(xref[i]).padStart(10, '0') + ' 00000 n \n';
  xr += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xp}\n%%EOF`;
  yoz(enc(xr));
  return Buffer.concat(qismlar);
}
fs.writeFileSync('/tmp/test_doc_v116.pdf', testPdfYasa());

let ok = 0, fail = 0;
const T = (name, cond, extra) => { if (cond) { ok++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ XATO: ' + name + (extra ? ' — ' + extra : '')); } };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const j = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === '/build') return j({ v: 'v116', now: Date.now() });
    if (p === '/me') return j({ id: 1, phone: '+998901234567', first_name: 'Test', avatar_ver: 0, prefs: {} });
    if (p === '/translate') return j({ ok: true, translated: 'Bu tarjima qilingan birinchi paragraf. Bu ikkinchi gap. Bu uchinchi gap.\nVa bu alohida ikkinchi paragraf.', from: 'en', to: 'uz' });
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

  console.log('--- 1. UZLUK HUJJAT OQIMI ---');
  await page.setInputFiles('#trp-file', '/tmp/test_doc_v116.pdf');
  await page.waitForSelector('#trp-res:not(.hide)', { timeout: 25000 });
  const res = await page.evaluate(() => ({
    doc: !!document.querySelector('.trp-doc'),
    p: document.querySelectorAll('.trp-doc p').length,
    blk: document.querySelectorAll('.trp-blk').length,
    par1: (document.querySelector('.trp-doc p') || {}).textContent || '',
    ctl: !document.querySelector('#trp-ctl').classList.contains('hide'),
    tugma: (document.querySelector('#trp-print') || {}).textContent || '',
  }));
  T('uzluk hujjat (.trp-doc) chizildi', res.doc);
  T('bo lak-bolak .trp-blk YOQ (olib tashlandi)', res.blk === 0, 'blk=' + res.blk);
  T('paragraflar uzluk ketma-ket', res.p >= 2, 'p=' + res.p);
  T('birinchi paragraf tarjima matni', res.par1.includes('tarjima qilingan birinchi paragraf'), res.par1.slice(0, 50));
  T('tugmalar paneli: PDF yuklab olish tugmasi', res.ctl && res.tugma.includes('PDF yuklab olish'), res.tugma);

  console.log('--- 2. HAQIQIY PDF YUKLAB OLISH ---');
  const yuk = Promise.resolve().then(() => page.waitForEvent('download', { timeout: 30000 }));
  await page.click('#trp-print');
  const download = await (await yuk);
  const fayl = await download.path();
  const bayt = fs.readFileSync(fayl);
  T('yuklab olish sodir boldi', !!fayl);
  T('fayl nomi .pdf', download.suggestedFilename().endsWith('.pdf'), download.suggestedFilename());
  T('PDF sarlavha baytlari (%PDF-1.4)', bayt.slice(0, 8).toString('binary') === '%PDF-1.4', bayt.slice(0, 8).toString('binary'));
  T('PDF oxiri %%EOF', bayt.slice(-5).toString('binary').trim() === '%%EOF');
  T('kattalik mantiqli (>30KB, JPEG sahifalar)', bayt.length > 30000, String(bayt.length));
  const sahifaSon = (bayt.toString('binary').match(/\/Type \/Page[^s]/g) || []).length;
  T('kamida 1 sahifa obyekti', sahifaSon >= 1, 'sahifa=' + sahifaSon);
  T('DCTDecode JPEG sahifalar', bayt.toString('binary').includes('/DCTDecode'));

  console.log('--- 3. XREF OFSETLARI BAYT-ANIQ ---');
  const xrefTek = await (async () => {
    const s = bayt.toString('binary');
    const m = s.match(/startxref\n(\d+)\n%%EOF/);
    if (!m) return { xato: 'startxref yoq' };
    const xp = Number(m[1]);
    const jadval = s.slice(xp, xp + 4000);
    const satrlar = jadval.split('\n');
    const count = Number(satrlar[1].split(' ')[1]);
    const xato = [];
    for (let i = 1; i < Math.min(count, 8); i++) {
      const off = Number(satrlar[2 + i].slice(0, 10));
      const boyo = bayt.slice(off, off + 12).toString('binary');
      if (!boyo.startsWith(i + ' 0 obj')) xato.push('obj' + i + '→"' + boyo + '"');
    }
    return { count, xato };
  })();
  T('xref jadvali topildi', Array.isArray(xrefTek.xato) && !xrefTek.xato.length && !!xrefTek.count, xrefTek.xato === undefined ? (xrefTek.xato || 'yoq') : JSON.stringify(xrefTek.xato));
  T('xref ofsetlari bayt-aniq (obj sarlavhalari mos)', (xrefTek.xato || []).length === 0, JSON.stringify(xrefTek.xato));

  console.log('--- 4. PDF.JS QAYTA OCHISH (toliq validatsiya) ---');
  const numPages = await page.evaluate(async (b64) => {
    const lib = await import('./pdfjs/pdf.min.mjs');
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    const doc = await lib.getDocument({ data: arr }).promise;
    return doc.numPages;
  }, bayt.toString('base64'));
  T('pdf.js yuklangan PDFni ochdi (numPages>=1)', numPages >= 1, 'numPages=' + numPages);
  await page.screenshot({ path: '/home/z/my-project/scripts/v116_pdf.png' });
  T('0 sahifa-xato (pageerror)', errors.length === 0, errors.join('|').slice(0, 200));
} catch (e) {
  fail++; console.log('  ✗ UMUMIY XATO: ' + String(e).slice(0, 300));
}
await browser.close();
server.close();
console.log('\n=== NATIJA: ' + ok + ' YASHIL, ' + fail + ' QIZIL ===');
process.exit(fail ? 1 : 0);
