// Проверяет, что русификация и оформление реально доехали до собранного сервера.
//
// Смысл в том, что глазами это не проверить без живого клиента, а провал здесь
// тихий: строка может потеряться при компиляции или обрезаться посреди символа,
// и сервер всё равно запустится — просто с мусором на экране.
//
// Ищем байты UTF-8 прямо в распакованном образе плагина: штатный извлекатель
// строк (tools/amxx.mjs) отбрасывает всё выше \x7e, он писался под ASCII-улики,
// поэтому для кириллицы не годится.
//
// Искать надо во ВСЕХ трёх видах хранения Pawn сразу. По умолчанию строка лежит
// неупакованной — по одному байту на 4-байтовую ячейку, то есть между байтами
// UTF-8 стоят нули, и поиск подряд идущих байтов ничего не найдёт.
//
// Запуск: node tools/verify-ru.mjs

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseAmxxContainer } from './amxx.mjs'
import { inspectModel } from './mdl.mjs'
import { ADS, NAME_ADS, findPlates, partNames } from './mdl-untag.mjs'
import { retargetPath } from './retarget.mjs'
import { TIERS } from './users-ini.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AMXX = join(ROOT, 'server', 'cstrike', 'addons', 'amxmodx')

// Что обязано быть внутри плагинов. Список нарочно покрывает все виды правок:
// оформление, HUD, режимы, классы — если сломается любая, проверка это увидит.
const EXPECTED = {
  'zombie_plague44.amxx': [
    'Вспышка эпидемии',            // фирменный заголовок меню
    'Кредиты: ',             // остаток кредитов в меню
    'Режим: ',               // подписи HUD
    'Здоровье: ',
    'Смертей: ',
    'Убийств: ',
    'Скорость: ',
    'Т-вирус на свободе!',   // названия режимов
    'Массовое заражение',
    'Армагеддон',
    'Не определён',
    'zp_buy_reopen',         // переключатель повторного выбора оружия
    'Заражение через',       // верхняя строка
    'Людей: ',
    'Зомби: ',
    'CTRL+ПРОБЕЛ',           // подсказка по клавишам
    ' кр.',                  // нижняя панель в одну строку
  ],
  'zp_zclasses44.amxx': [
    'Обычный', 'Раптор', 'Ядовитый', 'Толстяк', 'Ведьма',
    // Подпись класса теперь называет способность и клавишу, а не только
    // доступность: без этого игрок не знал, что у класса вообще что-то есть.
    'Рывок (E)', 'Стая мышей (E)',
  ],
}

const checks = []
const add = (ok, name, detail) => checks.push({ ok, name, detail })

// Три вида, в которых одна и та же строка может лежать в образе AMX.
function encodings(s) {
  const b = Buffer.from(s, 'utf8')

  // Неупакованная: байт в младшем разряде своей ячейки, дальше три нуля.
  const unpacked = Buffer.alloc(b.length * 4)
  b.forEach((byte, i) => { unpacked[i * 4] = byte })

  // Упакованная: четыре байта в ячейке, внутри четвёрки порядок обратный.
  // Хвост неполной четвёрки нестабилен, поэтому сверяем только целые группы.
  const whole = Math.floor(b.length / 4) * 4
  const packed = Buffer.alloc(whole)
  for (let i = 0; i < whole; i += 4) {
    for (let k = 0; k < 4; k++) packed[i + k] = b[i + 3 - k]
  }

  return [
    { kind: 'подряд', bytes: b },
    { kind: 'неупакованная', bytes: unpacked },
    ...(whole >= 8 ? [{ kind: 'упакованная', bytes: packed }] : []),
  ]
}

function findIn(image, s) {
  for (const e of encodings(s)) if (image.includes(e.bytes)) return e.kind
  return null
}

// ── 1. строки внутри скомпилированных плагинов ──────────────────────────────────

for (const [file, needles] of Object.entries(EXPECTED)) {
  const path = join(AMXX, 'plugins', file)
  if (!existsSync(path)) { add(false, `плагин ${file}`, 'файла нет'); continue }

  const { sections } = parseAmxxContainer(readFileSync(path))
  const image = Buffer.concat(sections.map(s => s.amx))
  const found = new Map(needles.map(n => [n, findIn(image, n)]))
  const missing = needles.filter(n => !found.get(n))
  const kinds = [...new Set([...found.values()].filter(Boolean))]

  add(missing.length === 0, `русские строки в ${file}`,
    missing.length
      ? `не найдено: ${missing.join(', ')}`
      : `все ${needles.length} на месте (хранение: ${kinds.join(', ')})`)
}

// ── 2. язык сервера ─────────────────────────────────────────────────────────────

const cfgPath = join(AMXX, 'configs', 'amxx.cfg')
const cfg = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : ''
add(/^amx_language\s+"ru"/m.test(cfg), 'язык сервера по умолчанию',
  cfg.match(/^amx_language\s+.*/m)?.[0] ?? 'строки amx_language нет')
add(/^amx_client_languages\s+1/m.test(cfg), 'у иностранцев остаётся свой язык',
  cfg.match(/^amx_client_languages\s+.*/m)?.[0] ?? 'строки нет')

// ⚠️ БОТЫ МОЛЧАТ. Владелец: «убрать звуки ботов в чат и в рацию, надоело
// флудит». Восемь ботов болтают за восьмерых, и разговор живых в этом тонет.
// Проверяем СОБРАННЫЙ конфиг, а не правку в assemble.mjs: файл приезжает из
// апстрима YaPB, и после обновления настройка может уехать под другим именем.
const yapbPath = join(ROOT, 'server', 'cstrike', 'addons', 'yapb', 'conf', 'yapb.cfg')
const yapbCfg = existsSync(yapbPath) ? readFileSync(yapbPath, 'utf8') : ''
const botsLoud = [
  ['болтовня в чате (yb_chat)', /^yb_chat "0"/m],
  ['рация и голосовые команды (yb_radio_mode)', /^yb_radio_mode "0"/m],
  ['приветствие в чат (yb_display_welcome_text)', /^yb_display_welcome_text "0"/m],
].filter(([, re]) => !re.test(yapbCfg)).map(([n]) => n)
add(yapbCfg !== '' && botsLoud.length === 0, 'боты молчат в чате и в рации',
  yapbCfg === '' ? 'конфига YaPB нет в сборке'
    : botsLoud.length ? `не выключено: ${botsLoud.join(', ')}` : 'чат, рация и приветствие выключены')

// ── 3. полнота словаря ──────────────────────────────────────────────────────────

const dictPath = join(AMXX, 'data', 'lang', 'zombie_plague_v44.txt')
const dict = existsSync(dictPath) ? readFileSync(dictPath, 'utf8') : ''
const section = lang => {
  const out = new Map()
  let cur = null
  for (const line of dict.split(/\r?\n/)) {
    const h = line.match(/^\[([a-z]{2})\]\s*$/i)
    if (h) { cur = h[1].toLowerCase(); continue }
    if (cur !== lang) continue
    const kv = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (kv) out.set(kv[1], kv[2])
  }
  return out
}

const ru = section('ru')
const en = section('en')
add(ru.size > 0, 'словарь читается', `ключей [ru] ${ru.size}, [en] ${en.size}`)

// Непереведённое: латиница есть, кириллицы нет. Служебные значения вроде «%s»
// или «Вкл» сюда не попадают — у них нет трёх латинских букв подряд.
const untranslated = [...ru].filter(([, v]) => /[A-Za-z]{3}/.test(v) && !/[А-Яа-яЁё]/.test(v))
add(untranslated.length === 0, 'в [ru] не осталось английских строк',
  untranslated.length ? untranslated.map(([k, v]) => `${k}="${v}"`).join('; ') : `проверено ${ru.size} строк`)

const orphans = [...ru.keys()].filter(k => !en.has(k))
add(orphans.length === 0, 'у каждого ключа [ru] есть английский запасной',
  orphans.length ? `нет в [en]: ${orphans.join(', ')}` : 'все ключи парные')

// ── 4. длины строк против обрезки посреди символа ───────────────────────────────
//
// Кириллица в UTF-8 — два байта на букву, а хранилища ZP считают ЯЧЕЙКИ.
// Проверяем, что после наших правок буферов запас есть.
const src = join(AMXX, 'scripting', 'zombie_plague44.sma')
const sma = existsSync(src) ? readFileSync(src, 'utf8') : ''
const cells = Number(sma.match(/g_zclass_info = ArrayCreate\((\d+), 1\)/)?.[1] ?? 0)
const longest = Math.max(...Object.values(EXPECTED).flat().map(s => Buffer.byteLength(s, 'utf8')))
add(cells > longest, 'хранилище подсказок вмещает кириллицу',
  `ячеек ${cells}, самая длинная строка ${longest} байт`)

// ── 5. правки этого этапа ───────────────────────────────────────────────────────

// ⚠️ Панель выводится КРУПНЫМ шрифтом (dhud), как в скачанных сборках: у
// обычного hud шрифт мелкий пиксельный, и на широком экране его не прочесть.
add(/set_dhudmessage\(red, green, blue, -1\.0, 0\.90/.test(sma),
  'панель состояния по центру, крупным шрифтом',
  sma.match(/set_dhudmessage\(red, green, blue, [^)]*0\.9[^)]*\)/)?.[0] ?? 'вызов не найден')

add(!/zp_colored_print\(id, "\^x04\[ZP\]\^x01 %L", id, "BUY_ENABLED"\)/.test(sma),
  'убрано сообщение-пустышка про меню оружия',
  /BUY_ENABLED/.test(sma) ? 'BUY_ENABLED всё ещё печатается' : 'больше не печатается')

