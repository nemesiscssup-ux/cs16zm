// Сборка списка администраторов (users.ini).
//
// Сами учётные записи лежат в custom/admins.ini — он НЕ в репозитории, потому
// что содержит пароли. Сборка подмешивает его в users.ini; без него список
// остаётся пустым, как и было задумано после аудита чужих сборок.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// CS16ZM_ADMINS и CS16ZM_INTO существуют ТОЛЬКО ради проверок: они уводят
// запись на временный список, чтобы тест не трогал настоящий — в нём пароли.
export const ADMINS_FILE = process.env.CS16ZM_ADMINS
  ? resolve(process.env.CS16ZM_ADMINS)
  : join(ROOT, 'custom', 'admins.ini')

const HEADER = [
  '; Список администраторов. Файл СОБИРАЕТСЯ автоматически из custom/admins.ini —',
  '; править здесь бесполезно, изменения пропадут при следующей сборке.',
  ';',
  '; Добавить администратора:  node tools/add-admin.mjs --help',
  ';',
  '; Формат: "кто" "пароль" "флаги_доступа" "флаги_аккаунта"',
  '; Флаги аккаунта: c — это SteamID, d — это IP, e — пароль НЕ проверяется,',
  ';                 a — выкинуть с сервера при неверном пароле.',
  ';',
  '; Осторожно с «e»: во всех проверенных готовых сборках здесь лежали рабочие',
  '; записи их авторов, а в одной — вход админом просто по нику, без пароля.',
  '',
]

// ── уровни привилегий ───────────────────────────────────────────────────────
//
// Буквы взяты из amxconst.inc, а не по созвучию с названием константы, и это
// не придирка: ADMIN_LEVEL_H — флаг «t», а вовсе не «h». Ошибиться тут легко,
// а видно не сразу — запись в users.ini появится, права нет.
//
// Строка флагов НАКОПИТЕЛЬНАЯ. zp_knives и zp_skins в allowed() проверяют
// ровно тот бит, что записан у ножа или скина, поэтому Создателю с одной
// буквой «o» ножи младших уровней остались бы закрыты.
//
// Числа — что уровень даёт в игре; они должны совпадать с g_tiers в
// custom/plugins/zp_vip.sma, и это сверяет tools/verify-ru.mjs.
// Создатель стоит НАД продаваемой лестницей: это главный администратор, у него
// есть всё, но игрокам он не выдаётся. Верхний покупаемый уровень — Фараон.
// ⚠️ Поле skin — НАЗВАНИЕ облика, а не их количество. Раньше уровень открывал
// сразу несколько скинов и игрок выбирал в меню; по просьбе владельца теперь у
// каждого уровня ровно ОДИН облик, он надевается сам. Название обязано
// совпадать с таблицей в zp_skins.sma и с TSKIN в zp_vip.sma — сверяет verify-ru.
export const TIERS = [
  { id: 'vip',       name: 'VIP',       letter: 't', konst: 'ADMIN_LEVEL_H', packs: 3,  health: 25,  knives: 7,  skin: 'Форма VIP', sold: true },
  { id: 'leader',    name: 'Лидер',     letter: 's', konst: 'ADMIN_LEVEL_G', packs: 6,  health: 50,  knives: 9,  skin: 'Форма 9',   sold: true },
  { id: 'imperator', name: 'Император', letter: 'q', konst: 'ADMIN_LEVEL_E', packs: 10, health: 75,  knives: 10, skin: 'Отпускник', sold: true },
  { id: 'pharaoh',   name: 'Фараон',    letter: 'p', konst: 'ADMIN_LEVEL_D', packs: 15, health: 100, knives: 11, skin: 'Фараон',    sold: true },
  { id: 'creator',   name: 'Создатель', letter: 'o', konst: 'ADMIN_LEVEL_C', packs: 20, health: 150, knives: 11, skin: 'Создатель', sold: false },
]

// Полные права: флаги AMXX идут от «a» до «u», дальше букв нет.
export const ALL_FLAGS = 'abcdefghijklmnopqrstu'

// Админка ПРОДАЁТСЯ, то есть попадает к людям, которых никто не проверял.
// Поэтому набор урезан: кик, бан, слей, чат и админ-меню — и ничего, чем можно
// увести сервер. Нет rcon (l), нет смены карты (f), нет правки кваров (g),
// нет неприкосновенности (a) — купивший админку не должен быть неуязвим для
// других админов. Сроки и число банов дополнительно ограничивает
// custom/plugins/zp_admin_limits.sma.
export const ADMIN_FLAGS = 'bcdeiju'

// Флаги уровня: он сам и все младшие. Порядок букв AMXX безразличен, но по
// алфавиту их проще сверять глазами со строкой в users.ini.
export function tierFlags(index) {
  return TIERS.slice(0, index + 1).map(t => t.letter).sort().join('')
}

// Наивысший уровень в строке флагов, иначе -1. Так же считает tier_of() в
// zp_vip.sma: перебор идёт снизу вверх, побеждает последний подошедший.
export function tierOf(flags) {
  let best = -1
  TIERS.forEach((t, i) => { if (flags.includes(t.letter)) best = i })
  return best
}

