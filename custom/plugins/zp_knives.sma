/*
 * [ZP] Ножи людей: выбор и усиления.
 *
 * Четыре ножа, у каждого свой характер — скорость движения и урон в ближнем
 * бою. Выбор запоминается на диске и переживает смену карты.
 *
 * Вызов меню: пункт «Выбрать нож» в меню по клавише M, команда zp_knife
 * (удобно повесить на клавишу) или в чат /нож.
 *
 * ТОЛЬКО ДЛЯ ЛЮДЕЙ. У зомби своя лапа, и она не косметика: модель когтей
 * задаётся классом зомби (у Раптора одна, у Толстяка другая), а Дьяволу и
 * Убийце мод выдаёт свои. Трогать их нельзя — это часть игрового баланса.
 *
 * ПОЧЕМУ СВОЙ, А НЕ ПЕРЕНЕСЁННЫЙ: плагин ножей из сборки завязан на Zombie
 * Plague Advance (у нас 4.4 Fix5a) и на cs_maxspeed_api — плагин, исходников
 * которого в сборке нет. Модели, звуки и числа взяты оттуда, код написан свой.
 *
 * ПРО ПОРЯДОК ЗАГРУЗКИ: модель ножа мод тоже трогает, в Ham_Item_Deploy.
 * Наш плагин обязан идти НИЖЕ zombie_plague44 в plugins.ini, иначе выбор
 * игрока будет затираться.
 */

#include <amxmodx>
#include <zm_menu>
#include <amxmisc>
#include <fakemeta>
#include <fun>
#include <hamsandwich>
#include <nvault>
#include <zm_db>
#include <xs>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Ножи"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

// Размеры полей с запасом: кириллица в UTF-8 занимает по два байта на букву,
// и подсказка из тридцати русских символов — это уже 54 байта, а не 30.
// EFFECT срабатывает не на каждом ударе, а с шансом CHANCE процентов. MARK —
// то, что видно в меню в скобках; держим его коротким руками, а не собираем
// из эффекта и числа: страница меню ограничена, и лишние буквы там дорого
// стоят — на этом уже обожглись, нижние пункты обрезало на полуслове.
// SND — свой звук удара, PITCH — его тон. Пусто = штатный звук ножа.
//
// ⚠️ ЗАЧЕМ ЭТО ПОЛЕ. Владелец: «у новых ножей нету звуков». Так и было:
// движок играет один и тот же удар ножа независимо от модели, и бензопила
// звучала как обычный клинок. Свой звук — единственное, чем нож слышно
// отличается от соседнего.
// ABIL — способность на ПРАВУЮ КНОПКУ, ACD — сколько секунд её ждать.
//
// ⚠️ ЗАЧЕМ. Владелец: «добавить ножам с привилегией способности на пкм». Пассивный
// эффект срабатывает сам и с шансом — его не «применяют». Способность же жмут
// в нужный миг, и именно она превращает нож из числа в предмет, которым играют.
// Ножам «для всех» способностей нет: разрыв с привилегиями должен быть виден.
enum _:KNIFE { TITLE[48], HINT[96], VMODEL[64], PMODEL[64], SPEED, DMG_PCT, FLAG, EFFECT, CHANCE, MARK[24], SND[40], PITCH, ABIL, ACD }

// Эффекты удара. Ножам «для всех» достаются мелочи, привилегиям — то, что
// видно в бою.
// ⚠️ ЧЕТЫРЁХ ЭФФЕКТОВ БЫЛО МАЛО. Владелец: «добавить эффектов ножам для
// привилегий» — и правда: у восьми привилегированных ножей на четыре эффекта
// приходилось по два-три ножа, и «толчок 35%» от «толчка 60%» в бою не
// отличить. Добавлены три, каждый со своим смыслом:
//
//   EF_BLIND — слепит зомби на пару секунд: не спасает, но даёт уйти
//   EF_SLOW  — оковы: зомби не стоит, а ползёт, и это видно со стороны
//   EF_CHAIN — удар отдаётся по соседним зомби: единственный эффект по толпе
enum { EF_NONE = 0, EF_PUSH, EF_VAMPIRE, EF_FREEZE, EF_BURN, EF_BLIND, EF_SLOW, EF_CHAIN }

// Способности на правую кнопку. Каждая бьёт ПО ПЛОЩАДИ вокруг игрока — этим
// они и отличаются от пассивных свойств, которые работают по одной цели.
//
//   AB_WAVE   огненная волна: поджигает всех зомби вокруг      (Молот фараона)
//   AB_CUT    порез: у задетых десять секунд утекает здоровье  (Коса фараона)
//   AB_QUAKE  толчок земли: расшвыривает всех вокруг           (Кувалда)
//   AB_FROST  наледь: сковывает всех вокруг                    (Ледяной посох)
//   AB_DRAIN  вытяжка: отнимает у зомби и лечит владельца      (Катана)
//   AB_FLASH  вспышка: слепит всех зомби, кто смотрит          (Коготь)
//   AB_JOLT   разряд: цепь по всем ближним                     (Молот)
//   AB_RIP    рывок бура: сильный удар по одному впереди       (Бур)
enum { AB_NONE = 0, AB_WAVE, AB_CUT, AB_QUAKE, AB_FROST, AB_DRAIN, AB_FLASH, AB_JOLT, AB_RIP }

// Заморозка: держим зомби на месте, пока идёт задача возврата скорости.
// ⚠️ Запрос одной строкой: Pawn не склеивает соседние строковые записи.
// Самый длинный пункт текущего меню: по нему считается, сколько их влезет
// на страницу (см. include/zm_menu.inc).
new g_longest

new const SQL_CREATE[] = "CREATE TABLE IF NOT EXISTS zm_knife (steamid VARBINARY(64) NOT NULL PRIMARY KEY, knife VARBINARY(40) NOT NULL DEFAULT '')"

#define TASK_THAW 5100
new bool:g_frozen[33]
// Поджог: сколько тиков урона осталось и кто поджёг.
new g_burn_left[33], g_burn_by[33]
#define TASK_BURN 5200
// Оковы: зомби ползёт, пока идёт задача возврата скорости.
#define TASK_SLOW 5300
new bool:g_slowed[33]
// Спрайты эффектов. Первые два — штатные, они есть у каждого игрока с самой
// игрой. Остальные три мод УЖЕ грузит для своих гранат, поэтому нам они
// достаются даром: ни новой закачки при входе, ни лишнего места в списке
// предзагрузки. Список этот у GoldSrc не резиновый — 512 моделей на карту, а у
// нас одних только стволов и скинов больше сотни.
new g_spr_chain, g_spr_ring
new g_spr_fire, g_spr_frost, g_spr_glow

// Тряска экрана — сообщение, а не эффект; его номер спрашиваем один раз.
new g_msg_shake

// Способность на ПКМ: когда её снова можно применить и когда игрок последний
// раз держал кнопку. Второе нужно, чтобы одно нажатие не сработало десять раз:
// PreThink приходит каждый кадр, а кнопка в нём остаётся нажатой.
new Float:g_ab_ready[33]
new bool:g_ab_held[33]

// Порез: сколько тиков утекания осталось и от кого.
#define TASK_CUT 5400
new g_cut_left[33], g_cut_by[33]

// Уровни привилегий — те же флаги AMXX, что и в чужих сборках, чтобы одна
// запись в users.ini открывала и ножи, и оружие своего уровня.
//   0 — всем;  _H — VIP;  _G — Лидер;  _E — Император;  _D — Фараон;
//   _C — Создатель (главный админ: не продаётся, но открыто всё)
#define VIP       ADMIN_LEVEL_H
#define LEADER    ADMIN_LEVEL_G
#define IMPERATOR ADMIN_LEVEL_E
#define PHARAOH   ADMIN_LEVEL_D
#define CREATOR   ADMIN_LEVEL_C

