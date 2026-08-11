// Переводит модели GoldSrc (.mdl) в то, что покажет браузер.
//
// ЗАЧЕМ. Игрок должен видеть, за что платит: скин уровня и нож — не строчка в
// таблице, а вещь, которую надо покрутить. Отдавать браузеру сам .mdl нельзя:
// файл весит до 7.7 МБ, из которых 90% — анимации и текстуры, а показать надо
// одну неподвижную позу.
//
// ЧТО ДЕЛАЕТ. Достаёт геометрию в опорной позе и текстуры, выкидывает
// анимации целиком и складывает три файла на модель:
//   <id>.json  описание: части, размеры, к какой текстуре какая часть
//   <id>.bin   вершины: позиция(3) + нормаль(3) + развёртка(2), по 32 байта
//   <id>-N.png текстуры
//
// ПОЗА. Отдельной «позы по умолчанию» в формате нет — вершины лежат в системе
// координат своей кости, а позу задают анимации. У моделей игроков хватает
// собственных значений костей (value[6], сложенные по цепочке родителей): это
// та поза, в которой модель лежала в редакторе.
//
// ⚠️ У ВИДОВЫХ МОДЕЛЕЙ (v_*, оружие в руках) ЭТО НЕ РАБОТАЕТ. Их опорная поза
// не поза вовсе — кости разбросаны, и оружие рассыпается по экрану. Им нужен
// ключ seq: первый кадр первой анимации. И ключ tidy: рядом с оружием лежат
// заготовки эффектов (у «Молота фараона» плоскость 975 единиц высотой), по
// которым иначе считается кадр, и оружие сжимается в точку.
//
// ⚠️ ТЕКСТУРЫ МОГУТ ЛЕЖАТЬ СНАРУЖИ. Если numtextures == 0, они в соседнем
// файле <имя>T.mdl. Не учесть — и вместо скина будет чёрное пятно, ровно как в
// игре у клиента без T-файла.
//
// Запуск: node site/tools/build-models.mjs [--out <каталог>]

import { deflateSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chooseParts } from '../../tools/mdl-parts.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MODELS = join(ROOT, 'server', 'cstrike', 'models')

const argv = process.argv.slice(2)
const outArg = argv.indexOf('--out')
const OUT = outArg >= 0 ? resolve(argv[outArg + 1]) : join(ROOT, 'site', 'public', 'models')

// ── что показываем ──────────────────────────────────────────────────────────
//
// Идентификаторы совпадают с полем `model` в site/private/app/catalog.php —
// по ним страница и находит геометрию. Пути — от server/cstrike/models.
//

