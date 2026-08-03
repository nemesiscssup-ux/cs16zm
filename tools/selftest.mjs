// Регрессионная проверка разборщика .amxx на заведомо честном корпусе.
// Официальные плагины AMX Mod X должны разбираться все до одного и без ошибок.
// Заодно снимает профиль «нормы»: какие нативы и как часто встречаются в чистых плагинах.

import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { inspectFile } from './amxx.mjs'

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (extname(name).toLowerCase() === '.amxx') out.push(p)
  }
  return out
}

const dir = process.argv[2]
const baselineOut = process.argv[3]
if (!dir) {
  console.error('использование: node selftest.mjs <каталог> [baseline.json]')
  process.exit(2)
}

const files = walk(dir)
if (files.length === 0) {
  console.error(`в ${dir} не найдено ни одного .amxx`)
  process.exit(1)
}

let ok = 0
const failures = []
const nativeCount = new Map()
const libCount = new Map()
let totalStrings = 0

for (const f of files) {
  let res
  try {
    res = inspectFile(f)
  } catch (err) {
    failures.push({ file: f, error: `контейнер: ${err.message}` })
    continue
  }
  const bad = res.plugins.filter(p => p.error)
  if (bad.length || res.plugins.length === 0) {
    failures.push({ file: f, error: bad.map(b => b.error).join('; ') || 'нет секций' })
    continue
  }
  ok++
  for (const p of res.plugins) {
    for (const n of p.natives) nativeCount.set(n, (nativeCount.get(n) ?? 0) + 1)
    for (const l of p.libraries) libCount.set(l, (libCount.get(l) ?? 0) + 1)
    totalStrings += p.strings.length
  }
}

console.log(`файлов .amxx: ${files.length}`)
console.log(`разобрано без ошибок: ${ok}`)
console.log(`сбоев: ${failures.length}`)
for (const f of failures) console.log(`  ПРОВАЛ ${basename(f.file)}: ${f.error}`)
console.log(`уникальных нативов: ${nativeCount.size}, строк всего: ${totalStrings}`)
console.log(`библиотеки-модули: ${[...libCount.keys()].join(', ') || '—'}`)

if (baselineOut) {
  const baseline = {
    source: dir,
    plugins: ok,
    natives: Object.fromEntries([...nativeCount].sort((a, b) => b[1] - a[1])),
    libraries: Object.fromEntries([...libCount].sort((a, b) => b[1] - a[1])),
  }
  writeFileSync(baselineOut, JSON.stringify(baseline, null, 2))
  console.log(`профиль нормы записан: ${baselineOut}`)
}

process.exit(failures.length ? 1 : 0)
