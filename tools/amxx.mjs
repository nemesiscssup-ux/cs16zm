// Разбор формата плагинов AMX Mod X (.amxx) и вложенных AMX-образов.
//
// Файл .amxx — это контейнер: заголовок + таблица секций, каждая секция сжата zlib
// и содержит обычный AMX-образ (Pawn abstract machine) под свой размер ячейки (4 или 8 байт).
//
// Формат контейнера (amxmodx/amxxfile.h):
//   int32  magic       0x414D5858 -> на диске байты "XXMA"
//   int16  version     0x0300 (текущая) либо 0x0200 (старая)
//   int8   numPlugins
//   запись секции, размер зависит от версии:
//     0x0300: { int8 cellSize; int32 diskSize; int32 imageSize; int32 memSize; int32 offset }  17 байт
//     0x0200: { int8 cellSize; int32 origSize; int32 offset }                                   9 байт
//
// Формат AMX-образа (pawn amx.h, AMX_HEADER):
//   int32 size; uint16 magic(0xF1E0); int8 file_version; int8 amx_version;
//   int16 flags; int16 defsize;
//   int32 cod, dat, hea, stp, cip, publics, natives, libraries, pubvars, tags, nametable;

import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

const AMXX_MAGIC = 0x414d5858 // "AMXX"
const AMX_MAGIC = 0xf1e0

/** Читает контейнер .amxx и возвращает список распакованных AMX-образов. */
export function parseAmxxContainer(buf) {
  if (buf.length < 7) throw new Error('файл слишком короткий для .amxx')

  const magic = buf.readUInt32LE(0)
  if (magic !== AMXX_MAGIC) {
    // Старый .amx или уже распакованный образ — отдаём как есть.
    if (buf.length > 6 && buf.readUInt16LE(4) === AMX_MAGIC) {
      return { container: 'raw-amx', version: null, sections: [{ cellSize: 4, amx: buf }] }
    }
    throw new Error(`не AMXX-контейнер: magic=0x${magic.toString(16)}`)
  }

  const version = buf.readUInt16LE(4)
  const count = buf.readUInt8(6)
  if (count === 0 || count > 8) throw new Error(`неправдоподобное число секций: ${count}`)

  const wide = version >= 0x0300
  const entrySize = wide ? 17 : 9

  const entries = []
  for (let i = 0; i < count; i++) {
    const p = 7 + i * entrySize
    if (p + entrySize > buf.length) throw new Error('таблица секций выходит за границу файла')
    entries.push(wide
      ? {
          cellSize: buf.readUInt8(p),
          diskSize: buf.readUInt32LE(p + 1),
          imageSize: buf.readUInt32LE(p + 5),
          memSize: buf.readUInt32LE(p + 9),
          offset: buf.readUInt32LE(p + 13),
        }
      : {
          cellSize: buf.readUInt8(p),
          imageSize: buf.readUInt32LE(p + 1),
          offset: buf.readUInt32LE(p + 5),
        })
  }

  const sections = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    // В версии 0x0300 длина сжатого блока известна точно; иначе тянем до следующей секции.
    const end = e.diskSize != null
      ? e.offset + e.diskSize
      : (i + 1 < entries.length ? entries[i + 1].offset : buf.length)
    if (e.offset >= buf.length || end > buf.length || end <= e.offset) {
      sections.push({ ...e, amx: null, error: 'смещение секции вне файла' })
      continue
    }
    try {
      const amx = inflateSync(buf.subarray(e.offset, end))
      sections.push({ ...e, amx })
    } catch (err) {
      sections.push({ ...e, amx: null, error: `распаковка не удалась: ${err.message}` })
    }
  }

  return { container: 'amxx', version, sections }
}

function readCString(buf, at, max = 128) {
  if (at < 0 || at >= buf.length) return null
  let end = at
  while (end < buf.length && end - at < max && buf[end] !== 0) end++
  const s = buf.toString('latin1', at, end)
  return /^[\x20-\x7e]*$/.test(s) ? s : null
}

/** Разбирает распакованный AMX-образ: заголовок, таблицы имён, сегменты. */
export function parseAmx(amx) {
  if (amx.length < 60) throw new Error('AMX-образ слишком короткий')
  const magic = amx.readUInt16LE(4)
  if (magic !== AMX_MAGIC) throw new Error(`не AMX-образ: magic=0x${magic.toString(16)}`)

  const hdr = {
    size: amx.readUInt32LE(0),
    magic,
    fileVersion: amx.readUInt8(6),
    amxVersion: amx.readUInt8(7),
    flags: amx.readUInt16LE(8),
    defsize: amx.readUInt16LE(10),
    cod: amx.readUInt32LE(12),
    dat: amx.readUInt32LE(16),
    hea: amx.readUInt32LE(20),
    stp: amx.readUInt32LE(24),
    cip: amx.readUInt32LE(28),
    publics: amx.readUInt32LE(32),
    natives: amx.readUInt32LE(36),
    libraries: amx.readUInt32LE(40),
    pubvars: amx.readUInt32LE(44),
    tags: amx.readUInt32LE(48),
    nametable: amx.readUInt32LE(52),
  }

  const useNameTable = hdr.defsize === 8

  const readTable = (from, to) => {
    const out = []
    if (!hdr.defsize || to <= from || from >= amx.length) return out
    const stop = Math.min(to, amx.length)
    for (let p = from; p + hdr.defsize <= stop; p += hdr.defsize) {
      const address = amx.readUInt32LE(p)
      let name
      if (useNameTable) {
        name = readCString(amx, amx.readUInt32LE(p + 4))
      } else {
        name = readCString(amx, p + 4, hdr.defsize - 4)
      }
      if (name) out.push({ name, address })
    }
    return out
  }

  const publics = readTable(hdr.publics, hdr.natives)
  const natives = readTable(hdr.natives, hdr.libraries)
  const libraries = readTable(hdr.libraries, hdr.pubvars)
  const pubvars = readTable(hdr.pubvars, hdr.tags)

  const dataStart = Math.min(hdr.dat, amx.length)
  const dataEnd = Math.min(hdr.hea, amx.length)
  const data = dataEnd > dataStart ? amx.subarray(dataStart, dataEnd) : Buffer.alloc(0)
  const code = hdr.dat > hdr.cod ? amx.subarray(Math.min(hdr.cod, amx.length), dataStart) : Buffer.alloc(0)

  return {
    header: hdr,
    publics: publics.map(x => x.name),
    natives: natives.map(x => x.name),
    libraries: libraries.map(x => x.name),
    pubvars: pubvars.map(x => x.name),
    data,
    code,
    codeSize: code.length,
    dataSize: data.length,
  }
}