const WANT = [
  // Скины уровней
  { id: 'skin-vip',       file: 'player/zm_hot_form_vip/zm_hot_form_vip.mdl' },
  { id: 'skin-leader',    file: 'player/zm_hot_form9/zm_hot_form9.mdl' },
  { id: 'skin-imperator', file: 'player/zm_hot_otpusk/zm_hot_otpusk.mdl' },
  { id: 'skin-pharaoh',   file: 'player/zm_hot_faraon/zm_hot_faraon.mdl' },
  { id: 'skin-creator',   file: 'player/zm_hot_creator/zm_hot_creator.mdl' },

  /*
   * Ножи — ВИДОВЫЕ модели (v_*), то есть ровно то, что игрок держит в руках.
   *
   * ⚠️ РАНЬШЕ ЗДЕСЬ БЫЛИ РУЧНЫЕ (p_*), И ЭТО БЫЛО ОШИБКОЙ. Я выбрал их ради
   * чистого силуэта без рук, но в этой сборке вид и «рука» у десяти ножей из
   * пятнадцати — РАЗНЫЕ ПРЕДМЕТЫ: у «Молота фараона» в руках золотой череп
   * фараона, а со стороны видно зелёный кристаллический молот (внутри он
   * вообще называется p_stormgiant.mdl). Владелец сразу заметил, что на сайте
   * не то, что в игре.
   *
   * seq — поза из анимации: у видовых моделей опорной позы нет.
   * tidy — отсечь заготовки эффектов, иначе кадр считается по ним.
   */
  { id: 'knife-combat',   file: 'zm_hot_v/view/v_knife_combat_jp.mdl',      seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-hammer',   file: 'zm_hot_v/view/v_knife_hammer_jp.mdl',      seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-hook',     file: 'zm_hot_v/view/v_knife_sheeps_word_jp.mdl', seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-claw',     file: 'zm_hot/v_knife1.mdl',                      seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-axe',      file: 'zm_hot/v_zm_hot_axe.mdl',                  seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-blade',    file: 'zm_hot/v_zm_hot_blade.mdl',                seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-saw',      file: 'zm_hot/v_zm_hot_saw.mdl',                  seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-katana',   file: 'zm_hot_v/view/v_knife_katana_jp.mdl',      seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-mallet',   file: 'zm_hot/v_knife2.mdl',                      seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-ice',      file: 'zm_hot/v_knife3.mdl',                      seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-drill',    file: 'zm_hot/v_zm_hot_drill.mdl',                seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-sledge',   file: 'zm_hot/v_knife5.mdl',                      seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-scythe',   file: 'zm_hot/v_knife6.mdl',                      seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-pharaoh',  file: 'zm_hot/v_knife7.mdl',                      seq: true, tidy: true, previewYaw: 115 },
  { id: 'knife-laser',    file: 'zm_hot/v_knife4.mdl',                      seq: true, tidy: true, previewYaw: 115 },

  // Классы зомби, которые открывает уровень. Это обычные модели игроков,
  // поэтому ни seq, ни tidy им не нужны — опорной позы хватает.
  { id: 'zclass-sprinter',  file: 'player/zm_hot_z_sprinter/zm_hot_z_sprinter.mdl' },
  { id: 'zclass-shaman',    file: 'player/zm_hot_z_siren/zm_hot_z_siren.mdl' },
  { id: 'zclass-ganymede',  file: 'player/zm_hot_z_deimos/zm_hot_z_deimos.mdl' },
  { id: 'zclass-revfire',   file: 'player/zm_hot_z_revfire/zm_hot_z_revfire.mdl' },
  { id: 'zclass-revice',    file: 'player/zm_hot_z_revice/zm_hot_z_revice.mdl' },
  { id: 'zclass-revpoison', file: 'player/zm_hot_z_revpoison/zm_hot_z_revpoison.mdl' },

  // Оружие из магазина
  { id: 'gun-ak47long',   file: 'zm_hot/p_ak47long.mdl' },
  { id: 'gun-vsk94',      file: 'zm_hot/p_falconvsk94.mdl' },
  { id: 'gun-devilbaby',  file: 'zm_hot/p_devilbaby.mdl' },
]

// ── разбор ──────────────────────────────────────────────────────────────────

const HDR = {
  numbones: 140, boneindex: 144,
  numtextures: 180, textureindex: 184, texturedataindex: 188,
  numskinref: 192, numskinfamilies: 196, skinindex: 200,
  numbodyparts: 204, bodypartindex: 208,
}

function readName(buf, at, len) {
  return buf.toString('latin1', at, at + len).split('\0')[0]
}

/** Кватернион из углов Эйлера — ровно так же, как это делает движок. */
function angleQuaternion(x, y, z) {
  const sr = Math.sin(x * 0.5), cr = Math.cos(x * 0.5)
  const sp = Math.sin(y * 0.5), cp = Math.cos(y * 0.5)
  const sy = Math.sin(z * 0.5), cy = Math.cos(z * 0.5)
  return [
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy,
  ]
}

/** Матрица 3×4 (поворот из кватерниона + смещение), строками. */
function quatMatrix(q, pos) {
  const [x, y, z, w] = q
  return [
    1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * w * z,     2 * x * z + 2 * w * y,     pos[0],
    2 * x * y + 2 * w * z,     1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * w * x,     pos[1],
    2 * x * z - 2 * w * y,     2 * y * z + 2 * w * x,     1 - 2 * x * x - 2 * y * y, pos[2],
  ]
}

function concatMatrix(a, b) {
  const out = new Array(12)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c]
    }
    out[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3]
  }
  return out
}

const applyMatrix = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
  m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
  m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
]

const rotateMatrix = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
  m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
]

/**
 * Кости в позе.
 *
 * $useSeq — брать позу из первой последовательности, а не опорную.
 *
 * ⚠️ ДЛЯ ВИДОВЫХ МОДЕЛЕЙ (v_*) ЭТО ЕДИНСТВЕННЫЙ СПОСОБ. Опорная поза у них не
 * поза вовсе: кости разбросаны, и оружие рассыпается. «В руках» оно собирается
 * только анимацией — берём её первый кадр. У моделей игроков опорная поза,
 * наоборот, годится, поэтому по умолчанию ничего не меняем.
 */
