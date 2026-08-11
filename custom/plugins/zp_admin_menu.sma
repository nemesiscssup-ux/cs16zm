/*
 * [ZP] Админ-меню: кик, блокировка, мут, убийство, выдача привилегий и кредитов.
 *
 * Вызов: команда zp_admin, в чат /админка или /admin.
 *
 * ПОЧЕМУ СВОЁ, А НЕ ШТАТНОЕ amxmodmenu. Штатное меню англоязычное, разложено по
 * логике AMXX (команды, cvar-ы, карты) и половина его пунктов на игровом
 * сервере не нужна вовсе. Владелец попросил ровно пять действий и чтобы каждое
 * было отдельным пунктом — здесь они и есть, по-русски и в один уровень.
 *
 * ЧТО КОМУ ВИДНО. Пункт показывается только тому, у кого есть право на это
 * действие; права — штатные флаги AMXX, те же, что проверяет admincmd:
 *
 *   Кикнуть ............ ADMIN_KICK   (буква «c»)
 *   Заблокировать ...... ADMIN_BAN    (буква «d»)
 *   Замутить ........... ADMIN_CHAT   (буква «j»)
 *   Убить .............. ADMIN_SLAY   (буква «e»)
 *   Выдать привилегию .. ADMIN_LEVEL_C (буква «o») — ТОЛЬКО Создатель
 *   Выдать кредиты ..... ADMIN_LEVEL_C (буква «o») — ТОЛЬКО Создатель
 *
 * ⚠️ ВЫДАЧА ПРИВИЛЕГИИ ИДЁТ ЧЕРЕЗ amx_addadmin. Своей записи в users.ini мы не
 * делаем: файл читает и перечитывает admincmd, и две руки в одном файле рано
 * или поздно затрут друг друга. Буквы уровней НАКОПИТЕЛЬНЫЕ и совпадают с
 * tools/users-ini.mjs — сверяет verify-ru.
 *
 * ⚠️ СРОК БАНА ограничивает zp_admin_limits.sma: у купленной админки он свой,
 * и наш пункт ничего не обходит — команда всё равно уходит через amx_ban.
 */

#include <amxmodx>
#include <zm_menu>
#include <amxmisc>
#include <zm_db>
#include <engine>
#include <fun>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Админ-меню"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

// Уровни привилегий: буквы НАКОПИТЕЛЬНЫЕ — у Фараона должны стоять и все
// младшие, иначе ножи и скины младших уровней ему закрыты. Тот же порядок и те
// же буквы, что в tools/users-ini.mjs.
enum _:TIER { TNAME[24], TFLAGS[12] }
// Самый длинный пункт текущего меню: по нему считается, сколько их влезет
// на страницу (см. include/zm_menu.inc).
new g_longest

new const g_tiers[][TIER] = {
    { "VIP",       "t"     },
    { "Лидер",     "st"    },
    { "Император", "qst"   },
    { "Фараон",    "pqst"  },
    { "Создатель", "opqst" },
}

// Сколько кредитов выдаёт один пункт. Больше — повтором: так меньше шансов
// промахнуться на нолик.
new const g_gifts[] = { 25, 50, 100, 250, 500 }

// Что выбрали в первом меню — ждёт выбора игрока во втором.
enum { ACT_NONE = 0, ACT_KICK, ACT_BAN, ACT_MUTE, ACT_SLAY, ACT_TIER, ACT_PACKS }
new g_action[33]
new g_target[33]        // кого выбрали: нужно второму шагу у бана и выдачи

new bool:g_muted[33]
new cvar_log

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    zm_db_init()

    cvar_log = register_cvar("zp_log_actions", "1")

    register_clcmd("zp_admin", "cmd_menu")
    register_clcmd("say /админка", "cmd_menu")
    register_clcmd("say /admin", "cmd_menu")
    register_clcmd("say_team /админка", "cmd_menu")

    // Мут: чат перехватываем сами. Голос глушим set_speak — этого хватает,
    // потому что говорить он всё равно не сможет.
    register_clcmd("say", "cmd_say")
    register_clcmd("say_team", "cmd_say")
}

public client_putinserver(id)
{
    g_muted[id] = false
    g_action[id] = ACT_NONE
    g_target[id] = 0
}

// Четыре параметра обязательны: форвард с одним не вызывается вовсе.
public client_disconnected(id, bool:drop, message[], maxlen)
{
    g_muted[id] = false
}

// ── меню действий ───────────────────────────────────────────────────────────────