// SPEED — скорость с ножом в руках. У человека в ZP она около 240, поэтому
// цифры ниже читаются как «быстрее/медленнее обычного». Соотношения взяты из
// той же сборки, откуда модели.
//
// Смысл выбора: нож — это то, с чем человек убегает. Быстрый даёт фору при
// отступлении, тяжёлый — шанс отбиться, если убежать уже не вышло.
// ОДИННАДЦАТЬ ножей из ДВУХ сборок в одном меню. Держать два плагина ножей
// нельзя: оба вешаются на CurWeapon и ставят модель — кто последний, тот и
// прав, а усиления накладываются дважды. Поэтому таблицы слиты сюда, а чужой
// плагин zp_knifes из сборки не переносится.
//
// Урон у ножей из CS-DEAD задан множителями ×2…×8. Это не опечатка: у зомби
// тысячи здоровья, и без множителя нож по ним бесполезен. Их числа оставлены
// как есть — правится в этой таблице.
new const g_knives[][KNIFE] = {
    // Доступны всем. Прибавки нарочно скромные: это то, с чем ходит большинство,
    // и разрыв с привилегиями должен быть виден.
    { "Боевой нож",  "быстрее всех, урон обычный",
      "models/zm_hot_v/view/v_knife_combat_jp.mdl",
      "models/zm_hot_v/view/p_knife_combat_jp01.mdl",       270, 100, 0, EF_NONE, 0, "быстрый", "", 100, AB_NONE, 0 },
    { "Молот",       "медленный, урон +60%, изредка отталкивает",
      "models/zm_hot_v/view/v_knife_hammer_jp.mdl",
      "models/zm_hot_v/view/p_knife_hammer_jp.mdl",         220, 160, IMPERATOR, EF_CHAIN, 30, "цепь 30%", "weapons/knife_hitwall1.wav", 80, AB_JOLT, 35 },
    { "Крюк",        "средний, урон +30%",
      "models/zm_hot_v/view/v_knife_sheeps_word_jp.mdl",
      "models/zm_hot_v/view/p_knife_sheeps_word_jp.mdl",    240, 130, 0, EF_NONE, 0, "урон +30%", "", 100, AB_NONE, 0 },
    { "Коготь",      "обычная скорость, урон ×2",
      "models/zm_hot/v_knife1.mdl", "models/zm_hot/p_knife1.mdl", 240, 200, VIP, EF_BLIND, 25, "слепит 25%", "", 100, AB_FLASH, 30 },

    // ⚠️ ПЯТЬ НОВЫХ ИЗ СБОРОК ВЛАДЕЛЬЦА (tools/port-knives.mjs). Отбирали по
    // ТЕКСТУРАМ, а не по именам: «tornado_knife» оказался не ножом, а
    // техно-буром, «toyhammer2» — игрушечным молотом с наклейками и в сборку не
    // пошёл. Свойства расставлены так, чтобы каждый новый чем-то отличался от
    // уже имеющихся, а не был ещё одной палкой с другим числом урона.
        { "Колун",       "медленный, урон ×3, изредка поджигает",
      "models/zm_hot/v_zm_hot_axe.mdl", "models/zm_hot/p_zm_hot_axe.mdl",
      225, 300, 0, EF_BURN, 10, "огонь 10%", "weapons/knife_hitwall1.wav", 70, AB_NONE, 0 },
    // ⚠️ Назывался «Тесак», но тесак теперь у Толстяка в лапе, и два разных
    // предмета с одним именем в одном сервере путают. Модель — простой клинок
    // CSO, так что честное имя ей «Ножик».
    { "Ножик",       "средний, урон ×3, пьёт здоровье",
      "models/zm_hot/v_zm_hot_blade.mdl", "models/zm_hot/p_zm_hot_blade.mdl",
      250, 300, 0, EF_VAMPIRE, 25, "вампир 25%", "weapons/knife_stab.wav", 85, AB_NONE, 0 },
    { "Бензопила",   "медленная, урон ×5, поджигает",
      "models/zm_hot/v_zm_hot_saw.mdl", "models/zm_hot/p_zm_hot_saw.mdl",
      230, 500, 0, EF_BURN, 40, "огонь 40%", "zm_hot/chainsaw_idle.wav", 100, AB_NONE, 0 },

    // Привилегии. У каждого — свой эффект, ради него нож и берут.
    { "Катана",      "быстрый, урон +30%, лечит за удар",
      "models/zm_hot_v/view/v_knife_katana_jp.mdl",
      "models/zm_hot_v/view/p_knife_katana_jp.mdl",         260, 130, VIP, EF_VAMPIRE, 30, "вампир 30%", "weapons/knife_slash1.wav", 115, AB_DRAIN, 35 },
    { "Молоток",     "урон ×4, отбрасывает зомби",
      "models/zm_hot/v_knife2.mdl", "models/zm_hot/p_knife2.mdl", 240, 400, 0, EF_PUSH, 35, "толчок 35%", "weapons/knife_hitwall1.wav", 85, AB_NONE, 0 },
    { "Ледяной посох", "очень быстрый, урон ×2, замораживает",
      "models/zm_hot/v_knife3.mdl", "models/zm_hot/p_knife3.mdl", 290, 200, IMPERATOR, EF_FREEZE, 15, "лёд 15%", "weapons/knife_slash2.wav", 130, AB_FROST, 40 },
    // ⚠️ Бур и Лазерный меч ПОМЕНЯЛИСЬ МЕСТАМИ по просьбе владельца: Бур встал
    // на уровень Лидера, меч ушёл к Императору.
    { "Бур",         "быстрый, урон ×6, сбивает с ног",
      "models/zm_hot/v_zm_hot_drill.mdl", "models/zm_hot/p_zm_hot_drill.mdl",
      275, 600, LEADER, EF_PUSH, 45, "толчок 45%", "zm_hot/chainsaw_steam.wav", 110, AB_RIP, 25 },
    { "Кувалда",     "очень быстрый, урон ×6, сносит с ног",
      "models/zm_hot/v_knife5.mdl", "models/zm_hot/p_knife5.mdl", 290, 600, LEADER, EF_SLOW, 50, "оковы 50%", "weapons/knife_hitwall1.wav", 60, AB_QUAKE, 35 },
    { "Коса фараона", "очень быстрый, урон ×7, пьёт здоровье",
      "models/zm_hot/v_knife6.mdl", "models/zm_hot/p_knife6.mdl", 290, 700, PHARAOH, EF_VAMPIRE, 60, "вампир 60%", "weapons/knife_slash1.wav", 75, AB_CUT, 40 },
    { "Молот фараона", "очень быстрый, урон ×8, замораживает",
      "models/zm_hot/v_knife7.mdl", "models/zm_hot/p_knife7.mdl", 290, 800, PHARAOH, EF_FREEZE, 35, "лёд 35%", "weapons/knife_hitwall1.wav", 65, AB_WAVE, 40 },

    { "Лазерный меч", "очень быстрый, урон ×5, поджигает",
      "models/zm_hot/v_knife4.mdl", "models/zm_hot/p_knife4.mdl", 290, 500, 0, EF_BURN, 20, "огонь 20%", "weapons/knife_slash2.wav", 140, AB_NONE, 0 },
}

// Тот же трюк, что в самом ZP: пересчёт скорости висит на Ham_Item_PreFrame.
new Ham:Ham_Player_ResetMaxSpeed = Ham_Item_PreFrame

new g_choice[33]
// Игрок выбрал нож руками в этой сессии — поздний ответ базы его не отменит.
#define TASK_READ  5600
#define TASK_GUARD 5700

new bool:g_picked[33]
// ⚠️ ЧТЕНИЕ ЗАВЕРШИЛОСЬ — ХОТЬ КАК-НИБУДЬ. Пока ответа нет, сохранять нельзя:
// выход игрока записал бы «Боевой нож» поверх купленного. База на чужом
// хостинге отвечает не всегда (потерянное соединение молчит десятками секунд),
// и живая проверка это поймала.
new bool:g_read[33]
new bool:g_ready[sizeof g_knives]
new g_vault = INVALID_HANDLE
new cvar_enabled, cvar_log
new cvar_push, cvar_vamp, cvar_vampcap, cvar_freeze, cvar_burnticks, cvar_burndmg
new cvar_slow, cvar_slowpct, cvar_chainpct, cvar_chainradius
new cvar_ab_radius, cvar_ab_jolt, cvar_ab_drain, cvar_ab_rip, cvar_cut_ticks, cvar_cut_dmg

