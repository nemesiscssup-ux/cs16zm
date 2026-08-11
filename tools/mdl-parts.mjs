// Какие части модели показывать на витрине, а какие выбросить.
//
// Вынесено отдельно затем, что этим правилом пользуются ДВОЕ: растеризатор
// (tools/mdl-render.mjs) рисует картинку для карточки, а сборщик
// (site/tools/build-models.mjs) готовит геометрию для просмотра в браузере.
// Разойдись они — на карточке будет одно, а в окне другое.
//
// ЗАЧЕМ ВООБЩЕ ВЫБРАСЫВАТЬ. Видовая модель оружия в CS 1.6 — это не только
// само оружие. Рядом лежат:
//
//   * РУКИ. Штатная модель кистей на 1188 вершин, одна и та же почти во всех
//     видовых моделях. В игре она к месту, на витрине — нет: текстуры на ней
//     почти нет, и в кадре это два больших гладких бревна поперёк оружия.
//   * ДУБЛИКАТ ОРУЖИЯ. У половины моделей оружие лежит дважды (у «Когтя» две
//     части по 1501 вершине). В игре показывают одну, движок переключает; мы
//     рисовали обе, и на карточке получались две руки с разным оружием.
//   * ЗАГОТОВКИ ЭФФЕКТОВ. Крошечные плоскости на 4–48 вершин с именами вида
//     ref_ef_lightning, ref_ef_swing — молния и след взмаха. Появляются только
//     в момент удара. У «Молота фараона» одна такая плоскость 975 единиц
//     высотой: кадр считался по ней, и оружие сжималось в точку.
//
// Правило намеренно консервативное: если часть не опознана уверенно — она
// остаётся. Лучше лишняя деталь, чем пропавшее оружие.

const HDR = { numtextures: 180, textureindex: 184, numbodyparts: 204, bodypartindex: 208 }

// Штатная модель кистей CS 1.6. Узнаём её по числу вершин, потому что имена
// частей в переделанных моделях сбиты в «_bodypart0» и ничего не говорят.
//
// ⚠️ С ДОПУСКОМ, А НЕ ТОЧНО. У «Бура» кисти на 1187 вершин, а не 1188:
// кто-то тронул модель, и точная проверка их пропустила — на карточке остался
// обрубок руки.
const HANDS_VERTS = 1188
const HANDS_TOLERANCE = 8

/*
 * ⚠️ ГЛАВНЫЙ ПРИЗНАК ЭФФЕКТА — ФЛАГ ТЕКСТУРЫ, А НЕ ИМЯ И НЕ РАЗМЕР.
 * STUDIO_NF_ADDITIVE (0x20) означает «рисовать сложением»: так помечают
 * свечения, следы взмаха и молнии. В игре они вспыхивают на удар, на витрине —
 * висят чёрными полотнищами поперёк оружия.
 *
 * Это надёжнее прежних догадок: у «Бура» эффект лежал ВНУТРИ той же части, что
 * и само оружие, и отсев по частям его достать не мог в принципе.
 */
const ADDITIVE = 0x20

const EFFECT_NAME = /(^|_)ef(_|$)|effect|glow|light|swing|blood|muzzle|flash|shell|smoke/i
const HANDS_NAME = /hand|arm|glove/i

// Части мельче этого — заготовки эффектов: плоскость в четыре вершины оружием
// быть не может.
const TINY_VERTS = 64

const apply = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
  m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
  m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
]

function partInfo(buf, bones, bat, i) {
  const at = bat + i * 76
  const name = buf.toString('latin1', at, at + 64).split('\0')[0]
  const nummodels = buf.readInt32LE(at + 64)
  const m = buf.readInt32LE(at + 72)
  if (nummodels <= 0) return null

  const subName = buf.toString('latin1', m, m + 64).split('\0')[0]
  const nv = buf.readInt32LE(m + 80)
  const vinfo = buf.readInt32LE(m + 84)
  const vidx = buf.readInt32LE(m + 88)
  if (nv <= 0) return null

  const mn = [Infinity, Infinity, Infinity]
  const mx = [-Infinity, -Infinity, -Infinity]
  for (let k = 0; k < nv; k++) {
    const w = apply(bones[buf[vinfo + k]] || bones[0], [
      buf.readFloatLE(vidx + k * 12),
      buf.readFloatLE(vidx + k * 12 + 4),
      buf.readFloatLE(vidx + k * 12 + 8),
    ])
    for (let c = 0; c < 3; c++) {
      if (w[c] < mn[c]) mn[c] = w[c]
      if (w[c] > mx[c]) mx[c] = w[c]
    }
  }

  return {
    i, name, subName, nv, mn, mx,
    size: Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]),
    centre: Math.hypot((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2),
  }
}

/** Доля объёма пересечения к объёму меньшего из двух. */
function overlap(a, b) {
  let inter = 1
  let volA = 1
  let volB = 1
  for (let c = 0; c < 3; c++) {
    const lo = Math.max(a.mn[c], b.mn[c])
    const hi = Math.min(a.mx[c], b.mx[c])
    // Плоские части дают нулевой объём — считаем толщину хотя бы в единицу,
    // иначе любое сравнение с ними выродится в ноль.
    inter *= Math.max(hi - lo, 0)
    volA *= Math.max(a.mx[c] - a.mn[c], 1)
    volB *= Math.max(b.mx[c] - b.mn[c], 1)
  }
  return inter / Math.min(volA, volB)
}

