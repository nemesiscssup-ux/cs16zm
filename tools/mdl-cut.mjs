// Вырезает из модели GoldSrc геометрию-наклейку — надпись, сделанную не
// рисунком на ткани, а отдельными плоскостями поверх неё.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ИНСТРУМЕНТ. tools/mdl-untag.mjs закрашивает ТЕКСТУРУ, и для
// надписи, нарисованной на одежде, этого достаточно. Но на «Отпускнике» и
// «Лидере» буквы «ZM7UP.RU» и «vk.com/zm7up» — это ГЕОМЕТРИЯ: отдельные
// плоскости перед грудью, которым текстура лишь красит поверхность. Закрасить
// их можно, убрать — нет: буквы остаются на месте, меняется только цвет, и под
// освещением они видны по-прежнему. (Проверено дважды: сначала я решил, что
// закраска сработала, потому что мой растеризатор рисует без света и плоские
// буквы в нём исчезают. На сайте свет есть — и они там были.)
//
// ЧТО ДЕЛАЕТ. Находит вершины, которые используются ТОЛЬКО треугольниками с
// развёрткой внутри указанной области, и сводит их в одну точку. Треугольник с
// тремя совпавшими вершинами имеет нулевую площадь — рисовальщик его
// пропускает. Ни одного байта не добавляется и не убирается: правятся только
// координаты, поэтому смещения внутри файла остаются верными.
//
// ⚠️ ВЕРШИНЫ, ОБЩИЕ С ОСТАЛЬНОЙ МОДЕЛЬЮ, НЕ ТРОГАЮТСЯ. Иначе вместе с буквой
// схлопнулся бы кусок тела. Если такие нашлись, инструмент говорит об этом
// вслух: значит наклейка сшита с моделью и резать её надо иначе.
//
// Запуск:
//   node tools/mdl-cut.mjs <файл.mdl> <номер текстуры> <x> <y> <ширина> <высота>
//   node tools/mdl-cut.mjs <файл.mdl> --known      применить известные вырезки

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

// Известные наклейки: имя модели → что и откуда вырезать.
// Область задаётся в точках развёртки той же текстуры, что и в mdl-untag.
export const DECALS = [
  {
    model: 'zm_hot_otpusk',
    what: 'буквы «ZM7UP.RU» поперёк груди',
    tex: 0,
    rect: { x: 108, y: 166, w: 42, h: 42 },
  },
  {
    model: 'zm_hot_form9',
    what: 'буквы «vk.com/zm7up» поперёк груди',
    tex: 1,
    // ⚠️ ШИРИНА 84, А НЕ 42. Надпись берёт цвет ДВУМЯ кусками развёртки:
    // «zm7up» из x 228..270, а «vk.com/» из x 198..229. Первый раз я замерил
    // по хвосту и отрезал ровно половину — на прямом ракурсе остаток прятался
    // за надувным кругом и казался убранным, а стоило повернуть модель, как
    // «vk.com/» проявилось. Мерить надо по ПОВЁРНУТОЙ модели, а не по той,
    // что смотрит в камеру.
    rect: { x: 190, y: 452, w: 84, h: 50 },
  },
]

const HDR = {
  numtextures: 180, textureindex: 184,
  numskinref: 192, numskinfamilies: 196, skinindex: 200,
  numbodyparts: 204, bodypartindex: 208,
}

function skinTable(buf) {
  const nref = buf.readInt32LE(HDR.numskinref)
  const fams = buf.readInt32LE(HDR.numskinfamilies)
  const at = buf.readInt32LE(HDR.skinindex)
  if (nref <= 0 || fams <= 0) return null
  const t = []
  for (let i = 0; i < nref; i++) t.push(buf.readInt16LE(at + i * 2))
  return t
}

/**
 * Схлопнуть буквы. Возвращает отчёт либо null, если резать было нечего.
 */
