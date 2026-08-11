// Рисует модель GoldSrc в PNG — чтобы увидеть её глазами, а не гадать по
// развёртке текстуры.
//
// ЗАЧЕМ ЭТО ПОНАДОБИЛОСЬ. Реклама донора на «Отпускнике» и «Лидере» искалась
// по развёртке полдня и не нашлась: на развёртке «ZM7UP.RU» — не надпись, а
// неприметный золотой брусок 30×30 в стороне от одежды, потому что САМИ БУКВЫ
// ТАМ ГЕОМЕТРИЯ — отдельные плоскости перед грудью, а брусок им только красит
// поверхность. Глазами по картинке текстуры такое не увидеть в принципе.
// Нашлось так: нарисовать модель, найти на рисунке золотые пиксели и вернуться
// от них к точке текстуры (--probe печатает и цвет, и точку).
//
// ПРАВИЛО ПОСЛЕ ЭТОГО СЛУЧАЯ: проверять чистоту модели РИСУНКОМ, а не
// развёрткой. Развёртка отвечает на вопрос «что нарисовано», рисунок — на
// вопрос «что увидит игрок», и это разные вопросы.
//
// Опорная поза берётся из собственных смещений и поворотов костей (value[6]):
// отдельной «позы по умолчанию» в формате нет, а разбирать анимации ради
// неподвижной картинки незачем.
//
// ⚠️ ЗАТЕНЕНИЕ ОБЯЗАТЕЛЬНО, И ЭТО НЕ КРАСОТА. Сначала я рисовал без света — и
// плоско закрашенная геометрия в такой картинке исчезала бесследно. На этом я и
// ошибся: перекрасил буквы-наклейки в цвет одежды, увидел чистую картинку и
// доложил, что реклама убрана. На сайте свет есть, и буквы остались видны
// рельефом. Свет здесь затем, чтобы «убрано» означало убрано.
//
// Запуск:
//   node tools/mdl-render.mjs <файл.mdl> <выход.png> [размер] [поворот°]
//     --crop x,y,w,h            вырезать кусок картинки (в пикселях вывода)
//     --probe x,y[,x,y...]      цвет пикселя, номер текстуры и точка на ней
//     --goldscan x,y,w,h        границы «золотых» точек развёртки в окне
//     --goldmap x,y,w,h,файл[,тек]  те же точки, помеченные прямо на текстуре

import { deflateSync } from 'node:zlib'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { chooseParts } from './mdl-parts.mjs'

const [, , file, out, sizeS, yawS] = process.argv
const SIZE = Number(sizeS) || 700
const YAW = ((Number(yawS) || 0) * Math.PI) / 180

const buf = readFileSync(file)

const H = { numbones: 140, boneindex: 144, numtextures: 180, textureindex: 184,
  numskinref: 192, numskinfamilies: 196, skinindex: 200,
  numbodyparts: 204, bodypartindex: 208 }

// ── кости → опорная поза ────────────────────────────────────────────────────
function angleQuaternion(x, y, z) {
  const sr = Math.sin(x / 2), cr = Math.cos(x / 2)
  const sp = Math.sin(y / 2), cp = Math.cos(y / 2)
  const sy = Math.sin(z / 2), cy = Math.cos(z / 2)
  return [sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy,
          cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy]
}
function quatMatrix([x, y, z, w], p) {
  return [1 - 2*y*y - 2*z*z, 2*x*y - 2*w*z, 2*x*z + 2*w*y, p[0],
          2*x*y + 2*w*z, 1 - 2*x*x - 2*z*z, 2*y*z - 2*w*x, p[1],
          2*x*z - 2*w*y, 2*y*z + 2*w*x, 1 - 2*x*x - 2*y*y, p[2]]
}
function concat(a, b) {
  const o = new Array(12)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r*4+c] = a[r*4]*b[c] + a[r*4+1]*b[4+c] + a[r*4+2]*b[8+c]
    o[r*4+3] = a[r*4]*b[3] + a[r*4+1]*b[7] + a[r*4+2]*b[11] + a[r*4+3]
  }
  return o
}
const apply = (m, v) => [m[0]*v[0]+m[1]*v[1]+m[2]*v[2]+m[3],
                         m[4]*v[0]+m[5]*v[1]+m[6]*v[2]+m[7],
                         m[8]*v[0]+m[9]*v[1]+m[10]*v[2]+m[11]]

