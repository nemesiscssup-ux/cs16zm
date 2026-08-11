// Собирает рабочий каталог для локального прогона под Windows.
//
// run/ = базовые файлы игры (SteamCMD) + движок ReHLDS + наш server/cstrike сверху.
// Каталог server/ при этом остаётся нетронутым: он — продукт для хостинга,
// а run/ можно удалять и пересобирать сколько угодно.
//
// Запуск: node tools/compose-run.mjs

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = join(ROOT, 'build', 'hlds-base')
const SERVER = join(ROOT, 'server')
const RUN = join(ROOT, 'run')

if (!existsSync(BASE)) {
  console.error(`нет базовых файлов игры: ${BASE}\nсначала скачайте их через SteamCMD (app 90)`)
  process.exit(2)
}

// ── данные игроков переживают пересборку ────────────────────────────────────────
//
// run/ сносится целиком, и вместе с ним раньше пропадал накопленный прогресс:
// кредиты и классы зомби. Это не продукт сборки — восстановить его неоткуда,
// поэтому перед сносом откладываем в сторону и возвращаем обратно.

// Пересобирать каталог под работающим сервером нельзя: он держит файлы, часть
// удалится, часть нет, и каталог останется в полураздетом виде. Проверяем ДО
// того, как что-либо трогать.
function serverIsRunning() {
  if (process.platform !== 'win32') return false
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq hlds.exe', '/NH'], { encoding: 'latin1' })
    return /hlds\.exe/i.test(out)
  } catch {
    return false   // не смогли спросить — не мешаем работать
  }
}

if (serverIsRunning() && !process.argv.includes('--force')) {
  console.error('СЕРВЕР ЗАПУЩЕН (hlds.exe) — пересборка отменена.')
  console.error('')
  console.error('  Под работающим сервером каталог run/ пересобирать нельзя: он держит')
  console.error('  файлы, и часть из них не удалится. Остановите сервер и повторите.')
  console.error('  Если уверены, что это чужой процесс: node tools/compose-run.mjs --force')
  process.exit(2)
}

// Быстрое обновление: переносит только НАШУ часть (cstrike), не трогая 890 МБ
// базовых файлов игры. Хватает для любой правки плагинов, конфигов и моделей,
// занимает секунды вместо минуты — поэтому run-local.cmd зовёт именно его при
// каждом запуске, и сервер всегда стартует со свежей сборкой.
if (process.argv.includes('--update')) {
  if (!existsSync(join(RUN, 'hlds.exe'))) {
    console.error('быстрое обновление невозможно: каталог прогона ещё не собран')
    console.error('сначала полностью: node tools/compose-run.mjs')
    process.exit(2)
  }

  // Обновление вызывается из run-local.cmd перед каждым запуском, поэтому его
  // неудача не должна мешать серверу стартовать: предупреждаем и выходим с
  // нулевым кодом, играть можно и на прежней сборке.
  try {
    // Слияние поверх: файлы, которых в сборке нет (прогресс, журналы), остаются.
    cpSync(join(SERVER, 'cstrike'), join(RUN, 'cstrike'), { recursive: true, force: true })

    const ll = join(RUN, 'cstrike', 'liblist.gam')
    if (existsSync(ll)) {
      writeFileSync(ll, readFileSync(ll, 'latin1')
        .replace(/^gamedll\s+".*"/m, 'gamedll "addons\\metamod\\metamod.dll"')
        .replace(/^gamedll_linux\s+".*"/m, 'gamedll_linux "addons/metamod/metamod_i386.so"'), 'latin1')
    }
    // Слияние только добавляет и перезаписывает. Файл, УБРАННЫЙ из сборки, в
    // прогоне останется — он никому не мешает (сервер его не предзагружает),
    // но если нужна чистота, делайте полную пересборку без --update.
    console.log('+ обновлено из сборки: плагины, конфиги, модели')
  } catch (err) {
    console.log(`! обновить не удалось (${err.code ?? err.message}) — запускаемся на прежней сборке`)
  }
  process.exit(0)
}

const STASH = join(ROOT, 'build', 'run-keep')
const KEEP = [
  'cstrike/addons/amxmodx/data/vault',   // прогресс игроков (nVault)
  'cstrike/addons/amxmodx/data/csstats.dat', // статистика CSX
  'cstrike/addons/amxmodx/logs',         // журнал действий — по нему разбираем жалобы
]

function stash(from, to) {
  let saved = 0
  for (const rel of KEEP) {
    const src = join(from, ...rel.split('/'))
    if (!existsSync(src)) continue
    const dst = join(to, ...rel.split('/'))
    mkdirSync(dirname(dst), { recursive: true })
    cpSync(src, dst, { recursive: true })
    saved++
  }
  return saved
}

// Чистим СОДЕРЖИМОЕ, а не сам каталог. Windows не даёт удалить папку, которая
// служит кому-то текущей — открытая в ней консоль или проводник дают EBUSY на
// rmdir, хотя всё внутри удаляется прекрасно. Плюс повторы: только что
// записанные файлы недолго держит антивирус.
const locked = []

