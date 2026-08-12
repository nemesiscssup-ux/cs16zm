// Собирает чистый сервер из проверенного апстрима.
//
// В server/ не попадает ни одного файла из скачанных сборок: только официальные
// релизы с зафиксированным SHA256 и плагины, скомпилированные здесь же из исходников.
//
// Запуск: node tools/assemble.mjs

import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { customize } from './customize.mjs'
import { writeSqlCfg } from './db-config.mjs'
import { writeUsersIni } from './users-ini.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REF = join(ROOT, 'upstream', 'reference')
const SERVER = join(ROOT, 'server')
const CSTRIKE = join(SERVER, 'cstrike')
const AMXX = join(CSTRIKE, 'addons', 'amxmodx')

const AMXX_LINUX = join(REF, 'amxmodx-1.10.0-git5479-base-linux')
const AMXX_LINUX_CS = join(REF, 'amxmodx-1.10.0-git5479-cstrike-linux')
const AMXX_WIN = join(REF, 'amxmodx-1.10.0-git5479-base-windows')
const AMXX_WIN_CS = join(REF, 'amxmodx-1.10.0-git5479-cstrike-windows')
const METAMOD = join(REF, 'metamod-bin-1.3.0.149')
const REAPI = join(REF, 'reapi-bin-5.29.0.358')
const REUNION = join(REF, 'reunion-0.2.0.25')
const REHLDS = join(REF, 'rehlds-bin-3.15.0.896')
const REGAMEDLL = join(REF, 'regamedll-bin-5.30.0.814')
const ZP = join(ROOT, 'quarantine', 'gamemodd-zp44fix5a-upstream', 'extracted')
const YAPB_LINUX = join(REF, 'yapb-4.4.957-linux')
const YAPB_WIN = join(REF, 'yapb-4.4.957-windows')

const placed = []

function copy(from, to, label) {
  if (!existsSync(from)) { console.log(`! пропущено, нет источника: ${from}`); return }
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
  placed.push({ label, from: relative(ROOT, from).split(sep).join('/'), to: relative(SERVER, to).split(sep).join('/') })
}

// ── чистим и раскладываем ───────────────────────────────────────────────────────

// Прогресс игроков — не продукт сборки, восстановить его неоткуда. Если он тут
// оказался (так будет на хостинге, где сервер работает прямо из этого каталога),
// откладываем его на время пересборки и возвращаем в конце.
const VAULT_REL = ['cstrike', 'addons', 'amxmodx', 'data', 'vault']
const VAULT_STASH = join(ROOT, 'build', 'server-vault')

rmSync(VAULT_STASH, { recursive: true, force: true })
const vaultSrc = join(SERVER, ...VAULT_REL)
const hadVault = existsSync(vaultSrc)
if (hadVault) cpSync(vaultSrc, VAULT_STASH, { recursive: true })

if (existsSync(SERVER)) rmSync(SERVER, { recursive: true, force: true })
mkdirSync(SERVER, { recursive: true })

// 1. AMX Mod X: Linux — боевая платформа, Windows — для локального прогона.
copy(join(AMXX_LINUX, 'addons'), join(CSTRIKE, 'addons'), 'AMX Mod X 1.10 base (linux)')
copy(join(AMXX_LINUX_CS, 'addons'), join(CSTRIKE, 'addons'), 'AMX Mod X 1.10 cstrike (linux)')
copy(join(AMXX_WIN, 'addons'), join(CSTRIKE, 'addons'), 'AMX Mod X 1.10 base (windows)')
copy(join(AMXX_WIN_CS, 'addons'), join(CSTRIKE, 'addons'), 'AMX Mod X 1.10 cstrike (windows)')

// 2. Metamod-r — загрузчик модулей.
copy(join(METAMOD, 'addons', 'metamod'), join(CSTRIKE, 'addons', 'metamod'), 'Metamod-r 1.3.0.149')

