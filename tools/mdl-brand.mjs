// Наносит на модель GoldSrc свою надпись — адрес сервера вместо чужой рекламы.
//
// ЗАЧЕМ. С подарочных форм убрана реклама донора (tools/mdl-untag.mjs и
// tools/mdl-cut.mjs). Место освободилось, и владелец попросил поставить туда
// своё. Рисуем прямо в текстуру: своих букв-геометрии, как у донора, делать не
// надо — их нельзя ни подвинуть, ни убрать потом.
//
// КАК УСТРОЕНО. Пиксели текстуры — байтовые индексы в палитре, поэтому «цвет»
// выбирается не свободно: ищем в палитре ближайший к нужному. Отсюда два
// следствия, которые стоит знать заранее:
//   * белый на зелёной форме получится чуть зеленоватым — других белых в
//     палитре может просто не быть;
//   * тень под буквами обязательна. На пёстрой ткани (гавайская рубашка)
//     светлые буквы без тени сливаются с рисунком и читаются как грязь.
//
// Размер файла не меняется: правятся только индексы пикселей.
//
// Шрифт свой, 5×7 — на текстуре 512×512 буква высотой семь точек занимает на
// груди примерно столько же, сколько занимала чужая надпись. Брать готовый
// шрифт неоткуда: рисовать надо в индексы палитры, а не в картинку.
//
// Запуск:
//   node tools/mdl-brand.mjs <файл.mdl> --known
//   node tools/mdl-brand.mjs <файл.mdl> <тек> <x> <y> <масштаб> <текст>

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

// ── шрифт 5×7, только то, что нужно для адреса ──────────────────────────────

const FONT = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
}

const GLYPH_W = 5
const GLYPH_H = 7
const SPACING = 1

/** Ширина надписи в точках текстуры при заданном масштабе. */
export function textWidth(text, scale) {
  return (text.length * (GLYPH_W + SPACING) - SPACING) * scale
}

// ── палитра ─────────────────────────────────────────────────────────────────

/**
 * Ближайший к нужному цвету индекс палитры.
 *
 * ⚠️ Индекс 255 пропускаем: в моделях с маской он означает «прозрачно», и
 * попади буква в него — на её месте будет дыра насквозь.
 */
function nearest(buf, pal, rgb) {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < 255; i++) {
    const dr = buf[pal + i * 3] - rgb[0]
    const dg = buf[pal + i * 3 + 1] - rgb[1]
    const db = buf[pal + i * 3 + 2] - rgb[2]
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

// ── нанесение ───────────────────────────────────────────────────────────────

/**
 * $job: { tex, x, y, scale, text, colour, shadow }
 * colour/shadow — [r,g,b]; shadow можно отключить, передав null.
 */
export function brand(file, jobs) {
  const buf = readFileSync(file)
  if (buf.length < 244 || buf.readUInt32LE(0) !== 0x54534449) return null

  const numTex = buf.readInt32LE(180)
  const texAt = buf.readInt32LE(184)
  const done = []

  for (const job of jobs) {
    if (job.tex >= numTex) continue
    const at = texAt + job.tex * 80
    const w = buf.readInt32LE(at + 68)
    const h = buf.readInt32LE(at + 72)
    const data = buf.readInt32LE(at + 76)
    if (w <= 0 || h <= 0 || data <= 0) continue
    const pal = data + w * h

    const scale = job.scale || 1
    const text = String(job.text).toUpperCase()
    const width = textWidth(text, scale)
    if (job.x < 0 || job.y < 0 || job.x + width > w || job.y + GLYPH_H * scale + scale > h) {
      console.log(`! ${basename(file)}: надпись «${text}» не влезает в текстуру ${job.tex} (${w}x${h})`)
      continue
    }

    const ink = nearest(buf, pal, job.colour || [245, 245, 245])
    const shade = job.shadow === null ? null : nearest(buf, pal, job.shadow || [20, 20, 20])

    const put = (px, py, idx) => {
      if (px < 0 || py < 0 || px >= w || py >= h) return
      buf[data + py * w + px] = idx
    }

    // Сначала тень целиком, потом буквы: иначе тень соседней буквы ложится
    // поверх уже нарисованной предыдущей и объедает её справа.
    for (const pass of shade === null ? ['ink'] : ['shadow', 'ink']) {
      const idx = pass === 'ink' ? ink : shade
      const off = pass === 'ink' ? 0 : scale
      let cx = job.x
      for (const ch of text) {
        const glyph = FONT[ch]
        if (!glyph) { cx += (GLYPH_W + SPACING) * scale; continue }
        for (let gy = 0; gy < GLYPH_H; gy++) {
          for (let gx = 0; gx < GLYPH_W; gx++) {
            if (glyph[gy][gx] !== '1') continue
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                put(cx + gx * scale + sx + off, job.y + gy * scale + sy + off, idx)
              }
            }
          }
        }
        cx += (GLYPH_W + SPACING) * scale
      }
    }

    done.push(`«${text}» на текстуре ${job.tex} в (${job.x},${job.y}), ширина ${width}`)
  }

  if (!done.length) return null
  writeFileSync(file, buf)
  return done
}

// ── куда наносим на наших формах ────────────────────────────────────────────
//
// Места выбраны не наугад: это ровно те участки, где чужую рекламу видел
// владелец, — значит они точно попадают на видную часть модели. Проверено
// рисунком (tools/mdl-render.mjs) с четырёх ракурсов.

export const BRANDS = [
  {
    model: 'zm_hot_form_vip',
    // Грудь под воротником, там же, где был чужой герб.
    jobs: [{ tex: 0, x: 148, y: 52, scale: 1, text: 'hotcs.ru',
             colour: [250, 250, 250], shadow: [12, 60, 12] }],
  },
  {
    model: 'zm_hot_form9',
    jobs: [{ tex: 0, x: 147, y: 40, scale: 1, text: 'hotcs.ru',
             colour: [250, 250, 250], shadow: [70, 10, 10] }],
  },
  {
    model: 'zm_hot_otpusk',
    // У «Отпускника» надпись на СПИНЕ рубашки. Грудь не годится: майку под
    // рубашкой развёртка отражает — половинки берут одни и те же точки, и
    // надпись выходит дважды, вторая зеркально. Спина — отдельный кусок.
    // Белым с тёмной тенью: рубашка пёстрая, и одноцветная надпись на ней
    // теряется среди цветов.
    jobs: [{ tex: 0, x: 152, y: 300, scale: 1, text: 'hotcs.ru',
             colour: [252, 252, 252], shadow: [8, 16, 34] }],
  },
]

if (process.argv[1] && process.argv[1].endsWith('mdl-brand.mjs')) {
  const file = process.argv[2]
  if (!file) {
    console.error('использование: node tools/mdl-brand.mjs <файл.mdl> [--known | <тек> <x> <y> <масштаб> <текст>]')
    process.exit(2)
  }

  let jobs
  if (process.argv.includes('--known')) {
    const name = basename(file, '.mdl').toLowerCase()
    const found = BRANDS.find(b => b.model.toLowerCase() === name)
    if (!found) {
      console.log(`${basename(file)}: места для надписи не задано`)
      process.exit(0)
    }
    jobs = found.jobs
  } else {
    const [, , , tex, x, y, scale, ...rest] = process.argv
    jobs = [{ tex: +tex, x: +x, y: +y, scale: +scale || 1, text: rest.join(' ') }]
  }

  const done = brand(file, jobs)
  console.log(done ? `${basename(file)}: нанесено — ${done.join('; ')}`
    : `${basename(file)}: наносить нечего`)
}