// Урон от нашего же поджога проходит через общий обработчик — на время тика
// он поднят, чтобы не сработать самому на себе.
new bool:g_in_burn

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    cvar_enabled = register_cvar("zp_knives", "1")
    cvar_log     = register_cvar("zp_log_actions", "1")

    // Свойства ножей. Держим в кварах, а не в коде: балансировать это придётся
    // по живой игре, а не по таблице.
    cvar_push      = register_cvar("zp_knife_push", "500")        // сила толчка
    cvar_vamp      = register_cvar("zp_knife_vampire_hp", "15")   // сколько лечит за удар
    cvar_vampcap   = register_cvar("zp_knife_vampire_cap", "200") // выше этого не лечит
    cvar_freeze    = register_cvar("zp_knife_freeze_time", "1.5") // сколько держит лёд
    // Оковы: во сколько раз медленнее ползёт зомби и сколько это длится.
    cvar_slow      = register_cvar("zp_knife_slow_time", "2.5")
    cvar_slowpct   = register_cvar("zp_knife_slow_pct", "45")
    // Цепь: какая доля урона расходится и на сколько единиц вокруг.
    cvar_chainpct    = register_cvar("zp_knife_chain_pct", "40")
    cvar_chainradius = register_cvar("zp_knife_chain_radius", "180.0")
    // Способности на ПКМ: общий радиус и сила каждой.
    cvar_ab_radius = register_cvar("zp_knife_ability_radius", "260.0")
    cvar_ab_jolt   = register_cvar("zp_knife_ability_jolt", "400.0")
    cvar_ab_drain  = register_cvar("zp_knife_ability_drain", "350.0")
    cvar_ab_rip    = register_cvar("zp_knife_ability_rip", "900.0")
    // Порез: сколько секунд утекает и по сколько за секунду.
    cvar_cut_ticks = register_cvar("zp_knife_cut_ticks", "10")
    cvar_cut_dmg   = register_cvar("zp_knife_cut_dmg", "60.0")
    cvar_burnticks = register_cvar("zp_knife_burn_ticks", "5")    // сколько тиков горит
    cvar_burndmg   = register_cvar("zp_knife_burn_damage", "25")  // урон за тик

    register_clcmd("zp_knife", "cmd_menu")
    register_clcmd("say /нож", "cmd_menu")
    register_clcmd("say /knife", "cmd_menu")
    register_clcmd("say_team /нож", "cmd_menu")

    register_event("CurWeapon", "event_curweapon", "be", "1=1", "2=29")   // 29 = нож
    RegisterHam(Ham_TakeDamage, "player", "fw_TakeDamage", 0)

    // Способность на ПКМ. Ловим кнопку в PreThink: она приходит пакетом
    // движения, и никакой команды на неё нет.
    register_forward(FM_PlayerPreThink, "fw_PreThink_Abil")
    RegisterHam(Ham_Player_ResetMaxSpeed, "player", "fw_ResetSpeed_Post", 1)

    // Лёд и огонь снимаем при смерти и при возрождении: иначе задача доживёт
    // до следующего раунда и подожжёт уже другого игрока в этом слоте.
    RegisterHam(Ham_Killed, "player", "fw_killed_post", 1)
    RegisterHam(Ham_Spawn, "player", "fw_spawn_post", 1)

    zm_db_init()
    if (zm_db_on()) zm_db_create(SQL_CREATE)

    g_spr_chain = precache_model("sprites/lgtning.spr")
    g_spr_ring  = precache_model("sprites/shockwave.spr")

    g_msg_shake = get_user_msgid("ScreenShake")

    g_vault = nvault_open("zpknives")
    if (g_vault == INVALID_HANDLE) log_amx("хранилище ножей не открылось — выбор сохраняться не будет")
}

public plugin_end()
{
    if (g_vault != INVALID_HANDLE) nvault_close(g_vault)
}

// Индекс спрайта или ноль, если файла нет: без него эффект просто не рисуется,
// а вот precache_model на отсутствующий файл роняет сервер целиком.
spr(const path[])
{
    if (!file_exists(path))
    {
        log_amx("нет спрайта эффекта: %s", path)
        return 0;
    }
    return precache_model(path);
}

public plugin_precache()
{
    // Картинки способностей. Те же файлы, что у огненной и морозной гранаты
    // мода, — берём их, а не свои, чтобы игроку нечего было докачивать.
    g_spr_fire  = spr("sprites/zombie_plague_v44/fire_explode.spr")
    g_spr_frost = spr("sprites/zombie_plague_v44/frost_explode.spr")
    g_spr_glow  = spr("sprites/zombie_plague_v44/flare_trail.spr")

    // Нет файла — нож просто не появится в меню. Ронять сервер из-за
    // косметики нельзя, а precache_model на отсутствующий файл делает именно это.
    for (new i = 0; i < sizeof g_knives; i++)
    {
        if (!file_exists(g_knives[i][VMODEL]))
        {
            log_amx("нет модели: %s", g_knives[i][VMODEL])
            continue;
        }

        precache_model(g_knives[i][VMODEL])
        if (file_exists(g_knives[i][PMODEL])) precache_model(g_knives[i][PMODEL])
        g_ready[i] = true

        // Свой звук удара. ⚠️ В исходнике путь пишется БЕЗ «sound/», а на диске
        // файл лежит именно там — на этом уже спотыкались в других плагинах.
        if (!g_knives[i][SND][0]) continue;
        new path[80]
        formatex(path, charsmax(path), "sound/%s", g_knives[i][SND])
        if (file_exists(path)) precache_sound(g_knives[i][SND])
        else log_amx("нет звука ножа: %s", path)
    }
}

// ── ключ хранилища ──────────────────────────────────────────────────────────────
//
// Настоящий SteamID вида STEAM_0:1:N, иначе — по нику. Проверяем ФОРМАТ, а не
// префикс: под «начинается на STEAM_» подходит и STEAM_ID_LAN, и тогда все
// игроки делят одну запись.
//
// ⚠️ given — ID, пришедший вместе с форвардом авторизации. Спрашивать его у
// движка можно не всегда: на входе в игру его ещё может не быть, и тогда
// get_user_authid отдаёт STEAM_ID_PENDING (подробности у load()).
key_of(id, key[], len, const given[] = "")
{
    new authid[44]
    if (given[0]) copy(authid, charsmax(authid), given)
    else get_user_authid(id, authid, charsmax(authid))

    if (strlen(authid) > 9 && equal(authid, "STEAM_", 6)
        && authid[7] == ':' && (authid[8] == '0' || authid[8] == '1') && authid[9] == ':')
    {
        copy(key, len, authid)
        return;
    }

    new name[32]
    get_user_name(id, name, charsmax(name))
    formatex(key, len, "ник:%s", name)
}

public client_putinserver(id)
{
    g_choice[id] = 0
    g_picked[id] = false
    g_read[id] = false
    clear_effects(id)
    load(id, "")
}

// ⚠️⚠️ ЧИТАЕМ ВЫБОР И ЗДЕСЬ ТОЖЕ, А НЕ ТОЛЬКО НА ВХОДЕ В ИГРУ. Ключ хранилища —
// SteamID, а на входе его может ЕЩЁ НЕ БЫТЬ: в amxmodx.inc про putinserver
// прямо сказано, что порядок с авторизацией не определён. Пока ID нет,
// get_user_authid отдаёт STEAM_ID_PENDING, ключ съезжает на «ник:Имя», а
// сохранялись мы при выходе под настоящим SteamID — запись не находилась.
// Ровно поэтому нож не переживал перезаход.
//
// Порядок не определён в ОБЕ стороны, поэтому читаем в обоих местах: что
// сработает раньше, то и вернёт выбор, второе чтение просто повторит его.
public client_authorized(id, const authid[]) load(id, authid)

load(id, const authid[])
{
    if (!zm_db_on()) { load_from_vault(id, authid); g_read[id] = true; return; }

    // ⚠️ НЕ СРАЗУ И ВРАЗНОБОЙ. Очередь запросов у сервера одна на всех, а на
    // смене карты входят все разом — подробности в шапке include/zm_db.inc.
    // Заодно оба обращения (вход и авторизация) сводятся в ОДИН запрос: вторая
    // задача заменяет первую. К этому времени SteamID уже точно пришёл, и ключ
    // строится по нему, а не по нику.
    remove_task(id + TASK_READ)
    set_task(zm_db_when(id, 3.4), "read_later", id + TASK_READ)
}

public read_later(taskid)
{
    new id = taskid - TASK_READ
    if (!is_user_connected(id)) return;
    load_from_db(id, "")

    // Сторож на случай молчания: без ответа игрок остался бы «непрочитанным»
    // до конца карты, и его нож не сохранился бы вовсе.
    remove_task(id + TASK_GUARD)
    set_task(zm_db_patience(), "read_guard", id + TASK_GUARD)
}

public read_guard(taskid)
{
    new id = taskid - TASK_GUARD
    if (!is_user_connected(id) || g_read[id]) return;
    log_amx("БАЗА: нож — ответа нет, читаем зеркало")
    load_from_vault(id, "")
}