// Нижняя панель должна помещаться в строку: считаем её видимую длину при
// правдоподобных значениях, без служебных символов формата.
// Именно наша панель, а не двухстрочная панель наблюдателя выше по файлу.
const bottom = sma.match(/show_dhudmessage\(ID_SHOWHUD, "(%s   %d HP[^"]+)"/)?.[1] ?? ''
const rendered = bottom.replace(/%d/g, '1800').replace('%s', 'Ядовитый').replace('%s', '  ·  Император')
add(bottom !== '' && rendered.length <= 60, 'нижняя панель влезает в строку',
  `«${rendered}» — ${rendered.length} знаков`)

// Сохранение прогресса живёт в отдельном плагине, а не в правках мода.
const progress = join(ROOT, 'custom', 'plugins', 'zp_progress.sma')
const prog = existsSync(progress) ? readFileSync(progress, 'utf8') : ''
add(/nvault_open\("zpprogress"\)/.test(prog) && /nvault_set\(g_vault/.test(prog) && /flush_vault\(\)/.test(prog),
  'класс и кредиты пишутся на диск',
  prog ? 'nVault + периодический сброс, чтобы пережить аварийную остановку' : 'плагина zp_progress нет')

// Ловушка, на которой это уже ломалось: "c" у get_players означает
// «пропустить ботов», а не «connected». В сохранении такого быть не должно.
add(!/get_players\(players, num, "c"\)/.test(prog), 'сохранение не пропускает игроков',
  'флаг "c" у get_players означает «без ботов», а не «подключённые»')

// Прогресс игроков лежит внутри каталогов, которые сборка сносит целиком.
// Один раз это уже стёрло накопленные кредиты — обе сборки обязаны его
// откладывать и возвращать.
const composeSrc = readFileSync(join(ROOT, 'tools', 'compose-run.mjs'), 'utf8')
const assembleSrc = readFileSync(join(ROOT, 'tools', 'assemble.mjs'), 'utf8')
add(/data\/vault/.test(composeSrc) && /возвращён/.test(composeSrc),
  'пересборка run/ не стирает прогресс', 'откладывается перед сносом и возвращается после')
add(/VAULT_STASH/.test(assembleSrc) && /hadVault/.test(assembleSrc),
  'пересборка server/ не стирает прогресс', 'то же самое для боевого каталога')
add(/serverIsRunning\(\)/.test(composeSrc), 'пересборка отказывается идти под работающим сервером',
  'иначе каталог остаётся полураздетым: часть файлов держит процесс')

// Ловушка, стоившая дороже всего: в AMXX ДВА форварда отключения —
// client_disconnect(id) с одним параметром и client_disconnected(id, drop,
// message, maxlen) с четырьмя. Объявленный с одним параметром «disconnected»
// не вызывается вовсе, и весь код выхода игрока молча мёртв.
const ourSma = readdirSync(join(ROOT, 'custom', 'plugins'))
  .filter(f => f.endsWith('.sma'))
  .map(f => [f, readFileSync(join(ROOT, 'custom', 'plugins', f), 'utf8')])
const badForward = ourSma.filter(([, src]) => /public client_disconnected\s*\(\s*id\s*\)/.test(src))
add(badForward.length === 0, 'форвард отключения объявлен верно',
  badForward.length
    ? `client_disconnected с ОДНИМ параметром (нужен client_disconnect): ${badForward.map(([f]) => f).join(', ')}`
    : `проверено плагинов: ${ourSma.length}`)

// ── 2б. база данных ─────────────────────────────────────────────────────────────
//
// Владелец попросил хранить прогресс, привилегии и статистику в MySQL. Здесь
// проверяется то, что при поломке молчит: сборка соберётся, сервер поднимется,
// и только через неделю выяснится, что ничего не сохранялось.
const sqlCfgPath = join(AMXX, 'configs', 'sql.cfg')
const sqlCfg = existsSync(sqlCfgPath) ? readFileSync(sqlCfgPath, 'latin1') : ''
const dbType = (sqlCfg.match(/^amx_sql_type\s+"(\w+)"/m) ?? [])[1] ?? ''
const modulesCfg = existsSync(join(AMXX, 'configs', 'modules.ini'))
  ? readFileSync(join(AMXX, 'configs', 'modules.ini'), 'utf8') : ''

// ⚠️ МОДУЛИ БАЗ ДАННЫХ АВТОМАТИЧЕСКИ НЕ ПОДКЛЮЧАЮТСЯ — про это написано в шапке
// самого modules.ini. Без строки в нём плагин с запросами не найдёт нативов и
// не загрузится вовсе.
add(dbType !== '' && new RegExp(`^${dbType}$`, 'm').test(modulesCfg),
  'модуль базы включён и совпадает с настройкой',
  dbType ? `amx_sql_type «${dbType}», в modules.ini он ${new RegExp(`^${dbType}$`, 'm').test(modulesCfg) ? 'есть' : 'ОТСУТСТВУЕТ'}`
    : 'sql.cfg не собран')

// ⚠️ ПАРОЛЬ НЕ ДОЛЖЕН УЕХАТЬ В РАЗДАЧУ. sql.cfg лежит в addons и в дерево
// FastDL попадать не может — но проверить дешевле, чем однажды раздать пароль
// от базы всем, кто зашёл на сервер.
const fastdlRoot = join(ROOT, 'dist', 'fastdl')
const leaked = []
const walkFastdl = dir => {
  if (!existsSync(dir)) return
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walkFastdl(p)
    else if (/sql\.cfg|db\.ini|users\.ini|admins\.ini/i.test(n)) leaked.push(p.replace(ROOT, '.'))
  }
}
walkFastdl(fastdlRoot)
add(leaked.length === 0, 'учётные файлы не попали в раздачу',
  leaked.length ? `в dist/fastdl нашлось: ${leaked.join(', ')}` : 'ни sql.cfg, ни users.ini в раздаче нет')

// ⚠️ ЗАПРОСЫ ТОЛЬКО ПОТОКОВЫЕ. Обычный SQL_Execute останавливает ВЕСЬ сервер,
// пока база отвечает: при базе на другой машине каждый вход игрока — это
// подвисание у всех тридцати двух. Единственное исключение — сохранение при
// выгрузке плагина: там ждать уже некому, карта меняется.
const blocking = []
for (const [f, src] of ourSma) {
  if (!/SQL_Execute/.test(src)) continue
  const at = src.indexOf('flush_db_blocking')
  const only = at >= 0 && src.indexOf('SQL_Execute') > at
  if (!only) blocking.push(f)
}
add(blocking.length === 0, 'запросы к базе не морозят сервер',
  blocking.length ? `SQL_Execute вне выгрузки плагина: ${blocking.join(', ')}`
    : 'везде SQL_ThreadQuery, ожидание — только при смене карты')

