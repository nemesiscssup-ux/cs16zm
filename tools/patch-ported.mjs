// Наши правки в ПЕРЕНЕСЁННЫХ плагинах.
//
// Переносчик копирует исходники из карантина при каждом запуске, поэтому
// править их на месте бесполезно: следующий перенос вернёт чужой вариант.
// Ровно та же история, что с модом, и лечится тем же — правки описаны здесь
// парами «найти → заменить» и применяются в момент переноса.
//
// Каждая правка ОБЯЗАНА совпасть указанное число раз. Не совпала — перенос
// падает с внятным сообщением, а не собирает сервер без половины правок.

import { readFileSync, writeFileSync } from 'node:fs'

export const PATCHES = [
  {
    plugin: 'zp_all_hook',
    id: 'крюк: объявление квара',
    find: 'public plugin_init() {\n\tregister_clcmd("+free_hook", "free_hook_on")',
    replace: [
      '// Крюк — возможность АДМИНКИ (просьба владельца). Флаг админ-меню «u»',
      '// есть и у полных прав, и у купленной админки, то есть у всех, кто за',
      '// неё заплатил. Квар оставлен, чтобы открыть крюк всем без пересборки.',
      'new cvar_hook_admin',
      '',
      'public plugin_init() {',
      '\tcvar_hook_admin = register_cvar("zp_hook_admin_only", "1")',
      '',
      '\tregister_clcmd("+free_hook", "free_hook_on")',
    ].join('\n'),
  },
  {
    plugin: 'zp_all_hook',
    id: 'крюк: проверка прав',
    find: 'public free_hook_on(id) {\n\tif(!is_user_alive(id))\n\t\treturn PLUGIN_HANDLED',
    replace: [
      'public free_hook_on(id) {',
      '\tif(!is_user_alive(id))',
      '\t\treturn PLUGIN_HANDLED',
      '',
      '\tif(get_pcvar_num(cvar_hook_admin) && !(get_user_flags(id) & ADMIN_MENU)) {',
      '\t\tclient_print_color(id, print_team_default,',
      '\t\t\t"^x04[ZP]^x01 Крюк — возможность администратора. Повесить на клавишу: bind f +free_hook")',
      '\t\treturn PLUGIN_HANDLED',
      '\t}',
    ].join('\n'),
  },
]

// Два класса зомби приехали из CS-DEAD как есть. Здоровье у них 5000 —
// больше, чем у любого нашего класса за привилегию, то есть бесплатный класс
// оказывался сильнее купленного. Правим здесь, а не в карантине: карантин —
// доказательная база, его трогать нельзя.
//
// Вторая строка пункта меню у нас везде говорит, кому класс доступен, а не
// чем он хорош: в меню классов это важнее.
for (const [plugin, wasName, wasInfo, name, info, hp] of [
  ['zp_zclass_electric', 'Електрик',  'Скорость',    'Электрик',  '\\rРёв (E)', 2200],
  ['zp_zclass_student',  'Студентка', 'Гравитация',  'Студентка', '\\rСкачок (E)', 1900],
]) {
  PATCHES.push({
    plugin,
    id: `${plugin}: название и подпись класса`,
    find: `new const ZCLASS_NAME[] = "${wasName}"\nnew const ZCLASS_INFO[] = "${wasInfo}"`,
    replace: `new const ZCLASS_NAME[] = "${name}"\nnew const ZCLASS_INFO[] = "${info}"`,
  })
  PATCHES.push({
    plugin,
    id: `${plugin}: здоровье по нашей шкале`,
    find: 'const ZCLASS_HP = 5000',
    replace: `const ZCLASS_HP = ${hp}`,
  })
}

