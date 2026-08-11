// Убирает с моделей рекламу сборки-донора.
//
// На скинах из готовых сборок нередко нарисован адрес чужого сервера — у
// Таноса из CS-DEAD это «by Reega! zm7uP.ru» на груди. Модель из-за этого
// выбрасывать жалко, а показывать игрокам чужую рекламу нельзя.
//
// Закрашиваем переносом: берём чистый кусок той же текстуры и копируем поверх
// надписи. Данные пикселей — байтовые индексы в палитре, поэтому размер файла
// не меняется и заголовок трогать не нужно.
//
// Список известных надписей ниже. Он же применяется автоматически при переносе
// моделей (tools/port-plugins.mjs), чтобы правка не терялась при пересборке.
//
// Запуск вручную: node tools/mdl-untag.mjs <файл.mdl>

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// model — имя файла без .mdl; tex — номер текстуры внутри модели;
// rect — что закрасить; from — откуда взять чистый кусок того же размера.
// from — откуда взять чистый кусок. Если его нет, надпись затирается СТРОКОЙ
// НАД НЕЙ, размноженной вниз: для текста на неоднородном фоне это надёжнее,
// чем угадывать «похожий» участок, и не оставляет заметного шва.
// Записей про csdead1_thanos здесь больше нет: модель убрана из сборки по
// просьбе владельца. Надписей на ней было пять — если она когда-нибудь
// вернётся, искать их надо заново, а не считать модель чистой.
export const ADS = [
  {
    // Текстура целиком — баннеры «COUNTER-STRIKE FEDERATION» и «CSPB MOD»,
    // то есть реклама чужого сообщества. Заливаем целиком.
    model: 'human_kirito_jp',
    what: 'баннеры «COUNTER-STRIKE FEDERATION / CSPB MOD»',
    tex: 4,
    rect: { x: 0, y: 0, w: 512, h: 512 },
    fill: { x: 2, y: 2 },
  },
  {
    model: 'csdead1_imperator',
    what: 'блок «ZM7UP.RU / TEXTURES BY REEGA! / VK.COM/ZM7UP» у арбуза',
    tex: 3,
    rect: { x: 288, y: 148, w: 206, h: 84 },
    fill: { x: 505, y: 250 },
  },
  {
    // Подпись автора вдоль нижнего края текстуры мяча. Под ней чёрный фон,
    // поэтому просто заливаем полосу им же.
    model: 'csdead1_main',
    what: 'подпись «Reega! 2017 Sport ball» на мяче',
    tex: 9,
    rect: { x: 0, y: 160, w: 256, h: 32 },
    fill: { x: 2, y: 2 },
  },

  {
    // Класс «Электрик» из CS-DEAD: адрес донора набран по нижнему краю
    // текстуры отвёртки, поверх чёрного фона. Заливаем этим же чёрным.
    model: 'csdead1_electric',
    what: 'строка «REEGA! VK.COM/ZM7UP | ZM7UP.RU» под отвёрткой',
    tex: 2,
    rect: { x: 0, y: 100, w: 256, h: 28 },
    // ⚠️ Точку заливки берём в углу: справа сверху там ручка отвёртки, и
    // «чёрная» полоса получилась ярко-жёлтой.
    fill: { x: 2, y: 2 },
  },
  {
    // ⚠️⚠️ ТА ЖЕ НАДПИСЬ ЕСТЬ И НА ЛАПЕ ЭТОГО КЛАССА, а лапу видно от первого
    // лица — то есть прямо перед глазами. Скин почистили, лапу пропустили:
    // модель другая, и по имени скина она не нашлась. Отсюда правило —
    // ЧИСТИТЬ ПАРУ «СКИН + ЛАПА», а не одну модель.
    model: 'v_claw_electric',
    what: 'строка «REEGA! VK.COM/ZM7UP |ZM7UP.RU» под отвёрткой (лапа класса)',
    tex: 1,
    rect: { x: 0, y: 108, w: 256, h: 20 },
    fill: { x: 2, y: 2 },
  },

  // Класс «Зараза»: подпись автора с датой в левом верхнем углу единственной
  // текстуры, поверх ровного тёмно-бордового фона.
  {
    model: 'v_z7_zaraza',
    what: 'подпись «Reega! - 21.05.2017» в углу',
    tex: 0,
    rect: { x: 12, y: 2, w: 184, h: 24 },
    fill: { x: 6, y: 44 },
  },

  // Лапа Шамана и та же текстура ножа внутри скина Сирены: подпись и дата
  // белым по тёмной ткани. Заливка тут заметна (ткань в крапинку), поэтому
  // переносим чистый кусок той же ткани снизу.
  {
    model: 'v_strong_siren3',
    what: 'подпись «reega indian knife / 25.05.2017» на ноже',
    tex: 1,
    rect: { x: 0, y: 0, w: 132, h: 26 },
    from: { x: 0, y: 68 },
  },
  {
    model: 'zm_hot_z_siren',
    what: 'подпись «reega indian knife / 25.05.2017» на ноже',
    tex: 3,
    rect: { x: 0, y: 0, w: 132, h: 26 },
    from: { x: 0, y: 68 },
  },

  // Ледяная граната: адрес чужого сообщества прямо посреди текстуры, на
  // чёрном фоне между нарисованными фруктами.
  {
    // ⚠️ ИМЯ ЗАНЯТО ДВАЖДЫ: своя v_grenade_frost.mdl есть и у самого мода, в
    // models/zombie_plague_v44, и она чистая. Без указания каталога проверка
    // смотрела модовскую и ругалась на нетронутую надпись в нашей.
    model: 'v_grenade_frost',
    dir: 'zm_hot',
    what: 'адрес «VK.COM/ZM7UP» посреди текстуры',
    tex: 0,
    rect: { x: 96, y: 216, w: 248, h: 40 },
    fill: { x: 84, y: 204 },
  },

  // «Пиксельный FAMAS» из магазина: у автора три подписи разом — дата сборки
  // сверху, «model created Reega! KAZAKHSTAN» во всю нижнюю кромку и приписка
  // про источник идеи справа внизу. Фон ровный зелёный, заливка незаметна.
  // Текстура вида и текстура «в руках» — разного размера, поэтому и
  // прямоугольники разные: у вида всё в полтора раза крупнее.
  {
    model: 'q_famas_pixel',
    what: 'дата «11.08.2017 (05:57 AM)»',
    tex: 0,
    rect: { x: 14, y: 3, w: 230, h: 28 },
    fill: { x: 4, y: 160 },
  },
  {
    model: 'q_famas_pixel',
    what: 'подпись «model created Reega! KAZAKHSTAN»',
    tex: 0,
    rect: { x: 0, y: 222, w: 354, h: 30 },
    fill: { x: 4, y: 160 },
  },
  {
    model: 'q_famas_pixel',
    what: 'приписка «idea in game: SF-2»',
    tex: 0,
    rect: { x: 408, y: 204, w: 96, h: 38 },
    fill: { x: 4, y: 160 },
  },
  {
    model: 'v_famas_pixel_z',
    what: 'дата «11.08.2017 (05:57 AM)»',
    tex: 1,
    rect: { x: 20, y: 6, w: 346, h: 42 },
    fill: { x: 6, y: 240 },
  },
  {
    model: 'v_famas_pixel_z',
    what: 'подпись «model created Reega! KAZAKHSTAN»',
    tex: 1,
    rect: { x: 0, y: 334, w: 528, h: 44 },
    fill: { x: 6, y: 240 },
  },
  {
    model: 'v_famas_pixel_z',
    what: 'приписка «idea in game: SF-2»',
    tex: 1,
    rect: { x: 614, y: 308, w: 140, h: 54 },
    fill: { x: 6, y: 240 },
  },

  // Скин «Змейка»: строка ярко-зелёных букв прижата к самому низу текстуры,
  // прочесть их нельзя даже при увеличении в двадцать раз, но чужая подпись
  // это или нет — на ткани платья ей не место. Ткань в вертикальную полоску,
  // поэтому затираем строкой НАД надписью (способ по умолчанию): полоски
  // продолжаются вниз сами собой, а любая заливка дала бы ровное пятно.
  {
    model: 'zm_hot_zmeya',
    what: 'строка зелёных букв по нижнему краю платья',
    tex: 0,
    rect: { x: 248, y: 501, w: 128, h: 11 },
  },

  // Тяжёлый зомби из каталога автозагрузки клиента. Донор другой — китайский
  // игровой портал, — но суть та же: свой адрес поверх чужой работы.
  {
    model: 'heavy_zombi_pak3',
    what: 'полоса «WWW.175PT.COM» над тесаком',
    tex: 4,
    rect: { x: 0, y: 0, w: 170, h: 34 },
    fill: { x: 260, y: 8 },
  },
  {
    model: 'heavy_zombi_pak3',
    what: 'клеймо «175PT» на самом тесаке',
    tex: 4,
    rect: { x: 144, y: 42, w: 46, h: 78 },
    // Берём кусок самого лезвия слева: затирание строкой оставляло светлую
    // полосу — над клеймом там фон, а не металл.
    from: { x: 96, y: 42 },
  },

  // Лапа ДЬЯВОЛА — китайский дао из того же пака (подмодель 1 «cso_china_dao»).
  // Текстура лезвия у неё та же, что у скина выше, и реклама на ней та же —
  // только номер текстуры после вырезания становится первым.
  // ⚠️ Раньше эта лапа была у Толстяка; ему отдали подмодель 0 с мясницким
  // тесаком, а рекламы на ней нет — записи ниже переехали вместе с дао.
  // ⚠️ Прямоугольники ЗДЕСЬ СВОИ, а не те же, что у скина выше: текстура лезвия
  // в паке скина и в паке лапы одна по смыслу, но разной ширины, и чужие
  // координаты закрасили половину баннера, а клеймо на лезвии продублировали
  // черепом. Замерены по вынутой текстуре 384x198.
  {
    model: 'v_zm_hot_nemesis',
    what: 'баннер «175PT / WWW.175PT.COM» в левом верхнем углу',
    tex: 1,
    rect: { x: 0, y: 0, w: 190, h: 44 },
    // Крапчатый тёмный фон правее баннера — им и заливаем.
    fill: { x: 330, y: 10 },
  },
  {
    model: 'v_zm_hot_nemesis',
    what: 'вертикальное клеймо «175PT» на лезвии',
    tex: 1,
    // Ровной заливкой, а не переносом: рядом череп и цветные камни, и любой
    // «похожий» кусок оставлял двойника. Полоса узкая — шире залезает на камни
    // рукояти, и вместо клейма получается заметный тёмный блок.
    rect: { x: 183, y: 50, w: 24, h: 98 },
    fill: { x: 176, y: 100 },
  },

  // ── подарочные формы VIP и Лидера ────────────────────────────────────────
  //
  // На обеих нашит герб чужого сообщества: щит с бойцом и винтовкой, под ним
  // строка в два пикселя высотой. В игре она нечитаема, но сам герб виден
  // отчётливо — владелец заметил его на витрине сайта, где модель крупнее.
  //
  // Источник — гладкое поле футболки НИЖЕ номера: та же ткань, те же складки.
  // Три подхода, прежде чем сошлось, и все три стоит помнить:
  //   * перенос строки сверху (по умолчанию) оставил плоский светлый
  //     прямоугольник в полоску — заметнее самого герба;
  //   * кусок правее герба притащил с собой БЕЛЫЙ ШОВ РУКАВА, и на груди
  //     появилась вторая диагональная линия из ниоткуда;
  //   * заплатка со спины на грудь легла светлее фона: спина освещена иначе.
  // Отсюда правило: брать кусок с той же детали и подальше от швов и надписей.
  //
  // ⚠️ Номера «VIP» и «9» на груди и спине — НАШИ, они и есть облик уровня
  // («Форма VIP», «Форма 9»). Их не трогаем.
  {
    model: 'zm_hot_form_vip',
    what: 'герб чужого сообщества на груди',
    tex: 0,
    rect: { x: 158, y: 37, w: 34, h: 42 },
    from: { x: 78, y: 130 },
  },
  {
    model: 'zm_hot_form9',
    what: 'герб чужого сообщества на груди',
    tex: 0,
    // ⚠️ Высота 46, а не 34: под щитом идёт узкая строка, и обрезав по щиту, я
    // оставил её видимой — на модели она читалась как «…up». Проверять надо
    // РИСУНКОМ модели, а не развёрткой: на развёртке этот огрызок теряется.
    rect: { x: 155, y: 38, w: 36, h: 46 },
    from: { x: 78, y: 132 },
  },
  {
    // Спину чиним куском с той же спины, но ниже: там гладкое поле под
    // номером, а не другая деталь.
    model: 'zm_hot_form9',
    what: 'надпись «LRA» на спине',
    tex: 0,
    rect: { x: 313, y: 85, w: 58, h: 30 },
    from: { x: 313, y: 162 },
  },

  // ── «Отпускник» (уровень Император) ──────────────────────────────────────
  //
  // «ZM7UP.RU» поперёк груди. Искали долго и не там: на развёртке это не
  // надпись, а неприметный золотой брусок 30×30 в стороне от одежды —
  // потому что САМИ БУКВЫ ЗДЕСЬ ГЕОМЕТРИЯ, отдельные плоскости перед грудью,
  // и брусок им только красит поверхность.
  //
  // ⚠️⚠️ ЗАКРАСКА ЗДЕСЬ НЕДОСТАТОЧНА, И ЭТО ГЛАВНОЕ. Перекрасить геометрию
  // значит поменять буквам цвет, а не убрать их: под освещением плоскости
  // по-прежнему видны рельефом. Я на этом ошибся — доложил «убрано», потому
  // что мой растеризатор рисовал без света и плоские буквы в нём исчезали.
  // НАСТОЯЩЕЕ удаление делает tools/mdl-cut.mjs: он схлопывает вершины букв в
  // одну точку, и треугольники нулевой площади просто не рисуются.
  //
  // Запись оставлена намеренно: она гасит источник цвета, а вырезка убирает
  // сами буквы. Порядок не важен, но применять надо ОБЕ.
  //
  // Найти такое на глаз по развёртке нельзя — нашлось растеризацией модели и
  // обратной трассировкой золотых пикселей в точку (122,186).
  {
    model: 'zm_hot_otpusk',
    what: 'надпись «ZM7UP.RU» поперёк груди (буквы — геометрия)',
    tex: 0,
    rect: { x: 110, y: 168, w: 38, h: 38 },
    fill: { x: 24, y: 380 },
  },

  // У Лидера та же беда и то же устройство: «vk.com/zm7up» поперёк груди
  // отдельными плоскостями, красятся они куском ТЕКСТУРЫ 1 — светлой ткани от
  // неиспользуемого платья. Здесь так же: закраска гасит цвет, а сами буквы
  // вырезает tools/mdl-cut.mjs.
  {
    model: 'zm_hot_form9',
    what: 'надпись «vk.com/zm7up» поперёк груди (буквы — геометрия)',
    tex: 1,
    rect: { x: 230, y: 458, w: 38, h: 40 },
    fill: { x: 250, y: 502 },
  },
]

