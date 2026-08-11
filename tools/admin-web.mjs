// Панель выдачи привилегий: страница в браузере вместо ключей командной строки.
//
// Правит тот же custom/admins.ini, что и add-admin.mjs, и теми же правилами —
// общая логика вынесена в users-ini.mjs, чтобы два входа не разъехались.
// После записи список раскладывается по собранным копиям сервера, включая
// run/ — файл при игре читает именно он.
//
// Запуск:  node tools/admin-web.mjs [--port 8127] [--open] [--idle 30]
// Или просто двойным щелчком по admin.cmd в корне.
//
// Панель пишет учётные записи с паролями, поэтому наружу её выпускать нельзя:
//   * слушает только 127.0.0.1 — из сети к ней не подключиться;
//   * каждый запрос обязан принести ключ, который печатается при запуске.
//     Ключ закрывает и подставной запрос с чужой страницы: сама она в браузере
//     открыта быть может, а ключ прочитать не сможет;
//   * без дела панель не висит — через полчаса тишины закрывается сама.

import { spawn } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, relative, resolve } from 'node:path'

import {
  ADMINS_FILE, ADMIN_FLAGS, ALL_FLAGS, ROOT, TIERS,
  accountFlags, checkAdmin, formatAdminLine, looksAlike, parseAdminLine,
  readAdmins, sameKey, saveAdmins, syncUsersIni, tierFlags, tierOf,
} from './users-ini.mjs'

const PAGE = join(ROOT, 'tools', 'admin-web.html')

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true
    else { out[a.slice(2)] = next; i++ }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(`Панель выдачи привилегий.

  --port N     порт (по умолчанию 8127; занят — возьмёт следующий свободный)
  --open       сразу открыть в браузере
  --idle N     закрыться через N минут тишины (по умолчанию 30, 0 — не закрывать)

Правит ${ADMINS_FILE}`)
  process.exit(0)
}

const FIRST_PORT = Number(args.port) || 8127
const IDLE_MIN = args.idle === undefined ? 30 : Number(args.idle)
const TOKEN = randomBytes(16).toString('hex')

// --admins и --into нужны только проверке (tools/test-admin-web.mjs): она
// гоняет панель на своём временном списке, чтобы не трогать настоящий.
const FILE = args.admins && args.admins !== true ? resolve(String(args.admins)) : ADMINS_FILE
const ROOTS = args.into && args.into !== true
  ? [join(resolve(String(args.into)), 'server'), join(resolve(String(args.into)), 'run')]
  : undefined
const sync = () => syncUsersIni(FILE, ROOTS)

// ── ответы ──────────────────────────────────────────────────────────────────

function send(res, code, type, body) {
  res.writeHead(code, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    // Панель ни во что не встраивается и никуда не ходит: пусть браузер это
    // и подтвердит, а ключ из адресной строки не утечёт в чужой Referer.
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  })
  res.end(body)
}

const json = (res, code, obj) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj))

// ── проверка запроса ────────────────────────────────────────────────────────

const WANT = Buffer.from(TOKEN, 'utf8')

// Длины сравниваем У БУФЕРОВ, а не у строк: байт выше 0x7f занимает в UTF-8
// два байта, и ключ из 32 таких символов дал бы строку нужной длины, но буфер
// вдвое длиннее — timingSafeEqual на этом бросает исключение, то есть кладёт
// панель одним запросом.
function hasToken(req, url) {
  const given = Buffer.from(String(req.headers['x-admin-token'] ?? url.searchParams.get('k') ?? ''), 'utf8')
  if (given.length !== WANT.length) return false
  return timingSafeEqual(given, WANT)
}

let origins = new Set()

// Origin шлёт только запрос со страницы. Свой — пропускаем, чужой — нет;
// его отсутствие означает прямой заход по ссылке, и это нормально.
const sameOrigin = req => !req.headers.origin || origins.has(req.headers.origin)

async function readBody(req, limit = 64 * 1024) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('запрос слишком большой')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

// ── список ──────────────────────────────────────────────────────────────────

