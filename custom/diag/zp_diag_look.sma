/*
 * ВРЕМЕННЫЙ ИЗМЕРИТЕЛЬ №2. В сборку не попадает: assemble берёт только
 * custom/plugins.
 *
 * Проверяет глазами две правки, которые иначе принимать нечем:
 *   1) новую лапу Толстяка — надевает класс, заражает наблюдателя и снимает
 *      кадр от первого лица;
 *   2) новый взрыв гранаты отброса — ловит момент взрыва ЧУЖОЙ гранаты
 *      (боты кидают их сами), разворачивает наблюдателя на неё и снимает.
 *
 * Как и первый измеритель, ничего не требует от человека за машиной: панели
 * VGUI глушим, в игру заводим сами, снимок просит сервер командой snapshot.
 */

#include <amxmodx>
#include <amxmisc>
#include <cstrike>
#include <engine>
#include <fakemeta>
#include <fun>
#include <hamsandwich>
#include <reapi>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Измеритель: лапа и взрыв"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

#define TASK_JOIN 7300
#define TASK_STEP 7400
#define TASK_SHOT 7500
#define TASK_WATCH 7600

#define CLASS_HEAVY 3            // «Толстяк» — четвёртый в списке классов

new g_watcher = 0
new g_stage = 0
new g_blasts = 0
new Float:g_last_blast
new bool:g_pressing = false

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)
    // Панели, закрывающие обзор: VGUIMenu — выбор команды и брифинг карты,
    // MOTD — окно приветствия мода. Без фокуса окна их не закрыть ничем,
    // поэтому просто не даём серверу их открыть.
    register_message(get_user_msgid("VGUIMenu"), "msg_no_panel")
    register_message(get_user_msgid("MOTD"), "msg_no_panel")
    register_forward(FM_PlayerPreThink, "fw_prethink")
}

public msg_no_panel(msgid, dest, id)
{
    return PLUGIN_HANDLED;
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
        rg_join_team(id, TEAM_CT)
        set_member(id, m_iJoiningState, JOINED)
        rg_set_user_team(id, TEAM_CT, MODEL_CT_URBAN)
        rg_round_respawn(id)
        set_task(3.0, "force_join", id + TASK_JOIN)
        return;
    }

    if (g_stage) return;
    g_watcher = id
    g_stage = 1
    log_to_file("zp_actions.log", "ЛАПА-ИЗМ: наблюдатель в игре")
    set_task(2.0, "step", TASK_STEP)
}

public step(task)
{
    if (!is_user_connected(g_watcher)) return;

    if (g_stage == 1)
    {
        // Класс ставим ДО заражения: лапу мод выдаёт по классу в момент
        // превращения, а не по текущему выбору.
        // ⚠️ Номер класса — НЕ его место в конфиге: порядок в меню задаёт
        // CLASS_ORDER в assemble.mjs, и «третий» оказался Ведьмой. Ищем по
        // имени, тогда правка порядка измеритель не ломает.
        new want = CLASS_HEAVY
        for (new c = 0; c < zp_get_zombie_class_count(); c++)
        {
            new nm[32]
            zp_get_zombie_class_name(c, nm, charsmax(nm))
            if (equal(nm, "Толстяк")) { want = c; break; }
        }
        zp_set_user_zombie_class(g_watcher, want)
        zp_infect_user(g_watcher, g_watcher, 1, 1)
        log_to_file("zp_actions.log", "ЛАПА-ИЗМ: наблюдатель — Толстяк, ждём лапу")
        g_stage = 2
        set_task(2.5, "step", TASK_STEP)
        return;
    }

    if (g_stage == 2)
    {
        // Нож в руки: лапа — это модель ножа, с гранатой её не увидеть.
        engclient_cmd(g_watcher, "weapon_knife")
        g_stage = 3
        set_task(1.5, "step", TASK_STEP)
        return;
    }

    if (g_stage == 3)
    {
        new vm[64]
        pev(g_watcher, pev_viewmodel2, vm, charsmax(vm))
        log_to_file("zp_actions.log", "ЛАПА-ИЗМ: в руках «%s» — снимаем", vm)
        client_cmd(g_watcher, "snapshot")

        // Дальше — взрыв. Ждать чужой гранаты бессмысленно: с прошлой правки
        // их выдают по одной за заражение, и за минуту может не прилететь ни
        // одной. Бросаем сами.
        g_stage = 4
        set_task(0.2, "watch_blast", TASK_WATCH, _, _, "b")
        set_task(1.0, "throw", TASK_STEP + 1)
        return;
    }
}