// Реклама донора бывает не только нарисована, но и вписана в сам файл: у
// гранаты-головы части модели названы «vk.com/zm7up», «ZM7UP.RU», «Reega!
// KAZAKHSTAN». Игроку это не видно, но в файлах сборки чужой адрес лежать не
// должен — владелец просил убрать чужие названия отовсюду.
//
// Трогаем подписи, по которым движок ничего не ищет: названия ЧАСТЕЙ, названия
// ПОДМОДЕЛЕЙ и — только у моделей со своими текстурами внутри — названия
// текстур.
//
// ⚠️ У модели БЕЗ внутренних текстур (numtextures == 0) их вообще нет: они
// лежат в отдельном файле «имяT.mdl», который движок ищет ПО ИМЕНИ ФАЙЛА, а не
// по названию текстуры. Поэтому переименование внутренних названий пару не
// разрывает. Раньше здесь стояло «названия текстур не трогаем» — осторожность
// была лишней, а чужой адрес оставался в двух десятках файлов.
// ⚠️ «DM_Base» и «remap1..3» НЕ ТРОГАТЬ НИКОГДА, даже если совпадут: по этим
// именам движок перекрашивает модель игрока под цвет команды.
// ⚠️ ПОДПИСЫВАЛСЯ ОН ПО-РАЗНОМУ. Кроме «Reega» в файлах встречаются «REGA»
// (с одной «е») и «Bereke» — его второе имя, оно же в port-claw.mjs. По
// шаблону только с «reega» восемь названий оставались нетронутыми.
// Проверено по всем 205 моделям сборки: под «rega|bereke» не попадает ни одно
// невинное название.
// ⚠️ Числовой адрес сервера ловим ОТДЕЛЬНЫМ правилом, и это не перестраховка:
// у p_knife7 («Молот фараона») часть модели названа «46.174.52.22:27313» —
// чужой сервер прописан цифрами, без единого слова из списка выше. Проверка по
// словам его пропускала, и адрес доехал бы до игроков в файлах сборки.
export const NAME_ADS = /zm7up|reega|rega|bereke|z7p|175pt|cspb|vk\.com|https?:|\.ru\b|\.com\b|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/i
const KEEP_NAME = /^(dm_base|remap\d)/i

