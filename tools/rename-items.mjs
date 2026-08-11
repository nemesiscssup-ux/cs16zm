// Приводит названия чужих спец-вещей к нашему виду: [Тип] Название (свойства).
//
// Перенесённые плагины называют себя как попало: «[А] \rAK-47 Long»,
// «[П] \rMG-3 Neon», «Броня \r[+100]». В списке из трёх десятков вещей это
// каша — сокращения у всех свои, а цветовые метки посреди строки мешают читать.
//
// Тип берём из ИМЕНИ ФАЙЛА плагина, а не из подписи: у них [П] стоит и у
// пистолета, и у пулемёта, а имя файла говорит однозначно.
//
// Правка идёт по исходникам в custom/plugins, то есть повторяема: перенёс
// заново — прогнал ещё раз.
//
// Запуск: node tools/rename-items.mjs [--dry]

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'custom', 'plugins')
const dry = process.argv.includes('--dry')

// Тип по началу имени файла. Порядок важен: сначала более длинные совпадения.
const TYPES = [
  ['zp_machinegun_', 'Пулемёт'],
  ['zp_automat_', 'Автомат'],
  ['zp_pistol_', 'Пистолет'],
  ['zp_rifle_', 'Винтовка'],
  ['zp_sniper_', 'Снайперская'],
  ['zp_imperator_', 'Особое'],
  ['zp_main_', 'Особое'],
  ['zp_leader_', 'Особое'],
  ['zp_vip_', 'Особое'],
  ['zp_extra_', 'Вещь'],
]

// Убираем цветовые коды и чужие метки типа, оставляя только само название.
function clean(name) {
  return name
    .replace(/\\[rywd]/g, '')          // цветовые коды Pawn внутри строки
    .replace(/^\s*\[[^\]]*\]\s*/, '')  // чужая метка вида [А], [П], [В], [С]
    .replace(/\s{2,}/g, ' ')
    .trim()
}

let changed = 0
for (const f of readdirSync(DIR).filter(n => n.endsWith('.sma')).sort()) {
  const type = TYPES.find(([p]) => f.startsWith(p))?.[1]
  if (!type) continue

  const path = join(DIR, f)
  const text = readFileSync(path, 'utf8')

  // Только живая регистрация. У части плагинов строка закомментирована — такие
  // вещи в магазине не появляются вовсе, и править в них нечего: правка ушла бы
  // в комментарий и только запутала следующего читателя.
  //
  // Ищем построчно, а не одним выражением: отрицательный просмотр вперёд здесь
  // обходится возвратом (движок сдвигает начало и находит вызов за «//»).
  const line = text.split('\n').find(l =>
    !l.trimStart().startsWith('//') && l.includes('zp_register_extra_item('))
  if (!line) continue

  const m = line.match(/zp_register_extra_item\(\s*"([^"]+)"/)
  if (!m) continue
  if (m[1].startsWith('[')) {
    // Уже наш вид — второй раз не трогаем, иначе метка удвоится.
    const already = /^\[(Пистолет|Дробовик|Автомат|Пулемёт|Снайперская|Винтовка|Особое|Вещь)\]/.test(m[1])
    if (already) continue
  }

  const title = `[${type}] ${clean(m[1])}`
  const next = text.replace(
    /zp_register_extra_item\(\s*"[^"]+"/,
    `zp_register_extra_item("${title}"`)

  console.log(`  ${f.replace('.sma', '').padEnd(36)} ${m[1]}  ->  ${title}`)
  if (!dry) writeFileSync(path, next, 'utf8')
  changed++
}

console.log(`\nпереименовано: ${changed}`)
