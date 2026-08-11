/*
 * ВРЕМЕННЫЙ ИЗМЕРИТЕЛЬ. В сборку не идёт (custom/diag).
 *
 * ЗАЧЕМ. Владелец: «модель показывается только при смерти». Значит вопрос не
 * в файле модели — она грузится и рисуется на трупе, — а в том, рисуется ли
 * ЖИВОЙ игрок от третьего лица. Ставим два кадра подряд с одной и той же
 * моделью: живой и мёртвый. Разница между ними и есть ответ.
 *
 * ⚠️ Прошлый прогон утонул в шуме: боты расстреливали наблюдателя (красный
 * экран), а сам он стоял в тёмном углу. Поэтому здесь — бессмертие,
 * неподвижность и подъём в воздух: на фоне неба модель видно однозначно.
 */

#include <amxmodx>
#include <amxmisc>
#include <cstrike>
#include <engine>
#include <fakemeta>
#include <hamsandwich>
#include <reapi>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Измеритель: живой против трупа"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

#define TASK_JOIN 7600
#define TASK_STEP 7700

// По одной модели каждого рода: заведомо рабочая привилегия, новый скин
// магазина и класс зомби. Больше не нужно — вопрос не «какая модель», а
// «живой или мёртвый».
new const LIST[][32] = { "zm_hot_spec", "zm_hot_zvezda", "zm_hot_z_witch" }

new g_idx[sizeof LIST]
new g_watcher = 0
new g_step = -1
new g_shot = 0
new bool:g_dead_pass = false

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)
    register_message(get_user_msgid("VGUIMenu"), "msg_no_panel")
    register_message(get_user_msgid("MOTD"), "msg_no_panel")
}

public msg_no_panel(msgid, dest, id) return PLUGIN_HANDLED;

public plugin_precache()
{
    for (new i = 0; i < sizeof LIST; i++)
    {
        new p[80]
        formatex(p, charsmax(p), "models/player/%s/%s.mdl", LIST[i], LIST[i])
        g_idx[i] = file_exists(p) ? precache_model(p) : 0
    }
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
    g_shot = 0

    server_cmd("sv_cheats 1; mp_autoteambalance 0; bot_kick")
    client_cmd(id, "r_fullbright 1; brightness 2; hud_draw 0")

    lift(id)
    set_view(id, CAMERA_3RDPERSON)

    log_to_file("zp_actions.log", "ЖИВОЙ/ТРУП: начали, моделей %d", sizeof LIST)
    set_task(3.0, "next_step", TASK_STEP)
}

// Поднимаем в воздух и держим: на фоне неба ничего не заслоняет модель, а
// бессмертие не даёт прогону сорваться на середине.
lift(id)
{
    static Float:o[3]
    pev(id, pev_origin, o)
    o[2] += 240.0
    set_pev(id, pev_movetype, MOVETYPE_NOCLIP)
    engfunc(EngFunc_SetOrigin, id, o)
    set_pev(id, pev_takedamage, DAMAGE_NO)
    set_pev(id, pev_velocity, Float:{0.0, 0.0, 0.0})
}

public next_step(task)
{
    if (g_step < 0 || g_step >= sizeof LIST)
    {
        log_to_file("zp_actions.log", "ЖИВОЙ/ТРУП: закончили, кадров %d", g_shot)
        g_step = -1
        set_view(g_watcher, CAMERA_NONE)
        return;
    }

    new i = g_step
    g_step++

    if (!is_user_alive(g_watcher))
    {
        // Труп отсняли — поднимаем обратно и продолжаем список.
        rg_round_respawn(g_watcher)
        lift(g_watcher)
        set_view(g_watcher, CAMERA_3RDPERSON)
        g_step--          // ту же модель ещё раз, уже живым
        set_task(2.0, "next_step", TASK_STEP)
        return;
    }

    zp_override_user_model(g_watcher, LIST[i], g_idx[i])
    set_view(g_watcher, CAMERA_3RDPERSON)
    log_to_file("zp_actions.log", "ЖИВОЙ/ТРУП: кадр %d — ЖИВОЙ «%s»", g_shot, LIST[i])
    set_task(1.8, "shot_alive", TASK_STEP + 1)
}

public shot_alive(task)
{
    if (!is_user_connected(g_watcher)) return;

    new now[64]
    cs_get_user_model(g_watcher, now, charsmax(now))
    log_to_file("zp_actions.log", "ЖИВОЙ/ТРУП:   живой, на игроке «%s»", now)
    client_cmd(g_watcher, "snapshot")
    g_shot++

    set_task(1.2, "kill_now", TASK_STEP + 2)
}

public kill_now(task)
{
    if (!is_user_alive(g_watcher)) return;

    set_pev(g_watcher, pev_takedamage, DAMAGE_YES)
    set_pev(g_watcher, pev_movetype, MOVETYPE_WALK)
    user_kill(g_watcher, 1)

    log_to_file("zp_actions.log", "ЖИВОЙ/ТРУП:   убили, снимаем труп")
    set_task(2.0, "shot_dead", TASK_STEP + 3)
}

public shot_dead(task)
{
    if (!is_user_connected(g_watcher)) return;
    client_cmd(g_watcher, "snapshot")
    g_shot++
    set_task(1.5, "next_step", TASK_STEP)
}
