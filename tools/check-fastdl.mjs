// Сверяет раздачу на хостинге с тем, что собрано.
//
// ЗАЧЕМ. Сборка и раздача расходятся молча. Сервер говорит клиенту «возьми файл
// по адресу», хостинг отвечает 404 — и клиент откатывается на закачку с самого
// игрового сервера, а это ~20 КБ/с. Один скин на 2.8 МБ так едет две с
// половиной минуты; сорок мегабайт новых файлов — полчаса «Processing…» на
// входе. Игрок столько не ждёт: выходит, возвращается — и ходит без модели.
//
// Ровно на это наступили 2026-08-10: восемь новых скинов, новая лапа и звук
// Ведьмы лежали в сборке, но не на хостинге, и владелец увидел «модели просто
// невидимые».
//
// Проверяем ЗАПРОСАМИ HEAD: тело не качаем, только код ответа и размер. Пароль
// от хостинга тут не нужен — раздача отдаётся по http всем.
//
// Запуск:
//   node tools/check-fastdl.mjs                  — всё дерево раздачи
//   node tools/check-fastdl.mjs --url <адрес>    — другой хостинг
//   node tools/check-fastdl.mjs --limit 50       — только первые N файлов

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FASTDL = join(ROOT, 'dist', 'fastdl', 'cstrike')

const argv = process.argv.slice(2)
const value = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i < 0 ? def : argv[i + 1]
}

// Адрес берём из настроек установки, чтобы он не разъезжался с сервером.
function urlFromConfig() {
  for (const p of [join(ROOT, 'custom', 'server-extra.cfg'), join(ROOT, 'run', 'cstrike', 'server.cfg')]) {
    try {
      const m = readFileSync(p, 'utf8').match(/^\s*sv_downloadurl\s+"([^"]+)"/m)
      if (m) return m[1]
    } catch {}
  }
  return null
}

const URL_BASE = (value('url', urlFromConfig()) || '').replace(/\/+$/, '')
const LIMIT = parseInt(value('limit', '0')) || 0

if (!URL_BASE) {
  console.error('не нашли адрес раздачи: нет sv_downloadurl ни в custom/server-extra.cfg, ни в run/cstrike/server.cfg')
  process.exit(2)
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

let files = walk(FASTDL).map(p => relative(FASTDL, p))
if (LIMIT) files = files.slice(0, LIMIT)

// ⚠️ Карты клиент берёт из своего cstrike/maps, в раздаче они лежат сжатыми
// (.bsp.bz2) или не лежат вовсе — их пропускаем, иначе шум.
files = files.filter(rel => rel.split(sep)[0] !== 'maps')

const CONCURRENCY = 8
const missing = []
const wrongSize = []
let netFail = []
let checked = 0

// ⚠️ Одиночный сбой сети засчитывался как «нет на хостинге», и число
// пропавших плавало от прогона к прогону. Хостинг рвёт соединение примерно на
// одном запросе из ста, поэтому пробуем трижды с нарастающей паузой — иначе в
// отчёте появляются «пропавшие» файлы, которые на месте.
const TRIES = 3
async function head(rel) {
  const url = `${URL_BASE}/${rel.split(sep).map(encodeURIComponent).join('/')}`
  const local = statSync(join(FASTDL, rel)).size
  try {
    let r = null
    for (let attempt = 0; attempt < TRIES && !r; attempt++) {
      try {
        // ⚠️ Без этого заголовка хостинг сжимает текстовые файлы (.txt значков
        // HUD) и пишет в Content-Length длину СЖАТОГО тела — 22 целых файла
        // выглядели «старой версией». Клиент игры сжатия не просит и получает
        // исходный размер, так что сравнивать надо с ним.
        r = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          headers: { 'accept-encoding': 'identity' },
        })
      } catch (e) {
        if (attempt === TRIES - 1) throw e
        await new Promise(done => setTimeout(done, 400 * (attempt + 1)))
      }
    }
    if (!r.ok) { missing.push({ rel, code: r.status }); return }
    // Некоторые хостинги отдают файлы сжатыми и не пишут длину — тогда не судим.
    const len = Number(r.headers.get('content-length'))
    if (Number.isFinite(len) && len > 0 && len !== local) wrongSize.push({ rel, len, local })
  } catch (e) {
    netFail.push({ rel, code: `связь: ${e.cause?.code || e.code || e.message}` })
  } finally {
    checked++
    if (checked % 50 === 0) process.stdout.write(`  проверено ${checked} из ${files.length}\r`)
  }
}