function state() {
  const admins = []
  for (const line of readAdmins(FILE)) {
    if (line.trimStart().startsWith(';')) continue
    const e = parseAdminLine(line)
    if (!e) { admins.push({ broken: true, raw: line }); continue }
    admins.push({
      who: e.who,
      password: e.password,
      flags: e.flags,
      account: e.account,
      tier: tierOf(e.flags),
      adminMenu: e.flags.includes('u'),
      // Купленная админка — урезанный набор; полные права — все буквы.
      admin: ADMIN_FLAGS.split('').every(c => e.flags.includes(c)) && e.flags !== ALL_FLAGS,
      full: e.flags === ALL_FLAGS,
      nopass: e.account.includes('e'),
      steamid: e.account.includes('c'),
    })
  }
  return {
    admins,
    tiers: TIERS,
    allFlags: ALL_FLAGS,
    adminFlags: ADMIN_FLAGS,
    file: relative(ROOT, FILE).split('\\').join('/'),
  }
}

// ── выдача ──────────────────────────────────────────────────────────────────

function grant(body) {
  const kind = body.kind === 'steamid' ? 'steamid' : 'nick'
  const who = String(body.who ?? '').trim()
  const mode = ['auto', 'manual', 'none'].includes(body.passwordMode) ? body.passwordMode : 'auto'

  let flags
  if (body.flagsMode === 'custom') {
    flags = String(body.customFlags ?? '').replace(/\s+/g, '').toLowerCase()
  } else {
    const letters = []
    const tier = Number(body.tier)
    if (Number.isInteger(tier) && tier >= 0 && tier < TIERS.length) letters.push(tierFlags(tier))
    if (body.admin) letters.push(ADMIN_FLAGS)
    if (body.full) letters.push(ALL_FLAGS)
    flags = [...new Set(letters.join('').split(''))].sort().join('')
  }

  if (!flags) return { error: ['не выбран уровень — отметьте его или впишите свои флаги'] }

  const password = mode === 'none' ? ''
    : mode === 'manual' ? String(body.password ?? '')
    : randomBytes(9).toString('base64url')

  if (mode === 'manual' && !password) return { error: ['впишите пароль или выберите «придумать за меня»'] }

  const account = accountFlags({ steamid: kind === 'steamid', nopass: mode === 'none' })
  const bad = checkAdmin({ who, password, flags, account })
  if (bad.length) return { error: bad }

  // Заменяем запись с тем же именем, а не заводим вторую: AMXX сверяет ник без
  // учёта регистра, и две записи, различные только регистром, — это спор о
  // том, чья возьмёт. Побеждает первая по файлу, то есть не та, что выдали.
  const lines = readAdmins(FILE)
  const at = lines.findIndex(l => {
    const e = parseAdminLine(l)
    return e !== null && sameKey(e.who, who)
  })

  const replaced = at >= 0 ? parseAdminLine(lines[at]) : null
  const line = formatAdminLine({ who, password, flags, account })
  if (at >= 0) lines[at] = line
  else lines.push(line)

  // Запись, отличающаяся только регистром РУССКИХ букв, — для сервера чужая:
  // он складывает регистр лишь у латиницы. Заменить её мы не вправе, но и
  // промолчать нельзя: со стороны это выглядит как та же самая учётка.
  const twin = lines.map(parseAdminLine).find(e => e !== null && looksAlike(e.who, who))

  saveAdmins(lines, FILE)
  return {
    line,
    replaced,
    notice: twin ? `Рядом есть запись «${twin.who}» — сервер считает её ДРУГИМ игроком: регистр русских букв он не сглаживает.` : null,
    targets: sync(),
    state: state(),
  }
}

function revoke(body) {
  const who = String(body.who ?? '')
  const lines = readAdmins(FILE)
  const kept = lines.filter(l => {
    const e = parseAdminLine(l)
    return !(e !== null && sameKey(e.who, who))
  })
  if (kept.length === lines.length) return { error: [`записи «${body.who}» больше нет — список уже обновился`] }

  saveAdmins(kept, FILE)
  return { targets: sync(), state: state() }
}