public cmd_menu(id)
{
    new flags = get_user_flags(id)
    if (!(flags & (ADMIN_KICK | ADMIN_BAN | ADMIN_CHAT | ADMIN_SLAY | ADMIN_LEVEL_C)))
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Админ-меню вам не доступно.")
        return PLUGIN_HANDLED;
    }

    new title[128]
    formatex(title, charsmax(title),
        "\y[Вспышка эпидемии]\w Админка^n\d----------------------------")
    g_longest = 0
    new menu = menu_create(title, "menu_pick")

    if (flags & ADMIN_KICK) menu_additem(menu, "\wКикнуть игрока", "kick", 0)
    if (flags & ADMIN_BAN)  menu_additem(menu, "\wЗаблокировать игрока", "ban", 0)
    if (flags & ADMIN_CHAT) menu_additem(menu, "\wЗамутить / размутить", "mute", 0)
    if (flags & ADMIN_SLAY) menu_additem(menu, "\wУбить игрока", "slay", 0)

    // ⚠️ ТОЛЬКО СОЗДАТЕЛЬ. Раньше здесь стоял ADMIN_RCON, но полные права
    // владелец может выдать руками через панель сайта — и такой человек
    // выписал бы привилегию и кредиты сам себе. Буква «o» — уровень
    // «Создатель», он не продаётся вовсе.
    if (flags & ADMIN_LEVEL_C)
    {
        menu_additem(menu, "\yВыдать привилегию", "tier", 0)
        menu_additem(menu, "\yВыдать кредиты", "packs", 0)
    }

    menu_setprop(menu, MPROP_PERPAGE, 6)
    menu_setprop(menu, MPROP_EXITNAME, "Выход")
    zm_menu_fit(menu, title, g_longest)
    menu_display(id, menu)
    return PLUGIN_HANDLED;
}

public menu_pick(id, menu, item)
{
    if (item == MENU_EXIT) { menu_destroy(menu); return PLUGIN_HANDLED; }

    new info[8], name[64], access, callback
    menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback)
    menu_destroy(menu)

    if (equal(info, "kick"))  g_action[id] = ACT_KICK
    else if (equal(info, "ban"))   g_action[id] = ACT_BAN
    else if (equal(info, "mute"))  g_action[id] = ACT_MUTE
    else if (equal(info, "slay"))  g_action[id] = ACT_SLAY
    else if (equal(info, "tier"))  g_action[id] = ACT_TIER
    else if (equal(info, "packs")) g_action[id] = ACT_PACKS
    else return PLUGIN_HANDLED;

    show_players(id)
    return PLUGIN_HANDLED;
}

// ── выбор игрока ────────────────────────────────────────────────────────────────

show_players(id)
{
    new title[128], what[32]
    switch (g_action[id])
    {
        case ACT_KICK:  copy(what, charsmax(what), "Кого кикнуть")
        case ACT_BAN:   copy(what, charsmax(what), "Кого заблокировать")
        case ACT_MUTE:  copy(what, charsmax(what), "Кого замутить")
        case ACT_SLAY:  copy(what, charsmax(what), "Кого убить")
        case ACT_TIER:  copy(what, charsmax(what), "Кому привилегию")
        case ACT_PACKS: copy(what, charsmax(what), "Кому кредиты")
        default: return;
    }

    formatex(title, charsmax(title), "\y[Вспышка эпидемии]\w %s^n\d----------------------------", what)
    g_longest = 0
    new menu = menu_create(title, "player_pick")

    new players[32], num, who[32], line[96], num_s[4]
    get_players(players, num, "ch")   // без ботов и без выбывших из игры
    for (new i = 0; i < num; i++)
    {
        new p = players[i]
        get_user_name(p, who, charsmax(who))
        num_to_str(p, num_s, charsmax(num_s))

        // ⚠️ Себя из списка не убираем: убить себя или выдать себе кредиты
        // главному админу иногда надо. А вот пометить стоит, чтобы не промахнуться.
        if (p == id) formatex(line, charsmax(line), "\d%s \r(это вы)", who)
        else if (g_muted[p] && g_action[id] == ACT_MUTE) formatex(line, charsmax(line), "\w%s \r(замучен)", who)
        else formatex(line, charsmax(line), "\w%s", who)

        zm_menu_seen(g_longest, line)

        menu_additem(menu, line, num_s, 0)
    }

    menu_setprop(menu, MPROP_PERPAGE, 7)
    menu_setprop(menu, MPROP_EXITNAME, "Назад")
    zm_menu_fit(menu, title, g_longest)
    menu_display(id, menu)
}

