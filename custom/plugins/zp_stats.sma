/*
 * [ZP] Статистика игроков в базе.
 *
 * ЗАЧЕМ. Штатный счёт мода живёт в ПАМЯТИ и ищется ПО ИМЕНИ: он переживает
 * переподключение в пределах карты и теряется при её смене. Владелец попросил
 * хранить статистику в базе — значит, она должна пережить и смену карты, и
 * перезапуск, и переезд сервера.
 *
 * ЧТО СЧИТАЕМ. Ровно то, что в зомби-моде что-то значит:
 *
 *   убийства зомби    — за это дают кредиты, это и есть игра за человека;
 *   заражения         — то же самое за зомби;
 *   смерти            — знаменатель, без него убийства ни о чём не говорят;
 *   время на сервере  — минуты; по ним видно завсегдатаев.
 *
 * ⚠️ УБИЙСТВА СЧИТАЕМ РАЗДЕЛЬНО. У человека и зомби разная работа: человек
 * стреляет, зомби касается. Свалить их в одно «фраги» — значит сделать таблицу
 * лидеров бессмысленной: зомби набьёт больше просто потому, что его цель не
 * убегает, а бежит навстречу.
 *
 * ⚠️ ПИШЕМ РЕДКО И ПАЧКОЙ. Отдельный запрос на каждое убийство — это сотни
 * запросов за раунд к базе на другой машине. Копим в памяти и сбрасываем, как
 * весь остальной прогресс: по концу раунда, по выходу игрока и по расписанию.
 */

#include <amxmodx>
#include <amxmisc>
#include <hamsandwich>
#include <zm_db>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Статистика"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

// ⚠️ Запрос одной строкой: Pawn не склеивает соседние строковые записи.
new const SQL_CREATE[] = "CREATE TABLE IF NOT EXISTS zm_stats (steamid VARBINARY(64) NOT NULL PRIMARY KEY, name VARBINARY(64) NOT NULL DEFAULT '', kills INTEGER NOT NULL DEFAULT 0, infections INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, minutes INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0)"

new cvar_enabled, cvar_log, cvar_interval

// Накопленное за эту жизнь на сервере — то, чего ЕЩЁ НЕТ в базе.
new g_kills[33], g_infections[33], g_deaths[33]
new g_joined[33]        // когда игрок зашёл, по игровому времени сервера
new g_counted[33]       // сколько его минут уже записано в базу

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    zm_db_init()
    cvar_enabled  = register_cvar("zp_stats", "1")
    cvar_log      = register_cvar("zp_log_actions", "1")
    // Как часто сбрасывать накопленное. Реже минуты незачем: при жёстком снятии
    // процесса теряется ровно этот кусок.
    cvar_interval = register_cvar("zp_stats_interval", "120.0")

    RegisterHam(Ham_Killed, "player", "fw_killed_post", 1)

    register_concmd("zp_stats_show", "cmd_show", ADMIN_LEVEL_A,
        "- показать накопленную и ещё не записанную статистику")
}

public plugin_cfg()
{
    if (zm_db_on()) zm_db_create(SQL_CREATE)

    new Float:interval = get_pcvar_float(cvar_interval)
    if (interval < 30.0) interval = 30.0

    remove_task(0)
    set_task(interval, "flush_everyone", 0, _, _, "b")
}

public client_putinserver(id)
{
    g_kills[id] = 0
    g_infections[id] = 0
    g_deaths[id] = 0
    g_counted[id] = 0
    g_joined[id] = get_systime()
}

public client_disconnected(id, bool:drop, message[], maxlen)
{
    flush(id)
    g_joined[id] = 0
}

public zp_round_ended(winteam) flush_everyone()

// ⚠️ ЖЕРТВУ ПРОВЕРЯЕМ ПОСЛЕ СМЕРТИ, а нападающего — на момент удара. Мод к
// этому мигу зомбичность ещё не снял, поэтому признак читается верно.
public fw_killed_post(victim, attacker, shouldgib)
{
    if (!get_pcvar_num(cvar_enabled)) return;

    if (is_user_connected(victim)) g_deaths[victim]++

    if (!is_user_connected(attacker) || attacker == victim) return;
    if (zp_get_user_zombie(attacker) == zp_get_user_zombie(victim)) return;

    if (zp_get_user_zombie(attacker)) g_infections[attacker]++
    else g_kills[attacker]++
}

// Заражение касанием — это не «убийство», мод не зовёт Ham_Killed. Считаем
// отдельно: для зомби это и есть главное действие в игре.
public zp_user_infected_post(id, infector, nemesis)
{
    if (!get_pcvar_num(cvar_enabled)) return;
    if (!is_user_connected(infector) || infector == id) return;

    g_infections[infector]++
}