// ── база ────────────────────────────────────────────────────────────────────────
//
// ⚠️ ХРАНИМ ИМЯ МОДЕЛИ, А НЕ НОМЕР В СПИСКЕ. Номер — это место ножа в таблице
// выше, и владелец её уже дважды перетасовывал: «Косу фараона — фараону,
// Ледяной посох — императору». После каждой такой перестановки сохранённая
// «семёрка» отдавала игроку СОВСЕМ ДРУГОЙ нож, и со стороны это выглядело как
// «выбор сбрасывается сам». На скинах эту грабку уже прошли, здесь она осталась
// и всплыла бы при следующей же правке меню.
//
// Старые числовые записи читаются как номера — по-другому их уже не понять.

load_from_db(id, const authid[])
{
    new key[64]
    zm_db_key(id, key, charsmax(key), authid)

    new sql[192]
    formatex(sql, charsmax(sql), "SELECT knife FROM zm_knife WHERE steamid = '%s'", key)

    // ⚠️ Везём userid: пока база отвечает, слот может занять другой человек.
    new data[2]
    data[0] = id
    data[1] = get_user_userid(id)
    SQL_ThreadQuery(zm_db_tuple(), "sql_loaded", sql, data, sizeof data)
}

public sql_loaded(failstate, Handle:query, const error[], errnum, const data[], size, Float:queuetime)
{
    new id = data[0]
    if (!is_user_connected(id) || get_user_userid(id) != data[1]) return;
    if (g_picked[id]) return;   // игрок успел выбрать сам — его выбор главнее

    if (failstate != TQUERY_SUCCESS)
    {
        log_amx("БАЗА: нож не прочитался (%d): %s — читаем зеркало", errnum, error)
        load_from_vault(id, "")
        return;
    }
    if (SQL_NumResults(query) < 1) { load_from_vault(id, ""); return; }

    new name[40]
    SQL_ReadResult(query, 0, name, charsmax(name))
    take(id, index_of(name))
    g_read[id] = true
}

save_to_db(id, const key[])
{
    if (!zm_db_on()) return;

    new sql[256], name[40]
    model_of(g_choice[id], name, charsmax(name))
    formatex(sql, charsmax(sql), "REPLACE INTO zm_knife (steamid, knife) VALUES ('%s', '%s')", key, name)
    SQL_ThreadQuery(zm_db_tuple(), "sql_saved", sql)
}

public sql_saved(failstate, Handle:query, const error[], errnum, const data[], size, Float:queuetime)
{
    if (failstate == TQUERY_SUCCESS) return;
    log_amx("БАЗА: нож не сохранился (%d): %s", errnum, error)
}

// Имя модели без пути — оно и есть наш ключ ножа. У «обычного» ножа модели
// своей нет, поэтому у него пусто.
model_of(n, out[], len)
{
    out[0] = 0
    if (n <= 0 || n >= sizeof g_knives) return;

    new path[64]
    copy(path, charsmax(path), g_knives[n][VMODEL])
    new slash = -1
    for (new i = 0; path[i]; i++) if (path[i] == '/' || path[i] == '\') slash = i
    copy(out, len, path[slash + 1])
}

// Номер ножа по имени модели. Пусто и «0» — обычный нож; число — старая запись
// с номером; всё остальное ищем по моделям.
index_of(const name[])
{
    if (!name[0]) return 0;
    if (name[0] >= '0' && name[0] <= '9') return str_to_num(name);

    new mine[40]
    for (new i = 0; i < sizeof g_knives; i++)
    {
        model_of(i, mine, charsmax(mine))
        if (mine[0] && equal(mine, name)) return i;
    }
    return -1;
}

// Принять прочитанный выбор. Привилегия могла кончиться, пока игрока не было:
// тогда сохранённый нож ему больше не положен, и молча возвращаем обычный.
take(id, n)
{
    if (n >= 0 && n < sizeof g_knives && g_ready[n] && allowed(id, n)) g_choice[id] = n
}

load_from_vault(id, const authid[])
{
    // Ответ получен в любом случае: «в зеркале пусто» — это тоже ответ, и
    // сохранять после него можно.
    g_read[id] = true
    if (g_vault == INVALID_HANDLE) return;

    new key[64], data[40]
    key_of(id, key, charsmax(key), authid)
    if (!nvault_get(g_vault, key, data, charsmax(data))) return;

    take(id, index_of(data))
}

public client_disconnected(id, bool:drop, message[], maxlen)
{
    remove_task(id + TASK_READ)
    remove_task(id + TASK_GUARD)
    clear_effects(id)
    save(id)
}

// ⚠️ nvault держит записи В ПАМЯТИ и пишет их на диск только при закрытии.
// Пока сервер не остановят штатно, на диске ничего нет: закрыли окно, упал,
// перезапустили батником — и выбор игрока пропал. Поэтому после записи
// закрываем и открываем хранилище заново: это и есть сброс на диск. Файл
// маленький (около килобайта), так что стоит дёшево.
save(id)
{
    // ⚠️ НЕ СОХРАНЯЕМ, ЕСЛИ НЕ ПРОЧИТАЛИ. Иначе выход игрока запишет поверх
    // купленного ножа тот, что стоит по умолчанию.
    if (!g_read[id] && !g_picked[id]) return;

    new key[64], data[40]
    key_of(id, key, charsmax(key))

    save_to_db(id, key)

    if (g_vault == INVALID_HANDLE) return;

    // Зеркало на диске — тем же именем модели, что и в базе: два разных вида
    // записи означали бы, что после отказа базы игрок получает не то, что
    // выбирал.
    model_of(g_choice[id], data, charsmax(data))
    nvault_set(g_vault, key, data)

    nvault_close(g_vault)
    g_vault = nvault_open("zpknives")
    if (g_vault == INVALID_HANDLE) log_amx("хранилище ножей не открылось после записи")
}

// ── меню ────────────────────────────────────────────────────────────────────────

public cmd_menu(id)
{
    if (!get_pcvar_num(cvar_enabled)) return PLUGIN_HANDLED;

    new title[96]
    formatex(title, charsmax(title), "\y[Вспышка эпидемии]\w Нож^n\d----------------------------")
    g_longest = 0
    new menu = menu_create(title, "menu_pick")

    // ⚠️ ПОРЯДОК СОБИРАЕМ ЗДЕСЬ, А НЕ В ТАБЛИЦЕ. Владелец попросил сортировку:
    // сначала доступные, потом закрытые, внутри — по возрастанию уровня, а
    // внутри уровня в порядке таблицы. Так игрок сразу видит, чем может взять,
    // а не выискивает своё среди серых строк. В самой таблице ножи стоят так,
    // как их удобно править, и трогать её ради вида меню незачем.
    for (new pass = 0; pass < 2; pass++)
    {
        for (new rank = 0; rank <= 5; rank++)
        {
            for (new i = 0; i < sizeof g_knives; i++)
            {
                if (tier_rank(g_knives[i][FLAG]) != rank) continue;
                new bool:open = g_ready[i] && allowed(id, i)
                if ((pass == 0) != open) continue;

                new line[96], num[4]
                num_to_str(i, num, charsmax(num))

                // Уровень выделяем цветом, а не только словом: в списке из
                // шестнадцати строк глазом ищется цвет, а не текст.
                //   жёлтый  — выбранный сейчас
                //   белый   — доступен
                //   красный — закрыт уровнем
                // В скобках коротко: чем открывается и что даёт. Полное
                // описание уходит в чат при выборе — на страницу меню у
                // GoldSrc отведены считанные сотни байт, а кириллица весит по
                // два байта на букву.
                if (!g_ready[i])
                    formatex(line, charsmax(line), "\d%s \rнет модели", g_knives[i][TITLE])
                else if (!open)
                    formatex(line, charsmax(line), "\d%s \r%s \d%s",
                        g_knives[i][TITLE], tier_name(g_knives[i][FLAG]), g_knives[i][MARK])
                else if (i == g_choice[id])
                    formatex(line, charsmax(line), "\y%s \d%s",
                        g_knives[i][TITLE], g_knives[i][MARK])
                else if (g_knives[i][FLAG] == 0)
                    formatex(line, charsmax(line), "\w%s \d%s",
                        g_knives[i][TITLE], g_knives[i][MARK])
                else
                    formatex(line, charsmax(line), "\w%s \y%s \d%s",
                        g_knives[i][TITLE], tier_name(g_knives[i][FLAG]), g_knives[i][MARK])

                zm_menu_seen(g_longest, line)

                menu_additem(menu, line, num, 0)
            }
        }
    }

    // Пять на страницу: с подписями семь строк в страницу уже не влезают.
    menu_setprop(menu, MPROP_PERPAGE, 5)
    menu_setprop(menu, MPROP_EXITNAME, "Выход")
    zm_menu_fit(menu, title, g_longest)
    menu_display(id, menu)
    return PLUGIN_HANDLED;
}

public menu_pick(id, menu, item)
{
    if (item == MENU_EXIT) { menu_destroy(menu); return PLUGIN_HANDLED; }

    new info[4], name[64], access, callback
    menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback)
    menu_destroy(menu)

    new n = str_to_num(info)
    if (n < 0 || n >= sizeof g_knives || !g_ready[n])
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Этот нож недоступен.")
        return PLUGIN_HANDLED;
    }

    // Проверяем здесь, а не только при показе меню: пункт можно выбрать и
    // командой, минуя меню, — на одну лишь серую подсветку полагаться нельзя.
    if (!allowed(id, n))
    {
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 «%s» открывает уровень ^x04%s^x01.", g_knives[n][TITLE], tier_name(g_knives[n][FLAG]))
        return PLUGIN_HANDLED;
    }

    g_choice[id] = n
    g_picked[id] = true   // ответ базы, пришедший позже, этот выбор не отменит
    save(id)          // сразу на диск: до выхода игрок может и не дожить

    new who[32]
    get_user_name(id, who, charsmax(who))
    zlog("НОЖ: %s выбрал «%s»", who, g_knives[n][TITLE])

    client_print_color(id, print_team_default,
        "^x04[Вспышка эпидемии]^x01 Нож: ^x04%s^x01 (%s)", g_knives[n][TITLE], g_knives[n][HINT])

    // Если нож уже в руках — меняем прямо сейчас, не дожидаясь возрождения.
    if (active(id) && get_user_weapon(id) == CSW_KNIFE)
    {
        apply(id)
        ExecuteHamB(Ham_Player_ResetMaxSpeed, id)
    }

    return PLUGIN_HANDLED;
}