// ── классы CSO из «Казахского Пирога» ─────────────────────────────────────────
//
// В сборке-доноре у них 7500-15000 здоровья — вдвое-вчетверо больше, чем у
// любого нашего класса, и такой зомби превращает раунд в избиение. Приводим к
// нашей шкале.
//
// Подпись класса — это вторая строка пункта меню, и её видно ДО выбора. Пишем
// в неё способность и КЛАВИШУ: жалоба владельца «не понятно, какие
// способности» была именно про это. Уровень туда же — в меню важнее всего
// знать, кому класс доступен.
//
// ⚠️ Разметка `\r` в подписи — цвет пункта у мода, а не перевод строки.
for (const [plugin, wasName, wasInfo, name, info, hp, speed] of [
  ['cso_class_shaman', '"Шаман" // name', '"\\rГипноз R" // description',
    // Шаман открыт ВСЕМ (просьба владельца 12 августа 2026): уровня в подписи
    // нет, и в g_foreign плагина охраны его имени тоже нет.
    '"Шаман"', '"\\rГипноз (R)"', 3200, 250],
  ['cso_class_ganymede', '"Ганимед"', '"\\rРазгон G"',
    '"Ганимед"', '"\\rРазгон (G) \\yVIP"', 3000, 250],
  ['cso_class_revenant_fire', '{ "Ревенант FIRE" } // name', '{ "\\r[VIP]" } // description',
    '{ "Ревенант Огонь" }', '{ "\\rОгненный шар (G) \\yЛидер" }', 3600, 260],
  ['cso_class_revenant_ice', '{ "Ревенант ICE" } // name', '{ "\\r[ADMIN]" } // description',
    '{ "Ревенант Лёд" }', '{ "\\rПаралич (G) \\yИмператор" }', 3400, 245],
  ['cso_class_revenant_poison_boss', '{ "Ревенант POISON" } // name', '{ "\\r[Босс]" } // description',
    '{ "Ревенант Яд" }', '{ "\\rЯдовитый шар (G) \\yФараон" }', 4000, 255],
]) {
  PATCHES.push({
    plugin,
    id: `${plugin}: название и подпись класса`,
    find: `new const zclass_name[] = ${wasName}\nnew const zclass_info[] = ${wasInfo}`,
    replace: `new const zclass_name[] = ${name}\nnew const zclass_info[] = ${info}`,
  })
}

for (const [plugin, wasHp, hp] of [
  ['cso_class_shaman', 7500, 3200],
  ['cso_class_ganymede', 8500, 3000],
  ['cso_class_revenant_fire', 9500, 3600],
  ['cso_class_revenant_ice', 9000, 3400],
  ['cso_class_revenant_poison_boss', 15000, 4000],
]) {
  PATCHES.push({
    plugin,
    id: `${plugin}: здоровье по нашей шкале`,
    find: `const zclass_health = ${wasHp}`,
    replace: `const zclass_health = ${hp}`,
  })
}

// ⚠️ Плагин объявляет свою `GIB_NEVER = 0`, а в наших включениях (cssdk_const)
// это уже макрос со значением 1. Строка разворачивается в `const 1 = 0` и
// компилятор падает с невнятным «invalid symbol name ""». Убираем объявление:
// значение из SDK не только не мешает, но и ВЕРНОЕ — в движке GIB_NORMAL это 0,
// а GIB_NEVER это 1, то есть у донора «никогда не разрывать» на деле означало
// «разрывать как обычно».
PATCHES.push({
  plugin: 'cso_class_shaman',
  id: 'cso_class_shaman: не переобъявлять GIB_NEVER из SDK',
  find: 'const GIB_NEVER =\t\t0',
  replace: '// GIB_NEVER берём из cssdk_const: там верное значение 1',
})

// ⚠️ У трёх «Ревенантов» есть СВОЯ охрана по уровню: в zp_user_infected_pre они
// смотрят флаг (у каждого свой — c, d, e) и возвращают класс к обычному с
// сообщением вроде «Данный класс только для VIP». Это ломает нашу схему сразу
// с двух сторон: буквы флагов у нас означают покупаемые уровни, а сообщение и
// правила доступа должны быть одни на все классы. Охрану снимаем — её ведёт
// zp_zclass_vip, по имени класса и по нашему уровню.
for (const [plugin, flag] of [
  ['cso_class_revenant_fire', 'ADMIN_KICK'],
  ['cso_class_revenant_ice', 'ADMIN_BAN'],
  ['cso_class_revenant_poison_boss', 'ADMIN_SLAY'],
]) {
  PATCHES.push({
    plugin,
    id: `${plugin}: снять чужую охрану по флагу`,
    find: `    \tif(!(get_user_flags(id) & ${flag})) `,
    replace: '    \t// Охрану по уровню ведёт zp_zclass_vip — здесь она мешала\n    \tif (false) ',
  })
}

