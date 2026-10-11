// EDGE TTS sinov — uz-UZ-MadinaNeural (haqiqiy o'zbek ovozi) ishlashini tekshirish
// Token: Windows file time (5 daqiqaga yaxlitlangan) + TrustedClientToken -> SHA256 (upper hex)
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
let WebSocket
try { WebSocket = require('ws') } catch { WebSocket = require('/home/z/my-project/node_modules/ws') }

const TRUSTED = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const CHROMIUM = '143.0.3650.75'
const VOICE = process.argv[2] || 'uz-UZ-MadinaNeural'
const TEXT = process.argv[3] || "Assalomu alaykum! Bu 50 Gram tarjimonining o'zbek tilidagi sinov ovozi."
const OUT = process.argv[4] || '/tmp/uz_edge.mp3'
const HOST = process.argv[5] || 'bing'

const gecToken = () => {
  const WIN_EPOCH = 11644473600
  let ticks = Math.floor(Date.now() / 1000 + WIN_EPOCH) * 1e7
  ticks -= ticks % 3e9 // 5 daqiqa
  return crypto.createHash('sha256').update(String(ticks) + TRUSTED).digest('hex').toUpperCase()
}
const hex32 = () => crypto.randomBytes(16).toString('hex')
const hex32U = () => crypto.randomBytes(16).toString('hex').toUpperCase()
const sana = () => {
  const d = new Date()
  const kun = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
  const oy = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  const p = (n) => String(n).padStart(2, '0')
  return `${kun} ${oy} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
}

const configMsg = () => `X-Timestamp:${sana()}` + '\r\n' + 'Content-Type:application/json; charset=utf-8' + '\r\n' + 'Path:speech.config' + '\r\n\r\n' +
  '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
  '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"' +
  '},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'

const ssmlMsg = (text) => {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `X-RequestId:${hex32()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${sana()}Z\r\nPath:ssml\r\n\r\n` +
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='uz-UZ'><voice name='${VOICE}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${esc}</prosody></voice></speak>`
}

function edgeTTS() {
  const q = `TrustedClientToken=${TRUSTED}&ConnectionId=${hex32()}&Sec-MS-GEC=${gecToken()}&Sec-MS-GEC-Version=1-${CHROMIUM}`
  const url = HOST === 'bing'
    ? `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?${q}`
    : `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?${q}`
  return new Promise((res, rej) => {
    const ws = new WebSocket(url, {
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: `muid=${hex32U()};`,
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0`,
      },
    })
    const chunks = []
    const timer = setTimeout(() => { try { ws.close() } catch {}; rej(new Error('timeout 15s')) }, 15000)
    ws.on('open', () => { ws.send(configMsg()); ws.send(ssmlMsg(TEXT)) })
    ws.on('message', (data, isBin) => {
      if (!isBin) {
        if (String(data).includes('Path:turn.end')) { clearTimeout(timer); try { ws.close() } catch {}; res(Buffer.concat(chunks)) }
        return
      }
      const headLen = data.readUInt16BE(0)
      const head = data.slice(2, 2 + headLen).toString()
      if (head.includes('Path:audio') && !head.includes('audio.metadata')) chunks.push(data.slice(2 + headLen))
    })
    ws.on('error', (e) => { clearTimeout(timer); rej(new Error('ws: ' + (e.message || 'xato'))) })
    ws.on('close', (code) => { clearTimeout(timer); if (chunks.length) res(Buffer.concat(chunks)); else rej(new Error('yopildi code=' + code)) })
  })
}

console.log('Host:', HOST, '| Voice:', VOICE)
try {
  const mp3 = await edgeTTS()
  if (mp3.length < 1000) { console.log('JUDA KICHIK:', mp3.length); process.exit(2) }
  fs.writeFileSync(OUT, mp3)
  console.log('OK —', mp3.length, 'bayt ->', OUT)
} catch (e) {
  console.log('XATO:', e.message)
  process.exit(1)
}