// 3. ReAPI — модуль AMXX с доступом к ReHLDS/ReGameDLL.
copy(join(REAPI, 'addons', 'amxmodx', 'modules'), join(AMXX, 'modules'), 'ReAPI 5.29 модули')
copy(join(REAPI, 'addons', 'amxmodx', 'scripting', 'include'), join(AMXX, 'scripting', 'include'), 'ReAPI 5.29 включения')

// 4. ReUnion — поддержка нон-стим клиентов.
copy(join(REUNION, 'bin', 'Linux', 'reunion_mm_i386.so'), join(CSTRIKE, 'addons', 'reunion', 'reunion_mm_i386.so'), 'ReUnion 0.2.0.25 (linux)')
copy(join(REUNION, 'bin', 'Windows', 'reunion_mm.dll'), join(CSTRIKE, 'addons', 'reunion', 'reunion_mm.dll'), 'ReUnion 0.2.0.25 (windows)')
// reunion.cfg кладётся в каталог мода, а НЕ рядом с библиотекой: по Readme ReUnion
// ищет его в server root или gamedir. Из addons/reunion он не читается, и модуль
// молча уходит в «fail load».
// Берём НАШ конфиг, а не родной из архива: в нашем объяснено, почему что
// выставлено, и изменено опознание Setti-клиентов. Родной остаётся в архиве —
// с ним сверяются при обновлении ReUnion.
const OUR_REUNION = join(ROOT, 'custom', 'reunion.cfg')
copy(existsSync(OUR_REUNION) ? OUR_REUNION : join(REUNION, 'reunion.cfg'),
     join(CSTRIKE, 'reunion.cfg'),
     existsSync(OUR_REUNION) ? 'ReUnion: настройки из custom/reunion.cfg' : 'ReUnion конфигурация (родная)')

/*
 * Соль, которой ReUnion считает SteamID игрокам без лицензии.
 *
 * Без неё ReUnion не запускается вовсе («SteamIdHashSalt is not set or too
 * short»). Она же и мешает принести чужой SteamID со стороны: сервер считает
 * свой собственный, зная секрет, которого больше нет ни у кого.
 *
 * ⚠️ ЗДЕСЬ БЫЛА ОШИБКА, И ОНА ЖДАЛА ПЕРВОЙ ПЕРЕСБОРКИ ПОСЛЕ ЗАПУСКА. Соль
 * генерировалась ЗАНОВО при каждом прогоне — при том, что соседний комментарий
 * сам предупреждал, что менять её нельзя. Пока сервер не запущен, это ничего
 * не стоит; после запуска первая же пересборка сменила бы SteamID у всех
 * игроков без лицензии, и кредиты, ножи, облики и привилегии по SteamID стали
 * бы им чужими — молча, без единой ошибки в консоли.
 *
 * Поэтому соль живёт в custom/reunion-salt.txt, вне репозитория (см.
 * .gitignore). Заводится один раз, дальше только читается.
 */
const SALT_FILE = join(ROOT, 'custom', 'reunion-salt.txt')
let reunionSalt = ''
if (existsSync(SALT_FILE)) {
  reunionSalt = readFileSync(SALT_FILE, 'utf8').trim()
}
if (reunionSalt.length < 16) {
  // 48 знаков: родная документация просит от 16 и советует 32 и больше.
  reunionSalt = randomBytes(24).toString('hex')
  writeFileSync(SALT_FILE, reunionSalt + '\n', 'utf8')
  console.log('+ ReUnion: заведена соль custom/reunion-salt.txt — НЕ ТЕРЯЙТЕ ЕЁ')
} else {
  console.log('+ ReUnion: соль взята из custom/reunion-salt.txt')
}

const reunionCfg = join(CSTRIKE, 'reunion.cfg')
if (existsSync(reunionCfg)) {
  const text = readFileSync(reunionCfg, 'latin1')
    .replace(/^SteamIdHashSalt\s*=.*$/m, `SteamIdHashSalt = ${reunionSalt}`)
  writeFileSync(reunionCfg, text, 'latin1')
}

