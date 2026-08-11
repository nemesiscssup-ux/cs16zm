// Переносит лапу зомби (вид от первого лица) из чужой сборки в наш каталог.
//
// Зачем отдельный инструмент. port-plugins.mjs тянет лапы, НАЙДЕННЫЕ в исходном
// коде чужих плагинов. Когда лапу классу назначаем мы сами (через
// tools/customize.mjs), в чужих исходниках её нет — и притащить файл некому.
//
// Что делает с каждым файлом, кроме копирования:
//
//  1. ИМЯ. Файл кладётся под своим, приметным именем: две модели с одинаковым
//     путём в models/zombie_plague_v44 клиент держит в одном кэше, и игрок,
//     заходивший раньше на чужой сервер, увидит ЧУЖУЮ лапу вместо нашей.
//     Внутреннее имя в заголовке переписываем туда же — оно тоже врёт
//     (v_zclass_player3 внутри зовётся v_knife_zombis.mdl).
//  2. МЕТКИ ДОНОРА. Подписи авторов прячутся не только на текстурах, но и в
//     именах последовательностей и подмоделей: «by_reega_zm7up»,
//     «LARS-DAY[BR]EAKER». Игрок их не видит, но возить чужую подпись незачем.
//     Затираем на месте, байт в байт: сместить хоть один байт нельзя — весь
//     файл держится на смещениях.
//  3. ДЛИНА В ЗАГОЛОВКЕ и ТОЧКИ КРЕПЛЕНИЯ. То же, что в port-skins.mjs:
//     length должен совпадать с файлом, а креплений больше четырёх движок не
//     переживает — печатает «Too many attachments» и зовёт exit(-1).
//
// Запуск: node tools/port-claw.mjs [--dry]

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'custom', 'content', 'models', 'zombie_plague_v44')

const KZ = join(ROOT, 'quarantine', 'kazakh-pirog', 'extracted',
  '[ZM] Казахский Пирог зомби', 'cstrike', 'models', 'zombie_plague')
const JP = join(ROOT, 'quarantine', 'justpro-zombie', 'extracted',
  'NEW BALANCE', 'Компелировання', 'models', 'zombie_plague')

// Толстяк. История лапы в двух шагах.
//
// Было v_heavyz_pak3.mdl: ЧЕТЫРЕ подмодели — когти, китайский тесак, рука
// джаггернаута и «тёмный санта», — мод переключал их сам, и владелец видел «то
// кувалда, то топор». На двух текстурах вдобавок реклама чужих серверов
// («WWW.175PT.COM» на клинке и «REEGA ZM7UP.RU» на санте). Убрана.
//
// Потом взяли v_strong_lights2.mdl («Пирог»): одна подмодель, переключать
// нечего. Но владелец посмотрел и сказал прямо: руки ЖЕНСКИЕ — тонкое
// запястье, узкая кисть. Для Толстяка не годится.
//
// Потом взяли v_hand_tank_jp.mdl из JUST PRO — лапу их «Танка»: широкая кисть
// в окровавленном бинте. Владелец посмотрел и уточнил задачу: «руки толстяка
// должны быть с топориком». Голых кулаков мало.
//
// ⚠️ ПОЭТОМУ ВЕРНУЛИСЬ К ИСХОДНОМУ ПАКУ, но берём из него РОВНО ОДНУ подмодель.
// Прежняя беда была не в самой лапе, а в том, что подмоделей четыре и мод
// переключал их сам. Теперь есть tools/mdl-extract.mjs: вырезаем подмодель 1
// «cso_china_dao» — та же лапа зомби, но с тяжёлым китайским тесаком в руке.
// Переключать нечего, лишние текстуры (в том числе «тёмный санта» с рекламой
// zm7up) в файл не попадают вовсе.
//
// ⚠️ На текстуре лезвия остаётся реклама китайского портала («175PT» и
// «WWW.175PT.COM»); её закрашивает tools/mdl-untag.mjs — записи добавлены туда
// же под именем v_zm_hot_heavy.
// ⚠️ ИЗ ОДНОГО ПАКА — ОБЕ ЛАПЫ, И ЭТО НЕ СЛУЧАЙНОСТЬ. Владелец посмотрел на
// тесак и рассудил: большой китайский дао с черепом слишком приметен для
// рядового класса и просится Дьяволу, а Толстяку нужна своя рука. Она в том же
// паке и есть: подмодель 0 «cso_heavy_zombie_hand_ref» — рука тяжёлого зомби с
// окровавленным МЯСНИЦКИМ тесаком (текстура heavy_zombi_Knife). То есть родная
// лапа именно этого класса, а не чужая заимствованная.
//
//   подмодель 0 — рука зомби + мясницкий тесак      -> Толстяк
//   подмодель 1 — рука зомби + китайский дао        -> Дьявол
//   подмодель 2 — рука джаггернаута                 -> не берём
//   подмодель 3 — «тёмный санта» с рекламой zm7up   -> не берём
const HEAVY_PACK = join(ROOT, 'quarantine', 'steam-downloads', 'extracted',
  'cstrike', 'models', 'zombie_plague', 'v_heavyz_pak3.mdl')
