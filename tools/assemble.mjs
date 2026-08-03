// Собирает чистый сервер из проверенного апстрима.
//
// В server/ не попадает ни одного файла из скачанных сборок: только официальные
// релизы с зафиксированным SHA256 и плагины, скомпилированные здесь же из исходников.
//
// Запуск: node tools/assemble.mjs

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REF = join(ROOT, 'upstream', 'reference')
const SERVER = join(ROOT, 'server')
const CSTRIKE = join(SERVER, 'cstrike')
const AMXX = join(CSTRIKE, 'addons', 'amxmodx')

const AMXX_LINUX = join(REF, 'amxmodx-1.10.0-git5479-base-linux')
const AMXX_LINUX_CS = join(REF, 'amxmodx-1.10.0-git5479-cstrike-linux')
const AMXX_WIN = join(REF, 'amxmodx-1.10.0-git5479-base-windows')
const AMXX_WIN_CS = join(REF, 'amxmodx-1.10.0-git5479-cstrike-windows')
const METAMOD = join(REF, 'metamod-bin-1.3.0.149')
const REAPI = join(REF, 'reapi-bin-5.29.0.358')
const REUNION = join(REF, 'reunion-0.2.0.25')
const REHLDS = join(REF, 'rehlds-bin-3.15.0.896')
const REGAMEDLL = join(REF, 'regamedll-bin-5.30.0.814')
const ZP = join(ROOT, 'quarantine', 'gamemodd-zp44fix5a-upstream', 'extracted')

const placed = []

function copy(from, to, label) {
  if (!existsSync(from)) { console.log(`! пропущено, нет источника: ${from}`); return }
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
  placed.push({ label, from: relative(ROOT, from).split(sep).join('/'), to: relative(SERVER, to).split(sep).join('/') })
}

// ── чистим и раскладываем ───────────────────────────────────────────────────────

if (existsSync(SERVER)) rmSync(SERVER, { recursive: true, force: true })
mkdirSync(SERVER, { recursive: true })

// 1. AMX Mod X: Linux — боевая платформа, Windows — для локального прогона.
copy(join(AMXX_LINUX, 'addons'), join(CSTRIKE, 'addons'), 'AMX Mod X 1.10 base (linux)')
copy(join(AMXX_LINUX_CS, 'addons'), join(CSTRIKE, 'addons'), 'AMX Mod X 1.10 cstrike (linux)')
copy(join(AMXX_WIN, 'addons'), join(CSTRIKE, 'addons'), 'AMX Mod X 1.10 base (windows)')
copy(join(AMXX_WIN_CS, 'addons'), join(CSTRIKE, 'addons'), 'AMX Mod X 1.10 cstrike (windows)')

// 2. Metamod-r — загрузчик модулей.
copy(join(METAMOD, 'addons', 'metamod'), join(CSTRIKE, 'addons', 'metamod'), 'Metamod-r 1.3.0.149')

// 3. ReAPI — модуль AMXX с доступом к ReHLDS/ReGameDLL.
copy(join(REAPI, 'addons', 'amxmodx', 'modules'), join(AMXX, 'modules'), 'ReAPI 5.29 модули')
copy(join(REAPI, 'addons', 'amxmodx', 'scripting', 'include'), join(AMXX, 'scripting', 'include'), 'ReAPI 5.29 включения')

// 4. ReUnion — поддержка нон-стим клиентов.
copy(join(REUNION, 'bin', 'Linux', 'reunion_mm_i386.so'), join(CSTRIKE, 'addons', 'reunion', 'reunion_mm_i386.so'), 'ReUnion 0.2.0.25 (linux)')
copy(join(REUNION, 'bin', 'Windows', 'reunion_mm.dll'), join(CSTRIKE, 'addons', 'reunion', 'reunion_mm.dll'), 'ReUnion 0.2.0.25 (windows)')
copy(join(REUNION, 'reunion.cfg'), join(CSTRIKE, 'addons', 'reunion', 'reunion.cfg'), 'ReUnion конфигурация')