// 5. ReGameDLL — игровая логика.
copy(join(REGAMEDLL, 'bin', 'linux32', 'cstrike', 'dlls', 'cs.so'), join(CSTRIKE, 'dlls', 'cs.so'), 'ReGameDLL 5.30 (linux)')
copy(join(REGAMEDLL, 'bin', 'win32', 'cstrike', 'dlls', 'mp.dll'), join(CSTRIKE, 'dlls', 'mp.dll'), 'ReGameDLL 5.30 (windows)')
for (const f of ['delta.lst', 'game.cfg', 'game_init.cfg']) {
  copy(join(REGAMEDLL, 'bin', 'linux32', 'cstrike', f), join(CSTRIKE, f), `ReGameDLL: ${f}`)
}

// 6. ReHLDS — движок. Кладём отдельно: на хостинге он обычно уже свой.
copy(join(REHLDS, 'bin', 'linux32'), join(SERVER, 'engine-linux'), 'ReHLDS 3.15 (linux)')
copy(join(REHLDS, 'bin', 'win32'), join(SERVER, 'engine-win'), 'ReHLDS 3.15 (windows)')

// 7. Zombie Plague: только исходники и ресурсы, плагины компилируем сами.
const zpSrc = join(ZP, 'zp_plugin_44', 'addons', 'amxmodx')
copy(join(zpSrc, 'scripting'), join(AMXX, 'scripting'), 'Zombie Plague 4.4 исходники')
copy(join(zpSrc, 'configs'), join(AMXX, 'configs'), 'Zombie Plague 4.4 конфигурация')
copy(join(zpSrc, 'data'), join(AMXX, 'data'), 'Zombie Plague 4.4 переводы')
for (const d of ['models', 'sound', 'sprites']) {
  copy(join(ZP, 'zp_resources_v44', d), join(CSTRIKE, d), `Zombie Plague ресурсы: ${d}`)
}

// 8. YaPB — боты. В поставке выделенного сервера CS 1.6 ботов нет вообще:
// боты Condition Zero в неё не входят. Общие файлы (конфиги, языки, графы карт)
// одинаковы в обоих пакетах, различаются только библиотеки.
copy(join(YAPB_LINUX, 'addons', 'yapb'), join(CSTRIKE, 'addons', 'yapb'), 'YaPB 4.4.957 (боты, linux + общие файлы)')
copy(join(YAPB_WIN, 'addons', 'yapb', 'bin', 'yapb.dll'), join(CSTRIKE, 'addons', 'yapb', 'bin', 'yapb.dll'), 'YaPB 4.4.957 (windows)')

const yapbCfg = join(CSTRIKE, 'addons', 'yapb', 'conf', 'yapb.cfg')
if (existsSync(yapbCfg)) {
  let t = readFileSync(yapbCfg, 'utf8')
  // Падаем громко, если настройка исчезла: молча пропущенная строка означала бы
  // сервер с английскими ботами и неожиданным их числом.
  const set = (key, value) => {
    const re = new RegExp(`^${key} "[^"]*"`, 'm')
    if (!re.test(t)) throw new Error(`в yapb.cfg нет настройки ${key} — YaPB обновился?`)
    t = t.replace(re, `${key} "${value}"`)
  }
  set('yb_language', 'ru')
  set('yb_quota', '8')
  set('yb_autovacate', '1')   // боты освобождают слоты, когда приходят живые

  // ⚠️ БОТЫ МОЛЧАТ. Владелец: «убрать звуки ботов в чат и в рацию, надоело
  // флудит». Восемь ботов болтают за восьмерых, и на зомби-сервере это шум
  // поверх шума: разговор живых игроков в нём просто тонет.
  //   yb_chat       — их реплики в чате (и подколки после смерти),
  //   yb_radio_mode — рация и голосовые команды; 0 выключает и то, и другое
  //                   (1 оставил бы рацию, 2 — рацию с болтовнёй).
  set('yb_chat', '0')
  set('yb_radio_mode', '0')
  // Приветствие YaPB в чат при заходе на карту — из той же породы шума.
  set('yb_display_welcome_text', '0')

  writeFileSync(yapbCfg, t, 'utf8')
  console.log('+ YaPB настроен: русский язык, 8 ботов, уступают место живым игрокам,'
    + ' молчат в чате и в рации')
}

