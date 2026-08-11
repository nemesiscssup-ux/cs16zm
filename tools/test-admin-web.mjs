// Проверка панели выдачи привилегий: поднимает её на временном списке и
// разговаривает с ней ровно так же, как браузер.
//
// Настоящий custom/admins.ini не трогается — панель запускается с ключами
// --admins и --into, которые для того и заведены.
//
// Запуск: node tools/test-admin-web.mjs

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PANEL = join(HERE, 'admin-web.mjs')

const box = mkdtempSync(join(tmpdir(), 'cs16zm-panel-'))
const INI = join(box, 'admins.ini')
writeFileSync(INI, '; список для проверки\n"Старожил" "parol" "t" "a"\n', 'utf8')
for (const base of ['server', 'run'])
  mkdirSync(join(box, base, 'cstrike', 'addons', 'amxmodx', 'configs'), { recursive: true })

let pass = 0
const fails = []
function ok(cond, what, extra = '') {
  if (cond) { pass++; console.log(`  ok    ${what}`) }
  else { fails.push(what); console.log(`  ПЛОХО ${what}${extra ? ` — ${extra}` : ''}`) }
}

// ── запуск панели ───────────────────────────────────────────────────────────

const panel = spawn(process.execPath,
  [PANEL, '--port', '8611', '--idle', '0', '--admins', INI, '--into', box],
  { stdio: ['ignore', 'pipe', 'inherit'] })

const started = await new Promise((done, fail) => {
  let out = ''
  const timer = setTimeout(() => fail(new Error(`панель не отозвалась:\n${out}`)), 15000)
  panel.stdout.on('data', chunk => {
    out += chunk
    const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?k=([0-9a-f]+)/.exec(out)
    if (m) { clearTimeout(timer); done({ port: m[1], key: m[2] }) }
  })
  panel.on('exit', code => { clearTimeout(timer); fail(new Error(`панель вышла с кодом ${code}`)) })
})

const U = `http://127.0.0.1:${started.port}`
const HEAD = { 'x-admin-token': started.key, 'content-type': 'application/json' }

