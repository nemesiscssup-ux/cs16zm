// Проверка моделей GoldSrc (.mdl) перед тем, как раздавать их игрокам.
//
// Модель скачивает и разбирает КЛИЕНТ каждого игрока. Битый или обрезанный
// файл роняет игру всем, кто зашёл на сервер, — поэтому чужие модели надо
// разбирать, а не доверять расширению.
//
// Проверяется: сигнатура и версия, совпадение записанной длины с настоящей,
// все смещения внутри файла, вменяемость счётчиков и наличие текстур внутри
// файла (модель с numtextures == 0 требует отдельный <имя>T.mdl, и без него
// у игрока будет чёрное пятно вместо оружия).
//
// ⚠️ И ЖЁСТКИЕ ПРЕДЕЛЫ ДВИЖКА. У рисовальщика моделей массивы фиксированной
// длины, и модель сверх предела он не «рисует хуже» — он ВЫХОДИТ. Строка
// «Too many attachments on %s» лежит и в hw.dll, и в cstrike/cl_dlls/client.dll
// клиента, а сразу за ней exit(-1): игра просто закрывается у каждого, кто
// увидел такую модель. Поймали на скине «Зимняя» — 11 точек крепления.
//
// Запуск: node tools/mdl.mjs <файл или каталог> [...]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const IDST = 0x54534449   // "IDST" как int32 LE
const IDSQ = 0x51534449   // "IDSQ" — файл только с анимациями

// Смещения полей studiohdr_t, которые нас интересуют.
const F = {
  id: 0, version: 4, name: 8, length: 72,
  numbones: 140, boneindex: 144,
  numbonecontrollers: 148, bonecontrollerindex: 152,
  numhitboxes: 156, hitboxindex: 160,
  numseq: 164, seqindex: 168,
  numseqgroups: 172, seqgroupindex: 176,
  numtextures: 180, textureindex: 184, texturedataindex: 188,
  numskinref: 192, numskinfamilies: 196, skinindex: 200,
  numbodyparts: 204, bodypartindex: 208,
  numattachments: 212, attachmentindex: 216,
}

const SANE_MAX = 20000   // счётчики выше этого в моделях оружия не встречаются

// Пределы из studio.h Half-Life SDK. Это НЕ «рекомендуется меньше»: у
// рисовальщика под каждый из них статический массив, и перебор либо роняет
// клиент, либо пишет мимо памяти.
const HARD = {
  numbones: 128,             // MAXSTUDIOBONES
  numbonecontrollers: 8,     // MAXSTUDIOCONTROLLERS
  numattachments: 4,         // MAXSTUDIOATTACHMENTS — за ним exit(-1)
  numseqgroups: 4,           // MAXSTUDIOGROUPS
  numbodyparts: 32,          // MAXSTUDIOBODYPARTS
  numskinref: 100,           // MAXSTUDIOSKINS
  numseq: 2048,              // MAXSTUDIOSEQUENCES
}
const MAXVERTS = 2048        // g_xformverts[MAXSTUDIOVERTS] — на КАЖДУЮ подмодель

