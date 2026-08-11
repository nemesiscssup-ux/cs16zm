// Переносит модели людей из чужих сборок в наш магазин скинов.
//
// Отдельный инструмент, а не копирование руками, потому что у каждой чужой
// модели три беды разом:
//
//  1. ВНУТРЕННЕЕ ИМЯ. В заголовке лежит собственное имя модели, и оно врёт:
//     players_summer2017 внутри называет себя Reega_vip_green4.mdl. Две разные
//     модели с одинаковым внутренним именем клиент складывает в один кэш и
//     показывает ту, что скачал раньше, — игрок видит чужой скин.
//  2. МЕТКИ ДОНОРА. В именах костей и частей тела спрятаны «vk.com/zm7up»,
//     «Reega!KAZAKHSTAN», «Bereke_of_the_zm7up». Игрок их не видит, но возить
//     чужую подпись в своей сборке незачем. Затираем на месте, байт в байт:
//     сместить хоть один байт нельзя — весь файл держится на смещениях.
//  3. ДЛИНА В ЗАГОЛОВКЕ. У пяти моделей «Сборки v1» поле length меньше файла
//     на 20-30 КБ: у автора не обновилось после подмены текстур. Движок читает
//     по смещениям и играет, но наша проверка tools/mdl.mjs такое зовёт порчей.
//     Чиним, раз конец данных совпадает с концом файла.
//  4. ТОЧКИ КРЕПЛЕНИЯ. Движок терпит ЧЕТЫРЕ (MAXSTUDIOATTACHMENTS). Пятая — не
//     «мелкий изъян», а строка «Too many attachments on %s» и сразу за ней
//     exit(-1): игра закрывается у КАЖДОГО, кто увидел такую модель. У «Зимней»
//     (zbplayer_2) их одиннадцать, и владелец поймал это собой. Лишние просто
//     отсекаем счётчиком: массив идёт подряд, следующие секции адресуются
//     своими смещениями, поэтому ничего не съезжает.
//
// Отбирали модели глазами по текстурам, а не по именам файлов, и сверяли с
// нашими ПО ТЕКСТУРАМ: три «новинки» из «Пирога» (jra_admin_summer,
// Reega_vip_green4, Reega_boss_blue5) оказались теми же скинами, что у нас уже
// лежат под именами zm_hot_form9, zm_hot_form_vip и zm_hot_otpusk. Сравнение
// по sha256 самих .mdl этого не показывает — у нас взят вариант побогаче.
//
// Запуск: node tools/port-skins.mjs [--dry]

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'custom', 'content', 'models', 'player')

const KZ = join(ROOT, 'quarantine', 'kazakh-pirog', 'extracted',
  '[ZM] Казахский Пирог зомби', 'cstrike', 'models', 'player')
const SB = join(ROOT, 'quarantine', 'zombie-sborka-v1', 'extracted',
  'Зомби сборка v1', 'Сборка', 'models', 'player')

// Имя у нас — короткое и своё: длинное имя каталога игрок видит в списке
// закачки, и «Reega_boss_blue5» там читается как реклама донора.
const SKINS = [
  { from: join(KZ, 'players_summer2017'), to: 'zm_hot_leto' },
  { from: join(KZ, 'Paladin_F'), to: 'zm_hot_paladin' },
  { from: join(KZ, 'DarkKnight_F'), to: 'zm_hot_knight' },
  { from: join(SB, 'zbboss_1'), to: 'zm_hot_frak' },
  { from: join(SB, 'zbplayer_1'), to: 'zm_hot_sporty' },
  { from: join(SB, 'zbplayer_2'), to: 'zm_hot_zima' },
  { from: join(SB, 'zbsurvivor_1'), to: 'zm_hot_zvezda' },
  { from: join(SB, 'zbsurvivor_2'), to: 'zm_hot_zmeya' },
]

// Затирать метки надо ровно тем же числом байт. Порядок важен: длинные строки
// идут первыми, иначе короткая «Reega!» съест кусок длинной и остаток
// «KAZAKHSTAN» останется на месте.
const MARKS = [
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

const NAME_AT = 8
const NAME_SIZE = 64
const LENGTH_AT = 72
const NUMTEX_AT = 180
const TEXINDEX_AT = 184
const TEX_SIZE = 80
const TEXFLAGS_AT = 64        // внутри mstudiotexture_t
const MASKED = 0x40           // STUDIO_NF_MASKED
const NUMATTACH_AT = 212
const MAX_ATTACH = 4          // MAXSTUDIOATTACHMENTS, за ним клиент выходит
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
for (const skin of SKINS) {
  const src = join(skin.from, `${skin.from.split(/[\\/]/).pop()}.mdl`)
  if (!existsSync(src)) { console.log(`! нет исходника ${src}`); continue }

  const buf = readFileSync(src)
  if (buf.readUInt32LE(0) !== 0x54534449) { console.log(`! ${src}: это не модель GoldSrc`); continue }

  const was = buf.toString('latin1', NAME_AT, buf.indexOf(0, NAME_AT))
  const marks = scrub(buf)

  // Имя пишем ПОСЛЕ затирания меток: иначе «_» затрёт и его.
  buf.fill(0, NAME_AT, NAME_AT + NAME_SIZE)
  buf.write(`${skin.to}.mdl`, NAME_AT, 'latin1')

  const declared = buf.readInt32LE(LENGTH_AT)
  const fixedLength = declared !== buf.length
  if (fixedLength) buf.writeInt32LE(buf.length, LENGTH_AT)

  const attach = buf.readInt32LE(NUMATTACH_AT)
  const cutAttach = attach > MAX_ATTACH
  if (cutAttach) buf.writeInt32LE(MAX_ATTACH, NUMATTACH_AT)

  // ⚠️ ПЯТАЯ БЕДА, самая обидная: у конвертов из CSO шкура ТЕЛА помечена флагом
  // «с прозрачностью». В CS 1.6 такое тело у ЖИВОГО игрока не рисуется вовсе —
  // видно только труп. Измерено на клиенте 2026-08-10 на 26 моделях: помечена
  // нулевая текстура — тела нет, не помечена — всё на месте. Снимаем только у
  // нулевой: на волосах и накидках флаг осмыслен.
  const nt = buf.readInt32LE(NUMTEX_AT)
  const ti = buf.readInt32LE(TEXINDEX_AT)
  let unmasked = false
  if (nt > 0 && ti > 0 && ti + TEX_SIZE <= buf.length) {
    const flags = buf.readInt32LE(ti + TEXFLAGS_AT)
    if (flags & MASKED) {
      buf.writeInt32LE(flags & ~MASKED, ti + TEXFLAGS_AT)
      unmasked = true
    }
  }

  const dir = join(OUT, skin.to)
  const dst = join(dir, `${skin.to}.mdl`)
  if (!dry) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(dst, buf)
  }
  done++
  const size = (buf.length / 1048576).toFixed(1)
  console.log(`+ ${skin.to} (${size} МБ) — было «${was}», меток затёрто ${marks}`
    + (fixedLength ? `, длина в заголовке ${declared} -> ${buf.length}` : '')
    + (cutAttach ? `, точек крепления ${attach} -> ${MAX_ATTACH} (иначе клиент закрывался)` : ''))
}

console.log(dry ? `\nпроверка: перенеслось бы ${done} из ${SKINS.length}`
  : `\nперенесено ${done} из ${SKINS.length} в custom/content/models/player`)