const post = async (path, body, headers = HEAD) => {
  const res = await fetch(`${U}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { code: res.status, data: await res.json().catch(() => null) }
}

const ini = () => readFileSync(INI, 'utf8')
const users = where => {
  const p = join(box, where, 'cstrike', 'addons', 'amxmodx', 'configs', 'users.ini')
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

try {
  console.log(`\n— панель закрыта снаружи —`)
  let r = await fetch(`${U}/api/state`)
  ok(r.status === 403, 'без ключа не отвечает')
  // Ключ той же длины: проверяем сравнение, а не отсев по размеру.
  r = await fetch(`${U}/api/state`, { headers: { 'x-admin-token': '0'.repeat(started.key.length) } })
  ok(r.status === 403, 'чужой ключ не подходит')
  // Ключ той же длины в символах, но вдвое длиннее в байтах: на таком
  // timingSafeEqual бросает исключение, и панель падала бы одним запросом.
  const highBytes = String.fromCharCode(255).repeat(started.key.length)
  r = await fetch(`${U}/api/state`, { headers: { 'x-admin-token': highBytes } })
  ok(r.status === 403, 'ключ из старших байтов отбит')
  r = await fetch(`${U}/api/state`, { headers: HEAD })
  ok(r.status === 200, 'и панель после него жива')

  r = await fetch(`${U}/api/state`, { headers: { ...HEAD, origin: 'http://evil.example' } })
  ok(r.status === 403, 'запрос с чужой страницы отбит по Origin')
  r = await post('api/grant', { who: 'Х' }, { 'x-admin-token': started.key, 'content-type': 'text/plain' })
  ok(r.code === 415, 'POST не в JSON отбит — простой формой панель не обмануть')
  r = await fetch(`${U}/api/state?k=${started.key}`)
  ok(r.status === 200, 'ключ в адресе тоже подходит')
  r = await fetch(`${U}/?k=${started.key}`)
  ok(r.status === 200 && (await r.text()).includes('Выдача привилегий'), 'страница отдаётся')
  r = await fetch(`${U}/../users.ini?k=${started.key}`)
  ok(r.status === 404, 'к другим файлам панель не пускает', String(r.status))

  console.log('\n— выдача —')
  r = await post('api/grant', { who: 'Игорь', kind: 'nick', tier: 0, flagsMode: 'tier', passwordMode: 'auto' })
  ok(r.code === 200 && /^"Игорь" "[\w-]{12}" "t" "a"$/.test(r.data.line), 'VIP по нику: флаги «t», пароль придуман', r.data.line)
  ok(ini().includes('"Игорь"'), 'кириллица легла в файл без порчи')
  ok(ini().startsWith('; список для проверки'), 'комментарии в файле уцелели')

  r = await post('api/grant', { who: 'Игорь', kind: 'nick', tier: 3, flagsMode: 'tier', passwordMode: 'manual', password: 'proba' })
  ok(r.code === 200 && r.data.line === '"Игорь" "proba" "pqst" "a"', 'Фараон: флаги накопительные, «pqst»', r.data.line)
  ok(r.data.replaced && r.data.replaced.flags === 't', 'повторная выдача заменила запись')
  ok((ini().match(/"Игорь"/g) || []).length === 1, 'в файле ровно одна запись на игрока')

  r = await post('api/grant', { who: 'Игорь', kind: 'nick', tier: 4, flagsMode: 'tier', passwordMode: 'manual', password: 'proba' })
  ok(r.code === 200 && r.data.line === '"Игорь" "proba" "opqst" "a"', 'Создатель: сверху всей лестницы, «opqst»', r.data.line)

  // Регистр латиницы сервер сглаживает (equali = strncasecmp), русский — нет.
  r = await post('api/grant', { who: 'Vasya', kind: 'nick', tier: 0, flagsMode: 'tier', passwordMode: 'auto' })
  r = await post('api/grant', { who: 'VASYA', kind: 'nick', tier: 1, flagsMode: 'tier', passwordMode: 'auto' })
  ok(r.code === 200 && r.data.replaced !== null, 'латиница в другом регистре — та же запись')
  ok((ini().match(/"VASYA"|"Vasya"/g) || []).length === 1, 'двойника по латинице не появилось')

  r = await post('api/grant', { who: 'игорь', kind: 'nick', tier: 1, flagsMode: 'tier', passwordMode: 'manual', password: 'proba' })
  ok(r.code === 200 && r.data.replaced === null, 'русский ник в другом регистре — ДРУГАЯ запись, как и у сервера')
  ok(r.data.notice && r.data.notice.includes('Игорь'), 'и об этом сказано вслух', String(r.data.notice))
  ok((ini().match(/"[Ии]горь"/g) || []).length === 2, 'обе записи на месте')

  r = await post('api/grant', { who: 'STEAM_0:1:9', kind: 'steamid', tier: 2, flagsMode: 'tier', passwordMode: 'auto' })
  ok(r.code === 200 && r.data.line.endsWith('"qst" "ca"'), 'SteamID: флаги «qst», запись «ca»', r.data.line)

  r = await post('api/grant', { who: 'Полный', kind: 'nick', tier: 1, full: true, flagsMode: 'tier', passwordMode: 'auto' })
  ok(r.code === 200 && r.data.line.includes('"abcdefghijklmnopqrstu"'), 'галка полных прав даёт все флаги')

  // Купленная админка — урезанный набор: без rcon, без смены карты, без правки
  // кваров и без неприкосновенности. Иначе покупатель уводит сервер.
  r = await post('api/grant', { who: 'Купил', kind: 'nick', admin: true, flagsMode: 'tier', passwordMode: 'auto' })
  ok(r.code === 200 && /"bcdeiju"/.test(r.data.line), 'админка выдаётся урезанным набором', r.data.line)
  ok(r.code === 200 && !/[afglmnopqrst]/.test(/"([a-u]+)"/.exec(r.data.line)[1]),
    'в админке нет rcon, карт, кваров и неприкосновенности')

  r = await post('api/grant', { who: 'ВипПлюс', kind: 'nick', tier: 0, admin: true, flagsMode: 'tier', passwordMode: 'auto' })
  ok(r.code === 200 && /"bcdeijtu"/.test(r.data.line), 'пак «VIP + админка» складывает оба набора', r.data.line)

  r = await post('api/grant', { who: 'Свои', kind: 'nick', flagsMode: 'custom', customFlags: ' TS ', passwordMode: 'auto' })
  ok(r.code === 200 && r.data.line.includes('"ts"'), 'свои флаги: пробелы убраны, регистр снижен', r.data.line)

  r = await post('api/grant', { who: 'БезПароля', kind: 'nick', tier: 0, flagsMode: 'tier', passwordMode: 'none' })
  ok(r.code === 200 && r.data.line === '"БезПароля" "" "t" "e"', 'без пароля: запись «e», пароль пустой', r.data.line)

  console.log('\n— чего панель не запишет —')
  const bad = async (body, what) => {
    const res = await post('api/grant', body)
    ok(res.code === 400 && Array.isArray(res.data.error), what, `код ${res.code}`)
  }
  const base = { kind: 'nick', tier: 0, flagsMode: 'tier', passwordMode: 'auto' }
  await bad({ ...base, who: 'Кто "тут"' }, 'кавычка в имени')
  await bad({ ...base, who: 'а\nб' }, 'перевод строки в имени')
  await bad({ ...base, who: '' }, 'пустое имя')
  await bad({ ...base, who: 'я'.repeat(40) }, 'имя длиннее 31 символа')
  await bad({ ...base, who: 'не-стим', kind: 'steamid' }, 'SteamID не того вида')
  await bad({ ...base, who: 'Пусто', tier: undefined }, 'уровень не выбран')
  await bad({ ...base, who: 'Плохо', flagsMode: 'custom', customFlags: 'tz' }, 'буква вне a…u')
  await bad({ ...base, who: 'Пароль', passwordMode: 'manual', password: '' }, 'свой пароль не вписан')
  await bad({ ...base, who: 'Кавычка', passwordMode: 'manual', password: 'a"b' }, 'кавычка в пароле')
  await bad({ ...base, who: 'Ноль', passwordMode: 'manual', password: `a${String.fromCharCode(0)}b` }, 'управляющий символ в пароле')
  ok(!ini().includes('Кавычка') && !ini().includes('Ноль'), 'ни одна отбитая запись в файл не попала')

  console.log('\n— раскладка по сборкам —')
  r = await post('api/grant', { who: 'Проверка', kind: 'nick', tier: 0, flagsMode: 'tier', passwordMode: 'auto' })
  ok(r.data.targets.length === 2, 'список разложен и в server/, и в run/', JSON.stringify(r.data.targets))
  ok(users('server').includes('"Проверка"') && users('run').includes('"Проверка"'), 'запись видна в обоих users.ini')
  ok(users('run').startsWith('; Список администраторов'), 'шапка users.ini на месте')
  ok(!users('run').includes('; список для проверки\n; список'), 'комментарии не задвоились')

  console.log('\n— снятие —')
  r = await post('api/revoke', { who: 'Проверка' })
  ok(r.code === 200 && !ini().includes('"Проверка"'), 'запись снята из admins.ini')
  ok(!users('run').includes('"Проверка"'), 'и из users.ini в run/')
  r = await post('api/revoke', { who: 'Проверка' })
  ok(r.code === 404, 'повторное снятие отвечает «записи больше нет»')
  // Регистр снятие сглаживает по тем же правилам, что и сервер: латиницу да,
  // кириллицу нет. Иначе одним «снять» уходили бы две разные учётки.
  r = await post('api/revoke', { who: 'vasya' })
  ok(r.code === 200 && !ini().includes('VASYA'), 'латиницу снимает в любом регистре')
  r = await post('api/revoke', { who: 'ИГОРЬ' })
  ok(r.code === 404, 'русский ник в другом регистре не снимает чужую запись', `код ${r.code}`)
  ok(ini().includes('"Игорь"') && ini().includes('"игорь"'), 'обе русские записи целы')
  r = await post('api/revoke', { who: 'Игорь' })
  ok(r.code === 200 && !ini().includes('"Игорь"') && ini().includes('"игорь"'),
    'снимается ровно та запись, что названа')
  ok(ini().includes('"Старожил"'), 'чужие записи снятие не задело')

  console.log('\n— целость файла —')
  ok(ini().split('\n').filter(Boolean).every(l => l.startsWith('"') || l.startsWith(';')),
    'в файле только записи и комментарии')
} finally {
  panel.kill()
  rmSync(box, { recursive: true, force: true })
}

console.log(`\nитог: ${pass} ok, ${fails.length} плохо`)
if (fails.length) { fails.forEach(f => console.log(`  провал: ${f}`)); process.exit(1) }
