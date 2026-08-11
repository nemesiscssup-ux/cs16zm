// Живая проверка «Ядовитого облака»: оно должно кого-то накрывать.
//
// ЗАЧЕМ ОТДЕЛЬНАЯ ПРОВЕРКА. Владелец сказал про эту способность: «не работает
// как надо, ничего не происходит». Разбор показал, что урон-то шёл — только
// увидеть его было нечем: облако держалось на самом зомби и убегало вместе с
// ним, радиуса хватало на полтора шага, а человек внутри не получал ни цвета
// на экране, ни замедления, ни строчки. Проверка «плагин загрузился» такое
// пропускает по определению, и test-classes тоже: он смотрит только, что у
// способности не потерялись ресурсы.
//
// ⚠️ КАК ПОСТАВИТЬ ЛЮДЕЙ ПОД ОБЛАКО. Ботов не подвинешь командой, зато сразу
// после старта раунда все стоят кучей на своём респауне. Заражаем ОДНОГО из
// них: мод переводит его в другую команду, но с места не сдвигает — вокруг
// остаются бывшие соседи, теперь люди. Тогда облако накрывает их наверняка.
//
// Запуск: node tools/test-poison.mjs

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { start, stopAll } from './live.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ACTIONS = join(ROOT, 'run', 'cstrike', 'addons', 'amxmodx', 'logs', 'zp_actions.log')

const wait = ms => new Promise(r => setTimeout(r, ms))
const size = p => (existsSync(p) ? statSync(p).size : 0)
const since = (p, from) => (existsSync(p) ? readFileSync(p).subarray(from).toString('utf8') : '')

let ok = 0
let bad = 0
const check = (name, pass, detail = '') => {
  if (pass) { ok++; console.log(`[ ОК  ] ${name}${detail ? `\n       ${detail}` : ''}`) }
  else { bad++; console.log(`[ НЕТ ] ${name}${detail ? `\n       ${detail}` : ''}`) }
}

const POISON_CLASS = 2   // порядок в списке классов мода: Обычный, Раптор, Ядовитый

const server = await start({ map: 'de_dust2', bots: 8 })
try {
  const { rcon } = server
  await wait(6000)

  // Откат по умолчанию 20 с — на проверку это вечность.
  await rcon.run('zp_ability_cooldown 1')
  await rcon.run('sv_restart 1')
  await wait(6000)

  await rcon.run(`zp_class_set #1 ${POISON_CLASS}`)
  await rcon.run('zp_zombie #1')
  await wait(2000)

  const info = await rcon.run('zp_ability_info #1')
  check('подопытный — Ядовитый зомби', /зомби=1/.test(info) && /Ядовитое облако/.test(info),
    info.replace(/\s+/g, ' ').slice(0, 160))

  const mark = size(ACTIONS)

  // Несколько бросков подряд: боты бегают, и первый же может оказаться в
  // стороне. Ждём между ними откат.
  let caught = 0
  for (let i = 0; i < 6 && !caught; i++) {
    await rcon.run('zp_ability_fire #1')
    await wait(5000)
    const fresh = since(ACTIONS, mark)
    const m = [...fresh.matchAll(/облако накрыло (\d+) чел\./g)].map(x => Number(x[1]))
    caught = m.length ? Math.max(...m) : 0
  }

  check('облако кого-то накрыло', caught > 0,
    caught ? `под облаком оказалось ${caught} чел.` : 'ни одного человека под облаком за шесть бросков')

  // Способность обязана оставлять след в журнале: по нему владелец потом
  // разбирает жалобы «ничего не сработало».
  const log = since(ACTIONS, mark)
  check('бросок записан в журнал действий', /применил «Ядовитое облако»/.test(log),
    (log.split('\n').find(l => l.includes('Ядовитое облако')) ?? '').trim())
} finally {
  await stopAll()
}

console.log(`\nитог: ${ok} из ${ok + bad} проверок пройдено`)
process.exit(bad ? 1 : 0)
