// Живая проверка хранения в базе.
//
// ЗАЧЕМ ЖИВОЙ СЕРВЕР. Что запросы написаны — видно и глазами. А вот работает ли
// цепочка целиком, глазами не увидеть: между «игрок набрал кредиты» и «они
// вернулись после смены карты» лежат сохранение при выгрузке плагина, создание
// таблиц, потоковый запрос и чтение с задержкой в три секунды. Любое звено
// молчит при поломке — сервер просто отдаёт новичка вместо старожила.
//
// ⚠️ ПРОВЕРКА ИДЁТ ПО ТОМУ, ЧТО НАСТРОЕНО. Есть custom/db.ini — сервер собран
// на MySQL, и тогда запись сверяется прямо в боевой базе, запросом по сети;
// нет файла — SQLite, и сверяется файл базы рядом с сервером. Код плагинов
// один и тот же (общий слой sqlx), отличается только amx_sql_type в
// configs/sql.cfg, поэтому одной проверки хватает на оба случая.
//
// ⚠️ СМЕНА КАРТЫ — ЭТО И ЕСТЬ ПРОВЕРКА. Файлы-хранилища переживали её и раньше;
// смысл перехода на базу в том, чтобы данные пережили переезд сервера. Ближайшее
// к переезду, что можно устроить на месте, — полная перезагрузка карты: плагины
// выгружаются, память обнуляется, и всё, что не записано, теряется.
//
// Запуск: node tools/test-db.mjs

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readDbIni } from './db-config.mjs'
import { start, stopAll } from './live.mjs'
import { open } from './mysql.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUN = join(ROOT, 'run')
const ACTIONS = join(RUN, 'cstrike', 'addons', 'amxmodx', 'logs', 'zp_actions.log')
const SQLITE = join(RUN, 'cstrike', 'addons', 'amxmodx', 'data', 'sqlite3', 'cs16zm.sq3')

const wait = ms => new Promise(r => setTimeout(r, ms))

let ok = 0
let bad = 0
function check(name, pass, detail = '') {
  if (pass) { ok++; console.log(`[ ОК  ] ${name}${detail ? `\n       ${detail}` : ''}`) }
  else { bad++; console.log(`[ НЕТ ] ${name}${detail ? `\n       ${detail}` : ''}`) }
}

const fileSize = p => (existsSync(p) ? statSync(p).size : 0)
function since(path, from) {
  if (!existsSync(path)) return ''
  const buf = readFileSync(path)
  return buf.subarray(Math.min(from, buf.length)).toString('utf8')
}

const PACKS = 777   // приметное число: в журнале его ни с чем не спутать

// На чём собран сервер, на том и проверяем. Файл с доступом лежит вне
// репозитория, поэтому у свежей копии проверка сама уходит на SQLite.
const DRIVER = readDbIni() ? 'mysql' : 'sqlite'
console.log(`база: ${DRIVER}`)

// Журнал AMXX за день один, и в нём лежат все прошлые прогоны. Запоминаем
// длину на старте, чтобы смотреть только то, что напишет ЭТОТ сервер.
function amxxPath() {
  const dir = join(RUN, 'cstrike', 'addons', 'amxmodx', 'logs')
  const files = existsSync(dir) ? readdirSync(dir).filter(f => /^L\d+\.log$/.test(f)).sort() : []
  return files.length ? join(dir, files[files.length - 1]) : join(dir, 'нет.log')
}
const amxxMark = fileSize(amxxPath())

