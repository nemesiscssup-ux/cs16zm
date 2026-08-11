// Ищет в скачанных сборках модели, которые ДЕЙСТВИТЕЛЬНО отличаются от штатных.
//
// Зачем: сборки почти всегда возят полную копию каталога models/, и подавляющее
// большинство файлов в ней — обычные модели самой игры. Взять такую и выдать
// игроку через плагин можно, всё пройдёт без ошибок, и она даже отрисуется —
// просто выглядеть будет ровно как стандартная. Отличить на глаз невозможно,
// поэтому сверяем по хэшу с эталоном из поставки SteamCMD.
//
// Запуск: node tools/find-custom-models.mjs [подстрока-имени]
//   node tools/find-custom-models.mjs v_ak47

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STOCK = join(ROOT, 'build', 'hlds-base', 'cstrike', 'models')
const QUARANTINE = join(ROOT, 'quarantine')

const filter = process.argv[2]

function sha(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function walk(dir, out = []) {
  let names
  try { names = readdirSync(dir) } catch { return out }
  for (const n of names) {
    const p = join(dir, n)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (n.toLowerCase().endsWith('.mdl')) out.push(p)
  }
  return out
}

if (!existsSync(STOCK)) {
  console.error(`нет эталонных моделей: ${STOCK}`)
  console.error('это каталог из поставки SteamCMD, без него сравнивать не с чем')
  process.exit(2)
}

// Эталон: и по хэшу (точное совпадение), и по имени (для отчёта).
const stockByHash = new Map()
const stockNames = new Set()
for (const f of walk(STOCK)) {
  stockByHash.set(sha(f), basename(f))
  stockNames.add(basename(f).toLowerCase())
}
console.log(`эталонных моделей игры: ${stockByHash.size}`)

const builds = existsSync(QUARANTINE)
  ? readdirSync(QUARANTINE).filter(d => existsSync(join(QUARANTINE, d, 'extracted')))
  : []

let sameAsStock = 0
const custom = []

for (const b of builds) {
  for (const f of walk(join(QUARANTINE, b, 'extracted'))) {
    const name = basename(f)
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue

    const h = sha(f)
    if (stockByHash.has(h)) { sameAsStock++; continue }

    custom.push({ build: b, name, path: f, size: statSync(f).size, replacesStock: stockNames.has(name.toLowerCase()) })
  }
}

console.log(`совпало со штатными побайтово: ${sameAsStock}`)
console.log(`отличается от штатных: ${custom.length}\n`)

// Сначала то, что заменяет штатное имя: именно такие модели и есть «HD-паки».
const replacements = custom.filter(c => c.replacesStock)
const originals = custom.filter(c => !c.replacesStock)

if (replacements.length) {
  console.log(`— заменяют штатную модель (${replacements.length}):`)
  for (const c of replacements.slice(0, 40)) {
    console.log(`  ${c.name.padEnd(24)} ${String(c.size).padStart(8)}  ${c.build}`)
  }
  if (replacements.length > 40) console.log(`  ... и ещё ${replacements.length - 40}`)
  console.log()
}

console.log(`— своих имён, в игре таких нет (${originals.length}):`)
for (const c of originals.slice(0, 40)) {
  console.log(`  ${c.name.padEnd(24)} ${String(c.size).padStart(8)}  ${c.build}`)
}
if (originals.length > 40) console.log(`  ... и ещё ${originals.length - 40}`)