// ── применение ──────────────────────────────────────────────────────────────────

// Доступен ли нож этому игроку по уровню привилегии.
bool:allowed(id, i)
{
    new flag = g_knives[i][FLAG]
    return flag == 0 || (get_user_flags(id) & flag) != 0;
}

// Коротко: это подпись к закрытому пункту меню, а место в нём на счету.
// Место уровня в лестнице — по нему меню и сортирует. Отдельно от tier_name(),
// потому что буквы флагов идут не по порядку: ADMIN_LEVEL_H это VIP, а
// ADMIN_LEVEL_C — Создатель, и сравнивать сами флаги бессмысленно.
tier_rank(flag)
{
    switch (flag)
    {
        case VIP:       return 1;
        case LEADER:    return 2;
        case IMPERATOR: return 3;
        case PHARAOH:   return 4;
        case CREATOR:   return 5;
    }
    return 0;
}

tier_name(flag)
{
    static s[32]
    switch (flag)
    {
        case VIP:       copy(s, charsmax(s), "VIP")
        case LEADER:    copy(s, charsmax(s), "Лидер")
        case IMPERATOR: copy(s, charsmax(s), "Император")
        case PHARAOH:   copy(s, charsmax(s), "Фараон")
        case CREATOR:   copy(s, charsmax(s), "Создатель")
        default:        copy(s, charsmax(s), "всем")
    }
    return s;
}

bool:active(id)
{
    if (!get_pcvar_num(cvar_enabled) || !is_user_alive(id)) return false;

    // Только люди. У зомби лапа задаётся его классом, а Дьяволу и Убийце мод
    // выдаёт свою — подменять их значит ломать баланс.
    if (zp_get_user_zombie(id)) return false;

    // Выживший и Снайпер — особые роли со своим снаряжением, тоже не трогаем.
    if (zp_get_user_survivor(id) || zp_get_user_sniper(id)) return false;

    return g_ready[g_choice[id]];
}

apply(id)
{
    new i = g_choice[id]
    set_pev(id, pev_viewmodel2, g_knives[i][VMODEL])
    set_pev(id, pev_weaponmodel2, g_knives[i][PMODEL])
}

public event_curweapon(id)
{
    if (!active(id)) return;
    apply(id)
}

public fw_ResetSpeed_Post(id)
{
    // Замороженного держим на месте здесь, а не разово в момент удара: мод
    // пересчитывает скорость каждый кадр и стёр бы наше значение через кадр.
    if (g_frozen[id]) { set_pev(id, pev_maxspeed, 1.0); return; }

    // Оковы: не остановка, а доля от собственной скорости. Считаем ОТ той, что
    // мод уже поставил, — у зомби она своя у каждого класса, и подменять её
    // числом значило бы уравнять всех.
    if (g_slowed[id])
    {
        static Float:now
        pev(id, pev_maxspeed, now)
        new Float:left = float(100 - get_pcvar_num(cvar_slowpct)) / 100.0
        if (now > 1.0) set_pev(id, pev_maxspeed, now * left)
        return;
    }

    if (!active(id)) return;

    new Float:speed = float(g_knives[g_choice[id]][SPEED])
    if (speed > 1.0) set_pev(id, pev_maxspeed, speed)
}

public fw_TakeDamage(victim, inflictor, attacker, Float:damage, damagebits)
{
    // Урон от нашего же поджога приходит сюда снова. Без этой отсечки нож
    // «поджигал бы поджог»: множитель применился бы повторно, а эффект мог
    // бы разжечь новый костёр — и так по кругу.
    if (g_in_burn) return HAM_IGNORED;

    if (!is_user_connected(attacker) || attacker == victim) return HAM_IGNORED;
    if (!active(attacker) || get_user_weapon(attacker) != CSW_KNIFE) return HAM_IGNORED;

    new n = g_choice[attacker]
    new pct = g_knives[n][DMG_PCT]
    if (pct != 100) SetHamParamFloat(4, damage * float(pct) / 100.0)

    // Голос ножа. Играем ПОВЕРХ штатного удара, на своём канале: заглушить
    // движковый нельзя, а поверх слышно и бензопилу, и бур.
    if (g_knives[n][SND][0])
        emit_sound(attacker, CHAN_WEAPON, g_knives[n][SND], VOL_NORM, ATTN_NORM, 0, g_knives[n][PITCH])

    // Эффекты — только по зомби: нож человека против человека и так не бьёт,
    // а замораживать союзника было бы издевательством.
    if (is_user_alive(victim) && zp_get_user_zombie(victim))
        effect(attacker, victim, n, damage * float(pct) / 100.0)

    return pct == 100 ? HAM_IGNORED : HAM_HANDLED;
}

// ── свойства ножей ──────────────────────────────────────────────────────────────

effect(attacker, victim, n, Float:dealt)
{
    new kind = g_knives[n][EFFECT]
    if (kind == EF_NONE) return;
    if (random_num(1, 100) > g_knives[n][CHANCE]) return;

    switch (kind)
    {
        case EF_PUSH: push(attacker, victim)
        case EF_VAMPIRE: vampire(attacker, dealt)
        case EF_FREEZE: freeze(victim)
        case EF_BURN: ignite(attacker, victim)
        case EF_BLIND: blind(victim)
        case EF_SLOW: slow(victim)
        case EF_CHAIN: chain(attacker, victim, dealt)
    }
}

// Толчок ОТ бьющего: направление берём по разнице точек, иначе зомби улетал бы
// туда, куда смотрит игрок, а не от удара.
push(attacker, victim)
{
    static Float:from[3], Float:to[3], Float:vel[3]
    pev(attacker, pev_origin, from)
    pev(victim, pev_origin, to)

    xs_vec_sub(to, from, vel)
    vel[2] = 0.0
    if (xs_vec_len(vel) < 1.0) return;

    xs_vec_normalize(vel, vel)
    xs_vec_mul_scalar(vel, get_pcvar_float(cvar_push), vel)
    vel[2] = get_pcvar_float(cvar_push) / 4.0     // немного вверх, иначе цепляется за пол

    set_pev(victim, pev_velocity, vel)
}

vampire(attacker, Float:dealt)
{
    if (!is_user_alive(attacker)) return;

    new add = get_pcvar_num(cvar_vamp)
    new cap = get_pcvar_num(cvar_vampcap)
    new hp = get_user_health(attacker)
    if (hp >= cap) return;

    // За удар не больше половины нанесённого: иначе нож с урном ×7 делал бы
    // владельца бессмертным.
    new limit = floatround(dealt / 2.0)
    if (add > limit) add = limit
    if (add <= 0) return;

    set_user_health(attacker, min(hp + add, cap))
}