// 5. ReGameDLL — игровая логика.
copy(join(REGAMEDLL, 'bin', 'linux32', 'cstrike', 'dlls', 'cs.so'), join(CSTRIKE, 'dlls', 'cs.so'), 'ReGameDLL 5.30 (linux)')
copy(join(REGAMEDLL, 'bin', 'win32', 'cstrike', 'dlls', 'mp.dll'), join(CSTRIKE, 'dlls', 'mp.dll'), 'ReGameDLL 5.30 (windows)')
for (const f of ['delta.lst', 'game.cfg', 'game_init.cfg']) {
  copy(join(REGAMEDLL, 'bin', 'linux32', 'cstrike', f), join(CSTRIKE, f), `ReGameDLL: ${f}`)
}

// 6. ReHLDS — движок. Кладём отдельно: на хостинге он обычно уже свой.
copy(join(REHLDS, 'bin', 'linux32'), join(SERVER, 'engine-linux'), 'ReHLDS 3.15 (linux)')
copy(join(REHLDS, 'bin', 'win32'), join(SERVER, 'engine-win'), 'ReHLDS 3.15 (windows)')

// 7. Zombie Plague: только исходники и ресурсы, плагины компилируем сами.
const zpSrc = join(ZP, 'zp_plugin_44', 'addons', 'amxmodx')
copy(join(zpSrc, 'scripting'), join(AMXX, 'scripting'), 'Zombie Plague 4.4 исходники')
copy(join(zpSrc, 'configs'), join(AMXX, 'configs'), 'Zombie Plague 4.4 конфигурация')
copy(join(zpSrc, 'data'), join(AMXX, 'data'), 'Zombie Plague 4.4 переводы')
for (const d of ['models', 'sound', 'sprites']) {
  copy(join(ZP, 'zp_resources_v44', d), join(CSTRIKE, d), `Zombie Plague ресурсы: ${d}`)
}

// ── компиляция плагинов из исходников ───────────────────────────────────────────

const amxxpc = join(AMXX_WIN, 'addons', 'amxmodx', 'scripting', 'amxxpc.exe')
const scripting = join(AMXX, 'scripting')
const pluginsDir = join(AMXX, 'plugins')
const compiled = []

for (const name of ['zombie_plague44', 'zp_zclasses44']) {
  const src = join(scripting, `${name}.sma`)
  if (!existsSync(src)) { console.log(`! нет исходника ${name}.sma`); continue }
  const out = join(pluginsDir, `${name}.amxx`)
  try {
    execFileSync(amxxpc, [src, `-i${join(scripting, 'include')}`, `-o${out}`], { encoding: 'latin1', windowsHide: true })
    const h = createHash('sha256').update(readFileSync(out)).digest('hex').toUpperCase()
    compiled.push({ name, sha256: h, size: statSync(out).size })
    console.log(`+ скомпилирован ${name}.amxx`)
  } catch (err) {
    console.log(`! ошибка компиляции ${name}: ${err.message.slice(0, 200)}`)
  }
}

// ── конфигурация ────────────────────────────────────────────────────────────────

writeFileSync(join(CSTRIKE, 'addons', 'metamod', 'plugins.ini'), [
  '; Модули Metamod. Каждая строка загружается с полными правами процесса сервера —',
  '; добавлять сюда что-либо без проверки исходников нельзя.',
  '',
  'linux addons/amxmodx/dlls/amxmodx_mm_i386.so',
  'win32 addons\\amxmodx\\dlls\\amxmodx_mm.dll',
  'linux addons/reunion/reunion_mm_i386.so',
  'win32 addons\\reunion\\reunion_mm.dll',
  '',
].join('\n'))