// Все подписи модели: список для проверки, что чужого адреса не осталось.
export function partNames(file) {
  const buf = readFileSync(file)
  if (buf.length < 244 || buf.readUInt32LE(0) !== 0x54534449) return []

  const out = []
  for (const spot of nameSpots(buf)) out.push(spot.name)
  return out
}

// Где в файле лежат подписи: одно место — 64 байта под имя.
function nameSpots(buf) {
  const spots = []

  const numTex = buf.readInt32LE(180)
  const texIx = buf.readInt32LE(184)
  for (let i = 0; i < numTex; i++) {
    const at = texIx + i * 80
    if (at + 80 > buf.length) break
    spots.push({ at, kind: 'текстура', fresh: `texture${i}.bmp`, name: buf.toString('latin1', at, at + 64).replace(/\0.*/s, '') })
  }

  const numBp = buf.readInt32LE(204)
  const bpIx = buf.readInt32LE(208)
  for (let b = 0; b < numBp; b++) {
    const at = bpIx + b * 76
    if (at + 76 > buf.length) break
    spots.push({ at, kind: 'часть', fresh: `part${b + 1}`, name: buf.toString('latin1', at, at + 64).replace(/\0.*/s, '') })

    const numM = buf.readInt32LE(at + 64)
    const mIx = buf.readInt32LE(at + 72)
    for (let m = 0; m < numM; m++) {
      const mat = mIx + m * 112
      if (mat + 112 > buf.length) break
      spots.push({ at: mat, kind: 'подмодель', fresh: `body${b + 1}_${m + 1}`, name: buf.toString('latin1', mat, mat + 64).replace(/\0.*/s, '') })
    }
  }

  return spots
}

