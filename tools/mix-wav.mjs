// Складывает два звука GoldSrc в один.
//
// Зачем. Готовой записи летучих мышей нет ни в одной из тринадцати скачанных
// сборок и ни в самой игре: обошли 11 230 файлов, разобрали заголовки и
// посчитали спектр — ни одного файла, где были бы разом высокий писк и
// хлопанье крыльев. Зато порознь они есть: крик стаи летунов из Half-Life
// (boid_alert2) и трепет крыльев (fly.wav, модуляция 13.9 Гц — это и есть
// частота взмаха). Складываем их сами.
//
// Формат на выходе тот же, что у остальных звуков сборки: PCM, 8 бит, моно.
// GoldSrc берёт только несжатый PCM; mp3 в звук способности не годится.
//
// Запуск:
//   node tools/mix-wav.mjs <основа.wav> <подложка.wav> <куда.wav> [--gain 0.4] [--seconds 2.0]

import { readFileSync, writeFileSync } from 'node:fs'

// ── чтение ──────────────────────────────────────────────────────────────────────
//
// Разбираем RIFF сами: чанки идут не в фиксированном порядке, а между fmt и
// data у половины файлов лежит ещё LIST с именем автора.
function readWav(path) {
  const b = readFileSync(path)
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: это не WAV`)
  }
  let fmt = null
  let data = null
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('latin1', o, o + 4)
    const size = b.readUInt32LE(o + 4)
    if (id === 'fmt ') {
      fmt = {
        tag: b.readUInt16LE(o + 8),
        channels: b.readUInt16LE(o + 10),
        rate: b.readUInt32LE(o + 12),
        bits: b.readUInt16LE(o + 22),
      }
    } else if (id === 'data') {
      data = b.subarray(o + 8, Math.min(o + 8 + size, b.length))
    }
    o += 8 + size + (size & 1)
  }
  if (!fmt || !data) throw new Error(`${path}: нет fmt или data`)
  if (fmt.tag !== 1) throw new Error(`${path}: сжатый WAV (tag ${fmt.tag}) — GoldSrc такой не берёт`)

  // Внутри работаем в float −1..1: 8-битный WAV беззнаковый с центром 128,
  // 16-битный знаковый. Складывать их «как есть» нельзя.
  const n = fmt.bits === 16 ? data.length >> 1 : data.length
  const out = new Float32Array(Math.floor(n / fmt.channels))
  for (let i = 0; i < out.length; i++) {
    // Многоканальные сводим в моно средним по каналам.
    let s = 0
    for (let c = 0; c < fmt.channels; c++) {
      const k = i * fmt.channels + c
      s += fmt.bits === 16 ? data.readInt16LE(k << 1) / 32768 : (data[k] - 128) / 128
    }
    out[i] = s / fmt.channels
  }
  return { rate: fmt.rate, samples: out, src: path }
}

// Пересчёт частоты линейной интерполяцией: для шума и писка её хватает, а
// разница с честным фильтром на 8 битах всё равно тонет в шуме квантования.
function resample(samples, from, to) {
  if (from === to) return samples
  const len = Math.round((samples.length * to) / from)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const x = (i * from) / to
    const j = Math.floor(x)
    const t = x - j
    out[i] = (samples[j] ?? 0) * (1 - t) + (samples[j + 1] ?? samples[j] ?? 0) * t
  }
  return out
}

function writeWav(path, samples, rate) {
  const data = Buffer.alloc(samples.length)
  for (let i = 0; i < samples.length; i++) {
    // Обрезаем по краям, а не заворачиваем: перебор на 8 битах иначе даёт
    // щелчок вместо громкого места.
    const v = Math.max(-1, Math.min(1, samples[i]))
    data[i] = Math.round(v * 127) + 128
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0, 'latin1')
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8, 'latin1')
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)      // PCM
  head.writeUInt16LE(1, 22)      // моно
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate, 28)   // байт в секунду: 8 бит × 1 канал
  head.writeUInt16LE(1, 32)      // выравнивание блока
  head.writeUInt16LE(8, 34)
  head.write('data', 36, 'latin1')
  head.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([head, data]))
}

const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return def
  const v = Number(argv[i + 1])
  argv.splice(i, 2)
  return v
}
const gain = opt('gain', 0.4)
const seconds = opt('seconds', 0)
const [mainPath, underPath, outPath] = argv
if (!mainPath || !underPath || !outPath) {
  console.error('использование: node tools/mix-wav.mjs <основа.wav> <подложка.wav> <куда.wav> [--gain 0.4] [--seconds 2.0]')
  process.exit(2)
}

const main = readWav(mainPath)
const under = readWav(underPath)
// Частоту берём высшую из двух: понижать основу значит терять как раз писк,
// ради которого её и выбрали.
const rate = Math.max(main.rate, under.rate)
const a = resample(main.samples, main.rate, rate)
const b = resample(under.samples, under.rate, rate)

const len = seconds > 0 ? Math.round(seconds * rate) : a.length
const mix = new Float32Array(len)
for (let i = 0; i < len; i++) {
  // Подложка короче основы — пускаем её по кругу: взмахи крыльев ровные, шва
  // на слух нет.
  mix[i] = (a[i] ?? 0) + (b[i % b.length] ?? 0) * gain
}

// Хвост гасим: способность звучит один раз, и обрыв на полуслове читается как
// «звук не доиграл».
const fade = Math.min(Math.round(rate * 0.15), len)
for (let i = 0; i < fade; i++) mix[len - fade + i] *= 1 - i / fade

// Нормируем к 0.92, чтобы после обрезки по краям не было щелчков.
let peak = 0
for (const v of mix) peak = Math.max(peak, Math.abs(v))
if (peak > 0) for (let i = 0; i < len; i++) mix[i] = (mix[i] / peak) * 0.92

writeWav(outPath, mix, rate)
console.log(`+ ${outPath}: ${(len / rate).toFixed(2)} с, ${rate} Гц, 8 бит, моно, ${44 + len} Б`)
console.log(`  основа  ${mainPath} (${main.rate} Гц, ${(main.samples.length / main.rate).toFixed(2)} с)`)
console.log(`  подложка ${underPath} (${under.rate} Гц, ${(under.samples.length / under.rate).toFixed(2)} с) × ${gain}`)