/*
 * --seq [N] — ставить модель в позу из последовательности N (по умолчанию 0),
 * а не в опорную.
 *
 * ⚠️ ДЛЯ ВИДОВЫХ МОДЕЛЕЙ (v_*) ЭТО ЕДИНСТВЕННЫЙ СПОСОБ. У них опорная поза
 * не поза вовсе: кости разбросаны, и модель рассыпается по экрану горстью
 * обрезков. Оружие «в руках» собирается только анимацией — первым кадром
 * покоя. У моделей игроков опорная поза, наоборот, годится, поэтому по
 * умолчанию не трогаем ничего: иначе все уже сделанные картинки поедут.
 *
 * Берём кадр 0: у каждой кости шесть каналов, в каждом либо ноль (значит
 * держим собственное значение кости), либо смещение к сжатой дорожке, где
 * первое же число — наш кадр.
 */
const SEQ = (() => {
  const i = process.argv.indexOf('--seq')
  if (i < 0) return null
  const n = Number(process.argv[i + 1])
  return Number.isFinite(n) ? n : 0
})()

const bones = []
{
  const n = buf.readInt32LE(H.numbones), at0 = buf.readInt32LE(H.boneindex)

  // Смещения дорожек анимации выбранной последовательности, если она нужна.
  let animAt = -1
  if (SEQ !== null) {
    const numseq = buf.readInt32LE(164)
    const seqAt = buf.readInt32LE(168)
    if (numseq > SEQ && seqAt > 0) {
      const s = seqAt + SEQ * 176
      const seqgroup = buf.readInt32LE(s + 156)
      // Дорожки из внешних файлов (.seq) не читаем: в наших моделях их нет.
      if (seqgroup === 0) animAt = buf.readInt32LE(s + 124)
    }
    if (animAt <= 0) console.log('! последовательности нет — рисую опорную позу')
  }

  for (let i = 0; i < n; i++) {
    const at = at0 + i * 112
    const parent = buf.readInt32LE(at + 32)
    const v = []
    for (let k = 0; k < 6; k++) v.push(buf.readFloatLE(at + 64 + k * 4))

    if (animAt > 0) {
      const scale = []
      for (let k = 0; k < 6; k++) scale.push(buf.readFloatLE(at + 88 + k * 4))
      const panim = animAt + i * 12
      for (let k = 0; k < 6; k++) {
        if (panim + k * 2 + 2 > buf.length) break
        const off = buf.readUInt16LE(panim + k * 2)
        if (!off) continue
        const p = panim + off
        if (p + 4 > buf.length) continue
        const valid = buf[p]
        if (valid > 0) v[k] += buf.readInt16LE(p + 2) * scale[k]
      }
    }

    const local = quatMatrix(angleQuaternion(v[3], v[4], v[5]), [v[0], v[1], v[2]])
    bones.push(parent >= 0 && parent < i ? concat(bones[parent], local) : local)
  }
}

// ── текстуры ────────────────────────────────────────────────────────────────
let src = buf
if (src.readInt32LE(H.numtextures) === 0) {
  const t = file.replace(/\.mdl$/i, 'T.mdl')
  if (existsSync(t)) src = readFileSync(t)
}
const textures = []
{
  const n = src.readInt32LE(H.numtextures), at0 = src.readInt32LE(H.textureindex)
  for (let i = 0; i < n; i++) {
    const at = at0 + i * 80
    const w = src.readInt32LE(at + 68), h = src.readInt32LE(at + 72)
    const idx = src.readInt32LE(at + 76)
    if (w <= 0 || h <= 0 || idx + w * h + 768 > src.length) { textures.push(null); continue }
    textures.push({ w, h, idx, pal: idx + w * h, buf: src })
  }
}
let skins = null
{
  const nref = buf.readInt32LE(H.numskinref), fams = buf.readInt32LE(H.numskinfamilies)
  const at = buf.readInt32LE(H.skinindex)
  if (nref > 0 && fams > 0) {
    skins = []
    for (let i = 0; i < nref; i++) skins.push(buf.readInt16LE(at + i * 2))
  }
}