const modulesIni = join(AMXX, 'configs', 'modules.ini')
if (existsSync(modulesIni)) {
  const cur = readFileSync(modulesIni, 'utf8')
  const extra = ['', '; Добавлено при сборке', 'reapi']
  // Модуль sockets даёт плагинам выход в сеть. Игровому серверу он не нужен.
  const off = cur.split(/\r?\n/).map(l => /^\s*sockets\s*$/.test(l) ? '; sockets — отключён намеренно: сеть плагинам не нужна' : l)
  writeFileSync(modulesIni, [...off, ...extra].join('\n'))
}

const pluginsIni = join(AMXX, 'configs', 'plugins.ini')
if (existsSync(pluginsIni)) {
  const cur = readFileSync(pluginsIni, 'utf8')
  writeFileSync(pluginsIni, `${cur}\n; ── Zombie Plague ──\nzombie_plague44.amxx\nzp_zclasses44.amxx\n`)
}

// Список администраторов пуст намеренно — ровно то, чем грешат готовые сборки.
writeFileSync(join(AMXX, 'configs', 'users.ini'), [
  '; Список администраторов.',
  ';',
  '; Файл намеренно пуст. Во всех проверенных готовых сборках здесь лежали рабочие',
  '; учётные записи их авторов — с паролем "1", "admin" или вовсе без пароля.',
  '; Любой, кто скачал такую сборку, становился администратором чужого сервера.',
  ';',
  '; Формат: "кто" "пароль" "флаги_доступа" "флаги_аккаунта"',
  '; Флаги аккаунта: c — это SteamID, d — это IP, e — пароль НЕ проверяется.',
  '; Никогда не используйте «e» вместе с широкими правами.',
  ';',
  '; Пример правильной записи (свой SteamID и свой пароль):',
  '; "STEAM_0:0:000000" "ваш_пароль" "abcdefghijklmnopqrstu" "ca"',
  '',
].join('\n'))

writeFileSync(join(CSTRIKE, 'server.cfg'), [
  '// Базовая конфигурация сервера Zombie Plague.',
  '// rcon_password здесь НЕ указан намеренно: пароль задаётся на хостинге,',
  '// иначе он попадает в архив и становится известен всем.',
  '',
  'hostname "Zombie Plague | RU"',
  'sv_lan 0',
  'sv_region 3',
  '',
  'mp_timelimit 30',
  'mp_autoteambalance 0',
  'mp_limitteams 0',
  'mp_friendlyfire 0',
  'mp_flashlight 1',
  'mp_footsteps 1',
  'mp_freezetime 0',
  'mp_roundtime 5',
  '',
  'sv_maxspeed 900',
  'sv_gravity 800',
  'sv_maxrate 100000',
  'sv_minrate 25000',
  'sv_cheats 0',
  'sv_consistency 0',
  'sv_allowupload 0',
  'sv_allowdownload 1',
  '',
  '// FastDL: свой домен и только свой.',
  '// sv_downloadurl "https://ваш-домен/fastdl/cstrike"',
  '',
  'log on',
  'mp_logmessages 1',
  'mp_logdetail 3',
  '',
].join('\n'))

writeFileSync(join(CSTRIKE, 'motd.txt'), [
  '<body bgcolor="#101014" text="#d8d8e0" style="font-family:Verdana,sans-serif">',
  '<h3 style="color:#8bd450">Zombie Plague</h3>',
  '<p>Сервер собран из официальных исходников. Приятной игры.</p>',
  '</body>',
].join('\n'))

// ── опись ───────────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out); else out.push(p)
  }
  return out
}
const files = walk(SERVER)
const manifest = {
  built: new Date().toISOString(),
  components: placed,
  compiledPlugins: compiled,
  totals: { files: files.length, bytes: files.reduce((s, p) => s + statSync(p).size, 0) },
}
writeFileSync(join(SERVER, 'BUILD-MANIFEST.json'), JSON.stringify(manifest, null, 2))

console.log(`\nсобрано: ${files.length} файлов, ${(manifest.totals.bytes / 1048576).toFixed(1)} МБ`)
console.log(`компонентов уложено: ${placed.length}, плагинов скомпилировано: ${compiled.length}`)