// ── единый язык способностей ──────────────────────────────────────────────────
//
// В сборке-доноре каждый класс говорил по-своему: «Востановление через 5
// секунд», «Ждите еще 5 секунд», «[Способность через : 5]», «Скилл Готов.
// нажми G». Владелец попросил привести к одному виду — берём тот же, что у
// наших классов: «Откат: N» и «Способность готова».
//
// Ганимед вдобавок звал `%L` из словаря `cso_classes.txt`, которого в нашей
// сборке нет, и вместо надписи в углу висело «ML_NOTFOUND». Словарь не тянем:
// одна строка на класс проще словаря на сорок ключей, и переводить нечего.
PATCHES.push(
  {
    plugin: 'cso_class_ganymede',
    id: 'cso_class_ganymede: не звать чужой словарь',
    find: '\tregister_dictionary("cso_classes.txt")',
    replace: '\t// Словарь донора не переносим — тексты ниже свои',
  },
  {
    plugin: 'cso_class_ganymede',
    id: 'cso_class_ganymede: подсказка о способности',
    find: '\t\tcolor_chat(id, "%L", id, "CSO_CLASS_HUNTER_SPOSOB")',
    replace: '\t\tcolor_chat(id, "!g[Вспышка эпидемии]!y Способность класса: !gРазгон!y — клавиша !gG!y.")',
  },
  {
    plugin: 'cso_class_ganymede',
    id: 'cso_class_ganymede: надпись отката',
    find: '\t\tshow_dhudmessage(id, "%L", id, "CSO_CLASS_RELOAD", i_cooldown_time[id])',
    replace: '\t\tshow_dhudmessage(id, "Откат: %d", i_cooldown_time[id])',
  },
  {
    plugin: 'cso_class_ganymede',
    id: 'cso_class_ganymede: способность готова',
    find: '\t\tcolor_chat(id, "%L", id, "CSO_CLASS_HUNTER_SPOSOB2")',
    replace: '\t\tcolor_chat(id, "!g[Вспышка эпидемии]!y Способность готова.")',
  },
)

for (const plugin of ['cso_class_revenant_fire', 'cso_class_revenant_poison_boss']) {
  PATCHES.push(
    {
      plugin,
      id: `${plugin}: надпись отката`,
      find: '\t\tclient_print(id,print_center,"Востановление через %d секунд",g_can[id])',
      replace: '\t\tclient_print(id,print_center,"Откат: %d",g_can[id])',
    },
    {
      plugin,
      id: `${plugin}: способность готова`,
      find: '\tif(!g_can[id]) client_print(id,print_center,"Способность активна!")',
      replace: '\tif(!g_can[id]) client_print(id,print_center,"Способность готова")',
    },
  )
}

PATCHES.push(
  {
    plugin: 'cso_class_revenant_ice',
    id: 'cso_class_revenant_ice: надпись отката',
    find: '\t\tclient_print(id,print_center,"Ждите еще %d секунд",g_can[id])',
    replace: '\t\tclient_print(id,print_center,"Откат: %d",g_can[id])',
  },
  {
    plugin: 'cso_class_revenant_ice',
    id: 'cso_class_revenant_ice: способность готова',
    find: '\tif(!g_can[id]) client_print(id,print_center,"Скилл Готов. нажми G")',
    replace: '\tif(!g_can[id]) client_print(id,print_center,"Способность готова")',
  },
  {
    // ⚠️ Отладочная строка автора: печатала «touch N» В ЧАТ ВСЕМ игрокам при
    // каждом касании снаряда. В сборке ей делать нечего.
    plugin: 'cso_class_revenant_ice',
    id: 'cso_class_revenant_ice: убрать отладочный вывод в чат',
    find: '\tclient_print(0,print_chat,"touch %d",player)',
    replace: '\t// отладочный вывод автора убран',
  },
)