/*
 * --tidy — выбросить части-выбросы.
 *
 * ⚠️ БЕЗ ЭТОГО ВИДОВЫЕ МОДЕЛИ НЕ ПОКАЗАТЬ. У «Молота фараона» само оружие с
 * руками укладывается в 35 единиц, а рядом лежат две плоскости эффектов:
 * одна 975 единиц высотой, вторая отставлена на 185 в сторону. В игре движок
 * их не рисует (это заготовки под удар), но кадр по ним считается — и оружие
 * сжимается в точку. Ровно так и выглядели первые попытки: горсть обрезков на
 * чёрном.
 *
 * Правило: берём срединный размер частей и оставляем те, что не больше трёх
 * срединных и не отставлены дальше трёх срединных от начала координат.
 */
const TIDY = process.argv.includes('--tidy')

const chosen = TIDY ? chooseParts(buf, bones, { hands: process.argv.includes('--hands') }) : null
if (chosen && chosen.why.length) console.log()
const keepPart = i => !chosen || !chosen.keep || chosen.keep[i]
// Сетки со «сложением» — свечения и следы взмаха. В игре вспыхивают на удар,
// на витрине висят чёрными полотнищами поперёк оружия.
const keepMesh = ti => !chosen || !chosen.effectTex || !chosen.effectTex.has(ti)

// ── треугольники ────────────────────────────────────────────────────────────
const tris = []
{
  const nb = buf.readInt32LE(H.numbodyparts), bat = buf.readInt32LE(H.bodypartindex)
  for (let b = 0; b < nb; b++) {
    const at = bat + b * 76
    if (buf.readInt32LE(at + 64) <= 0) continue
    if (!keepPart(b)) continue
    const m = buf.readInt32LE(at + 72)
    const nmesh = buf.readInt32LE(m + 72), meshidx = buf.readInt32LE(m + 76)
    const vinfo = buf.readInt32LE(m + 84), vidx = buf.readInt32LE(m + 88)

    for (let s = 0; s < nmesh; s++) {
      const mesh = meshidx + s * 20
      const triindex = buf.readInt32LE(mesh + 4)
      const skinref = buf.readInt32LE(mesh + 8)
      const ti = skins && skins[skinref] !== undefined ? skins[skinref] : skinref
      if (!keepMesh(ti)) continue
      const tex = textures[ti]
      let p = triindex
      for (;;) {
        if (p + 2 > buf.length) break
        const cmd = buf.readInt16LE(p); p += 2
        if (cmd === 0) break
        const fan = cmd < 0, count = Math.abs(cmd), run = []
        for (let i = 0; i < count; i++) {
          const vi = buf.readUInt16LE(p), st = buf.readInt16LE(p + 4), tt = buf.readInt16LE(p + 6)
          p += 8
          const bone = buf[vinfo + vi]
          const v = apply(bones[bone] || bones[0], [
            buf.readFloatLE(vidx + vi * 12),
            buf.readFloatLE(vidx + vi * 12 + 4),
            buf.readFloatLE(vidx + vi * 12 + 8)])
          run.push({ v, s: st, t: tt })
        }
        for (let i = 2; i < run.length; i++) {
          const a = fan ? run[0] : run[i - 2]
          const b2 = fan ? run[i - 1] : run[i - 1]
          tris.push({ a, b: b2, c: run[i], tex })
        }
      }
    }
  }
}