/**
 * Возвращает массив признаков «оставить» по номеру части либо null, если
 * выбрасывать нечего.
 *
 * $opts.hands — оставлять руки (по умолчанию нет).
 */
export function chooseParts(buf, bones, opts = {}) {
  const nb = buf.readInt32LE(HDR.numbodyparts)
  const bat = buf.readInt32LE(HDR.bodypartindex)

  // Текстуры-эффекты — отдельно: они отсекаются на уровне СЕТОК, а не частей,
  // и работают даже если часть у модели одна.
  const effectTex = new Set()
  {
    const nt = buf.readInt32LE(HDR.numtextures)
    const tat = buf.readInt32LE(HDR.textureindex)
    for (let i = 0; i < nt; i++) {
      const at = tat + i * 80
      if (at + 80 > buf.length) break
      if (buf.readInt32LE(at + 64) & ADDITIVE) effectTex.add(i)
    }
  }

  if (nb < 2) {
    return effectTex.size ? { keep: null, effectTex, why: [`текстур-эффектов: ${effectTex.size}`] } : null
  }

  const parts = []
  for (let i = 0; i < nb; i++) parts.push(partInfo(buf, bones, bat, i))

  const keep = parts.map(p => !!p)
  const why = []

  for (const p of parts) {
    if (!p) continue
    const label = `${p.name}/${p.subName}`
    if (EFFECT_NAME.test(label)) { keep[p.i] = false; why.push(`${p.i} эффект по имени`); continue }
    if (p.nv < TINY_VERTS) { keep[p.i] = false; why.push(`${p.i} мелкая (${p.nv} вершин)`); continue }
  }

  /*
   * Руки — РОВНО ОДНА часть, а не все подходящие под допуск.
   *
   * ⚠️ ИНАЧЕ ТЕРЯЕТСЯ ОРУЖИЕ. У «Молота фараона» кисти на 1188 вершин, а сам
   * молот — на 1189: допуск в восемь вершин записал в руки обе части, и на
   * карточке остались рукоять да пара кристаллов без золотой головы. Поэтому
   * из кандидатов выбираем ОДНОГО — того, чьё число вершин ближе к эталону, —
   * и только если после него что-то останется.
   */
  if (!opts.hands) {
    const cand = parts.filter(p => p && keep[p.i] &&
      (Math.abs(p.nv - HANDS_VERTS) <= HANDS_TOLERANCE || HANDS_NAME.test(`${p.name}/${p.subName}`)))
    if (cand.length && parts.filter(p => p && keep[p.i]).length > cand.length) {
      cand.sort((a, b) => Math.abs(a.nv - HANDS_VERTS) - Math.abs(b.nv - HANDS_VERTS))
      keep[cand[0].i] = false
      why.push(`${cand[0].i} руки (${cand[0].nv} вершин)`)
    }
  }

  // Выбросы по размеру и удалённости считаем ТОЛЬКО среди уцелевших: иначе
  // огромная плоскость эффекта задирает срединный размер и правило слепнет.
  const alive = parts.filter(p => p && keep[p.i])
  if (alive.length > 1) {
    const sizes = alive.map(p => p.size).sort((a, b) => a - b)
    const limit = Math.max(sizes[Math.floor(sizes.length / 2)] * 3, 1)
    for (const p of alive) {
      if (p.size > limit || p.centre > limit) {
        keep[p.i] = false
        why.push(`${p.i} выброс (размер ${p.size.toFixed(0)}, отступ ${p.centre.toFixed(0)})`)
      }
    }
  }

  /*
   * Дубликаты оружия.
   *
   * ⚠️ ОДНОГО ПЕРЕСЕЧЕНИЯ МАЛО. У «Когтя» оружие лежит дважды по 1501 вершине,
   * но копии стоят В РАЗНЫХ МЕСТАХ — вторая отведена в сторону под другую
   * анимацию. Габариты не пересекаются вовсе, и проверка по перекрытию их
   * пропускала: на карточке выходили два одинаковых оружия рядом.
   *
   * Поэтому копией считаем и то, что просто СОВПАДАЕТ ПО ЧИСЛУ ВЕРШИН и по
   * размеру, где бы ни лежало. Число вершин у двух разных предметов совпадает
   * до штуки крайне редко, а у копии — всегда.
   */
  const left = parts.filter(p => p && keep[p.i])
  for (let a = 0; a < left.length; a++) {
    if (!keep[left[a].i]) continue
    for (let b = a + 1; b < left.length; b++) {
      if (!keep[left[b].i]) continue
      // Точное совпадение числа вершин — уже достаточный признак. Размер не
      // сверяем: копия бывает повёрнута, и габаритная коробка у неё другая,
      // хотя меш тот же (так у «Когтя»: 1501 вершина в обеих частях).
      const sameCount = left[a].nv === left[b].nv
      const nearCount = Math.abs(left[a].nv - left[b].nv) <= Math.max(4, left[a].nv * 0.05)
      if (sameCount || (nearCount && overlap(left[a], left[b]) > 0.5)) {
        keep[left[b].i] = false
        why.push(`${left[b].i} копия части ${left[a].i}`)
      }
    }
  }

  // Ничего не осталось — значит правило ошиблось; лучше показать всё.
  if (!keep.some(Boolean)) return effectTex.size ? { keep: null, effectTex, why } : null
  if (effectTex.size) why.push(`текстур-эффектов: ${effectTex.size}`)
  return { keep, effectTex, why }
}