// ⚠️⚠️ У КЛИЕНТА БУФЕР МЕНЮ 512 БАЙТ, И ЛИШНЕЕ ОН ВЫБРАСЫВАЕТ МОЛЧА.
// Русская буква — два байта, поэтому семь пунктов вроде «[А] ВСК-94 (+25%,
// скор.+15%) [140]» с трёхстрочным заголовком дают 582 байта: последние пункты
// в игре просто не показывались. Жалоба владельца звучала как «текст в меню не
// виден до конца, в основном где длинные названия».
// Каждое наше меню обязано перед показом позвать zm_menu_fit — он сам считает,
// сколько пунктов влезет. Проверяем по числу созданных меню: забыть вызов у
// нового меню проще всего.
const unfit = []
for (const [f, src] of ourSma) {
  const made = (src.match(/menu_create\(/g) ?? []).length
  if (!made) continue
  const fitted = (src.match(/zm_menu_fit\(/g) ?? []).length
  if (fitted < made) unfit.push(`${f}: меню ${made}, подогнано ${fitted}`)
}
add(unfit.length === 0, 'меню влезают в буфер клиента',
  unfit.length ? unfit.join('; ') : 'у каждого меню число пунктов на странице считает zm_menu_fit')

// ⚠️ НИК ИГРОКА — ЭТО ТЕКСТ, КОТОРЫЙ ПИШЕТ ЧУЖОЙ ЧЕЛОВЕК. Попав в запрос без
// просеивания, одинарная кавычка в нике превращает запрос в тот, который
// придумал игрок. Требуем, чтобы каждый плагин, кладущий имя в базу, звал
// zm_db_safe.
const unsafe = ourSma
  .filter(([, src]) => /get_user_name\([^)]*\)[\s\S]{0,400}?REPLACE INTO|INSERT INTO[\s\S]{0,200}?%s/.test(src))
  .filter(([, src]) => /SQL_ThreadQuery/.test(src) && /get_user_name/.test(src) && !/zm_db_safe/.test(src))
  .map(([f]) => f)
add(unsafe.length === 0, 'ник игрока просеивается перед запросом',
  unsafe.length ? `имя уходит в запрос как есть: ${unsafe.join(', ')}` : 'везде zm_db_safe')

// Привилегии из базы: собран SQL-вариант плагина, и в нём есть откат на файл.
// Без отката пустая таблица оставила бы сервер вообще без админов — включая
// владельца.
const adminSrc = existsSync(join(AMXX, 'scripting', 'admin.sma'))
  ? readFileSync(join(AMXX, 'scripting', 'admin.sma'), 'utf8') : ''
add(/^#define USING_SQL/m.test(adminSrc) && /zm_hot_admins_from_file\(\)/.test(adminSrc)
    && existsSync(join(AMXX, 'plugins', 'admin_sql.amxx')),
  'привилегии читаются из базы, с откатом на users.ini',
  /^#define USING_SQL/m.test(adminSrc)
    ? 'admin_sql.amxx собран, откат при пустой таблице на месте'
    : 'admin.sma собран без чтения из базы')

// ⚠️⚠️ ЗАГРУЖАТЬ РОВНО ОДИН ИЗ ДВУХ. admin.amxx и admin_sql.amxx — это один и
// тот же плагин, собранный с чтением из базы и без него. Два сразу — это два
// независимых списка администраторов; чей победит, зависит от порядка загрузки,
// и выяснится это в самый неподходящий момент.
const adminLines = readFileSync(join(AMXX, 'configs', 'plugins.ini'), 'latin1')
  .split(/\r?\n/).map(l => l.trim())
const adminOn = adminLines.filter(l => /^admin\.amxx\b/.test(l)).length
const adminSqlOn = adminLines.filter(l => /^admin_sql\.amxx\b/.test(l)).length
add(adminOn === 0 && adminSqlOn === 1, 'включён ровно один плагин администраторов',
  `admin.amxx: ${adminOn}, admin_sql.amxx: ${adminSqlOn} — нужен только SQL-вариант`)

// ⚠️⚠️ КЛЮЧ ХРАНИЛИЩА — SteamID, А НА ВХОДЕ В ИГРУ ЕГО МОЖЕТ ЕЩЁ НЕ БЫТЬ.
// В amxmodx.inc про client_putinserver прямо написано: порядок с авторизацией
// не определён. Пока ID нет, get_user_authid отдаёт STEAM_ID_PENDING, ключ
// съезжает на «ник:Имя», а сохраняемся мы при выходе под настоящим SteamID —
// запись не находится. Ровно поэтому нож не переживал перезаход.
// Лечится чтением ещё и в client_authorized; проверяем оба хранилища.
const vaultBad = []
for (const f of ['zp_knives.sma', 'zp_skins.sma']) {
  const src = readFileSync(join(ROOT, 'custom', 'plugins', f), 'utf8')
  if (!/public client_authorized\(id, const authid\[\]\)/.test(src)) vaultBad.push(`${f}: нет чтения по авторизации`)
  else if (!/key_of\(id, key, charsmax\(key\), authid\)/.test(src)) vaultBad.push(`${f}: ключ строится без пришедшего ID`)
}
add(vaultBad.length === 0, 'выбор игрока читается и после авторизации',
  vaultBad.length ? vaultBad.join('; ') : 'ножи и скины переживают перезаход')

add(/g_roundnum\+\+/.test(sma) && /ShowSyncHudMsg\(id, g_MsgSync3/.test(sma), 'верхняя строка со счётчиками',
  /task_exists\(TASK_MAKEZOMBIE\)/.test(sma) ? 'раунд, отсчёт до заражения, живые' : 'отсчёт не привязан к заражению')

const syncs = (sma.match(/CreateHudSyncObj\(\)/g) || []).length
add(syncs === 4, 'каналы HUD не переполнены',
  `объектов синхронизации ${syncs} из 4 доступных в GoldSrc`)

const nvgGuard = /if \(!g_nvgwanted\[ID_NVISION\]\)/.test(sma)
const nvgKept = (sma.match(/g_nvisionenabled\[id\] = \(g_nvgwanted\[id\] != 0\)/g) || []).length
add(nvgGuard && nvgKept === 4, 'зелёный свет зомби выключается насовсем',
  `защита в задаче отрисовки: ${nvgGuard ? 'есть' : 'НЕТ'}, точек автовключения обезврежено ${nvgKept} из 4`)

// Привилегии: пункт меню, плагин и модели скинов. Пункт «7» — единственный
// вход в выбор ножа и скина, и если правка меню отвалится при обновлении
// апстрима, игрок останется без обоих.
const menuItems = [
  ['Ножи (6)', /"\\r6\.\\w %L\^n", id, "MENU_KNIVES"/, /case 5: \/\/ Ножи/],
  ['Привилегии (7)', /"\\r7\.\\w %L\^n", id, "MENU_VIP"/, /case 6: \/\/ Привилегии/],
  ['Магазин скинов (8)', /"\\r8\.\\w %L\^n\^n", id, "MENU_SKINSHOP"/, /case 7: \/\/ Магазин скинов/],
]
const menuBad = menuItems.filter(([, shown, handled]) => !shown.test(sma) || !handled.test(sma)).map(([n]) => n)
add(menuBad.length === 0, 'наши пункты в меню игры на месте',
  menuBad.length ? `сломано: ${menuBad.join(', ')}` : menuItems.map(([n]) => n).join(', '))

// Скин без своего файла — это чёрное пятно у всех, кто зашёл. Сверяем список
// в плагине с тем, что реально уложено в сборку.
const skinsSrc = readFileSync(join(ROOT, 'custom', 'plugins', 'zp_skins.sma'), 'utf8')
const skinNames = [...skinsSrc.matchAll(/^\s*\{ "[^"]+",\s*"[^"]*",\s*"([^"]+)"/gm)].map(m => m[1])
const skinsMissing = skinNames.filter(n =>
  !existsSync(join(ROOT, 'server', 'cstrike', 'models', 'player', n, `${n}.mdl`)))
add(skinNames.length >= 8 && skinsMissing.length === 0, 'модели скинов уложены в сборку',
  skinsMissing.length ? `нет файлов: ${skinsMissing.join(', ')}` : `скинов с моделью: ${skinNames.length}`)

// Ножи и скины разложены по уровням — иначе привилегия ничего не значит.
const knivesSrc = readFileSync(join(ROOT, 'custom', 'plugins', 'zp_knives.sma'), 'utf8')
// Создатель ножей себе не забирает: он главный админ и видит всё по флагам,
// а верхний ПОКУПАЕМЫЙ уровень — Фараон, и вещи должны быть у него.
const LEVELS = ['VIP', 'LEADER', 'IMPERATOR', 'PHARAOH']
const tiersIn = src => LEVELS.filter(t => new RegExp(`,\\s*${t}\\s*,`).test(src)).length
add(tiersIn(knivesSrc) === 4 && tiersIn(skinsSrc) === 4, 'ножи и скины разложены по всем покупаемым уровням',
  `уровней задействовано: у ножей ${tiersIn(knivesSrc)} из 4, у скинов ${tiersIn(skinsSrc)} из 4`)

// Скин главного админа — его собственный, и продавать его нельзя.
add(/"zm_hot_creator",\s*CREATOR\s*,/.test(skinsSrc), 'скин «Создатель» остался за главным админом',
  'CREATOR стоит только у своего скина')

// ⚠️ ОДИН ПОДАРОЧНЫЙ СКИН НА УРОВЕНЬ. Так попросил владелец: уровень даёт свой
// узнаваемый облик, он надевается сам, выбирать нечего. Проверяем, что на
// каждом покупаемом уровне ровно один скин и что уровни не перепутаны местами.
const RANK = { '0': 0, VIP: 1, LEADER: 2, IMPERATOR: 3, PHARAOH: 4, CREATOR: 5 }
const skinRows = [...skinsSrc.matchAll(/^\s*\{ "([^"]+)",\s*"[^"]*",\s*"[^"]*",\s*(\w+),\s*(\d+)\s*\}/gm)]
  .map(m => ({ title: m[1], tier: m[2], price: +m[3] }))
const privRows = skinRows.filter(r => r.price === 0 && r.tier !== '0')
const ordered = privRows.every((r, i) => i === 0 || RANK[privRows[i - 1].tier] < RANK[r.tier])
const oneEach = ['VIP', 'LEADER', 'IMPERATOR', 'PHARAOH', 'CREATOR']
  .every(t => privRows.filter(r => r.tier === t).length === 1)
add(privRows.length === 5 && oneEach && ordered, 'на каждом уровне ровно один подарочный скин',
  oneEach && ordered ? privRows.map(r => `${r.tier} — ${r.title}`).join(', ')
    : `подарочных ${privRows.length}: ${privRows.map(r => `${r.title}/${r.tier}`).join(', ')}`)

// Снятие купленного скина должно возвращать ПОДАРОЧНЫЙ, а не «обычного бойца»:
// за уровень заплачено. Держится на том, что apply() берёт effective(), а не
// выбор игрока напрямую.
add(/new i = effective\(id\)/.test(skinsSrc) && /return tier_skin\(id\);/.test(skinsSrc),
  'снятый скин возвращает облик уровня', 'apply() надевает effective(), а не g_choice')

// Магазин скинов: те, что были похожи на обычного бойца, ушли за кредиты, и
// туда же легли восемь новых из двух сборок владельца. Цены должны идти по
// возрастанию — иначе список читается как случайный.
const shopRows = skinRows.filter(r => r.price > 0)
const priceOrder = shopRows.every((r, i) => i === 0 || shopRows[i - 1].price <= r.price)
add(shopRows.length >= 11 && shopRows.every(r => r.tier === '0'),
  'магазин скинов собран', shopRows.map(r => `${r.title} — ${r.price}`).join(', '))
add(priceOrder || shopRows.length < 2, 'цены в магазине скинов идут по возрастанию',
  priceOrder ? `от ${shopRows[0].price} до ${shopRows[shopRows.length - 1].price} кредитов`
    : 'порядок цен нарушен')
// Отдельного прилавка больше нет: меню скинов И ЕСТЬ магазин. Зато в нём
// обязана быть первая строка «снять скин» — иначе купленное не снять никак.
add(/menu_additem\(menu, off, "0", 0\)/.test(skinsSrc) && /Снять скин/.test(skinsSrc),
  'в меню скинов есть строка «снять скин»', 'пункт и его обработка на месте')

// ⚠️ В меню привилегий не должно остаться НИЧЕГО чужого. Сначала оттуда убрали
// выбор скина, потом — по просьбе владельца — и выбор ножа, и ссылку на
// магазин, и лестницу уровней: меню показывает только кнопки СВОЕГО уровня.
// Ножи открываются своей командой, скины — своей.
const vipMenuSrc = readFileSync(join(ROOT, 'custom', 'plugins', 'zp_vip.sma'), 'utf8')
const vipStrays = [
  ['выбор скина', /"\\wВыбрать скин"/],
  ['выбор ножа', /"\\wВыбрать нож"/],
  ['ссылка на магазин', /zp_skin_shop/],
  ['лестница уровней', /menu_additem\(menu, line, num, 0\)/],
]
const vipLeft = vipStrays.filter(([, re]) => re.test(vipMenuSrc)).map(([n]) => n)
add(vipLeft.length === 0 && /take_perk\(id, info\)/.test(vipMenuSrc),
  'в меню привилегий только свои кнопки',
  vipLeft.length ? `осталось лишнее: ${vipLeft.join(', ')}` : 'кредиты, здоровье, броня')

// Свойства ножей: без эффекта нож ничем не отличается от соседнего.
const knifeRows = [...knivesSrc.matchAll(/(EF_\w+),\s*(\d+),\s*"([^"]*)"/g)]
  .map(m => ({ effect: m[1], chance: +m[2], mark: m[3] }))
const withEffect = knifeRows.filter(r => r.effect !== 'EF_NONE')
const chanceOk = withEffect.every(r => r.chance > 0 && r.chance <= 100)
// ⚠️ Число ножей больше не прибито гвоздями: владелец просил добавлять их
// пачками и потом убирать лишнее. Держим нижнюю границу и требуем, чтобы у
// КАЖДОГО была подпись, а у большинства — своё свойство.
add(knifeRows.length >= 11 && withEffect.length >= knifeRows.length / 2 && chanceOk
    && knifeRows.every(r => r.mark),
  'у ножей есть свойства и подписи',
  `ножей ${knifeRows.length}, со свойством ${withEffect.length}, у всех подпись в скобках`)

// ⚠️ У КАЖДОЙ СПОСОБНОСТИ СВОЯ КАРТИНКА. Владелец: «добавь визуальные эффекты,
// когда используешь способности ножей». Без них применение видно только по
// цифрам урона, а половина способностей выглядит одинаково: круг и круг.
// Требуем обе половины — вспышку у владельца и отметку на задетом.
const abKinds = (knivesSrc.match(/enum \{ AB_NONE = 0,\s*([^}]+)\}/) ?? [, ''])[1]
  .split(',').map(s => s.trim()).filter(Boolean)
const cut = (from, to) => {
  const a = knivesSrc.indexOf(from)
  const b = knivesSrc.indexOf(to)
  return a >= 0 && b > a ? knivesSrc.slice(a, b) : ''
}
const burstBody = cut('ability_burst(kind', 'victim_mark(kind')
const markBody = cut('victim_mark(kind', 'fx_slash(id, victim)\n{')
const noFx = abKinds.filter(a => !burstBody.includes(`case ${a}:`) && !markBody.includes(`case ${a}:`))
add(abKinds.length >= 8 && burstBody !== '' && markBody !== '' && noFx.length === 0,
  'у каждой способности ножа свой видимый эффект',
  noFx.length ? `без картинки: ${noFx.join(', ')}` : `способностей ${abKinds.length}, у всех свой эффект`)

// Спрайт без файла — это молча ничего: эффекта не будет, и никто не поймёт,
// почему. Берём те же картинки, что мод грузит для своих гранат, поэтому и
// проверяем их наличие в сборке, а не в списке закачки.
const fxSprites = [...knivesSrc.matchAll(/spr\("([^"]+)"\)/g)].map(m => m[1])
const fxMissing = fxSprites.filter(p => !existsSync(join(ROOT, 'server', 'cstrike', ...p.split('/'))))
add(fxSprites.length >= 3 && fxMissing.length === 0, 'спрайты эффектов уложены в сборку',
  fxMissing.length ? `нет файлов: ${fxMissing.join(', ')}` : `спрайтов: ${fxSprites.length}`)

// ⚠️ КРУПНЫЕ НАДПИСИ КЛИЕНТ КОПИТ, А НЕ ЗАМЕНЯЕТ ПРЕДЫДУЩУЮ: их живёт до
// шестнадцати штук разом. Надпись, выпускаемая из кадра (PlayerPreThink),
// занимает собой все шестнадцать мест за долю секунды — и остального HUD на
// экране просто нет. Ровно это и была жалоба «из-за джетпака пропадает
// остальной худ»: полоска топлива уходила сто раз в секунду.
const jetSrc = readFileSync(join(ROOT, 'custom', 'plugins', 'zp_jetpack.sma'), 'utf8')
const jetA = jetSrc.indexOf('public fw_PreThink(')
const jetB = jetSrc.indexOf('public hud_tick(')
// Порядок сломался — проверяем весь файл: он заведомо не пройдёт, и это лучше,
// чем тихо проверить пустую строку.
const jetFrame = jetA >= 0 && jetB > jetA ? jetSrc.slice(jetA, jetB) : jetSrc
add(!/show_fuel\(id\)/.test(jetFrame) && /set_task\(HUD_TICK, "hud_tick"/.test(jetSrc)
    && /set_dhudmessage\([^)]*HUD_TICK/.test(jetSrc),
  'полоску джетпака рисует задача, а не каждый кадр',
  'иначе она вытесняет с экрана нижнюю панель, показ урона и отсчёт заражения')

// Граната зомби не должна заражать сама по себе — это и была жалоба.
const nadesSrc = readFileSync(join(ROOT, 'custom', 'plugins', 'zp_zombie_nades.sma'), 'utf8')
const nadeParts = [
  ['снятие метки мода', /set_pev\(ent, PEV_NADE_TYPE, 0\)/],
  ['товар в магазине', /zp_register_extra_item\("Граната заражения"/],
  ['оплаченный заряд', /g_inf_charge\[owner\]/],
  ['запрет на особом раунде', /zp_get_user_zombie\(id\) && special_round\(\)/],
]
const nadeMissing = nadeParts.filter(([, re]) => !re.test(nadesSrc)).map(([n]) => n)
add(nadeMissing.length === 0, 'граната отброса не заражает, заражение — за кредиты',
  nadeMissing.length ? `не хватает: ${nadeMissing.join(', ')}` : `проверено частей: ${nadeParts.length}`)

// И вход в магазин зомби на особых раундах закрыт в самом моде.
const zpSrc = readFileSync(join(AMXX, 'scripting', 'zombie_plague44.sma'), 'utf8')
add(/g_zombie\[id\] && g_currentmode != MODE_INFECTION && g_currentmode != MODE_MULTI/.test(zpSrc),
  'спец-магазин зомби закрыт на особых раундах', 'правка легла в исходник мода')

add(zpSrc.includes('new g_extras_kind[33]') && zpSrc.includes("buffer[0] == '['"),
  'спец-магазин разделён на «Предметы» и «Арсенал»', 'переключатель и отбор по метке на месте')

// ⚠️ КУПЛЕННОЕ ОСТАЁТСЯ ДО КОНЦА КАРТЫ. В апстриме вещь живёт один раунд, и
// это замысел, а не поломка — владелец попросил обратного. Память о покупке
// ведёт САМ МОД: снаружи не видно, удалась покупка или плагин-владелец её
// отклонил. Проверяем все три точки запоминания и возврат при возрождении:
// потеря любой из них тихая — игрок просто не получит часть купленного.
const keepParts = [
  ['список покупок', /new g_keep\[33\]\[ZP_KEEP_MAX\]/],
  ['настройка zp_keep_items', /register_cvar\("zp_keep_items", "1"\)/],
  ['расходники не повторяются', /bool:zm_hot_keepable\(itemid\)/],
  // ⚠️ Исходник мода приезжает с окончаниями строк CRLF, поэтому между строками
  // ищем \s+, а не \n: с \n эти три проверки молча не находили ничего.
  ['запоминание ночного зрения', /g_nvision\[id\] = true\s+zm_hot_keep_remember/],
  ['запоминание ствола мода', /fm_give_item\(id, wname\)\s+zm_hot_keep_remember/],
  ['запоминание вещи из плагина', /else\s+zm_hot_keep_remember\(id, itemid\)/],
  ['возврат при возрождении', /set_task\(0\.75, "zm_hot_keep_regive", id\+TASK_KEEP\)/],
  ['отказ забывается', /zm_hot_keep_forget\(id, item\)/],
]
const keepMissing = keepParts.filter(([, re]) => !re.test(zpSrc)).map(([n]) => n)
add(keepMissing.length === 0, 'купленное снаряжение возвращается каждый раунд',
  keepMissing.length ? `не хватает: ${keepMissing.join(', ')}` : `проверено частей: ${keepParts.length}`)

// Ранец — единственная вещь, которая снимала сама себя: плагин раздевал всех
// на старте раунда, а этот форвард приходит ПОЗЖЕ возврата покупок.
const jetRound = jetSrc.slice(jetSrc.indexOf('public zp_round_started'))
add(!/for \(new i = 1; i <= 32; i\+\+\) if \(g_has\[i\]\) drop\(i\)/.test(jetRound)
    && /gamemode == MODE_SURVIVOR \|\| gamemode == MODE_SNIPER/.test(jetRound),
  'ранец не снимается на старте раунда, но не достаётся Выжившему',
  'иначе возвращённая покупка пропадала в миг первого заражения')

// ⚠️ БОССЫ РЕЖИМОВ ДОЛЖНЫ ОТЛИЧАТЬСЯ ОТ РЯДОВЫХ. В апстриме Дьявол и Убийца —
// это обычный зомби, а Выживший и Снайпер — обычный боец: режим объявляется
// голосом, а на карте босса не отличить, пока он не убьёт. Проверяем и запись
// в конфиге, и наличие самого файла: пропавшая модель — это не «босс выглядит
// иначе», а вылет сервера на загрузке карты.
const zpini = readFileSync(join(AMXX, 'configs', 'zombie_plague_v44.ini'), 'utf8')
const BOSSES = [
  ['Дьявол', /^NEMESIS = (\S+)/m, 'models/player/%/%.mdl'],
  ['Убийца', /^ASSASSIN = (\S+)/m, 'models/player/%/%.mdl'],
  ['Выживший', /^SURVIVOR = (\S+)/m, 'models/player/%/%.mdl'],
  ['Снайпер', /^SNIPER = (\S+)/m, 'models/player/%/%.mdl'],
]
const bossBad = []
for (const [who, re, shape] of BOSSES) {
  const name = (zpini.match(re) ?? [])[1]
  if (!name) { bossBad.push(`${who}: строки нет в конфиге`); continue }
  if (name === 'zombie_source_v44' || name === 'zp_human_v44') {
    bossBad.push(`${who}: облик рядового (${name})`)
    continue
  }
  const rel = shape.replace(/%/g, name)
  if (!existsSync(join(ROOT, 'server', 'cstrike', ...rel.split('/')))) bossBad.push(`${who}: нет файла ${rel}`)
}
// Руки боссов: у зомби это лапа, у людей — вид их оружия от первого лица.
for (const [who, re] of [['Дьявол', /^V_KNIFE NEMESIS = (\S+)/m], ['Убийца', /^V_KNIFE ASSASSIN = (\S+)/m],
  ['Выживший', /^V_WEAPON SURVIVOR = (\S+)/m], ['Снайпер', /^V_WEAPON SNIPER = (\S+)/m]]) {
  const path = (zpini.match(re) ?? [])[1]
  if (!path) { bossBad.push(`${who}: строки рук нет в конфиге`); continue }
  if (/zp_claw_source_v44|v_m249\.mdl|v_awp\.mdl/.test(path)) { bossBad.push(`${who}: руки рядового (${path})`); continue }
  if (!existsSync(join(ROOT, 'server', 'cstrike', ...path.split('/')))) bossBad.push(`${who}: нет файла ${path}`)
}
add(bossBad.length === 0, 'у каждого босса режима свой облик и свои руки',
  bossBad.length ? bossBad.join('; ') : 'Дьявол, Убийца, Выживший, Снайпер')

// ⚠️ Каталог звуков мода зависит от ВЕРСИИ: 4.3 держит их в sound/zombie_plague,
// наша 4.4 — в sound/zombie_plague_v44. Со старым путём emit_sound молча не
// играет ничего, и способность выглядит сломанной. Ровно на этом и погорели
// способности классов, поэтому проверяем отдельно.
const oldSound = new Set()
for (const f of readdirSync(join(ROOT, 'custom', 'plugins'))) {
  if (!f.endsWith('.sma')) continue
  const src = readFileSync(join(ROOT, 'custom', 'plugins', f), 'utf8')
  for (const m of src.matchAll(/"(zombie_plague\/[^"]+)"/g)) oldSound.add(`${f}: ${m[1]}`)
}
add(oldSound.size === 0, 'звуки берутся из каталога версии 4.4',
  oldSound.size ? [...oldSound].slice(0, 5).join('; ') : 'путей от версии 4.3 не осталось')

// Каждый звук способностей должен лежать в сборке: пропавший файл сервер
// прощает молча, а игрок слышит тишину.
const abil = readFileSync(join(ROOT, 'custom', 'plugins', 'zp_class_abilities.sma'), 'utf8')
const noSound = []
for (const m of abil.matchAll(/^new const SND_\w+\[\]\s*=\s*"([^"]+)"/gm)) {
  if (!existsSync(join(ROOT, 'server', 'cstrike', 'sound', ...m[1].split('/')))) noSound.push(m[1])
}
add(noSound.length === 0, 'звуки способностей уложены в сборку',
  noSound.length ? noSound.join('; ') : 'проверены все звуки из списка плагина')

// Чужая реклама на моделях. Проверка не «применялась ли правка», а «совпадает
// ли закрашенный кусок с тем, откуда его брали»: так видно результат, а не
// намерение, и она переживёт любое обновление моделей из карантина.
// Модели переносятся под нашими именами, поэтому карту «откуда → как названо»
// берём там же, где её задают, а не повторяем здесь второй раз.
const ported = JSON.parse(readFileSync(join(ROOT, 'custom', 'ported.json'), 'utf8'))
const renamedTo = new Map(ported.groups.flatMap(g => (g.models ?? [])
  .filter(m => typeof m !== 'string').map(m => [m.from, m.to])))

const adsLeft = []
for (const ad of ADS) {
  // Модели КЛАССОВ зомби переименовывает не список выше, а общий перевод путей:
  // мод разворачивает имя класса в путь сам, и переименовывать надо само имя.
  const built = renamedTo.get(ad.model) ?? retargetPath(ad.model)
  // ⚠️ Не все модели с рекламой — скины игроков. Лапа Толстяка лежит в
  // models/zombie_plague_v44, и по пути «player/имя/имя.mdl» её было не найти:
  // проверка честно писала «модели нет в сборке» и не смотрела ни одного байта.
  // ⚠️ Одно имя может быть занято дважды: v_grenade_frost.mdl есть и у мода, и
  // у нас. Если в записи указан каталог — искать только в нём.
  const candidates = ad.dir
    ? [join(ROOT, 'server', 'cstrike', 'models', ad.dir, `${built}.mdl`)]
    : [
      join(ROOT, 'server', 'cstrike', 'models', 'player', built, `${built}.mdl`),
      join(ROOT, 'server', 'cstrike', 'models', 'zombie_plague_v44', `${built}.mdl`),
      join(ROOT, 'server', 'cstrike', 'models', 'zm_hot', `${built}.mdl`),
    ]
  const path = candidates.find(p => existsSync(p))
  if (!path) { adsLeft.push(`${ad.model}: модели нет в сборке`); continue }

  const mdl = readFileSync(path)
  const at = mdl.readInt32LE(184) + ad.tex * 80
  const width = mdl.readInt32LE(at + 68)
  const dataAt = mdl.readInt32LE(at + 76)

  // Сверяем РЕЗУЛЬТАТ, а не факт правки: закрашенный кусок должен совпадать с
  // тем, чем его закрашивали. Способов три, и у каждого своя примета.
  let same = true
  if (ad.fill) {
    const colour = mdl[dataAt + ad.fill.y * width + ad.fill.x]
    for (let row = 0; row < ad.rect.h && same; row++) {
      const at = dataAt + (ad.rect.y + row) * width + ad.rect.x
      if (mdl.subarray(at, at + ad.rect.w).some(v => v !== colour)) same = false
    }
  } else if (ad.from) {
    for (let row = 0; row < ad.rect.h && same; row++) {
      const src = dataAt + (ad.from.y + row) * width + ad.from.x
      const dst = dataAt + (ad.rect.y + row) * width + ad.rect.x
      if (Buffer.compare(mdl.subarray(src, src + ad.rect.w), mdl.subarray(dst, dst + ad.rect.w)) !== 0) same = false
    }
  } else {
    // Затирание строкой: все строки внутри должны быть одинаковыми.
    const srcRow = ad.rect.y > 0 ? ad.rect.y - 1 : ad.rect.y + ad.rect.h
    const src = dataAt + srcRow * width + ad.rect.x
    for (let row = 0; row < ad.rect.h && same; row++) {
      const dst = dataAt + (ad.rect.y + row) * width + ad.rect.x
      if (Buffer.compare(mdl.subarray(src, src + ad.rect.w), mdl.subarray(dst, dst + ad.rect.w)) !== 0) same = false
    }
  }
  if (!same) adsLeft.push(`${ad.model}: ${ad.what}`)
}
add(adsLeft.length === 0, 'чужой рекламы на моделях нет',
  adsLeft.length ? adsLeft.join('; ') : `закрашено надписей: ${ADS.length}`)

// Адрес донора бывает не нарисован, а вписан в файл: части, подмодели и
// текстуры названы «vk.com/zm7up», «ZM7UP.RU», «:REEGA:777.bmp». Игрок этого не
// видит, но в сборке чужого адреса быть не должно.
// ⚠️ Раньше здесь смотрели только названия ЧАСТЕЙ, а донор подписывал в
// основном ПОДМОДЕЛИ и ТЕКСТУРЫ — проверка была зелёной при сотне меток в
// файлах. Теперь partNames отдаёт все три вида подписей сразу.
const tagged = []
const plated = []
const walkModels = dir => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walkModels(p)
    else if (n.toLowerCase().endsWith('.mdl')) {
      const bad = partNames(p).filter(s => NAME_ADS.test(s))
      if (bad.length) tagged.push(`${n}: ${bad.join(', ')}`)
      for (const plate of findPlates(p)) plated.push(`${n}: часть ${plate.bodypart}.${plate.model}, ${plate.size} юнитов`)
    }
  }
}
walkModels(join(ROOT, 'server', 'cstrike', 'models'))
add(tagged.length === 0, 'чужого адреса в подписях частей моделей нет',
  tagged.length ? tagged.slice(0, 5).join('; ') : 'проверены все модели сборки')

// ⚠️ Визитка донора — не надпись на текстуре, а ОТДЕЛЬНЫЙ КУСОК МОДЕЛИ:
// плоский прямоугольник 94x66 юнитов с картинкой «Reega! ... = Best Friends».
// Нашёлся в десяти моделях — ножах, лапах зомби и стволах магазина. Ищем по
// приметам, поэтому проверка поймает его и в модели, перенесённой завтра.
add(plated.length === 0, 'визиток донора в моделях нет',
  plated.length ? plated.slice(0, 5).join('; ') : 'плоских подписей-картинок не осталось')

// Переименование путей — самая механическая правка из всех, и самая тихая при
// ошибке: плагин просит файл, которого нет, и сервер падает на предзагрузке
// карты. Поэтому сверяем КАЖДУЮ ссылку из наших плагинов с тем, что уложено.
const OUR = /"((?:models|sprites|sound)\/(?:zm_hot[\w]*)\/[^"]+)"/g
const lost = new Set()
for (const f of readdirSync(join(ROOT, 'custom', 'plugins'))) {
  if (!f.endsWith('.sma')) continue
  const src = readFileSync(join(ROOT, 'custom', 'plugins', f), 'utf8')
  for (const m of src.matchAll(OUR)) {
    if (m[1].includes('%')) continue                       // шаблон формата, не путь
    if (!existsSync(join(ROOT, 'server', 'cstrike', ...m[1].split('/')))) lost.add(`${f}: ${m[1]}`)
  }
}
add(lost.size === 0, 'все наши пути к ресурсам ведут в уложенные файлы',
  lost.size ? [...lost].slice(0, 5).join('; ') : 'проверены ссылки во всех наших плагинах')

// Чужих названий в путях остаться не должно — иначе клиент возьмёт из кэша
// файл, скачанный с другого сервера, и наша правка до него не доедет.
const foreign = new Set()
for (const f of readdirSync(join(ROOT, 'custom', 'plugins'))) {
  if (!f.endsWith('.sma')) continue
  const src = readFileSync(join(ROOT, 'custom', 'plugins', f), 'utf8')
  for (const m of src.matchAll(/"((?:models|sprites|sound)\/[^"]+)"/g)) {
    if (/\/(csdead1|jp_models|jp_ef)|"(models|sprites|sound)\/(csdead1|jp_)/.test(m[0])) foreign.add(`${f}: ${m[1]}`)
  }
}
add(foreign.size === 0, 'чужих названий в путях не осталось',
  foreign.size ? [...foreign].slice(0, 5).join('; ') : 'все ресурсы лежат под zm_hot')

// Меню обрезало нижние пункты: у страницы меню GoldSrc считанные сотни байт, а
// русская буква весит две. Считаем самую тяжёлую страницу — семь пунктов подряд
// с самыми длинными названиями плюс заголовок, нумерация и «Выход».
const bytes = s => Buffer.byteLength(s, 'utf8')

// Пунктов на странице ровно столько, сколько выставлено в плагине: с этим
// числом и надо считать, иначе проверка сторожит не то меню.
const perPage = src => Number((/MPROP_PERPAGE, (\d+)\)/.exec(src) || [])[1] || 7)

