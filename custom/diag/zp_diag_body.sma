/*
 * ВРЕМЕННЫЙ ИЗМЕРИТЕЛЬ. Пишет в журнал каждое изменение pev_body у игрока.
 *
 * Зачем. Модель лапы Толстяка (v_heavyz_pak3.mdl) везёт в себе ЧЕТЫРЕ подмодели:
 * лапу, китайскую саблю, кувалду «джаггернаут» и руку Санты. Какая видна,
 * решает pev_body игрока: движок отправляет его вместе с анимацией оружия в
 * SVC_WEAPONANIM. Владелец видит после гранаты сначала кувалду, потом топор —
 * это подмодели 2 и 1. Кто ставит body, по исходникам не видно: ни один наш
 * плагин игроку его не пишет. Значит пишет игровая библиотека, и узнать это
 * можно только с живого сервера.
 *
 * Удалить после разбора.
 */

#include <amxmodx>
#include <amxmisc>
#include <engine>
#include <fakemeta>
#include <zombie_plague_v44>

new g_last[33]
new g_lastvm[33][64]

public plugin_init()
{
    register_plugin("[ZP] Измеритель body", "1.0", "cs16zm")
    set_task(0.1, "tick", 0, _, _, "b")

    // Смотреть на класс приходится глазами, а единственные глаза — настоящий
    // клиент. Гонять его мышью нельзя: окно игры может быть за чужим окном, и
    // отъём фокуса ломает работу человеку за машиной. Поэтому просим клиент
    // сам: снимок, вид от третьего лица, вход в команду.
    register_concmd("zp_diag_snap", "cmd_snap", ADMIN_LEVEL_A, "<ник> — снимок экрана на клиенте")
    register_concmd("zp_diag_view", "cmd_view", ADMIN_LEVEL_A, "<ник> <0|1> — вид от первого/третьего лица")
    register_concmd("zp_diag_join", "cmd_join", ADMIN_LEVEL_A, "<ник> — войти в игру")
    register_concmd("zp_diag_cc", "cmd_cc", ADMIN_LEVEL_A, "<ник> <команда> — команда на клиент")
}

target_of(id, argn)
{
    new who[32]
    read_argv(argn, who, charsmax(who))
    return cmd_target(id, who, CMDTARGET_ALLOW_SELF);
}

// Окно приветствия и меню закрывают собой полкадра, поэтому сначала гасим их,
// и только потом снимаем — иначе на снимке видно панель, а не игру.
public cmd_snap(id, level, cid)
{
    if (!cmd_access(id, level, cid, 2)) return PLUGIN_HANDLED;
    new t = target_of(id, 1)
    if (!t) return PLUGIN_HANDLED;
    client_cmd(t, "cancelselect; slot10; escape")
    set_task(0.8, "do_snap", t)
    return PLUGIN_HANDLED;
}

public do_snap(t)
{
    if (is_user_connected(t)) client_cmd(t, "snapshot")
}

public cmd_view(id, level, cid)
{
    if (!cmd_access(id, level, cid, 3)) return PLUGIN_HANDLED;
    new t = target_of(id, 1)
    new mode[4]
    read_argv(2, mode, charsmax(mode))
    if (t) client_cmd(t, mode[0] == '1' ? "thirdperson" : "firstperson")
    return PLUGIN_HANDLED;
}

// Панель «CHOOSE A CLASS» не закрывается ни cancelselect, ни клавишей извне:
// у VGUI своя очередь ввода. Закрыть её может только сам клиент — командой
// menuselect. Ради одной команды плодить по обработчику на каждую незачем,
// поэтому здесь общий проводник. Плагин временный и живёт только на локальной
// проверке — в боевую сборку такое класть нельзя.
public cmd_cc(id, level, cid)
{
    if (!cmd_access(id, level, cid, 3)) return PLUGIN_HANDLED;
    new t = target_of(id, 1)
    if (!t) return PLUGIN_HANDLED;
    new line[128]
    read_argv(2, line, charsmax(line))
    client_cmd(t, "%s", line)
    return PLUGIN_HANDLED;
}

public cmd_join(id, level, cid)
{
    if (!cmd_access(id, level, cid, 2)) return PLUGIN_HANDLED;
    new t = target_of(id, 1)
    if (!t) return PLUGIN_HANDLED;
    engclient_cmd(t, "jointeam", "2")
    engclient_cmd(t, "joinclass", "5")
    return PLUGIN_HANDLED;
}

public tick()
{
    new players[32], num
    get_players(players, num, "a")

    for (new i = 0; i < num; i++)
    {
        new id = players[i]
        new body = pev(id, pev_body)
        new vm[64]
        pev(id, pev_viewmodel2, vm, charsmax(vm))

        new bool:body_changed = body != g_last[id]
        new bool:vm_changed = !equal(vm, g_lastvm[id])
        if (!body_changed && !vm_changed) continue;
        g_last[id] = body
        copy(g_lastvm[id], charsmax(g_lastvm[]), vm)

        new name[32]
        get_user_name(id, name, charsmax(name))

        log_to_file("zp_actions.log", "ВИД: %s body %d, вид «%s» (оружие %d, зомби %d)",
            name, body, vm, get_user_weapon(id), zp_get_user_zombie(id))
    }
}

public client_putinserver(id) g_last[id] = 0
