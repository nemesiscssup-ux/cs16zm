/*
 * ВРЕМЕННЫЙ ИЗМЕРИТЕЛЬ (custom/diag, в сборку не идёт).
 *
 * Проверяет глазами две сегодняшние правки:
 *   1) МАНЕКЕН при осмотре — владелец: «персонаж в земле, точнее его ноги».
 *      Ставим игрока на ровный пол, включаем осмотр боевой командой и снимаем
 *      кадр: ступни должны стоять НА полу, а не в нём.
 *   2) ФАРАОН — новый скин, вырезанный из пака tools/mdl-extract.mjs. Его надо
 *      увидеть хотя бы раз: вырезалка новая, и ошибка в ней даст либо пустоту,
 *      либо мусор вместо модели.
 *
 * Кадры: Half-Life/cstrike/<карта>NNNN.bmp, порядок — в logs/zp_actions.log.
 */

#include <amxmodx>
#include <amxmisc>
#include <cstrike>
#include <engine>
#include <fakemeta>
#include <hamsandwich>
#include <reapi>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Измеритель: манекен и фараон"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

#define TASK_JOIN 8000
#define TASK_STEP 8100

new g_watcher = 0
new g_step = -1

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)
    register_message(get_user_msgid("VGUIMenu"), "msg_no_panel")
    register_message(get_user_msgid("MOTD"), "msg_no_panel")
}

public msg_no_panel(msgid, dest, id) return PLUGIN_HANDLED;

public plugin_precache()
{
    new p[80]
    formatex(p, charsmax(p), "models/player/zm_hot_faraon/zm_hot_faraon.mdl")
    if (file_exists(p)) precache_model(p)
}

public client_putinserver(id)
{
    if (is_user_bot(id)) return;
    set_task(8.0, "force_join", id + TASK_JOIN)
}

public force_join(task)
{
    new id = task - TASK_JOIN
    if (!is_user_connected(id)) return;

    if (!is_user_alive(id))
    {
        set_pev(id, pev_iuser1, 0)
        set_pev(id, pev_iuser2, 0)
        rg_join_team(id, TEAM_CT)
        set_member(id, m_iJoiningState, JOINED)
        rg_set_user_team(id, TEAM_CT, MODEL_CT_URBAN)
        rg_round_respawn(id)
        set_task(3.0, "force_join", id + TASK_JOIN)
        return;
    }

    if (g_step >= 0) return;
    g_watcher = id
    g_step = 0

    server_cmd("sv_cheats 1; bot_kick")
    // ⚠️ Зомби мод выдаёт ночное зрение, и кадр заливает зелёным. Держим
    // наблюдателя человеком, иначе по снимку ничего не разобрать.
    zp_disinfect_user(id, 1)
    // Одного вызова мало: раунд может заразить наблюдателя снова. Держим его
    // человеком всё время прогона.
    set_task(1.0, "keep_human", id + TASK_JOIN, _, _, "b")
    client_cmd(id, "hud_draw 0")

    // Смотрим чуть вниз: манекен встанет на пол перед игроком, и по кадру
    // сразу видно, стоит он на земле или утоплен в неё.
    static Float:ang[3]
    ang[0] = 26.0
    ang[1] = 90.0
    ang[2] = 0.0
    set_pev(id, pev_angles, ang)
    set_pev(id, pev_v_angle, ang)
    set_pev(id, pev_fixangle, 1)
    set_pev(id, pev_flags, pev(id, pev_flags) | FL_FROZEN)

    log_to_file("zp_actions.log", "МАНЕКЕН-ИЗМ: наблюдатель в игре")
    set_task(2.0, "next_step", TASK_STEP)
}

public next_step(task)
{
    if (!is_user_alive(g_watcher)) { set_task(2.0, "next_step", TASK_STEP); return; }

    switch (g_step)
    {
        case 0:
        {
            // Надеваем фараона боевым путём — через мод, как это делает плагин.
            zp_override_user_model(g_watcher, "zm_hot_faraon", 0)
            log_to_file("zp_actions.log", "МАНЕКЕН-ИЗМ: надет «zm_hot_faraon»")
            g_step = 1
            set_task(2.0, "next_step", TASK_STEP)
        }
        case 1:
        {
            // И смотрим на себя — той же командой, что и игрок.
            client_cmd(g_watcher, "zp_skin_view")
            log_to_file("zp_actions.log", "МАНЕКЕН-ИЗМ: включили осмотр")
            g_step = 2
            set_task(2.0, "next_step", TASK_STEP)
        }
        case 2:
        {
            client_cmd(g_watcher, "snapshot")
            log_to_file("zp_actions.log", "МАНЕКЕН-ИЗМ: кадр с манекеном снят")
            g_step = 3
            set_task(2.0, "next_step", TASK_STEP)
        }
        case 3:
        {
            // Второй кадр с другой стороны: манекен медленно поворачивается.
            client_cmd(g_watcher, "snapshot")
            log_to_file("zp_actions.log", "МАНЕКЕН-ИЗМ: второй кадр снят, конец")
            g_step = -1
        }
    }
}

public keep_human(task)
{
    new id = task - TASK_JOIN
    if (!is_user_connected(id)) { remove_task(task); return; }
    if (is_user_alive(id) && zp_get_user_zombie(id)) zp_disinfect_user(id, 1)
}