// ── проекция и растеризация ─────────────────────────────────────────────────
let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
for (const t of tris) for (const q of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) {
  if (q.v[k] < min[k]) min[k] = q.v[k]
  if (q.v[k] > max[k]) max[k] = q.v[k]
}
const cx = (min[0]+max[0])/2, cy = (min[1]+max[1])/2, cz = (min[2]+max[2])/2
const span = Math.max(max[0]-min[0], max[1]-min[1], max[2]-min[2]) * 1.08
const scale = SIZE / span

// Камера смотрит вдоль -Y, Z — вверх; поворот вокруг Z даёт нужную сторону.
const cosY = Math.cos(YAW), sinY = Math.sin(YAW)
function project(v) {
  const x = v[0]-cx, y = v[1]-cy, z = v[2]-cz
  const rx = x*cosY - y*sinY
  const ry = x*sinY + y*cosY
  return { sx: SIZE/2 + rx*scale, sy: SIZE/2 - z*scale, depth: ry }
}

const W = SIZE, Hh = SIZE
// Фон. По умолчанию тёмно-серый, но сайту нужен ровно его собственный цвет —
// иначе картинка предпросмотра выделяется прямоугольником на карточке.
const BG = (() => {
  const i = process.argv.indexOf('--bg')
  if (i > 0 && process.argv[i + 1]) {
    const p = process.argv[i + 1].split(',').map(Number)
    if (p.length === 3 && p.every(n => Number.isFinite(n))) return p
  }
  return [24, 24, 24]
})()

const rgb = Buffer.alloc(W*Hh*3)
for (let p = 0; p < W*Hh; p++) {
  rgb[p*3] = BG[0]; rgb[p*3+1] = BG[1]; rgb[p*3+2] = BG[2]
}
const zbuf = new Float32Array(W*Hh).fill(Infinity)
const pixTex = new Int32Array(W*Hh).fill(-1)
const pixU = new Float32Array(W*Hh)
const pixV = new Float32Array(W*Hh)

/*
 * Затенение по нормали грани.
 *
 * ⚠️ БЕЗ НЕГО ЭТОТ ИНСТРУМЕНТ ВРЁТ. Плоско закрашенная геометрия (например
 * буквы-наклейки, перекрашенные в цвет одежды) в картинке без света исчезает
 * бесследно — и я на этом обжёгся: доложил, что реклама убрана, а на сайте, где
 * свет есть, она осталась видна рельефом. Свет нужен именно затем, чтобы
 * «убрано» означало убрано.
 */
const LIGHT = (() => {
  const l = [-0.35, -0.8, 0.5]
  const n = Math.hypot(l[0], l[1], l[2])
  return [l[0] / n, l[1] / n, l[2] / n]
})()

function faceShade(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const len = Math.hypot(n[0], n[1], n[2])
  if (!len) return 1
  const d = Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / len)
  return 0.55 + 0.55 * d
}

