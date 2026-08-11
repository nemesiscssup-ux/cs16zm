// Переносит ножи из скачанных сборок: модель в руках у себя (v_) и та же вещь
// глазами остальных (p_).
//
// ЗАЧЕМ ПАРАМИ. Нож без p_модели выглядит нормально только владельцу: остальные
// видят пустые руки. Поэтому берём строго парами и отказываемся, если пары нет.
//
// ЧТО ДЕЛАЕТ, кроме копирования, — то же, что остальные переносчики:
//   1. СВОЁ ИМЯ. Две модели с одинаковым путём клиент держит в одном кэше, и
//      игрок, заходивший раньше на чужой сервер, увидит ЧУЖОЙ нож вместо
//      нашего. Внутреннее имя в заголовке переписываем туда же.
//   2. МЕТКИ ДОНОРА в именах костей, частей и последовательностей.
//   3. ДЛИНА В ЗАГОЛОВКЕ и ТОЧКИ КРЕПЛЕНИЯ (движок терпит четыре, за ними
//      «Too many attachments» и exit(-1)).
//
// Отбирали по ТЕКСТУРАМ, а не по именам: «tornado_knife» оказался не ножом, а
// техно-буром, «toyhammer2» — игрушечным молотом с наклейками и в сборку не
// пошёл.
//
// Запуск: node tools/port-knives.mjs [--dry]

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'custom', 'content', 'models', 'zm_hot')

const KZ = join(ROOT, 'quarantine', 'kazakh-pirog', 'extracted',
  '[ZM] Казахский Пирог зомби', 'cstrike', 'models', 'Reega_kz')
const JP = join(ROOT, 'quarantine', 'justpro-zombie', 'extracted',
  'NEW BALANCE', 'Компелировання', 'models', 'zombie_plague')

// to — короткое своё имя без «v_»/«p_»: приставки добавит сам инструмент.
const KNIVES = [
  { from: KZ, name: 'v_axe_red.mdl', to: 'zm_hot_axe' },            // красный колун
  { from: KZ, name: 'v_chainsaw_tron.mdl', to: 'zm_hot_saw' },      // бело-синяя техно-пила
  { from: KZ, name: 'v_tornado_knife.mdl', to: 'zm_hot_drill' },    // техно-бур со сталью
  { from: JP, name: 'v_knife_axe_jp.mdl', to: 'zm_hot_machete' },   // индонезийский тесак Wedung
  { from: JP, name: 'v_knife_strong_jp.mdl', to: 'zm_hot_blade' },  // тяжёлый клинок CSO
]

const MARKS = [
  'by_reega_zm7up', 'model_by_reega_zm7up', 'LARS-DAY[BR]EAKER',
  'Bereke_of_the_zm7up', 'Reega!KAZAKHSTAN', 'Reega! KOREA', 'reega_zm7up',
  'vk.com/zm7up', 'ZM7UP.RU', 'Reega!', 'ZM7UP', 'zm7uP', 'zm7up', 'REEGA', 'Reega',
].sort((a, b) => b.length - a.length)

const NAME_AT = 8
const NAME_SIZE = 64
const LENGTH_AT = 72
const NUMATTACH_AT = 212
const MAX_ATTACH = 4
const dry = process.argv.includes('--dry')

// ⚠️⚠️ ЗАТИРАТЬ МЕТКИ ВНУТРИ СОБЫТИЙ АНИМАЦИИ НЕЛЬЗЯ. У бензопилы взмах и
// холостой ход играет не плагин, а событие 5004 внутри модели, и путь к файлу
// лежит там же строкой: «Reega_kz/chainsaw_idle.wav». Затирание превратило его
// в «______kz/chainsaw_idle.wav» — файла с таким именем нет, и пила онемела.
// Владелец так и сказал: «у новых ножей нету звуков».
//
// Поэтому события обходим стороной, а путь в них переписываем отдельно, на наш
// каталог, и сам звук переносим рядом.
const SEQ = 176, EVENT = 76

function eventOptions(buf) {
  const out = []
  const numseq = buf.readInt32LE(164), seqindex = buf.readInt32LE(168)
  for (let i = 0; i < numseq; i++) {
    const o = seqindex + i * SEQ
    if (o + SEQ > buf.length) break
    const numevents = buf.readInt32LE(o + 48)
    const eventindex = buf.readInt32LE(o + 52)
    for (let k = 0; k < numevents; k++) {
      const e = eventindex + k * EVENT
      if (e + EVENT > buf.length) break
      out.push(e + 12)           // options[64] внутри mstudioevent_t
    }
  }
  return out
}

