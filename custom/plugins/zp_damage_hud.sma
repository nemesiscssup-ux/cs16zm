/*
 * [ZP] Показ урона при попадании.
 *
 * Стрелявшему всплывает число нанесённого урона; попадания подряд складываются.
 *
 * Рисуем через DHUD (режиссёрское сообщение): четыре обычных канала HUD у нас
 * уже заняты — события, нижняя панель, верхняя строка и подсказка по клавишам.
 *
 * ГЛАВНОЕ про DHUD: клиент GoldSrc такое сообщение НЕ заменяет предыдущим, а
 * ДОБАВЛЯЕТ в список (их живёт до шестнадцати штук разом). Если слать надпись
 * на каждое попадание и держать её дольше, чем идёт очередь, на экране окажется
 * пять-шесть разных чисел поверх друг друга — сплошная каша.
 *
 * Поэтому надпись выпускается не по попаданию, а по расписанию, и живёт ровно
 * один шаг расписания: два сообщения никогда не пересекаются. Совпадающие
 * подряд числа при этом рисуются на одном месте и глазу неотличимы от одного.
 */

#include <amxmodx>
#include <fakemeta>
#include <hamsandwich>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Показ урона"
#define VERSION "1.1"
#define AUTHOR "cs16zm"

// Шаг обновления. Время жизни надписи равно ему же, иначе они наложатся.
const Float:TICK = 0.15

new g_sum[33]              // накопленный урон
new Float:g_last[33]       // время последнего попадания
new bool:g_killed[33]      // последним попаданием добили
new cvar_enabled, cvar_window, cvar_pos

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    cvar_enabled = register_cvar("zp_dmg_show", "1")
    // Сколько секунд число висит после последнего попадания и через сколько
    // тишины начинается новая серия.
    cvar_window = register_cvar("zp_dmg_window", "0.9")
    // Высота надписи: 0.0 — верх экрана, 1.0 — низ. Чуть ниже прицела.
    cvar_pos = register_cvar("zp_dmg_pos", "0.56")

    RegisterHam(Ham_TakeDamage, "player", "fw_TakeDamage_Post", 1)

    set_task(TICK, "draw_tick", 0, _, _, "b")
}

public client_putinserver(id)
{
    g_sum[id] = 0
    g_last[id] = 0.0
    g_killed[id] = false
}

public fw_TakeDamage_Post(victim, inflictor, attacker, Float:damage, damagebits)
{
    if (!get_pcvar_num(cvar_enabled)) return HAM_IGNORED;

    // Урон от мира, по себе и по своим не показываем.
    if (attacker < 1 || attacker > 32 || attacker == victim) return HAM_IGNORED;
    if (!is_user_connected(attacker) || is_user_bot(attacker)) return HAM_IGNORED;
    if (zp_get_user_zombie(attacker) == zp_get_user_zombie(victim)) return HAM_IGNORED;

    new dmg = floatround(damage)
    if (dmg < 1) return HAM_IGNORED;

    new Float:now = get_gametime()
    if (now - g_last[attacker] > get_pcvar_float(cvar_window))
    {
        g_sum[attacker] = 0
        g_killed[attacker] = false
    }
    g_last[attacker] = now
    g_sum[attacker] += dmg

    // Добивание отмечаем отдельно: по числу этого не видно, а знать полезно.
    if (get_user_health(victim) - dmg <= 0) g_killed[attacker] = true

    return HAM_IGNORED;
}

public draw_tick()
{
    if (!get_pcvar_num(cvar_enabled)) return;

    static players[32], num, id, i
    static Float:now, Float:window, Float:pos
    now = get_gametime()
    window = get_pcvar_float(cvar_window)
    pos = get_pcvar_float(cvar_pos)

    get_players(players, num, "ch")   // подключённые, без ботов

    for (i = 0; i < num; i++)
    {
        id = players[i]
        if (g_sum[id] <= 0) continue;

        // Серия закончилась: молча гасим — последняя надпись догорит сама.
        if (now - g_last[id] > window)
        {
            g_sum[id] = 0
            g_killed[id] = false
            continue;
        }

        // Ни затухания, ни проявления: они продлевают жизнь надписи сверх шага
        // и вернули бы наложение, ради устранения которого всё и переделано.
        set_dhudmessage(g_killed[id] ? 255 : 235, g_killed[id] ? 60 : 190, 60,
            -1.0, pos, 0, 0.0, TICK, 0.0, 0.0)
        show_dhudmessage(id, g_killed[id] ? "-%d  X" : "-%d", g_sum[id])
    }
}
