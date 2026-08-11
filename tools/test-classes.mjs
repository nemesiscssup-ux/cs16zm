// Живая проверка классов зомби и их способностей.
//
// Проверять это чтением исходников бесполезно: класс мод применяет только в
// момент заражения, модель ставит своим кодом, а звук способности молча не
// играет, если файл не загружен заранее. Единственное доказательство — ответ
// живого сервера, поэтому здесь поднимается настоящий сервер с ботами.
//
// Так и нашлось, почему «способности не работают»: звуки лежали по пути
// zombie_plague/, а в нашей 4.4 каталог называется zombie_plague_v44 — сервер
// писал «not precached» в консоль, и способность выглядела беззвучной пустышкой.
//
// ⚠️ Проверка идёт по ЖИВОЙ игре с ботами, и одна-две проверки из полусотни
// изредка падают из-за самой игры: бота убивают между «расчеловечить» и
// «заразить заново», и в журнал попадает модель человека. Попытка повторяется
// восемь раз; если класс или модель не сходятся во ВСЕХ попытках — это уже
// поломка, а не гонка.
//
// Запуск: node tools/test-classes.mjs

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { start, stopAll } from './live.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUN = join(ROOT, 'run')
const ACTIONS = join(RUN, 'cstrike', 'addons', 'amxmodx', 'logs', 'zp_actions.log')
const STDOUT = join(RUN, 'live-stdout.log')

const wait = ms => new Promise(r => setTimeout(r, ms))

let ok = 0
let bad = 0
function check(name, pass, detail = '') {
  if (pass) { ok++; console.log(`[ ОК  ] ${name}${detail ? `\n       ${detail}` : ''}`) }
  else { bad++; console.log(`[ НЕТ ] ${name}${detail ? `\n       ${detail}` : ''}`) }
}

// ⚠️ Номер класса у мода — это ПОРЯДОК РЕГИСТРАЦИИ, а он зависит от порядка
// плагинов в plugins.ini. Стоит добавить один класс — и все номера ниже
// съезжают, а прошитый в тесте номер начинает указывать на чужой класс.
// Поэтому номера не пишем, а берём из списка, который мод сам составляет при
// старте карты: порядок секций в нём и есть нумерация.
const CLASSES_INI = join(RUN, 'cstrike', 'addons', 'amxmodx', 'configs', 'zp_zombie_classes_v44.ini')
function classIds() {
  if (!existsSync(CLASSES_INI)) return new Map()
  const names = [...readFileSync(CLASSES_INI, 'utf8').matchAll(/^\[(.+)\]$/gm)].map(m => m[1])
  return new Map(names.map((n, i) => [n, i]))
}

// Все классы сборки: модель игрока, лапа и название способности.
// Лапа проверяется наравне с моделью: у двух классов она оказалась одна и та
// же, и заметить это можно было только в игре.
const CLASSES = [
  { name: 'Обычный',   model: 'zombie_source_v44',  claw: 'zp_claw_source_v44.mdl', ability: 'Рывок' },
  { name: 'Раптор',    model: 'zm_hot_z_zaraza',    claw: 'v_z7_zaraza.mdl',        ability: 'Ускорение' },
  { name: 'Ядовитый',  model: 'zm_hot_z_poison',    claw: 'v_hand_smoker_jp.mdl',   ability: 'Ядовитое облако' },
  { name: 'Толстяк',   model: 'zm_hot_z_heavy',     claw: 'v_zm_hot_heavy.mdl',      ability: 'Панцирь' },
  { name: 'Ведьма',    model: 'zm_hot_z_witch',     claw: 'v_witch_pak3_re.mdl',    ability: 'Стая мышей' },
  // Электрик — обычный зомби без активной способности, так попросил владелец.
  { name: 'Электрик',  model: 'zm_hot_z_electric',  claw: 'v_claw_electric.mdl' },
  { name: 'Студентка', model: 'zm_hot_z_student',   claw: 'v_claw_student.mdl',     ability: 'Двойной прыжок' },
  { name: 'Спринтер',  model: 'zm_hot_z_sprinter',  claw: 'v_hand_jumper_jp.mdl',   ability: 'Спринт' },
  // Перенесённые из «Казахского Пирога»: способность у каждого своя, в
  // отдельном плагине, поэтому zp_ability_info про них ничего не знает —
  // сверяем только класс, модель и лапу.
  { name: 'Шаман',      model: 'zm_hot_z_siren',     claw: 'v_strong_siren3.mdl' },
  { name: 'Ганимед',    model: 'zm_hot_z_deimos',    claw: 'v_strong_deimos2_fix.mdl' },
  { name: 'Ревенант Огонь', model: 'zm_hot_z_revfire',   claw: 'v_revenant.mdl' },
  { name: 'Ревенант Лёд',   model: 'zm_hot_z_revice',    claw: 'v_zm_hot_z_revice.mdl' },
  { name: 'Ревенант Яд',    model: 'zm_hot_z_revpoison', claw: 'v_zm_hot_z_revpoison.mdl' },
]