export function inspectModel(path) {
  const buf = readFileSync(path)
  const problems = []
  const note = (severity, text) => problems.push({ severity, text })

  if (buf.length < 244) {
    note('critical', `файл короче заголовка studiohdr_t: ${buf.length} байт`)
    return { path, size: buf.length, problems }
  }

  const id = buf.readUInt32LE(F.id)
  const version = buf.readInt32LE(F.version)

  if (id !== IDST) {
    note('critical', id === IDSQ
      ? 'это файл анимаций (IDSQ), а не модель — сам по себе бесполезен'
      : `не модель GoldSrc: сигнатура 0x${id.toString(16)}, ожидалась IDST`)
    return { path, size: buf.length, problems }
  }
  if (version !== 10) note('critical', `версия ${version}, GoldSrc понимает только 10`)

  const declared = buf.readInt32LE(F.length)
  if (declared !== buf.length) {
    note('critical',
      `в заголовке записано ${declared} байт, на диске ${buf.length}` +
      ` — файл обрезан или изменён`)
  }

  // Имя внутри модели: нормальный файл содержит здесь путь вида "v_ak47.mdl".
  let name = ''
  for (let i = F.name; i < F.name + 64 && buf[i] !== 0; i++) name += String.fromCharCode(buf[i])
  if (!/^[\x20-\x7e]*$/.test(name)) note('medium', 'поле имени содержит мусор')

  const counts = {}
  for (const [key, off] of Object.entries(F)) {
    if (!key.startsWith('num')) continue
    const v = buf.readInt32LE(off)
    counts[key] = v
    if (v < 0 || v > SANE_MAX) note('high', `${key} = ${v} — неправдоподобное значение`)
  }

  for (const [key, off] of Object.entries(F)) {
    if (!key.endsWith('index')) continue
    const v = buf.readInt32LE(off)
    if (v < 0 || v > buf.length) {
      note('critical', `${key} = ${v} указывает за пределы файла (${buf.length} байт)`)
    }
  }

  // Текстуры внутри файла или во внешнем <имя>T.mdl.
  if (counts.numtextures === 0) {
    const ext = extname(path)
    const companion = path.slice(0, -ext.length) + 'T' + ext
    if (!existsSync(companion)) {
      note('high',
        'текстур внутри нет (numtextures = 0), а отдельного файла ' +
        `${basename(companion)} рядом не лежит — у игрока будет чёрное оружие`)
    }
  }

  if (counts.numbodyparts === 0) note('high', 'в модели нет ни одной части тела — рисовать нечего')
  if (counts.numseq === 0) note('medium', 'нет анимаций — оружие будет неподвижным')

  // Жёсткие пределы движка: не «некрасиво», а закрытая игра у всех, кто это
  // увидел. Отдельно поясняем самый коварный — точки крепления.
  for (const [key, max] of Object.entries(HARD)) {
    if (counts[key] > max) {
      note('critical', key === 'numattachments'
        ? `точек крепления ${counts[key]}, движок терпит ${max} — клиент закроется`
          + ' («Too many attachments» и exit(-1) в client.dll)'
        : `${key} = ${counts[key]}, предел движка ${max}`)
    }
  }

  // Вершины считаются по КАЖДОЙ подмодели отдельно: массив рисовальщика один,
  // и длинная подмодель пишет мимо него. mstudiobodyparts_t — 76 байт,
  // mstudiomodel_t — 112, numverts лежит на +80, numnorms на +92.
  const bbase = buf.readInt32LE(F.bodypartindex)
  for (let p = 0; p < counts.numbodyparts; p++) {
    const at = bbase + p * 76
    if (at + 76 > buf.length) { note('critical', `часть тела ${p} выходит за пределы файла`); break }
    const nummodels = buf.readInt32LE(at + 64)
    const modelindex = buf.readInt32LE(at + 72)
    for (let m = 0; m < nummodels; m++) {
      const mo = modelindex + m * 112
      if (mo + 112 > buf.length) { note('critical', `подмодель ${p}/${m} выходит за пределы файла`); break }
      let mname = ''
      for (let k = mo; k < mo + 64 && buf[k] !== 0; k++) mname += String.fromCharCode(buf[k])
      const numverts = buf.readInt32LE(mo + 80)
      const numnorms = buf.readInt32LE(mo + 92)
      if (numverts > MAXVERTS) note('critical', `подмодель «${mname}»: вершин ${numverts}, предел ${MAXVERTS}`)
      if (numnorms > MAXVERTS) note('critical', `подмодель «${mname}»: нормалей ${numnorms}, предел ${MAXVERTS}`)
    }
  }

  // Текстуры: запись mstudiotexture_t — 80 байт (имя 64, флаги, ширина, высота,
  // смещение). GoldSrc не тянет стороны больше 512: движок такую модель либо
  // рисует мусором, либо не рисует вовсе — и молча.
  const textures = []
  const tbase = buf.readInt32LE(F.textureindex)
  for (let i = 0; i < counts.numtextures; i++) {
    const at = tbase + i * 80
    if (at + 80 > buf.length) { note('high', 'таблица текстур выходит за пределы файла'); break }
    let tname = ''
    for (let k = at; k < at + 64 && buf[k] !== 0; k++) tname += String.fromCharCode(buf[k])
    const flags = buf.readInt32LE(at + 64)
    const w = buf.readInt32LE(at + 68)
    const h = buf.readInt32LE(at + 72)
    textures.push({ name: tname, w, h, flags })
    if (w > 512 || h > 512) note('high', `текстура ${tname} — ${w}x${h}, GoldSrc не тянет больше 512`)

    // ⚠️ ШКУРА ТЕЛА С ФЛАГОМ «С ПРОЗРАЧНОСТЬЮ» = НЕВИДИМЫЙ ЖИВОЙ ИГРОК.
    // Измерено на клиенте 2026-08-10: если у модели игрока помечена флагом
    // STUDIO_NF_MASKED (0x40) текстура НОМЕР НОЛЬ, тело не рисуется вовсе, пока
    // игрок жив. Труп при этом виден — он идёт другим путём отрисовки, отсюда
    // жалоба «модель показывается только при смерти». На остальных текстурах
    // флаг безобиден (волосы, накидка), поэтому проверяем только нулевую.
    if (i === 0 && (flags & 0x40) && /[\\/]player[\\/]/i.test(path)) {
      note('critical', `шкура тела ${tname} помечена прозрачной (флаг 0x40)`
        + ' — живого игрока клиент не нарисует; снять node tools/mdl-unmask.mjs')
    }
  }

  return { path, size: buf.length, name, version, counts, textures, problems }
}

// Каталоги обходим ВГЛУБЬ: модели игроков лежат каждая в своей папке, и
// проверка «по каталогу моделей» без этого молча находила ноль файлов.
function collect(target) {
  if (!existsSync(target)) return []
  if (statSync(target).isFile()) return [target]
  const out = []
  for (const f of readdirSync(target).sort()) {
    const p = join(target, f)
    if (statSync(p).isDirectory()) out.push(...collect(p))
    else if (f.toLowerCase().endsWith('.mdl')) out.push(p)
  }
  return out
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const targets = process.argv.slice(2)
  if (!targets.length) {
    console.error('использование: node tools/mdl.mjs <файл.mdl или каталог> [...]')
    process.exit(2)
  }

  const files = targets.flatMap(collect)
  if (!files.length) {
    console.error('моделей не найдено')
    process.exit(2)
  }

  let bad = 0
  for (const f of files) {
    const r = inspectModel(f)
    const worst = r.problems.find(p => p.severity === 'critical') ? 'ПЛОХО'
      : r.problems.length ? 'вопросы' : 'ок'
    if (worst !== 'ок') bad++

    console.log(`[${worst.padEnd(7)}] ${basename(f).padEnd(16)} ${String(r.size).padStart(8)} байт` +
      (r.counts ? `  текстур ${r.counts.numtextures}, анимаций ${r.counts.numseq}, частей ${r.counts.numbodyparts}` : ''))
    for (const p of r.problems) console.log(`            ${p.severity}: ${p.text}`)
  }

  console.log(`\nпроверено ${files.length}, с замечаниями ${bad}`)
  process.exit(bad ? 1 : 0)
}
