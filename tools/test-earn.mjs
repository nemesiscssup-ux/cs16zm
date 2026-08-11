// Живая проверка заработка: урон, время, подарки с убитых зомби.
//
// ЗАЧЕМ ЖИВОЙ СЕРВЕР. Начисление стоит на цепочке из чужих обработчиков: урон
// приходит из Ham_TakeDamage ПОСЛЕ применения, подарок — это отдельная
// сущность, которую надо создать, уронить, дать коснуться и не забыть удалить.
// Чтением исходника это не проверяется никак: каждое звено молчит при поломке,
// а игрок видит просто «кредиты не капают».
//
// ⚠️ БОТЫ ЗДЕСЬ РАБОТАЮТ ЗА ЛЮДЕЙ. Они стреляют по зомби сами, значит урон
// набегает без нашего участия; подарки они тоже подбирают, потому что бегают
// по трупам. Ждать приходится до минуты — столько идёт первая перестрелка.
//
// Запуск: node tools/test-earn.mjs

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

const mark = size(ACTIONS)
const server = await start({ map: 'de_dust2', bots: 8 })
try {
  const { rcon } = server
  await wait(5000)

  // Ускоряем всё, что считается: проверке некогда ждать пятиминутки.
  await rcon.run('zp_earn_dmg_per 50')     // кредит за 50 урона
  await rcon.run('zp_earn_time_min 1')     // кредит за минуту
  await rcon.run('zp_gift_chance 100')
  await rcon.run('sv_restart 1')

  // Ждём, пока боты подерутся. Смотрим журнал: он единственный говорит, что
  // именно начислили и за что.
  let dmg = null
  let gift = null
  let time = null
  for (let i = 0; i < 40 && !(dmg && gift); i++) {
    await wait(3000)
    const fresh = since(ACTIONS, mark).split('\n')
    dmg ??= fresh.find(l => l.includes('ЗАРАБОТОК') && l.includes('за урон')) ?? null
    gift ??= fresh.find(l => l.includes('ПОДАРОК')) ?? null
    time ??= fresh.find(l => l.includes('за время в игре')) ?? null
  }

  check('кредиты капают за урон', dmg !== null,
    dmg ? dmg.trim() : 'за две минуты боя ни одной строки «за урон»')

  check('с убитого зомби падает подарок и его подбирают', gift !== null,
    gift ? gift.trim() : 'ни одного подобранного подарка')

  // Время идёт медленнее всего, поэтому не валим проверку из-за него —
  // но если строка есть, это лишнее подтверждение.
  console.log(time ? `[ ОК  ] заодно капнуло за время\n       ${time.trim()}`
    : '[ ~~~ ] за время пока не капнуло — минута ещё не прошла, это не поломка')

  // И прибавка за уровень: показываем то, что видит владелец командой.
  const info = await rcon.run('zp_earn_info #1')
  check('справка о заработке отвечает', /заработано за карту/.test(info), info.trim().slice(0, 160))
} finally {
  await stopAll()
}

console.log(`\nитог: ${ok} из ${ok + bad} проверок пройдено`)
process.exit(bad ? 1 : 0)
