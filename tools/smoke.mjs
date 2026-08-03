// Локальный прогон сервера с проверкой, что он действительно поднялся.
//
// Проверяется не «процесс не упал», а по существу: отвечает ли сервер на игровой
// запрос и загрузились ли Metamod, AMX Mod X и сам Zombie Plague.
//
// Запуск: node tools/smoke.mjs [карта]

import { execFileSync, spawn } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUN = join(ROOT, 'run')
const PORT = 27015
const MAP = process.argv[2] ?? 'de_dust2'

const hlds = join(RUN, 'hlds.exe')
if (!existsSync(hlds)) {
  console.error(`нет ${hlds} — сначала node tools/compose-run.mjs`)
  process.exit(2)
}

// Собственный конфиг прогона: выполняет боевой server.cfg и дополнительно просит
// сервер напечатать, что у него загрузилось. Боевой конфиг при этом не трогаем.
const smokeCfg = join(RUN, 'cstrike', 'smoke.cfg')
writeFileSync(smokeCfg, ['exec server.cfg', 'meta list', 'amxx plugins', ''].join('\n'), 'latin1')

const logPath = join(RUN, 'smoke-stdout.log')
if (existsSync(logPath)) rmSync(logPath, { force: true })
const logFd = openSync(logPath, 'w')

// Без -nomaster: этот флаг глушит и ответы на запрос обозревателя серверов,
// а именно по ним мы и проверяем, что сервер жив.
const args = [
  '-console',
  '-game', 'cstrike',
  '-port', String(PORT),
  '+servercfgfile', 'smoke.cfg',
  '+maxplayers', '12',
  '+sv_lan', '1',
  '+map', MAP,
]

console.log(`запуск: hlds.exe ${args.join(' ')}`)
const child = spawn(hlds, args, { cwd: RUN, detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true })
child.unref()

const REQUEST = Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from('TSource Engine Query\0', 'latin1')])

function query(timeoutMs = 2000) {
  return new Promise(res => {
    const sock = createSocket('udp4')
    const t = setTimeout(() => { try { sock.close() } catch {} ; res(null) }, timeoutMs)
    sock.on('message', msg => { clearTimeout(t); try { sock.close() } catch {} ; res(msg) })
    sock.on('error', () => { clearTimeout(t); try { sock.close() } catch {} ; res(null) })
    sock.send(REQUEST, PORT, '127.0.0.1')
  })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function readCString(buf, offset) {
  let end = offset
  while (end < buf.length && buf[end] !== 0) end++
  return { value: buf.toString('utf8', offset, end), next: end + 1 }
}

function stop() {
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch { /* уже завершился */ }
}

let answer = null
const deadline = Date.now() + 90_000
while (Date.now() < deadline) {
  await sleep(3000)
  answer = await query()
  if (answer) break
}

const checks = []
const add = (name, ok, detail) => checks.push({ name, ok, detail })

if (answer) {
  let p = 5
  const header = answer[4]
  if (header === 0x49) p += 1
  let r = readCString(answer, p); const name = r.value; p = r.next
  r = readCString(answer, p); const map = r.value; p = r.next
  r = readCString(answer, p); const folder = r.value; p = r.next
  r = readCString(answer, p); const game = r.value
  add('сервер отвечает на игровой запрос', true, `${name} | карта ${map} | ${folder}/${game}`)
  add('загружена запрошенная карта', map.toLowerCase() === MAP.toLowerCase(), `ожидалась ${MAP}, получена ${map}`)
} else {
  add('сервер отвечает на игровой запрос', false, 'ответа нет за 90 секунд')
}

await sleep(4000)
const log = existsSync(logPath) ? readFileSync(logPath, 'latin1') : ''
add('консоль сервера читается', log.length > 0, `${log.length} байт`)

const marker = (label, re) => {
  const m = log.match(re)
  add(label, Boolean(m), m ? m[0].trim().replace(/\s+/g, ' ').slice(0, 120) : 'в выводе не найдено')
}
marker('Metamod-r загружен', /Metamod-r v[\d.]+[^\n]*/i)
marker('AMX Mod X загружен', /AMX Mod X version [\d.]+[^\n]*/i)
marker('ReGameDLL загружен', /ReGameDLL version: [^\n]*/i)
marker('Zombie Plague запущен', /Zombie Plague[^\n]*running/i)
marker('классы зомби запущены', /\[ZP\] Default Zombie[^\n]*running/i)

// ReUnion работает только поверх ReHLDS. Локально движок штатный, от Valve,
// поэтому его отказ здесь — ожидаемое следствие, а не поломка сборки.
const reunionNeedsRehlds = /Failed to locate REHLDS API/i.test(log)
if (reunionNeedsRehlds) {
  add('ReUnion: ожидаемо не загружен на движке Valve', true,
    'модулю нужен ReHLDS; на боевом Linux-сервере он будет')
}

// «N plugins, N running» печатается дважды: для модулей Metamod и для плагинов AMXX.
const counts = [...log.matchAll(/(\d+) plugins?, (\d+) running/gi)].map(m => [Number(m[1]), Number(m[2])])
const tolerated = reunionNeedsRehlds ? 1 : 0
const allRunning = counts.length > 0 && counts.every(([total, run]) => total - run <= tolerated)
add('модули и плагины в состоянии running', allRunning,
  counts.map(([t, r]) => `${r} из ${t}`).join('; ') || 'счётчики не найдены')

const errors = [...log.matchAll(/^[^\n]*(fail load|bad load|Host_Error|Sys_Error|FATAL)[^\n]*$/gim)]
  .map(m => m[0].trim())
  .filter(l => !(reunionNeedsRehlds && /Reunion/i.test(l)))
add('нет незапланированных отказов загрузки', errors.length === 0, errors.slice(0, 6).join(' | ') || 'отказов нет')

stop()

console.log('')
let failed = 0
for (const c of checks) {
  if (!c.ok) failed++
  console.log(`${c.ok ? '[ OK ]' : '[ХУЖЕ]'} ${c.name}`)
  console.log(`       ${c.detail}`)
}
console.log('')
console.log(`итог: ${checks.length - failed} из ${checks.length} проверок пройдено`)
process.exit(failed ? 1 : 0)
