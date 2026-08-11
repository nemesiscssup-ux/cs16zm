// Живая проверка: поднять сервер, посадить ботов и спросить его самого.
//
// Зачем отдельный инструмент. Всё, что касается игры — модель класса, урон
// способности, цена в магазине — со стороны исходников только предполагается.
// Единственное доказательство, что оно работает, это ответ живого сервера.
// Раньше такие проверки делались руками через клиент; теперь их можно повторять.
//
// Пароль rcon НЕ попадает ни в сборку, ни в конфиги: он придумывается на месте
// на один запуск и живёт только в аргументах процесса. В боевом server.cfg его
// нет и быть не должно.
//
// Запуск:
//   node tools/live.mjs "команда" ["ещё команда" ...]      — поднять, спросить, погасить
//   node tools/live.mjs --keep "команда"                   — оставить сервер работать
//   node tools/live.mjs --attach "команда"                 — спросить уже поднятый
//   node tools/live.mjs --bots 4 "команда"                 — сколько ботов посадить
//   node tools/live.mjs --map de_dust2 ...

import { execFileSync, spawn } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { randomBytes } from 'node:crypto'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUN = join(ROOT, 'run')
const HOST = '127.0.0.1'
const PORT = 27015

const HEAD = Buffer.from([0xff, 0xff, 0xff, 0xff])
const A2S = Buffer.concat([HEAD, Buffer.from('TSource Engine Query\0', 'latin1')])

// Одна розетка на весь разговор: сервер отвечает на тот же порт, с которого
// пришёл запрос, а challenge выдаётся именно этому адресу.
export class Rcon {
  constructor(password, host = HOST, port = PORT) {
    this.password = password
    this.host = host
    this.port = port
    this.sock = createSocket('udp4')
    this.sock.on('error', () => {})
    this.challenge = null
  }

  close() { try { this.sock.close() } catch {} }

  // Ответ приходит пачкой пакетов, и сколько их будет — заранее неизвестно.
  // Поэтому собираем всё, что пришло, пока не наступит тишина.
  ask(payload, { quiet = 250, total = 3000 } = {}) {
    return new Promise(res => {
      const parts = []
      let hush = null
      const stop = () => {
        clearTimeout(hard); if (hush) clearTimeout(hush)
        this.sock.removeListener('message', onMsg)
        // Склеиваем БАЙТАМИ и только потом читаем как UTF-8: русская буква
        // занимает два байта и может разорваться между пакетами, а посимвольная
        // сборка превращает весь ответ в «ÐÐ±ÑÑÐ½ÑÐ¹».
        res(Buffer.concat(parts).toString('utf8'))
      }
      const onMsg = msg => {
        // 4 байта заголовка, дальше сразу текст. У ОТВЕТА НА КОМАНДУ перед
        // текстом стоит ещё байт типа 'l' (print), а у выдачи challenge его
        // нет — она начинается прямо со слова «challenge». Резать всегда по
        // пятому байту нельзя: у challenge отгрызается первая буква.
        const start = msg[4] === 0x6c ? 5 : 4
        parts.push(msg.subarray(start))
        if (hush) clearTimeout(hush)
        hush = setTimeout(stop, quiet)
      }
      const hard = setTimeout(stop, total)
      this.sock.on('message', onMsg)
      this.sock.send(payload, this.port, this.host)
    })
  }

  // ⚠️ На смене карты сервер молчит несколько секунд. Один пустой ответ — это
  // не «сервер умер», а перезагрузка карты, и ронять из-за неё весь прогон
  // нельзя: длинные проверки как раз и переживают одну-две смены.
  async getChallenge(tries = 12) {
    let raw = ''
    for (let i = 0; i < tries; i++) {
      raw = await this.ask(Buffer.concat([HEAD, Buffer.from('challenge rcon\n', 'latin1')]), { quiet: 120 })
      const m = raw.match(/challenge rcon (\d+)/)
      if (m) { this.challenge = m[1]; return this.challenge }
      await new Promise(r => setTimeout(r, 1500))
    }
    throw new Error(`сервер не выдал challenge за ${tries} попыток: ${JSON.stringify(raw.slice(0, 120))}`)
  }

  async run(command) {
    // Challenge живёт недолго и привязан к адресу — берём свежий на каждую
    // команду. Дешевле один лишний пакет, чем «Bad rcon_password» на ровном месте.
    await this.getChallenge()
    const line = `rcon ${this.challenge} "${this.password}" ${command}\n`
    const out = await this.ask(Buffer.concat([HEAD, Buffer.from(line, 'latin1')]))
    return out.replace(/\0+$/, '')
  }
}