const server = await start({ map: 'de_dust2', bots: 4 })
try {
  const { rcon } = server
  await wait(5000)

  // Имя бота — это его ключ в базе: SteamID у ботов нет, и плагины кладут их
  // под «ник:Имя», ровно как игрока без Steam. На этом и проверяем.
  // ⚠️ ПОДОПЫТНОГО БЕРЁМ С ЛАТИНСКИМ НИКОМ. У YaPB половина имён русские
  // («алексей»), а команда rcon с кириллицей до сервера доезжает не тем, чем
  // ушла: zp_packs не находит игрока, и проверка врёт про сохранение — хотя в
  // базе у этого же бота всё лежит верно (проверено запросом). Сам сервер с
  // русскими никами работает; беда только в способе им управлять.
  const all = [...(await rcon.run('zp_progress_show')).matchAll(/\n\s+(\S+)\s+ключ\s+(ник:\S+)/g)]
  const who = all.find(m => /^[\x20-\x7e]+$/.test(m[1])) ?? all[0] ?? null
  check('сервер видит игроков и их ключи', who !== null,
    who ? `первый: ${who[1]}, ключ ${who[2]}` : 'zp_progress_show ничего не вернул')
  if (!who) throw new Error('некого проверять')

  const name = who[1]
  const key = who[2]

  // Даём приметную сумму и ждём, пока плагин посчитает игрока «загруженным»:
  // до этого он НАРОЧНО ничего не сохраняет, чтобы не затереть настоящую запись.
  await rcon.run(`zp_packs ${name} ${PACKS}`)
  await wait(4000)

  const mark = fileSize(ACTIONS)

  // Полная перезагрузка карты: плагины выгружаются, память обнуляется. Всё, что
  // не доехало до базы, на этом и теряется.
  await rcon.run('changelevel de_dust2')
  await wait(20000)

  // ⚠️⚠️ ПРОВЕРЯЕМ, В КАКУЮ БАЗУ МЫ ВООБЩЕ ХОДИМ. Настройки приезжают из
  // configs/sql.cfg, а выполняет его штатный admin.amxx концом кадра — позже,
  // чем наш plugin_cfg. Соединение, построенное раньше, молча уходит в
  // заводскую базу «amx» на 127.0.0.1, и снаружи это выглядит как «сохранение
  // просто не работает». Ровно так и было до правки; строка ниже — сторож.
  // ⚠️ ЧИТАЕМ ТОЛЬКО СВЕЖИЙ ХВОСТ ЖУРНАЛА. Файл общий на весь день, и жалоба
  // из прошлого прогона («Failed to set affinity» до того, как в сборку
  // добавили модуль mysql) осталась бы в нём навсегда — проверка врала бы
  // красным на исправном сервере.
  const amxxLog = since(amxxPath(), amxxMark)
  check('плагины ходят в ту базу, что настроена', new RegExp(`БАЗА: работаем через ${DRIVER}`).test(amxxLog)
    && !/Failed to set affinity/.test(amxxLog),
    /Failed to set affinity/.test(amxxLog)
      ? 'в журнале «Failed to set affinity» — соединение построено до чтения sql.cfg'
      : `в журнале: «работаем через ${DRIVER}», жалоб на настройку нет`)

  if (DRIVER === 'sqlite') {
    // Файл базы обязан появиться и подрасти: пустой файл означал бы, что
    // запросы не дошли вовсе.
    check('файл базы создан и не пуст', fileSize(SQLITE) > 0,
      `${SQLITE.replace(ROOT, '.')} — ${fileSize(SQLITE)} байт`)
  } else {
    // ⚠️ САМАЯ ВАЖНАЯ ПРОВЕРКА ПРИ MySQL: смотрим не в журнал сервера, а в саму
    // базу на хостинге — теми же глазами, что и сайт. Журнал мог бы врать при
    // любой ошибке на той стороне: плагин пишет «сохранено» до того, как ответ
    // придёт обратно.
    const db = await open()
    try {
      const tables = (await db.query('SHOW TABLES')).rows.map(r => Object.values(r)[0])
      const need = ['zm_progress', 'zm_knife', 'zm_skin', 'zm_stats']
      const missing = need.filter(t => !tables.includes(t))
      check('таблицы заведены в базе сайта', missing.length === 0,
        missing.length ? `не хватает: ${missing.join(', ')}` : `есть все четыре: ${need.join(', ')}`)

      // ⚠️ ЖДЁМ, А НЕ СПРАШИВАЕМ ОДИН РАЗ. Запись уходит потоковым запросом, и
      // между «плагин выгрузился» и «строка появилась в базе на другом конце
      // страны» проходят секунды. Одиночный вопрос сразу после смены карты
      // показывал «строки нет» на исправном сохранении.
      let row
      for (let i = 0; i < 12 && !row; i++) {
        if (i) await wait(2000)
        row = (await db.query(`SELECT packs, zclass FROM zm_progress WHERE steamid = '${key.replace(/'/g, "''")}'`)).rows[0]
      }
      check('запись доехала до боевой базы', row !== undefined && Number(row.packs) === PACKS,
        row ? `в базе кредитов ${row.packs}, класс «${row.zclass}»` : `строки ${key} в zm_progress нет`)

      // Кириллица едет через три границы (плагин -> модуль MySQL -> база), и
      // на любой её можно потерять. Название класса — единственное русское
      // поле, по нему и видно.
      const cyr = (await db.query("SELECT zclass FROM zm_progress WHERE zclass REGEXP '[А-Яа-я]' LIMIT 1")).rows[0]
      check('русские названия классов читаются из базы', cyr !== undefined,
        cyr ? `например: «${cyr.zclass}»` : 'ни одного русского названия — проверьте кодировку соединения')
    } finally {
      db.close()
    }
  }

  // Ждём, пока боты вернутся и плагин прочитает их (чтение отложено на 3 с).
  let restored = null
  for (let i = 0; i < 25 && !restored; i++) {
    await wait(1000)
    const fresh = since(ACTIONS, mark)
    // ⚠️ find() возвращает undefined, а не null: без «?? null» проверка ниже
    // считала бы «ничего не нашли» успехом.
    restored = fresh.split('\n').reverse().find(l => l.includes('из базы') && l.includes(key)) ?? null
  }
  check('после смены карты прочитано ИЗ БАЗЫ', restored !== null,
    restored ? restored.trim() : `строки «из базы» для ${key} не появилось`)

  check('вернулась та самая сумма', restored !== null && restored.includes(`кредитов ${PACKS}`),
    restored ? restored.trim() : '')

  // И то же самое со стороны игры, а не журнала: сервер должен отдавать эти
  // кредиты игроку прямо сейчас.
  let live = -1
  for (let i = 0; i < 10 && live !== PACKS; i++) {
    const info = await rcon.run(`zp_ability_info ${name}`)
    live = Number((info.match(/кредиты=(-?\d+)/) ?? [])[1] ?? -1)
    if (live !== PACKS) await wait(1000)
  }
  check('кредиты действительно на игроке', live === PACKS, `у ${name}: ${live}`)
} finally {
  await stopAll()
}

console.log(`\nитог: ${ok} из ${ok + bad} проверок пройдено`)
process.exit(bad ? 1 : 0)