function boneMatrices(buf, useSeq) {
  const num = buf.readInt32LE(HDR.numbones)
  const at0 = buf.readInt32LE(HDR.boneindex)
  const out = []

  // Смещения дорожек анимации: у каждой кости шесть каналов, в каждом либо
  // ноль (держим собственное значение кости), либо смещение к сжатой дорожке,
  // где первое число — наш кадр.
  let animAt = -1
  if (useSeq) {
    const numseq = buf.readInt32LE(164)
    const seqAt = buf.readInt32LE(168)
    // Дорожки из внешних .seq не читаем: в наших моделях их нет.
    if (numseq > 0 && seqAt > 0 && buf.readInt32LE(seqAt + 156) === 0) {
      animAt = buf.readInt32LE(seqAt + 124)
    }
  }

  for (let i = 0; i < num; i++) {
    const at = at0 + i * 112
    const parent = buf.readInt32LE(at + 32)
    // Раскладка mstudiobone_t: имя[32], родитель(32), флаги(36),
    // bonecontroller[6](40..63), value[6](64..87), scale[6](88..111).
    //
    // ⚠️ Смещение 64, а НЕ 60. Ошибка в четыре байта попадает на
    // bonecontroller[], где у неуправляемых костей лежит −1; прочитанное как
    // float, оно даёт NaN, а NaN тихо проваливает любое сравнение — модель
    // выходит с нулевым габаритом и пустым экраном, без единой ошибки.
    const value = []
    for (let k = 0; k < 6; k++) value.push(buf.readFloatLE(at + 64 + k * 4))

    if (animAt > 0) {
      const scale = []
      for (let k = 0; k < 6; k++) scale.push(buf.readFloatLE(at + 88 + k * 4))
      const panim = animAt + i * 12
      for (let k = 0; k < 6; k++) {
        if (panim + k * 2 + 2 > buf.length) break
        const off = buf.readUInt16LE(panim + k * 2)
        if (!off) continue
        const p = panim + off
        // Первый байт — сколько подряд записанных значений, за ним они сами.
        // Нам нужен кадр 0, то есть самое первое.
        if (p + 4 <= buf.length && buf[p] > 0) value[k] += buf.readInt16LE(p + 2) * scale[k]
      }
    }

    const local = quatMatrix(angleQuaternion(value[3], value[4], value[5]), [value[0], value[1], value[2]])
    out.push(parent >= 0 && parent < i ? concatMatrix(out[parent], local) : local)
  }
  return out
}

/**
 * Текстуры. Возвращает список {name, width, height, rgb}.
 * Если внутри их нет — берём из соседнего <имя>T.mdl.
 */
function textures(buf, file) {
  let src = buf
  if (src.readInt32LE(HDR.numtextures) === 0) {
    const t = file.replace(/\.mdl$/i, 'T.mdl')
    if (!existsSync(t)) return []
    src = readFileSync(t)
  }

  const num = src.readInt32LE(HDR.numtextures)
  const at0 = src.readInt32LE(HDR.textureindex)
  const out = []

  for (let i = 0; i < num; i++) {
    const at = at0 + i * 80
    if (at + 80 > src.length) break
    const name = readName(src, at, 64)
    const width = src.readInt32LE(at + 68)
    const height = src.readInt32LE(at + 72)
    const index = src.readInt32LE(at + 76)
    const need = width * height + 768
    if (width <= 0 || height <= 0 || index + need > src.length) {
      out.push(null)
      continue
    }
    const palette = index + width * height
    const rgb = Buffer.alloc(width * height * 3)
    for (let p = 0; p < width * height; p++) {
      const c = src[index + p] * 3
      rgb[p * 3] = src[palette + c]
      rgb[p * 3 + 1] = src[palette + c + 1]
      rgb[p * 3 + 2] = src[palette + c + 2]
    }
    out.push({ name, width, height, rgb })
  }
  return out
}

/** Какая текстура соответствует номеру шкуры сетки (семейство 0). */
function skinTable(buf) {
  const numref = buf.readInt32LE(HDR.numskinref)
  const fams = buf.readInt32LE(HDR.numskinfamilies)
  const at = buf.readInt32LE(HDR.skinindex)
  if (numref <= 0 || fams <= 0) return null
  const table = []
  for (let i = 0; i < numref; i++) table.push(buf.readInt16LE(at + i * 2))
  return table
}

