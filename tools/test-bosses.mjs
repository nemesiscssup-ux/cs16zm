// Живая проверка боссов режимов: облик и руки.
//
// ЗАЧЕМ ЖИВОЙ СЕРВЕР. Строку в конфиге проверяет tools/verify-ru.mjs, но она
// доказывает только намерение. Между строкой и тем, что видит игрок, лежат три
// места, где всё молча ломается:
//
//   1. модель не загрузилась (нет файла) — сервер пишет «not precached» и
//      ставит игроку пустоту;
//   2. мод перекрыл наш облик своим — так админская модель мода когда-то
//      затирала модель класса зомби у владельца сервера;
//   3. роль вообще не встала: мод отказывает, если на карте мало игроков.
//
// Поэтому поднимаем настоящий сервер с ботами, назначаем каждую роль по очереди
// и спрашиваем у сервера, что на игроке НА САМОМ ДЕЛЕ.
//
// Запуск: node tools/test-bosses.mjs

import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { start, stopAll } from './live.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUN = join(ROOT, 'run')
const STDOUT = join(RUN, 'live-stdout.log')

const wait = ms => new Promise(r => setTimeout(r, ms))

let ok = 0
let bad = 0
function check(name, pass, detail = '') {
  if (pass) { ok++; console.log(`[ ОК  ] ${name}${detail ? `\n       ${detail}` : ''}`) }
  else { bad++; console.log(`[ НЕТ ] ${name}${detail ? `\n       ${detail}` : ''}`) }
}

// Кого проверяем. Команда — админская команда мода, облик и руки — то, что
// обязано оказаться на игроке.
//
// ⚠️ У ЛЮДЕЙ «РУКИ» — ЭТО ИХ ОРУЖИЕ ОТ ПЕРВОГО ЛИЦА: отдельной модели рук у
// Выжившего и Снайпера нет, и мод подменяет им вид ствола.
const BOSSES = [
  { name: 'Дьявол', cmd: 'zp_nemesis', model: 'zm_hot_boss_nemesis', view: 'models/zombie_plague_v44/v_zm_hot_nemesis.mdl' },
  { name: 'Убийца', cmd: 'zp_assassin', model: 'zm_hot_boss_assassin', view: 'models/zombie_plague_v44/v_zm_hot_assassin.mdl' },
  { name: 'Выживший', cmd: 'zp_survivor', model: 'zm_hot_boss_survivor', view: 'models/zm_hot_v/v_mk48.mdl' },
  { name: 'Снайпер', cmd: 'zp_sniper', model: 'zm_hot_boss_sniper', view: 'models/zm_hot_v/v_trg42.mdl' },
]

const fileSize = p => (existsSync(p) ? statSync(p).size : 0)
function since(path, from) {
  if (!existsSync(path)) return ''
  const buf = readFileSync(path)
  return buf.subarray(Math.min(from, buf.length)).toString('latin1')
}

const server = await start({ map: 'de_dust2', bots: 6 })
try {
  const { rcon } = server
  await wait(4000)

  // Файлы моделей сервер грузит на старте карты. Если хоть одной нет, он ещё
  // до всяких ролей напишет об этом в консоль — ловим сразу.
  const boot = since(STDOUT, 0)
  const bootMissing = boot.split('\n').filter(l => /not precached|failed to precache|couldn't spawn/i.test(l))
  check('карта загрузилась без пропавших моделей', bootMissing.length === 0,
    bootMissing.length ? bootMissing.slice(0, 3).join('\n       ') : 'жалоб на загрузке нет')

  // ⚠️ ГРАНАТУ ЗОМБИ НА ВРЕМЯ ПРОВЕРКИ ВЫКЛЮЧАЕМ. «Руки» читаются как вид
  // оружия В РУКАХ, а зомби получает при заражении гранату отброса и бот
  // немедленно достаёт её — вместо лапы в ответе оказывается v_zbomb2.mdl.
  // Это не поломка лапы, а бот с гранатой; убираем помеху, а не подгоняем
  // ожидание под неё.
  await rcon.run('zp_znade_enabled 0')

  for (const boss of BOSSES) {
    const mark = fileSize(STDOUT)

    // ⚠️ ПОВТОРЯЕМ САМУ КОМАНДУ, а не просто ждём дольше. Роль встаёт не
    // мгновенно и не всегда с первого раза: мод отказывает, если людей на карте
    // не осталось, а бота могут убить между назначением и проверкой. Ровно та
    // же гонка, что в test-classes.mjs.
    //
    // ⚠️⚠️ И ПЕРЕД КАЖДОЙ ПОПЫТКОЙ ДЕЛАЕМ ЗОМБИ ДВУХ ДРУГИХ. Мод не отдаёт
    // ПОСЛЕДНЕГО зомби обратно в люди — иначе раунд кончился бы сам собой. На
    // этом проверка сначала и споткнулась: Убийца оставался Убийцей, а
    // Выживший с Снайпером «не вставали» вовсе.
    let model = '', view = ''
    let sawModel = false, sawView = false
    for (let attempt = 0; attempt < 8 && !(sawModel && sawView); attempt++) {
      await rcon.run('zp_respawn #1')
      await rcon.run('zp_zombie #2')
      await rcon.run('zp_zombie #3')
      await wait(500)
      await rcon.run('zp_human #1')
      await wait(600)
      await rcon.run(`${boss.cmd} #1`)
      await wait(1200)

      const info = await rcon.run('zp_ability_info #1')
      model = (info.match(/облик=(\S*)/) ?? [])[1] ?? ''
      view = (info.match(/руки=(\S*)/) ?? [])[1] ?? ''
      // Достаточно ОДНОГО раза: вид оружия меняется, как только бот берёт в
      // руки другой ствол, и требовать совпадения «прямо сейчас» — это ловить
      // бота за руку, а не проверять мод.
      if (model === boss.model) sawModel = true
      if (view === boss.view) sawView = true
    }

    check(`${boss.name}: облик ${boss.model}`, sawModel, `облик=${model || '—'}`)
    check(`${boss.name}: руки ${boss.view}`, sawView, `руки=${view || '—'}`)

    const fresh = since(STDOUT, mark)
    const missing = fresh.split('\n').filter(l => l.includes('not precached'))
    check(`${boss.name}: без пропавших ресурсов`, missing.length === 0,
      missing.length ? missing.slice(0, 3).join('\n       ') : '')
  }

  await rcon.run('zp_znade_enabled 1')
} finally {
  await stopAll()
}

console.log(`\nитог: ${ok} из ${ok + bad} проверок пройдено`)
process.exit(bad ? 1 : 0)