// ── наши правки: русский язык, оформление меню и HUD ────────────────────────────
//
// Строго между копированием апстрима и компиляцией: иначе правки либо затрутся
// свежими исходниками, либо не попадут в собранный плагин.

customize({ amxxDir: AMXX })

// ── наши собственные плагины ────────────────────────────────────────────────────
//
// Магазин, показ урона, гранаты зомби и способности классов написаны на открытом
// API мода (zombie_plague_v44.inc), а не правками его исходника: так апстрим
// остаётся нетронутым, а плагины переживают его обновление.

// Свои модели оружия для магазина. Лежат отдельной папкой, чтобы штатное
// оружие сохранило обычный вид: особый ствол должен отличаться от подобранного.
// Кладём прямо в models/, без своей подпапки — ровно так это устроено в чужих
// сборках, где модели на клиентах работают. Имена не пересекаются со штатными
// (v_shop_ak47.mdl), поэтому ничего не затирается.
const OUR_MODELS = join(ROOT, 'custom', 'models')
if (existsSync(OUR_MODELS)) {
  copy(OUR_MODELS, join(CSTRIKE, 'models'), 'наши модели оружия')
}

// Ресурсы перенесённых стволов: модели, звуки, спрайты значков. Раскладка
// внутри custom/content повторяет каталог мода, поэтому копируется как есть.
const OUR_CONTENT = join(ROOT, 'custom', 'content')
if (existsSync(OUR_CONTENT)) {
  for (const d of readdirSync(OUR_CONTENT)) {
    const from = join(OUR_CONTENT, d)
    if (statSync(from).isDirectory()) copy(from, join(CSTRIKE, d), `ресурсы оружия: ${d}`)
  }
}

// Наши включения — прослойки совместимости с чужими версиями мода.
// Кладутся ПОСЛЕ апстрима, чтобы при совпадении имён побеждали наши.
const OUR_INCLUDE = join(ROOT, 'custom', 'include')
if (existsSync(OUR_INCLUDE)) {
  copy(OUR_INCLUDE, join(AMXX, 'scripting', 'include'), 'наши включения совместимости')
}

const OURS = join(ROOT, 'custom', 'plugins')
const ourPlugins = existsSync(OURS)
  ? readdirSync(OURS).filter(f => f.endsWith('.sma')).map(f => basename(f, '.sma')).sort()
  : []
for (const name of ourPlugins) {
  copy(join(OURS, `${name}.sma`), join(AMXX, 'scripting', `${name}.sma`), `наш плагин: ${name}`)
}

// ── компиляция плагинов из исходников ───────────────────────────────────────────

const amxxpc = join(AMXX_WIN, 'addons', 'amxmodx', 'scripting', 'amxxpc.exe')
const scripting = join(AMXX, 'scripting')
const pluginsDir = join(AMXX, 'plugins')
const compiled = []

// ⚠️ admin_sql СОБИРАЕМ ИЗ ТОГО ЖЕ ИСХОДНИКА, что и обычный admin. В AMX Mod X
// это ОДИН плагин, собранный дважды: с «#define USING_SQL» и без него. Готовый
// admin_sql.amxx в поставке есть, но мы кладём поверх свой — с одной добавкой:
// откатом на users.ini, когда база ответила, а список админов в ней ПУСТ.
// Апстрим в этом случае оставляет сервер вообще без прав, включая владельца
// (правки — в tools/customize.mjs).
//
// Имя на выходе другое, чем у исходника, поэтому список — из пар.
const toBuild = [
  { src: 'zombie_plague44' },
  { src: 'zp_zclasses44' },
  { src: 'admin', out: 'admin_sql' },
  ...ourPlugins.map(p => ({ src: p })),
]
for (const { src: name, out: outName = name } of toBuild) {
  const src = join(scripting, `${name}.sma`)
  if (!existsSync(src)) { console.log(`! нет исходника ${name}.sma`); continue }
  const out = join(pluginsDir, `${outName}.amxx`)
  try {
    execFileSync(amxxpc, [src, `-i${join(scripting, 'include')}`, `-o${out}`], { encoding: 'latin1', windowsHide: true })
    const h = createHash('sha256').update(readFileSync(out)).digest('hex').toUpperCase()
    compiled.push({ name: outName, sha256: h, size: statSync(out).size })
    console.log(`+ скомпилирован ${outName}.amxx`)
  } catch (err) {
    console.log(`! ошибка компиляции ${name}: ${err.message.slice(0, 200)}`)
  }
}