// Бросок: гранату в руки, нажать и отпустить. Отпускание и есть бросок.
public throw(task)
{
    if (!is_user_alive(g_watcher) || g_blasts >= 3) return;

    if (!user_has_weapon(g_watcher, CSW_HEGRENADE)) give_item(g_watcher, "weapon_hegrenade")
    engclient_cmd(g_watcher, "weapon_hegrenade")
    set_task(0.6, "throw_press", TASK_STEP + 2)
}

// ⚠️ engclient_cmd(id, "+attack") для ЖИВОГО игрока не работает: состояние
// кнопок приходит с его машины в каждом пакете движения, а не выполняется как
// консольная команда. Нажимаем со стороны сервера — дописываем бит в pev_button
// на каждом кадре, пока держим.
public throw_press(task)
{
    if (!is_user_alive(g_watcher)) return;
    g_pressing = true
    set_task(0.5, "throw_release", TASK_STEP + 3)
}

public throw_release(task)
{
    g_pressing = false
    if (!is_user_alive(g_watcher)) return;
    log_to_file("zp_actions.log", "ЛАПА-ИЗМ: гранату бросили")
    // Следующий бросок — после того, как этот отгремит.
    set_task(6.0, "throw", TASK_STEP + 1)
}

public fw_prethink(id)
{
    if (!g_pressing || id != g_watcher) return FMRES_IGNORED;
    set_pev(id, pev_button, pev(id, pev_button) | IN_ATTACK)
    return FMRES_IGNORED;
}

// Ловим гранату за мгновение до взрыва. Свой обработчик Ham_Think здесь не
// годится: плагин гранат отвечает HAM_SUPERCEDE и удаляет сущность, а чей
// обработчик отработает первым — вопрос порядка загрузки. Опрос надёжнее.
public watch_blast(task)
{
    if (!is_user_alive(g_watcher) || g_blasts >= 3) return;

    new ent = -1
    while ((ent = find_ent_by_class(ent, "grenade")) > 0)
    {
        if (!pev_valid(ent)) continue;

        new owner = pev(ent, pev_owner)
        if (!is_user_connected(owner) || !zp_get_user_zombie(owner)) continue;

        static Float:dmgtime
        pev(ent, pev_dmgtime, dmgtime)
        new Float:now = get_gametime()
        // ⚠️ dmgtime = 0 бывает у сущностей, которые ещё не стали летящей
        // гранатой. Без этой проверки сторож срабатывал на пустом месте, и
        // все кадры выходили без взрыва.
        if (dmgtime <= 0.0) continue;
        if (dmgtime > now + 0.20) continue;          // ещё летит
        if (now - g_last_blast < 3.0) continue;      // этот уже снимали

        static Float:org[3]
        pev(ent, pev_origin, org)

        // Ставим наблюдателя в 220 единицах от эпицентра и разворачиваем на
        // него: иначе взрыв случится за спиной и кадр будет пустым.
        static Float:pos[3]
        pos[0] = org[0] + 220.0
        pos[1] = org[1]
        pos[2] = org[2] + 40.0
        engfunc(EngFunc_SetOrigin, g_watcher, pos)
        look_at(g_watcher, org)

        g_last_blast = now
        g_blasts++
        log_to_file("zp_actions.log", "ЛАПА-ИЗМ: взрыв через миг, кадр %d", g_blasts)
        set_task(dmgtime - now + 0.10, "take_shot", TASK_SHOT)
        return;
    }
}

look_at(id, const Float:pos[3])
{
    static Float:eye[3], Float:ofs[3], Float:dir[3], Float:ang[3]
    pev(id, pev_origin, eye)
    pev(id, pev_view_ofs, ofs)
    eye[0] += ofs[0]
    eye[1] += ofs[1]
    eye[2] += ofs[2]

    dir[0] = pos[0] - eye[0]
    dir[1] = pos[1] - eye[1]
    dir[2] = pos[2] + 20.0 - eye[2]

    vector_to_angle(dir, ang)
    set_pev(id, pev_angles, ang)
    set_pev(id, pev_v_angle, ang)
    set_pev(id, pev_fixangle, 1)
}

public take_shot(task)
{
    if (is_user_connected(g_watcher)) client_cmd(g_watcher, "snapshot")
    if (g_blasts >= 3) log_to_file("zp_actions.log", "ЛАПА-ИЗМ: прогон закончен")
}