function heaviestPage(lines, count) {
  const head = bytes('\\y[Вспышка эпидемии]\\w Магазин скинов\n\\d----------------------------\n\\wКредитов: 9999\n')
  const tail = bytes('8. Назад\n9. Далее\n0. Выход\n')
  return head + [...lines].sort((a, b) => b - a).slice(0, count).reduce((a, b) => a + b, 0) + tail
}

// Самая длинная подпись уровня — «Император»; её и берём как худший случай.
const knifeLines = [...knivesSrc.matchAll(/^\s*\{ "([^"]+)",[\s\S]*?"([^"]*)" \},?$/gm)]
  .map(m => bytes(`0. ${m[1]} (Император, ${m[2]})\n`))
const skinLines = skinRows.map(r => bytes(`0. ${r.title} (Император)\n`))

const worstKnives = heaviestPage(knifeLines, perPage(knivesSrc))
const worstSkins = heaviestPage(skinLines, perPage(skinsSrc))
const LIMIT = 512
add(worstKnives < LIMIT && worstSkins < LIMIT, 'страница меню влезает целиком',
  `самая тяжёлая страница: ножи ${worstKnives} Б, скины ${worstSkins} Б при пределе ${LIMIT} Б`)

// Предпросмотр скина: своей модели игрок не видит никогда, поэтому выбор без
// показа — вслепую. Показываем МАНЕКЕН перед игроком, а не вид из-за спины:
// свой игрок от третьего лица рисуется клиентом просвечивающим (измерено
// кадрами 2026-08-10), и сервер на это не влияет. Сверяем и постановку, и
// уборку: забытый манекен остаётся стоять посреди карты.
const viewParts = [
  ['команда', /register_clcmd\("zp_skin_view", "cmd_look"\)/],
  ['манекен', /create_dummy\(id, path\)/],
  ['модель берётся с игрока', /cs_get_user_model\(id, model, charsmax\(model\)\)/],
  ['манекен не мешает', /set_pev\(ent, pev_solid, SOLID_NOT\)/],
  ['уборка манекена', /engfunc\(EngFunc_RemoveEntity, g_dummy\[id\]\)/],
  ['уборка по времени', /set_task\(float\(secs\), "view_back"/],
  ['снятие при смерти', /public fw_killed_post\(id\) unlook\(id\)/],
  ['снятие при заражении', /public zp_user_infected_post\([^)]*\) unlook\(id\)/],
  ['снятие задачи при выходе', /remove_task\(id \+ TASK_VIEW\)/],
  ['снятие при возрождении', /unlook\(id\)\n\s*apply\(id\)/],
]
const viewMissing = viewParts.filter(([, re]) => !re.test(skinsSrc)).map(([n]) => n)
add(viewMissing.length === 0, 'предпросмотр скина манекеном собран целиком',
  viewMissing.length ? `не хватает: ${viewMissing.join(', ')}` : `проверено частей: ${viewParts.length}`)

