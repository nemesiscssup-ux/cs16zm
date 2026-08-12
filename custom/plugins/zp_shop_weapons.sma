/*
 * [ZP] Магазин оружия с баффами.
 *
 * Девятнадцать стволов продаются за кредиты через штатное меню спец-вещей.
 * Сами стволы — отдельные плагины zp43_weapon_*, перенесённые из проверенной
 * сборки: они делают всё, чего не умеет простая подмена модели, — свою
 * перезарядку с правильными номерами анимаций, свою скорострельность, урон,
 * звуки, гильзы и значок в HUD. Магазин лишь берёт плату и добавляет усиления.
 *
 * ПОЧЕМУ НЕ ИХ МЕНЮ: их магазин написан под Zombie Plague Advance — другой
 * форк мода. У нас 4.4 Fix5a, и его API с их несовместим. Меню своё, стволы их.
 *
 * ПРО ОТСУТСТВУЮЩИЕ ПЛАГИНЫ: владелец будет убирать лишние стволы. Обычно
 * плагин, которому не хватило чужого натива, ВООБЩЕ не загружается — и вместе
 * с ним пропал бы весь магазин. Поэтому стоит set_native_filter: недостающий
 * ствол просто исчезает из меню, остальные работают.
 */

#include <amxmodx>
#include <zm_menu>
#include <amxmisc>
#include <fakemeta>
#include <hamsandwich>
#include <cstrike>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Магазин оружия"
#define VERSION "2.0"
#define AUTHOR "cs16zm"

// NAME с запасом: «[С] TRG-42 (+60%, скор.-10%)» — это 47
// символов, но 70 байт, потому что каждая русская буква в UTF-8 занимает две.
// Больше 96 ставить бессмысленно: столько ячеек в хранилище названий у мода.
enum _:WPN { NAME[96], CSW, COST, DMG_PCT, SPD_PCT, ARMOR }

// Проценты: 125 = урон ×1.25, 92 = скор.×0.92.
// CSW — оружие, которое ствол собой заменяет: по нему видно, держит ли его
// игрок прямо сейчас, а значит действует ли усиление.
// Единый вид названия: [Тип] Название (свойства). Тип идёт первым, чтобы в
// длинном списке спец-вещей было видно, что именно перед тобой, не вчитываясь.
// Самый длинный пункт текущего меню: по нему считается, сколько их влезет
// на страницу (см. include/zm_menu.inc).
new g_longest

// ⚠️ СТРОКИ ИДУТ ПО ТИПАМ, И ЭТО ПОРЯДОК ПУНКТОВ В МЕНЮ. Мод показывает
// спец-вещи в том порядке, в каком их зарегистрировали, а регистрируем мы
// сверху вниз. Пистолеты, дробовики, автоматы, пулемёты, снайперские, особое —
// так список читается, а не перебирается.
new const g_weapons[][WPN] = {
    { "[П] FN P45 (+20%, скор.+10%)",     CSW_USP,     10, 120, 110,  0 },
    { "[П] Skull-1 (+25%)",               CSW_DEAGLE,  14, 125, 100,  0 },
    { "[П] Balrog-1 (+30%, рожок 10)",    CSW_DEAGLE,  30, 130, 100,  0 },
    { "[Д] M1887 (+30%)",                 CSW_M3,      16, 130, 100,  0 },
    { "[Д] SPAS-12 (+30%, бр.+25)",       CSW_M3,      18, 130, 100, 25 },
    { "[Д] USAS-12 (+25%)",               CSW_XM1014,  20, 125, 100,  0 },
    { "[Д] Skull-11 (+35%)",              CSW_XM1014,  24, 135, 100,  0 },
    { "[А] AK-47 Long (+30%)",            CSW_AK47,    18, 130, 100,  0 },
    { "[А] HK416 (+25%, бр.+50)",         CSW_M4A1,    20, 125, 100, 50 },
    { "[А] SFGun (+30%, скор.+8%)",       CSW_AK47,    22, 130, 108,  0 },
    { "[Пм] MG36 (+35%, скор.-5%)",       CSW_M249,    28, 135,  95,  0 },
    { "[Пм] Mk48 (+40%, скор.-8%)",       CSW_M249,    30, 140,  92,  0 },
    // ⚠️ ВСК-94 БЫЛА ПОМЕЧЕНА [А]. Это снайперская: она подменяет SG550, и в
    // автоматах игрок её не искал.
    { "[С] ВСК-94 (+25%, скор.+15%)",     CSW_SG550,   22, 125, 115,  0 },
    { "[С] SL8 (+30%)",                   CSW_G3SG1,   26, 130, 100,  0 },
    { "[С] WA2000 (+40%)",                CSW_G3SG1,   28, 140, 100,  0 },
    { "[С] TRG-42 (+60%, скор.-10%)",     CSW_AWP,     30, 160,  90,  0 },
    // Было «(x2)» — единственный множитель среди процентов. Это те же +100%.
    { "[С] AS50 (+100%, скор.-12%)",      CSW_AWP,     34, 200,  88,  0 },
    // ── особое: пули нет вовсе ──
    // ⚠️ Приставка [О] — под раздел «Особое». У остальных она тоже первая
    // буква раздела ([П] пистолеты, [Д] дробовики, [С] снайперские), и
    // прежняя [В] не соответствовала никакому: раздела на «В» нет. Менять её
    // было нечего опасаться — в меню эти два ствола не показывались вовсе.
    // Наценки магазина у гранатомёта нет намеренно: он и так бьёт по площади на
    // 400 в эпицентре, и множить это ещё раз незачем.
    { "[О] Арбалет (+25%, стрелы)",       CSW_SG550,   32, 125, 100,  0 },
    { "[О] Гранатомёт M32 (по площади)",  CSW_M3,      40, 100, 100,  0 },
}

