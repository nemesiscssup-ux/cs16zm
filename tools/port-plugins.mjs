// Перенос плагинов из проверенной сборки: исходники плюс все их ресурсы.
//
// Плагин бесполезен без своих файлов: моделей, звуков, спрайтов. Пропустишь
// один — сервер либо упадёт на предзагрузке, либо покажет игроку пустоту.
// Поэтому пути вытаскиваются ИЗ САМИХ ИСХОДНИКОВ, а не переписываются руками.
//
// Что переносить — задаётся списком в custom/ported.json: так видно, что и
// откуда взято, и перенос повторяем.
//
// Запуск: node tools/port-plugins.mjs [--dry]

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { renameModel } from './mdl-rename.mjs'
import { patchPorted } from './patch-ported.mjs'
import { retargetFile, retargetPath } from './retarget.mjs'
import { scrubNames, untag, untagAll } from './mdl-untag.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_PLUGINS = join(ROOT, 'custom', 'plugins')
const OUT_CONTENT = join(ROOT, 'custom', 'content')
const TOOLS = dirname(fileURLToPath(import.meta.url))
const LIST = join(ROOT, 'custom', 'ported.json')
const STOCK = join(ROOT, 'build', 'hlds-base')

const dry = process.argv.includes('--dry')

// Пути к ресурсам в исходниках — обычные строковые литералы.
const RESOURCE_RE = /"((?:models|sound|sprites)\/[^"]+\.(?:mdl|wav|mp3|spr|txt))"/g

// ⚠️ Звук в исходнике пишется БЕЗ «sound/»: precache_sound и emit_sound берут
// путь от каталога sound/, поэтому в коде стоит просто "weapons/ak_long-1.wav".
// Пока этого не учитывали, 69 звуков стволов не попадали в сборку: сервер их
// предзагружал, клиент просил — и получал «server failed to transmit file»,
// а стволы стреляли молча. Поймано журналом живого клиента (-condebug).
const SOUND_RE = /"((?!models\/|sprites\/|sound\/)[A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:wav|mp3))"/g

function findFile(dir, name, cache = new Map()) {
  if (!cache.has(dir)) {
    const index = new Map()
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
        else if (!index.has(n.toLowerCase())) index.set(n.toLowerCase(), p)
      }
    }
    cache.set(dir, index)
  }
  return cache.get(dir).get(name.toLowerCase()) ?? null
}

if (!existsSync(LIST)) {
  console.error(`нет списка переносимого: ${LIST}`)
  process.exit(2)
}

const spec = JSON.parse(readFileSync(LIST, 'utf8'))
const cache = new Map()

mkdirSync(OUT_PLUGINS, { recursive: true })

let plugins = 0
let resources = 0
const missing = []
const scrubbed = []
let patched = 0
let names = 0   // моделей, где стёрт чужой адрес в названиях частей

