// Сводный лист текстур модели: все её текстуры на одной картинке.
//
// Зачем: реклама донора рисуется прямо в текстуре, и найти её можно только
// глазами. У модели их бывает под сорок, разглядывать по одной — верный способ
// пропустить надпись, что уже и случилось с Таносом. Лист показывает всё разом.
//
// Заодно печатает подозрительные строки из самого файла: имена текстур часто
// содержат адрес сервера-донора («:REEGA:ZM7UP.RU::.bmp»), и это видно без
// картинок вообще.
//
// Запуск: node tools/mdl-contact.mjs <файл.mdl> <куда.png> [размер клетки]

import { deflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const [, , file, out, cellArg] = process.argv
if (!file || !out) {
  console.error('использование: node tools/mdl-contact.mjs <файл.mdl> <куда.png> [размер клетки]')
  process.exit(2)
}

const CELL = Number(cellArg) || 288
const buf = readFileSync(file)
if (buf.length < 244 || buf.readUInt32LE(0) !== 0x54534449) {
  console.error(`${file}: это не модель GoldSrc`)
  process.exit(1)
}

const numTextures = buf.readInt32LE(180)
const textureIndex = buf.readInt32LE(184)

// Приметы чужой рекламы в тексте файла: адреса и подписи авторов.
const SUSPECT = /([a-z0-9][a-z0-9-]{2,}\.(ru|com|net|org|su|ua|kz))|(\bby\s+[a-z]{3,})/i

const tiles = []
const names = []
const flagged = []

for (let i = 0; i < numTextures; i++) {
  const at = textureIndex + i * 80
  if (at + 80 > buf.length) break

  const name = buf.toString('latin1', at, at + 64).split('\0')[0]
  const width = buf.readInt32LE(at + 68)
  const height = buf.readInt32LE(at + 72)
  const dataAt = buf.readInt32LE(at + 76)

  names.push(name)
  if (SUSPECT.test(name)) flagged.push(`имя текстуры ${i}: «${name}»`)

  if (width <= 0 || height <= 0 || dataAt <= 0) continue
  if (dataAt + width * height + 768 > buf.length) continue

  const palette = buf.subarray(dataAt + width * height, dataAt + width * height + 768)

  // Уменьшаем ближайшим соседом: нам нужно заметить надпись, а не любоваться.
  const cell = Buffer.alloc(CELL * CELL * 3)
  for (let y = 0; y < CELL; y++) {
    const sy = Math.min(height - 1, Math.floor(y * height / CELL))
    for (let x = 0; x < CELL; x++) {
      const sx = Math.min(width - 1, Math.floor(x * width / CELL))
      const c = buf[dataAt + sy * width + sx] * 3
      const o = (y * CELL + x) * 3
      cell[o] = palette[c]
      cell[o + 1] = palette[c + 1]
      cell[o + 2] = palette[c + 2]
    }
  }
  tiles.push(cell)
}

if (!tiles.length) {
  console.log(`${basename(file)}: текстур внутри нет`)
  process.exit(0)
}

const cols = Math.min(6, Math.ceil(Math.sqrt(tiles.length)))
const rows = Math.ceil(tiles.length / cols)
const W = cols * CELL
const H = rows * CELL
const sheet = Buffer.alloc(W * H * 3)

tiles.forEach((cell, i) => {
  const cx = (i % cols) * CELL
  const cy = Math.floor(i / cols) * CELL
  for (let y = 0; y < CELL; y++) {
    cell.copy(sheet, ((cy + y) * W + cx) * 3, y * CELL * 3, (y + 1) * CELL * 3)
  }
})

const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = b => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return ~c }

const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

const raw = Buffer.alloc((W * 3 + 1) * H)
for (let y = 0; y < H; y++) sheet.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3)

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2
writeFileSync(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]))

console.log(`${basename(file)}: ${tiles.length} текстур -> ${basename(out)} (${cols}x${rows})`)
if (flagged.length) console.log(`  ⚠ подозрительно: ${flagged.join('; ')}`)
