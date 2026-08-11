// Добавляет администратора на сервер.
//
// Записи хранятся в custom/admins.ini (вне репозитория — там пароли) и
// подмешиваются в users.ini при сборке. Этот же инструмент сразу обновляет
// собранный server/, чтобы не пересобирать всё целиком.
//
// Примеры:
//   node tools/add-admin.mjs --nick "Вася" --password секрет
//   node tools/add-admin.mjs --steamid STEAM_0:1:12345 --password секрет
//   node tools/add-admin.mjs --list
//   node tools/add-admin.mjs --remove "Вася"

import { randomBytes } from 'node:crypto'

import {
  ADMINS_FILE, ALL_FLAGS, TIERS,
  accountFlags, checkAdmin, formatAdminLine, parseAdminLine,
  readAdmins, sameKey, saveAdmins, syncUsersIni,
} from './users-ini.mjs'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i++ }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

if (args.help || Object.keys(args).length === 0) {
  console.log(`Добавление администратора Zombie Plague.

  --nick "Имя"          вход по нику из игры (нужен и пароль)
  --steamid STEAM_0:... вход по SteamID (надёжнее ника)
  --password ПАРОЛЬ     пароль; если не указать — будет сгенерирован
  --nopass              БЕЗ пароля (флаг «e»). Права получит любой под этим
                        именем, защиты ника нет. Только для закрытого теста.
  --flags СТРОКА        права доступа, по умолчанию все (${ALL_FLAGS})
  --account СТРОКА      флаги записи; по умолчанию "a" для ника и "ca" для
                        SteamID. «a» = защита ника (чужого отключит),
                        добавьте «b», чтобы ловить и ники ВНУТРИ чужих имён
  --list                показать текущий список (пароли скрыты)
  --list --show         то же, но с паролями
  --remove КТО          убрать запись

Уровни привилегий задаются через --flags, и буквы НЕ совпадают с названием
константы: ADMIN_LEVEL_H — это «t». Строка накопительная, младшие буквы нужны:
${TIERS.map((t, i) => `  ${t.name.padEnd(10)} --flags "${TIERS.slice(0, i + 1).map(x => x.letter).sort().join('')}"`).join('\n')}

То же самое мышкой, вместе со списком выданного: admin.cmd в корне проекта.

Файл с записями: ${ADMINS_FILE}
В репозиторий он не попадает — в нём пароли.`)
  process.exit(0)
}

let lines = readAdmins()

if (args.list) {
  const entries = lines.filter(l => !l.trimStart().startsWith(';'))
  // Пароль по умолчанию скрыт: список часто показывают через плечо или в логах.
  if (!entries.length) console.log('администраторов нет')
  else entries.forEach(l => console.log(`  ${args.show ? l : l.replace(/"([^"]*)"(\s+)"[^"]*"/, '"$1"$2"********"')}`))
  if (entries.length && !args.show) console.log('\n(пароли скрыты; показать: --list --show)')
  process.exit(0)
}

if (args.remove) {
  const before = lines.length
  // Сравниваем разобранное ИМЯ, а не подстроку по всей строке: `--remove a`
  // раньше выкашивал все записи по нику разом — у каждой последнее поле
  // равно "a", и подстрока `"a"` находилась в нём.
  lines = lines.filter(l => {
    const e = parseAdminLine(l)
    return !(e !== null && sameKey(e.who, args.remove))
  })
  if (lines.length === before) { console.error(`записи «${args.remove}» нет`); process.exit(1) }
  saveAdmins(lines)
  const [first] = syncUsersIni()
  console.log(`убрано: ${args.remove}; в списке осталось ${first ? first.count : 0}`)
  process.exit(0)
}

const who = args.steamid ?? args.nick
if (!who || who === true) {
  console.error('нужен --nick "Имя" или --steamid STEAM_0:...   (--help для справки)')
  process.exit(2)
}

