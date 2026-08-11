/*
 * [ZP] Объявления серий: первая кровь, двойное, тройное и дальше.
 *
 * Владелец попросил поискать звуки событий. В сборке JUST PRO такие есть —
 * голос диктора на серию убийств, — но объявляет их плагин, которого у нас нет
 * и который завязан на чужой форк мода. Звуки перенесены (tools/port-sounds.mjs),
 * объявляем сами.
 *
 * ДВА РАЗНЫХ СЧЁТА, и путать их нельзя:
 *
 *   БЫСТРАЯ СЕРИЯ — сколько убил за несколько секунд подряд. Это «двойное»,
 *   «тройное»: награда за миг, а не за раунд. Счёт сбрасывается по времени.
 *
 *   ДОЛГАЯ СЕРИЯ — сколько убил за жизнь, без смертей. Это «монстр», «бог».
 *   Сбрасывается смертью и заражением.
 *
 * ⚠️ СЧИТАЕМ ТОЛЬКО УБИЙСТВА ЗОМБИ ЧЕЛОВЕКОМ. Зомби убивает человека одним
 * касанием и набрал бы «бога» за полминуты, а объявление должно означать
 * умение, а не то, что раунд идёт.
 */

#include <amxmodx>
#include <amxmisc>
#include <dhudmessage>
#include <hamsandwich>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Серии убийств"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

#define TASK_COMBO 6200

// Быстрая серия: сколько убийств подряд и что за это объявляют.
enum _:STREAK { COUNT, TITLE[32], SND[40] }

new const g_combo[][STREAK] = {
    { 2, "ДВОЙНОЕ УБИЙСТВО", "zm_hot/streak_double.wav" },
    { 3, "ТРОЙНОЕ УБИЙСТВО", "zm_hot/streak_triple.wav" },
    { 4, "МЕГА-УБИЙСТВО",    "zm_hot/streak_mega.wav" },
    { 5, "УЛЬТРА-УБИЙСТВО",  "zm_hot/streak_ultra.wav" },
}

// Долгая серия за жизнь.
new const g_spree[][STREAK] = {
    {  6, "РАЗГУЛ",   "zm_hot/streak_monster.wav" },
    { 10, "НЕУДЕРЖИМ", "zm_hot/streak_god.wav" },
}

new const SND_FIRST[] = "zm_hot/streak_first.wav"

new cvar_enabled, cvar_window, cvar_log
new g_combo_n[33], g_spree_n[33]
new bool:g_first_taken

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    cvar_enabled = register_cvar("zp_streaks", "1")
    // Сколько секунд убийства считаются «подряд». Полторы секунды мало —
    // человек не успевает довести очередь до второго зомби; пять много —
    // «двойное» перестаёт быть событием.
    cvar_window = register_cvar("zp_streaks_window", "3.0")
    cvar_log = register_cvar("zp_log_actions", "1")

    RegisterHam(Ham_Killed, "player", "fw_killed_post", 1)
}

public plugin_precache()
{
    precache_one(SND_FIRST)
    for (new i = 0; i < sizeof g_combo; i++) precache_one(g_combo[i][SND])
    for (new i = 0; i < sizeof g_spree; i++) precache_one(g_spree[i][SND])
}

// ⚠️ Путь в precache_sound пишется БЕЗ «sound/», а на диске файл лежит С ним.
precache_one(const snd[])
{
    new path[80]
    formatex(path, charsmax(path), "sound/%s", snd)
    if (file_exists(path)) precache_sound(snd)
    else log_amx("нет звука серии: %s", path)
}

public zp_round_started(gamemode, id)
{
    g_first_taken = false
    for (new i = 1; i <= 32; i++) { g_combo_n[i] = 0; g_spree_n[i] = 0; }
}

public fw_killed_post(victim, attacker, shouldgib)
{
    if (!get_pcvar_num(cvar_enabled)) return;
    if (!is_user_connected(attacker) || attacker == victim) return;

    // Только человек, убивший зомби. Жертву проверяем ПОСЛЕ смерти: мод к этому
    // моменту зомбичность ещё не снял, поэтому признак читается верно.
    if (zp_get_user_zombie(attacker) || !zp_get_user_zombie(victim)) return;

    if (!g_first_taken)
    {
        g_first_taken = true
        announce(attacker, "ПЕРВАЯ КРОВЬ", SND_FIRST)
    }

    g_spree_n[victim] = 0     // убитого серия обрывается
    g_combo_n[attacker]++
    g_spree_n[attacker]++

    // Окно быстрой серии продлевается с каждым убийством.
    remove_task(attacker + TASK_COMBO)
    set_task(get_pcvar_float(cvar_window), "combo_over", attacker + TASK_COMBO)

    for (new i = sizeof g_combo - 1; i >= 0; i--)
    {
        if (g_combo_n[attacker] != g_combo[i][COUNT]) continue;
        announce(attacker, g_combo[i][TITLE], g_combo[i][SND])
        break;
    }

    for (new i = sizeof g_spree - 1; i >= 0; i--)
    {
        if (g_spree_n[attacker] != g_spree[i][COUNT]) continue;
        announce(attacker, g_spree[i][TITLE], g_spree[i][SND])
        break;
    }
}

public combo_over(task) g_combo_n[task - TASK_COMBO] = 0

// Смерть и заражение обрывают долгую серию: она про то, что игрок жив и держит
// строй, а не про сумму за карту.
public zp_user_infected_post(id, infector, nemesis)
{
    g_spree_n[id] = 0
    g_combo_n[id] = 0
    remove_task(id + TASK_COMBO)
}

public client_putinserver(id) { g_combo_n[id] = 0; g_spree_n[id] = 0; }

announce(id, const title[], const snd[])
{
    new who[32]
    get_user_name(id, who, charsmax(who))

    set_dhudmessage(255, 200, 60, -1.0, 0.22, 0, 0.0, 2.0, 0.0, 0.3)
    show_dhudmessage(0, "%s^n%s", title, who)

    // Слышат все и одинаково: это объявление, а не событие на карте.
    new players[32], num
    get_players(players, num, "ch")
    for (new i = 0; i < num; i++) client_cmd(players[i], "spk ^"%s^"", snd)

    if (get_pcvar_num(cvar_log)) log_to_file("zp_actions.log", "СЕРИЯ: %s — %s", who, title)
}
