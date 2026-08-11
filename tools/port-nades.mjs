// Переносит модели гранат «в мире» — те, что летят по воздуху и лежат на полу.
//
// ЗАЧЕМ. Владелец: «когда кидаешь, трейлы и модель у гранат одинаковые». Так и
// есть: игровой модуль выдаёт всем брошенным гранатам штатную w_hegrenade, а
// мод только подкрашивает след. Отличить в полёте заражение от отброса нельзя,
// а решение «бежать или ловить» игрок принимает именно по летящему предмету.
//
// Берём по модели на каждый вид из сборок, которые скачивал владелец:
//   отброс     — w_grenade_knockback (JUST PRO), их же граната отброса
//   заражение  — w_zbomb_origin («Пирог»), зелёная колба
//   напалм     — w_fire (CS-RAGE)
//   заморозка  — w_frost (CS-RAGE)
//   вспышка    — w_holybomb («Пирог»), светлый шар
//
// Как и у остальных переносчиков: своё имя (иначе клиент покажет чужую модель,
// скачанную раньше), затёртые метки донора, честная длина в заголовке и не
// больше четырёх точек крепления.
//
// Запуск: node tools/port-nades.mjs [--dry]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'custom', 'content', 'models', 'zm_hot')

const JP = join(ROOT, 'quarantine', 'justpro-zombie', 'extracted',
  'NEW BALANCE', 'Компелировання', 'models', 'jp_models')
const KZ = join(ROOT, 'quarantine', 'kazakh-pirog', 'extracted',
  '[ZM] Казахский Пирог зомби', 'cstrike', 'models', 'Reega_kz')
const RG = join(ROOT, 'quarantine', 'csrage-zp43fix5a-plus', 'extracted',
  'ZP 4.3 fix5a', 'cstrike', 'models', 'zombie_plague')

const NADES = [
  { from: join(JP, 'w_grenade_knockback.mdl'), to: 'w_zm_hot_push.mdl' },
  { from: join(KZ, 'w_zbomb_origin.mdl'), to: 'w_zm_hot_infect.mdl' },
  { from: join(RG, 'w_fire.mdl'), to: 'w_zm_hot_fire.mdl' },
  { from: join(RG, 'w_frost.mdl'), to: 'w_zm_hot_frost.mdl' },
  { from: join(KZ, 'w_holybomb.mdl'), to: 'w_zm_hot_flare.mdl' },
]

const MARKS = [
  'by_reega_zm7up', 'model_by_reega_zm7up', 'LARS-DAY[BR]EAKER',
  'Bereke_of_the_zm7up', 'Reega!KAZAKHSTAN', 'reega_zm7up', 'vk.com/zm7up',
  'Reega!', 'zm7uP', 'zm7up', 'REEGA', 'Reega',
]
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
      buf.fill(0x5f, at, at + needle.length)
      hits++
      from = at + needle.length
    }
  }
  return hits
}

let done = 0
for (const nade of NADES) {
  if (!existsSync(nade.from)) { console.log(`! нет исходника ${nade.from}`); continue }

  const buf = readFileSync(nade.from)
  if (buf.readUInt32LE(0) !== 0x54534449) { console.log(`! ${nade.from}: это не модель GoldSrc`); continue }

  const was = buf.toString('latin1', NAME_AT, buf.indexOf(0, NAME_AT))
  const marks = scrub(buf)

  buf.fill(0, NAME_AT, NAME_AT + NAME_SIZE)
  buf.write(nade.to, NAME_AT, 'latin1')

  const declared = buf.readInt32LE(LENGTH_AT)
  const fixedLength = declared !== buf.length
  if (fixedLength) buf.writeInt32LE(buf.length, LENGTH_AT)

  const attach = buf.readInt32LE(NUMATTACH_AT)
  const cutAttach = attach > MAX_ATTACH
  if (cutAttach) buf.writeInt32LE(MAX_ATTACH, NUMATTACH_AT)

  if (!dry) {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, nade.to), buf)
  }
  done++
  console.log(`+ ${nade.to} (${(buf.length / 1024).toFixed(0)} КБ) — было «${was}», меток затёрто ${marks}`
    + (fixedLength ? `, длина ${declared} -> ${buf.length}` : '')
    + (cutAttach ? `, точек крепления ${attach} -> ${MAX_ATTACH}` : ''))
}

console.log(dry ? `\nпроверка: перенеслось бы ${done} из ${NADES.length}`
  : `\nперенесено ${done} из ${NADES.length} в custom/content/models/zm_hot`)