const queue = files.slice()
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const rel = queue.shift()
    if (!rel) return
    await head(rel)
  }
}))

// ⚠️ Восемь запросов сразу хостинг иногда не тянет и роняет соединение — на
// каждом прогоне «пропадал» какой-нибудь один файл, и каждый раз другой.
// Сорвавшиеся перепроверяем по одному; «нет на хостинге» пишем только тем,
// кто не ответил и в спокойном режиме.
if (netFail.length) {
  const again = netFail
  netFail = []
  process.stdout.write(`  перепроверяем поодиночке: ${again.length}          \r`)
  for (const f of again) await head(f.rel)
  missing.push(...netFail)
}

const mb = n => (n / 1048576).toFixed(1)
console.log(`раздача: ${URL_BASE}`)
console.log(`проверено файлов: ${checked}`)

if (missing.length) {
  const bytes = missing.reduce((s, m) => s + statSync(join(FASTDL, m.rel)).size, 0)
  console.log(`\nНЕТ НА ХОСТИНГЕ: ${missing.length} шт., ${mb(bytes)} МБ`)
  console.log('Клиент будет качать их с игрового сервера по ~20 КБ/с — это'
    + ` примерно ${Math.round(bytes / 20480 / 60)} мин ожидания на входе.`)
  for (const m of missing.slice(0, 20)) console.log(`  ${m.code}  ${m.rel}`)
  if (missing.length > 20) console.log(`  … и ещё ${missing.length - 20}`)
}

if (wrongSize.length) {
  console.log(`\nРАЗМЕР НЕ СОВПАЛ: ${wrongSize.length} шт. — на хостинге лежит старая версия`)
  for (const w of wrongSize.slice(0, 20)) console.log(`  ${w.rel}: у нас ${w.local}, там ${w.len}`)
  if (wrongSize.length > 20) console.log(`  … и ещё ${wrongSize.length - 20}`)
}

// ⚠️ ПО РАЗМЕРУ ВИДНО НЕ ВСЁ. Правка одного байта — например снятие флага
// прозрачности у шкуры — размер не меняет, и такой файл выглядит «совпавшим».
// Поэтому дополнительно сверяем отпечатки: upload-fastdl.sh запоминает md5
// того, что уже отправил, и расхождение с нынешним файлом означает, что на
// хостинге лежит СТАРОЕ содержимое при том же размере.
const FP = join(ROOT, 'dist', '.fastdl-uploaded.md5')
const changed = []
if (existsSync(FP)) {
  const known = new Map()
  for (const line of readFileSync(FP, 'utf8').split('\n')) {
    const m = line.match(/^(\w{32})\s+(.+)$/)
    if (m) known.set(m[2].trim().replace(/\\/g, '/'), m[1])
  }
  for (const rel of files) {
    // В отпечатках путь записан от корня дерева выкладки, то есть с «cstrike/».
    const key = `cstrike/${rel.split(sep).join('/')}`
    const was = known.get(key)
    if (!was) continue
    const now = createHash('md5').update(readFileSync(join(FASTDL, rel))).digest('hex')
    if (now !== was) changed.push(rel)
  }
  if (changed.length) {
    console.log(`\nСОДЕРЖИМОЕ ИЗМЕНИЛОСЬ ПОСЛЕ ВЫКЛАДКИ: ${changed.length} шт.`)
    console.log('Размер у них прежний, поэтому по ответу хостинга это не видно —'
      + ' нужна повторная заливка (tools/upload-fastdl.sh отправит только их).')
    for (const rel of changed.slice(0, 20)) console.log(`  ${rel}`)
    if (changed.length > 20) console.log(`  … и ещё ${changed.length - 20}`)
  }
} else {
  console.log('\nотпечатков прошлой выкладки нет (dist/.fastdl-uploaded.md5) —'
    + ' сверить содержимое не с чем, проверен только размер')
}

if (!missing.length && !wrongSize.length && !changed.length) console.log('\nраздача совпадает со сборкой')
process.exit(missing.length || wrongSize.length || changed.length ? 1 : 0)