// Буква флага НЕ выводится из имени константы: ADMIN_LEVEL_H — это «t». Панель
// выдачи и справка add-admin.mjs печатают буквы из TIERS, и если они разойдутся
// с amxconst.inc, запись в users.ini появится, а прав не будет — молча.
const amxconst = readFileSync(join(AMXX, 'scripting', 'include', 'amxconst.inc'), 'utf8')
const letterOf = konst => {
  const m = new RegExp(`#define\\s+${konst}\\s+\\(1<<\\d+\\)\\s*/\\* flag "(.)"`).exec(amxconst)
  return m ? m[1] : '?'
}
const wrongLetters = TIERS.filter(t => letterOf(t.konst) !== t.letter)
add(wrongLetters.length === 0, 'буквы уровней сходятся с amxconst.inc',
  wrongLetters.length
    ? wrongLetters.map(t => `${t.konst}: в панели «${t.letter}», в игре «${letterOf(t.konst)}»`).join('; ')
    : TIERS.map(t => `${t.name} ${t.letter}`).join(', '))

// Числа уровней панель показывает игроку до выдачи. Врать они не должны:
// раздаёт кредиты и здоровье zp_vip.sma, а не панель.
const vipSrc = readFileSync(join(ROOT, 'custom', 'plugins', 'zp_vip.sma'), 'utf8')
const inGame = [...vipSrc.matchAll(/\{\s*"([^"]+)",\s*ADMIN_LEVEL_(\w),\s*(\d+),\s*(\d+),\s*(\d+),\s*"([^"]*)",\s*(\d+)\s*\}/g)]
  .map(m => ({ name: m[1], packs: +m[3], health: +m[4], knives: +m[5], skin: m[6], sold: m[7] === '1' }))