function parse(file, opts) {
  const buf = readFileSync(file)
  if (buf.length < 244 || buf.readUInt32LE(0) !== 0x54534449) {
    throw new Error('не модель GoldSrc')
  }

  const bones = boneMatrices(buf, opts && opts.seq)
  const chosen = opts && opts.tidy ? chooseParts(buf, bones) : null
  const keep = chosen ? chosen.keep : null
  // Сетки со «сложением» — свечения и следы взмаха: в игре вспыхивают на удар,
  // на витрине висят чёрными полотнищами поперёк оружия.
  const dropTex = chosen && chosen.effectTex ? chosen.effectTex : null
  const tex = textures(buf, file)
  const skins = skinTable(buf)

  const numBody = buf.readInt32LE(HDR.numbodyparts)
  const bodyAt = buf.readInt32LE(HDR.bodypartindex)

  // Вершины складываем в общий поток, а группируем по текстуре: рисовальщику
  // в браузере проще сменить текстуру трижды, чем держать три буфера.
  const verts = []               // [x,y,z, nx,ny,nz, u,v]
  const groups = new Map()       // текстура → массив номеров вершин
  const seen = new Map()

  for (let b = 0; b < numBody; b++) {
    const at = bodyAt + b * 76
    const nummodels = buf.readInt32LE(at + 64)
    const modelindex = buf.readInt32LE(at + 72)
    if (nummodels <= 0) continue
    if (keep && !keep[b]) continue

    // Берём ПЕРВУЮ подмодель части тела: остальные — это варианты (другая
    // голова, другой рюкзак), и показывать их все разом значит слепить кашу.
    const m = modelindex
    const nummesh = buf.readInt32LE(m + 72)
    const meshindex = buf.readInt32LE(m + 76)
    const numverts = buf.readInt32LE(m + 80)
    const vertinfoindex = buf.readInt32LE(m + 84)
    const vertindex = buf.readInt32LE(m + 88)
    const norminfoindex = buf.readInt32LE(m + 96)
    const normindex = buf.readInt32LE(m + 100)

    for (let s = 0; s < nummesh; s++) {
      const mesh = meshindex + s * 20
      const triindex = buf.readInt32LE(mesh + 4)
      const skinref = buf.readInt32LE(mesh + 8)

      const texIndex = skins && skins[skinref] !== undefined ? skins[skinref] : skinref
      if (dropTex && dropTex.has(texIndex)) continue
      const t = tex[texIndex]
      const tw = t ? t.width : 1
      const th = t ? t.height : 1
      if (!groups.has(texIndex)) groups.set(texIndex, [])
      const idx = groups.get(texIndex)

      let p = triindex
      for (;;) {
        if (p + 2 > buf.length) break
        const cmd = buf.readInt16LE(p)
        p += 2
        if (cmd === 0) break

        const fan = cmd < 0
        const count = Math.abs(cmd)
        const run = []

        for (let i = 0; i < count; i++) {
          if (p + 8 > buf.length) break
          const vi = buf.readUInt16LE(p)
          const ni = buf.readUInt16LE(p + 2)
          const sTex = buf.readInt16LE(p + 4)
          const tTex = buf.readInt16LE(p + 6)
          p += 8

          const key = `${vi}|${ni}|${sTex}|${tTex}`
          let at2 = seen.get(key)
          if (at2 === undefined) {
            const vBone = buf[vertinfoindex + vi]
            const nBone = buf[norminfoindex + ni]
            const vp = [
              buf.readFloatLE(vertindex + vi * 12),
              buf.readFloatLE(vertindex + vi * 12 + 4),
              buf.readFloatLE(vertindex + vi * 12 + 8),
            ]
            const np = [
              buf.readFloatLE(normindex + ni * 12),
              buf.readFloatLE(normindex + ni * 12 + 4),
              buf.readFloatLE(normindex + ni * 12 + 8),
            ]
            const wm = bones[vBone] || bones[0]
            const nm = bones[nBone] || bones[0]
            const wv = applyMatrix(wm, vp)
            const wn = rotateMatrix(nm, np)

            at2 = verts.length / 8
            verts.push(wv[0], wv[1], wv[2], wn[0], wn[1], wn[2], sTex / tw, tTex / th)
            seen.set(key, at2)
          }
          run.push(at2)
        }

        // Полоса и веер — два способа записать подряд идущие треугольники.
        for (let i = 2; i < run.length; i++) {
          if (fan) {
            idx.push(run[0], run[i - 1], run[i])
          } else if (i % 2 === 0) {
            idx.push(run[i - 2], run[i - 1], run[i])
          } else {
            idx.push(run[i - 1], run[i - 2], run[i])
          }
        }
      }
    }
  }

  return { verts, groups, tex }
}

// ── запись ──────────────────────────────────────────────────────────────────

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

function png(width, height, rgb) {
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0
    rgb.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3)
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
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT, { recursive: true })