// Порядок ОБЯЗАН совпадать с таблицей выше.
new const g_natives[][] = {
    "zp_give_user_fnp45", "zp_give_user_skull1", "zp_give_user_balrog1",
    "zp_give_user_m1887", "zp_give_user_spas12", "zp_give_user_usas12camo", "zp_give_user_skull11",
    "zp_give_user_ak47long", "zp_give_user_hk416", "zp_give_user_sfgun",
    "zp_give_user_mg36", "zp_give_user_mk48",
    "zp_give_user_vsk94", "zp_give_user_sl8", "zp_give_user_wa2000", "zp_give_user_trg42", "zp_give_user_as50",
    "zp_give_user_crossbow", "zp_give_user_m32",
}

native zp_give_user_fnp45(id)
native zp_give_user_skull1(id)
native zp_give_user_balrog1(id)
native zp_give_user_m1887(id)
native zp_give_user_spas12(id)
native zp_give_user_usas12camo(id)
native zp_give_user_skull11(id)
native zp_give_user_ak47long(id)
native zp_give_user_hk416(id)
native zp_give_user_sfgun(id)
native zp_give_user_mg36(id)
native zp_give_user_mk48(id)
native zp_give_user_vsk94(id)
native zp_give_user_sl8(id)
native zp_give_user_wa2000(id)
native zp_give_user_trg42(id)
native zp_give_user_as50(id)
native zp_give_user_crossbow(id)
native zp_give_user_m32(id)

// Тот же трюк, что в самом ZP: он вешает пересчёт скорости не на настоящий
// Ham_CS_Player_ResetMaxSpeed, а на Ham_Item_PreFrame. Цепляемся туда же,
// иначе бонус к скорости будет затираться при каждой смене оружия.
new Ham:Ham_Player_ResetMaxSpeed = Ham_Item_PreFrame

new g_item[sizeof g_weapons]
new bool:g_available[sizeof g_weapons]
new g_owned[33] = { -1, ... }
new cvar_enabled, cvar_log

public plugin_natives()
{
    // Без этого плагин не загрузится, если убрать хоть один ствол.
    set_native_filter("native_filter")
}