freeze(victim)
{
    // Немезиду заморозку не ставим: он и есть событие раунда, и обездвижить
    // его ножом — значит отменить событие.
    if (zp_get_user_nemesis(victim)) return;
    if (g_frozen[victim]) return;

    static Float:still[3]
    still[0] = 0.0; still[1] = 0.0; still[2] = 0.0

    g_frozen[victim] = true
    set_pev(victim, pev_velocity, still)
    set_pev(victim, pev_maxspeed, 1.0)
    set_user_rendering(victim, kRenderFxGlowShell, 0, 100, 200, kRenderNormal, 25)

    set_task(get_pcvar_float(cvar_freeze), "thaw", victim + TASK_THAW)
}

public thaw(task)
{
    new id = task - TASK_THAW
    if (!g_frozen[id]) return;

    g_frozen[id] = false
    if (!is_user_connected(id)) return;

    set_user_rendering(id, kRenderFxNone, 0, 0, 0, kRenderNormal, 0)
    if (is_user_alive(id)) ExecuteHamB(Ham_Player_ResetMaxSpeed, id)
}

// ── ослепление ──────────────────────────────────────────────────────────────────
//
// Заливаем экран зомби светом на пару секунд. Не спасает — но даёт человеку
// уйти, а это и есть смысл ножа: нож нужен тому, кто убегает.
blind(victim)
{
    if (zp_get_user_nemesis(victim)) return;

    message_begin(MSG_ONE_UNRELIABLE, get_user_msgid("ScreenFade"), _, victim)
    write_short(1 << 12)        // сколько держать, в 1/4096 секунды
    write_short(1 << 12)        // сколько гаснуть
    write_short(0x0000)         // обычная заливка, не «в цвет»
    write_byte(255)
    write_byte(255)
    write_byte(255)
    write_byte(220)
    message_end()
}

// ── оковы ───────────────────────────────────────────────────────────────────────
//
// Не остановка, как у льда, а вязкость: зомби ползёт. Отличается от заморозки
// и на глаз, и на слух — он продолжает идти, просто медленно.
slow(victim)
{
    if (zp_get_user_nemesis(victim)) return;
    if (g_slowed[victim] || g_frozen[victim]) return;

    g_slowed[victim] = true
    set_user_rendering(victim, kRenderFxGlowShell, 120, 120, 200, kRenderNormal, 16)
    set_task(get_pcvar_float(cvar_slow), "unslow", victim + TASK_SLOW)
}

public unslow(task)
{
    new id = task - TASK_SLOW
    if (!g_slowed[id]) return;

    g_slowed[id] = false
    if (!is_user_connected(id)) return;

    set_user_rendering(id, kRenderFxNone, 0, 0, 0, kRenderNormal, 0)
    if (is_user_alive(id)) ExecuteHamB(Ham_Player_ResetMaxSpeed, id)
}

// ── цепь ────────────────────────────────────────────────────────────────────────
//
// Единственный эффект, работающий по толпе: часть урона расходится на зомби
// вокруг жертвы. ⚠️ Урон наносим ЧЕРЕЗ общий обработчик с поднятым флагом
// g_in_burn — иначе цепь вызовет саму себя по кругу.
chain(attacker, victim, Float:dealt)
{
    // ⚠️ Точку для MSG_PVS отдаём через message_begin_f, а не message_begin: у
    // второго третий довод не помечен как Float, и на дробных координатах он
    // ругается на несовпадение тегов, хотя байты те же.
    static Float:at[3], Float:other[3]
    pev(victim, pev_origin, at)

    new Float:radius = get_pcvar_float(cvar_chainradius)
    new Float:share = dealt * get_pcvar_float(cvar_chainpct) / 100.0
    if (share < 1.0) return;

    new players[32], num, hit = 0
    get_players(players, num, "a")
    for (new i = 0; i < num; i++)
    {
        new v = players[i]
        if (v == victim || v == attacker) continue;
        if (!zp_get_user_zombie(v)) continue;

        pev(v, pev_origin, other)
        if (get_distance_f(at, other) > radius) continue;

        g_in_burn = true
        ExecuteHamB(Ham_TakeDamage, v, 0, attacker, share, DMG_SLASH)
        g_in_burn = false
        hit++

        // Ниточка от жертвы к соседу: без неё непонятно, почему он потерял
        // здоровье, стоя в стороне.
        message_begin_f(MSG_PVS, SVC_TEMPENTITY, at)
        write_byte(TE_BEAMENTS)
        write_short(victim)
        write_short(v)
        write_short(g_spr_chain)
        write_byte(0)
        write_byte(0)
        write_byte(2)
        write_byte(6)
        write_byte(0)
        write_byte(180)
        write_byte(220)
        write_byte(255)
        write_byte(200)
        write_byte(0)
        message_end()

        if (hit >= 4) break;    // четверых хватает: дальше это уже не нож
    }
}

// ── способность на правую кнопку ────────────────────────────────────────────────
//
// ⚠️ Кнопку ловим в PreThink, а не командой: состояние кнопок приходит с машины
// игрока пакетом движения, и никакой консольной команды на ПКМ нет. Отпускание
// отслеживаем сами — иначе одно нажатие срабатывало бы каждый кадр.
public fw_PreThink_Abil(id)
{
    if (!get_pcvar_num(cvar_enabled) || !is_user_alive(id)) return FMRES_IGNORED;

    new bool:down = (pev(id, pev_button) & IN_ATTACK2) != 0
    if (!down) { g_ab_held[id] = false; return FMRES_IGNORED; }
    if (g_ab_held[id]) return FMRES_IGNORED;
    g_ab_held[id] = true

    if (!active(id) || get_user_weapon(id) != CSW_KNIFE) return FMRES_IGNORED;

    new n = g_choice[id]
    new kind = g_knives[n][ABIL]
    if (kind == AB_NONE) return FMRES_IGNORED;

    new Float:now = get_gametime()
    if (now < g_ab_ready[id])
    {
        set_dhudmessage(255, 120, 120, -1.0, 0.66, 0, 0.0, 1.0, 0.0, 0.1)
        show_dhudmessage(id, "Способность через %d с", floatround(g_ab_ready[id] - now, floatround_ceil))
        return FMRES_IGNORED;
    }

    g_ab_ready[id] = now + float(g_knives[n][ACD])
    use_ability(id, kind)
    return FMRES_IGNORED;
}

// Все способности бьют по площади вокруг игрока. Радиус один на всех: разные
// числа игрок всё равно не удержит в голове, а разница в действии и так видна.
use_ability(id, kind)
{
    static Float:me[3], Float:his[3]
    pev(id, pev_origin, me)

    new Float:radius = get_pcvar_float(cvar_ab_radius)
    new players[32], num, touched = 0
    get_players(players, num, "a")

    // Кольцо по полу — общий знак «сработало», цвет у каждой способности свой.
    new r = 200, g = 200, b = 255
    switch (kind)
    {
        case AB_WAVE:  { r = 255; g = 120; b = 0; }
        case AB_CUT:   { r = 200; g = 0;   b = 0; }
        case AB_QUAKE: { r = 220; g = 200; b = 120; }
        case AB_FROST: { r = 80;  g = 180; b = 255; }
        case AB_DRAIN: { r = 180; g = 0;   b = 200; }
        case AB_FLASH: { r = 255; g = 255; b = 255; }
        case AB_JOLT:  { r = 120; g = 200; b = 255; }
        case AB_RIP:   { r = 255; g = 200; b = 60; }
    }
    ability_ring(me, floatround(radius), r, g, b)
    ability_burst(kind, me, floatround(radius), r, g, b)

    for (new i = 0; i < num; i++)
    {
        new v = players[i]
        if (v == id || !zp_get_user_zombie(v)) continue;

        pev(v, pev_origin, his)
        if (get_distance_f(me, his) > radius) continue;

        switch (kind)
        {
            case AB_WAVE:  ignite(id, v)
            case AB_CUT:   start_cut(id, v)
            case AB_QUAKE: push(id, v)
            case AB_FROST: freeze(v)
            case AB_FLASH: blind(v)
            case AB_JOLT:
            {
                g_in_burn = true
                ExecuteHamB(Ham_TakeDamage, v, 0, id, get_pcvar_float(cvar_ab_jolt), DMG_SHOCK)
                g_in_burn = false
            }
            case AB_DRAIN:
            {
                new Float:take = get_pcvar_float(cvar_ab_drain)
                g_in_burn = true
                ExecuteHamB(Ham_TakeDamage, v, 0, id, take, DMG_SLASH)
                g_in_burn = false
                vampire(id, take)
            }
            case AB_RIP:
            {
                // Рывок бьёт ОДНОГО, зато сильно: это не волна, а удар в упор.
                if (touched) continue;
                g_in_burn = true
                ExecuteHamB(Ham_TakeDamage, v, 0, id, get_pcvar_float(cvar_ab_rip), DMG_SLASH)
                g_in_burn = false
                push(id, v)
            }
        }

        // Отметка на задетом — только первым шестерым: дальше линии и вспышки
        // сливаются в кашу, а каждая из них ещё и пакет по сети.
        if (touched < 6) victim_mark(kind, id, v)

        touched++
    }

    set_dhudmessage(120, 255, 120, -1.0, 0.66, 0, 0.0, 1.0, 0.0, 0.1)
    show_dhudmessage(id, "%s — задето %d", ability_name(kind), touched)

    new who[32]
    get_user_name(id, who, charsmax(who))
    zlog("НОЖ: %s применил «%s», задето %d", who, ability_name(kind), touched)
}