// ── конфигурация ────────────────────────────────────────────────────────────────

writeFileSync(join(CSTRIKE, 'addons', 'metamod', 'plugins.ini'), [
  '; Модули Metamod. Каждая строка загружается с полными правами процесса сервера —',
  '; добавлять сюда что-либо без проверки исходников нельзя.',
  '',
  'linux addons/amxmodx/dlls/amxmodx_mm_i386.so',
  'win32 addons\\amxmodx\\dlls\\amxmodx_mm.dll',
  'linux addons/reunion/reunion_mm_i386.so',
  'win32 addons\\reunion\\reunion_mm.dll',
  'linux addons/yapb/bin/yapb.so',
  'win32 addons\\yapb\\bin\\yapb.dll',
  '',
].join('\n'))

// ── база данных ─────────────────────────────────────────────────────────────────
//
// Настройки соединения собираются из custom/db.ini (он вне репозитория, там
// пароль). Нет файла — сборка идёт на SQLite: один файл рядом с сервером.
// Это же и делает проверки воспроизводимыми: им боевая база не нужна.
const dbWhere = writeSqlCfg(AMXX)
console.log(`+ база данных: ${dbWhere.type} (${dbWhere.where})`)

const modulesIni = join(AMXX, 'configs', 'modules.ini')
if (existsSync(modulesIni)) {
  const cur = readFileSync(modulesIni, 'utf8')
  // ⚠️ МОДУЛИ БАЗ ДАННЫХ АВТОМАТИЧЕСКИ НЕ ПОДКЛЮЧАЮТСЯ — про это прямо
  // написано в шапке самого modules.ini. Без строки ниже плагин с запросами
  // не найдёт нативов и не загрузится вовсе, а сервер соберётся молча.
  // Включаем ровно тот, на котором собрана эта сборка: лишний модуль — это
  // лишняя библиотека в памяти и лишняя поверхность.
  const extra = ['', '; Добавлено при сборке', 'reapi', dbWhere.type]
  // Модуль sockets даёт плагинам выход в сеть. Игровому серверу он не нужен.
  const off = cur.split(/\r?\n/).map(l => /^\s*sockets\s*$/.test(l) ? '; sockets — отключён намеренно: сеть плагинам не нужна' : l)
  writeFileSync(modulesIni, [...off, ...extra].join('\n'))
}

