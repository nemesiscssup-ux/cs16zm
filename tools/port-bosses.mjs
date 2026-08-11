// Переносит модели БОССОВ РЕЖИМОВ из чужих сборок в нашу.
//
// ЗАЧЕМ. Владелец: «пройтись по режимам, добавить уникальные модели для боссов
// режимов и модели рук им». До этого все четыре босса выглядели как рядовые
// игроки — так стоит в апстриме:
//
//   NEMESIS  = zombie_source_v44   обычный зомби, только крупнее и краснее
//   ASSASSIN = zombie_source_v44   тот же самый
//   SURVIVOR = zp_human_v44        обычный боец
//   SNIPER   = zp_human_v44        тот же самый
//
// То есть режим объявляется голосом и надписью, а на карте отличить босса от
// соседа нельзя, пока он тебя не убьёт. Модели ниже это чинят.
//
// ЧТО ДЕЛАЕМ С КАЖДЫМ ФАЙЛОМ, КРОМЕ КОПИРОВАНИЯ, — те же четыре беды чужих
// моделей, что описаны в port-skins.mjs и port-claw.mjs:
//
//  1. ИМЯ. И путь, и внутреннее имя в заголовке — наши. У клиента модели лежат
//     по имени, и пока имя чужое, он покажет ту, что скачал с другого сервера,
//     а нашу качать не станет.
//  2. МЕТКИ ДОНОРА в именах костей и подмоделей — затираем байт в байт.
//  3. ДЛИНА В ЗАГОЛОВКЕ, если она разошлась с размером файла.
//  4. ТОЧКИ КРЕПЛЕНИЯ: движок терпит четыре, на пятой печатает
//     «Too many attachments» и зовёт exit(-1) — игра закрывается у всех, кто
//     увидел такую модель.
//
// ⚠️ ЛАПА ДЬЯВОЛА ЗДЕСЬ НЕ ТРОГАЕТСЯ. Её владелец выбрал отдельно (китайский
// дао из пака Толстяка, tools/port-claw.mjs) — переносить поверх чужую нельзя.
//
// ⚠️ ВЫЖИВШЕМУ И СНАЙПЕРУ РУКИ НЕ НУЖНЫ ОТДЕЛЬНО: у них в руках пулемёт и
// винтовка, и «руки» — это вид оружия от первого лица. Берём уже лежащие в
// сборке стволы (v_mk48, v_trg42): они пришли с плагинами оружия, уже в
// раздаче и уже загружены в память сервера — новых файлов ноль.
//
// Запуск: node tools/port-bosses.mjs [--dry]

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renameModel } from './mdl-rename.mjs'
import { scrubNames, untag } from './mdl-untag.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_PLAYER = join(ROOT, 'custom', 'content', 'models', 'player')
const OUT_CLAW = join(ROOT, 'custom', 'content', 'models', 'zombie_plague_v44')

const JP = join(ROOT, 'quarantine', 'justpro-zombie', 'extracted',
  'NEW BALANCE', 'Компелировання', 'models')

// Кого во что. Имена свои и говорящие: «boss» в имени видно и в списке закачки
// у игрока, и в конфиге мода — сразу понятно, что это не рядовой скин и
// продавать его в магазине нельзя.
//
// ⚠️ У ВСЕХ ЧЕТЫРЁХ ПО 111 АНИМАЦИЙ — это проверено до переноса и это главное
// требование к модели игрока: набор поз у CS 1.6 жёсткий, и модель с 95
// анимациями (так отсеялся human_wolf_jp_v2) ломает часть движений.
const BOSSES = [
  {
    from: 'zombie_nemesis_jp', to: 'zm_hot_boss_nemesis',
    why: 'Дьявол — у донора эта модель и звалась Немезидой',
  },
  {
    from: 'zombie_skeleton_jp', to: 'zm_hot_boss_assassin',
    why: 'Убийца — скелет: быстрый, тощий, ни на кого не похож',
  },
  {
    from: 'human_survivor_jp', to: 'zm_hot_boss_survivor',
    why: 'Выживший — броня и снаряжение, видно издалека',
  },
  {
    from: 'human_sniper_jp', to: 'zm_hot_boss_sniper',
    why: 'Снайпер — маскировочный костюм',
  },
]

// Лапа Убийцы. У донора к каждому зомби идёт своя рука, но у скелета своей нет
// — берём «призрачную»: костлявая кисть, к скелету подходит лучше прочих.
// Проверено до переноса: одна текстура, восемь анимаций (это полный набор для
// лапы), рекламы на текстурах нет.
const CLAWS = [
  { from: join(JP, 'zombie_plague', 'v_hand_ghost_jp.mdl'), to: 'v_zm_hot_assassin.mdl' },
]