ability_name(kind)
{
    static s[32]
    switch (kind)
    {
        case AB_WAVE:  copy(s, charsmax(s), "Огненная волна")
        case AB_CUT:   copy(s, charsmax(s), "Порез")
        case AB_QUAKE: copy(s, charsmax(s), "Толчок земли")
        case AB_FROST: copy(s, charsmax(s), "Наледь")
        case AB_DRAIN: copy(s, charsmax(s), "Вытяжка")
        case AB_FLASH: copy(s, charsmax(s), "Вспышка")
        case AB_JOLT:  copy(s, charsmax(s), "Разряд")
        case AB_RIP:   copy(s, charsmax(s), "Рывок бура")
        default:       copy(s, charsmax(s), "Способность")
    }
    return s;
}

// Кольцо по полу. ⚠️ У TE_BEAMTORUS радиус задаётся РАЗНИЦЕЙ ПО Z между двумя
// точками — отдельного поля нет; на этом уже спотыкались в гранатах.
ability_ring(const Float:at[3], radius, r, g, b)
{
    message_begin_f(MSG_PVS, SVC_TEMPENTITY, at)
    write_byte(TE_BEAMTORUS)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2] + 8.0)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2] + 8.0 + float(radius))
    write_short(g_spr_ring)
    write_byte(0)
    write_byte(0)
    write_byte(6)
    write_byte(24)
    write_byte(0)
    write_byte(r)
    write_byte(g)
    write_byte(b)
    write_byte(220)
    write_byte(0)
    message_end()
}

// ── как способность выглядит ────────────────────────────────────────────────────
//
// ⚠️ ЗАЧЕМ. Владелец: «добавь визуальные эффекты, когда используешь способности
// ножей». До этого от применения оставались кольцо по полу и строчка в углу —
// со стороны не видно ничего вообще, а с расстояния и сам владелец ножа не
// понимал, сработало или он промахнулся кнопкой.
//
// РАЗДЕЛЕНИЕ ТАКОЕ: у владельца — вспышка и волна (сработало, вот докуда
// достало), у задетых — своя отметка (зацепило именно тебя). Без второго
// половина способностей выглядела бы одинаково: круг и круг.
//
// Всё шлём MSG_PVS, то есть только тем, кто это место видит: MSG_BROADCAST
// разослал бы вспышку через всю карту тридцати двум игрокам разом.

// Вспышка света. Спрайт ей не нужен, а видно её и в темноте, и сквозь дым.
// ⚠️ Радиус пишется ДЕСЯТКАМИ единиц, время жизни и угасание — ДЕСЯТЫМИ секунды.
fx_light(const Float:at[3], radius, r, g, b, life)
{
    message_begin_f(MSG_PVS, SVC_TEMPENTITY, at)
    write_byte(TE_DLIGHT)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2] + 16.0)
    write_byte(radius / 10)
    write_byte(r)
    write_byte(g)
    write_byte(b)
    write_byte(life)
    write_byte(life)
    message_end()
}

// Кольцо, расходящееся на глазах. Кольцо по полу (ability_ring) показывает, где
// граница, это — что волна её прошла. Вместе читается как удар, порознь — как
// подсветка.
//
// ⚠️ Радиус, как и у тора, задаётся РАЗНИЦЕЙ ПО Z между двумя точками.
fx_wave(const Float:at[3], radius, r, g, b, life, width)
{
    message_begin_f(MSG_PVS, SVC_TEMPENTITY, at)
    write_byte(TE_BEAMCYLINDER)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2] - 20.0)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2] - 20.0 + float(radius))
    write_short(g_spr_ring)
    write_byte(0)          // кадр, с которого начать
    write_byte(0)          // частота смены кадров
    write_byte(life)       // жизнь, десятыми секунды
    write_byte(width)      // толщина, десятыми единицы
    write_byte(0)          // дрожание
    write_byte(r)
    write_byte(g)
    write_byte(b)
    write_byte(200)        // яркость
    write_byte(0)          // прокрутка
    message_end()
}

// Ниточка между двумя игроками — тем же спрайтом, что и «цепь».
fx_beam(from, to, r, g, b, life, width)
{
    static Float:at[3]
    pev(from, pev_origin, at)

    message_begin_f(MSG_PVS, SVC_TEMPENTITY, at)
    write_byte(TE_BEAMENTS)
    write_short(from)
    write_short(to)
    write_short(g_spr_chain)
    write_byte(0)
    write_byte(0)
    write_byte(life)
    write_byte(width)
    write_byte(0)
    write_byte(r)
    write_byte(g)
    write_byte(b)
    write_byte(200)
    write_byte(0)
    message_end()
}

// Отрезок между двумя точками — для росчерка поперёк зомби.
fx_line(const Float:from[3], const Float:to[3], r, g, b, life, width)
{
    message_begin_f(MSG_PVS, SVC_TEMPENTITY, from)
    write_byte(TE_BEAMPOINTS)
    engfunc(EngFunc_WriteCoord, from[0])
    engfunc(EngFunc_WriteCoord, from[1])
    engfunc(EngFunc_WriteCoord, from[2])
    engfunc(EngFunc_WriteCoord, to[0])
    engfunc(EngFunc_WriteCoord, to[1])
    engfunc(EngFunc_WriteCoord, to[2])
    write_short(g_spr_chain)
    write_byte(0)
    write_byte(0)
    write_byte(life)
    write_byte(width)
    write_byte(0)
    write_byte(r)
    write_byte(g)
    write_byte(b)
    write_byte(220)
    write_byte(0)
    message_end()
}

// Разовая картинка в точке: огонь, лёд, искра.
fx_sprite(const Float:at[3], sprite, scale, bright)
{
    if (!sprite) return;

    message_begin_f(MSG_PVS, SVC_TEMPENTITY, at)
    write_byte(TE_SPRITE)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2] + 16.0)
    write_short(sprite)
    write_byte(scale)      // размер, десятыми
    write_byte(bright)
    message_end()
}

// Взрыв — та же картинка, но с раскадровкой и дымом.
// ⚠️ БЕЗ ЗВУКА. По умолчанию клиент играет к нему свой грохот, а владелец
// только что просил убрать лишний шум; заодно гасим и частицы с подсветкой —
// шесть таких по кругу иначе стоили бы кадров на слабой машине.
fx_explode(const Float:at[3], sprite, scale)
{
    if (!sprite) return;

    message_begin_f(MSG_PVS, SVC_TEMPENTITY, at)
    write_byte(TE_EXPLOSION)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2] + 8.0)
    write_short(sprite)
    write_byte(scale)
    write_byte(15)         // кадров в секунду
    write_byte(TE_EXPLFLAG_NOSOUND | TE_EXPLFLAG_NODLIGHTS | TE_EXPLFLAG_NOPARTICLES)
    message_end()
}

// Сноп искр.
fx_sparks(const Float:at[3])
{
    message_begin_f(MSG_PVS, SVC_TEMPENTITY, at)
    write_byte(TE_SPARKS)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2] + 8.0)
    message_end()
}

// Трассеры, сходящиеся к точке: будто к ней что-то стягивается.
fx_implode(const Float:at[3], radius, count, life)
{
    message_begin_f(MSG_PVS, SVC_TEMPENTITY, at)
    write_byte(TE_IMPLOSION)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2] + 16.0)
    write_byte(radius)
    write_byte(count)
    write_byte(life)
    message_end()
}

// Кольцо огня по земле. Шесть вспышек по кругу: так видно, что волна прошла
// ВОКРУГ игрока, а не полыхнула у него в руках.
fx_fire_ring(const Float:at[3], radius)
{
    if (!g_spr_fire) return;

    static Float:p[3]
    for (new i = 0; i < 6; i++)
    {
        new Float:a = float(i) * 60.0
        p[0] = at[0] + floatcos(a, degrees) * float(radius)
        p[1] = at[1] + floatsin(a, degrees) * float(radius)
        p[2] = at[2]
        fx_explode(p, g_spr_fire, 14)
    }
}