function wipeContents(dir, attempts = 4) {
  for (const name of readdirSync(dir)) {
    const target = join(dir, name)
    const isDir = statSync(target).isDirectory()

    let removed = false
    for (let i = 1; i <= attempts && !removed; i++) {
      try {
        rmSync(target, { recursive: true, force: true })
        removed = true
      } catch {
        execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},400)'])
      }
    }
    if (removed) continue

    // Каталог удалить не дают, если он кому-то служит текущим или внутри него
    // открыт файл: сервер, проводник, блокнот с журналом. Само содержимое при
    // этом удаляется прекрасно — опустошаем и оставляем пустую папку, поверх
    // неё всё равно ляжет свежая сборка.
    if (isDir) {
      wipeContents(target, attempts)
      locked.push(relative(RUN, target).split(sep).join('/') || '.')
      continue
    }

    throw new Error(
      `не удалось удалить файл ${target}\n` +
      `  данные игроков отложены в ${STASH} и НЕ потеряны;\n` +
      '  закройте сервер и редактор, если в них открыт этот файл, и повторите')
  }
}

if (existsSync(RUN)) {
  rmSync(STASH, { recursive: true, force: true })
  const saved = stash(RUN, STASH)
  if (saved) console.log(`= отложено на время пересборки: ${saved} (прогресс, статистика, журналы)`)
  wipeContents(RUN)
  if (locked.length) {
    console.log(`= занятые каталоги опустошены, но не удалены (${locked.length}): ${locked.slice(0, 3).join(', ')}`)
    console.log('  это нормально: их держит открытый сервер, проводник или редактор')
  }
}
mkdirSync(RUN, { recursive: true })

// 1. Базовая поставка игры.
cpSync(BASE, RUN, { recursive: true })
console.log('+ базовые файлы игры')

// 2. Движок.
//
// По умолчанию остаётся штатный движок Valve из поставки SteamCMD. Windows-сборка
// ReHLDS 3.15 на этой машине не запускается: swds.dll завершает процесс сразу и
// молча, без записи в журнал сбоев (проверено и с лаунчером ReHLDS, и с лаунчером
// Valve). На боевой Linux-хостинг едет linux-версия ReHLDS, и к ней это отношения
// не имеет — здесь мы проверяем свой стек плагинов, а не движок.
//
// Ключ --engine rehlds принудительно ставит ReHLDS, если захотите проверить сами.
const useRehlds = process.argv.includes('--engine') && process.argv[process.argv.indexOf('--engine') + 1] === 'rehlds'
if (useRehlds) {
  const engine = join(SERVER, 'engine-win')
  if (existsSync(engine)) {
    cpSync(engine, RUN, { recursive: true })
    console.log('+ движок ReHLDS (windows) — по явному запросу')
  }
} else {
  console.log('= движок Valve из поставки SteamCMD (ReHLDS под Windows здесь не стартует)')
}

// 3. Наш cstrike: addons, dlls, конфиги, ресурсы мода.
cpSync(join(SERVER, 'cstrike'), join(RUN, 'cstrike'), { recursive: true })
console.log('+ наш cstrike (addons, конфиги, Zombie Plague)')

// 4. liblist.gam должен отдавать управление Metamod, иначе плагины не загрузятся.
const liblist = join(RUN, 'cstrike', 'liblist.gam')
if (existsSync(liblist)) {
  const src = readFileSync(liblist, 'latin1')
  const patched = src
    .replace(/^gamedll\s+".*"/m, 'gamedll "addons\\metamod\\metamod.dll"')
    .replace(/^gamedll_linux\s+".*"/m, 'gamedll_linux "addons/metamod/metamod_i386.so"')
  writeFileSync(liblist, patched, 'latin1')
  const ok = /addons\\metamod\\metamod\.dll/.test(patched)
  console.log(`${ok ? '+' : '!'} liblist.gam ${ok ? 'переключён на Metamod' : 'НЕ переключился — проверьте вручную'}`)
} else {
  console.log('! нет cstrike/liblist.gam — базовая поставка неполная')
}

// Возвращаем данные игроков на место — последним шагом, поверх свежей сборки.
if (existsSync(STASH)) {
  const back = stash(STASH, RUN)
  if (back) console.log(`+ прогресс игроков возвращён (${back})`)
  rmSync(STASH, { recursive: true, force: true })
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out); else out.push(p)
  }
  return out
}
const files = walk(RUN)
const maps = existsSync(join(RUN, 'cstrike', 'maps'))
  ? readdirSync(join(RUN, 'cstrike', 'maps')).filter(f => f.endsWith('.bsp'))
  : []

console.log(`\nrun/: ${files.length} файлов, ${(files.reduce((s, p) => s + statSync(p).size, 0) / 1048576).toFixed(0)} МБ`)
console.log(`карт: ${maps.length}${maps.length ? ` (например ${maps.slice(0, 3).join(', ')})` : ''}`)
