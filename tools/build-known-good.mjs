// Строит базу заведомо оригинальных файлов по распакованному апстриму.
//
// Совпадение SHA256 файла из скачанной сборки с этой базой — единственное
// доказательство подлинности, которое вообще возможно получить статически.
//
// Запуск: node tools/build-known-good.mjs

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative, resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REF = join(ROOT, 'upstream', 'reference')
const INTERESTING = new Set(['.amxx', '.dll', '.so', '.exe', '.inc', '.sma'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

if (!existsSync(REF)) {
  console.error(`нет каталога ${REF} — сначала распакуйте апстрим`)
  process.exit(2)
}

const hashes = {}
const names = new Set()
let counted = 0
for (const p of walk(REF)) {
  const ext = extname(p).toLowerCase()
  if (!INTERESTING.has(ext)) continue
  const h = createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase()
  const label = relative(REF, p).split(sep).join('/')
  if (!hashes[h]) { hashes[h] = label; counted++ }
  // Имена файлов из официальных поставок. Совпало имя, но не хэш — значит либо
  // другая версия, либо подмена; и то и другое требует ручной сверки.
  if (ext === '.amxx' || ext === '.sma') names.add(basename(p).toLowerCase())
}

writeFileSync(join(ROOT, 'tools', 'rules', 'known-good.json'),
  JSON.stringify({
    generated: new Date().toISOString(),
    source: 'upstream/reference',
    officialNames: [...names].sort(),
    hashes,
  }, null, 2))

const byExt = {}
for (const label of Object.values(hashes)) {
  const e = extname(label).toLowerCase()
  byExt[e] = (byExt[e] ?? 0) + 1
}
console.log(`доверенных файлов: ${counted}`)
console.log(`по типам: ${JSON.stringify(byExt)}`)