const pluginsIni = join(AMXX, 'configs', 'plugins.ini')
if (existsSync(pluginsIni)) {
  let cur = readFileSync(pluginsIni, 'utf8')

  // ⚠️ АДМИНОВ БЕРЁМ ИЗ БАЗЫ САЙТА, А НЕ ИЗ users.ini. Только так у привилегии
  // появляется СРОК: просроченная запись просто перестаёт попадать в выборку —
  // сайт отдаёт серверу представление zm_admins, которое само отбрасывает
  // истёкшие. В users.ini дату хранить негде, там четыре поля без даты.
  //
  // ⚠️ ЗАГРУЖАТЬ РОВНО ОДИН ИЗ ДВУХ. admin.amxx и admin_sql.amxx — это ОДИН
  // плагин, собранный с «#define USING_SQL» и без него. Два сразу — это два
  // списка администраторов, и кто кого затрёт, зависит от порядка загрузки.
  //
  // Не запирает ли это владельца снаружи: SQL-вариант, не достучавшись до базы,
  // сам читает users.ini (а наша правка добавляет то же самое и для случая
  // «база ответила, но список пуст»). custom/admins.ini остаётся запасным входом.
  //
  // ⚠️ Пометка ЛАТИНИЦЕЙ: этот файл пишется однобайтовой кодировкой, и русский
  // комментарий превращается в мусор — так и вышло с первого раза.
  cur = cur
    .replace(/^admin\.amxx/m, ';admin.amxx   ; OFF: admins come from the site database (admin_sql)')
    .replace(/^;admin_sql\.amxx/m, 'admin_sql.amxx')
  // Только ASCII: файл читается движком в однобайтовой кодировке, юникод в нём бьётся.
  // Порядок важен: наши плагины цепляются на те же хуки Ham, что и мод
  // (урон, пересчёт скорости). Обработчик срабатывает в порядке загрузки,
  // поэтому наши обязаны идти НИЖЕ zombie_plague44 — иначе мод затрёт баффы.
  // Один наш плагин обязан идти ВЫШЕ admincmd, а не ниже всех: он перехватывает
  // amx_ban, а обработчики команд вызываются в порядке загрузки. Стой он внизу,
  // admincmd успел бы забанить до нашей проверки, и лимит был бы бумажным.
  const EARLY = 'zp_admin_limits'
  const early = ourPlugins.includes(EARLY) ? [EARLY] : []
  const rest = ourPlugins.filter(n => n !== EARLY)

  // ⚠️ Порядок классов зомби В МЕНЮ — это порядок, в котором плагины их
  // регистрируют, то есть порядок загрузки отсюда. По алфавиту имён файлов
  // Ганимед и Ревенанты вставали между бесплатными классами, и меню читалось
  // как случайный список. Владелец попросил: сначала доступные всем, потом по
  // возрастанию привилегии. Пять штатных классов регистрирует zp_zclasses44
  // строкой выше, дальше идут эти — и менять здесь строки местами значит
  // менять порядок пунктов в игре.
  const CLASS_ORDER = [
    'zp_zclass_electric', // Электрик — всем
    'zp_zclass_student', // Студентка — всем
    'zp_zclass_vip', // Спринтер — всем
    'cso_class_shaman', // Шаман — всем
    'cso_class_ganymede', // Ганимед — VIP
    'cso_class_revenant_fire', // Ревенант Огонь — Лидер
    'cso_class_revenant_ice', // Ревенант Лёд — Император
    'cso_class_revenant_poison_boss', // Ревенант Яд — Фараон
  ]
  // Классовый плагин узнаём по вызову, а не по имени файла: забытый в списке
  // класс тогда не молчит, а сам о себе сообщает.
  const classPlugins = rest.filter(n =>
    readFileSync(join(OURS, `${n}.sma`), 'utf8').includes('zp_register_zombie_class'))
  const unlisted = classPlugins.filter(n => !CLASS_ORDER.includes(n))
  if (unlisted.length) {
    console.log(`! классовые плагины вне CLASS_ORDER: ${unlisted.join(', ')} — встанут в конец меню`)
  }
  const classes = [...CLASS_ORDER.filter(n => classPlugins.includes(n)), ...unlisted]
  const plain = rest.filter(n => !classPlugins.includes(n))

  // ⚠️ ПОРЯДОК ПОЗИЦИЙ В СПЕЦ-МАГАЗИНЕ — ЭТО ТОЖЕ ПОРЯДОК ЗАГРУЗКИ. Мод
  // показывает спец-вещи в том порядке, в каком их зарегистрировали. По алфавиту
  // имён файлов получалась каша: шесть автоматов, потом броня, потом пулемёт,
  // потом пистолет, потом снайперская. Владелец попросил один вид — вид это и
  // порядок тоже. Здесь список идёт по типам, как в самих названиях.
  //
  // ⚠️ ОДНОЙ ЭТОЙ СТРОКОЙ ПОРЯДОК НЕ ЗАДАЁТСЯ. AMXX проходит все плагины
  // сначала на предзагрузке (plugin_precache) и только потом на запуске
  // (plugin_init): что бы ни стояло здесь, зарегистрированное на предзагрузке
  // встанет выше. Магазин оружия регистрирует свои девятнадцать стволов именно
  // там и поэтому всегда первый — остальные вещи регистрируются на запуске, и
  // вот их порядок задаёт этот список.
  const SHOP_ORDER = [
    'zp_shop_weapons', // 19 стволов: [П] [Д] [А] [Пм] [С] [В] — регистрирует на предзагрузке
    'zp_pistol_elephant', // [П]
    'zp_automat_ak47long', // [А]
    'zp_automat_aquablaster', // [А]
    'zp_automat_arxmoto', // [А]
    'zp_automat_devilbaby', // [А]
    'zp_automat_famas_pixel', // [А]
    'zp_automat_lego_crow3', // [А]
    'zp_machinegun_mg3neon', // [Пм]
    'zp_sniper_savery', // [С]
    'zp_rifle_falconvsk94', // [С]
    'zp_rifle_pandacrossbow', // [В]
    'zp_vip_deagle', // [П]
    'cso_extra_ak47_blackstar', // [А]
    'zb_extra_railgun', // [Пм]
    'zb_extra_ak47gold', // [А] — уровень Лидер, покупается ещё и из /вип
    'zb_extra_m4a1gold', // [А] — уровень Император, покупается ещё и из /вип
    'zp_shop_props', // [Э] экипировка
    'zp_extra_hp_ap', // [У] усиления — в самый низ: их берут не выбирая
    'zp_extra_norecoil', // [У]
    'zp_zombie_nades', // [Г] гранаты зомби — своя команда, своё меню
  ]
  // Плагин магазина узнаём по вызову, а не по имени файла: забытая в списке
  // вещь тогда не молчит, а сама о себе сообщает.
  //
  // ⚠️ ЗАКОММЕНТИРОВАННЫЕ ВЫЗОВЫ НЕ СЧИТАЮТСЯ. У четырёх перенесённых плагинов
  // регистрация вещи закрыта двойной косой чертой самим автором — ствол там
  // выдаётся ролью, а не покупкой. Без этой проверки они попадали в список
  // «вне SHOP_ORDER» и заставляли гадать, что за вещь потерялась.
  const registersItem = text => text.split(/\r?\n/)
    .some(l => l.includes('zp_register_extra_item') && !/^\s*(\/\/|\*)/.test(l))
  const shopPlugins = plain.filter(n => registersItem(readFileSync(join(OURS, `${n}.sma`), 'utf8')))
  const unlistedShop = shopPlugins.filter(n => !SHOP_ORDER.includes(n))
  if (unlistedShop.length) {
    console.log(`! плагины спец-магазина вне SHOP_ORDER: ${unlistedShop.join(', ')} — встанут в конец меню`)
  }
  const shop = [...SHOP_ORDER.filter(n => shopPlugins.includes(n)), ...unlistedShop]
  const others = plain.filter(n => !shopPlugins.includes(n))

  writeFileSync(pluginsIni, [
    ...(early.length
      ? ['; --- must load BEFORE admincmd: intercepts amx_ban ---', `${EARLY}.amxx`]
      : []),
    cur,
    '; --- Zombie Plague ---',
    'zombie_plague44.amxx',
    'zp_zclasses44.amxx',
    '; --- our own plugins: must load AFTER zombie_plague44 ---',
    ...others.map(n => `${n}.amxx`),
    '; --- extra items: load order == shop menu order, grouped by kind ---',
    ...shop.map(n => `${n}.amxx`),
    '; --- zombie classes: load order == menu order, free first, then by rank ---',
    ...classes.map(n => `${n}.amxx`),
    '',
  ].join('\n'), 'latin1')
}