public player_pick(id, menu, item)
{
    if (item == MENU_EXIT) { menu_destroy(menu); cmd_menu(id); return PLUGIN_HANDLED; }

    new info[8], name[64], access, callback
    menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback)
    menu_destroy(menu)

    new target = str_to_num(info)
    if (!is_user_connected(target))
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Игрок уже вышел.")
        return PLUGIN_HANDLED;
    }

    g_target[id] = target

    // У бана и у выдачи есть второй шаг — сколько именно.
    switch (g_action[id])
    {
        case ACT_BAN:   { show_ban_times(id); return PLUGIN_HANDLED; }
        case ACT_TIER:  { show_tiers(id); return PLUGIN_HANDLED; }
        case ACT_PACKS: { show_gifts(id); return PLUGIN_HANDLED; }
    }

    do_simple(id, target)
    return PLUGIN_HANDLED;
}

// ── простые действия ────────────────────────────────────────────────────────────

do_simple(id, target)
{
    new who[32], adm[32]
    get_user_name(target, who, charsmax(who))
    get_user_name(id, adm, charsmax(adm))

    switch (g_action[id])
    {
        case ACT_KICK:
        {
            if (!(get_user_flags(id) & ADMIN_KICK)) return;
            server_cmd("kick #%d ^"Вас отключил администратор^"", get_user_userid(target))
            client_print_color(0, print_team_default, "^x04[Вспышка эпидемии]^x01 Администратор отключил ^x03%s^x01.", who)
            zlog("АДМИНКА: %s кикнул %s", adm, who)
        }
        case ACT_MUTE:
        {
            if (!(get_user_flags(id) & ADMIN_CHAT)) return;
            g_muted[target] = !g_muted[target]
            set_speak(target, g_muted[target] ? SPEAK_MUTED : SPEAK_ALL)

            if (g_muted[target])
            {
                client_print_color(0, print_team_default, "^x04[Вспышка эпидемии]^x01 ^x03%s^x01 замучен администратором.", who)
                zlog("АДМИНКА: %s замутил %s", adm, who)
            }
            else
            {
                client_print_color(0, print_team_default, "^x04[Вспышка эпидемии]^x01 ^x03%s^x01 снова может говорить.", who)
                zlog("АДМИНКА: %s размутил %s", adm, who)
            }
        }
        case ACT_SLAY:
        {
            if (!(get_user_flags(id) & ADMIN_SLAY)) return;
            if (!is_user_alive(target))
            {
                client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 ^x03%s^x01 и так мёртв.", who)
                return;
            }
            user_kill(target, 1)
            client_print_color(0, print_team_default, "^x04[Вспышка эпидемии]^x01 Администратор убил ^x03%s^x01.", who)
            zlog("АДМИНКА: %s убил %s", adm, who)
        }
    }
}

// ── бан: на сколько ─────────────────────────────────────────────────────────────

new const g_ban_times[] = { 15, 30, 60, 180, 1440 }

show_ban_times(id)
{
    if (!is_user_connected(g_target[id])) return;

    new who[32]
    get_user_name(g_target[id], who, charsmax(who))

    new title[128]
    formatex(title, charsmax(title),
        "\y[Вспышка эпидемии]\w Блокировка^n\wКого: \y%s", who)
    g_longest = 0
    new menu = menu_create(title, "ban_pick")

    for (new i = 0; i < sizeof g_ban_times; i++)
    {
        new line[64], num[4]
        num_to_str(i, num, charsmax(num))
        if (g_ban_times[i] < 60) formatex(line, charsmax(line), "\w%d минут", g_ban_times[i])
        else formatex(line, charsmax(line), "\w%d часов", g_ban_times[i] / 60)
        zm_menu_seen(g_longest, line)
        menu_additem(menu, line, num, 0)
    }

    menu_setprop(menu, MPROP_PERPAGE, 6)
    menu_setprop(menu, MPROP_EXITNAME, "Назад")
    zm_menu_fit(menu, title, g_longest)
    menu_display(id, menu)
}