export function scrubNames(file) {
  const buf = readFileSync(file)
  if (buf.length < 244 || buf.readUInt32LE(0) !== 0x54534449) return null

  const found = []
  for (const spot of nameSpots(buf)) {
    if (!NAME_ADS.test(spot.name) || KEEP_NAME.test(spot.name)) continue

    // Длина поля фиксирована, поэтому размер файла не меняется и заголовок
    // остаётся верным.
    buf.fill(0, spot.at, spot.at + 64)
    Buffer.from(spot.fresh, 'latin1').copy(buf, spot.at)
    found.push(`${spot.kind} «${spot.name}»`)
  }

  if (!found.length) return null
  writeFileSync(file, buf)
  return found
}

// ── ВИЗИТКА ДОНОРА: ОТДЕЛЬНЫЙ КУСОК МОДЕЛИ, А НЕ НАДПИСЬ НА ТЕКСТУРЕ ─────────
//
// В моделях от «Казахского Пирога» вшит плоский прямоугольник 94 на 66 юнитов
// со своей текстурой — картинкой «Reega! + 魂月 + Peter Ferra + GoldenNICK =
// Best Friends, 17.11.2016». Он одинаков во всех десяти моделях, где нашёлся:
// ножи, лапы зомби, стволы магазина.
//
// Ищем по приметам, а не по списку моделей: своя текстура, которой больше
// никто не покрыт, ровно две треугольника на четырёх вершинах и плоский
// прямоугольник крупнее ладони. Так визитка найдётся и в модели, которую
// перенесут завтра.
//
// Убираем двумя движениями:
//   1. Сводим все четыре вершины в одну точку. Треугольник нулевой площади не
//      рисует ни программный отрисовщик, ни OpenGL — куска просто нет.
//   2. Заливаем саму текстуру чёрным, чтобы картинки не осталось и в файле.
// Размер файла не меняется: правим байты на месте.
const PLATE_MIN = 32     // меньше — это эффект (вспышка, след, дым), не подпись