const drift = TIERS.filter((t, i) => {
  const g = inGame[i]
  return !g || g.name !== t.name || g.packs !== t.packs || g.health !== t.health
    || g.knives !== t.knives || g.skin !== t.skin || g.sold !== t.sold
})
add(inGame.length === TIERS.length && drift.length === 0, 'панель обещает ровно то, что даёт zp_vip.sma',
  drift.length ? `разошлись: ${drift.map(t => t.name).join(', ')}` : `сверено уровней: ${inGame.length}`)

// ── модель класса зомби не подменяется админской ────────────────────────────────
//
// У мода есть свои «модели для админов», и он ставит их ПОВЕРХ модели класса.
// Открыты они флагом «d» из zombie_plague_v44.ini — обычный ADMIN_BAN, который
// есть у каждого настоящего админа, включая владельца. Из-за этого владелец
// брал любой класс зомби, а ходил всегда стандартным zombie_source_v44.
const zpcfg = readFileSync(join(AMXX, 'configs', 'zombie_plague_v44.cfg'), 'utf8')
const adminModelsOn = [
  ['zp_admin_models_zombie', /^zp_admin_models_zombie\s+0\b/m],
  ['zp_admin_models_human', /^zp_admin_models_human\s+0\b/m],
].filter(([, re]) => !re.test(zpcfg)).map(([n]) => n)
add(adminModelsOn.length === 0, 'мод не подменяет модель класса админской',
  adminModelsOn.length
    ? `включено: ${adminModelsOn.join(', ')} — админы перестанут видеть свои классы`
    : 'zp_admin_models_zombie и _human выключены')

// ── у каждого класса зомби своя лапа ────────────────────────────────────────────
//
// Две одинаковые лапы на разных классах игрок читает как «класс не встал».
const zclasses = readFileSync(join(AMXX, 'scripting', 'zp_zclasses44.sma'), 'utf8')
const vipClasses = readFileSync(join(ROOT, 'custom', 'plugins', 'zp_zclass_vip.sma'), 'utf8')
const soloClasses = ['zp_zclass_electric', 'zp_zclass_student']
  .map(n => readFileSync(join(ROOT, 'custom', 'plugins', `${n}.sma`), 'utf8'))
// Перенесённые классы CSO объявляют лапу иначе — zclass_clawmodel, иногда в
// фигурных скобках. Их тоже надо считать: две одинаковые лапы у разных классов
// игрок читает как «класс не встал», а с чужими плагинами это ещё вероятнее.
const csoClasses = readdirSync(join(ROOT, 'custom', 'plugins'))
  .filter(n => n.startsWith('cso_class_') && n.endsWith('.sma'))
  .map(n => readFileSync(join(ROOT, 'custom', 'plugins', n), 'utf8'))