export class PatchError extends Error {}

// ⚠️ Концы строк в чужих исходниках СМЕШАННЫЕ: часть файлов CRLF, часть LF, а
// внутри одного файла бывает и то и другое. Искать подстрокой бесполезно —
// шаблон с «\n» не совпадёт с «\r\n». Поэтому переводим шаблон в регулярку,
// где каждый перевод строки означает «с возвратом каретки или без».
function pattern(find) {
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped.split('\n').join('\\r?\\n'), 'g')
}


// ⚠️⚠️ У КАЖДОГО РЕВЕНАНТА — СВОИ КВАРТЫ, А НЕ ОДНИ НА ДВОИХ.
// Огонь и Яд — две копии одного плагина, и обе регистрировали «zp_classdragon*»
// со своими числами. Повторная регистрация в AMXX значение НЕ меняет: кварта
// достаётся тому, кто загрузился первым, а первым в plugins.ini стоит Огонь.
// Значит Яд всё это время бил на 70 вместо 100, травил 5 секунд по 20 вместо
// десяти по 15 и откатывался 15 секунд вместо двадцати. И настроить его было
// нечем: правка кварты меняла сразу оба класса. Отсюда «яд у ремнанта как будто
// не работает».
// ⚠️ Лёд в эту историю не попал — у него имена свои (zp_classparalize*), — но
// приводим и его: пусть кварта называется по классу, которым управляет.
const DRAGON_CVARS = [
  ['zp_classdragon_delay', '_delay'],
  ['zp_classdragonball_dmg', '_dmg'],
  ['zp_classdragonball_velocity', '_velocity'],
  ['zp_classdragonball_health', '_health'],
  ['zp_classdragonball_radius', '_radius'],
  ['zp_classdragonball_power', '_power'],
  ['zp_classdragonball_enable', '_effect'],
  ['zp_classdragonball_burntime', '_effecttime'],
  ['zp_classdragonball_burndmg', '_effectdmg'],
]

for (const [plugin, prefix, names] of [
  ['cso_class_revenant_fire', 'zp_revfire', DRAGON_CVARS],
  ['cso_class_revenant_poison_boss', 'zp_revpoison', DRAGON_CVARS],
  ['cso_class_revenant_ice', 'zp_revice', [
    ['zp_classparalize_delay', '_delay'],
    ['zp_classparalizeball_velocity', '_velocity'],
    ['zp_classparalizeball_health', '_health'],
    ['zp_classparalizeball_paralizetime', '_freezetime'],
  ]],
]) {
  for (const [was, tail] of names) {
    PATCHES.push({
      plugin,
      id: `${plugin}: своя кварта ${prefix}${tail}`,
      find: `"${was}"`,
      replace: `"${prefix}${tail}"`,
    })
  }
}

// Применяет все правки для этого плагина. Возвращает их число.
export function patchPorted(path, plugin) {
  const mine = PATCHES.filter(p => p.plugin === plugin)
  if (!mine.length) return 0

  let text = readFileSync(path, 'utf8')

  // Заменяем теми же концами строк, что в файле: иначе кусок с LF посреди
  // CRLF-файла компилятор проглотит, а глазами это потом не найти.
  const eol = text.includes('\r\n') ? '\r\n' : '\n'

  for (const p of mine) {
    const re = pattern(p.find)
    const count = (text.match(re) ?? []).length
    if (count !== 1) {
      throw new PatchError(
        `правка «${p.id}» в ${plugin}: шаблон найден ${count} раз(а), ожидалась 1.\n`
        + '  Похоже, в карантине другой вариант плагина: правку надо привести\n'
        + '  в соответствие, иначе она молча не применится.')
    }
    text = text.replace(re, p.replace.split('\n').join(eol))
  }

  writeFileSync(path, text, 'utf8')
  return mine.length
}