export function findPlates(file) {
  const buf = readFileSync(file)
  if (buf.length < 244 || buf.readUInt32LE(0) !== 0x54534449) return []

  const numTex = buf.readInt32LE(180)
  const texIx = buf.readInt32LE(184)
  const numBp = buf.readInt32LE(204)
  const bpIx = buf.readInt32LE(208)

  const users = new Map()
  const maybe = []

  for (let b = 0; b < numBp; b++) {
    const at = bpIx + b * 76
    if (at + 76 > buf.length) break
    const numM = buf.readInt32LE(at + 64)
    const mIx = buf.readInt32LE(at + 72)
    for (let m = 0; m < numM; m++) {
      const mat = mIx + m * 112
      if (mat + 112 > buf.length) break
      const numVerts = buf.readInt32LE(mat + 80)
      const vertIx = buf.readInt32LE(mat + 88)
      const numMesh = buf.readInt32LE(mat + 72)
      const meshIx = buf.readInt32LE(mat + 76)

      for (let k = 0; k < numMesh; k++) {
        const me = meshIx + k * 20
        if (me + 20 > buf.length) break
        const tris = buf.readInt32LE(me)
        const ref = buf.readInt32LE(me + 8)
        users.set(ref, (users.get(ref) ?? 0) + 1)
        if (tris !== 2 || numVerts !== 4 || ref < 0 || ref >= numTex) continue

        const lo = [Infinity, Infinity, Infinity]
        const hi = [-Infinity, -Infinity, -Infinity]
        for (let v = 0; v < numVerts; v++) {
          for (let c = 0; c < 3; c++) {
            const val = buf.readFloatLE(vertIx + v * 12 + c * 4)
            if (val < lo[c]) lo[c] = val
            if (val > hi[c]) hi[c] = val
          }
        }
        const size = hi.map((v, i) => v - lo[i])
        const flat = size.filter(v => v < 0.01).length === 1
        const big = size.filter(v => v >= PLATE_MIN).length === 2
        if (!flat || !big) continue

        const tat = texIx + ref * 80
        if (buf.readInt32LE(tat + 68) < 128 || buf.readInt32LE(tat + 72) < 128) continue

        maybe.push({ bodypart: b, model: m, tex: ref, vertIx, numVerts,
          size: size.map(v => v.toFixed(1)).join('x') })
      }
    }
  }

  // Своя текстура — последняя примета: у настоящей детали модели текстура
  // общая с соседями, у визитки она только своя.
  return maybe.filter(p => users.get(p.tex) === 1)
}

