/*
 * [ZP] Ограничения для купленной админки.
 *
 * Админка продаётся игрокам, а значит попадает к людям, которых никто не
 * проверял. Полный доступ им давать нельзя: один обиженный за вечер разгонит
 * сервер. Поэтому у купленной админки урезаны и срок бана, и их количество.
 *
 *   zp_admin_ban_max      сколько минут максимум         (по умолчанию 30)
 *   zp_admin_ban_permap   сколько банов за карту         (по умолчанию 3)
 *   zp_admin_full_flag    у кого ограничений нет         (по умолчанию «l», rcon)
 *
 * ⚠️ ПОЧЕМУ ПЛАГИН ГРУЗИТСЯ ВЫШЕ admincmd. Команду `amx_ban` обрабатывает
 * admincmd, и обработчики вызываются в порядке загрузки: кто первый вернул
 * PLUGIN_HANDLED, тот и решил. Стой мы ниже — наш запрет опоздал бы, бан уже
 * состоялся бы. Порядок задан в plugins.ini и это не косметика.
 *
 * Вечный бан у нас невозможен в принципе: ноль минут (в AMXX это «навсегда»)
 * подменяется предельным сроком.
 */

#include <amxmodx>
#include <amxmisc>

#define PLUGIN "[ZP] Ограничения админки"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

new cvar_max, cvar_permap, cvar_fullflag, cvar_log
new g_used[33]          // сколько банов выдал этот админ за карту

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    cvar_max      = register_cvar("zp_admin_ban_max", "30")
    cvar_permap   = register_cvar("zp_admin_ban_permap", "3")
    cvar_fullflag = register_cvar("zp_admin_full_flag", "l")
    cvar_log      = register_cvar("zp_log_actions", "1")

    // Обе команды: банят и по нику, и по адресу.
    register_clcmd("amx_ban", "cmd_ban")
    register_clcmd("amx_banip", "cmd_ban")
}

public client_putinserver(id) g_used[id] = 0

// Новая карта — счётчик обнуляется. Иначе лимит «три бана» превращается в
// «три бана навсегда», и админка становится бесполезной через вечер.
public plugin_cfg() for (new i = 1; i <= 32; i++) g_used[i] = 0

// Полный админ (по умолчанию — тот, у кого есть rcon) ограничений не знает:
// это владелец сервера, а не покупатель.
bool:unlimited(id)
{
    new flag[8]
    get_pcvar_string(cvar_fullflag, flag, charsmax(flag))
    if (!flag[0]) return false;

    return (get_user_flags(id) & read_flags(flag)) != 0;
}

public cmd_ban(id, level, cid)
{
    // Прав на бан нет вовсе — пусть admincmd сам и откажет, это его дело.
    if (!(get_user_flags(id) & ADMIN_BAN)) return PLUGIN_CONTINUE;
    if (unlimited(id)) return PLUGIN_CONTINUE;

    new limit = get_pcvar_num(cvar_permap)
    if (limit > 0 && g_used[id] >= limit)
    {
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 За карту можно забанить ^x04%d^x01 раз — лимит исчерпан.", limit)
        return PLUGIN_HANDLED;
    }

    new minutes[8]
    read_argv(1, minutes, charsmax(minutes))
    new asked = str_to_num(minutes)
    new maxmin = get_pcvar_num(cvar_max)

    // Ноль в AMXX означает «навсегда». Для купленной админки это недопустимо,
    // поэтому ноль тоже упирается в предел, а не проходит мимо проверки.
    if (asked <= 0 || asked > maxmin)
    {
        // Отдельный буфер, а не тернарник в аргументе: Pawn не умеет выбирать
        // между двумя строками выражением — «array must be indexed».
        new tail[32]
        if (asked <= 0) copy(tail, charsmax(tail), " (в том числе навсегда)")
        else tail[0] = 0

        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Больше ^x04%d^x01 минут банить нельзя%s.", maxmin, tail)
        return PLUGIN_HANDLED;
    }

    g_used[id]++

    new who[32], target[32]
    get_user_name(id, who, charsmax(who))
    read_argv(2, target, charsmax(target))
    zlog("БАН: %s забанил %s на %d мин (%d из %d за карту)", who, target, asked, g_used[id], limit)

    return PLUGIN_CONTINUE;
}

zlog(const fmt[], any:...)
{
    if (!get_pcvar_num(cvar_log)) return;

    static msg[256]
    vformat(msg, charsmax(msg), fmt, 2)
    log_to_file("zp_actions.log", "%s", msg)
}