for (const t of tris) {
  const shade = faceShade(t.a.v, t.b.v, t.c.v)
  const P = [project(t.a.v), project(t.b.v), project(t.c.v)]
  const minx = Math.max(0, Math.floor(Math.min(P[0].sx,P[1].sx,P[2].sx)))
  const maxx = Math.min(W-1, Math.ceil(Math.max(P[0].sx,P[1].sx,P[2].sx)))
  const miny = Math.max(0, Math.floor(Math.min(P[0].sy,P[1].sy,P[2].sy)))
  const maxy = Math.min(Hh-1, Math.ceil(Math.max(P[0].sy,P[1].sy,P[2].sy)))
  const d = (P[1].sy-P[2].sy)*(P[0].sx-P[2].sx) + (P[2].sx-P[1].sx)*(P[0].sy-P[2].sy)
  if (Math.abs(d) < 1e-9) continue

  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      const l0 = ((P[1].sy-P[2].sy)*(x-P[2].sx) + (P[2].sx-P[1].sx)*(y-P[2].sy)) / d
      const l1 = ((P[2].sy-P[0].sy)*(x-P[2].sx) + (P[0].sx-P[2].sx)*(y-P[2].sy)) / d
      const l2 = 1 - l0 - l1
      if (l0 < 0 || l1 < 0 || l2 < 0) continue
      const depth = l0*P[0].depth + l1*P[1].depth + l2*P[2].depth
      const o = y*W + x
      if (depth >= zbuf[o]) continue
      zbuf[o] = depth
      const tex = t.tex
      let r = 200, g = 200, b = 200
      if (tex) {
        const su = Math.round(l0*t.a.s + l1*t.b.s + l2*t.c.s)
        const sv = Math.round(l0*t.a.t + l1*t.b.t + l2*t.c.t)
        const u = ((su % tex.w) + tex.w) % tex.w
        const v = ((sv % tex.h) + tex.h) % tex.h
        const c = tex.buf[tex.idx + v*tex.w + u] * 3
        r = tex.buf[tex.pal + c]; g = tex.buf[tex.pal + c + 1]; b = tex.buf[tex.pal + c + 2]
      }
      rgb[o*3] = Math.min(255, r * shade) | 0; rgb[o*3+1] = Math.min(255, g * shade) | 0; rgb[o*3+2] = Math.min(255, b * shade) | 0
      if (tex) { pixTex[o] = textures.indexOf(tex); pixU[o] = Math.round(l0*t.a.s + l1*t.b.s + l2*t.c.s); pixV[o] = Math.round(l0*t.a.t + l1*t.b.t + l2*t.c.t) }
    }
  }
}

// ── вырезка куска картинки (--crop x,y,w,h в пикселях вывода) ──────────────
let OX = 0, OY = 0, OW = W, OH = Hh
{
  const i = process.argv.indexOf('--crop')
  if (i > 0 && process.argv[i + 1]) {
    const [a, b, c, d] = process.argv[i + 1].split(',').map(Number)
    OX = Math.max(0, a | 0); OY = Math.max(0, b | 0)
    OW = Math.min(W - OX, c | 0); OH = Math.min(Hh - OY, d | 0)
  }
}
if (OX || OY || OW !== W || OH !== Hh) {
  const cut = Buffer.alloc(OW * OH * 3)
  for (let y = 0; y < OH; y++) {
    rgb.copy(cut, y * OW * 3, ((OY + y) * W + OX) * 3, ((OY + y) * W + OX + OW) * 3)
  }
  rgb.fill(0)
  cut.copy(rgb, 0)
}

// ── PNG ─────────────────────────────────────────────────────────────────────
const CRC = (() => { const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) { let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c } return t })()
const crc32 = b => { let c = ~0; for (const x of b) c = CRC[(c^x)&0xff] ^ (c>>>8); return ~c }
const stride = OW*3+1
const raw = Buffer.alloc(stride*OH)
for (let y = 0; y < OH; y++) rgb.copy(raw, y*stride+1, y*OW*3, (y+1)*OW*3)
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type,'latin1'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)>>>0)
  return Buffer.concat([len, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(OW,0); ihdr.writeUInt32BE(OH,4); ihdr[8]=8; ihdr[9]=2
writeFileSync(out, Buffer.concat([
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw,{level:9})), chunk('IEND', Buffer.alloc(0)),
]))
console.log(`${out}: ${W}x${Hh}, треугольников ${tris.length}`)

// --probe x,y[,x,y...] — какая текстура и какая её точка попали в этот пиксель
{
  const i = process.argv.indexOf('--probe')
  if (i > 0 && process.argv[i + 1]) {
    const nums = process.argv[i + 1].split(',').map(Number)
    for (let k = 0; k + 1 < nums.length; k += 2) {
      const o = nums[k + 1] * W + nums[k]
      console.log('пиксель (' + nums[k] + ',' + nums[k + 1] + '): цвет '
        + rgb[o * 3] + ',' + rgb[o * 3 + 1] + ',' + rgb[o * 3 + 2]
        + ' текстура ' + pixTex[o] + ', точка (' + pixU[o] + ',' + pixV[o] + ')')
    }
  }
}