export function hidePlates(file) {
  const plates = findPlates(file)
  if (!plates.length) return null

  const buf = readFileSync(file)
  const texIx = buf.readInt32LE(184)
  const done = []

  for (const plate of plates) {
    for (let v = 0; v < plate.numVerts; v++) {
      for (let c = 0; c < 3; c++) buf.writeFloatLE(0, plate.vertIx + v * 12 + c * 4)
    }

    const at = texIx + plate.tex * 80
    const width = buf.readInt32LE(at + 68)
    const height = buf.readInt32LE(at + 72)
    const dataAt = buf.readInt32LE(at + 76)
    // Заливаем нулевым индексом и делаем нулевой цвет палитры чёрным: другие
    // цвета этой текстуре больше не нужны, ею ничего не покрыто.
    buf.fill(0, dataAt, dataAt + width * height)
    buf.fill(0, dataAt + width * height, dataAt + width * height + 3)
    done.push(`часть ${plate.bodypart}.${plate.model}, ${plate.size} юнитов, текстура ${plate.tex}`)
  }

  writeFileSync(file, buf)
  return done
}

// modelName задаётся отдельно, когда файл уже переименован под наш префикс:
// искать надпись надо по ИСХОДНОМУ имени модели, а не по новому.
export function untag(file, modelName = null) {
  const name = (modelName ?? basename(file, '.mdl')).toLowerCase()
  const jobs = ADS.filter(a => a.model.toLowerCase() === name)
  if (!jobs.length) return null

  const buf = readFileSync(file)
  if (buf.length < 244 || buf.readUInt32LE(0) !== 0x54534449) return null

  const numTextures = buf.readInt32LE(180)
  const textureIndex = buf.readInt32LE(184)
  const done = []

  for (const job of jobs) {
    if (job.tex >= numTextures) continue

    const at = textureIndex + job.tex * 80
    const width = buf.readInt32LE(at + 68)
    const height = buf.readInt32LE(at + 72)
    const dataAt = buf.readInt32LE(at + 76)
    if (width <= 0 || height <= 0 || dataAt <= 0) continue

    const { x, y, w, h } = job.rect
    if (x + w > width || y + h > height) continue

    if (job.fill) {
      const colour = buf[dataAt + job.fill.y * width + job.fill.x]
      for (let row = 0; row < h; row++) buf.fill(colour, dataAt + (y + row) * width + x, dataAt + (y + row) * width + x + w)
    } else if (job.from) {
      if (job.from.x + w > width || job.from.y + h > height) continue
      // Сверху вниз, чтобы перенос сверху не затирал сам себя.
      for (let row = 0; row < h; row++) {
        const src = dataAt + (job.from.y + row) * width + job.from.x
        const dst = dataAt + (y + row) * width + x
        buf.copy(buf, dst, src, src + w)
      }
    } else {
      // Строка НАД надписью, размноженная вниз. Если надпись прижата к самому
      // верху текстуры — берём строку под ней.
      const srcRow = y > 0 ? y - 1 : Math.min(y + h, height - 1)
      const src = dataAt + srcRow * width + x
      for (let row = 0; row < h; row++) {
        buf.copy(buf, dataAt + (y + row) * width + x, src, src + w)
      }
    }
    done.push(job.what)
  }

  if (!done.length) return null
  writeFileSync(file, buf)
  return done
}

