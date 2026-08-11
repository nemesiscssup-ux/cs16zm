// Снимает у текстур моделей игроков флаг «с прозрачностью» (STUDIO_NF_MASKED).
//
// ЗАЧЕМ. Владелец: «новые скины и часть классов зомби не видно от третьего
// лица, модель показывается только при смерти». Причина найдена измерением на
// живом клиенте: в CS 1.6 ЖИВОЙ игрок не рисуется, если его скин помечен этим
// флагом. Совпадение стопроцентное на 13 проверенных моделях:
//
//   рисуются  — spec, monolit, hero, doctor, mask, z_witch, z_heavy,
//               z_electric, z_sprinter, z_siren, z_deimos, z_zaraza
//               (у всех главная текстура БЕЗ флага)
//   не видно  — leto, sporty, zima, frak, zvezda, zmeya, paladin, knight,
//               z_shaman, z_student
//               (у всех главная текстура С флагом)
//
// Труп при этом рисуется — он идёт другим путём отрисовки, поэтому со стороны
// это выглядит как «модель появляется только когда умрёшь».
//
// ⚠️ Мои правки тут ни при чём: сырая, ничем не тронутая донорская модель
// «Паладин» ведёт себя точно так же. Флаг ставят авторы конвертов из CSO, где
// у него другой смысл.
//
// ⚠️ ТРОГАЕМ ТОЛЬКО ТЕКСТУРУ №0 — она же шкура тела. Правило выведено из
// измерений, а не угадано: помечен ноль — тела не видно, помечены только
// остальные — модель цела. У «Мечника» помечены пряди волос (вырезают 30%
// точек), у Ведьмы и Толстяка — накидка; их не трогаем, иначе на месте
// прозрачных краёв встанут чёрные пятна.
//
// ЧТО ТЕРЯЕМ на теле. Флаг вырезает точки палитры с номером 255. На шкурах тела
// их 0.0–6.5% (считается и печатается ниже) — кромки ремешков. Потерять их
// куда дешевле, чем всю модель.
//
// Запуск:
//   node tools/mdl-unmask.mjs                 — вычистить custom/content/models/player
//   node tools/mdl-unmask.mjs --dry           — только показать
//   node tools/mdl-unmask.mjs --all           — снять флаг со ВСЕХ текстур
//   node tools/mdl-unmask.mjs --dir <путь>    — другой каталог

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const dry = argv.includes('--dry')
const all = argv.includes('--all')
const dirArg = argv.indexOf('--dir')
const DIR = dirArg >= 0 ? resolve(argv[dirArg + 1]) : join(ROOT, 'custom', 'content', 'models', 'player')

const MASKED = 0x40
const TEX_SIZE = 80
const NAME_LEN = 64

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (n.toLowerCase().endsWith('.mdl')) out.push(p)
  }
  return out
}

let touched = 0
let cleared = 0

for (const p of walk(DIR)) {
  const b = readFileSync(p)
  if (b.length < 244 || b.readUInt32LE(0) !== 0x54534449) continue   // не IDST

  const nt = b.readInt32LE(180)
  const ti = b.readInt32LE(184)
  if (nt <= 0 || ti <= 0 || ti + nt * TEX_SIZE > b.length) continue  // текстуры лежат в T-файле

  const hits = []
  const kept = []
  for (let i = 0; i < nt; i++) {
    const o = ti + i * TEX_SIZE
    const flags = b.readInt32LE(o + NAME_LEN)
    if (!(flags & MASKED)) continue
    if (i !== 0 && !all) {
      kept.push(`${b.toString('latin1', o, o + NAME_LEN).replace(/\0.*/s, '')} (№${i})`)
      continue
    }

    const name = b.toString('latin1', o, o + NAME_LEN).replace(/\0.*/s, '')
    const w = b.readInt32LE(o + 68)
    const h = b.readInt32LE(o + 72)
    const idx = b.readInt32LE(o + 76)

    // Сколько точек реально вырезал бы флаг — чтобы было видно цену правки.
    let holes = 0
    if (idx > 0 && idx + w * h <= b.length) {
      for (let q = 0; q < w * h; q++) if (b[idx + q] === 255) holes++
    }

    b.writeInt32LE(flags & ~MASKED, o + NAME_LEN)
    hits.push(`${name} (вырезалось ${(holes / (w * h) * 100).toFixed(1)}%)`)
    cleared++
  }

  if (!hits.length) {
    if (kept.length) console.log(`  ${relative(ROOT, p)}: оставлены помеченными ${kept.join(', ')} — это не тело`)
    continue
  }
  if (!dry) writeFileSync(p, b)
  touched++
  console.log(`+ ${relative(ROOT, p)}: снят флаг у ${hits.length} — ${hits.join(', ')}`
    + (kept.length ? `; оставлены ${kept.join(', ')}` : ''))
}

console.log(dry
  ? `\nпроверка: флаг снялся бы у ${cleared} текстур в ${touched} моделях`
  : `\nснят флаг у ${cleared} текстур в ${touched} моделях`)