public native_filter(const name[], index, trap)
{
    return PLUGIN_HANDLED;
}

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    cvar_enabled = register_cvar("zp_shop_weapons", "1")
    cvar_log     = register_cvar("zp_log_actions", "1")

    RegisterHam(Ham_TakeDamage, "player", "fw_TakeDamage", 0)
    RegisterHam(Ham_Player_ResetMaxSpeed, "player", "fw_ResetSpeed_Post", 1)
    RegisterHam(Ham_Spawn, "player", "fw_Spawn_Post", 1)

    register_concmd("zp_packs", "cmd_packs", ADMIN_LEVEL_A,
        "<ник или @all> <сколько> - выдать кредиты")

    // ⚠️ ПРИБАВКА, А НЕ УСТАНОВКА — ЭТО РАЗНЫЕ КОМАНДЫ, И ПУТАТЬ ИХ НЕЛЬЗЯ.
    // zp_packs делает баланс равным числу; для выдачи админом это удобно, а
    // для покупки на сайте недопустимо: оплата стёрла бы всё, что игрок
    // заработал за вечер. Этой командой пользуется магазин кредитов
    // (docs/2026-08-11-site-integration.md, правка 4).
    register_concmd("zp_packs_add", "cmd_packs_add", ADMIN_LEVEL_A,
        "<ник> <сколько> - ПРИБАВИТЬ кредиты (для покупок на сайте)")

    // Своё меню с разделами. Штатный список спец-вещей стал плоским и длинным:
    // три десятка стволов вперемешку с вещами мода, по семь на страницу.
    // Здесь то же самое, но разложено по видам оружия.
    register_clcmd("zp_shop", "cmd_shop")
    register_clcmd("say /магазин", "cmd_shop")
    register_clcmd("say /shop", "cmd_shop")
}

/*
 * Разделы меню. Числа — НОМЕРА СТРОК В g_weapons, считая с нуля.
 *
 * ⚠️⚠️ ЭТА ТАБЛИЦА ПРИВЯЗАНА К ПОРЯДКУ g_weapons НОМЕРАМИ, И ОДНА ВСТАВКА
 * ЛОМАЕТ ЕЁ ЦЕЛИКОМ. Так уже случилось: Balrog-1 вписали вторым пистолетом, и
 * всё, что ниже, съехало на единицу. В меню получилось вот что — пистолет
 * Balrog-1 лежал в «Дробовиках», дробовик Skull-11 в «Автоматах», а AS50,
 * Арбалет и Гранатомёт M32 не показывались ВОВСЕ: под них просто не было
 * строки. Три ствола, которые добавляли специально, в игре были недоступны, и
 * заметить это можно было только зайдя в магазин.
 *
 * Правило простое: ДОБАВИЛ СТРОКУ В g_weapons — ПЕРЕСЧИТАЙ ЭТУ ТАБЛИЦУ. И
 * g_natives заодно, он привязан к тому же порядку.
 *
 * Ширина строки берётся по самой длинной (снайперских теперь пять), недостающее
 * добивается -1: menu их пропускает.
 */
new const g_cat_names[][] = { "Пистолеты", "Дробовики", "Автоматы", "Пулемёты", "Снайперские", "Особое" }
new const g_cat_items[][] = {
    { 0,  1,  2, -1, -1 },      // FN P45, Skull-1, Balrog-1
    { 3,  4,  5,  6, -1 },      // M1887, SPAS-12, USAS-12, Skull-11
    { 7,  8,  9, -1, -1 },      // AK-47 Long, HK416, SFGun
    { 10, 11, -1, -1, -1 },     // MG36, Mk48
    { 12, 13, 14, 15, 16 },     // ВСК-94, SL8, WA2000, TRG-42, AS50
    { 17, 18, -1, -1, -1 },     // Арбалет, Гранатомёт M32
}

public cmd_shop(id)
{
    if (!get_pcvar_num(cvar_enabled)) return PLUGIN_HANDLED;

    if (!is_user_alive(id) || zp_get_user_zombie(id))
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Оружие покупают живые люди.")
        return PLUGIN_HANDLED;
    }

    new title[128]
    formatex(title, charsmax(title), "\y[Вспышка эпидемии]\w Оружейный магазин^n\wКредиты: \y%d",
        zp_get_user_ammo_packs(id))

    g_longest = 0

    new menu = menu_create(title, "menu_category")
    for (new c = 0; c < sizeof g_cat_names; c++)
    {
        new line[64], num[4]
        num_to_str(c, num, charsmax(num))
        formatex(line, charsmax(line), "\w%s", g_cat_names[c])
        zm_menu_seen(g_longest, line)
        menu_additem(menu, line, num, 0)
    }
    menu_setprop(menu, MPROP_EXITNAME, "Выход")
    zm_menu_fit(menu, title, g_longest)
    menu_display(id, menu)
    return PLUGIN_HANDLED;
}