// --goldscan x,y,w,h — найти золотые пиксели в области и сказать, из каких
// точек каких текстур они взяты. Так находится реклама, нарисованная поверх
// нескольких кусков развёртки: на самой развёртке она разорвана и незаметна.
{
  const i = process.argv.indexOf('--goldscan')
  if (i > 0 && process.argv[i + 1]) {
    const [ax, ay, aw, ah] = process.argv[i + 1].split(',').map(Number)
    const per = new Map()
    for (let y = ay; y < ay + ah && y < Hh; y++) {
      for (let x = ax; x < ax + aw && x < W; x++) {
        const o = y * W + x
        const r = rgb[o*3], g = rgb[o*3+1], b = rgb[o*3+2]
        // золото: красный и зелёный высокие, синий заметно ниже
        if (!(r > 120 && g > 90 && b < g - 40)) continue
        const t = pixTex[o]
        if (t < 0) continue
        if (!per.has(t)) per.set(t, { n: 0, minU: 1e9, maxU: -1e9, minV: 1e9, maxV: -1e9 })
        const s = per.get(t)
        s.n++
        s.minU = Math.min(s.minU, pixU[o]); s.maxU = Math.max(s.maxU, pixU[o])
        s.minV = Math.min(s.minV, pixV[o]); s.maxV = Math.max(s.maxV, pixV[o])
      }
    }
    for (const [t, s] of [...per].sort((a, b2) => b2[1].n - a[1].n)) {
      console.log(`текстура ${t}: золотых пикселей ${s.n}, область развёртки x ${s.minU}..${s.maxU}, y ${s.minV}..${s.maxV}`)
    }
  }
}

// --goldmap x,y,w,h,файл — нарисовать текстуру 0 и пометить малиновым те её
// точки, из которых взялись золотые пиксели указанного окна картинки.
{
  const i = process.argv.indexOf('--goldmap')
  if (i > 0 && process.argv[i + 1]) {
    const parts = process.argv[i + 1].split(',')
    const ax = +parts[0], ay = +parts[1], aw = +parts[2], ah = +parts[3]
    const dest = parts[4]
    const TI = parts[5] === undefined ? 0 : +parts[5]
    const tex = textures[TI]
    const mask = new Uint8Array(tex.w * tex.h)
    for (let y = ay; y < ay + ah && y < Hh; y++) {
      for (let x = ax; x < ax + aw && x < W; x++) {
        const o = y * W + x
        const r = rgb[o*3], g = rgb[o*3+1], b = rgb[o*3+2]
        if (!(r > 120 && g > 90 && b < g - 40)) continue
        if (pixTex[o] !== TI) continue
        const u = ((pixU[o] % tex.w) + tex.w) % tex.w
        const v = ((pixV[o] % tex.h) + tex.h) % tex.h
        mask[v * tex.w + u] = 1
      }
    }
    const outRgb = Buffer.alloc(tex.w * tex.h * 3)
    for (let p = 0; p < tex.w * tex.h; p++) {
      if (mask[p]) { outRgb[p*3] = 255; outRgb[p*3+1] = 0; outRgb[p*3+2] = 255; continue }
      const c = tex.buf[tex.idx + p] * 3
      outRgb[p*3] = tex.buf[tex.pal + c]
      outRgb[p*3+1] = tex.buf[tex.pal + c + 1]
      outRgb[p*3+2] = tex.buf[tex.pal + c + 2]
    }
    const st2 = tex.w * 3 + 1
    const raw2 = Buffer.alloc(st2 * tex.h)
    for (let y = 0; y < tex.h; y++) outRgb.copy(raw2, y*st2+1, y*tex.w*3, (y+1)*tex.w*3)
    const ih = Buffer.alloc(13)
    ih.writeUInt32BE(tex.w, 0); ih.writeUInt32BE(tex.h, 4); ih[8] = 8; ih[9] = 2
    writeFileSync(dest, Buffer.concat([
      Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
      chunk('IHDR', ih), chunk('IDAT', deflateSync(raw2, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
    ]))
    console.log(`карта: ${dest}`)
  }
}