const FROM_PACK = [
  { sub: 0, to: 'v_zm_hot_heavy.mdl' },     // Толстяк
  { sub: 1, to: 'v_zm_hot_nemesis.mdl' },   // Дьявол
]

const CLAWS = []   // прямых копий нет: обе лапы собираются вырезанием, см. ниже

const MARKS = [
  'by_reega_zm7up',
  'model_by_reega_zm7up',
  'LARS-DAY[BR]EAKER',
  'Bereke_of_the_zm7up',
  'Reega!KAZAKHSTAN',
  'reega_zm7up',
  'vk.com/zm7up',
  'Reega!',
  'zm7uP',
  'zm7up',
  'REEGA',
  'Reega',
]
// Длинные — первыми, иначе короткая съест кусок длинной и хвост уцелеет.
MARKS.sort((a, b) => b.length - a.length)

const NAME_AT = 8
const NAME_SIZE = 64
const LENGTH_AT = 72
const NUMATTACH_AT = 212
const MAX_ATTACH = 4
const dry = process.argv.includes('--dry')

function scrub(buf) {
  let hits = 0
  for (const mark of MARKS) {
    const needle = Buffer.from(mark, 'latin1')
    let from = 0
    for (;;) {
      const at = buf.indexOf(needle, from)
      if (at < 0) break
      buf.fill(0x5f, at, at + needle.length)   // '_' той же длины
      hits++
      from = at + needle.length
    }
  }
  return hits
}

let done = 0
for (const claw of CLAWS) {
  if (!existsSync(claw.from)) { console.log(`! нет исходника ${claw.from}`); continue }

  const buf = readFileSync(claw.from)
  if (buf.readUInt32LE(0) !== 0x54534449) { console.log(`! ${claw.from}: это не модель GoldSrc`); continue }

  const was = buf.toString('latin1', NAME_AT, buf.indexOf(0, NAME_AT))
  const marks = scrub(buf)

  // Имя пишем ПОСЛЕ затирания меток: иначе «_» затрёт и его.
  buf.fill(0, NAME_AT, NAME_AT + NAME_SIZE)
  buf.write(claw.to, NAME_AT, 'latin1')

  const declared = buf.readInt32LE(LENGTH_AT)
  const fixedLength = declared !== buf.length
  if (fixedLength) buf.writeInt32LE(buf.length, LENGTH_AT)

  const attach = buf.readInt32LE(NUMATTACH_AT)
  const cutAttach = attach > MAX_ATTACH
  if (cutAttach) buf.writeInt32LE(MAX_ATTACH, NUMATTACH_AT)

  if (!dry) {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, claw.to), buf)
  }
  done++
  console.log(`+ ${claw.to} (${(buf.length / 1048576).toFixed(2)} МБ) — было «${was}», меток затёрто ${marks}`
    + (fixedLength ? `, длина ${declared} -> ${buf.length}` : '')
    + (cutAttach ? `, точек крепления ${attach} -> ${MAX_ATTACH}` : ''))
}

// Лапа Толстяка: вырезаем одну подмодель из пака и сразу закрашиваем рекламу.
// Вызываем чужие инструменты как есть, а не копируем их код: так правка в
// вырезалке или в списке реклам не разъедется с этим переносом.
if (existsSync(HEAVY_PACK)) {
  for (const one of FROM_PACK) {
    const target = join(OUT, one.to)
    if (dry) {
      console.log(`проверка: вырезали бы подмодель ${one.sub} из v_heavyz_pak3.mdl -> ${one.to}`)
      continue
    }
    mkdirSync(OUT, { recursive: true })
    const node = process.execPath
    const tools = dirname(fileURLToPath(import.meta.url))
    execFileSync(node, [join(tools, 'mdl-extract.mjs'), HEAVY_PACK, '0', String(one.sub),
      target, '--name', one.to], { stdio: 'inherit' })
    execFileSync(node, [join(tools, 'mdl-untag.mjs'), target], { stdio: 'inherit' })
    done++
  }
} else {
  console.log(`! нет пака ${HEAVY_PACK} — лапы Толстяка и Дьявола не собраны`)
}

console.log(dry ? `\nпроверка: собралось бы лап ${done}`
  : `\nсобрано лап: ${done}, в custom/content/models/zombie_plague_v44`)
