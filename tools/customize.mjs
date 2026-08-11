// Наш слой поверх апстрима Zombie Plague: русский язык, оформление меню и HUD.
//
// Апстрим переливается в server/ при каждой сборке, поэтому править файлы на месте
// нельзя — правки исчезнут при следующем assemble.mjs. Здесь они описаны как пары
// «найти → заменить», и каждая ОБЯЗАНА совпасть ровно указанное число раз. Если
// апстрим изменится, сборка упадёт с внятным сообщением, а не соберёт молча плагин
// без половины правок.
//
// Запуск: node tools/customize.mjs   (или вызовом customize() из assemble.mjs)

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── правки исходников ───────────────────────────────────────────────────────────
//
// Про экранирование: в Pawn escape-символ — это `^`, а не `\`. Поэтому `^n` ниже —
// перевод строки, а `\y` `\r` `\w` `\d` — цветовые коды клиента CS 1.6 (жёлтый,
// красный, белый, серый), которые доходят до него как два обычных символа.

const BRAND = '\\y[Вспышка эпидемии]'
const RULE = '\\d----------------------------'

// Пути — от каталога addons/amxmodx.
const ZP = 'scripting/zombie_plague44.sma'
const ZC = 'scripting/zp_zclasses44.sma'
const CFG = 'configs/amxx.cfg'
const ZPCFG = 'configs/zombie_plague_v44.cfg'
const ZPINI = 'configs/zombie_plague_v44.ini'
// Штатный плагин администраторов: его пересобираем сами, с чтением из базы.
const ADMIN = 'scripting/admin.sma'

// Класс зомби: название, подсказка. Подсказки сверены с настоящими числами в
// zp_zclasses44.sma, за точку отсчёта взят обычный зомби (1800 HP, скорость 190).
// Формат взят у сборок ZP 4.3: он показывает все отличия разом, а односложное
// «Speed» из апстрима 4.4 не говорит ничего.
// Подпись к классу — это ВТОРАЯ строка в его пункте меню. Раньше там были
// характеристики, но владелец попросил показывать вместо них, какой уровень
// открывает класс: в меню это нужнее, а числа всё равно видно по игре.
// Подпись — вторая строка пункта меню, и её видно ДО выбора класса. Пишем в
// неё СПОСОБНОСТЬ И КЛАВИШУ: жалоба владельца «не понятно, какие способности»
// была именно про это. «\r» и «\y» — цвета пункта у мода, не перевод строки.
// ⚠️ Уровень пишем ТОЛЬКО у классов за привилегию. Слово «всем» у бесплатных
// съедало по 10 байт на пункт, а страница меню GoldSrc — около 512 байт на
// семь пунктов: с ним первая страница переставала влезать. Отсутствие пометки
// и означает «доступен всем».
const ZCLASSES = [
  [1, 'Обычный', '\\rРывок (E)'],            // 1800 / 190 / отброс 1.0
  [2, 'Раптор', '\\rУскорение (E)'],         //  900 / 225 / отброс 1.5
  [3, 'Ядовитый', '\\rОблако яда (E)'],      // 1400 / 190 / гравитация 0.75
  [4, 'Толстяк', '\\rПанцирь (E)'],          // 2700 / 155 / отброс 0.5
  // Модель этого класса — ведьма, способность — стая мышей. Имя «Пиявка»
  // осталось от апстрима и в меню его было не найти: владелец искал ведьму.
  [5, 'Ведьма', '\\rСтая мышей (E)'],        // 1300 / 190 / +200 HP за жертву
]

const ZCLASS_UPSTREAM = {
  1: ['Classic Zombie', 'Balanced'],
  2: ['Raptor Zombie', 'Speed'],
  3: ['Poison Zombie', 'Gravity'],
  4: ['Big Zombie', 'Health'],
  5: ['Leech Zombie', 'Leech'],
}

