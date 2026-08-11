/*
 * ВРЕМЕННЫЙ ИЗМЕРИТЕЛЬ (custom/diag, в сборку не идёт).
 *
 * ЗАЧЕМ. Часть моделей не рисуется на ЖИВОМ игроке, но видна на трупе. Вопрос:
 * дело в самом файле или в том, как игровой модуль водит анимации игрока?
 * Ставим те же модели обычными предметами в мире, в ряд перед камерой. Предмет
 * рисуется тем же движком, но мимо всей игроцкой машинерии с походкой и
 * прицеливанием. Если предметы видны все, а на игроке — не все, виновата
 * анимация игрока, а не файл.
 */

#include <amxmodx>
#include <amxmisc>
#include <engine>
#include <fakemeta>
#include <reapi>

#define PLUGIN "[ZP] Измеритель: модель предметом"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

#define TASK_JOIN 7800
#define TASK_SHOT 7900

// Слева направо: рабочая, сломанная, сломанная, рабочая. Чередование нарочное —
// по одному кадру не отличить «эта плохая» от «не видно ничего».
new const ROW[][32] = { "zm_hot_doctor", "zm_hot_paladin", "zm_hot_z_shaman", "zm_hot_spec" }

new g_watcher = 0
new bool:g_done = false

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)
    register_message(get_user_msgid("VGUIMenu"), "msg_no_panel")
    register_message(get_user_msgid("MOTD"), "msg_no_panel")
}

public msg_no_panel(msgid, dest, id) return PLUGIN_HANDLED;

public plugin_precache()
{
    for (new i = 0; i < sizeof ROW; i++)
    {
        new p[80]
        formatex(p, charsmax(p), "models/player/%s/%s.mdl", ROW[i], ROW[i])
        if (file_exists(p)) precache_model(p)
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

    if (g_done) return;
    g_done = true
    g_watcher = id

    server_cmd("sv_cheats 1; bot_kick")

    static Float:base[3], Float:ang[3], Float:fwd[3], Float:right[3], Float:pos[3]
    pev(id, pev_origin, base)
    pev(id, pev_v_angle, ang)
    ang[0] = 0.0
    ang[2] = 0.0
    angle_vector(ang, ANGLEVECTOR_FORWARD, fwd)
    angle_vector(ang, ANGLEVECTOR_RIGHT, right)

    for (new i = 0; i < sizeof ROW; i++)
    {
        new p[80]
        formatex(p, charsmax(p), "models/player/%s/%s.mdl", ROW[i], ROW[i])
        if (!file_exists(p)) continue;

        new ent = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, "info_target"))
        if (!pev_valid(ent)) continue;

        engfunc(EngFunc_SetModel, ent, p)
        set_pev(ent, pev_movetype, MOVETYPE_NONE)
        set_pev(ent, pev_solid, SOLID_NOT)
        // Анимация — «стойка», она есть у всех: с нулевой у части моделей стоит
        // двухкадровая заглушка, спрятанная ниже пола.
        set_pev(ent, pev_sequence, 1)
        set_pev(ent, pev_framerate, 1.0)
        set_pev(ent, pev_body, 0)

        // Ряд поперёк взгляда, на 200 единиц впереди, шаг 70.
        pos[0] = base[0] + fwd[0] * 200.0 + right[0] * (i - 1.5) * 70.0
        pos[1] = base[1] + fwd[1] * 200.0 + right[1] * (i - 1.5) * 70.0
        pos[2] = base[2]
        engfunc(EngFunc_SetOrigin, ent, pos)

        static Float:face[3]
        face[0] = 0.0
        face[1] = ang[1] + 180.0
        face[2] = 0.0
        set_pev(ent, pev_angles, face)

        log_to_file("zp_actions.log", "ПРЕДМЕТ: поставили «%s» слева направо №%d", ROW[i], i)
    }

    set_pev(id, pev_flags, pev(id, pev_flags) | FL_FROZEN)
    set_task(2.5, "shot", TASK_SHOT)
}

public shot(task)
{
    if (!is_user_connected(g_watcher)) return;
    client_cmd(g_watcher, "snapshot")
    log_to_file("zp_actions.log", "ПРЕДМЕТ: кадр снят")
}