const NAME_AT = 8
const NAME_SIZE = 64
const LENGTH_AT = 72
const NUMATTACH_AT = 212
const MAX_ATTACH = 4
const SEQ_ANIM_EXPECTED = 111

const dry = process.argv.includes('--dry')

// Правки, которые делаются прямо в байтах: длина в заголовке и лишние точки
// крепления. Возвращает список того, что пришлось починить.
function repair(path) {
  const buf = readFileSync(path)
  const fixed = []

  if (buf.readUInt32LE(0) !== 0x54534449) return ['НЕ МОДЕЛЬ GoldSrc']

  const declared = buf.readInt32LE(LENGTH_AT)
  if (declared !== buf.length) {
    buf.writeInt32LE(buf.length, LENGTH_AT)
    fixed.push(`длина ${declared} -> ${buf.length}`)
  }

  const attach = buf.readInt32LE(NUMATTACH_AT)
  if (attach > MAX_ATTACH) {
    buf.writeInt32LE(MAX_ATTACH, NUMATTACH_AT)
    fixed.push(`точек крепления ${attach} -> ${MAX_ATTACH}`)
  }

  if (fixed.length) writeFileSync(path, buf)
  return fixed
}

function animCount(path) {
  const buf = readFileSync(path)
  return buf.readInt32LE(164)
}

let done = 0
let bytes = 0
const problems = []

for (const boss of BOSSES) {
  const src = join(JP, 'player', boss.from, `${boss.from}.mdl`)
  if (!existsSync(src)) { problems.push(`нет исходника ${src}`); continue }

  const anims = animCount(src)
  if (anims !== SEQ_ANIM_EXPECTED) {
    // Не молча пропускаем: модель с неполным набором поз выглядит сломанной
    // именно в бою — в тех позах, которых у неё нет.
    problems.push(`${boss.from}: анимаций ${anims}, а нужно ${SEQ_ANIM_EXPECTED} — не берём`)
    continue
  }

  console.log(`+ ${boss.from} -> ${boss.to}  (${boss.why})`)
  if (dry) { done++; continue }

  const dir = join(OUT_PLAYER, boss.to)
  mkdirSync(dir, { recursive: true })

  // Рядом с моделью может лежать файл текстур с суффиксом T — он есть не у
  // всех, и его отсутствие не поломка.
  for (const suffix of ['', 'T']) {
    const from = join(JP, 'player', boss.from, `${boss.from}${suffix}.mdl`)
    if (!existsSync(from)) continue

    const to = join(dir, `${boss.to}${suffix}.mdl`)
    copyFileSync(from, to)
    bytes += statSync(to).size

    const marks = scrubNames(to)
    const ads = untag(to, boss.from)
    const fixed = repair(to)
    // Внутреннее имя пишем ПОСЛЕДНИМ: затирание меток прошлось бы по нему.
    renameModel(to, `${boss.to}${suffix}.mdl`)

    console.log(`    ${boss.to}${suffix}.mdl  ${(statSync(to).size / 1048576).toFixed(2)} МБ`
      + (marks ? `, меток затёрто ${marks}` : '')
      + (ads ? `, закрашено: ${ads.join('; ')}` : '')
      + (fixed.length ? `, починено: ${fixed.join(', ')}` : ''))
  }
  done++
}

for (const claw of CLAWS) {
  if (!existsSync(claw.from)) { problems.push(`нет исходника ${claw.from}`); continue }

  console.log(`+ лапа ${claw.to}`)
  if (dry) { done++; continue }

  mkdirSync(OUT_CLAW, { recursive: true })
  const to = join(OUT_CLAW, claw.to)
  copyFileSync(claw.from, to)
  bytes += statSync(to).size

  const marks = scrubNames(to)
  const fixed = repair(to)
  renameModel(to, claw.to)

  console.log(`    ${claw.to}  ${(statSync(to).size / 1048576).toFixed(2)} МБ`
    + (marks ? `, меток затёрто ${marks}` : '')
    + (fixed.length ? `, починено: ${fixed.join(', ')}` : ''))
  done++
}

console.log(dry
  ? `\nпроверка: перенеслось бы ${done} моделей`
  : `\nперенесено моделей: ${done}, ${(bytes / 1048576).toFixed(1)} МБ`)

if (problems.length) {
  console.log(`\n! не перенесено (${problems.length}):`)
  for (const p of problems) console.log(`    ${p}`)
  process.exit(1)
}