// Настройки конкретной установки — адрес раздачи файлов, имя сервера и прочее,
// что зависит от площадки. Держим отдельным файлом: server.cfg пересоздаётся
// при каждой сборке, и правки в нём пропали бы.
const EXTRA_CFG = join(ROOT, 'custom', 'server-extra.cfg')

// Администраторы берутся из custom/admins.ini — он вне репозитория, потому что
// содержит пароли. Нет файла — список пуст, ровно то, чем грешат чужие сборки.
const adminCount = writeUsersIni(AMXX)
console.log(adminCount
  ? `+ администраторов из custom/admins.ini: ${adminCount}`
  : '= список администраторов пуст (добавить: node tools/add-admin.mjs --help)')

writeFileSync(join(CSTRIKE, 'server.cfg'), [
  '// Базовая конфигурация сервера Zombie Plague.',
  '// rcon_password здесь НЕ указан намеренно: пароль задаётся на хостинге,',
  '// иначе он попадает в архив и становится известен всем.',
  '',
  'hostname "Вспышка эпидемии | RU"',
  'sv_lan 0',
  'sv_region 3',
  '',
  'mp_timelimit 30',
  'mp_autoteambalance 0',
  'mp_limitteams 0',
  'mp_friendlyfire 0',
  'mp_flashlight 1',
  'mp_footsteps 1',
  'mp_freezetime 0',
  'mp_roundtime 5',
  '',
  'sv_maxspeed 900',
  'sv_gravity 800',
  'sv_maxrate 100000',
  'sv_minrate 25000',
  'sv_cheats 0',
  'sv_consistency 0',
  'sv_allowupload 0',
  'sv_allowdownload 1',
  '',
  '// FastDL — быстрая раздача файлов игрокам обычным веб-сервером.',
  '// Без неё 28 МБ нашего содержимого качаются встроенной закачкой GoldSrc',
  '// со скоростью около 20 КБ/с, то есть минут пятнадцать на каждого нового',
  '// игрока. Дерево для выкладки готовит команда:  node tools/build-fastdl.mjs',
  '// Указывать ТОЛЬКО свой домен: этот адрес получает каждый игрок.',
  '// sv_downloadurl "https://ваш-домен/fastdl/cstrike"',
  '',
  'log on',
  'mp_logmessages 1',
  'mp_logdetail 3',
  '',
  ...(existsSync(EXTRA_CFG)
    ? ['// ── настройки этой установки (custom/server-extra.cfg) ──',
       readFileSync(EXTRA_CFG, 'utf8').trimEnd(), '']
    : ['// Настройки площадки кладите в custom/server-extra.cfg — этот файл',
       '// пересоздаётся при каждой сборке, и правки в нём пропадут.', '']),
].join('\n'))
if (existsSync(EXTRA_CFG)) console.log('+ добавлены настройки установки из custom/server-extra.cfg')