if (args.steamid && !/^STEAM_[0-9]:[01]:\d+$/.test(String(args.steamid))) {
  console.error(`«${args.steamid}» не похож на SteamID (ожидается вид STEAM_0:1:12345)`)
  process.exit(2)
}

// Пароль обязателен в обоих случаях. По SteamID можно и без него (флаг «e»),
// но сервер рассчитан на ReUnion, то есть пускает игроков без Steam, а у них
// SteamID выдаётся сервером и его можно подделать. Пароль это закрывает.
const generated = !args.nopass && (args.password === undefined || args.password === true)
const password = args.nopass ? ''
  : generated ? randomBytes(9).toString('base64url')
  : String(args.password)
const flags = args.flags && args.flags !== true ? String(args.flags) : ALL_FLAGS

// «c» — ключ является SteamID; «a» — выкинуть с сервера при неверном пароле.
// Флаг «a» и есть защита ника: admin.amxx сверяет имя без учёта регистра и
// отключает любого, кто пришёл под ним без правильного пароля.
// «b» дополнительно ловит ники, лишь СОДЕРЖАЩИЕ строку (sadking2, xX_sadking).
//
// «e» — пароль НЕ проверяется. Тогда права получает любой, кто взял этот ник:
// защиты ника больше нет, и это ровно то, за что мы ругали чужие сборки.
// Годится, пока сервер не виден снаружи.
const account = args.account && args.account !== true
  ? String(args.account)
  : accountFlags({ steamid: Boolean(args.steamid), nopass: Boolean(args.nopass) })

// Сверяем по правилам сервера: у него регистр латиницы не важен, и вторая
// запись с тем же ключом просто не сработает — берётся первая по файлу.
const twin = lines.map(parseAdminLine).find(e => e !== null && sameKey(e.who, who))
if (twin) {
  console.error(`запись «${twin.who}» уже есть — сначала уберите её: --remove "${twin.who}"`)
  process.exit(1)
}

// Та же проверка, что и у панели: без неё кавычка в аргументе разваливает
// строку на другие поля, и AMXX читает её как «полный админ без пароля»,
// хотя в консоль напечатано совсем другое.
const bad = checkAdmin({ who, password, flags, account })
if (bad.length) {
  bad.forEach(m => console.error(m))
  process.exit(2)
}

lines.push(formatAdminLine({ who, password, flags, account }))
saveAdmins(lines)
const [target] = syncUsersIni()
const count = target ? target.count : 0

console.log(`добавлен администратор: ${who}`)
console.log(`  пароль: ${args.nopass ? 'НЕ ТРЕБУЕТСЯ' : password + (generated ? '  (сгенерирован)' : '')}`)
console.log(`  права:  ${flags}${flags === ALL_FLAGS ? ' (полные)' : ''}`)
console.log(`  запись: custom/admins.ini${count ? `, в users.ini записей ${count}` : ''}`)
console.log('')

if (args.nopass) {
  console.log('Как войти: просто играть под этим именем, пароль не спрашивается.')
  console.log('')
  console.log('ВНИМАНИЕ: права получит ЛЮБОЙ, кто возьмёт это имя, и защиты ника')
  console.log('больше нет. Перед тем как открыть сервер наружу, верните пароль:')
  console.log(`  node tools/add-admin.mjs --remove "${who}"`)
  console.log(`  node tools/add-admin.mjs --nick "${who}"`)
} else {
  console.log('Как войти в игре:')
  console.log('  1. открыть консоль (~) и один раз ввести:')
  console.log(`       setinfo _pw "${password}"`)
  if (args.nick) console.log(`  2. играть под ником ${who}`)
  console.log(`  ${args.nick ? '3' : '2'}. зайти на сервер и нажать M — там ${
    flags.includes('u') ? 'появится «Админ-меню»' : 'пункт «Привилегии», в нём свои ножи и скины'}`)
}