const PRINTABLE = /[\x20-\x7e]/

function pushRun(out, run, min) {
  if (run.length >= min) out.push(run)
}

/** Обычные ASCII-строки (таблица имён, литералы в неупакованном виде). */
export function asciiStrings(buf, min = 4) {
  const out = []
  let run = ''
  for (let i = 0; i < buf.length; i++) {
    const ch = String.fromCharCode(buf[i])
    if (PRINTABLE.test(ch)) run += ch
    else { pushRun(out, run, min); run = '' }
  }
  pushRun(out, run, min)
  return out
}

/**
 * Неупакованные строки Pawn: один символ на ячейку в 4 байта.
 * "rcon" лежит как 72 00 00 00 63 00 00 00 ...
 */
export function unpackedStrings(data, min = 4) {
  const out = []
  let run = ''
  for (let i = 0; i + 4 <= data.length; i += 4) {
    const cell = data.readUInt32LE(i)
    const ch = cell < 0x80 ? String.fromCharCode(cell) : null
    if (ch && PRINTABLE.test(ch)) run += ch
    else { pushRun(out, run, min); run = '' }
  }
  pushRun(out, run, min)
  return out
}

/**
 * Упакованные строки Pawn: 4 символа в ячейке, старший байт — первый символ.
 * На диске это байты в обратном порядке внутри каждой четвёрки.
 */
export function packedStrings(data, min = 4) {
  const out = []
  let run = ''
  for (let i = 0; i + 4 <= data.length; i += 4) {
    for (const b of [data[i + 3], data[i + 2], data[i + 1], data[i]]) {
      const ch = String.fromCharCode(b)
      if (b && PRINTABLE.test(ch)) run += ch
      else { pushRun(out, run, min); run = '' }
    }
  }
  pushRun(out, run, min)
  return out
}

/** Все строки образа без дублей: имена + три способа кодирования литералов. */
export function allStrings(amxInfo, min = 4) {
  const set = new Set()
  for (const s of asciiStrings(amxInfo.data, min)) set.add(s)
  for (const s of unpackedStrings(amxInfo.data, min)) set.add(s)
  for (const s of packedStrings(amxInfo.data, min)) set.add(s)
  return [...set]
}

/** Полный разбор файла .amxx с диска. */
export function inspectFile(path) {
  const buf = readFileSync(path)
  const container = parseAmxxContainer(buf)
  const plugins = []
  for (const s of container.sections) {
    if (!s.amx) { plugins.push({ cellSize: s.cellSize, error: s.error }); continue }
    try {
      const info = parseAmx(s.amx)
      plugins.push({
        cellSize: s.cellSize,
        header: info.header,
        publics: info.publics,
        natives: info.natives,
        libraries: info.libraries,
        pubvars: info.pubvars,
        codeSize: info.codeSize,
        dataSize: info.dataSize,
        strings: allStrings(info),
      })
    } catch (err) {
      plugins.push({ cellSize: s.cellSize, error: err.message })
    }
  }
  return { path, container: container.container, version: container.version, size: buf.length, plugins }
}

// CLI: node amxx.mjs <file.amxx> [--json]
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , file, ...flags] = process.argv
  if (!file) {
    console.error('использование: node amxx.mjs <файл.amxx> [--json]')
    process.exit(2)
  }
  const res = inspectFile(file)
  if (flags.includes('--json')) {
    console.log(JSON.stringify(res, null, 2))
  } else {
    console.log(`${res.path}  (${res.container}, ${res.size} байт)`)
    for (const p of res.plugins) {
      if (p.error) { console.log(`  секция cell=${p.cellSize}: ОШИБКА ${p.error}`); continue }
      console.log(`  секция cell=${p.cellSize}: код ${p.codeSize} Б, данные ${p.dataSize} Б`)
      console.log(`    нативы (${p.natives.length}): ${p.natives.join(', ')}`)
      console.log(`    библиотеки: ${p.libraries.join(', ') || '—'}`)
      console.log(`    публичные (${p.publics.length}): ${p.publics.slice(0, 40).join(', ')}`)
      console.log(`    строк: ${p.strings.length}`)
    }
  }
}