// ⚠️ Кодировку объявлять ОБЯЗАТЕЛЬНО. Окно приветствия рисует не движок, а
// встроенный браузер клиента, и без этой строки он читает файл однобайтовой
// кодировкой: русский текст приходит как «ÐÐµÑ€Ð²ÐµÑ€ ÑÐ¾Ð±Ñ€Ð°Ð½…».
// Поймано снимком экрана живого клиента.
writeFileSync(join(CSTRIKE, 'motd.txt'), [
  '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
  '<body bgcolor="#101014" text="#d8d8e0" style="font-family:Verdana,sans-serif">',
  '<h3 style="color:#8bd450">Zombie Plague</h3>',
  '<p>Сервер собран из официальных исходников. Приятной игры.</p>',
  '</body>',
].join('\n'))

// ── опись ───────────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out); else out.push(p)
  }
  return out
}
const files = walk(SERVER)
const manifest = {
  built: new Date().toISOString(),
  components: placed,
  compiledPlugins: compiled,
  totals: { files: files.length, bytes: files.reduce((s, p) => s + statSync(p).size, 0) },
}
writeFileSync(join(SERVER, 'BUILD-MANIFEST.json'), JSON.stringify(manifest, null, 2))

// Возвращаем прогресс игроков поверх свежей сборки.
if (hadVault) {
  cpSync(VAULT_STASH, join(SERVER, ...VAULT_REL), { recursive: true })
  rmSync(VAULT_STASH, { recursive: true, force: true })
  console.log('+ прогресс игроков сохранён и возвращён на место')
}

console.log(`\nсобрано: ${files.length} файлов, ${(manifest.totals.bytes / 1048576).toFixed(1)} МБ`)
console.log(`компонентов уложено: ${placed.length}, плагинов скомпилировано: ${compiled.length}`)