public menu_category(id, menu, item)
{
    if (item == MENU_EXIT) { menu_destroy(menu); return PLUGIN_HANDLED; }

    new info[4], name[64], access, callback
    menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback)
    menu_destroy(menu)

    new c = str_to_num(info)
    if (c < 0 || c >= sizeof g_cat_names) return PLUGIN_HANDLED;

    new title[128]
    formatex(title, charsmax(title), "\y[Вспышка эпидемии]\w %s^n\wКредиты: \y%d",
        g_cat_names[c], zp_get_user_ammo_packs(id))

    g_longest = 0

    new sub = menu_create(title, "menu_buy")
    new packs = zp_get_user_ammo_packs(id)

    for (new k = 0; k < sizeof g_cat_items[]; k++)
    {
        new i = g_cat_items[c][k]
        if (i < 0) continue;

        new line[96], num[4]
        num_to_str(i, num, charsmax(num))

        // Серым то, что не по карману или отключено: видно, к чему стремиться.
        if (!g_available[i])
            formatex(line, charsmax(line), "\d%s — отключён", g_weapons[i][NAME])
        else if (packs < g_weapons[i][COST])
            formatex(line, charsmax(line), "\d%s \r[%d]", g_weapons[i][NAME], g_weapons[i][COST])
        else
            formatex(line, charsmax(line), "\w%s \y[%d]", g_weapons[i][NAME], g_weapons[i][COST])

        zm_menu_seen(g_longest, line)

        menu_additem(sub, line, num, 0)
    }

    menu_setprop(sub, MPROP_EXITNAME, "Назад")
    zm_menu_fit(sub, title, g_longest)
    menu_display(id, sub)
    return PLUGIN_HANDLED;
}

public menu_buy(id, menu, item)
{
    if (item == MENU_EXIT) { menu_destroy(menu); cmd_shop(id); return PLUGIN_HANDLED; }

    new info[4], name[64], access, callback
    menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback)
    menu_destroy(menu)

    new i = str_to_num(info)
    if (i < 0 || i >= sizeof g_weapons) return PLUGIN_HANDLED;

    // Покупку проводим штатным способом мода: он сам снимет кредиты и вызовет
    // наш же обработчик zp_extra_item_selected — вся выдача и усиления в одном
    // месте, а не продублированы здесь.
    if (!zp_force_buy_extra_item(id, g_item[i], 0))
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Не хватает кредитов.")

    return PLUGIN_HANDLED;
}

public plugin_cfg()
{
    // Проверяем наличие стволов ЗДЕСЬ: к этому времени все плагины загружены.
    new missing = 0
    for (new i = 0; i < sizeof g_weapons; i++)
    {
        g_available[i] = (get_func_id(g_natives[i], -1) != -1) || plugin_provides(g_natives[i])
        if (!g_available[i]) missing++
    }
    if (missing) log_amx("стволов не найдено: %d из %d — их не будет в меню", missing, sizeof g_weapons)
}

// Есть ли натив: перебираем загруженные плагины и спрашиваем, что они дают.
bool:plugin_provides(const native_name[])
{
    new count = get_pluginsnum()
    for (new p = 0; p < count; p++)
    {
        new name[64], version[32], author[32], file[64], status[32]
        get_plugin(p, file, charsmax(file), name, charsmax(name),
            version, charsmax(version), author, charsmax(author), status, charsmax(status))
        if (!equal(status, "running")) continue;

        // Имя плагина оружия совпадает с хвостом натива: zp_give_user_as50 -> as50
        new tail[32]
        copy(tail, charsmax(tail), native_name[strlen("zp_give_user_")])
        if (containi(file, tail) != -1) return true;
    }
    return false;
}

public plugin_precache()
{
    for (new i = 0; i < sizeof g_weapons; i++)
        g_item[i] = zp_register_extra_item(g_weapons[i][NAME], g_weapons[i][COST], ZP_TEAM_HUMAN)
}

public client_disconnected(id, bool:drop, message[], maxlen)
{
    g_owned[id] = -1
}