// Оба запроса разом: строку заводим, если её нет, и прибавляем к ней. Один
// текст на оба пути — иначе они однажды разъедутся.
build_flush_sql(id, const key[], const safe[], minutes, add[], addlen, upd[], updlen)
{
    formatex(add, addlen, "INSERT INTO zm_stats (steamid, name) SELECT '%s', '%s' WHERE NOT EXISTS (SELECT 1 FROM zm_stats WHERE steamid = '%s')", key, safe, key)
    formatex(upd, updlen, "UPDATE zm_stats SET name = '%s', kills = kills + %d, infections = infections + %d, deaths = deaths + %d, minutes = minutes + %d, updated = %d WHERE steamid = '%s'",
        safe, g_kills[id], g_infections[id], g_deaths[id], minutes, get_systime(), key)
}

// Соединение на время выгрузки плагина: открываем одно на всех и закрываем.
new Handle:g_now = Empty_Handle
new bool:g_ending = false

flush_db_blocking(const sql[])
{
    if (g_now == Empty_Handle) return;

    new Handle:q = SQL_PrepareQuery(g_now, sql)
    if (!SQL_Execute(q)) log_amx("БАЗА: статистика не дописалась при смене карты: %s", sql)
    SQL_FreeHandle(q)
}

public plugin_end()
{
    if (!zm_db_on() || !get_pcvar_num(cvar_enabled)) return;

    new err[192], errnum
    g_now = SQL_Connect(zm_db_tuple(), errnum, err, charsmax(err))
    if (g_now == Empty_Handle)
    {
        log_amx("БАЗА: перед сменой карты не подключились (%d): %s", errnum, err)
        return;
    }

    g_ending = true
    flush_everyone()
    g_ending = false

    SQL_FreeHandle(g_now)
    g_now = Empty_Handle
}

public flush_everyone()
{
    new players[32], num
    get_players(players, num)
    for (new i = 0; i < num; i++) flush(players[i])
}

// Записать накопленное и обнулить счётчики в памяти.
//
// ⚠️ ПРИБАВЛЯЕМ, А НЕ ЗАМЕЩАЕМ. Иначе игрок, зашедший на минуту, обнулил бы
// себе всё накопленное за месяц. Поэтому не REPLACE, а UPDATE с прибавкой — и
// отдельная вставка, если строки ещё нет.
flush(id)
{
    if (!get_pcvar_num(cvar_enabled) || !zm_db_on()) return;
    if (!is_user_connected(id)) return;

    new minutes = 0
    if (g_joined[id])
    {
        new whole = (get_systime() - g_joined[id]) / 60
        minutes = whole - g_counted[id]
        if (minutes < 0) minutes = 0
        g_counted[id] += minutes
    }

    if (!g_kills[id] && !g_infections[id] && !g_deaths[id] && !minutes) return;

    new key[64], name[32], safe[64]
    zm_db_key(id, key, charsmax(key))
    get_user_name(id, name, charsmax(name))
    zm_db_safe(safe, charsmax(safe), name)

    // Строка может отсутствовать — заводим пустую, а следом прибавляем. Два
    // запроса вместо одного «ON DUPLICATE KEY UPDATE» нарочно: тот есть только
    // у MySQL, а сборка обязана работать и на SQLite.
    new add[320], upd[320]
    build_flush_sql(id, key, safe, minutes, add, charsmax(add), upd, charsmax(upd))

    if (g_ending)
    {
        // ⚠️ НА СМЕНЕ КАРТЫ — БЕЗ ОЧЕРЕДИ. Потоковый запрос уйдёт вместе с
        // выгруженным плагином, и всё, что игрок набрал в недоигранном раунде,
        // пропадёт. Ждать базу здесь не жалко: игроки на загрузочном экране.
        flush_db_blocking(add)
        flush_db_blocking(upd)
    }
    else
    {
        SQL_ThreadQuery(zm_db_tuple(), "sql_done", add)
        SQL_ThreadQuery(zm_db_tuple(), "sql_done", upd)
    }

    zlog("СТАТИСТИКА: %s +%d убийств, +%d заражений, +%d смертей, +%d минут",
        key, g_kills[id], g_infections[id], g_deaths[id], minutes)

    g_kills[id] = 0
    g_infections[id] = 0
    g_deaths[id] = 0
}

public sql_done(failstate, Handle:query, const error[], errnum, const data[], size, Float:queuetime)
{
    if (failstate == TQUERY_SUCCESS) return;
    log_amx("БАЗА: статистика не записалась (%d): %s", errnum, error)
}

public cmd_show(id, level, cid)
{
    if (!cmd_access(id, level, cid, 1)) return PLUGIN_HANDLED;

    console_print(id, "накоплено и ещё не записано в базу:")

    new players[32], num
    get_players(players, num)
    for (new i = 0; i < num; i++)
    {
        new p = players[i], name[32], key[64]
        get_user_name(p, name, charsmax(name))
        zm_db_key(p, key, charsmax(key))
        console_print(id, "  %-20s убийств %-4d заражений %-4d смертей %-4d ключ %s",
            name, g_kills[p], g_infections[p], g_deaths[p], key)
    }
    if (!num) console_print(id, "  на сервере никого")

    return PLUGIN_HANDLED;
}

zlog(const fmt[], any:...)
{
    if (!get_pcvar_num(cvar_log)) return;

    static msg[256]
    vformat(msg, charsmax(msg), fmt, 2)
    log_to_file("zp_actions.log", "%s", msg)
}
