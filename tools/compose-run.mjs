// Собирает рабочий каталог для локального прогона под Windows.
//
// run/ = базовые файлы игры (SteamCMD) + движок ReHLDS + наш server/cstrike сверху.
// Каталог server/ при этом остаётся нетронутым: он — продукт для хостинга,
// а run/ можно удалять и пересобирать сколько угодно.
//
// Запуск: node tools/compose-run.mjs

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = join(ROOT, 'build', 'hlds-base')
const SERVER = join(ROOT, 'server')
const RUN = join(ROOT, 'run')

if (!existsSync(BASE)) {
  console.error(`нет базовых файлов игры: ${BASE}\nсначала скачайте их через SteamCMD (app 90)`)
  process.exit(2)
}

if (existsSync(RUN)) rmSync(RUN, { recursive: true, force: true })
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
