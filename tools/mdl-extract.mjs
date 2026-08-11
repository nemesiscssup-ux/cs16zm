// Вырезает ОДНУ подмодель из «пака скинов» в отдельную модель.
//
// ЗАЧЕМ. Половина хороших скинов в скачанных сборках лежит не отдельными
// файлами, а паками: один .mdl на 13 МБ, внутри 37 подмоделей, между которыми
// сервер переключается полем pev_body. Нам такой пак не годится: тащить 13 МБ
// ради одного облика расточительно, а поле тела у игрока мод сбрасывает. Так и
// нашёлся «Фараон» — золотой череп в немесе, подмодель 5 пака z7p_Males8_6.
//
// ЧТО ДЕЛАЕТ. Оставляет в части тела ровно одну подмодель и выкидывает ЧУЖИЕ
// ТЕКСТУРЫ — они и весят почти всё (9.4 МБ из 13.2). Геометрию соседей не
// трогаем: она адресуется своими смещениями, и вырезать её значит пересобирать
// весь файл. Итог получается вчетверо легче исходника, и этого достаточно.
//
// КАК УСТРОЕНО ВНУТРИ (пригодится, если придётся чинить):
//   часть тела   mstudiobodyparts_t — 76 Б: имя[64], подмоделей, base, смещение
//   подмодель    mstudiomodel_t     — 112 Б: имя[64], тип, радиус, сеток,
//                                     смещение сеток, вершин, ...
//   сетка        mstudiomesh_t      — 20 Б: треугольников, смещение, НОМЕР
//                                     ШКУРЫ, нормалей, смещение нормалей
//   «номер шкуры» — это не номер текстуры, а место в таблице подстановки
//   (skinindex): она позволяет одной модели иметь несколько наборов текстур.
//   Мы схлопываем её в единичную: новая таблица — просто 0,1,2,...
//
// Запуск:
//   node tools/mdl-extract.mjs <пак.mdl> <часть> <подмодель> <куда.mdl> [--name имя]
//   node tools/mdl-extract.mjs <пак.mdl> --list        — что внутри

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const H = {
  name: 8, length: 72,
  numtextures: 180, textureindex: 184, texturedataindex: 188,
  numskinref: 192, numskinfamilies: 196, skinindex: 200,
  numbodyparts: 204, bodypartindex: 208,
}
const BODYPART = 76, MODEL = 112, MESH = 20, TEX = 80

const argv = process.argv.slice(2)
if (argv.length < 2) {
  console.error('использование: node tools/mdl-extract.mjs <пак.mdl> <часть> <подмодель> <куда.mdl> [--name имя]')
  console.error('               node tools/mdl-extract.mjs <пак.mdl> --list')
  process.exit(2)
}

const src = argv[0]
const buf = readFileSync(src)
if (buf.readUInt32LE(0) !== 0x54534449) {
  console.error(`${src}: это не модель GoldSrc`)
  process.exit(2)
}

const numtex = buf.readInt32LE(H.numtextures)
const texindex = buf.readInt32LE(H.textureindex)
const numskinref = buf.readInt32LE(H.numskinref)
const skinindex = buf.readInt32LE(H.skinindex)
const nbp = buf.readInt32LE(H.numbodyparts)
const bpi = buf.readInt32LE(H.bodypartindex)

const texName = i => buf.toString('latin1', texindex + i * TEX, texindex + i * TEX + 64).replace(/\0.*/s, '')
const skinTable = []
for (let i = 0; i < numskinref; i++) skinTable.push(buf.readInt16LE(skinindex + i * 2))

// Все сетки модели: пригодится и для списка, и для правки номеров шкур.
function meshesOf(modelOff) {
  const out = []
  const nmesh = buf.readInt32LE(modelOff + 72)
  const meshindex = buf.readInt32LE(modelOff + 76)
  for (let k = 0; k < nmesh; k++) out.push(meshindex + k * MESH)
  return out
}

if (argv.includes('--list')) {
  console.log(`${basename(src)}: ${(buf.length / 1048576).toFixed(1)} МБ, частей ${nbp}, текстур ${numtex}`)
  for (let i = 0; i < nbp; i++) {
    const bp = bpi + i * BODYPART
    const nmodels = buf.readInt32LE(bp + 64)
    const mi = buf.readInt32LE(bp + 72)
    for (let j = 0; j < nmodels; j++) {
      const m = mi + j * MODEL
      const nm = buf.toString('latin1', m, m + 64).replace(/\0.*/s, '')
      const used = [...new Set(meshesOf(m).map(o => texName(skinTable[buf.readInt32LE(o + 8)] ?? 0)))]
      console.log(`  часть ${i} подмодель ${String(j).padStart(2)} «${nm}» — ${used.join(', ')}`)
    }
  }
  process.exit(0)
}

const bpIdx = parseInt(argv[1])
const subIdx = parseInt(argv[2])
const dst = argv[3]
const nameArg = argv.indexOf('--name')
const outName = nameArg >= 0 ? argv[nameArg + 1] : basename(dst)