const EDITS = [
  // ── лапа Дьявола ──────────────────────────────────────────────────────────
  //
  // У Дьявола (Немезиды) стояла та же лапа, что у обычного зомби, — роль
  // раунда ничем не отличалась на вид. Владелец: «руки толстяка подойдут для
  // режима дьявол». Речь про бинтованные кулаки «Танка», которые Толстяку не
  // подошли (ему нужен тесак): широкая кисть в окровавленном бинте — как раз
  // для того, кто идёт в лоб на всех.
  {
    file: ZPINI, id: 'лапа Дьявола — бинтованные кулаки',
    find: 'V_KNIFE NEMESIS = models/zombie_plague_v44/zp_claw_source_v44.mdl',
    replace: 'V_KNIFE NEMESIS = models/zombie_plague_v44/v_zm_hot_nemesis.mdl',
  },

  // ── боссы режимов: свой облик каждому ─────────────────────────────────────
  //
  // ⚠️ В АПСТРИМЕ ВСЕ ЧЕТВЕРО ВЫГЛЯДЯТ КАК РЯДОВЫЕ ИГРОКИ: Дьявол и Убийца —
  // обычный зомби (только крупнее и с подсветкой), Выживший и Снайпер —
  // обычный боец. Режим объявляется голосом и надписью, а на карте босса не
  // отличить от соседа, пока он тебя не убьёт. Владелец: «пройтись по режимам,
  // добавить уникальные модели для боссов режимов и модели рук им».
  //
  // Модели перенесены tools/port-bosses.mjs — у всех проверен полный набор из
  // 111 анимаций, имена и внутренние подписи наши.
  {
    file: ZPINI, id: 'боссы: облик Дьявола',
    find: 'NEMESIS = zombie_source_v44',
    replace: 'NEMESIS = zm_hot_boss_nemesis',
  },
  {
    file: ZPINI, id: 'боссы: облик Убийцы',
    find: 'ASSASSIN = zombie_source_v44',
    replace: 'ASSASSIN = zm_hot_boss_assassin',
  },
  {
    file: ZPINI, id: 'боссы: облик Выжившего',
    find: 'SURVIVOR = zp_human_v44',
    replace: 'SURVIVOR = zm_hot_boss_survivor',
  },
  {
    file: ZPINI, id: 'боссы: облик Снайпера',
    find: 'SNIPER = zp_human_v44',
    replace: 'SNIPER = zm_hot_boss_sniper',
  },
  // Лапа Убийцы. У донора к каждому зомби идёт своя рука, но у скелета своей
  // нет — взята «призрачная»: костлявая кисть, к скелету подходит лучше всех.
  {
    file: ZPINI, id: 'боссы: лапа Убийцы',
    find: 'V_KNIFE ASSASSIN = models/zombie_plague_v44/zp_claw_source_v44.mdl',
    replace: 'V_KNIFE ASSASSIN = models/zombie_plague_v44/v_zm_hot_assassin.mdl',
  },
  // ⚠️ «РУКИ» ВЫЖИВШЕГО И СНАЙПЕРА — ЭТО ИХ ОРУЖИЕ ОТ ПЕРВОГО ЛИЦА, отдельной
  // модели рук у них нет. Ставим стволы, которые УЖЕ лежат в сборке: они
  // пришли с плагинами оружия, уже в раздаче и уже в памяти сервера, то есть
  // новых файлов и новых мест в списке предзагрузки это не стоит ни одного.
  // Набор анимаций у них тот же, что у заменяемого ствола (Mk48 — вместо M249,
  // TRG-42 — вместо AWP), иначе перезарядка выглядела бы рваной.
  {
    file: ZPINI, id: 'боссы: пулемёт Выжившего',
    find: 'V_WEAPON SURVIVOR = models/v_m249.mdl',
    replace: 'V_WEAPON SURVIVOR = models/zm_hot_v/v_mk48.mdl',
  },
  {
    file: ZPINI, id: 'боссы: винтовка Снайпера',
    find: 'V_WEAPON SNIPER = models/v_awp.mdl',
    replace: 'V_WEAPON SNIPER = models/zm_hot_v/v_trg42.mdl',
  },

  // ⚠️ dhudmessage В АПСТРИМЕ НЕ ПОДКЛЮЧЁН. Нижнюю панель мы выводим крупным
  // шрифтом (set_dhudmessage/show_dhudmessage) — как в скачанных сборках, —
  // а это не нативы движка, а обёртки из dhudmessage.inc. Без строки ниже
  // плагин просто не собирается, и мод молча пропадает с сервера.
  {
    file: ZP, id: 'подключить dhudmessage для нижней панели',
    find: '#include <xs>',
    replace: '#include <xs>\n#include <dhudmessage>',
  },

  // ── звуки: разбавляем набор мода своими ───────────────────────────────────
  //
  // Владелец попросил поискать ещё звуков. Взяты из JUST PRO
  // (tools/port-sounds.mjs) и ДОБАВЛЕНЫ к штатным, а не вместо них: у мода
  // звук выбирается случайно из списка, и чем список длиннее, тем реже
  // повторяется одно и то же. Полная замена, наоборот, сделала бы зомби
  // одноголосым.
  //
  // ⚠️ Путь пишется БЕЗ «sound/» — так его ждёт precache_sound; на диске файл
  // лежит именно в sound/. На этом уже спотыкались в плагинах.
  {
    file: ZPINI, id: 'звуки: боль зомби',
    find: 'ZOMBIE PAIN = zombie_plague_v44/zombie_pain1.wav',
    replace: 'ZOMBIE PAIN = zm_hot/z_pain1.wav , zm_hot/z_pain2.wav , zm_hot/z_pain3.wav ,'
      + ' zm_hot/z_pain4.wav , zm_hot/z_pain5.wav , zombie_plague_v44/zombie_pain1.wav',
  },
  {
    file: ZPINI, id: 'звуки: смерть зомби',
    find: 'ZOMBIE DIE = zombie_plague_v44/zombie_die1.wav',
    replace: 'ZOMBIE DIE = zm_hot/z_die1.wav , zm_hot/z_die2.wav , zm_hot/z_die3.wav ,'
      + ' zm_hot/z_die4.wav , zm_hot/z_die5.wav , zombie_plague_v44/zombie_die1.wav',
  },
  {
    file: ZPINI, id: 'звуки: заражение',
    find: 'ZOMBIE INFECT = zombie_plague_v44/zombie_infec1.wav',
    replace: 'ZOMBIE INFECT = zm_hot/z_infect1.wav , zm_hot/z_infect2.wav ,'
      + ' zm_hot/z_infect3.wav , zm_hot/z_infect4.wav , zombie_plague_v44/zombie_infec1.wav',
  },
  {
    file: ZPINI, id: 'звуки: бормотание зомби',
    find: 'ZOMBIE IDLE = nihilanth/nil_now_die.wav',
    replace: 'ZOMBIE IDLE = zm_hot/z_idle1.wav , zm_hot/z_idle2.wav , nihilanth/nil_now_die.wav',
  },
  {
    file: ZPINI, id: 'звуки: боль Дьявола',
    find: 'NEMESIS PAIN = zombie_plague_v44/nemesis_pain1.wav',
    replace: 'NEMESIS PAIN = zm_hot/nem_pain1.wav , zm_hot/nem_pain2.wav ,'
      + ' zm_hot/nem_pain3.wav , zombie_plague_v44/nemesis_pain1.wav',
  },
  {
    file: ZPINI, id: 'звуки: победа людей',
    find: 'WIN HUMANS = zombie_plague_v44/win_humans1.wav',
    replace: 'WIN HUMANS = zm_hot/win_humans.wav , zombie_plague_v44/win_humans1.wav',
  },
  {
    file: ZPINI, id: 'звуки: победа зомби',
    find: 'WIN ZOMBIES = ambience/the_horror1.wav',
    replace: 'WIN ZOMBIES = zm_hot/win_zombies.wav , ambience/the_horror1.wav',
  },
  {
    file: ZPINI, id: 'звуки: ничья',
    find: 'WIN NO ONE = ambience/3dmstart.wav',
    replace: 'WIN NO ONE = zm_hot/win_none.wav',
  },
  {
    file: ZPINI, id: 'звуки: раунд Дьявола',
    find: 'ROUND NEMESIS = zombie_plague_v44/nemesis1.wav , zombie_plague_v44/nemesis2.wav',
    replace: 'ROUND NEMESIS = zm_hot/round_nemesis1.wav , zm_hot/round_nemesis2.wav ,'
      + ' zombie_plague_v44/nemesis1.wav',
  },
  {
    file: ZPINI, id: 'звуки: раунд Убийцы',
    find: 'ROUND ASSASSIN = zombie_plague_v44/nemesis1.wav , zombie_plague_v44/nemesis2.wav',
    replace: 'ROUND ASSASSIN = zm_hot/round_assassin.wav , zombie_plague_v44/nemesis1.wav',
  },
  {
    file: ZPINI, id: 'звуки: раунд Снайпера',
    find: 'ROUND SNIPER = zombie_plague_v44/survivor1.wav , zombie_plague_v44/survivor2.wav',
    replace: 'ROUND SNIPER = zm_hot/round_sniper.wav , zombie_plague_v44/survivor1.wav',
  },
  {
    file: ZPINI, id: 'звуки: Армагеддон',
    find: 'ROUND ARMAGEDDON = zombie_plague_v44/nemesis1.wav , zombie_plague_v44/survivor1.wav',
    replace: 'ROUND ARMAGEDDON = zm_hot/round_armageddon.wav',
  },
  {
    file: ZPINI, id: 'звуки: безумие зомби',
    find: 'ZOMBIE MADNESS = zombie_plague_v44/zombie_madness1.wav',
    replace: 'ZOMBIE MADNESS = zm_hot/madness.wav , zombie_plague_v44/zombie_madness1.wav',
  },
  {
    file: ZPINI, id: 'звуки: гром',
    find: 'THUNDER = zombie_plague_v44/thunder1.wav , zombie_plague_v44/thunder2.wav',
    replace: 'THUNDER = zm_hot/thunder1.wav , zm_hot/thunder2.wav ,'
      + ' zombie_plague_v44/thunder1.wav',
  },

  // ── язык сервера ──────────────────────────────────────────────────────────
  //
  // amx_client_languages не трогаем: он оставлен в 1, поэтому игрок с другой
  // локалью получит свой язык, а русский становится языком по умолчанию.
  {
    file: CFG, id: 'язык сервера — русский',
    find: 'amx_language "en"',
    replace: 'amx_language "ru"',
  },

  // ── подписи к настройкам в конфиге ────────────────────────────────────────
  //
  // Апстримовый конфиг весь на английском, и нужные переключатели в нём просто
  // не найти. Подписываем по-русски те, о которых спрашивают в первую очередь.
  {
    file: ZPCFG, id: 'конфиг: пояснение к зелёному свету зомби',
    find: 'zp_nvg_give 1 // Give nightvision',
    replace: [
      '// --- Зелёный свет у зомби (это их ночное зрение, видит его только сам игрок) ---',
      '// Убрать совсем ............. zp_nvg_give 0',
      '// Не включать самому, но оставить по клавише N ... zp_nvg_give 2',
      '// Вместо своего свечения — штатный прибор CS ..... zp_nvg_custom 0',
      '// Цвет .......... zp_nvg_zombie_color_R/G/B (сейчас 0/150/0 — зелёный)',
      '// Игрок и сам гасит его клавишей N; выбор запоминается до выхода с сервера.',
      'zp_nvg_give 1 // Give nightvision',
    ].join('\n'),
  },
  {
    file: ZPCFG, id: 'конфиг: повторный выбор оружия',
    find: 'zp_buy_custom 1 // Enable custom buy menus',
    replace: [
      'zp_buy_custom 1 // Enable custom buy menus',
      '// Разрешить открывать меню оружия повторно за раунд. Это замена ствола,',
      '// а не выдача второго: прежнее оружие сбрасывается. 0 — как в оригинале,',
      '// один выбор за возрождение.',
      'zp_buy_reopen 1',
    ].join('\n'),
  },

  // ── заголовки меню: единый фирменный вид ──────────────────────────────────
  {
    // Выживший и Снайпер получают своё оружие от мода, зомби — когти. Пункт
    // «Выбрать оружие» им не нужен: у мода он и так ничего не сделает, а
    // светящийся красным пункт, который не работает, выглядит поломкой.
    // Все пять штатных классов ходили в ОДНОЙ модели мода: игрок выбирал
    // «Раптора» или «Толстяка», а на экране был тот же зомби. Модели взяты из
    // каталога автозагрузки клиента (quarantine/steam-downloads) и разложены
    // по смыслу класса: Ядовитый — шаман, Толстяк — тяжёлый, Ведьма — ведьма.
    // «Обычный» намеренно остаётся на модели мода: он — точка отсчёта.
    file: ZC, id: 'классы зомби: Раптор',
    find: 'new const zclass2_model[] = { "zombie_source_v44" }',
    replace: 'new const zclass2_model[] = { "zm_hot_z_zaraza" }',
  },
  {
    // ⚠️ БЫЛА МОДЕЛЬ ЛЕКАРЯ. `zm_hot_z_shaman` — это CSO-шный целитель, и
    // владелец сказал прямо: «у ядовитого модель шамана». Мало того что она не
    // про яд, так ещё и путалась с настоящим классом «Шаман».
    // Теперь курильщик из JUST PRO: тварь в наростах, которая плюётся дрянью.
    // Его ЛАПА у Ядовитого стояла и раньше (v_hand_smoker_jp.mdl) — руки и
    // тело наконец от одного зомби.
    file: ZC, id: 'классы зомби: Ядовитый',
    find: 'new const zclass3_model[] = { "zombie_source_v44" }',
    replace: 'new const zclass3_model[] = { "zm_hot_z_poison" }',
  },
  {
    file: ZC, id: 'классы зомби: Толстяк',
    find: 'new const zclass4_model[] = { "zombie_source_v44" }',
    replace: 'new const zclass4_model[] = { "zm_hot_z_heavy" }',
  },
  {
    file: ZC, id: 'классы зомби: Ведьма',
    find: 'new const zclass5_model[] = { "zombie_source_v44" }',
    replace: 'new const zclass5_model[] = { "zm_hot_z_witch" }',
  },

  // Здоровье зомби поднято по просьбе владельца — примерно в полтора раза от
  // апстрима. Соотношение между классами сохранено: Раптор остаётся самым
  // хрупким, Толстяк самым крепким, иначе выбор класса теряет смысл.
  // До чужих 5000 всё равно не доводим — это уже не бой, а избиение.
  {
    file: ZC, id: 'здоровье: Обычный',
    find: 'const zclass1_health = 1800',
    replace: 'const zclass1_health = 2700',
  },
  {
    file: ZC, id: 'здоровье: Раптор',
    find: 'const zclass2_health = 900',
    replace: 'const zclass2_health = 1400',
  },
  {
    file: ZC, id: 'здоровье: Ядовитый',
    find: 'const zclass3_health = 1400',
    replace: 'const zclass3_health = 2100',
  },
  {
    file: ZC, id: 'здоровье: Толстяк',
    find: 'const zclass4_health = 2700',
    replace: 'const zclass4_health = 4100',
  },
  {
    file: ZC, id: 'здоровье: Ведьма',
    find: 'const zclass5_health = 1300',
    replace: 'const zclass5_health = 2000',
  },

  // Руки к каждой модели — СВОИ, из того же пака. Раньше все девять классов
  // махали одной лапой мода, и это было заметнее самой модели: тело чужое, а
  // руки у всех одинаковые.
  //
  // Ядовитому пришлось дать общую: у его пака руки есть, но текстура в них
  // 540 точек, а GoldSrc больше 512 не тянет — модель бы не загрузилась.
  {
    file: ZC, id: 'руки: Раптор',
    find: 'new const zclass2_clawmodel[] = { "zp_claw_source_v44.mdl" }',
    replace: 'new const zclass2_clawmodel[] = { "v_z7_zaraza.mdl" }',
  },
  {
    // Своя лапа, а не общая с Студенткой: одинаковые руки у двух классов
    // читаются как «класс не сработал». Взята рука «бумера» из JUST PRO —
    // бугристая заражённая плоть, ближе всего к ядовитому.
    file: ZC, id: 'руки: Ядовитый',
    find: 'new const zclass3_clawmodel[] = { "zp_claw_source_v44.mdl" }',
    replace: 'new const zclass3_clawmodel[] = { "v_hand_smoker_jp.mdl" }',
  },
  {
    // ⚠️ Прежняя лапа v_heavyz_pak3.mdl возила ЧЕТЫРЕ подмодели: когти,
    // китайский тесак, руку джаггернаута и «тёмного санту». Мод переключает
    // подмодели сам, и владелец видел это как «то кувалда, то топор». Вдобавок
    // на двух её текстурах нарисована реклама чужих серверов —
    // «WWW.175PT.COM» на клинке и «REEGA ZM7UP.RU» на санте.
    //
    // У новой подмодель ОДНА — переключать нечего. Раздутые отёкшие лапы
    // бледного мертвеца в трупных пятнах; переносит tools/port-claw.mjs.
    file: ZC, id: 'руки: Толстяк',
    find: 'new const zclass4_clawmodel[] = { "zp_claw_source_v44.mdl" }',
    replace: 'new const zclass4_clawmodel[] = { "v_zm_hot_heavy.mdl" }',
  },
  {
    file: ZC, id: 'руки: Ведьма',
    find: 'new const zclass5_clawmodel[] = { "zp_claw_source_v44.mdl" }',
    replace: 'new const zclass5_clawmodel[] = { "v_witch_pak3_re.mdl" }',
  },
  {
    file: ZP, id: 'меню игры: не открывать спец-магазин зомби на спец-раундах',
    // Одной серой строки мало: пункт можно нажать вслепую или вызвать
    // командой, поэтому закрываем и сам вход в магазин.
    find: '\t\t\t\t// Check whether the player is able to buy anything\n'
      + '\t\t\t\tif (g_isalive[id])\n'
      + '\t\t\t\t\tshow_menu_extras(id)',
    replace: '\t\t\t\t// Check whether the player is able to buy anything\n'
      + '\t\t\t\tif (g_zombie[id] && g_currentmode != MODE_INFECTION && g_currentmode != MODE_MULTI)\n'
      + '\t\t\t\t\tclient_print_color(id, print_team_default, "^^x04[ZP]^^x01 На особом раунде магазин зомби закрыт.")\n'
      + '\t\t\t\telse if (g_isalive[id])\n'
      + '\t\t\t\t\tshow_menu_extras(id)',
  },
  {
    file: ZP, id: 'меню игры: гасить спец-магазин зомби на спец-раундах',
    // Событие раунда не должно ломаться покупками: на Немезиде, Выжившем,
    // Снайпере, Чуме, Рое и Армагеддоне зомби в магазин не попадает вовсе.
    // Пункт остаётся видимым, но серым — иначе игрок решит, что меню сломалось.
    find: '\tif (get_pcvar_num(cvar_extraitems) && g_isalive[id])\n'
      + '\t\tlen += formatex(menu[len], charsmax(menu) - len, "\\r2.\\w %L^n", id, "MENU_EXTRABUY")',
    replace: '\tif (get_pcvar_num(cvar_extraitems) && g_isalive[id]\n'
      + '\t\t&& !(g_zombie[id] && g_currentmode != MODE_INFECTION && g_currentmode != MODE_MULTI))\n'
      + '\t\tlen += formatex(menu[len], charsmax(menu) - len, "\\r2.\\w %L^n", id, "MENU_EXTRABUY")',
  },
  {
    file: ZP, id: 'меню игры: гасить выбор оружия там, где он не работает',
    find: '\tif (get_pcvar_num(cvar_buycustom))\n'
      + '\t\tlen += formatex(menu[len], charsmax(menu) - len, "\\r1.\\w %L^n", id, "MENU_BUY")',
    replace: '\tif (get_pcvar_num(cvar_buycustom) && !g_zombie[id] && !g_survivor[id] && !g_sniper[id])\n'
      + '\t\tlen += formatex(menu[len], charsmax(menu) - len, "\\r1.\\w %L^n", id, "MENU_BUY")',
  },
  {
    file: ZP, id: 'меню игры: заголовок и остаток кредитов',
    find: '"\\y[ZP:44] %s^n^n", g_modname)',
    replace: `"${BRAND}\\w %L^n${RULE}^n\\wКредиты: \\y%d^n^n", id, "MENU_MAIN_TITLE", g_ammopacks[id])`,
  },
  {
    file: ZP, id: 'меню основного оружия: заголовок',
    find: '"\\y[ZP:44] %L \\r[%d-%d]^n^n", id, "MENU_BUY1_TITLE"',
    replace: `"${BRAND}\\w %L \\r[%d-%d]^n${RULE}^n^n", id, "MENU_BUY1_TITLE"`,
  },
  {
    file: ZP, id: 'меню дополнительного оружия: заголовок',
    find: '"\\y[ZP:44] %L^n", id, "MENU_BUY2_TITLE"',
    replace: `"${BRAND}\\w %L^n${RULE}^n", id, "MENU_BUY2_TITLE"`,
  },
  {
    // Строка заменяется целиком: короткий якорь тут не годится — хвост с
    // проверкой класса встречается в файле 11 раз, а кредиты надо дописать
    // последним аргументом именно в этот вызов.
    file: ZP, id: 'меню спец-вещей: заголовок с остатком кредитов',
    find: '"[ZP:44] %L [%L]\\r", id, "MENU_EXTRA_TITLE", id, g_nemesis[id] ? "CLASS_NEMESIS"'
      + ' : g_assassin[id] ? "CLASS_ASSASSIN" : g_zombie[id] ? "CLASS_ZOMBIE" : g_survivor[id]'
      + ' ? "CLASS_SURVIVOR" : g_sniper[id] ? "CLASS_SNIPER" : "CLASS_HUMAN")',
    replace: `"${BRAND}\\w %L \\d[%L]  \\wКредиты: \\y%d\\r", id, "MENU_EXTRA_TITLE", id, g_nemesis[id] ? "CLASS_NEMESIS"`
      + ' : g_assassin[id] ? "CLASS_ASSASSIN" : g_zombie[id] ? "CLASS_ZOMBIE" : g_survivor[id]'
      + ' ? "CLASS_SURVIVOR" : g_sniper[id] ? "CLASS_SNIPER" : "CLASS_HUMAN", g_ammopacks[id])',
  },
  {
    file: ZP, id: 'меню классов зомби: заголовок',
    find: '"[ZP:44] %L\\r", id, "MENU_ZCLASS_TITLE"',
    replace: `"${BRAND}\\w %L\\r", id, "MENU_ZCLASS_TITLE"`,
  },
  {
    file: ZP, id: 'админ-меню: заголовок',
    find: '"\\y[ZP:44] %L^n^n", id, "MENU_ADMIN_TITLE"',
    replace: `"${BRAND}\\w %L^n${RULE}^n^n", id, "MENU_ADMIN_TITLE"`,
  },
  {
    file: ZP, id: 'меню режимов: заголовок',
    find: '"\\y[ZP:44] %L^n^n", id, "MENU_ADMIN_MODES_TITLE"',
    replace: `"${BRAND}\\w %L^n${RULE}^n^n", id, "MENU_ADMIN_MODES_TITLE"`,
  },

  // ── пункт «Ножи» в меню по клавише M ──────────────────────────────────────
  //
  // Клавиша 6 в маске KEYSMENU у мода уже разрешена, патчить её не нужно.
  // Сам выбор живёт в нашем плагине zp_knives: мод о нём ничего не знает и
  // просто выполняет от имени игрока команду, которую тот плагин
  // зарегистрировал. Так связь остаётся односторонней — уберут плагин, пункт
  // просто ничего не сделает, а не сломает меню.
  {
    file: ZP, id: 'меню игры: пункт «Ножи»',
    find: '\t// 9. Admin menu\n\tif (userflags & g_access_flag[ACCESS_ADMIN_MENU])',
    replace: [
      '\t// 6. Ножи и 7. Привилегии (наши плагины)',
      '\tif (!g_zombie[id] && g_isalive[id])',
      '\t\tlen += formatex(menu[len], charsmax(menu) - len, "\\r6.\\w %L^n", id, "MENU_KNIVES")',
      '\telse',
      '\t\tlen += formatex(menu[len], charsmax(menu) - len, "\\d6. %L^n", id, "MENU_KNIVES")',
      '\t',
      '\t// Привилегии доступны всегда: посмотреть, что даёт уровень, можно и мёртвым.',
      '\tlen += formatex(menu[len], charsmax(menu) - len, "\\r7.\\w %L^n", id, "MENU_VIP")',
      '\t',
      '\t// 8. Магазин скинов — за кредиты, уровня не требует, поэтому на виду.',
      '\tif (!g_zombie[id] && g_isalive[id])',
      '\t\tlen += formatex(menu[len], charsmax(menu) - len, "\\r8.\\w %L^n^n", id, "MENU_SKINSHOP")',
      '\telse',
      '\t\tlen += formatex(menu[len], charsmax(menu) - len, "\\d8. %L^n^n", id, "MENU_SKINSHOP")',
      '\t',
      '\t// 9. Admin menu',
      '\tif (userflags & g_access_flag[ACCESS_ADMIN_MENU])',
    ].join('\n'),
  },
  {
    file: ZP, id: 'меню игры: обработка пункта «Ножи»',
    find: '\t\tcase 8: // Admin Menu',
    replace: [
      '\t\tcase 5: // Ножи — выбор в нашем плагине',
      '\t\t{',
      '\t\t\tclient_cmd(id, "zp_knife")',
      '\t\t}',
      '\t\tcase 6: // Привилегии — наш плагин',
      '\t\t{',
      '\t\t\tclient_cmd(id, "zp_vip")',
      '\t\t}',
      '\t\tcase 7: // Магазин скинов — наш плагин',
      '\t\t{',
      '\t\t\tclient_cmd(id, "zp_skin_shop")',
      '\t\t}',
      '\t\tcase 8: // Admin Menu',
    ].join('\n'),
  },

  // ── буферы под кириллицу ──────────────────────────────────────────────────
  //
  // Клиент GoldSrc принимает UTF-8, а в нём кириллическая буква занимает ДВА
  // байта, то есть две ячейки Pawn. Русский текст той же длины, что английский,
  // требует вдвое больше места. Без этих правок строки режутся посреди символа
  // и превращаются в мусор — молча, компилятор такого не ловит.
  {
    file: ZP, id: 'буфер меню игры и админки', count: 3,
    find: 'static menu[250], len, userflags',
    replace: 'static menu[512], len, userflags',
  },
  {
    file: ZP, id: 'буфер меню основного оружия',
    find: 'static menu[300], len, weap, maxloops',
    replace: 'static menu[512], len, weap, maxloops',
  },
  {
    file: ZP, id: 'буфер меню дополнительного оружия',
    find: 'static menu[250], len, weap, maxloops',
    replace: 'static menu[512], len, weap, maxloops',
  },
  {
    file: ZP, id: 'буферы меню спец-вещей',
    find: 'static menuid, menu[128], item, team, buffer[32]',
    replace: 'static menuid, menu[256], item, team, buffer[96]',
  },
  {
    file: ZP, id: 'буферы меню классов зомби',
    find: 'static menuid, menu[128], class, buffer[32], buffer2[32]',
    replace: 'static menuid, menu[256], class, buffer[96], buffer2[96]',
  },
  {
    file: ZP, id: 'буфер меню списка игроков',
    find: 'static menuid, menu[128], player, userflags, buffer[2]',
    replace: 'static menuid, menu[256], player, userflags, buffer[2]',
  },
  {
    file: ZP, id: 'буфер названия класса в HUD',
    find: 'static class[32], red, green, blue',
    replace: 'static class[64], red, green, blue',
  },
  {
    file: ZP, id: 'хранилище названия класса игрока',
    find: 'new g_zombie_classname[33][32]',
    replace: 'new g_zombie_classname[33][64]',
  },
  ...[
    ['g_zclass_name', 'названия классов зомби'],
    ['g_zclass_info', 'подсказки классов зомби'],
    ['g_zclass2_name', 'названия классов зомби (второй набор)'],
    ['g_zclass2_info', 'подсказки классов зомби (второй набор)'],
    ['g_extraitem_name', 'названия спец-вещей'],
    ['g_extraitem2_name', 'названия спец-вещей (второй набор)'],
  ].map(([arr, label]) => ({
    file: ZP, id: `хранилище: ${label}`,
    find: `${arr} = ArrayCreate(32, 1)`,
    replace: `${arr} = ArrayCreate(96, 1)`,
  })),

  // ── HUD ───────────────────────────────────────────────────────────────────
  {
    file: ZP, id: 'HUD наблюдателя: русские подписи',
    find: '"[ %L %s | Mode: %s ]^n[ HP: %d | %L %s | %L %d | %L %d ]"',
    replace: '"[ %L %s | Режим: %s ]^n[ Здоровье: %d | %L %s | %L %d | %L %d ]"',
  },
  {
    file: ZP, id: 'HUD подробный: русские подписи',
    find: '[ Deaths: %d ]^n[ Frags: %i ]^n[ Velocity: %d ]^n[ Mode: %s ]',
    replace: '[ Смертей: %d ]^n[ Убийств: %i ]^n[ Скорость: %d ]^n[ Режим: %s ]',
  },
  {
    file: ZP, id: 'HUD: цвет зомби — ядовито-зелёный',
    find: '\t\tred = 200\n\t\tgreen = 250\n\t\tblue = 0',
    replace: '\t\tred = 130\n\t\tgreen = 230\n\t\tblue = 40',
  },
  {
    file: ZP, id: 'HUD: цвет людей — холодный голубой',
    find: '\t\tred = 0\n\t\tgreen = 180\n\t\tblue = 255',
    replace: '\t\tred = 70\n\t\tgreen = 170\n\t\tblue = 255',
  },

  {
    // Панель состояния стояла в левом нижнем углу. -1.0 по горизонтали —
    // это «по центру» в set_hudmessage; высоту оставляем внизу, чтобы
    // панель не легла на прицел.
    file: ZP, id: 'HUD: панель состояния по центру',
    find: 'set_hudmessage(red, green, blue, 0.02, 0.9, 0, 0.1, 1.1, 0.0, 0.0, -1)',
    // ⚠️ ПЕРЕВЕДЕНО НА DHUD. Владелец попросил привести худ к виду скачанных
    // сборок; смотрели «Казахский Пирог» — у них нижняя строка выводится
    // show_dhudmessage, а не ShowSyncHudMsg. Разница не в словах, а в шрифте:
    // dhud рисуется крупно и гладко, обычный hud — мелким пиксельным, и на
    // широком экране его почти не прочесть. Парная правка ниже меняет и сам
    // вызов вывода: у dhud другое имя функции и нет синхронизатора.
    replace: 'set_dhudmessage(red, green, blue, -1.0, 0.90, 0, 0.0, 1.1, 0.0, 0.0)',
  },

  // ── меню выбора оружия ────────────────────────────────────────────────────
  //
  // Апстрим на нажатие «Выбрать оружие» ВСЕГДА печатал «меню вновь включено»,
  // а само меню открывал, только если игрок в этом раунде ещё не покупал. Со
  // стороны игрока это выглядит поломкой: нажимаешь — ничего не происходит,
  // и каждый раз одно и то же сообщение.
  //
  // Повторный выбор безопасен: buy_primary_weapon сам сбрасывает прежнее
  // оружие через drop_weapons, то есть это замена, а не второй ствол.
  {
    file: ZP, id: 'меню оружия: объявить cvar повторного выбора',
    find: 'cvar_buyzonetime, cvar_huddisplay,',
    replace: 'cvar_buyzonetime, cvar_buyreopen, cvar_huddisplay,',
  },
  {
    file: ZP, id: 'меню оружия: зарегистрировать zp_buy_reopen',
    find: '\tcvar_buyzonetime = register_cvar("zp_buyzone_time", "0.0")',
    replace: '\tcvar_buyzonetime = register_cvar("zp_buyzone_time", "0.0")\n'
      + '\tcvar_buyreopen = register_cvar("zp_buy_reopen", "1")',
  },
  {
    file: ZP, id: 'меню оружия: убрать сообщение-пустышку',
    find: '\t\t\t\tWPN_AUTO_ON = 0\n\t\t\t\tzp_colored_print(id, "^x04[ZP]^x01 %L", id, "BUY_ENABLED")',
    replace: '\t\t\t\tWPN_AUTO_ON = 0',
  },
  {
    file: ZP, id: 'меню оружия: открывать меню, а не молчать',
    find: '\t\t\t\tif (g_canbuy[id]) show_menu_buy1(id)',
    replace: [
      '\t\t\t\tif (!g_isalive[id])',
      '\t\t\t\t\tzp_colored_print(id, "^x04[ZP]^x01 %L", id, "CMD_NOT")',
      '\t\t\t\telse if (g_zombie[id] || g_survivor[id] || g_sniper[id])',
      '\t\t\t\t\tzp_colored_print(id, "^x04[ZP]^x01 %L", id, "CMD_HUMAN_ONLY")',
      '\t\t\t\telse if (g_canbuy[id] || get_pcvar_num(cvar_buyreopen))',
      '\t\t\t\t\tshow_menu_buy1(id)',
      '\t\t\t\telse',
      '\t\t\t\t\tzp_colored_print(id, "^x04[ZP]^x01 %L", id, "BUY_ALREADY")',
    ].join('\n'),
  },

  // ── зелёный свет зомби (своё ночное зрение) ───────────────────────────────
  //
  // Свет шлётся MSG_ONE, то есть игрок видит его только сам — это его ночное
  // зрение, а не свечение, заметное со стороны. Выключить его клавишей N было
  // можно и раньше, но при zp_nvg_give 1 он загорался заново после каждого
  // возрождения и заражения. Теперь выбор игрока запоминается на сессию.
  {
    file: ZP, id: 'свет зомби: флаг «игрок хочет ночное зрение»',
    find: 'new g_nvisionenabled[33] // has night vision turned on',
    replace: 'new g_nvisionenabled[33] // has night vision turned on\n'
      + 'new g_nvgwanted[33] = { 1, ... } // игрок не выключал себе ночное зрение',
  },
  {
    file: ZP, id: 'свет зомби: запомнить выбор игрока',
    find: '\t\tg_nvisionenabled[id] = !(g_nvisionenabled[id])',
    replace: '\t\tg_nvisionenabled[id] = !(g_nvisionenabled[id])\n'
      + '\t\tg_nvgwanted[id] = g_nvisionenabled[id]',
  },
  {
    file: ZP, id: 'свет зомби: не включать заново против воли', count: 4,
    find: 'g_nvisionenabled[id] = true',
    replace: 'g_nvisionenabled[id] = (g_nvgwanted[id] != 0)',
  },
  {
    file: ZP, id: 'свет зомби: то же для штатного ночного зрения', count: 4,
    find: 'set_user_gnvision(id, 1)',
    replace: 'set_user_gnvision(id, g_nvgwanted[id])',
  },
  {
    file: ZP, id: 'свет зомби: гасить свет и снимать задачу',
    find: 'public set_user_nvision(taskid)\n{\n\t// Get player\'s origin',
    replace: [
      'public set_user_nvision(taskid)',
      '{',
      '\t// Игрок выключил себе ночное зрение — гасим свет и снимаем задачу,',
      '\t// чтобы она не крутилась вхолостую десять раз в секунду.',
      '\tif (!g_nvgwanted[ID_NVISION])',
      '\t{',
      '\t\tremove_task(taskid)',
      '\t\treturn;',
      '\t}',
      '\t',
      "\t// Get player's origin",
    ].join('\n'),
  },
  {
    file: ZP, id: 'свет зомби: новый игрок начинает со светом',
    find: '\t// Player joined\n\tg_isconnected[id] = true',
    replace: '\t// Player joined\n\tg_isconnected[id] = true\n\tg_nvgwanted[id] = 1',
  },

  // ── нижняя панель в одну строку ───────────────────────────────────────────
  //
  // Русские подписи вышли длиннее английских, и строка перестала помещаться.
  // Убираем словарные ключи и пишем коротко. Заодно чинится опечатка апстрима:
  // броня бралась у `id` — то есть у наблюдателя, а не у того, за кем следят.
  {
    file: ZP, id: 'HUD: нижняя панель короче',
    find: 'ShowSyncHudMsg(ID_SHOWHUD, g_MsgSync2, "[ %L: %d | %L %s | %L %d | %L: %d ]",'
      + ' id, "ZOMBIE_ATTRIB1", pev(ID_SHOWHUD, pev_health), ID_SHOWHUD, "CLASS_CLASS", class,'
      + ' ID_SHOWHUD, "AMMO_PACKS1", g_ammopacks[ID_SHOWHUD], ID_SHOWHUD, "ARMOR", pev(id, pev_armorvalue))',
    // Оформление: значения отделены точками, между блоками — тонкая черта.
    // Так строка читается «с одного взгляда», а не разбирается по словам, и
    // при этом остаётся одной строкой — на две в этом углу места нет.
    replace: 'show_dhudmessage(ID_SHOWHUD, "%s   %d HP  ·  %d бр.  ·  %d кр.%s",'
      + ' class, get_user_health(ID_SHOWHUD), get_user_armor(ID_SHOWHUD),'
      + ' g_ammopacks[ID_SHOWHUD], zm_hot_tier(ID_SHOWHUD))',
  },

  // Уровень привилегии прямо в панели: игрок за него заплатил, и видеть его
  // он должен постоянно, а не только в меню. Пишем СВОЕЙ функцией, а не через
  // сторонний плагин: HUD рисует мод, и добавить строку снаружи нельзя.
  {
    file: ZP, id: 'HUD: уровень привилегии в панели',
    // Якорь берём вместе с комментарием и вставляем СВОЁ ПЕРЕД ним: другая
    // правка ищет эту пару строк подряд, и вклиниться между ними нельзя.
    find: '// Show HUD Task\npublic ShowHUD(taskid)',
    replace: [
      '// Подпись уровня для панели. Буквы флагов сверены по amxconst.inc:',
      '// ADMIN_LEVEL_H это «t», а не «h» — на созвучии тут обжигаются все.',
      'zm_hot_tier(id)',
      '{',
      '\tstatic out[24]',
      '\tcopy(out, charsmax(out), "")',
      '\t',
      '\tif (!is_user_connected(id)) return out;',
      '\t',
      '\tnew flags = get_user_flags(id)',
      '\tif (flags & ADMIN_LEVEL_C) copy(out, charsmax(out), "  ·  Создатель")',
      '\telse if (flags & ADMIN_LEVEL_D) copy(out, charsmax(out), "  ·  Фараон")',
      '\telse if (flags & ADMIN_LEVEL_E) copy(out, charsmax(out), "  ·  Император")',
      '\telse if (flags & ADMIN_LEVEL_G) copy(out, charsmax(out), "  ·  Лидер")',
      '\telse if (flags & ADMIN_LEVEL_H) copy(out, charsmax(out), "  ·  VIP")',
      '\t',
      '\treturn out;',
      '}',
      '',
      '// Show HUD Task',
      'public ShowHUD(taskid)',
    ].join('\n'),
  },

  // ── верхняя строка, подсказка по клавишам, сохранение класса ──────────────
  {
    file: ZP, id: 'новые глобальные переменные',
    find: 'new g_MsgSync, g_MsgSync2 // message sync objects',
    replace: [
      'new g_MsgSync, g_MsgSync2 // message sync objects',
      'new g_MsgSync3, g_MsgSync4 // верхняя строка и подсказка по клавишам',
      'new g_roundnum // номер раунда с начала карты',
      'new Float:g_infect_at // игровое время, когда начнётся заражение',
    ].join('\n'),
  },
  {
    file: ZP, id: 'создать объекты HUD и открыть хранилище',
    find: '\tg_MsgSync = CreateHudSyncObj()\n\tg_MsgSync2 = CreateHudSyncObj()',
    replace: [
      '\tg_MsgSync = CreateHudSyncObj()',
      '\tg_MsgSync2 = CreateHudSyncObj()',
      '\tg_MsgSync3 = CreateHudSyncObj()',
      '\tg_MsgSync4 = CreateHudSyncObj()',
      '\t',
      '\t// GoldSrc держит РОВНО ЧЕТЫРЕ канала сообщений HUD, и все четыре теперь',
      '\t// заняты: события, нижняя панель, верхняя строка, подсказка по клавишам.',
      '\t// Пятая постоянная панель начнёт вытеснять чужие сообщения.',
    ].join('\n'),
  },
  {
    file: ZP, id: 'счётчик раундов и момент заражения',
    find: '\t// Set a new "Make Zombie Task"\n\tremove_task(TASK_MAKEZOMBIE)\n'
      + '\tset_task(2.0 + get_pcvar_float(cvar_warmup), "make_zombie_task", TASK_MAKEZOMBIE)',
    replace: [
      '\t// Set a new "Make Zombie Task"',
      '\tremove_task(TASK_MAKEZOMBIE)',
      '\tset_task(2.0 + get_pcvar_float(cvar_warmup), "make_zombie_task", TASK_MAKEZOMBIE)',
      '\t',
      '\t// Для верхней строки: номер раунда и момент, когда придёт заражение.',
      '\tg_roundnum++',
      '\tg_infect_at = get_gametime() + 2.0 + get_pcvar_float(cvar_warmup)',
    ].join('\n'),
  },
  {
    file: ZP, id: 'верхняя строка и подсказка: сами функции',
    find: '// Show HUD Task\npublic ShowHUD(taskid)',
    replace: [
      '// Верхняя строка: раунд, отсчёт до заражения, счёт живых.',
      'zp_show_topbar(id)',
      '{',
      '\tstatic humans, zombies, secs',
      '\thumans = fnGetHumans()',
      '\tzombies = fnGetZombies()',
      '\t',
      '\tset_hudmessage(210, 210, 210, -1.0, 0.02, 0, 0.0, 1.1, 0.0, 0.0, -1)',
      '\t',
      '\t// Пока жива задача первого заражения — показываем отсчёт до него,',
      '\t// дальше на его месте полезнее название идущего режима.',
      '\tif (task_exists(TASK_MAKEZOMBIE))',
      '\t{',
      '\t\tsecs = floatround(g_infect_at - get_gametime(), floatround_ceil)',
      '\t\tif (secs < 0) secs = 0',
      '\t\tShowSyncHudMsg(id, g_MsgSync3, "Раунд %d    Заражение через %d    Людей: %d    Зомби: %d",'
        + ' g_roundnum, secs, humans, zombies)',
      '\t}',
      '\telse',
      '\t\tShowSyncHudMsg(id, g_MsgSync3, "Раунд %d    %s    Людей: %d    Зомби: %d",'
        + ' g_roundnum, g_mode_names[g_currentmode], humans, zombies)',
      '}',
      '',
      '// Подсказка справа: только те клавиши, которые работают прямо сейчас.',
      'zp_show_keys(id)',
      '{',
      '\tstatic text[192], len',
      '\tlen = formatex(text, charsmax(text), "M  меню^n")',
      '\t',
      '\tif (g_nvision[id])',
      '\t\tlen += formatex(text[len], charsmax(text) - len, "N  свет: %s^n",'
        + ' g_nvisionenabled[id] ? "вкл" : "выкл")',
      '\t',
      '\tif (g_isalive[id] && !g_zombie[id] && !g_survivor[id] && !g_sniper[id])',
      '\t\tlen += formatex(text[len], charsmax(text) - len, ",  .  патроны^n")',
      '\t',
      '\tif (g_isalive[id] && g_zombie[id] && get_pcvar_num(g_nemesis[id]'
        + ' ? cvar_leapnemesis : cvar_leapzombies))',
      '\t\tlen += formatex(text[len], charsmax(text) - len, "CTRL+ПРОБЕЛ  рывок^n")',
      '\t',
      '\tset_hudmessage(170, 170, 170, 0.78, 0.32, 0, 0.0, 1.1, 0.0, 0.0, -1)',
      '\tShowSyncHudMsg(id, g_MsgSync4, "%s", text)',
      '}',
      '',
      '// Show HUD Task',
      'public ShowHUD(taskid)',
    ].join('\n'),
  },
  {
    file: ZP, id: 'верхняя строка и подсказка: вызов',
    find: '\tstatic id\n\tid = ID_SHOWHUD;\n\t\n\t// Player died?',
    replace: [
      '\tstatic id',
      '\tid = ID_SHOWHUD;',
      '\t',
      '\t// Рисуем ДО проверки «жив ли»: верхнюю строку и подсказку должны',
      '\t// видеть и мёртвые, и зрители.',
      '\tzp_show_topbar(ID_SHOWHUD)',
      '\tzp_show_keys(ID_SHOWHUD)',
      '\t',
      '\t// Player died?',
    ].join('\n'),
  },

  // Сохранение прогресса между картами вынесено в отдельный плагин
  // custom/plugins/zp_progress.sma: правки апстрима тут не нужны, у мода есть
  // нативы zp_get/set_user_ammo_packs и zp_get/set_user_zombie_class, а в своём
  // плагине можно встроить диагностику и выбрать ключ по обстановке.


  // ── названия режимов игры ─────────────────────────────────────────────────
  //
  // Лежат массивом в коде, а не в словаре, и показываются в HUD всем одинаково.
  // Переводим прямо здесь: сервер русский, а тащить их в словарь — значит менять
  // сигнатуру вывода HUD ради иностранцев, которых тут не ожидается.
  {
    file: ZP, id: 'названия 13 режимов игры',
    find: [
      '\t"T-Virus on the loose!",', '\t"Infection",', '\t"Nemesis",', '\t"Assassin",',
      '\t"Survivor",', '\t"Sniper",', '\t"Swarm",', '\t"Multi-Infection",',
      '\t"Plague",', '\t"Armageddon",', '\t"Apocalypse",', '\t"Nightmare",', '\t"Undefined"',
    ].join('\n'),
    replace: [
      '\t"Т-вирус на свободе!",', '\t"Заражение",', '\t"Дьявол",', '\t"Убийца",',
      '\t"Выживший",', '\t"Снайпер",', '\t"Куча на кучу",', '\t"Массовое заражение",',
      '\t"Чума",', '\t"Армагеддон",', '\t"Апокалипсис",', '\t"Кошмар",', '\t"Не определён"',
    ].join('\n'),
  },

  // ── классы зомби ──────────────────────────────────────────────────────────
  ...ZCLASSES.flatMap(([n, name, info]) => [
    {
      file: ZC, id: `класс ${n}: название`,
      find: `zclass${n}_name[] = { "${ZCLASS_UPSTREAM[n][0]}" }`,
      replace: `zclass${n}_name[] = { "${name}" }`,
    },
    {
      file: ZC, id: `класс ${n}: подсказка`,
      find: `zclass${n}_info[] = { "${ZCLASS_UPSTREAM[n][1]}" }`,
      replace: `zclass${n}_info[] = { "${info}" }`,
    },
  ]),

  // ── спец-магазин: два раздела вместо одной свалки ─────────────────────────
  //
  // В магазине три десятка позиций: стволы вперемешку с бронёй, патронами и
  // джетпаком. Владелец попросил разделить на «Предметы» и «Арсенал».
  //
  // Отдельным пунктом главного меню это не сделать: там заняты все девять
  // клавиш. Поэтому раздел переключается ПЕРВЫМ пунктом самого магазина —
  // одно нажатие, без лишнего меню.
  //
  // Что куда: у всех стволов подпись начинается с метки вида «[А]», «[С]»,
  // «[Пм]» — её ставит tools/rename-items.mjs. Всё остальное (броня, ХП,
  // патроны, джетпак, штатные предметы мода) — это «Предметы». Признак взят
  // из подписи, а не из списка имён: список пришлось бы править при каждой
  // новой вещи, и о нём бы забыли.
  {
    file: ZP, id: 'спец-магазин: память о выбранном разделе',
    find: 'new g_zombieclassnext[33] // zombie class for next infection',
    replace: 'new g_zombieclassnext[33] // zombie class for next infection\n'
      + 'new g_extras_kind[33] // раздел спец-магазина: 0 — Предметы, 1 — Арсенал',
  },
  {
    file: ZP, id: 'спец-магазин: пункт переключения раздела',
    find: '\t// Item List\n\tfor (item = 0; item < g_extraitem_i; item++)\n\t{',
    // ⚠️ ДВЕ КНОПКИ, А НЕ ОДИН ПЕРЕКЛЮЧАТЕЛЬ. Сначала строка была одна и
    // называлась то «Предметы», то «Арсенал» — то есть показывала, КУДА
    // перейдёшь, а не где ты сейчас. Владелец попросил вторую кнопку рядом:
    // так оба раздела видны сразу, а текущий подсвечен.
    //
    // Коды 250 и 251 заведомо больше любого номера вещи, за вещь их не примут.
    replace: '\t// Два раздела двумя строками: текущий жёлтым, второй белым.\n'
      + '\tformatex(menu, charsmax(menu), "%s%L", g_extras_kind[id] ? "\\w" : "\\y", id, "MENU_EXTRA_ITEMS")\n'
      + '\tbuffer[0] = 250\n'
      + '\tbuffer[1] = 0\n'
      + '\tmenu_additem(menuid, menu, buffer)\n'
      + '\t\n'
      + '\tformatex(menu, charsmax(menu), "%s%L^n", g_extras_kind[id] ? "\\y" : "\\w", id, "MENU_EXTRA_GUNS")\n'
      + '\tbuffer[0] = 251\n'
      + '\tbuffer[1] = 0\n'
      + '\tmenu_additem(menuid, menu, buffer)\n'
      + '\t\n'
      + '\t// Item List\n\tfor (item = 0; item < g_extraitem_i; item++)\n\t{',
  },
  {
    file: ZP, id: 'спец-магазин: показывать только свой раздел',
    find: '\t\t// Add Item Name and Cost\n',
    // ⚠️ ДВА ПРИЗНАКА СТВОЛА, А НЕ ОДИН. Сначала смотрели только на метку в
    // скобках («[А]», «[С]»), которую нашим стволам ставит rename-items.mjs. Но
    // у мода ЕСТЬ СВОЙ список обычного оружия CS за кредиты — он занимает
    // номера от EXTRA_WEAPONS_STARTID и подписан просто «M4A1», «AWP». Метки у
    // них нет, и весь этот список падал в «Предметы»: владелец справедливо
    // сказал, что в предметах лежит оружие. Теперь ствол — это либо метка, либо
    // номер из модовского диапазона.
    replace: '\t\t// Ствол: либо наша метка в скобках, либо модовский список оружия.\n'
      + '\t\tif (((buffer[0] == \'[\') || (item >= EXTRA_WEAPONS_STARTID && item <= EXTRAS_CUSTOM_STARTID-1))\n'
      + '\t\t\t!= (g_extras_kind[id] != 0))\n'
      + '\t\t\tcontinue;\n'
      + '\t\t\n'
      + '\t\t// Add Item Name and Cost\n',
  },
  {
    file: ZP, id: 'спец-магазин: обработка переключения',
    find: '\titemid = buffer[0]\n\t\n\t// Attempt to buy the item\n\tbuy_extra_item(id, itemid)',
    replace: '\titemid = buffer[0]\n\t\n'
      + '\t// Не вещь, а выбор раздела: 250 — Предметы, 251 — Арсенал.\n'
      + '\tif (itemid == 250 || itemid == 251)\n'
      + '\t{\n'
      + '\t\tg_extras_kind[id] = (itemid == 251)\n'
      + '\t\tMENU_PAGE_EXTRAS = 0\n'
      + '\t\tmenu_destroy(menuid)\n'
      + '\t\tshow_menu_extras(id)\n'
      + '\t\treturn PLUGIN_HANDLED;\n'
      + '\t}\n\t\n'
      + '\t// Attempt to buy the item\n\tbuy_extra_item(id, itemid)',
  },

  // ── купленное остаётся до конца карты ─────────────────────────────────────
  //
  // ⚠️ В АПСТРИМЕ ВЕЩЬ ЖИВЁТ ОДИН РАУНД, и это не поломка, а замысел: на новом
  // раунде игрока раздевают, и он покупает заново. Владелец: «не сохраняются
  // купленные предметы с спец-магазина в следующем раунде, и оружия тоже» —
  // значит, замысел меняем. Покупку запоминаем и молча выдаём снова каждый
  // раунд, пока идёт карта.
  //
  // ⚠️ ПОЧЕМУ ПРАВКОЙ МОДА, А НЕ ОТДЕЛЬНЫМ ПЛАГИНОМ. Снаружи не видно, УДАЛАСЬ
  // ли покупка: форвард zp_extra_item_selected приходит всем плагинам разом, и
  // отказ владельца вещи (нет привилегии) виден только самому моду — в
  // g_fwDummyResult. Плагин-сторож запоминал бы и отказы, а потом каждый раунд
  // ломился бы за вещью, которую игроку не положено выдавать.
  {
    file: ZP, id: 'покупки: задача возврата',
    find: '\tTASK_AMBIENCESOUNDS\n}',
    replace: '\tTASK_AMBIENCESOUNDS,\n\tTASK_KEEP\n}',
  },
  {
    file: ZP, id: 'покупки: номер игрока внутри задачи',
    find: '#define ID_SHOWHUD (taskid - TASK_SHOWHUD)',
    replace: '#define ID_SHOWHUD (taskid - TASK_SHOWHUD)\n'
      + '#define ID_KEEP (taskid - TASK_KEEP)',
  },
  {
    file: ZP, id: 'покупки: переменные',
    find: 'new g_zombieclassnext[33] // zombie class for next infection',
    replace: [
      'new g_zombieclassnext[33] // zombie class for next infection',
      '',
      '// Купленное снаряжение: что выдать игроку заново в начале раунда.',
      '// Двенадцати хватает с запасом — столько разных вещей за карту не берут,',
      '// а список у каждого игрока свой и лежит в памяти сервера.',
      '#define ZP_KEEP_MAX 12',
      'new g_keep[33][ZP_KEEP_MAX]',
      'new g_keep_n[33]',
      'new cvar_keepitems',
    ].join('\n'),
  },
  {
    file: ZP, id: 'покупки: настройка',
    find: '\tcvar_statssave = register_cvar("zp_stats_save", "1")',
    replace: '\tcvar_statssave = register_cvar("zp_stats_save", "1")\n'
      + '\t// Возвращать ли купленное снаряжение каждый раунд. Ноль — как в\n'
      + '\t// апстриме: вещь на один раунд.\n'
      + '\tcvar_keepitems = register_cvar("zp_keep_items", "1")',
  },
  {
    file: ZP, id: 'покупки: память и возврат',
    find: 'buy_extra_item(id, itemid, ignorecost = 0)\n{',
    replace: [
      '// Расходник или снаряжение? Снаряжение возвращаем каждый раунд,',
      '// расходник — нет: антидот, безумие и бомба заражения это одноразовое',
      '// ДЕЙСТВИЕ, а выдавать действие заново каждый раунд значит раздавать его',
      '// даром. То же с гранатами и с разовыми прибавками здоровья и брони.',
      '//',
      '// ⚠️ Свои вещи мод знает по номеру, чужие — только по НАЗВАНИЮ: номера у',
      '// них выдаются в порядке загрузки плагинов и меняются от сборки к сборке.',
      '// Названия наши, они же видны игроку в магазине.',
      'bool:zm_hot_keepable(itemid)',
      '{',
      '\tif (itemid == EXTRA_ANTIDOTE || itemid == EXTRA_MADNESS || itemid == EXTRA_INFBOMB)',
      '\t\treturn false;',
      '\t',
      '\tstatic name[96]',
      '\tArrayGetString(g_extraitem_name, itemid, name, charsmax(name))',
      '\t',
      '\tif (containi(name, "Граната") != -1) return false;',
      '\tif (containi(name, "ХП") != -1) return false;',
      '\tif (containi(name, "Броня") != -1) return false;',
      '\t',
      '\treturn true;',
      '}',
      '',
      '// Запомнить удачную покупку. Повторов не держим: вторая такая же запись',
      '// означала бы вторую выдачу каждый раунд.',
      'zm_hot_keep_remember(id, itemid)',
      '{',
      '\tif (!get_pcvar_num(cvar_keepitems) || !zm_hot_keepable(itemid)) return;',
      '\t',
      '\tstatic i',
      '\tfor (i = 0; i < g_keep_n[id]; i++)',
      '\t\tif (g_keep[id][i] == itemid) return;',
      '\t',
      '\tif (g_keep_n[id] >= ZP_KEEP_MAX) return;',
      '\tg_keep[id][g_keep_n[id]++] = itemid',
      '}',
      '',
      '// Забыть вещь. Нужно, когда выдача не прошла: у игрока кончилась',
      '// привилегия, под которую вещь продавалась, — и без этого отказ',
      '// повторялся бы в чате каждый раунд.',
      'zm_hot_keep_forget(id, itemid)',
      '{',
      '\tstatic i, j',
      '\tfor (i = 0; i < g_keep_n[id]; i++)',
      '\t{',
      '\t\tif (g_keep[id][i] != itemid) continue;',
      '\t\tfor (j = i; j < g_keep_n[id] - 1; j++) g_keep[id][j] = g_keep[id][j + 1]',
      '\t\tg_keep_n[id]--',
      '\t\treturn;',
      '\t}',
      '}',
      '',
      '// Выдать всё запомненное заново.',
      '//',
      '// ⚠️ ТОЛЬКО ОБЫЧНОМУ ЖИВОМУ ЧЕЛОВЕКУ. У Выжившего, Снайпера, Дьявола и',
      '// Убийцы снаряжение по роли, и buy_extra_item на чужую вещь не промолчит —',
      '// он напишет отказ в чат, каждый раунд и каждому такому игроку.',
      '//',
      '// ⚠️ ЗАДЕРЖКА. Выдаём не в самый миг возрождения: мод в эти доли секунды',
      '// открывает меню бесплатного оружия, и выбранный там ствол вытеснил бы',
      '// оплаченный. Платное должно ложиться сверху.',
      'public zm_hot_keep_regive(taskid)',
      '{',
      '\tstatic id',
      '\tid = ID_KEEP',
      '\t',
      '\tif (!get_pcvar_num(cvar_keepitems) || !is_user_valid_alive(id)) return;',
      '\tif (g_zombie[id] || g_survivor[id] || g_sniper[id] || g_nemesis[id] || g_assassin[id]) return;',
      '\t',
      '\tstatic i, item',
      '\tfor (i = 0; i < g_keep_n[id]; i++)',
      '\t{',
      '\t\titem = g_keep[id][i]',
      '\t\t',
      '\t\t// Вещь не для людей — молча пропускаем: её черёд придёт, когда',
      '\t\t// владелец снова окажется в подходящем облике.',
      '\t\tif (!(ArrayGetCell(g_extraitem_team, item) & ZP_TEAM_HUMAN)) continue;',
      '\t\t',
      '\t\tg_fwDummyResult = 0',
      '\t\tbuy_extra_item(id, item, 1)',
      '\t\t',
      '\t\t// Плагин вещи отказал — значит, она игроку больше не положена.',
      '\t\tif (g_fwDummyResult >= ZP_PLUGIN_HANDLED)',
      '\t\t{',
      '\t\t\tzm_hot_keep_forget(id, item)',
      '\t\t\ti--',
      '\t\t}',
      '\t}',
      '}',
      '',
      'buy_extra_item(id, itemid, ignorecost = 0)',
      '{',
    ].join('\n'),
  },
  {
    file: ZP, id: 'покупки: запомнить ночное зрение',
    find: '\t\tcase EXTRA_NVISION: // Night Vision\n\t\t{\n\t\t\tg_nvision[id] = true',
    replace: '\t\tcase EXTRA_NVISION: // Night Vision\n\t\t{\n\t\t\tg_nvision[id] = true\n'
      + '\t\t\tzm_hot_keep_remember(id, itemid)',
  },
  {
    file: ZP, id: 'покупки: запомнить ствол мода',
    find: '\t\t\t\t// Give weapon to the player\n\t\t\t\tfm_give_item(id, wname)',
    replace: '\t\t\t\t// Give weapon to the player\n\t\t\t\tfm_give_item(id, wname)\n'
      + '\t\t\t\tzm_hot_keep_remember(id, itemid)',
  },
  {
    file: ZP, id: 'покупки: запомнить вещь из плагина',
    find: '\t\t\t\t// Item purchase blocked, restore buyer\'s ammo packs\n'
      + '\t\t\t\tif (g_fwDummyResult >= ZP_PLUGIN_HANDLED && !ignorecost)\n'
      + '\t\t\t\t\tg_ammopacks[id] += ArrayGetCell(g_extraitem_cost, itemid)',
    replace: [
      "\t\t\t\t// Item purchase blocked, restore buyer's ammo packs",
      '\t\t\t\tif (g_fwDummyResult >= ZP_PLUGIN_HANDLED)',
      '\t\t\t\t{',
      '\t\t\t\t\tif (!ignorecost)',
      '\t\t\t\t\t\tg_ammopacks[id] += ArrayGetCell(g_extraitem_cost, itemid)',
      '\t\t\t\t}',
      '\t\t\t\telse',
      '\t\t\t\t\tzm_hot_keep_remember(id, itemid)',
    ].join('\n'),
  },
  {
    file: ZP, id: 'покупки: вернуть при возрождении',
    find: '\t// Reset player vars\n\treset_vars(id, 0)\n\tg_buytime[id] = get_gametime()',
    replace: [
      '\t// Reset player vars',
      '\treset_vars(id, 0)',
      '\tg_buytime[id] = get_gametime()',
      '\t',
      '\t// Вернуть купленное снаряжение — см. zm_hot_keep_regive.',
      '\tremove_task(id+TASK_KEEP)',
      '\tif (g_keep_n[id]) set_task(0.75, "zm_hot_keep_regive", id+TASK_KEEP)',
    ].join('\n'),
  },
  {
    // ⚠️ ПОГИБ — ПОТЕРЯЛ. Владелец: «оружие сохраняется купленное после
    // смерти». Возврат задумывался как «не терять оплаченное на смене
    // раунда», а вышло «умер и получил заново» — платить дальше стало не за
    // что. Теперь список чистится в тот же миг, когда игрока убили.
    // ⚠️ ЗАРАЖЕНИЕ СМЕРТЬЮ НЕ СЧИТАЕМ: заражённый жив, он просто на другой
    // стороне, и к следующему раунду вернётся человеком со своим стволом.
    // Иначе покупка сгорала бы почти каждый раунд и теряла всякий смысл.
    file: ZP, id: 'покупки: смерть отменяет',
    find: [
      'public fw_PlayerKilled(victim, attacker, shouldgib)',
      '{',
      '\t// Player killed',
      '\tg_isalive[victim] = false',
    ].join('\n'),
    replace: [
      'public fw_PlayerKilled(victim, attacker, shouldgib)',
      '{',
      '\t// Player killed',
      '\tg_isalive[victim] = false',
      '\t',
      '\t// Купленное снаряжение умирает вместе с хозяином — см. zm_hot_keep_regive.',
      '\tg_keep_n[victim] = 0',
      '\tremove_task(victim+TASK_KEEP)',
    ].join('\n'),
  },
  {
    file: ZP, id: 'покупки: чистый лист на входе',
    find: '\t// Initialize player vars\n\treset_vars(id, 1)',
    replace: '\t// Initialize player vars\n\treset_vars(id, 1)\n'
      + '\t\n'
      + '\t// Список купленного — от прежнего хозяина слота, чужой.\n'
      + '\tg_keep_n[id] = 0',
  },

  // ── привилегии из базы ────────────────────────────────────────────────────
  //
  // Владелец попросил хранить привилегии в базе. У AMXX это умеет штатный
  // admin.sma, но в поставке он собран БЕЗ этой возможности: строка
  // «#define USING_SQL» в нём закомментирована. Включаем и пересобираем его
  // сами (см. tools/assemble.mjs, он добавлен в список компиляции).
  //
  // Что это даёт: выдал привилегию — она действует со следующей команды
  // amx_reloadadmins, без пересборки и перезапуска сервера.
  {
    file: ADMIN, id: 'админы: включить чтение из базы',
    find: '// #define USING_SQL',
    replace: '#define USING_SQL',
  },
  // ⚠️⚠️ ГЛАВНАЯ ЛОВУШКА ЭТОГО ПЕРЕХОДА. Апстрим откатывается на users.ini,
  // только если к базе НЕ УДАЛОСЬ ПОДКЛЮЧИТЬСЯ. А если подключились и таблица
  // пуста — он печатает «нет админов» и оставляет сервер вообще без прав, в
  // том числе без владельца. Ровно так и выглядит первый запуск после переезда,
  // пока таблицу не наполнили. Добавляем откат и на этот случай, и на случай
  // неудачного запроса: список из файла хуже пустого списка не бывает.
  {
    file: ADMIN, id: 'админы: откат на файл, если в базе пусто',
    find: '\t\tSQL_QueryError(query, error, charsmax(error))\n'
      + '\t\tserver_print("[AMXX] %L", LANG_SERVER, "SQL_CANT_LOAD_ADMINS", error)\n'
      + '\t} else if (!SQL_NumResults(query)) {\n'
      + '\t\tserver_print("[AMXX] %L", LANG_SERVER, "NO_ADMINS")\n'
      + '\t} else {',
    replace: [
      '\t\tSQL_QueryError(query, error, charsmax(error))',
      '\t\tserver_print("[AMXX] %L", LANG_SERVER, "SQL_CANT_LOAD_ADMINS", error)',
      '\t\tzm_hot_admins_from_file()',
      '\t} else if (!SQL_NumResults(query)) {',
      '\t\tserver_print("[AMXX] %L", LANG_SERVER, "NO_ADMINS")',
      '\t\tzm_hot_admins_from_file()',
      '\t} else {',
    ].join('\n'),
  },
  {
    file: ADMIN, id: 'админы: сама функция отката',
    find: '#if defined USING_SQL\npublic adminSql()',
    replace: [
      '#if defined USING_SQL',
      '// Запасной список из configs/users.ini. Его собирает наша сборка из',
      '// custom/admins.ini, и он всегда лежит рядом — это последний рубеж, за',
      '// которым сервер остаётся без единого администратора.',
      'zm_hot_admins_from_file()',
      '{',
      '\tnew configsDir[64]',
      '\tget_configsdir(configsDir, charsmax(configsDir))',
      '\tformat(configsDir, charsmax(configsDir), "%s/users.ini", configsDir)',
      '\tserver_print("[AMXX] Список администраторов взят из users.ini: в базе его нет")',
      '\tloadSettings(configsDir)',
      '}',
      '',
      'public adminSql()',
    ].join('\n'),
  },

  // ── админские модели мода: выключены ──────────────────────────────────────
  //
  // ⚠️ ПОЧЕМУ ЭТО ВАЖНО. У мода есть своя пара моделей «для админов», и он
  // ставит их ПОВЕРХ модели класса зомби и поверх выбранного скина. Открывает
  // их строка «ADMIN MODELS = d» в zombie_plague_v44.ini, где «d» — обычный
  // флаг ADMIN_BAN, то есть он есть у КАЖДОГО настоящего админа, включая
  // владельца сервера. Из-за этого владелец брал любой класс зомби, а в игре
  // всегда ходил стандартным zombie_source_v44 — и это выглядело как «модели
  // классов не работают».
  //
  // Проверено живым сервером: одному и тому же боту с классом «Толстяк»
  // с флагом «d» вставала модель zombie_source_v44, без флага — zm_hot_z_heavy.
  //
  // Свои модели у нас раздают класс зомби и zp_skins, поэтому запасной набор
  // мода не нужен вовсе.
  {
    file: ZPCFG, id: 'конфиг: не подменять модель класса админской',
    find: 'zp_admin_models_human 1 // Enable admin player models for humans',
    replace: [
      '// ⚠️ НЕ ВКЛЮЧАТЬ. Мод ставит эти модели поверх модели класса зомби и',
      '// поверх скина, а открыты они по флагу «d» — он есть у любого админа.',
      '// Включишь — админы и владелец перестанут видеть свои классы.',
      'zp_admin_models_human 0 // Enable admin player models for humans',
    ].join('\n'),
  },
  {
    file: ZPCFG, id: 'конфиг: не подменять модель зомби админской',
    find: 'zp_admin_models_zombie 1 // Enable admin player models for zombies',
    replace: 'zp_admin_models_zombie 0 // Enable admin player models for zombies',
  },
  // ── пункт «Кик, бан, мут» в админ-меню мода ───────────────────────────────
  //
  // Кик, бан, мут и убийство живут в нашем zp_admin_menu.sma. Мод про них не
  // знает и просто выполняет от имени игрока команду — связь односторонняя,
  // как и с ножами: уберут плагин, пункт просто ничего не сделает.
  //
  // ⚠️ Клавиша 8 у мода свободна: заняты 1–7 (последняя — ACTION_MODES_MENU)
  // и 0. Ключ у неё номер 7 — нумерация с нуля.
  {
    file: ZP, id: 'админ-меню: пункт «Кик, бан, мут»',
    find: [
      '\t// 0. Exit',
      '\tlen += formatex(menu[len], charsmax(menu) - len, "^n\\r0.\\w %L", id, "MENU_EXIT")',
      '\t',
      '\t// Fix for AMXX custom menus',
      '\tif (pev_valid(id) == PDATA_SAFE)',
      '\t\tset_pdata_int(id, OFFSET_CSMENUCODE, 0, OFFSET_LINUX)',
      '\t',
      '\tshow_menu(id, KEYSMENU, menu, -1, "Admin Menu")',
    ].join('\n'),
    replace: [
      '\t// 8. Кик, бан, мут, убийство — наш плагин',
      '\tif (userflags & (ADMIN_KICK | ADMIN_BAN | ADMIN_CHAT | ADMIN_SLAY))',
      '\t\tlen += formatex(menu[len], charsmax(menu) - len, "\\r8.\\w %L^n", id, "MENU_ADMIN_PUNISH")',
      '\telse',
      '\t\tlen += formatex(menu[len], charsmax(menu) - len, "\\d8. %L^n", id, "MENU_ADMIN_PUNISH")',
      '\t',
      '\t// 0. Exit',
      '\tlen += formatex(menu[len], charsmax(menu) - len, "^n\\r0.\\w %L", id, "MENU_EXIT")',
      '\t',
      '\t// Fix for AMXX custom menus',
      '\tif (pev_valid(id) == PDATA_SAFE)',
      '\t\tset_pdata_int(id, OFFSET_CSMENUCODE, 0, OFFSET_LINUX)',
      '\t',
      '\tshow_menu(id, KEYSMENU, menu, -1, "Admin Menu")',
    ].join('\n'),
  },
  {
    file: ZP, id: 'админ-меню: обработка пункта «Кик, бан, мут»',
    find: '\t\tcase ACTION_MODES_MENU: // Admin Modes command',
    replace: [
      '\t\tcase 7: // Кик, бан, мут, убийство — наш плагин',
      '\t\t{',
      '\t\t\tif (userflags & (ADMIN_KICK | ADMIN_BAN | ADMIN_CHAT | ADMIN_SLAY))',
      '\t\t\t\tclient_cmd(id, "zp_admin")',
      '\t\t}',
      '\t\tcase ACTION_MODES_MENU: // Admin Modes command',
    ].join('\n'),
  },
]

