// Переносит накопленное из файлов-хранилищ и списка администраторов в базу.
//
// ЗАЧЕМ. Кредиты, классы, ножи и скины игроков уже год лежат в nVault, а
// привилегии — в custom/admins.ini. Переход на базу без переноса означал бы,
// что в первый же вечер все зашли пустыми, а владелец остался без прав на
// своём сервере.
//
// ПОЧЕМУ ФАЙЛОМ .sql, А НЕ ПРЯМОЙ ЗАПИСЬЮ. У нас нет и не будет клиента MySQL
// в инструментах: тащить ради одного разового переноса чужую библиотеку (а с
// ней и её обновления, и её уязвимости) — плохой размен. Готовый файл
// заливается в панели хостинга через phpMyAdmin за полминуты, и его перед этим
// видно глазами: что именно уедет в базу.
//
// ⚠️ ФОРМАТ nVault РАЗБИРАЕТСЯ ЗДЕСЬ ВРУЧНУЮ, готового чтения снаружи нет.
// Заголовок «TLVn», дальше подряд записи:
//
//   время     4 байта, unix-время последней записи
//   длина ключа   1 байт
//   длина значения 1 байт
//   резерв        1 байт
//   ключ, значение — подряд, без разделителей
//
// Проверено на живых файлах сервера: ключи «ник:Kenny», значения «0».
//
// Запуск:
//   node tools/db-migrate.mjs                     — из run/ (локальный прогон)
//   node tools/db-migrate.mjs --vault <каталог>   — из чужой копии сервера

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseAdminLine } from './users-ini.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'dist', 'db', 'migrate.sql')

const argAt = process.argv.indexOf('--vault')
const VAULT = argAt > 0 && process.argv[argAt + 1]
  ? resolve(process.argv[argAt + 1])
  : join(ROOT, 'run', 'cstrike', 'addons', 'amxmodx', 'data', 'vault')

/** Разбирает файл nVault в пары «ключ → значение». */
export function readVault(path) {
  if (!existsSync(path)) return null

  const buf = readFileSync(path)
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'TLVn') {
    throw new Error(`${path}: не похоже на nVault (нет метки TLVn)`)
  }

  const out = new Map()
  // Заголовок: метка (4) + версия (2) + ещё 4 служебных байта. Дальше записи.
  let at = 10
  while (at + 7 <= buf.length) {
    const keyLen = buf[at + 4]
    const valLen = buf[at + 5]
    const start = at + 7
    if (!keyLen || start + keyLen + valLen > buf.length) break

    const key = buf.toString('utf8', start, start + keyLen)
    const val = buf.toString('utf8', start + keyLen, start + keyLen + valLen)
    out.set(key, val)
    at = start + keyLen + valLen
  }
  return out
}