if (!Number.isInteger(bpIdx) || !Number.isInteger(subIdx) || !dst) {
  console.error('нужны номер части, номер подмодели и путь куда сохранить')
  process.exit(2)
}
if (bpIdx < 0 || bpIdx >= nbp) { console.error(`частей всего ${nbp}`); process.exit(2) }

const bp = bpi + bpIdx * BODYPART
const nmodels = buf.readInt32LE(bp + 64)
const mi = buf.readInt32LE(bp + 72)
if (subIdx < 0 || subIdx >= nmodels) { console.error(`подмоделей в части ${nmodels}`); process.exit(2) }

const target = mi + subIdx * MODEL
const keptName = buf.toString('latin1', target, target + 64).replace(/\0.*/s, '')

// 1. Какие текстуры нужны нашей подмодели.
const meshes = meshesOf(target)
const oldTex = []
for (const o of meshes) {
  const t = skinTable[buf.readInt32LE(o + 8)] ?? 0
  if (!oldTex.includes(t)) oldTex.push(t)
}

// 2. Правим номера шкур: у нашей — на новые места, у чужих — в ноль, чтобы
//    ничей номер не указывал в никуда, даже если рисовать их не будут.
for (let i = 0; i < nbp; i++) {
  const b = bpi + i * BODYPART
  const n = buf.readInt32LE(b + 64)
  const base = buf.readInt32LE(b + 72)
  for (let j = 0; j < n; j++) {
    const m = base + j * MODEL
    for (const o of meshesOf(m)) {
      if (m === target) {
        const t = skinTable[buf.readInt32LE(o + 8)] ?? 0
        buf.writeInt32LE(oldTex.indexOf(t), o + 8)
      } else {
        buf.writeInt32LE(0, o + 8)
      }
    }
  }
}

// 3. В части тела оставляем одну подмодель — нашу.
buf.writeInt32LE(1, bp + 64)
buf.writeInt32LE(target, bp + 72)
buf.writeInt32LE(1, bp + 68)      // base: при одной подмодели он всегда 1

// 4. Собираем хвост заново: таблица подстановки, таблица текстур, пиксели.
const cut = Math.min(texindex, skinindex, buf.readInt32LE(H.texturedataindex))
const head = Buffer.from(buf.subarray(0, cut))

const newSkin = Buffer.alloc(oldTex.length * 2)
for (let i = 0; i < oldTex.length; i++) newSkin.writeInt16LE(i, i * 2)

const newTexTable = Buffer.alloc(oldTex.length * TEX)
const pixels = []
let cursor = cut + newSkin.length + newTexTable.length
for (let i = 0; i < oldTex.length; i++) {
  const o = texindex + oldTex[i] * TEX
  buf.copy(newTexTable, i * TEX, o, o + TEX)
  const w = buf.readInt32LE(o + 68)
  const h = buf.readInt32LE(o + 72)
  const from = buf.readInt32LE(o + 76)
  const size = w * h + 768
  newTexTable.writeInt32LE(cursor, i * TEX + 76)
  pixels.push(Buffer.from(buf.subarray(from, from + size)))
  cursor += size
}

const out = Buffer.concat([head, newSkin, newTexTable, ...pixels])

out.writeInt32LE(oldTex.length, H.numtextures)
out.writeInt32LE(cut + newSkin.length, H.textureindex)
out.writeInt32LE(cut + newSkin.length + newTexTable.length, H.texturedataindex)
out.writeInt32LE(oldTex.length, H.numskinref)
out.writeInt32LE(1, H.numskinfamilies)
out.writeInt32LE(cut, H.skinindex)
out.writeInt32LE(out.length, H.length)

// ⚠️ Подписи донора живут не только на текстурах. У пака часть тела называлась
// «Reega! KOREA», и эта строка уезжала в нашу модель — её ловит verify-ru.
// Затираем на месте, байт в байт: сместить хоть один байт нельзя.
const MARKS = [
  'by_reega_zm7up', 'model_by_reega_zm7up', 'LARS-DAY[BR]EAKER',
  'Bereke_of_the_zm7up', 'Reega!KAZAKHSTAN', 'Reega! KOREA', 'reega_zm7up',
  'vk.com/zm7up', 'ZM7UP.RU', 'Reega!', 'ZM7UP', 'zm7uP', 'zm7up', 'REEGA', 'Reega',
].sort((a, b) => b.length - a.length)

let scrubbed = 0
for (const mark of MARKS) {
  const needle = Buffer.from(mark, 'latin1')
  let from = 0
  for (;;) {
    const at = out.indexOf(needle, from)
    if (at < 0) break
    out.fill(0x5f, at, at + needle.length)
    scrubbed++
    from = at + needle.length
  }
}

out.fill(0, H.name, H.name + 64)
out.write(outName, H.name, 'latin1')

writeFileSync(dst, out)

console.log(`+ ${dst}`)
console.log(`  из «${basename(src)}», часть ${bpIdx} подмодель ${subIdx} «${keptName}»`)
console.log(`  текстур ${numtex} -> ${oldTex.length}: ${oldTex.map(texName).join(', ')}`)
console.log(`  меток донора затёрто: ${scrubbed}`)
console.log(`  размер ${(buf.length / 1048576).toFixed(1)} -> ${(out.length / 1048576).toFixed(1)} МБ`)