export function alive(host = HOST, port = PORT, timeoutMs = 1500) {
  return new Promise(res => {
    const sock = createSocket('udp4')
    const t = setTimeout(() => { try { sock.close() } catch {} ; res(false) }, timeoutMs)
    sock.on('message', () => { clearTimeout(t); try { sock.close() } catch {} ; res(true) })
    sock.on('error', () => { clearTimeout(t); try { sock.close() } catch {} ; res(false) })
    sock.send(A2S, port, host)
  })
}

const wait = ms => new Promise(r => setTimeout(r, ms))

// Поднимает сервер из run/ с одноразовым паролем rcon. Возвращает { rcon, stop }.
export async function start({ map = 'de_dust2', bots = 0, log = () => {} } = {}) {
  const hlds = join(RUN, 'hlds.exe')
  if (!existsSync(hlds)) throw new Error(`нет ${hlds} — сначала node tools/compose-run.mjs`)

  if (await alive()) throw new Error('порт 27015 уже занят: погасите прежний hlds')

  const password = randomBytes(12).toString('hex')

  // Свой конфиг запуска: боевой server.cfg выполняется как есть, а сверху
  // ложится только то, что нужно для проверки.
  const cfg = join(RUN, 'cstrike', 'live.cfg')
  writeFileSync(cfg, [
    'exec server.cfg',
    `rcon_password "${password}"`,
    'sv_rcon_banpenalty 0',
    'mp_autoteambalance 0',
    'mp_limitteams 0',
    // Раунд подлиннее: проверки идут по живой игре, и смена раунда посреди
    // проверки сбивает и класс, и модель.
    'mp_roundtime 9',
    '',
  ].join('\n'), 'latin1')

  const logPath = join(RUN, 'live-stdout.log')
  if (existsSync(logPath)) rmSync(logPath, { force: true })
  const fd = openSync(logPath, 'w')

  const args = ['-console', '-game', 'cstrike', '-port', String(PORT),
    '+servercfgfile', 'live.cfg', '+maxplayers', '12', '+sv_lan', '1', '+map', map]

  log(`запуск: hlds.exe ${args.join(' ')}`)
  const child = spawn(hlds, args, { cwd: RUN, detached: true, stdio: ['ignore', fd, fd], windowsHide: true })
  child.unref()

  let up = false
  for (let i = 0; i < 40 && !up; i++) { await wait(1000); up = await alive() }
  if (!up) { stopAll(); throw new Error('сервер не поднялся за 40 с — смотрите run/live-stdout.log') }

  // Пароль кладём в run/: каталог не в репозитории, а --attach без него
  // работать не может. Живёт он ровно до следующего запуска.
  writeFileSync(join(RUN, 'live-rcon.txt'), password, 'utf8')

  const rcon = new Rcon(password)

  if (bots > 0) {
    // YaPB: боты нужны не для красоты — без живых тел не проверить ни толчок,
    // ни урон, ни притяжение.
    await rcon.run(`yb_quota ${bots}`)
    for (let i = 0; i < bots; i++) await rcon.run('yb add')
    await wait(3000)
  }

  return { rcon, password, stop: () => { rcon.close(); stopAll() } }
}

export function stopAll() {
  try { execFileSync('taskkill', ['/f', '/im', 'hlds.exe'], { stdio: 'ignore' }) } catch {}
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const argv = process.argv.slice(2)
  const flag = (name, def) => {
    const i = argv.indexOf(name)
    if (i === -1) return def
    const v = argv[i + 1]
    argv.splice(i, 2)
    return v
  }
  const keep = argv.includes('--keep') && (argv.splice(argv.indexOf('--keep'), 1), true)
  const attach = argv.includes('--attach') && (argv.splice(argv.indexOf('--attach'), 1), true)
  const map = flag('--map', 'de_dust2')
  const bots = Number(flag('--bots', '0'))
  const pass = flag('--password', null)

  if (attach) {
    const saved = join(RUN, 'live-rcon.txt')
    const password = pass ?? (existsSync(saved) ? readFileSync(saved, 'utf8').trim() : null)
    if (!password) { console.error('нет пароля: запустите сначала node tools/live.mjs --keep'); process.exit(2) }
    const rcon = new Rcon(password)
    for (const cmd of argv) {
      console.log(`\n> ${cmd}`)
      console.log((await rcon.run(cmd)).trimEnd())
    }
    rcon.close()
  } else {
    const { rcon, password, stop } = await start({ map, bots, log: console.log })
    console.log(`сервер поднят, пароль rcon на этот запуск: ${password}`)
    for (const cmd of argv) {
      console.log(`\n> ${cmd}`)
      console.log((await rcon.run(cmd)).trimEnd())
    }
    if (keep) { rcon.close(); console.log('\nсервер оставлен работать (--keep)') }
    else stop()
  }
}