function fileSize(path) { return existsSync(path) ? readFileSync(path).length : 0 }

// Смещение считаем в БАЙТАХ, а режем строку — уже после разбора: русский текст
// в журнале двухбайтовый, и срез по символам съезжает.
function since(path, offset) {
  return existsSync(path) ? readFileSync(path).subarray(offset).toString('utf8') : ''
}

const { rcon, stop } = await start({ log: console.log })

try {
  // Мод не заражает никого, пока не начался режим раунда, а режим не начнётся
  // раньше своей задержки. Без ожидания все проверки врут: класс «не встаёт»
  // просто потому, что заражения ещё не было.
  console.log('\nждём начала режима раунда…')
  let zombie = false
  for (let i = 0; i < 40 && !zombie; i++) {
    await wait(2000)
    // Не ждём, пока мод сам выберет именно этого бота: просим заразить его
    // сами. Пока режим раунда не начался, мод такую просьбу игнорирует — по
    // этому и видно, что можно продолжать.
    await rcon.run('zp_class_set #1 0')
    zombie = /зомби=1/.test(await rcon.run('zp_ability_info #1'))
  }
  check('режим раунда идёт, боты заражаются', zombie,
    zombie ? '' : 'за 80 с ни один бот не стал зомби — остальные проверки бессмысленны')

  // ⚠️ Отдельно и до всего остального: у мода есть свои «модели для админов»,
  // и он ставит их ПОВЕРХ модели класса. Открыты они флагом «d» — обычным
  // ADMIN_BAN, который есть у каждого настоящего админа, включая владельца.
  // Из-за этого владелец брал любой класс, а ходил стандартным зомби. У ботов
  // флагов нет, поэтому проверяем не поведение, а сами переключатели на ЖИВОМ
  // сервере: важно, что до него доехал именно наш конфиг.
  for (const cv of ['zp_admin_models_zombie', 'zp_admin_models_human']) {
    const said = await rcon.run(cv)
    const off = new RegExp(`"${cv}"\\s+is\\s+"0"`).test(said)
    check(`${cv} выключен`, off,
      off ? 'мод не подменяет модель класса своей админской' : said.trim().split('\n').pop())
  }

  if (zombie) {
    // ⚠️ Мод не даёт расчеловечить ПОСЛЕДНЕГО зомби, а смена класса на живом
    // игроке идёт именно через «расчеловечить и заразить заново». Пока зомби
    // один, класс тихо остаётся прежним — проверка при этом выглядела как
    // поломка мода. Держим рядом ещё несколько заражённых, и обновляем их
    // ПЕРЕД КАЖДОЙ попыткой: за время прогона они успевают погибнуть.
    // ⚠️ Мало ПОПРОСИТЬ заразить помощников — надо дождаться, что они и правда
    // стали зомби. Пока рядом нет второго заражённого, мод отказывается
    // расчеловечивать подопытного, и смена класса тихо не проходит: в журнале
    // остаётся обычный зомби. Раньше это выглядело как «класс не работает» у
    // первых пяти-шести классов и само проходило к концу прогона.
    // ⚠️ Уже заражённого помощника трогать НЕЛЬЗЯ: zp_class_set сначала
    // расчеловечивает, и на этот миг зомби рядом становится меньше. Если
    // «освежать» всех подряд перед каждой попыткой, подопытный оказывается
    // последним зомби — и мод отказывается менять ему класс.
    const helpers = async (need = 2, tries = 10) => {
      for (let t = 0; t < tries; t++) {
        let live = 0
        for (const other of ['#2', '#3', '#4']) {
          if (/зомби=1/.test(await rcon.run(`zp_ability_info ${other}`))) { live++; continue }
          await rcon.run(`zp_class_set ${other} 0`)
        }
        if (live >= need) return live;
        await wait(1200)
      }
      return 0
    }
    await helpers()

    // Проверяем ПРОВОДКУ классов — модель, способность, ресурсы, — а не доступ
    // к ним. У бота уровней нет, и охрана классов привилегий возвращала бы его
    // к обычному прямо посреди проверки. Охрану проверяем отдельно, ниже.
    await rcon.run('zp_zclass_vip 0')
    await wait(1500)

    // Номера берём из списка, который мод только что переписал под текущий
    // набор плагинов.
    const ids = classIds()
    check('мод зарегистрировал все классы сборки',
      CLASSES.every(c => ids.has(c.name)),
      `в списке ${ids.size}: не найдены ${CLASSES.filter(c => !ids.has(c.name)).map(c => c.name).join(', ') || '—'}`)

    for (const c of CLASSES) {
      c.id = ids.get(c.name) ?? -1
      const mark = fileSize(STDOUT)

      // ⚠️ Смена класса не мгновенна и НЕ ВСЕГДА проходит с первого раза:
      // игрока сначала расчеловечивают, потом заражают заново, а мод отказывает
      // в заражении, если людей на карте не осталось. Поэтому повторяем саму
      // команду, а не просто ждём дольше: сон «на глаз» давал то предыдущий
      // класс, то вовсе человека с моделью zp_human_v44.
      let cur = -1, ab = '', line = null
      for (let attempt = 0; attempt < 8; attempt++) {
        await helpers()
        const logMark = fileSize(ACTIONS)
        await rcon.run(`zp_class_set #1 ${c.id}`)

        line = null
        for (let i = 0; i < 15 && !line; i++) {
          await wait(400)
          line = since(ACTIONS, logMark).split('\n').reverse().find(l => l.includes('КЛАСС: на'))
        }

        const info = await rcon.run('zp_ability_info #1')
        cur = Number((info.match(/класс=(-?\d+)/) ?? [])[1])
        ab = (info.match(/способность=(.+)/) ?? [])[1]?.trim() ?? ''
        // В условие выхода входит и модель: игрока успевают убить между
        // расчеловечиванием и заражением, и тогда в журнал попадает модель
        // человека. Это состояние гонки прогона, а не поломка класса —
        // повторяем попытку целиком.
        const got = (line?.match(/модель «([^»]*)»/) ?? [])[1] ?? ''
        const gotClaw = (line?.match(/лапа «([^»]*)»/) ?? [])[1] ?? ''
        if (cur === c.id && /зомби=1/.test(info) && got === c.model && gotClaw === c.claw) break
      }
      check(`${c.name}: класс встал на игрока`, cur === c.id, `класс=${cur}, ждали ${c.id}`)
      if (c.ability) check(`${c.name}: способность «${c.ability}»`, ab === c.ability, `способность=${ab}`)

      // Модель и лапу пишет сам плагин в zp_actions.log сразу после смены класса.
      const mdl = (line?.match(/модель «([^»]*)»/) ?? [])[1] ?? ''
      check(`${c.name}: модель ${c.model}`, mdl === c.model, `модель «${mdl}»`)

      const claw = (line?.match(/лапа «([^»]*)»/) ?? [])[1] ?? ''
      check(`${c.name}: лапа ${c.claw}`, claw === c.claw, `лапа «${claw}»`)

      await rcon.run('zp_ability_fire #1')
      await wait(700)

      // Главное: сервер не жалуется на незагруженный звук. Именно это и делало
      // способности «беззвучными и без эффектов».
      const fresh = since(STDOUT, mark)
      const missing = fresh.split('\n').filter(l => l.includes('not precached'))
      check(`${c.name}: способность без пропавших ресурсов`, missing.length === 0,
        missing.length ? missing.slice(0, 3).join('\n       ') : '')
    }

    // Охрана классов привилегий: у бота уровня нет, значит класс за привилегию
    // должен вернуться к обычному. Без этой проверки любой игрок брал бы
    // Ревенанта из меню — мод доступ к классам не проверяет вовсе.
    await rcon.run('zp_zclass_vip 1')
    // ⚠️ Раньше первым брали «Спринтера» — свой класс плагина, он знает свой
    // номер сам. С 12 августа 2026 Спринтер открыт ВСЕМ, охраны на нём нет, и
    // проверять на нём нечего. Остались только перенесённые классы: их номера
    // плагин спрашивает у мода по имени. Берём крайние по уровню — самый
    // дешёвый и самый дорогой: между ними вся таблица.
    for (const name of ['Ганимед', 'Ревенант Яд']) {
      // ⚠️ Помощников надо обновить и ЗДЕСЬ. Охрана срабатывает на заражении, а
      // смена класса идёт через «расчеловечить и заразить заново» — значит
      // рядом обязан быть другой зомби, иначе мод откажется расчеловечивать и
      // заражения не будет вовсе. За тринадцать классов до этого места
      // помощники успевают погибнуть, и проверка падала на ПЕРВОМ имени, а на
      // втором проходила — помощники к тому времени возрождались. Выглядело
      // это как случайный сбой, и прошлый заход так и списали.
      await helpers()

      let guard = null
      for (let attempt = 0; attempt < 3 && !guard; attempt++) {
        const guardMark = fileSize(ACTIONS)
        await rcon.run(`zp_class_set #1 ${ids.get(name) ?? -1}`)
        for (let i = 0; i < 15 && !guard; i++) {
          await wait(400)
          guard = since(ACTIONS, guardMark).split('\n').find(l => l.includes('без уровня'))
        }
        if (!guard) await helpers()
      }
      check(`класс «${name}» не даётся без уровня`, !!guard,
        guard ? guard.replace(/^L [\d/ :-]+: /, '') : 'в журнале нет записи о возврате к обычному')
    }
  }
} finally {
  stop()
  stopAll()
}

console.log(`\nитог: ${ok} из ${ok + bad} проверок пройдено`)
process.exit(bad ? 1 : 0)