const claws = [
  ...[...zclasses.matchAll(/zclass\d_clawmodel\[\]\s*=\s*\{\s*"([^"]+)"/g)].map(m => m[1]),
  ...[...vipClasses.matchAll(/^\s*\{ "[^"]+",\s*"[^"]*",\s*"[^"]*",\s*"([^"]+)"/gm)].map(m => m[1]),
  ...soloClasses.map(s => (s.match(/ZCLASS_CLAW_MDL\[\]\s*=\s*"([^"]+)"/) ?? [])[1]).filter(Boolean),
  ...csoClasses.map(s => (s.match(/zclass_clawmodel\[\]\s*=\s*\{?\s*"([^"]+)"/) ?? [])[1]).filter(Boolean),
]
const clawDupes = [...new Set(claws.filter((c, i) => claws.indexOf(c) !== i))]
const clawGone = claws.filter(c => !existsSync(join(ROOT, 'server', 'cstrike', 'models', 'zombie_plague_v44', c)))
add(claws.length >= 13 && clawDupes.length === 0 && clawGone.length === 0,
  'у каждого класса зомби своя лапа, и все они в сборке',
  clawDupes.length ? `одна лапа на несколько классов: ${clawDupes.join(', ')}`
    : clawGone.length ? `нет файлов: ${clawGone.join(', ')}`
      : `классов с лапами: ${claws.length}, все разные`)

// ── порядок классов в меню ──────────────────────────────────────────────────────
//
// ⚠️ Порядок пунктов в меню классов — это порядок, в котором плагины вызывают
// zp_register_zombie_class, то есть порядок загрузки. Поэтому читаем его из
// СОБРАННОГО plugins.ini, а не из имён файлов: как раз от алфавита имён мы и
// ушли, чтобы Ганимед и Ревенанты не стояли между бесплатными классами.
const loadOrder = readFileSync(join(AMXX, 'configs', 'plugins.ini'), 'latin1')
  .split(/\r?\n/).map(l => l.trim()).filter(l => /^[\w.]+\.amxx$/.test(l))
  .map(l => l.slice(0, -'.amxx'.length))
const ourSrc = n => {
  const p = join(ROOT, 'custom', 'plugins', `${n}.sma`)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}
// Классы одного плагина: у zp_zclass_vip это таблица, у остальных — пара
// констант рядом. Четыре поля в строке таблицы обязательны (имя, подпись,
// модель, лапа), иначе сюда попадает ещё и список имён чужих классов.
const oneClass = src => [
  (src.match(/(?:ZCLASS_NAME|zclass_name)\[\]\s*=\s*\{?\s*"([^"]+)"/) ?? [])[1],
  (src.match(/(?:ZCLASS_INFO|zclass_info)\[\]\s*=\s*\{?\s*"([^"]*)"/) ?? [])[1],
]
const classesOf = src => {
  const rows = [...src.matchAll(/^\s*\{ "([^"]+)",\s*"([^"]*)",\s*"[^"]*",\s*"[^"]*"/gm)]
  if (rows.length) return rows.map(m => [m[1], m[2]])
  const one = oneClass(src)
  return one[0] ? [one] : []
}
const classRows = [
  ...[...zclasses.matchAll(/zclass\d_name\[\]\s*=\s*\{\s*"([^"]+)"[\s\S]{0,80}?zclass\d_info\[\]\s*=\s*\{\s*"([^"]*)"/g)]
    .map(m => [m[1], m[2]]),
  ...loadOrder.filter(n => ourSrc(n).includes('zp_register_zombie_class'))
    .flatMap(n => classesOf(ourSrc(n))),
].filter(([n]) => n)

// Уровень, который открывает класс. Свои классы описаны таблицей, чужие —
// парой списков «имя» и «уровень» в том же плагине.
const list = re => ((vipClasses.match(re) ?? [])[1] ?? '').split(',').map(s => s.trim().replace(/^"|"$/g, ''))
const foreignNames = list(/g_foreign\[\]\[\]\s*=\s*\{([^}]*)\}/)
const foreignFlags = list(/g_foreign_flag\[\]\s*=\s*\{([^}]*)\}/)
const ownTiers = new Map([...vipClasses.matchAll(/^\s*\{ "([^"]+)",\s*"[^"]*",\s*"[^"]*",\s*"[^"]*",\s*(\w+),/gm)]
  .map(m => [m[1], m[2]]))
const tierOf = name => ownTiers.get(name) ?? foreignFlags[foreignNames.indexOf(name)] ?? '0'
const tiers = classRows.map(([n]) => ({ name: n, tier: tierOf(n) }))
const classesOrdered = tiers.every((r, i) => i === 0 || RANK[tiers[i - 1].tier] <= RANK[r.tier])
add(classesOrdered && tiers.filter(r => r.tier === '0').length >= 7,
  'классы зомби идут по возрастанию привилегии, бесплатные первыми',
  tiers.map(r => (r.tier === '0' ? r.name : `${r.name}/${r.tier}`)).join(', '))

// ── подпись класса обещает тот же уровень, что стоит на охране ──────────────────
//
// ⚠️ Уровень класса записан В ДВУХ МЕСТАХ и разными людьми: охрана — списком
// g_foreign_flag в zp_zclass_vip.sma, а слово в меню — подписью zclass_info,
// которую ставит tools/patch-ported.mjs. Разойдутся — игрок прочитает в меню
// «Император», возьмёт класс, и охрана вернёт его к обычному. Молча, и по всем
// признакам это «мод сломался», а не «уровень не тот».
const TIER_WORD = { VIP: 'VIP', LEADER: 'Лидер', IMPERATOR: 'Император', PHARAOH: 'Фараон', CREATOR: 'Создатель' }
const WORDS = Object.values(TIER_WORD)
// ⚠️ Границу слова `\b` здесь брать НЕЛЬЗЯ: без флага `u` она считает буквой
// только латиницу, и «\yЛидер» в конце строки ей никакая не граница — проверка
// молча объявляла бы все русские уровни отсутствующими. Смотрим сами: за словом
// не должно идти буквы.
const saidTier = info => WORDS.find(w => new RegExp(`\\\\y${w}(?![А-Яа-яЁёA-Za-z])`).test(info)) ?? ''
const tierMismatch = classRows
  .map(([name, info]) => ({ name, said: saidTier(info), want: TIER_WORD[tierOf(name)] ?? '' }))
  .filter(r => r.said !== r.want)
add(tierMismatch.length === 0, 'уровень в подписи класса совпадает с охраной',
  tierMismatch.length
    ? tierMismatch.map(r => `${r.name}: в меню «${r.said || 'без уровня'}», охрана «${r.want || 'без уровня'}»`).join('; ')
    : classRows.filter(([n]) => tierOf(n) !== '0').map(([n]) => `${n} — ${TIER_WORD[tierOf(n)]}`).join(', '))

// ── в сборке нет накопленного файла классов ─────────────────────────────────────
//
// ⚠️⚠️ Мод сам ДОПИСЫВАЕТ каждый зарегистрированный класс в configs/
// zp_zombie_classes_v44.ini, а на следующем старте читает его и ПЕРЕБИВАЕТ им
// то, что зарегистрировал плагин (zombie_plague44.sma, «Override zombie classes
// data with our customizations»). Значит на сервере, который уже отработал со
// старой раскладкой, подписи в меню останутся СТАРЫМИ, сколько плагины ни
// перезаливай, — а охрана будет новой. Ровно то расхождение, что проверено
// выше, только увидеть его можно лишь в игре.
// В сборку файл обязан уезжать пустой заготовкой: тогда мод напишет его заново.
const zclassIni = join(AMXX, 'configs', 'zp_zombie_classes_v44.ini')
const zclassIniText = existsSync(zclassIni) ? readFileSync(zclassIni, 'latin1') : ''
const grown = zclassIniText.split(/\r?\n/).filter(l => l.trim().startsWith('['))
add(existsSync(zclassIni) && grown.length === 0,
  'файл классов уезжает в сборку пустой заготовкой',
  grown.length
    ? `в нём уже накоплено ${grown.length} классов — они перебьют подписи из плагинов: ${grown.slice(0, 3).join(', ')}`
    : 'разделов классов нет, мод напишет их заново при старте')

// ── страница меню классов влезает в пакет ───────────────────────────────────────
//
// Каждая подпись подросла: в ней теперь способность и клавиша. Страница меню
// GoldSrc — около 512 байт, кириллица по два байта на букву. Перебор здесь не
// ошибка компиляции, а обрезанный пункт в игре. Страницы нарезаются по семь
// ПОДРЯД, поэтому считать «семь самых тяжёлых» нельзя: такой страницы не
// существует, и проверка врала бы.
const classLines = classRows.map(([n, i]) => bytes(`0. ${n} \\y[=${i}=]\n`))
// Считаем по НАСТОЯЩИМ страницам — по семь подряд, как их и шлёт мод, — а не
// по семи самым тяжёлым: у меню классов нет ни строки с кредитами, ни списка
// цен, и пессимистичная прикидка от меню скинов давала бы ложную тревогу.
const classHead = bytes('\\y[Вспышка эпидемии]\\w Класс зомби\\r\n')
const classTail = bytes('8. Назад\n9. Далее\n0. Выход\n')
let worstClasses = 0
for (let s = 0; s < classLines.length; s += 7) {
  const page = classHead + classLines.slice(s, s + 7).reduce((a, b) => a + b, 0) + classTail
  if (page > worstClasses) worstClasses = page
}
add(classLines.length >= 13 && worstClasses <= LIMIT, 'страница меню классов влезает целиком',
  `классов ${classLines.length}, самая тяжёлая страница ${worstClasses} Б при пределе ${LIMIT} Б`)

// ── вид гранаты зомби ставится и при доставании ─────────────────────────────────
//
// Мод ставит свою «бомбу заражения» в Ham_Item_Deploy, то есть РАНЬШЕ CurWeapon.
// Если мы правим вид только по событию, зомби на долю секунды видит штатную
// гранату с ЧЕЛОВЕЧЕСКИМИ руками вместо своей лапы.
add(/RegisterHam\(Ham_Item_Deploy, "weapon_hegrenade"/.test(nadesSrc),
  'вид гранаты зомби ставится и в момент доставания',
  /RegisterHam\(Ham_Item_Deploy, "weapon_hegrenade"/.test(nadesSrc)
    ? 'есть перехват Ham_Item_Deploy — штатная граната мода не мелькает'
    : 'только CurWeapon: между доставанием и событием видны людские руки')

// ── у Ведьмы и Шамана разные звуки способностей ─────────────────────────────────
//
// Один звук на двоих игрок читает как «способность не та»: у Ведьмы был крик
// Шамана. Проверяем прямо по файлам, а не по названию — совпадение легко
// вернуть, перепутав константу.
const witchSnd = (abil.match(/SND_BATS\[\]\s*=\s*"([^"]+)"/) ?? [])[1]
const shamanSnd = (readFileSync(join(ROOT, 'custom', 'plugins', 'cso_class_shaman.sma'), 'utf8')
  .match(/zclass_screamsounds\[\]\[\]\s*=\s*\{\s*"([^"]+)"/) ?? [])[1]
const witchFile = witchSnd && join(ROOT, 'server', 'cstrike', 'sound', witchSnd)
add(!!witchSnd && witchSnd !== shamanSnd && existsSync(witchFile),
  'у Ведьмы свой звук способности, не шаманский',
  !witchSnd ? 'не нашли SND_BATS'
    : witchSnd === shamanSnd ? `и у Ведьмы, и у Шамана «${witchSnd}»`
      : !existsSync(witchFile) ? `нет файла ${witchSnd}`
        : `Ведьма «${witchSnd}», Шаман «${shamanSnd}»`)

// ── граната отброса даётся один раз, дальше за кредиты ──────────────────────────
//
// Выдача по таймеру после каждого взрыва превращала зомби в метателя без
// патронов. Осталась одна выдача — в момент заражения; всё остальное покупка.
const nadeGives = (nadesSrc.match(/"give_nade"/g) ?? []).length
const pushInShop = /zp_register_extra_item\("Граната отброса"/.test(nadesSrc)
add(nadeGives === 1 && pushInShop, 'граната отброса выдаётся один раз, повторная — за кредиты',
  !pushInShop ? 'в спец-магазине нет «Гранаты отброса»'
    : nadeGives === 1 ? 'бесплатная выдача только при заражении, дальше спец-магазин'
      : `выдач по таймеру: ${nadeGives} — вернулась раздача после взрыва`)

// ── адресные сообщения не уходят в начало координат ─────────────────────────────
//
// message_begin(MSG_PVS, ...) требует ТОЧКУ третьим аргументом. Пропуск точки
// («_») превращает её в {0,0,0}: эффект уходит только тем, кто видит начало
// координат карты. Так молчал «Разряд» у Шокера.
const pvsNoOrigin = []
for (const [file, src] of [['zp_class_abilities.sma', abil], ['zp_zombie_nades.sma', nadesSrc]]) {
  for (const m of src.matchAll(/message_begin\(\s*MSG_(?:PVS|PAS)(?:_R)?\s*,[^)]*/g)) {
    if (/,\s*_\s*[,)]/.test(m[0])) pvsNoOrigin.push(`${file}: ${m[0].slice(0, 60)}`)
  }
}
add(pvsNoOrigin.length === 0, 'у сообщений MSG_PVS указана точка, а не «_»',
  pvsNoOrigin.length ? pvsNoOrigin.join('; ') : 'проверено в плагинах способностей и гранат')

// ── эффекты способностей видны сквозь зелёный экран зомби ───────────────────────
//
// Зомби смотрит через ночное зрение мода: экран залит зелёным. Тонкое кольцо у
// собственных ног в такой засветке не читается — нужна вспышка на уровне глаз.
const abilityKinds = [
  ['вспышка перед глазами', /flash\(id,/],
  ['динамический свет', /TE_DLIGHT/],
  ['двойная волна', /wave\(/],
]
const abilityMissing = abilityKinds.filter(([, re]) => !re.test(abil)).map(([n]) => n)
const fires = (abil.match(/\bflash\(id,/g) ?? []).length
// Порог по числу вспышек — по числу способностей в плагине: их семь, у каждой
// своя вспышка, и одна из них рисуется дважды (уход и приход у скачка).
add(abilityMissing.length === 0 && fires >= 6, 'способности видно сквозь зелёный экран зомби',
  abilityMissing.length ? `нет: ${abilityMissing.join(', ')}` : `вспышек в способностях: ${fires}`)

// ── всё, что сервер предзагружает, лежит в сборке ───────────────────────────────
//
// Клиент просит у сервера каждый файл из списка предзагрузки. Файла нет —
// клиент пишет «server failed to transmit file», а в игре ствол стреляет молча
// и значок в HUD пустой. Сервер при этом не падает, поэтому пропажу видно
// только со стороны клиента. Проверяем сами.
const CSTRIKE = join(ROOT, 'server', 'cstrike')
const STOCK = join(ROOT, 'build', 'hlds-base')
const resMissing = new Set()
let resChecked = 0
for (const f of readdirSync(join(AMXX, 'scripting')).filter(n => n.endsWith('.sma'))) {
  const src = readFileSync(join(AMXX, 'scripting', f), 'utf8')
  const paths = [
    ...[...src.matchAll(/"((?:models|sprites)\/[^"%]+\.(?:mdl|spr))"/g)].map(m => m[1]),
    ...[...src.matchAll(/"(sound\/[^"%]+\.(?:wav|mp3))"/g)].map(m => m[1]),
    ...[...src.matchAll(/"((?!models\/|sprites\/|sound\/)[A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:wav|mp3))"/g)]
      .map(m => `sound/${m[1]}`),
  ]
  for (const p of new Set(paths)) {
    resChecked++
    if (existsSync(join(CSTRIKE, ...p.split('/')))) continue
    if (existsSync(join(STOCK, 'cstrike', ...p.split('/')))) continue
    if (existsSync(join(STOCK, 'valve', ...p.split('/')))) continue
    resMissing.add(`${f}: ${p}`)
  }
}
add(resMissing.size === 0, 'все упомянутые в плагинах модели, звуки и спрайты есть в сборке',
  resMissing.size
    ? `нет ${resMissing.size} из ${resChecked}: ${[...resMissing].slice(0, 6).join('; ')}${resMissing.size > 6 ? ' …' : ''}`
    : `проверено путей: ${resChecked}`)

// ── ни одна модель не выходит за пределы движка ─────────────────────────────────
//
// ⚠️ Это не «некрасиво», а закрытая игра. У рисовальщика моделей массивы
// фиксированной длины, и на превышении он не рисует хуже — он ВЫХОДИТ: строка
// «Too many attachments on %s» лежит и в hw.dll, и в cstrike/cl_dlls/client.dll
// клиента, а сразу за ней exit(-1). Поймали на скине «Зимняя»: одиннадцать
// точек крепления при пределе в четыре, и владелец вылетал из игры, едва
// увидев его на себе. Проверяем ВСЕ модели сборки, а не только новые.
function listModels(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) listModels(p, out)
    else if (name.toLowerCase().endsWith('.mdl')) out.push(p)
  }
  return out
}
const shippedModels = listModels(join(ROOT, 'server', 'cstrike', 'models'))
const overLimit = []
for (const p of shippedModels) {
  const bad = inspectModel(p).problems.filter(x => x.severity === 'critical')
  if (bad.length) overLimit.push(`${p.split(/[\\/]/).pop()}: ${bad[0].text}`)
}
add(overLimit.length === 0, 'ни одна модель не выходит за жёсткие пределы движка',
  overLimit.length
    ? `${overLimit.length} шт. — ${overLimit.slice(0, 3).join('; ')}`
    : `проверено моделей: ${shippedModels.length}`)

// ── цветовой код не съедает следующую букву ─────────────────────────────────────
//
// В Pawn «^» — знак подстановки, и «^x» забирает СТОЛЬКО шестнадцатеричных
// цифр, сколько найдёт. Поэтому «^x04E» — это не «цвет, потом буква E», а один
// символ 0x4E, то есть «N». В подсказке способности из-за этого стояло
// «клавиша N» вместо «клавиша E». В исходнике такое не видно, только в
// собранном плагине. Спасает точка с запятой: «^x04;E».
const hexEat = []
for (const f of readdirSync(join(ROOT, 'custom', 'plugins')).filter(n => n.endsWith('.sma'))) {
  // Пояснения снимаем: в них этот же образец приведён как пример ошибки.
  const src = readFileSync(join(ROOT, 'custom', 'plugins', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const m of src.matchAll(/\^x[0-9A-Fa-f]{2}[0-9A-Fa-f]/g)) hexEat.push(`${f}: ${m[0]}`)
}
add(hexEat.length === 0, 'цветовой код не склеивается со следующей буквой',
  hexEat.length ? `${hexEat.join(', ')} — нужна «;» после кода` : 'проверены все наши плагины')

// ── окно приветствия читается по-русски ─────────────────────────────────────────
//
// Рисует его встроенный браузер клиента, и без объявления кодировки русский
// текст приходит как «ÐÐµÑ€Ð²ÐµÑ€ ÑÐ¾Ð±Ñ€Ð°Ð½…».
const motd = readFileSync(join(CSTRIKE, 'motd.txt'), 'utf8')
add(/charset=utf-8/i.test(motd), 'в окне приветствия объявлена кодировка',
  /charset=utf-8/i.test(motd) ? 'есть <meta charset=utf-8>' : 'нет объявления — русский текст будет кракозябрами')

// ── итог ────────────────────────────────────────────────────────────────────────

console.log('')
let failed = 0
for (const c of checks) {
  if (!c.ok) failed++
  console.log(`${c.ok ? '[ OK ]' : '[ХУЖЕ]'} ${c.name}`)
  console.log(`       ${c.detail}`)
}
console.log('')
console.log(`итог: ${checks.length - failed} из ${checks.length} проверок пройдено`)
process.exit(failed ? 1 : 0)