// ── сервер ──────────────────────────────────────────────────────────────────

let idleTimer = null
function touch() {
  if (!(IDLE_MIN > 0)) return
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    console.log(`\nТишина ${IDLE_MIN} мин — панель закрыта. Запустить снова: admin.cmd`)
    process.exit(0)
  }, IDLE_MIN * 60_000)
}

const server = createServer(async (req, res) => {
  try {
    await handle(req, res)
  } catch (err) {
    // Обработчик асинхронный: непойманное исключение стало бы отклонённым
    // обещанием и уронило бы весь процесс. Панель должна переживать любой
    // мусор в запросе — она нужна как раз тогда, когда что-то идёт не так.
    console.error(`сбой на запросе ${req.method} ${req.url}: ${err.message}`)
    if (!res.headersSent) json(res, 500, { error: ['панель споткнулась на этом запросе'] })
    else res.end()
  }
})

async function handle(req, res) {
  touch()
  const url = new URL(req.url, 'http://127.0.0.1')

  if (!hasToken(req, url) || !sameOrigin(req)) {
    return send(res, 403, 'text/plain; charset=utf-8',
      'Нужна ссылка с ключом — она напечатана в окне, где запущена панель.\n')
  }

  if (req.method === 'GET' && url.pathname === '/') {
    if (!existsSync(PAGE)) return send(res, 500, 'text/plain; charset=utf-8', `нет файла ${PAGE}\n`)
    // Читаем с диска каждый раз: правку страницы видно после обновления
    // вкладки, перезапускать панель не нужно.
    return send(res, 200, 'text/html; charset=utf-8', readFileSync(PAGE, 'utf8'))
  }

  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state())

  if (req.method === 'POST') {
    // Простая форма с чужой страницы такой заголовок не поставит, а запрос с
    // ним браузер сначала спросит разрешения — и не получит его.
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json'))
      return json(res, 415, { error: ['ожидается application/json'] })

    let body
    try { body = JSON.parse(await readBody(req) || '{}') }
    catch { return json(res, 400, { error: ['не разобрать запрос'] }) }
    if (body === null || typeof body !== 'object') return json(res, 400, { error: ['не разобрать запрос'] })

    if (url.pathname === '/api/grant') {
      const out = grant(body)
      return json(res, out.error ? 400 : 200, out)
    }
    if (url.pathname === '/api/revoke') {
      const out = revoke(body)
      return json(res, out.error ? 404 : 200, out)
    }
    if (url.pathname === '/api/quit') {
      json(res, 200, { bye: true })
      console.log('\nПанель закрыта из браузера.')
      return setTimeout(() => process.exit(0), 200)
    }
  }

  return json(res, 404, { error: ['нет такой страницы'] })
}

// Порт может быть занят — соседним прогоном панели или чем угодно ещё.
// Молча берём следующий вместо падения с ENOTAVAIL в лицо.
let port = FIRST_PORT
server.on('error', err => {
  if (err.code === 'EADDRINUSE' && port < FIRST_PORT + 10) {
    port++
    server.listen(port, '127.0.0.1')
    return
  }
  console.error(`не удалось занять порт ${port}: ${err.message}`)
  process.exit(1)
})

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn(process.env.COMSPEC || 'cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
  } catch {
    // Не беда: ссылку всё равно напечатали, открыть можно руками.
  }
}

server.listen(FIRST_PORT, '127.0.0.1', () => {
  origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`])
  const url = `http://127.0.0.1:${port}/?k=${TOKEN}`

  console.log('Панель выдачи привилегий')
  console.log(`  ${url}`)
  console.log('')
  console.log(`  правит ${relative(ROOT, FILE)}`)
  console.log('  видна только с этого компьютера; закрыть — Ctrl+C')
  if (IDLE_MIN > 0) console.log(`  сама закроется через ${IDLE_MIN} мин без дела`)

  if (args.open) openBrowser(url)
  touch()
})