// ── словарь ─────────────────────────────────────────────────────────────────────
//
// Апстрим оставил два десятка строк непереведёнными, а в переведённых — пробел
// перед «!!!», чего в русской типографике нет. Правим и то и другое; ключи,
// которых в файле ещё нет, добавляются вместе с английским запасным вариантом.

const LANG = {
  // новое: заголовок главного меню
  MENU_MAIN_TITLE: { ru: 'Главное меню', en: 'Main Menu' },
  // новое: пункт выбора ножа
  MENU_KNIVES: { ru: 'Выбрать нож...', en: 'Choose knife...' },
  // новое: свой магазин с разделами вместо плоского списка спец-вещей
  MENU_VIP: { ru: 'Привилегии...', en: 'Privileges...' },
  MENU_SKINSHOP: { ru: 'Магазин скинов...', en: 'Skin shop...' },
  // новое: кик, бан, мут и убийство — они в нашем плагине, а не у мода
  MENU_ADMIN_PUNISH: { ru: 'Кик, бан, мут...', en: 'Kick, ban, mute...' },
  // Подписи разделов спец-магазина. Пункт показывает, КУДА перейдёшь, а не где
  // находишься: так понятнее, что на него надо нажать.
  MENU_EXTRA_GUNS: { ru: 'Арсенал (оружие)', en: 'Arsenal (weapons)' },
  MENU_EXTRA_ITEMS: { ru: 'Предметы (снаряжение)', en: 'Items (gear)' },
  // новое: внятный отказ вместо молчания, когда повторный выбор запрещён
  BUY_ALREADY: {
    ru: 'Оружие на этот раунд уже выбрано — меню откроется при возрождении.',
    en: 'You already picked a weapon this round.',
  },

  // оставалось по-английски
  NOTICE_ASSASSIN: { ru: '%s — Убийца!!!' },
  NOTICE_SNIPER: { ru: '%s — Снайпер!!!' },
  NOTICE_ARMAGEDDON: { ru: 'Армагеддон!!!' },
  NOTICE_APOCALYPSE: { ru: 'Апокалипсис!!!' },
  NOTICE_NIGHTMARE: { ru: 'Кошмар!!!' },
  CMD_ASSASSIN: { ru: 'стал Убийцей' },
  CMD_SNIPER: { ru: 'стал Снайпером' },
  CMD_ARMAGEDDON: { ru: 'запустил режим Армагеддон' },
  CMD_APOCALYPSE: { ru: 'запустил режим Апокалипсис' },
  CMD_NIGHTMARE: { ru: 'запустил режим Кошмар' },
  CMD_BLOCK_BUY_EXTRA: { ru: 'Дождитесь начала раунда...' },
  MENU_ADMIN_MODES_TITLE: { ru: 'Режимы игры' },
  MENU_ADMIN8: { ru: 'Снайпером' },
  MENU_ADMIN9: { ru: 'Убийцей' },
  MENU_ADMIN10: { ru: 'Меню режимов' },
  MENU_ADMIN11: { ru: 'Армагеддон' },
  MENU_ADMIN12: { ru: 'Апокалипсис' },
  MENU_ADMIN13: { ru: 'Кошмар' },
  CLASS_SNIPER: { ru: 'Снайпер' },
  CLASS_ASSASSIN: { ru: 'Убийца' },

  // было переведено, но с пробелом перед «!!!» либо не в тон остальным строкам
  NOTICE_FIRST: { ru: '%s — первый зомби!!!' },
  NOTICE_NEMESIS: { ru: '%s — Дьявол!!!' },
  NOTICE_SURVIVOR: { ru: '%s — Выживший!!!' },
  NOTICE_SWARM: { ru: 'Куча на кучу!!!' },
  NOTICE_MULTI: { ru: 'Массовое заражение!!!' },
  NOTICE_PLAGUE: { ru: 'Чума расползается!!!' },
  WIN_HUMAN: { ru: 'Люди победили заразу!' },
  WIN_ZOMBIE: { ru: 'Зомби захватили весь мир!' },
  // CMD_* подставляются в «АДМИН %s — %L», поэтому все они глагольные
  CMD_NEMESIS: { ru: 'стал Дьяволом' },
  CMD_SURVIVAL: { ru: 'стал Выжившим' },
  CMD_SWARM: { ru: 'запустил Кучу на кучу' },
  CMD_MULTI: { ru: 'запустил Массовое заражение' },
  CMD_PLAGUE: { ru: 'запустил Чуму' },
  MENU_ADMIN6: { ru: 'Массовое заражение' },
}