function scrub(buf) {
  const guarded = eventOptions(buf).map(at => [at, at + 64])
  const inside = at => guarded.some(([a, b]) => at >= a && at < b)

  let hits = 0
  for (const mark of MARKS) {
    const needle = Buffer.from(mark, 'latin1')
    let from = 0
    for (;;) {
      const at = buf.indexOf(needle, from)
      if (at < 0) break
      from = at + needle.length
      if (inside(at)) continue   // это путь к звуку, а не подпись автора
      buf.fill(0x5f, at, at + needle.length)
      hits++
    }
  }
  return hits
}

// Звуки, на которые ссылается сама модель, переезжают в наш каталог вместе с
// ней: чужая папка в пути — тот же чужой след, и файла с таким именем у нас нет.
function retargetSounds(buf, map) {
  const moved = []
  for (const at of eventOptions(buf)) {
    const was = buf.toString('latin1', at, at + 64).replace(/\0.*/s, '')
    if (!was) continue
    for (const [from, to] of map) {
      if (!was.startsWith(from)) continue
      const now = to + was.slice(from.length)
      if (now.length > 63) break
      buf.fill(0, at, at + 64)
      buf.write(now, at, 'latin1')
      moved.push([was, now])
      break
    }
  }
  return moved
}

// Пара к модели вида: у части сборок она называется «p_имя», у части «p_имя01».
function pairOf(dir, vname) {
  const bare = vname.slice(2)
  for (const cand of [`p_${bare}`, `p_${bare.replace('.mdl', '01.mdl')}`]) {
    const p = join(dir, cand)
    if (existsSync(p)) return p
  }
  return null
}

function port(src, outName) {
  const buf = readFileSync(src)
  if (buf.readUInt32LE(0) !== 0x54534449) return { err: 'это не модель GoldSrc' }

  const was = buf.toString('latin1', NAME_AT, buf.indexOf(0, NAME_AT))
  const marks = scrub(buf)
  const moved = retargetSounds(buf, SOUND_MAP)

  // Имя пишем ПОСЛЕ затирания меток: иначе «_» затрёт и его.
  buf.fill(0, NAME_AT, NAME_AT + NAME_SIZE)
  buf.write(outName, NAME_AT, 'latin1')

  const declared = buf.readInt32LE(LENGTH_AT)
  const fixedLength = declared !== buf.length
  if (fixedLength) buf.writeInt32LE(buf.length, LENGTH_AT)

  const attach = buf.readInt32LE(NUMATTACH_AT)
  const cutAttach = attach > MAX_ATTACH
  if (cutAttach) buf.writeInt32LE(MAX_ATTACH, NUMATTACH_AT)

  if (!dry) {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, outName), buf)
  }
  return { was, marks, moved, fixedLength, declared, cutAttach, attach, size: buf.length }
}

// Куда переезжают звуки, на которые ссылаются сами модели.
const SOUND_MAP = [['Reega_kz/', 'zm_hot/']]
const SOUND_SRC = join(ROOT, 'quarantine', 'kazakh-pirog', 'extracted',
  '[ZM] Казахский Пирог зомби', 'cstrike', 'sound', 'Reega_kz')
const SOUND_OUT = join(ROOT, 'custom', 'content', 'sound', 'zm_hot')

let done = 0
for (const knife of KNIVES) {
  const vsrc = join(knife.from, knife.name)
  if (!existsSync(vsrc)) { console.log(`! нет исходника ${vsrc}`); continue }

  const psrc = pairOf(knife.from, knife.name)
  if (!psrc) { console.log(`! у ${knife.name} нет пары p_ — пропущен`); continue }

  const v = port(vsrc, `v_${knife.to}.mdl`)
  if (v.err) { console.log(`! ${knife.name}: ${v.err}`); continue }
  const p = port(psrc, `p_${knife.to}.mdl`)
  if (p.err) { console.log(`! ${basename(psrc)}: ${p.err}`); continue }

  done++
  console.log(`+ ${knife.to}: v_ ${(v.size / 1024).toFixed(0)} КБ + p_ ${(p.size / 1024).toFixed(0)} КБ`
    + ` — было «${v.was}», меток затёрто ${v.marks + p.marks}`
    + (v.cutAttach || p.cutAttach ? ', точки крепления подрезаны' : ''))

  // Звуковые файлы, на которые ссылается модель, тянем следом.
  for (const [was, now] of [...v.moved, ...p.moved]) {
    const src = join(SOUND_SRC, basename(was))
    const dst = join(SOUND_OUT, basename(now))
    if (!existsSync(src)) { console.log(`    ! нет звука ${src}`); continue }
    if (!dry) {
      mkdirSync(SOUND_OUT, { recursive: true })
      copyFileSync(src, dst)
    }
    console.log(`    звук «${was}» -> «${now}»`)
  }
}

console.log(dry ? `\nпроверка: перенеслось бы ${done} из ${KNIVES.length}`
  : `\nперенесено ${done} из ${KNIVES.length} пар в custom/content/models/zm_hot`)
