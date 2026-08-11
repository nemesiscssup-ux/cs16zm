// Проверка add-admin.mjs — того самого пути, которым администраторы заводились
// до появления панели.
//
// Написана после разбора, который нашёл в нём две дыры: запись шла в файл без
// общей проверки (кавычка в аргументе превращала строку в «полный админ без
// пароля»), а `--remove a` сносил ВСЕ записи по нику разом.
//
// Настоящий custom/admins.ini не трогается: пути уводятся переменными
// CS16ZM_ADMINS и CS16ZM_INTO.
//
// Запуск: node tools/test-add-admin.mjs

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, 'add-admin.mjs')

const box = mkdtempSync(join(tmpdir(), 'cs16zm-cli-'))
const INI = join(box, 'admins.ini')
for (const base of ['server', 'run'])
  mkdirSync(join(box, base, 'cstrike', 'addons', 'amxmodx', 'configs'), { recursive: true })

const env = { ...process.env, CS16ZM_ADMINS: INI, CS16ZM_INTO: box }

let pass = 0
const fails = []
const ok = (cond, what, extra = '') => {
  if (cond) { pass++; console.log(`  ok    ${what}`) }
  else { fails.push(what); console.log(`  ПЛОХО ${what}${extra ? ` — ${extra}` : ''}`) }
}

// Возвращает { code, out } и НЕ бросает: половина проверок как раз про отказы.
function cli(...args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

const ini = () => { try { return readFileSync(INI, 'utf8') } catch { return '' } }
const users = where => {
  try { return readFileSync(join(box, where, 'cstrike', 'addons', 'amxmodx', 'configs', 'users.ini'), 'utf8') }
  catch { return '' }
}

try {
  console.log('\n— обычная работа —')
  let r = cli('--nick', 'Игорь', '--flags', 'pqst', '--password', 'proba1')
  ok(r.code === 0 && ini().includes('"Игорь" "proba1" "pqst" "a"'), 'запись по нику', ini().trim())
  ok(users('server').includes('"Игорь"') && users('run').includes('"Игорь"'), 'разложено в обе сборки')

  r = cli('--steamid', 'STEAM_0:1:7', '--flags', 't', '--password', 'proba2')
  ok(r.code === 0 && ini().includes('"STEAM_0:1:7" "proba2" "t" "ca"'), 'запись по SteamID со флагом «c»')

  r = cli('--list')
  ok(r.code === 0 && r.out.includes('********') && !r.out.includes('proba1'), 'список прячет пароли')

  console.log('\n— кавычка в аргументе (было: тихо писался полный админ) —')
  const before = ini()
  r = cli('--nick', 'Вася" "" "abcdefghijklmnopqrstu" "e', '--password', 'secret123', '--flags', 't')
  ok(r.code !== 0, 'запись отбита', `код ${r.code}`)
  ok(ini() === before, 'файл не изменился')
  ok(!ini().includes('abcdefghijklmnopqrstu'), 'полный админ без пароля НЕ появился')

  r = cli('--nick', 'Петя', '--password', 'ab"cd', '--flags', 't')
  ok(r.code !== 0 && !ini().includes('Петя'), 'кавычка в пароле тоже отбита')

  r = cli('--nick', 'Коля', '--password', 'x', '--flags', 'tz')
  ok(r.code !== 0 && !ini().includes('Коля'), 'буква флага вне a…u отбита')

  console.log('\n— длина имени в БАЙТАХ, а не в буквах —')
  r = cli('--nick', 'я'.repeat(16), '--password', 'x', '--flags', 't')
  ok(r.code !== 0, 'русский ник в 32 байта отбит — в игре он обрежется', `код ${r.code}`)
  r = cli('--nick', 'я'.repeat(15), '--password', 'x', '--flags', 't')
  ok(r.code === 0, 'а в 30 байт проходит')
  cli('--remove', 'я'.repeat(15))

  console.log('\n— снятие (было: `--remove a` выкашивал всё) —')
  ok(ini().includes('"Игорь"') && ini().includes('"STEAM_0:1:7"'), 'обе записи на месте до снятия')
  r = cli('--remove', 'a')
  ok(r.code !== 0, '«--remove a» отвечает, что такой записи нет', `код ${r.code}`)
  ok(ini().includes('"Игорь"') && ini().includes('"STEAM_0:1:7"'), 'и НИЧЕГО не удалил')

  r = cli('--remove', 't')
  ok(r.code !== 0 && ini().includes('"Игорь"'), 'буква флага тоже не считается именем')

  r = cli('--remove', 'Игорь')
  ok(r.code === 0 && !ini().includes('"Игорь"'), 'снятие по имени работает')
  ok(!users('run').includes('"Игорь"'), 'и доезжает до сборки')
  ok(ini().includes('"STEAM_0:1:7"'), 'соседняя запись цела')

  console.log('\n— повтор ключа —')
  cli('--nick', 'Vasya', '--password', 'x', '--flags', 't')
  r = cli('--nick', 'VASYA', '--password', 'y', '--flags', 's')
  ok(r.code !== 0, 'латиница в другом регистре — это тот же ключ, запись отбита', `код ${r.code}`)
  ok((ini().match(/"Vasya"|"VASYA"/g) || []).length === 1, 'двойника не появилось')

  r = cli('--nick', 'ВАСЯ', '--password', 'x', '--flags', 't')
  ok(r.code === 0, 'а русский в другом регистре — другой игрок, как и для сервера')
} finally {
  rmSync(box, { recursive: true, force: true })
}

console.log(`\nитог: ${pass} ok, ${fails.length} плохо`)
if (fails.length) { fails.forEach(f => console.log(`  провал: ${f}`)); process.exit(1) }
