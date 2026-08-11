// Перевод чужих путей на свои — при переносе, а не потом руками.
//
// Зачем: у клиента файлы лежат по пути и имени. Пока путь чужой
// (models/csdead1/…), игрок, скачавший такой же файл с другого сервера, наш
// качать не станет — покажет тот, что уже есть, со всей его начинкой. Смена
// пути и есть способ заставить перекачать.
//
// Почему в переносе, а не разовой правкой: перенос копирует исходники плагинов
// из карантина поверх наших, и разовая замена откатывалась при каждом запуске.
// На это уже наступили.

import { readFileSync, writeFileSync } from 'node:fs'

// Порядок важен: «jp_models_view» должен идти ПЕРЕД «jp_models», иначе первый
// же обмен съест общее начало и путь превратится в мусор.
export const PATHS = [
  ['models/csdead1/', 'models/zm_hot/'],
  ['models/jp_models_view/', 'models/zm_hot_v/'],
  ['models/jp_models/', 'models/zm_hot_w/'],
  ['sprites/csdead1/', 'sprites/zm_hot/'],
  ['sprites/jp_ef/', 'sprites/zm_hot_ef/'],
  ['sound/csdead1/', 'sound/zm_hot/'],
  // Без «sound/» в начале: часть плагинов пишет путь звука прямо от каталога
  // sound, и общее правило выше их не ловит. Так пропал звук крюка.
  ['"csdead1/', '"zm_hot/'],

  // ── «Казахский Пирог»: классы CSO ─────────────────────────────────────────
  // Свои каталоги донора у него разбросаны по всему дереву, и в каждом лежит
  // имя чужого сервера. Порядок важен: «sprites/reega/» раньше «Reega_kz/».
  ['models/tx/', 'models/zm_hot/'],
  ['sprites/tx/', 'sprites/zm_hot/'],
  ['sprites/reega/', 'sprites/zm_hot/'],
  ['sprites/Reega/', 'sprites/zm_hot/'],
  ['sound/tox_cso/zm_skills/', 'sound/zm_hot/'],
  ['"tox_cso/zm_skills/', '"zm_hot/'],
  ['sound/Reega_kz/', 'sound/zm_hot/'],
  ['"Reega_kz/', '"zm_hot/'],
  // ⚠️ Каждый звук нужен ДВУМЯ правилами: в коде путь пишется без «sound/»
  // (это ловит второе), а список ресурсов собирается по исходному тексту и
  // приходит сюда уже с «sound/» (это ловит первое). Без пары файл копируется
  // по чужому пути, а плагин ищет его по нашему — и звука нет.
  ['"warcraft3/', '"zm_hot/'],
  ['sound/warcraft3/', 'sound/zm_hot/'],
  ['sound/zombie_plague/', 'sound/zm_hot/'],
  // Модели, лежащие прямо в корне models/ у донора: без своего каталога они
  // столкнутся с чужими файлами того же имени у игрока.
  ['models/w_hiddentail', 'models/zm_hot/w_hiddentail'],
  ['sprites/cso_trailv2.spr', 'sprites/zm_hot/cso_trailv2.spr'],
  // Каталог мода у 4.3 назывался иначе. Заодно это уводит наши файлы от тех,
  // что игрок уже скачал с чужих серверов.
  ['models/zombie_plague/', 'models/zombie_plague_v44/'],
  ['"zombie_plague/', '"zm_hot/'],

  // Модели КЛАССОВ зомби задаются одним лишь именем: мод сам разворачивает его
  // в models/player/<имя>/<имя>.mdl. Имя донора при этом видно и в пути на
  // диске, и в списке загрузки у игрока, поэтому переименовываем и его.
  ['csdead1_electric', 'zm_hot_z_electric'],
  ['csdead1_student', 'zm_hot_z_student'],
  ['strong_siren2_z7p', 'zm_hot_z_siren'],
  ['strong_deimos2_z7p', 'zm_hot_z_deimos'],
  ['revenant_poison', 'zm_hot_z_revpoison'],
  ['revenant_ice', 'zm_hot_z_revice'],
  // ⚠️ ПОСЛЕ двух предыдущих: «revenant» — начало обоих, и если поменять его
  // первым, от них останется мусор вроде «zm_hot_z_rev_ice».
  ['{ "revenant" }', '{ "zm_hot_z_revfire" }'],
  ['player/revenant/revenant.mdl', 'player/zm_hot_z_revfire/zm_hot_z_revfire.mdl'],

  // Списки значков оружия в HUD лежат отдельными .txt прямо в sprites/ и
  // названы по сборке-донору. Имя списка ещё и вписано в сам плагин строкой
  // WEAPON_WEAPONLIST, поэтому меняем и там, и там — одним правилом.
  ['sprites/csdead1_', 'sprites/zm_hot_'],
  ['sprites/jp_weapon_', 'sprites/zm_hot_w_'],
  ['WEAPON_WEAPONLIST "csdead1_', 'WEAPON_WEAPONLIST "zm_hot_'],
  ['WEAPON_WEAPONLIST "jp_weapon_', 'WEAPON_WEAPONLIST "zm_hot_w_'],
]

// Переписывает пути в тексте. Возвращает число замен.
export function retargetText(text) {
  let out = text
  let n = 0
  for (const [from, to] of PATHS) {
    const parts = out.split(from)
    n += parts.length - 1
    out = parts.join(to)
  }
  return { text: out, count: n }
}

// Переписывает пути в файле на месте. Возвращает число замен.
export function retargetFile(path) {
  const { text, count } = retargetText(readFileSync(path, 'utf8'))
  if (count) writeFileSync(path, text, 'utf8')
  return count
}

// Куда ляжет ресурс после перевода: тем же правилом, что и ссылки в коде.
export function retargetPath(rel) {
  return retargetText(rel).text
}