// Проход по всем моделям сборки: закрасить рекламу, убрать визитки, затереть
// подписи. Нужен потому, что модели лежат в репозитории готовыми, и заново их
// никто не переносит: правка в списке выше сама по себе до файлов не доходит.
// Повторный запуск ничего не портит — все три правки идемпотентны.
export function untagAll(roots) {
  const files = []
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.toLowerCase().endsWith('.mdl')) files.push(p)
    }
  }
  for (const r of roots) if (existsSync(r)) walk(r)
  files.sort()

  const report = { files: files.length, ads: 0, plates: 0, names: 0, lines: [] }
  for (const file of files) {
    const say = []
    const ads = untag(file)
    if (ads) { report.ads += ads.length; say.push(`реклама: ${ads.join('; ')}`) }
    const plates = hidePlates(file)
    if (plates) { report.plates += plates.length; say.push(`визитка: ${plates.join('; ')}`) }
    const names = scrubNames(file)
    if (names) { report.names += names.length; say.push(`подписи: ${names.join(', ')}`) }
    if (say.length) report.lines.push(`${basename(file)}: ${say.join(' | ')}`)
  }
  return report
}

// Запуск из командной строки: путь к модели или --all по всей сборке.
if (process.argv[1] && process.argv[1].endsWith('mdl-untag.mjs')) {
  const file = process.argv[2]
  if (!file) {
    console.error('использование: node tools/mdl-untag.mjs <файл.mdl> | --all')
    console.error(`известных надписей: ${ADS.length} — ${[...new Set(ADS.map(a => a.model))].join(', ')}`)
    process.exit(2)
  }
  if (file === '--all') {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const report = untagAll([join(root, 'custom', 'content', 'models'), join(root, 'custom', 'models')])
    for (const line of report.lines) console.log(line)
    console.log(`\nмоделей просмотрено ${report.files}: закрашено надписей ${report.ads}, снято визиток ${report.plates}, затёрто подписей ${report.names}`)
  } else {
    const done = untag(file)
    console.log(done ? `${basename(file)}: закрашено — ${done.join('; ')}` : `${basename(file)}: закрашивать нечего`)
    const plates = hidePlates(file)
    if (plates) console.log(`${basename(file)}: снято визиток — ${plates.join('; ')}`)
    const names = scrubNames(file)
    if (names) console.log(`${basename(file)}: затёрто подписей — ${names.join(', ')}`)
  }
}