// Кавычки и обратные косые в значениях экранируем: ник игрока пишет чужой
// человек, и одинарная кавычка в нём не должна ломать перенос.
const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`

const lines = [
  '-- Перенос накопленного в базу. Собран tools/db-migrate.mjs.',
  '--',
  '-- Как заливать: панель хостинга -> phpMyAdmin -> нужная база -> «Импорт».',
  '-- Повторный запуск безопасен: таблицы создаются только если их нет, а',
  '-- строки заменяются целиком (REPLACE INTO), а не дублируются.',
  '',
  'CREATE TABLE IF NOT EXISTS zm_progress (steamid VARBINARY(64) NOT NULL PRIMARY KEY, name VARBINARY(64) NOT NULL DEFAULT \'\', packs INTEGER NOT NULL DEFAULT 0, zclass VARBINARY(48) NOT NULL DEFAULT \'\', updated INTEGER NOT NULL DEFAULT 0);',
  'CREATE TABLE IF NOT EXISTS zm_knife (steamid VARBINARY(64) NOT NULL PRIMARY KEY, knife VARBINARY(40) NOT NULL DEFAULT \'\');',
  'CREATE TABLE IF NOT EXISTS zm_skin (steamid VARBINARY(64) NOT NULL PRIMARY KEY, worn VARBINARY(40) NOT NULL DEFAULT \'\', owned VARBINARY(255) NOT NULL DEFAULT \'\');',
  'CREATE TABLE IF NOT EXISTS zm_stats (steamid VARBINARY(64) NOT NULL PRIMARY KEY, name VARBINARY(64) NOT NULL DEFAULT \'\', kills INTEGER NOT NULL DEFAULT 0, infections INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, minutes INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0);',
  // ⚠️ zm_admins ЗДЕСЬ НЕ СОЗДАЁМ: это ПРЕДСТАВЛЕНИЕ сайта над zm_privileges.
  // Таблица с таким именем заняла бы его место, и сайт не смог бы его создать.
  '',
]

const counts = {}
const now = Math.floor(Date.now() / 1000)

// ── прогресс: кредиты и класс зомби ────────────────────────────────────────────
const progress = readVault(join(VAULT, 'zpprogress.vault'))
if (progress) {
  lines.push('-- кредиты и класс зомби')
  for (const [key, val] of progress) {
    // Запись: «<кредиты> <имя класса>». Имя класса бывает из двух слов, поэтому
    // режем только по первому пробелу.
    const space = val.indexOf(' ')
    const packs = parseInt(space < 0 ? val : val.slice(0, space), 10) || 0
    const zclass = space < 0 ? '' : val.slice(space + 1).trim()
    lines.push(`REPLACE INTO zm_progress (steamid, name, packs, zclass, updated) VALUES (${q(key)}, '', ${packs}, ${q(zclass)}, ${now});`)
  }
  counts['кредиты и классы'] = progress.size
  lines.push('')
}

// ── ножи ───────────────────────────────────────────────────────────────────────
//
// ⚠️ В СТАРЫХ ЗАПИСЯХ ЛЕЖИТ НОМЕР, А НЕ ИМЯ. Номер — это место ножа в таблице
// плагина, а владелец её уже дважды перетасовывал. Переводим номера в имена
// моделей по нынешнему порядку — это лучшее, что можно сделать, но если после
// последней перетасовки игрок нож не перевыбирал, ему могло достаться не то.
// Дальше такого не будет: плагин теперь хранит имя.
const knifeModels = (() => {
  const src = readFileSync(join(ROOT, 'custom', 'plugins', 'zp_knives.sma'), 'utf8')
  const rows = [...src.matchAll(/^\s*\{ "[^"]*",\s*"[^"]*",\s*"([^"]+)"/gm)].map(m => m[1])
  return rows.map(p => p.split(/[\\/]/).pop())
})()

const knives = readVault(join(VAULT, 'zpknives.vault'))
if (knives) {
  lines.push('-- выбранный нож')
  let guessed = 0
  for (const [key, val] of knives) {
    let name = val
    if (/^\d+$/.test(val)) {
      const i = Number(val)
      name = i > 0 && i < knifeModels.length ? knifeModels[i] : ''
      if (name) guessed++
    }
    lines.push(`REPLACE INTO zm_knife (steamid, knife) VALUES (${q(key)}, ${q(name)});`)
  }
  counts['ножи'] = knives.size
  if (guessed) counts['ножи — номер переведён в имя'] = guessed
  lines.push('')
}

// ── скины ──────────────────────────────────────────────────────────────────────
const skins = readVault(join(VAULT, 'zpskins.vault'))
if (skins) {
  lines.push('-- надетый и купленные скины')
  // «-» — наш заполнитель пустого, а голое число — запись ЕЩЁ более старая, от
  // тех времён, когда скин хранился номером. Номер давно указывает на другой
  // скин, поэтому не переводим его, а честно очищаем: пусть игрок выберет
  // заново, это лучше, чем выдать ему чужую покупку.
  const clean = s => (!s || s === '-' || /^\d+$/.test(s) ? '' : s)
  for (const [key, val] of skins) {
    const space = val.indexOf(' ')
    const worn = clean((space < 0 ? val : val.slice(0, space)).trim())
    const owned = (space < 0 ? '' : val.slice(space + 1).trim())
      .split(',').map(s => clean(s.trim())).filter(Boolean).join(',')
    lines.push(`REPLACE INTO zm_skin (steamid, worn, owned) VALUES (${q(key)}, ${q(worn)}, ${q(owned)});`)
  }
  counts['скины'] = skins.size
  lines.push('')
}

// ── привилегии НЕ ПЕРЕНОСИМ ────────────────────────────────────────────────────
//
// ⚠️ ИМИ ВЛАДЕЕТ САЙТ. Он ведёт таблицу zm_privileges со СРОКОМ действия и
// отдаёт серверу представление zm_admins, где просроченного уже нет
// (docs/2026-08-11-site-integration.md). Записать сюда своё — значит вписать
// строку в это представление, то есть в таблицу сайта, и без срока: такая
// привилегия станет вечной и не будет видна в панели продаж.
//
// Запасной вход владельца остаётся в custom/admins.ini: SQL-вариант плагина
// админов читает его, когда база недоступна.
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, lines.join('\n'), 'utf8')

console.log(`хранилища читались из: ${VAULT}`)
if (!existsSync(VAULT)) console.log('! каталога нет — перенеслись только привилегии, если они есть')
for (const [what, n] of Object.entries(counts)) console.log(`  ${what}: ${n}`)
if (!Object.keys(counts).length) console.log('  переносить нечего')
console.log(`\nготово: ${OUT}`)
console.log('заливать: панель хостинга -> phpMyAdmin -> ваша база -> «Импорт»')
