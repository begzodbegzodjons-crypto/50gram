#!/usr/bin/env node
/* CI API yordamchisi (gh CLI yo'q — REST API bilan)
 * Bayonotlar:
 *   node ci_api.mjs list [limit]                       — oxirgi runlar
 *   node ci_api.mjs rerun <run_id>                     — muvaffaqiyatsiz/yiqilgan runni qayta ishga tushirish (all)
 *   node ci_api.mjs rerun-failed <run_id>              — faqat muvaffaqiyatsiz joblarni qayta ishga tushirish
 *   node ci_api.mjs dispatch <yml> [ref]               — workflow_dispatch
 *   node ci_api.mjs watch <run_id> [timeout_min]       — run tugashini kutish
 *   node ci_api.mjs jobs <run_id>                      — run joblari holati
 *   node ci_api.mjs logs <run_id> <job_name_regex>     — job logdan muhim qismlar
 */
import { execSync } from 'node:child_process'

const REPO = 'begzodbegzodjons-crypto/50gram'
const url = execSync('git remote get-url origin', { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname }).trim()
const TOK = (url.match(/https:\/\/([^@]+)@github\.com/) || [])[1]
if (!TOK) { console.error('token topilmadi'); process.exit(1) }
const H = {
  authorization: `Bearer ${TOK}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'ci-api',
  'content-type': 'application/json',
}
const api = async (p, opt = {}) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${p}`, { headers: H, ...opt })
  if (!r.ok && r.status !== 404) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200))
  return r
}
const cmd = process.argv[2]

if (cmd === 'list') {
  const lim = +process.argv[3] || 12
  const r = await api(`actions/runs?per_page=${lim}`)
  const j = await r.json()
  for (const x of j.workflow_runs || [])
    console.log(x.id, (x.conclusion || x.status).padEnd(9), x.head_sha.slice(0, 7), x.name.slice(0, 44), x.event)
} else if (cmd === 'rerun' || cmd === 'rerun-failed') {
  const id = process.argv[3]
  const r = await api(`actions/runs/${id}/${cmd === 'rerun' ? 'rerun' : 'rerun-failed-jobs'}`, { method: 'POST' })
  console.log(cmd, id, r.status === 201 ? 'OK' : 'status=' + r.status)
} else if (cmd === 'dispatch') {
  const yml = process.argv[3]
  const ref = process.argv[4] || 'main'
  let body = { ref }
  if (process.argv[5]) body.inputs = JSON.parse(process.argv[5])
  const r = await api(`actions/workflows/${yml}/dispatches`, { method: 'POST', body: JSON.stringify(body) })
  console.log('dispatch', yml, ref, process.argv[5] || '', r.status === 204 ? 'OK' : 'status=' + r.status)
} else if (cmd === 'jobs') {
  const r = await api(`actions/runs/${process.argv[3]}/jobs?per_page=30`)
  const j = await r.json()
  for (const x of j.jobs || []) console.log(x.id, (x.conclusion || x.status).padEnd(9), x.name.slice(0, 60))
} else if (cmd === 'watch') {
  const id = process.argv[3], t0 = Date.now(), lim = (+process.argv[4] || 20) * 60000
  while (Date.now() - t0 < lim) {
    const r = await api(`actions/runs/${id}`)
    const x = (await r.json())
    if (x.status === 'completed') { console.log('COMPLETED', x.conclusion); process.exit(x.conclusion === 'success' ? 0 : 2) }
    await new Promise((s) => setTimeout(s, 20000))
  }
  console.log('WATCH TIMEOUT (run natijasi emas — jobs bilan tekshiring!)')
  process.exit(3)
} else if (cmd === 'logs') {
  const id = process.argv[3], rx = new RegExp(process.argv[4] || '.', 'i')
  const r = await api(`actions/runs/${id}/jobs?per_page=30`)
  const j = await r.json()
  for (const x of j.jobs || []) {
    if (!rx.test(x.name)) continue
    const lr = await fetch(`https://api.github.com/repos/${REPO}/actions/jobs/${x.id}/logs`, { headers: H })
    if (!lr.ok) { console.log('log ololmadi', x.id, lr.status); continue }
    const t = await lr.text()
    const lines = t.split('\n').filter((l) => /✓|✗|PASS|FAIL|OK|error|xato|BUILD_V|fwoff|himoya|yashil|JAMI|sent|photo|TOMBSTONE|deSHIFR|APK|763312|v110/i.test(l))
    console.log('== ' + x.name + ' ==')
    console.log(lines.slice(0, 400).join('\n'))
  }
} else { console.log('noma\u2019lum buyruq'); process.exit(1) }
