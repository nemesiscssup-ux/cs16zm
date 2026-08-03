// Показывает, что именно лежит внутри плагина: нативы и строковые литералы.
// Нужен для разбора срабатываний — понять, на что именно среагировало правило.
//
// Запуск: node tools/dump-strings.mjs <файл.amxx> [фильтр-регулярка]

import { inspectFile } from './amxx.mjs'

const [, , file, filter] = process.argv
if (!file) {
  console.error('использование: node tools/dump-strings.mjs <файл.amxx> [регулярка]')
  process.exit(2)
}

const res = inspectFile(file)
const natives = [...new Set(res.plugins.flatMap(p => p.natives ?? []))]
const strings = [...new Set(res.plugins.flatMap(p => p.strings ?? []))]

const re = filter ? new RegExp(filter, 'i') : null
const shown = re ? strings.filter(s => re.test(s)) : strings

console.log(`${file}`)
console.log(`нативов ${natives.length}, строк ${strings.length}${re ? `, подошло под фильтр ${shown.length}` : ''}`)
console.log('')
for (const s of shown) console.log(`  [${s}]`)