for (const group of spec.groups) {
  const src = join(ROOT, ...group.sources.split('/'))
  const content = join(ROOT, ...group.content.split('/'))

  console.log(`\n— ${group.name} (${group.plugins.length})`)

  for (const name of group.plugins) {
    const from = findFile(src, `${name}.sma`, cache)
    if (!from) { console.log(`  ! нет исходника: ${name}.sma`); continue }

    const text = readFileSync(from, 'utf8')
    if (!dry) {
      const to = join(OUT_PLUGINS, `${name}.sma`)
      copyFileSync(from, to)
      // Чужие пути к моделям переводим на свои прямо здесь: иначе перенос
      // возвращал бы их поверх наших правок при каждом запуске. По той же
      // причине здесь же ложатся и наши правки в самом коде плагина.
      retargetFile(to)
      patched += patchPorted(to, name)
    }
    plugins++

    const wanted = new Set()
    for (const m of text.matchAll(RESOURCE_RE)) wanted.add(m[1])
    for (const m of text.matchAll(SOUND_RE)) wanted.add(`sound/${m[1]}`)

    // Класс зомби задаёт модель игрока ИМЕНЕМ, а не путём: мод сам разворачивает
    // "csdead1_electric" в models/player/csdead1_electric/csdead1_electric.mdl.
    // Пропустить это — значит уронить сервер на предзагрузке карты, что мы уже
    // и словили: «Mod_NumForName: ... not found» и отказ старта.
    // Коготь класса мод ищет в своём каталоге, и КАТАЛОГ ЗАВИСИТ ОТ ВЕРСИИ:
    // у 4.3 это models/zombie_plague, у нашей 4.4 — models/zombie_plague_v44.
    // Кладём по нашему пути, иначе сервер падает на предзагрузке.
    const pmdl = text.match(/ZCLASS_PLAYER_MDL\[\]\s*=\s*"([^"]+)"/)
    if (pmdl) {
      wanted.add(`models/player/${pmdl[1]}/${pmdl[1]}.mdl`)
      // Модели с внешними текстурами возят рядом файл с суффиксом T.
      if (findFile(content, `${pmdl[1]}T.mdl`, cache)) {
        wanted.add(`models/player/${pmdl[1]}/${pmdl[1]}T.mdl`)
      }
    }
    // Имя переменной с когтем в чужих плагинах пишут по-разному: ZCLASS_CLAW_MDL
    // в одних сборках, zclass_clawmodel в других. Ловим оба — иначе лапа класса
    // просто не доедет, а мод при заражении уронит сервер на предзагрузке.
    const claw = text.match(/(?:ZCLASS_CLAW_MDL|zclass_clawmodel)\[\]\s*=\s*\{?\s*"([^"]+)"/)
    if (claw) wanted.add(`models/zombie_plague_v44/${claw[1]}`)

    // Значок оружия в HUD задан шаблоном "sprites/%s.txt": имя берётся из
    // WEAPON_WEAPONLIST, а сам .txt перечисляет уже картинки. Обычным поиском
    // строк такой путь не выловить.
    const list = text.match(/WEAPON_WEAPONLIST\s+"([^"]+)"/)
    if (list) {
      wanted.add(`sprites/${list[1]}.txt`)
      const lf = findFile(content, `${list[1]}.txt`, cache)
      if (lf) {
        // ⚠️ Внутри списка имя картинки записано БЕЗ «sprites/» и может лежать
        // в подкаталоге: «weapon 640 jp_effects/640hud32 0 0 170 45». Раньше
        // искали подстроку «sprites/», которой там нет, — и 16 значков оружия
        // в HUD оставались без файлов.
        for (const line of readFileSync(lf, 'latin1').split('\n')) {
          const m = line.match(/^\s*\S+\s+\d+\s+([A-Za-z0-9_./-]+)/)
          if (!m) continue
          wanted.add(`sprites/${m[1].endsWith('.spr') ? m[1] : `${m[1]}.spr`}`)
        }
      }
    }

    let got = 0
    let stock = 0
    for (const rel of wanted) {
      if (rel.includes('%')) continue   // шаблон формата, не путь

      // Штатные файлы игры переносить не нужно: движок ищет их сначала в
      // каталоге мода, потом в базовом valve/, и у игрока они уже есть.
      // Без этой проверки половина отчёта — ложные пропажи вроде blood.spr.
      if (existsSync(join(STOCK, 'cstrike', ...rel.split('/')))
        || existsSync(join(STOCK, 'valve', ...rel.split('/')))) { stock++; continue }

      const f = findFile(content, basename(rel), cache)
      if (!f) { missing.push(`${name}: ${rel}`); continue }
      if (!dry) {
        // Кладём по НАШЕМУ пути: пути в исходнике уже переведены, а список
        // ресурсов собран по исходному тексту, до перевода.
        const out = retargetPath(rel)
        const to = join(OUT_CONTENT, ...out.split('/'))
        mkdirSync(dirname(to), { recursive: true })
        copyFileSync(f, to)
        if (to.endsWith('.mdl') && scrubNames(to)) names++

        // Переименованная модель требует того же ухода, что и скины из списка:
        // внутри .mdl лежит СВОЁ имя, и пока оно чужое, клиент считает файл
        // чужим. Заодно снимаем рекламу донора — иначе она вернулась бы с
        // каждым переносом.
        if (out !== rel && to.endsWith('.mdl')) {
          const cleaned = untag(to, basename(rel, '.mdl'))
          if (cleaned) scrubbed.push(`${basename(out, '.mdl')}: ${cleaned.join('; ')}`)
          if (!to.endsWith('T.mdl')) renameModel(to, basename(out))
        }
      }
      got++
      resources++
    }
    console.log(`  + ${name.padEnd(38)} ресурсов ${got}${stock ? `, штатных ${stock}` : ''}`)
  }

  // Скины игроков ни в каком исходнике не упомянуты: в тех сборках их
  // раздаёт конфиг, а не плагин, поэтому вытащить путь из кода нечем.
  // Перечисляем такие модели ИМЕНЕМ — мод разворачивает имя в
  // models/player/<имя>/<имя>.mdl, а рядом может лежать файл текстур с
  // суффиксом T.
  // Отдельные файлы, которые не привязаны к плагину: модели гранат, спрайты,
  // звуки. Путь указывается ровно так, как он будет лежать в cstrike/.
  for (const rel of group.files ?? []) {
    const f = findFile(content, basename(rel), cache)
    if (!f) { missing.push(`файл ${rel}`); continue }
    if (!dry) {
      const to = join(OUT_CONTENT, ...retargetPath(rel).split('/'))
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(f, to)
      if (to.endsWith('.mdl') && scrubNames(to)) names++
    }
    resources++
    console.log(`  + файл ${rel}`)
  }

  // Имя можно задать строкой или парой «откуда → как назвать у нас».
  // Переименование нужно не для красоты: у клиента модели лежат по имени, и
  // пока имя чужое, он не станет скачивать нашу — покажет ту, что уже скачал
  // с другого сервера. Смена имени и есть способ заставить его перекачать.
  for (const entry of group.models ?? []) {
    const n = typeof entry === 'string' ? entry : entry.from
    const as = typeof entry === 'string' ? entry : entry.to
    let got = 0
    for (const rel of [`models/player/${n}/${n}.mdl`, `models/player/${n}/${n}T.mdl`]) {
      const f = findFile(content, basename(rel), cache)
      if (!f) {
        // Файл текстур есть не у всех моделей — его отсутствие не поломка.
        if (rel.endsWith('T.mdl')) continue
        missing.push(`скин ${n}: ${rel}`)
        continue
      }
      if (!dry) {
        const out = rel.replace(`models/player/${n}/${n}`, `models/player/${as}/${as}`)
        const to = join(OUT_CONTENT, ...out.split('/'))
        mkdirSync(dirname(to), { recursive: true })
        copyFileSync(f, to)

        // На части чужих скинов нарисована реклама сборки-донора. Закрашиваем
        // сразу после переноса: иначе правка терялась бы при каждом обновлении
        // из карантина, и реклама тихо возвращалась бы в сборку.
        // Правим КОПИЮ: карантин трогать нельзя, он — доказательная база.
        if (scrubNames(to)) names++
        const cleaned = untag(to, n)
        if (cleaned) scrubbed.push(`${as}: ${cleaned.join('; ')}`)

        // Внутреннее имя тоже наше: иначе у клиента рядом окажутся две разные
        // модели с одинаковым именем в заголовке.
        if (as !== n && !rel.endsWith('T.mdl')) renameModel(to, `${as}.mdl`)
      }
      got++
      resources++
    }
    console.log(`  + скин ${(as === n ? n : `${n} → ${as}`).padEnd(33)} файлов ${got}`)
  }
}