// Тряска земли. Единственный эффект, который не видно, а чувствуешь, — и
// единственный, ради которого стоит трясти экран живым людям тоже: толчок
// «Кувалды» должен ощущаться, а не просто отбрасывать зомби.
fx_shake_around(const Float:at[3], radius)
{
    if (!g_msg_shake) return;

    static Float:his[3]
    new players[32], num
    get_players(players, num, "a")

    for (new i = 0; i < num; i++)
    {
        pev(players[i], pev_origin, his)
        if (get_distance_f(at, his) > float(radius) * 1.5) continue;

        message_begin(MSG_ONE_UNRELIABLE, g_msg_shake, _, players[i])
        write_short((1 << 12) * 6)    // размах
        write_short((1 << 12) * 2)    // сколько длится
        write_short((1 << 12) * 8)    // частота
        message_end()
    }
}

// Что видит владелец, нажавший кнопку. Общее для всех — вспышка в цвет
// способности и расходящаяся волна; дальше у каждой свой почерк.
ability_burst(kind, const Float:at[3], radius, r, g, b)
{
    fx_light(at, 320, r, g, b, 4)
    fx_wave(at, radius, r, g, b, 6, 10)

    switch (kind)
    {
        case AB_WAVE:
        {
            fx_fire_ring(at, radius * 2 / 3)
            fx_wave(at, radius, 255, 200, 60, 9, 20)
        }
        case AB_QUAKE:
        {
            fx_wave(at, radius, 170, 150, 110, 10, 26)
            fx_shake_around(at, radius)
        }
        case AB_FROST:
        {
            fx_sprite(at, g_spr_frost, 20, 200)
            fx_implode(at, radius / 2, 32, 6)
        }
        case AB_FLASH:
        {
            // Вспышка — это свет и ничего кроме: белый шар и мгновенное кольцо.
            fx_light(at, 500, 255, 255, 255, 6)
            fx_wave(at, radius, 255, 255, 255, 3, 30)
        }
        case AB_DRAIN:  fx_sprite(at, g_spr_glow, 14, 200)
        case AB_CUT:    fx_wave(at, radius, 200, 0, 0, 8, 16)
        case AB_JOLT:   fx_sparks(at)
        case AB_RIP:    fx_sparks(at)
    }
}

// Отметка на задетом. Роль у неё всегда одна — показать, что зацепило именно
// его, а не просто рядом сверкнуло.
victim_mark(kind, id, victim)
{
    static Float:his[3]
    pev(victim, pev_origin, his)

    switch (kind)
    {
        case AB_WAVE:  fx_sprite(his, g_spr_fire, 12, 200)
        case AB_FROST: fx_sprite(his, g_spr_frost, 12, 200)
        case AB_CUT:   fx_slash(id, victim)
        case AB_FLASH: fx_light(his, 180, 255, 255, 255, 3)
        case AB_QUAKE: fx_implode(his, 40, 12, 4)
        // Вытяжка тянет К ВЛАДЕЛЬЦУ — направление ниточки и есть смысл эффекта.
        case AB_DRAIN: fx_beam(victim, id, 180, 0, 200, 8, 12)
        case AB_JOLT:
        {
            fx_beam(id, victim, 120, 200, 255, 6, 18)
            fx_sparks(his)
        }
        case AB_RIP:
        {
            fx_beam(id, victim, 255, 200, 60, 5, 30)
            fx_sparks(his)
        }
    }
}

// Росчерк поперёк зомби — знак пореза. Ведём его ПОПЕРЁК линии «владелец —
// зомби»: вдоль неё линия смотрела бы в камеру и выглядела точкой.
fx_slash(id, victim)
{
    static Float:me[3], Float:his[3], Float:dir[3], Float:from[3], Float:to[3]
    pev(id, pev_origin, me)
    pev(victim, pev_origin, his)

    xs_vec_sub(his, me, dir)
    dir[2] = 0.0
    if (xs_vec_len(dir) < 1.0) return;
    xs_vec_normalize(dir, dir)

    // Поворот на 90° по горизонтали.
    new Float:sx = -dir[1]
    new Float:sy = dir[0]

    from[0] = his[0] + sx * 22.0
    from[1] = his[1] + sy * 22.0
    from[2] = his[2] + 14.0

    to[0] = his[0] - sx * 22.0
    to[1] = his[1] - sy * 22.0
    to[2] = his[2] - 6.0

    fx_line(from, to, 220, 0, 0, 5, 14)
}

// ── порез: здоровье утекает ─────────────────────────────────────────────────────
//
// Не разовый урон, а десять секунд по чуть-чуть: зомби успевает добежать, но
// приходит уже потрёпанным. Тем и отличается от прочих способностей.
start_cut(attacker, victim)
{
    if (zp_get_user_nemesis(victim)) return;

    g_cut_left[victim] = get_pcvar_num(cvar_cut_ticks)
    g_cut_by[victim] = attacker
    set_user_rendering(victim, kRenderFxGlowShell, 200, 0, 0, kRenderNormal, 20)

    remove_task(victim + TASK_CUT)
    set_task(1.0, "cut_tick", victim + TASK_CUT, _, _, "b")
}

public cut_tick(task)
{
    new id = task - TASK_CUT

    if (!is_user_alive(id) || g_cut_left[id] <= 0)
    {
        g_cut_left[id] = 0
        remove_task(task)
        if (is_user_connected(id)) set_user_rendering(id, kRenderFxNone, 0, 0, 0, kRenderNormal, 0)
        return;
    }

    g_cut_left[id]--

    new by = g_cut_by[id]
    if (!is_user_connected(by)) by = 0

    g_in_burn = true
    ExecuteHamB(Ham_TakeDamage, id, 0, by ? by : id, get_pcvar_float(cvar_cut_dmg), DMG_SLASH)
    g_in_burn = false
}

ignite(attacker, victim)
{
    if (zp_get_user_nemesis(victim)) return;

    g_burn_left[victim] = get_pcvar_num(cvar_burnticks)
    g_burn_by[victim] = attacker
    set_user_rendering(victim, kRenderFxGlowShell, 200, 60, 0, kRenderNormal, 20)

    remove_task(victim + TASK_BURN)
    set_task(0.5, "burn_tick", victim + TASK_BURN, _, _, "b")
}

public burn_tick(task)
{
    new id = task - TASK_BURN

    if (!is_user_alive(id) || g_burn_left[id] <= 0)
    {
        g_burn_left[id] = 0
        remove_task(task)
        if (is_user_connected(id) && !g_frozen[id])
            set_user_rendering(id, kRenderFxNone, 0, 0, 0, kRenderNormal, 0)
        return;
    }

    g_burn_left[id]--

    new by = g_burn_by[id]
    if (!is_user_connected(by)) by = id

    // Через мод, а не вычитанием здоровья: так засчитается убийство и сработают
    // чужие обработчики. Флаг защищает от захода в собственный обработчик.
    g_in_burn = true
    ExecuteHamB(Ham_TakeDamage, id, 0, by, get_pcvar_float(cvar_burndmg), DMG_BURN)
    g_in_burn = false
}

// Всё снимаем разом: смерть, выход и конец раунда одинаково опасны — задача
// переживёт игрока и выстрелит по чужому слоту.
clear_effects(id)
{
    g_frozen[id] = false
    g_slowed[id] = false
    g_burn_left[id] = 0
    g_cut_left[id] = 0
    g_ab_ready[id] = 0.0
    g_ab_held[id] = false
    remove_task(id + TASK_THAW)
    remove_task(id + TASK_BURN)
    remove_task(id + TASK_SLOW)
    remove_task(id + TASK_CUT)

    if (is_user_connected(id)) set_user_rendering(id, kRenderFxNone, 0, 0, 0, kRenderNormal, 0)
}

public fw_killed_post(victim, attacker, shouldgib) clear_effects(victim)

public fw_spawn_post(id)
{
    if (is_user_alive(id)) clear_effects(id)
}

// Превращение в человека тоже снимает: горящий или замороженный человек —
// это остаток от того, кем он был зомби.
public zp_user_humanized_post(id) clear_effects(id)

// Все игровые события пишем в ОТДЕЛЬНЫЙ файл, а не в общий журнал сервера:
// в нём они тонут между строками движка, а консоль уезжает за секунды.
zlog(const fmt[], any:...)
{
    if (!get_pcvar_num(cvar_log)) return;

    static msg[256]
    vformat(msg, charsmax(msg), fmt, 2)
    log_to_file("zp_actions.log", "%s", msg)
}