public fw_Spawn_Post(id)
{
    if (is_user_alive(id)) g_owned[id] = -1
}

public zp_user_infected_post(id, infector) g_owned[id] = -1

public zp_extra_item_selected(id, itemid)
{
    if (!get_pcvar_num(cvar_enabled)) return ZP_PLUGIN_HANDLED;

    for (new i = 0; i < sizeof g_weapons; i++)
    {
        if (itemid != g_item[i]) continue;

        if (zp_get_user_zombie(id) || zp_get_user_survivor(id) || zp_get_user_sniper(id))
        {
            client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Это доступно только людям.")
            return ZP_PLUGIN_HANDLED;
        }

        if (!g_available[i])
        {
            client_print_color(id, print_team_default,
                "^x04[Вспышка эпидемии]^x01 Этот ствол сейчас отключён на сервере.")
            return ZP_PLUGIN_HANDLED;
        }

        give_weapon(id, i)

        if (g_weapons[i][ARMOR] > 0)
            cs_set_user_armor(id, min(100, cs_get_user_armor(id) + g_weapons[i][ARMOR]), CS_ARMOR_VESTHELM)

        g_owned[id] = i
        ExecuteHamB(Ham_Player_ResetMaxSpeed, id)

        new name[32]
        get_user_name(id, name, charsmax(name))
        zlog("МАГАЗИН: %s купил «%s»", name, g_weapons[i][NAME])

        // ⚠️ ПРИ БЕСПЛАТНОМ ВОЗВРАТЕ МОЛЧИМ. Мод возвращает купленное в начале
        // раунда тем же путём, что и настоящая покупка, только без списания
        // кредитов, — и выживший каждый раунд читал «Куплено: …», хотя ничего не
        // покупал и ничего не платил. Пометку поднимает сам мод на время
        // возврата (правка «возврат покупок» в tools/customize.mjs).
        if (!get_cvar_num("zm_hot_regiving"))
            client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Куплено: ^x04%s", g_weapons[i][NAME])
        return PLUGIN_CONTINUE;
    }

    return PLUGIN_CONTINUE;
}

// Каждый ствол выдаётся своим нативом. Через switch, а не по имени: так
// компилятор проверяет, что все девятнадцать на месте.
//
// ⚠️ НОМЕРА ЗДЕСЬ — ЭТО СТРОКИ g_weapons И g_natives, ТРИ СПИСКА ИДУТ ВМЕСТЕ.
// Переставишь строку в таблице и забудешь здесь — игрок купит арбалет и получит
// пулемёт, а магазин при этом ни на что не пожалуется.
give_weapon(id, i)
{
    switch (i)
    {
        case 0:  zp_give_user_fnp45(id)
        case 1:  zp_give_user_skull1(id)
        case 2:  zp_give_user_balrog1(id)
        case 3:  zp_give_user_m1887(id)
        case 4:  zp_give_user_spas12(id)
        case 5:  zp_give_user_usas12camo(id)
        case 6:  zp_give_user_skull11(id)
        case 7:  zp_give_user_ak47long(id)
        case 8:  zp_give_user_hk416(id)
        case 9:  zp_give_user_sfgun(id)
        case 10: zp_give_user_mg36(id)
        case 11: zp_give_user_mk48(id)
        case 12: zp_give_user_vsk94(id)
        case 13: zp_give_user_sl8(id)
        case 14: zp_give_user_wa2000(id)
        case 15: zp_give_user_trg42(id)
        case 16: zp_give_user_as50(id)
        case 17: zp_give_user_crossbow(id)
        case 18: zp_give_user_m32(id)
    }
}

// Усиление урона действует, только пока купленный ствол в руках.
public fw_TakeDamage(victim, inflictor, attacker, Float:damage, damagebits)
{
    if (!get_pcvar_num(cvar_enabled)) return HAM_IGNORED;
    if (!is_user_connected(attacker) || attacker == victim) return HAM_IGNORED;

    new i = g_owned[attacker]
    if (i < 0 || g_weapons[i][DMG_PCT] == 100) return HAM_IGNORED;
    if (get_user_weapon(attacker) != g_weapons[i][CSW]) return HAM_IGNORED;

    SetHamParamFloat(4, damage * float(g_weapons[i][DMG_PCT]) / 100.0)
    return HAM_HANDLED;
}

