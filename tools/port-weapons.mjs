// Перенос плагинов оружия из проверенной сборки: исходники + все ресурсы.
//
// Плагин оружия бесполезен без своих файлов: модели вида/рук/на земле, звуки
// выстрела, модель гильзы, спрайт значка в HUD. Пропустишь один — сервер либо
// упадёт на предзагрузке, либо покажет игроку пустоту. Поэтому пути вытаскиваем
// из самого исходника, а не переписываем руками.
//
// Берём ТОЛЬКО те плагины, которые не зависят от чужого форка Zombie Plague:
// у нас 4.4 Fix5a, а сборка сделана под Zombie Plague Advance.
//
// Запуск: node tools/port-weapons.mjs [--dry]

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { retargetFile, retargetPath } from './retarget.mjs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(ROOT, 'quarantine', 'justpro-zombie', 'extracted', 'NEW BALANCE')
const SRC = join(BUILD, 'scripting_jp', 'scripting_jp')
const CONTENT = join(BUILD, 'Компелировання')
const OUT_PLUGINS = join(ROOT, 'custom', 'plugins')
const OUT_CONTENT = join(ROOT, 'custom', 'content')

const dry = process.argv.includes('--dry')

// Ресурсы ищем по расширению: пути в исходниках всегда строковые литералы.
const RESOURCE_RE = /"((?:models|sound|sprites)\/[^"]+\.(?:mdl|wav|mp3|spr|txt))"/g

// ⚠️ Звук пишется БЕЗ «sound/»: precache_sound и emit_sound отсчитывают путь
// от каталога sound/, поэтому в коде стоит "weapons/ak_long-1.wav". Пока это
// не учитывали, звуки выстрелов не попадали в сборку — сервер их
// предзагружал, клиент просил и получал «server failed to transmit file»,
// а стволы стреляли молча. Поймано журналом живого клиента (-condebug).
const SOUND_RE = /"((?!models\/|sprites\/|sound\/)[A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:wav|mp3))"/g

function findFile(dir, name) {
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let names
    try { names = readdirSync(d) } catch { continue }
    for (const n of names) {
      const p = join(d, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) stack.push(p)
      else if (n.toLowerCase() === name.toLowerCase()) return p
    }
  }
  return null
}

if (!existsSync(SRC)) {
  console.error(`нет исходников сборки: ${SRC}`)
  process.exit(2)
}

// Плагины оружия без зависимости от мода. balrog1, crossbow, m32 и нож
// подключают zombie_plague / zombie_plague_advance — чужой форк, не наш.
const plugins = readdirSync(SRC)
  .filter(f => /^zp43_weapon_.+\.sma$/.test(f))
  .filter(f => {
    const text = readFileSync(join(SRC, f), 'utf8')
    // Осторожно с написанием: у ZP 4.3 включение зовётся <zombieplague>,
    // без подчёркивания, а у форка Advance — <zombie_plague_advance>.
    return !/#include\s*<\s*zombie_?plague/i.test(text)
  })
  .sort()

console.log(`плагинов оружия без зависимости от мода: ${plugins.length}`)

const wanted = new Set()
const taken = []

for (const f of plugins) {
  const text = readFileSync(join(SRC, f), 'utf8')
  for (const m of text.matchAll(RESOURCE_RE)) wanted.add(m[1])
  for (const m of text.matchAll(SOUND_RE)) wanted.add(`sound/${m[1]}`)

  // Значок оружия в HUD собирается по имени из WEAPON_WEAPONLIST: движок
  // читает sprites/<имя>.txt, а тот перечисляет уже сами картинки. В коде
  // путь стоит шаблоном "sprites/%s.txt", поэтому его не выловить обычным
  // поиском строк — достаём имя и разбираем список сами.
  const list = text.match(/WEAPON_WEAPONLIST\s+"([^"]+)"/)
  if (list) {
    const txt = `sprites/${list[1]}.txt`
    wanted.add(txt)

    const listFile = findFile(CONTENT, `${list[1]}.txt`)
    if (listFile) {
      // ⚠️ Строки вида: «weapon 640 jp_effects/640hud32 0 0 170 45». Имя
      // картинки идёт БЕЗ «sprites/» и может лежать в подкаталоге, поэтому
      // искать подстроку «sprites/» бесполезно — так пропали 16 значков.
      for (const line of readFileSync(listFile, 'latin1').split('\n')) {
        const m = line.match(/^\s*\S+\s+\d+\s+([A-Za-z0-9_./-]+)/)
        if (!m) continue
        wanted.add(`sprites/${m[1].endsWith('.spr') ? m[1] : `${m[1]}.spr`}`)
      }
    }
  }

  taken.push(f)
}

console.log(`ресурсов упомянуто в исходниках: ${wanted.size}`)

if (dry) {
  for (const r of [...wanted].sort()) console.log(`  ${r}`)
  process.exit(0)
}

mkdirSync(OUT_PLUGINS, { recursive: true })
// Пути в исходниках переводим на свои сразу при переносе: иначе следующий
// запуск переносчика вернул бы чужие обратно поверх наших правок.
let retargeted = 0
for (const f of taken) {
  const to = join(OUT_PLUGINS, f)
  copyFileSync(join(SRC, f), to)
  retargeted += retargetFile(to)
}
console.log(`+ исходники плагинов: ${taken.length}`)

let copied = 0
const missing = []
for (const rel of [...wanted].sort()) {
  // Шаблоны формата — не пути: имя подставляется в них во время работы,
  // а сами файлы уже добавлены выше, по разбору списка значков.
  if (rel.includes('%')) continue

  const name = basename(rel)
  const from = findFile(CONTENT, name)
  if (!from) { missing.push(rel); continue }

  // Кладём по НАШЕМУ пути: ссылки в исходниках уже переведены, и файл должен
  // лежать там, куда они теперь смотрят.
  const to = join(OUT_CONTENT, ...retargetPath(rel).split('/'))
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  copied++
}

console.log(`+ ресурсов перенесено: ${copied}`)
if (missing.length) {
  console.log(`! не найдено в сборке (${missing.length}) — эти плагины работать не будут:`)
  for (const m of missing) console.log(`    ${m}`)
}

writeFileSync(join(OUT_CONTENT, 'ПРОИСХОЖДЕНИЕ.txt'), [
  'Модели, звуки и спрайты оружия из сборки JUST PRO ZOMBIE.',
  '',
  'Сама сборка признана грязной (см. reports/justpro-zombie.md):',
  'в ней рабочие пароли админов и 31 плагин без исходников.',
  'Отсюда взяты ТОЛЬКО данные и исходники плагинов оружия,',
  'которые компилируются здесь же и не зависят от чужого форка мода.',
  '',
  `Перенесено файлов: ${copied}. Список задаётся самими исходниками,`,
  'см. tools/port-weapons.mjs — руками пути не переписываются.',
  '',
].join('\n'), 'utf8')