public ban_pick(id, menu, item)
{
    if (item == MENU_EXIT) { menu_destroy(menu); show_players(id); return PLUGIN_HANDLED; }

    new info[8], name[64], access, callback
    menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback)
    menu_destroy(menu)

    if (!(get_user_flags(id) & ADMIN_BAN)) return PLUGIN_HANDLED;

    new n = str_to_num(info)
    if (n < 0 || n >= sizeof g_ban_times) return PLUGIN_HANDLED;

    new target = g_target[id]
    if (!is_user_connected(target))
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Игрок уже вышел.")
        return PLUGIN_HANDLED;
    }

    new who[32], adm[32]
    get_user_name(target, who, charsmax(who))
    get_user_name(id, adm, charsmax(adm))

    // ⚠️ Через amx_ban, а не своим banid: у купленной админки срок и число
    // банов ограничивает zp_admin_limits.sma, и он висит именно на этой
    // команде. Свой banid обошёл бы ограничение молча.
    client_cmd(id, "amx_ban #%d %d ^"через админ-меню^"", get_user_userid(target), g_ban_times[n])
    zlog("АДМИНКА: %s заблокировал %s на %d мин", adm, who, g_ban_times[n])
    return PLUGIN_HANDLED;
}

// ── выдача привилегии ───────────────────────────────────────────────────────────

show_tiers(id)
{
    if (!is_user_connected(g_target[id])) return;

    new who[32]
    get_user_name(g_target[id], who, charsmax(who))

    new title[160]
    formatex(title, charsmax(title),
        "\y[Вспышка эпидемии]\w Выдать привилегию^n\wКому: \y%s", who)
    g_longest = 0
    new menu = menu_create(title, "tier_pick")

    for (new i = 0; i < sizeof g_tiers; i++)
    {
        new line[64], num[4]
        num_to_str(i, num, charsmax(num))
        formatex(line, charsmax(line), "\w%s \d(%s)", g_tiers[i][TNAME], g_tiers[i][TFLAGS])
        zm_menu_seen(g_longest, line)
        menu_additem(menu, line, num, 0)
    }

    menu_setprop(menu, MPROP_PERPAGE, 6)
    menu_setprop(menu, MPROP_EXITNAME, "Назад")
    zm_menu_fit(menu, title, g_longest)
    menu_display(id, menu)
}

public tier_pick(id, menu, item)
{
    if (item == MENU_EXIT) { menu_destroy(menu); show_players(id); return PLUGIN_HANDLED; }

    new info[8], name[64], access, callback
    menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback)
    menu_destroy(menu)

    if (!(get_user_flags(id) & ADMIN_LEVEL_C)) return PLUGIN_HANDLED;

    new n = str_to_num(info)
    if (n < 0 || n >= sizeof g_tiers) return PLUGIN_HANDLED;

    new target = g_target[id]
    if (!is_user_connected(target))
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Игрок уже вышел.")
        return PLUGIN_HANDLED;
    }

    // ⚠️ Ключом берём НАСТОЯЩИЙ SteamID. По нику записывать нельзя: ник меняется
    // одной командой, и привилегия уедет к любому, кто им назовётся.
    new authid[44], who[32], adm[32]
    get_user_authid(target, authid, charsmax(authid))
    get_user_name(target, who, charsmax(who))
    get_user_name(id, adm, charsmax(adm))

    if (!(strlen(authid) > 9 && equal(authid, "STEAM_", 6)
        && authid[7] == ':' && (authid[8] == '0' || authid[8] == '1') && authid[9] == ':'))
    {
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 У ^x03%s^x01 нет настоящего SteamID — привилегию по нику не выдаём.", who)
        return PLUGIN_HANDLED;
    }

    // amx_addadmin сам пишет users.ini и перечитывает его. «ce» — доступ по
    // SteamID; так же выдаёт наша панель и tools/add-admin.mjs.
    //
    // ⚠️ ФАЙЛ ПИШЕМ ВСЕГДА, даже когда привилегии живут в базе. users.ini —
    // последний рубеж: если база не ответит на старте карты, штатный плагин
    // администраторов возьмёт список оттуда, и владелец не окажется без прав
    // на своём же сервере.
    server_cmd("amx_addadmin ^"%s^" ^"%s^" ^"ce^"", authid, g_tiers[n][TFLAGS])
    server_exec()

    // И в базу — она главная. Строку заменяем целиком: у одного SteamID один
    // уровень, а не список уровней, накопленный за год.
    // ⚠️⚠️ В БАЗУ ОТСЮДА НЕ ПИШЕМ, И ЭТО НЕ УПУЩЕНИЕ. Привилегиями владеет сайт:
    // он ведёт zm_privileges со СРОКОМ действия и отдаёт серверу представление
    // zm_admins, где просроченного уже нет. Вписать строку отсюда — значит
    // добавить вечную привилегию мимо панели продаж и мимо срока, да ещё и
    // потребовать для игрового сервера прав на запись в базу сайта, которых он
    // намеренно лишён (docs/2026-08-11-site-integration.md).
    //
    // Поэтому здесь честно: запись в users.ini остаётся запасным входом, а
    // выдача «по-настоящему» делается на сайте.
    if (zm_db_on())
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Пока привилегии читаются из базы сайта, эта выдача — ^x03запасная^x01:"
            + " она сработает, только если база недоступна. Постоянную выдавайте в панели сайта.")

    client_print_color(id, print_team_default,
        "^x04[Вспышка эпидемии]^x01 ^x03%s^x01 получил уровень ^x04%s^x01. Заново зайдёт — уровень будет.", who, g_tiers[n][TNAME])
    client_print_color(target, print_team_default,
        "^x04[Вспышка эпидемии]^x01 Вам выдан уровень ^x04%s^x01. Он заработает при следующем заходе.", g_tiers[n][TNAME])
    zlog("АДМИНКА: %s выдал %s (%s) уровень %s", adm, who, authid, g_tiers[n][TNAME])
    return PLUGIN_HANDLED;
}