let total = 0
const made = []

for (const item of WANT) {
  const file = join(MODELS, item.file)
  if (!existsSync(file)) {
    console.log(`! нет файла: ${item.file}`)
    continue
  }

  let parsed
  try {
    parsed = parse(file, item)
  } catch (err) {
    console.log(`! ${item.id}: ${err.message}`)
    continue
  }

  const { verts, groups, tex } = parsed
  if (!verts.length) {
    console.log(`! ${item.id}: геометрии не нашлось`)
    continue
  }

  // Размер и центр: страница должна вписать модель в окно, не зная её заранее.
  let min = [Infinity, Infinity, Infinity]
  let max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < verts.length; i += 8) {
    for (let k = 0; k < 3; k++) {
      if (verts[i + k] < min[k]) min[k] = verts[i + k]
      if (verts[i + k] > max[k]) max[k] = verts[i + k]
    }
  }

  // Габарит обязан быть осмысленным. Ноль означает, что все вершины сошлись в
  // точку или превратились в NaN — то и другое даёт пустой экран, и заметить
  // это в браузере куда дороже, чем здесь.
  const span = max.map((v, k) => v - min[k])
  if (!span.every(v => Number.isFinite(v) && v > 0.01)) {
    console.log(`! ${item.id}: габарит вышел ${span.join('×')} — разбор не удался, модель пропущена`)
    continue
  }

  const parts = []
  const indices = []
  for (const [texIndex, idx] of groups) {
    if (!idx.length) continue
    parts.push({ texture: texIndex, start: indices.length, count: idx.length })
    indices.push(...idx)
  }

  const vertData = Float32Array.from(verts)
  const idxData = verts.length / 8 > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices)

  const bin = Buffer.concat([Buffer.from(vertData.buffer), Buffer.from(idxData.buffer)])
  writeFileSync(join(OUT, `${item.id}.bin`), bin)

  const pngs = []
  for (const part of parts) {
    const t = tex[part.texture]
    if (!t) { pngs.push(null); continue }
    const name = `${item.id}-${part.texture}.png`
    if (!pngs.includes(name)) {
      writeFileSync(join(OUT, name), png(t.width, t.height, t.rgb))
    }
    pngs.push(name)
  }

  const meta = {
    id: item.id,
    vertexCount: vertData.length / 8,
    indexCount: idxData.length,
    indexBytes: idxData.BYTES_PER_ELEMENT,
    vertexBytes: vertData.byteLength,
    min, max,
    parts: parts.map((p, i) => ({ start: p.start, count: p.count, texture: pngs[i] })),
  }
  writeFileSync(join(OUT, `${item.id}.json`), JSON.stringify(meta))

  // Картинка предпросмотра для карточки.
  //
  // ⚠️ ЭТО НЕ УКРАШЕНИЕ, А ЛЕКАРСТВО. Живой трёхмерный просмотр на каждой
  // карточке требует своего контекста WebGL, а браузер держит их около
  // шестнадцати: на странице привилегий их выходило за двадцать, и у первых
  // карточек контекст отбирался — вместо модели оставался белый квадрат.
  // Поэтому на страницах теперь картинки, а живая модель — одна, в модалке.
  //
  // Фон берём цветом сайта (--void), чтобы картинка не выделялась на карточке
  // прямоугольником.
  try {
    execFileSync(process.execPath, [
      join(ROOT, 'tools', 'mdl-render.mjs'), file,
      join(OUT, `${item.id}.png`), '520', String(item.previewYaw ?? 25),
      '--bg', '18,19,15',
      // Те же ключи, что и при разборе геометрии, иначе картинка на карточке
      // покажет не то, что откроется в окне просмотра.
      ...(item.seq ? ['--seq'] : []),
      ...(item.tidy ? ['--tidy'] : []),
    ], { stdio: 'pipe' })
  } catch (err) {
    console.log(`! ${item.id}: предпросмотр не нарисовался — ${String(err.message).slice(0, 120)}`)
  }

  const size = bin.length + pngs.filter(Boolean).reduce((n, p) => n + (existsSync(join(OUT, p)) ? readFileSync(join(OUT, p)).length : 0), 0)
  total += size
  made.push(item.id)
  console.log(`+ ${item.id.padEnd(16)} ${String(meta.indexCount / 3).padStart(6)} треуг.  ${(size / 1024).toFixed(0)} КБ`)
}

console.log(`\nготово: ${made.length} моделей, ${(total / 1024 / 1024).toFixed(2)} МБ в ${OUT}`)