public fw_ResetSpeed_Post(id)
{
    if (!get_pcvar_num(cvar_enabled) || !is_user_alive(id)) return;

    new i = g_owned[id]
    if (i < 0 || g_weapons[i][SPD_PCT] == 100) return;
    if (get_user_weapon(id) != g_weapons[i][CSW]) return;

    new Float:speed
    pev(id, pev_maxspeed, speed)
    if (speed > 1.0) set_pev(id, pev_maxspeed, speed * float(g_weapons[i][SPD_PCT]) / 100.0)
}

public cmd_packs(id, level, cid)
{
    if (!cmd_access(id, level, cid, 3)) return PLUGIN_HANDLED;

    new who[32], amount_s[12]
    read_argv(1, who, charsmax(who))
    read_argv(2, amount_s, charsmax(amount_s))

    new amount = str_to_num(amount_s)
    if (amount < 0) amount = 0
    if (amount > 999999) amount = 999999

    if (equal(who, "@all"))
    {
        new players[32], num
        get_players(players, num, "ch")
        for (new i = 0; i < num; i++) zp_set_user_ammo_packs(players[i], amount)
        console_print(id, "кредиты выданы всем (%d игрокам): %d", num, amount)
        return PLUGIN_HANDLED;
    }

    new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF)
    if (!target)
    {
        console_print(id, "игрок «%s» не найден; для всех сразу: zp_packs @all %d", who, amount)
        return PLUGIN_HANDLED;
    }

    zp_set_user_ammo_packs(target, amount)

    new name[32]
    get_user_name(target, name, charsmax(name))
    zlog("КРЕДИТЫ: игроку %s выдано %d", name, amount)
    console_print(id, "кредиты игроку %s: %d", name, amount)
    client_print_color(target, print_team_default, "^x04[Вспышка эпидемии]^x01 Кредитов теперь: ^x04%d", amount)

    return PLUGIN_HANDLED;
}

// Прибавка, а не установка. Разница принципиальная: этой командой пользуется
// сайт после оплаты, и затирать ею заработанное игроком нельзя.
public cmd_packs_add(id, level, cid)
{
    if (!cmd_access(id, level, cid, 3)) return PLUGIN_HANDLED;

    new who[32], amount_s[12]
    read_argv(1, who, charsmax(who))
    read_argv(2, amount_s, charsmax(amount_s))

    new amount = str_to_num(amount_s)
    if (amount < 1 || amount > 999999)
    {
        console_print(id, "сколько прибавить? ожидается от 1 до 999999")
        return PLUGIN_HANDLED;
    }

    new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF)
    if (!target)
    {
        // ⚠️ ТЕКСТ ОТВЕТА МЕНЯТЬ НЕЛЬЗЯ. По нему сайт понимает, что игрок вышел,
        // и оставляет заказ ждать в панели вместо того, чтобы считать его
        // выданным (docs/2026-08-11-site-integration.md, правка 4).
        console_print(id, "игрок «%s» не найден", who)
        return PLUGIN_HANDLED;
    }

    new was = zp_get_user_ammo_packs(target)
    zp_set_user_ammo_packs(target, was + amount)

    new name[32]
    get_user_name(target, name, charsmax(name))
    zlog("КРЕДИТЫ: игроку %s прибавлено %d (было %d)", name, amount, was)
    console_print(id, "прибавлено %d, у %s теперь %d", amount, name, was + amount)
    client_print_color(target, print_team_default,
        "^x04[Вспышка эпидемии]^x01 Начислено ^x04%d^x01 кредитов. Всего: ^x04%d", amount, was + amount)

    return PLUGIN_HANDLED;
}

// Все игровые события пишем в ОТДЕЛЬНЫЙ файл, а не в общий журнал сервера:
// в нём они тонут между строками движка, а консоль уезжает за секунды.
// Файл: addons/amxmodx/logs/zp_actions.log
zlog(const fmt[], any:...)
{
    if (!get_pcvar_num(cvar_log)) return;

    static msg[256]
    vformat(msg, charsmax(msg), fmt, 2)
    log_to_file("zp_actions.log", "%s", msg)
}
