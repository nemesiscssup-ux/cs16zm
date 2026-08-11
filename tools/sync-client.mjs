// Раскладывает содержимое сборки по файлам игры на этой машине.
//
// Зачем. Модели, звуки и значки клиент качает с сервера сам и складывает в
// cstrike_downloads. Пока файла там нет, игрок видит чужую модель или не видит
// ничего — и это ровно то, на что жаловался владелец. Ждать закачки на каждой
// правке долго, а на локальном сервере она идёт по 20 КБ/с, поэтому кладём
// файлы туда сами.
//
// Берём готовое дерево FastDL: в нём УЖЕ отсеяно всё, что побайтово совпадает
// со штатным из поставки игры, — то есть ровно то, чего у клиента нет.
//
// ⚠️ ЧУЖОЕ НЕ ТРОГАЕМ. В cstrike_downloads лежит содержимое ВСЕХ серверов, куда
// заходил владелец. Удалять там что попало значит сломать ему другие сервера,
// поэтому по умолчанию только докладываем файлы. Ключ --clean убирает лишнее
// ТОЛЬКО из нашего пространства имён zm_hot*.
//
// Запуск:
//   node tools/sync-client.mjs                 — доложить недостающее
//   node tools/sync-client.mjs --clean         — заодно убрать наши устаревшие
//   node tools/sync-client.mjs --dry           — только показать, что сделает
//   node tools/sync-client.mjs --game <путь>   — другая установка игры

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FASTDL = join(ROOT, 'dist', 'fastdl', 'cstrike')

const argv = process.argv.slice(2)
const flag = name => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return false
  argv.splice(i, 1)
  return true
}
const value = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return def
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}

const dry = flag('dry')
const clean = flag('clean')
const GAME = value('game', 'd:\\SteamLibrary\\steamapps\\common\\Half-Life')
const OUT = join(GAME, 'cstrike_downloads')

if (!existsSync(FASTDL)) {
  console.error(`нет дерева раздачи ${FASTDL} — сначала node tools/build-fastdl.mjs`)
  process.exit(2)
}
if (!existsSync(GAME)) {
  console.error(`не нашли игру в ${GAME} — укажите путь ключом --game`)
  process.exit(2)
}

function walk(dir, out = []) {
  let names
  try { names = readdirSync(dir) } catch { return out }
  for (const n of names) {
    const p = join(dir, n)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex')

// ⚠️ Карты в cstrike_downloads не кладём: клиент держит их в cstrike/maps, а
// лишняя копия в 20-40 МБ каждая только съедает диск.
const SKIP_TOP = new Set(['maps'])

const files = walk(FASTDL)
  .map(p => relative(FASTDL, p))
  .filter(rel => !SKIP_TOP.has(rel.split(sep)[0]))

let added = 0
let replaced = 0
let same = 0
let bytes = 0

for (const rel of files) {
  const from = join(FASTDL, rel)
  const to = join(OUT, rel)
  const there = existsSync(to)
  // Сверяем содержимым, а не датой: файл мог прийти закачкой с сервера и иметь
  // любое время, а нам важно, тот ли он.
  if (there && sha(from) === sha(to)) { same++; continue }
  if (!dry) {
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
  bytes += statSync(from).size
  if (there) replaced++; else added++
}

// Наше устаревшее: файлы zm_hot*, которых в сборке больше нет. Появляются
// после вырезанных классов — четыре модели зомби так и лежали бы у клиента.
const ours = new Set(files.map(r => r.toLowerCase()))
const stale = walk(OUT)
  .map(p => relative(OUT, p))
  .filter(rel => /(^|[\\/])zm_hot/i.test(rel) && !ours.has(rel.toLowerCase()))

let removed = 0
let freed = 0
for (const rel of stale) {
  const p = join(OUT, rel)
  freed += statSync(p).size
  if (clean && !dry) { rmSync(p); removed++ }
}

const mb = n => (n / 1048576).toFixed(1)
console.log(`игра: ${GAME}`)
console.log(`куда: ${OUT}`)
console.log(`${dry ? 'проверка: ' : ''}положено новых ${added}, обновлено ${replaced}, совпало ${same} — ${mb(bytes)} МБ`)
if (stale.length) {
  console.log(clean
    ? `${dry ? 'проверка: убрать' : 'убрано'} наших устаревших ${clean && !dry ? removed : stale.length} — ${mb(freed)} МБ`
    : `наших устаревших у клиента: ${stale.length} (${mb(freed)} МБ) — убрать ключом --clean`)
  for (const rel of stale.slice(0, 10)) console.log(`    ${rel}`)
  if (stale.length > 10) console.log(`    … и ещё ${stale.length - 10}`)
}
console.log('\nчужое содержимое других серверов не тронуто')