// ── применение ──────────────────────────────────────────────────────────────────

export class CustomizeError extends Error {}

// Исходники ZP пришли со СМЕШАННЫМИ концами строк: начало файла в LF, а часть
// кода — в CRLF. Поэтому многострочные шаблоны ищем без привязки к ним, а в
// замену подставляем тот перевод строки, который был в найденном куске.
function matcher(find) {
  if (!find.includes('\n')) {
    return {
      count: text => text.split(find).length - 1,
      apply: (text, replace) => text.split(find).join(replace),
    }
  }
  const re = new RegExp(
    find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\r?\\n'), 'g')
  return {
    count: text => (text.match(re) || []).length,
    apply: (text, replace) =>
      text.replace(re, hit => (hit.includes('\r\n') ? replace.replace(/\n/g, '\r\n') : replace)),
  }
}

function applyEdits(amxxDir, log) {
  const byFile = new Map()
  for (const e of EDITS) {
    if (!byFile.has(e.file)) byFile.set(e.file, [])
    byFile.get(e.file).push(e)
  }

  let applied = 0
  for (const [file, edits] of byFile) {
    const path = join(amxxDir, ...file.split('/'))
    if (!existsSync(path)) throw new CustomizeError(`нет файла ${path}`)
    let text = readFileSync(path, 'utf8')

    for (const e of edits) {
      const want = e.count ?? 1
      const m = matcher(e.find)
      const got = m.count(text)
      if (got !== want) {
        throw new CustomizeError(
          `правка «${e.id}»: шаблон найден ${got} раз(а), ожидалось ${want} — в ${file}\n` +
          `  искали: ${JSON.stringify(e.find.length > 110 ? `${e.find.slice(0, 110)}…` : e.find)}\n` +
          '  скорее всего обновился апстрим: правку надо привести в соответствие,\n' +
          '  иначе она молча не применится и сервер соберётся без неё')
      }
      text = m.apply(text, e.replace)
      applied++
    }

    writeFileSync(path, text, 'utf8')
    log(`  ${file}: правок ${edits.length}`)
  }
  return applied
}

// Словарь AMXX: секции вида [ru] со строками «КЛЮЧ = значение».
function applyLang(dictPath, log) {
  if (!existsSync(dictPath)) throw new CustomizeError(`нет словаря ${dictPath}`)
  const raw = readFileSync(dictPath, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)

  // Границы секций: [xx] и всё до следующего заголовка.
  const bounds = new Map()
  let cur = null
  lines.forEach((line, i) => {
    const h = line.match(/^\[([a-z]{2})\]\s*$/i)
    if (!h) return
    if (cur) bounds.get(cur).end = i
    cur = h[1].toLowerCase()
    bounds.set(cur, { start: i + 1, end: lines.length })
  })

  const changed = { ru: 0, en: 0 }

  // Идём от последней секции к первой: вставка строк не сдвигает то,
  // что ещё предстоит обработать.
  const targets = ['ru', 'en']
    .filter(l => bounds.has(l))
    .sort((a, b) => bounds.get(b).start - bounds.get(a).start)

  for (const lang of targets) {
    const { start, end } = bounds.get(lang)
    const seen = new Set()
    let lastEntry = start

    for (let i = start; i < end; i++) {
      const kv = lines[i].match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!kv) continue
      lastEntry = i + 1
      const want = LANG[kv[1]]?.[lang]
      if (want === undefined) continue
      seen.add(kv[1])
      if (want !== kv[2]) {
        lines[i] = `${kv[1]} = ${want}`
        changed[lang]++
      }
    }

    const add = Object.entries(LANG)
      .filter(([k, v]) => v[lang] !== undefined && !seen.has(k))
      .map(([k, v]) => `${k} = ${v[lang]}`)
    if (add.length) {
      lines.splice(lastEntry, 0, ...add)
      changed[lang] += add.length
    }
  }

  for (const lang of ['ru', 'en']) {
    if (!bounds.has(lang)) throw new CustomizeError(`в словаре нет секции [${lang}]`)
  }

  writeFileSync(dictPath, lines.join(eol), 'utf8')
  log(`  словарь: строк [ru] ${changed.ru}, [en] ${changed.en}`)
  return changed
}

export function customize({ amxxDir, log = console.log } = {}) {
  const dir = amxxDir ?? join(ROOT, 'server', 'cstrike', 'addons', 'amxmodx')
  log('наши правки поверх апстрима:')
  const edits = applyEdits(dir, log)
  const lang = applyLang(join(dir, 'data', 'lang', 'zombie_plague_v44.txt'), log)
  return { edits, lang }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const r = customize()
    console.log(`готово: правок ${r.edits}, строк словаря ${r.lang.ru + r.lang.en}`)
  } catch (err) {
    console.error(err instanceof CustomizeError ? `ОШИБКА: ${err.message}` : err)
    process.exit(1)
  }
}
