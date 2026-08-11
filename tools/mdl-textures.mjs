// Достаёт текстуры из модели GoldSrc и складывает их картинками PNG.
//
// Нужен для честной проверки чужих моделей: на скинах из готовых сборок часто
// нарисована реклама сервера-донора — адрес сайта на спине, ник автора на груди.
// Заголовок такое не покажет, а игрок увидит сразу.
//
// Формат: mstudiotexture_t идёт подряд по 80 байт — имя[64], флаги, ширина,
// высота, смещение данных. Дальше по смещению лежит ширина×высота байтов
// индексов и следом палитра 256×3.
//
// Запуск: node tools/mdl-textures.mjs <файл.mdl> <куда-класть>

import { deflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const [, , file, outDir] = process.argv
if (!file || !outDir) {
  console.error('использование: node tools/mdl-textures.mjs <файл.mdl> <каталог>')
  process.exit(2)
}

const buf = readFileSync(file)
if (buf.length < 244 || buf.readUInt32LE(0) !== 0x54534449) {   // 'IDST'
  console.error(`${file}: это не модель GoldSrc`)
  process.exit(1)
}

// Смещения в studiohdr_t: текстуры описаны парой «сколько» и «где».
const numTextures = buf.readInt32LE(180)
const textureIndex = buf.readInt32LE(184)

if (numTextures <= 0) {
  console.log(`${basename(file)}: текстур внутри нет (лежат в отдельном T-файле)`)
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0                       // фильтр строки: без фильтра
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8      // бит на канал
  ihdr[9] = 2      // цвет: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buffer) {
  let c = ~0
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return ~c
}

const made = []
for (let i = 0; i < numTextures; i++) {
  const at = textureIndex + i * 80
  if (at + 80 > buf.length) break

  const name = buf.toString('latin1', at, at + 64).split('\0')[0]
  const width = buf.readInt32LE(at + 68)
  const height = buf.readInt32LE(at + 72)
  const dataAt = buf.readInt32LE(at + 76)

  if (width <= 0 || height <= 0 || dataAt <= 0) continue
  const need = width * height + 256 * 3
  if (dataAt + need > buf.length) continue

  const palette = buf.subarray(dataAt + width * height, dataAt + need)
  const rgb = Buffer.alloc(width * height * 3)
  for (let p = 0; p < width * height; p++) {
    const c = buf[dataAt + p] * 3
    rgb[p * 3] = palette[c]
    rgb[p * 3 + 1] = palette[c + 1]
    rgb[p * 3 + 2] = palette[c + 2]
  }

  const out = join(outDir, `${basename(file, '.mdl')}__${i}_${name.replace(/[^\w.-]/g, '_')}.png`)
  writeFileSync(out, png(width, height, rgb))
  made.push(`${name} ${width}x${height}`)
}

console.log(`${basename(file)}: вынуто текстур ${made.length} — ${made.join(', ')}`)