public sql_admin_done(failstate, Handle:query, const error[], errnum, const data[], size, Float:queuetime)
{
    if (failstate == TQUERY_SUCCESS) return;
    log_amx("БАЗА: привилегия не записалась (%d): %s — но в users.ini она есть", errnum, error)
}

// ── выдача кредитов ─────────────────────────────────────────────────────────────

show_gifts(id)
{
    if (!is_user_connected(g_target[id])) return;

    new who[32]
    get_user_name(g_target[id], who, charsmax(who))

    new title[160]
    formatex(title, charsmax(title),
        "\y[Вспышка эпидемии]\w Выдать кредиты^n\wКому: \y%s \d(сейчас %d)",
        who, zp_get_user_ammo_packs(g_target[id]))
    g_longest = 0
    new menu = menu_create(title, "gift_pick")

    for (new i = 0; i < sizeof g_gifts; i++)
    {
        new line[48], num[4]
        num_to_str(i, num, charsmax(num))
        formatex(line, charsmax(line), "\w+%d кредитов", g_gifts[i])
        zm_menu_seen(g_longest, line)
        menu_additem(menu, line, num, 0)
    }

    menu_setprop(menu, MPROP_PERPAGE, 6)
    menu_setprop(menu, MPROP_EXITNAME, "Назад")
    zm_menu_fit(menu, title, g_longest)
    menu_display(id, menu)
}

public gift_pick(id, menu, item)
{
    if (item == MENU_EXIT) { menu_destroy(menu); show_players(id); return PLUGIN_HANDLED; }

    new info[8], name[64], access, callback
    menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback)
    menu_destroy(menu)

    if (!(get_user_flags(id) & ADMIN_LEVEL_C)) return PLUGIN_HANDLED;

    new n = str_to_num(info)
    if (n < 0 || n >= sizeof g_gifts) return PLUGIN_HANDLED;

    new target = g_target[id]
    if (!is_user_connected(target))
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Игрок уже вышел.")
        return PLUGIN_HANDLED;
    }

    new who[32], adm[32]
    get_user_name(target, who, charsmax(who))
    get_user_name(id, adm, charsmax(adm))

    zp_set_user_ammo_packs(target, zp_get_user_ammo_packs(target) + g_gifts[n])

    client_print_color(id, print_team_default,
        "^x04[Вспышка эпидемии]^x01 ^x03%s^x01 получил ^x04%d^x01 кредитов.", who, g_gifts[n])
    client_print_color(target, print_team_default,
        "^x04[Вспышка эпидемии]^x01 Администратор выдал вам ^x04%d^x01 кредитов.", g_gifts[n])
    zlog("АДМИНКА: %s выдал %s %d кредитов", adm, who, g_gifts[n])
    return PLUGIN_HANDLED;
}

// ── мут ─────────────────────────────────────────────────────────────────────────
//
// set_speak глушит голос, но чат идёт мимо него — его перехватываем сами.
// Возвращаем PLUGIN_HANDLED: сообщение не уйдёт никому, включая самого автора.
public cmd_say(id)
{
    if (!g_muted[id]) return PLUGIN_CONTINUE;

    client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Вам запрещено писать в чат.")
    return PLUGIN_HANDLED;
}

// Все игровые события пишем в ОТДЕЛЬНЫЙ файл: в общем журнале сервера они
// тонут между строками движка.
zlog(const fmt[], any:...)
{
    if (!get_pcvar_num(cvar_log)) return;

    static msg[256]
    vformat(msg, charsmax(msg), fmt, 2)
    log_to_file("zp_actions.log", "%s", msg)
}