// «c» — ключ является SteamID; «a» — выкинуть с сервера при неверном пароле;
// «e» — пароль не проверяется вовсе. Одна функция на CLI и на веб-панель,
// чтобы два входа не разъехались в правилах.
export function accountFlags({ steamid = false, nopass = false } = {}) {
  return `${steamid ? 'c' : ''}${nopass ? 'e' : 'a'}`
}

// Одна ли это запись в глазах сервера. admin.sma сверяет ключи через equali(),
// а это strncasecmp по байтам: регистр складывается ТОЛЬКО у латиницы.
// Значит «Vasya» и «vasya» для сервера один игрок, а «Игорь» и «игорь» — разные,
// и вести себя надо так же, иначе панель склеит две настоящие учётки.
const foldAscii = s => s.replace(/[A-Z]/g, c => c.toLowerCase())
export const sameKey = (a, b) => foldAscii(String(a)) === foldAscii(String(b))

// Разные для сервера, но похожие для человека: тот же ключ с точностью до
// регистра любых букв. Не ошибка, но об этом стоит предупредить вслух.
export const looksAlike = (a, b) => !sameKey(a, b)
  && String(a).toLowerCase() === String(b).toLowerCase()

const LINE = /^\s*"([^"]*)"\s+"([^"]*)"\s+"([^"]*)"\s+"([^"]*)"\s*$/

export function parseAdminLine(line) {
  const m = LINE.exec(line)
  return m ? { who: m[1], password: m[2], flags: m[3], account: m[4] } : null
}

export function formatAdminLine({ who, password, flags, account }) {
  return `"${who}" "${password}" "${flags}" "${account}"`
}

// Что нельзя записывать в users.ini. Кавычка ломает разбор файла: строка
// распадётся на поля не там, где задумано, и права уедут не тому. Управляющие
// символы — та же беда, только незаметная: перевод строки разрежет запись
// надвое, а нулевой байт оборвёт её при чтении.
// Длина 31 — предел имени игрока в движке.
const FORBIDDEN = /["\u0000-\u001f\u007f]/

export function checkAdmin({ who, password, flags, account }) {
  const bad = []
  // Длину меряем в БАЙТАХ, а не в буквах: движок держит имя в 31 байте, а
  // кириллическая буква занимает два. Русский ник из шестнадцати букв туда уже
  // не влезает — он обрежется в игре и не совпадёт с записью никогда.
  const bytes = s => Buffer.byteLength(String(s), 'utf8')

  if (!who) bad.push('не указано, кому выдаём')
  else if (FORBIDDEN.test(who)) bad.push('в имени есть кавычка или служебный символ — так users.ini не разобрать')
  else if (bytes(who) > 31) bad.push(
    `имя не влезает: ${bytes(who)} байт из 31 (русская буква занимает два) — в игре оно обрежется и не совпадёт`)

  if (FORBIDDEN.test(password)) bad.push('в пароле есть кавычка или служебный символ')
  else if (bytes(password) > 31) bad.push(`пароль не влезает: ${bytes(password)} байт из 31`)

  if (!/^[a-u]+$/.test(flags)) bad.push('флаги доступа — только буквы от «a» до «u», без пробелов')
  if (!/^[abcde]+$/.test(account)) bad.push('флаги записи — только буквы «a», «b», «c», «d», «e»')
  if (account.includes('c') && !/^STEAM_[0-9]:[01]:\d+$/.test(who))
    bad.push(`«${who}» не похож на SteamID (ожидается вид STEAM_0:1:12345)`)
  return bad
}

// Путь можно подменить — этим пользуется только проверка панели, чтобы не
// трогать настоящий список с настоящими паролями.
export function readAdmins(file = ADMINS_FILE) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(l => l.trimEnd())
    .filter(l => l.trim() !== '')
}

export function saveAdmins(lines, file = ADMINS_FILE) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
}

// Возвращает число записанных учётных записей.
export function writeUsersIni(amxxDir, file = ADMINS_FILE) {
  const admins = readAdmins(file)
  const body = admins.filter(l => !l.trimStart().startsWith(';'))
  writeFileSync(
    join(amxxDir, 'configs', 'users.ini'),
    [...HEADER, ...(admins.length ? [...admins, ''] : [])].join('\n'),
    'utf8')
  return body.length
}

// Разложить список по всем собранным копиям сервера. server/ — сборка,
// run/ — каталог локального прогона, и читает файл при игре именно он:
// без этого выданная привилегия появится только после пересборки.
const DEFAULT_ROOTS = process.env.CS16ZM_INTO
  ? ['server', 'run'].map(b => join(resolve(process.env.CS16ZM_INTO), b))
  : [join(ROOT, 'server'), join(ROOT, 'run')]

export function syncUsersIni(file = ADMINS_FILE, roots = DEFAULT_ROOTS) {
  const done = []
  for (const root of roots) {
    const amxx = join(root, 'cstrike', 'addons', 'amxmodx')
    if (!existsSync(join(amxx, 'configs'))) continue
    done.push({ where: basename(root), count: writeUsersIni(amxx, file) })
  }
  return done
}