// ⚠️⚠️ ПОСЛЕ ПЕРЕНОСА ЧИСТИМ ВСЁ ДЕРЕВО, А НЕ ТОЛЬКО ТО, ЧТО ТОЛЬКО ЧТО
// СКОПИРОВАЛИ. Перенос кладёт свежие копии из карантина и тем самым ОТМЕНЯЕТ
// правки, сделанные позже поимённо: снятые визитки донора, закраску рекламы у
// моделей, переименованных не здесь, и снятый флаг прозрачности. Проверка
// verify-ru после каждого переноса краснела десятком строк, и чинить их
// приходилось руками. Теперь порядок такой: перенесли — прибрали за собой.
const cleaned = untagAll([join(OUT_CONTENT, 'models'), join(ROOT, 'custom', 'models')])
console.log(`\nчистка после переноса: закрашено надписей ${cleaned.ads}, снято визиток ${cleaned.plates}, затёрто подписей ${cleaned.names}`)

// Флаг «с прозрачностью» на главной текстуре делает ЖИВОГО игрока невидимым
// (см. шапку mdl-unmask.mjs). Снимаем тем же инструментом, что и раньше.
execFileSync(process.execPath, [join(TOOLS, 'mdl-unmask.mjs')], { stdio: 'inherit' })

console.log(`\nплагинов: ${plugins}, ресурсов: ${resources}, наших правок в чужом коде: ${patched}, моделей без чужого адреса в подписях: ${names}`)
if (scrubbed.length) {
  console.log(`\nзакрашена чужая реклама (${scrubbed.length}):`)
  for (const s of scrubbed) console.log(`    ${s}`)
}
if (missing.length) {
  console.log(`\n! не найдено в сборках (${missing.length}) — эти плагины могут не работать:`)
  for (const m of missing.slice(0, 25)) console.log(`    ${m}`)
  if (missing.length > 25) console.log(`    ... и ещё ${missing.length - 25}`)
}
