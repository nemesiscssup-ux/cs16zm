/*
 * [ZP] Отсчёт до заражения — голосом и на экране.
 *
 * До первого заражения мод даёт людям несколько секунд разбежаться, но узнать
 * об этом можно было только по строке в верхней панели. Владелец попросил
 * озвучить: последние пять секунд считаются вслух, на последней играет сигнал.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫМ ПЛАГИНОМ. Момент заражения знает сам мод, но наружу его не
 * отдаёт: форвард zp_round_started приходит уже ПОСЛЕ. Зато время известно
 * заранее — это cvar zp_delay от начала раунда, — и считать его можно самому,
 * ничего в моде не трогая.
 *
 * ⚠️ ЗВУКИ СВОИ, ИЗ sound/zm_hot. Голос диктора взят из сборки JUST PRO
 * (tools/port-sounds.mjs). Класть их в чужую папку нельзя: у игрока в загрузках
 * лежат звуки всех серверов, где он бывал, и файл с тем же путём клиент возьмёт
 * СТАРЫЙ.
 */

#include <amxmodx>
#include <amxmisc>
#include <dhudmessage>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Отсчёт до заражения"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

#define TASK_TICK 6100

// Считаем с пяти: раньше — это уже не отсчёт, а фон, на который перестают
// обращать внимание.
new const SND_COUNT[][] = {
    "zm_hot/count1.wav",
    "zm_hot/count2.wav",
    "zm_hot/count3.wav",
    "zm_hot/count4.wav",
    "zm_hot/count5.wav",
}
// Сигнал в сам миг заражения. Штатный, качать нечего.
new const SND_GO[] = "ambience/the_horror2.wav"

new cvar_enabled, cvar_from
new g_left                  // сколько секунд осталось; 0 — отсчёт не идёт
new bool:g_ready[sizeof SND_COUNT]

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    cvar_enabled = register_cvar("zp_countdown", "1")
    // С какой секунды начинать. Больше пяти не имеет смысла: голосов у нас
    // ровно пять, дальше пришлось бы считать молча.
    cvar_from = register_cvar("zp_countdown_from", "5")

    // Начало раунда: у мода своего форварда на это нет, ловим событие движка.
    register_event("HLTV", "event_round_start", "a", "1=0", "2=0")
}

public plugin_precache()
{
    for (new i = 0; i < sizeof SND_COUNT; i++)
    {
        new path[80]
        formatex(path, charsmax(path), "sound/%s", SND_COUNT[i])
        // ⚠️ Путь в precache_sound пишется БЕЗ «sound/», а file_exists — С ним.
        g_ready[i] = bool:file_exists(path)
        if (g_ready[i]) precache_sound(SND_COUNT[i])
        else log_amx("нет звука отсчёта: %s", path)
    }
    precache_sound(SND_GO)
}

public event_round_start()
{
    remove_task(TASK_TICK)
    if (!get_pcvar_num(cvar_enabled)) return;

    // Сколько мод ждёт до первого заражения. Своей копии этого числа не держим:
    // владелец меняет его в конфиге, и две цифры разошлись бы молча.
    new delay = get_cvar_num("zp_delay")
    new from = get_pcvar_num(cvar_from)
    if (from > sizeof SND_COUNT) from = sizeof SND_COUNT
    if (delay <= from) return;   // считать нечего: заражение и так вот-вот

    g_left = from
    set_task(float(delay - from), "tick", TASK_TICK)
}

public tick(task)
{
    if (!get_pcvar_num(cvar_enabled)) return;

    // Раунд мог кончиться раньше отсчёта — тогда молчим.
    if (zp_has_round_started() == 1) { g_left = 0; return; }

    if (g_left > 0)
    {
        new i = g_left - 1
        if (i >= 0 && i < sizeof SND_COUNT && g_ready[i]) play_all(SND_COUNT[i])

        set_dhudmessage(255, 60, 60, -1.0, 0.28, 0, 0.0, 1.0, 0.0, 0.1)
        show_dhudmessage(0, "Заражение через %d", g_left)

        g_left--
        set_task(1.0, "tick", TASK_TICK)
        return;
    }

    play_all(SND_GO)
    set_dhudmessage(255, 0, 0, -1.0, 0.28, 0, 0.0, 2.0, 0.0, 0.3)
    show_dhudmessage(0, "ЗАРАЖЕНИЕ")
}

// Звук слышат все и одинаково громко: это объявление, а не событие на карте,
// и привязывать его к точке нельзя — половина сервера не услышала бы.
play_all(const sound[])
{
    new players[32], num
    get_players(players, num, "ch")
    for (new i = 0; i < num; i++)
        client_cmd(players[i], "spk ^"%s^"", sound)
}