export function cut(file, jobs) {
  const buf = readFileSync(file)
  if (buf.length < 244 || buf.readUInt32LE(0) !== 0x54534449) return null

  const skins = skinTable(buf)
  const numBody = buf.readInt32LE(HDR.numbodyparts)
  const bodyAt = buf.readInt32LE(HDR.bodypartindex)

  let collapsed = 0
  let shared = 0
  const touched = []

  for (const job of jobs) {
    const { x, y, w, h } = job.rect
    const inside = (s, t) => s >= x && s < x + w && t >= y && t < y + h

    for (let b = 0; b < numBody; b++) {
      const at = bodyAt + b * 76
      const nummodels = buf.readInt32LE(at + 64)
      const modelindex = buf.readInt32LE(at + 72)

      // Все подмодели, а не только первую: вырезать надо везде, где надпись
      // есть, иначе она вернётся при другом наборе тела.
      for (let sm = 0; sm < nummodels; sm++) {
        const m = modelindex + sm * 112
        const nummesh = buf.readInt32LE(m + 72)
        const meshindex = buf.readInt32LE(m + 76)
        const numverts = buf.readInt32LE(m + 80)
        const vertindex = buf.readInt32LE(m + 88)
        if (nummesh <= 0 || numverts <= 0) continue

        const inRect = new Set()
        const outside = new Set()

        for (let k = 0; k < nummesh; k++) {
          const mesh = meshindex + k * 20
          const triindex = buf.readInt32LE(mesh + 4)
          const skinref = buf.readInt32LE(mesh + 8)
          const tex = skins && skins[skinref] !== undefined ? skins[skinref] : skinref
          const target = tex === job.tex

          let p = triindex
          for (;;) {
            if (p + 2 > buf.length) break
            const cmd = buf.readInt16LE(p)
            p += 2
            if (cmd === 0) break
            const count = Math.abs(cmd)
            for (let i = 0; i < count; i++) {
              if (p + 8 > buf.length) break
              const vi = buf.readUInt16LE(p)
              const s = buf.readInt16LE(p + 4)
              const t = buf.readInt16LE(p + 6)
              p += 8
              if (target && inside(s, t)) inRect.add(vi)
              else outside.add(vi)
            }
          }
        }

        if (!inRect.size) continue

        // Только «свои» вершины: общие с остальной моделью не трогаем.
        const mine = [...inRect].filter(vi => !outside.has(vi))
        shared += inRect.size - mine.length
        if (mine.length < 3) continue

        // Сводим в первую же из них — треугольники становятся нулевыми.
        const anchor = mine[0]
        const ax = buf.readFloatLE(vertindex + anchor * 12)
        const ay = buf.readFloatLE(vertindex + anchor * 12 + 4)
        const az = buf.readFloatLE(vertindex + anchor * 12 + 8)
        for (const vi of mine) {
          buf.writeFloatLE(ax, vertindex + vi * 12)
          buf.writeFloatLE(ay, vertindex + vi * 12 + 4)
          buf.writeFloatLE(az, vertindex + vi * 12 + 8)
        }
        collapsed += mine.length
        touched.push(job.what)
      }
    }
  }

  if (!collapsed) return null
  writeFileSync(file, buf)
  return { collapsed, shared, what: [...new Set(touched)] }
}

// ── запуск из командной строки ──────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('mdl-cut.mjs')) {
  const file = process.argv[2]
  if (!file) {
    console.error('использование: node tools/mdl-cut.mjs <файл.mdl> [--known | <тек> <x> <y> <ш> <в>]')
    process.exit(2)
  }

  let jobs
  if (process.argv.includes('--known')) {
    const name = basename(file, '.mdl').toLowerCase()
    jobs = DECALS.filter(d => d.model.toLowerCase() === name)
    if (!jobs.length) {
      console.log(`${basename(file)}: известных наклеек нет`)
      process.exit(0)
    }
  } else {
    const [, , , tex, x, y, w, h] = process.argv
    jobs = [{ what: 'область вручную', tex: +tex, rect: { x: +x, y: +y, w: +w, h: +h } }]
  }

  const done = cut(file, jobs)
  if (!done) {
    console.log(`${basename(file)}: резать нечего`)
  } else {
    console.log(`${basename(file)}: вырезано — ${done.what.join('; ')}`
      + `, вершин схлопнуто ${done.collapsed}`
      + (done.shared ? `, ОБЩИХ С МОДЕЛЬЮ пропущено ${done.shared}` : ''))
  }
}
