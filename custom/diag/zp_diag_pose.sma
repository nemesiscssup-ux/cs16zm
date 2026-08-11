/*
 * ВРЕМЕННЫЙ ИЗМЕРИТЕЛЬ. В сборку не попадает: assemble берёт только
 * custom/plugins, а этот файл лежит в custom/diag.
 *
 * ЗАЧЕМ. «Модель не видно» — жалоба про КАРТИНКУ, а сервер картинки не видит.
 * Единственный оракул тут — сам клиент, но окно игры нельзя отбирать у
 * человека за машиной: панели VGUI без фокуса не закрываются, мышью водить
 * нечем, и даже строчку в консоль не напечатать. Поэтому кадр строит СЕРВЕР,
 * а от человека не требуется ничего:
 *
 *   1. вошедшего админа заводим в игру сами — через ReAPI, мимо панелей;
 *   2. ставим бота вплотную перед ним и замораживаем;
 *   3. надеваем на бота очередную модель из списка;
 *   4. разворачиваем взгляд админа на бота (pev_fixangle клиент слушается
 *      и без фокуса);
 *   5. просим клиент снять кадр — client_cmd тоже работает без фокуса,
 *      снимок ложится в Half-Life/cstrike/<карта>NNNN.bmp.
 *
 * Модель читаем ОБРАТНО с бота, а не рапортуем о намерении: мод может
 * откатить подмену, и разницу видно только так.
 *
 * Порядок кадров пишется в logs/zp_actions.log — по нему потом понятно,
 * какой номер снимка какой модели соответствует.
 */

#include <amxmodx>
#include <amxmisc>
#include <cstrike>
#include <engine>
#include <fakemeta>
#include <hamsandwich>
#include <reapi>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Измеритель: показать модель"
#define VERSION "1.1"
#define AUTHOR "cs16zm"

#define TASK_JOIN 7000
#define TASK_STEP 7100
#define TASK_SHOT 7200

// Что проверяем и в каком порядке. Список нарочно смешанный: рядом с
// подозреваемыми стоят заведомо рабочие — иначе по одному кадру не отличить
// «эта модель плохая» от «не рисуется вообще ничего своего».
new const CHECK[][32] = {
    "zm_hot_hero",       // ОПОРА: раздача его отдаёт (200), у клиента он есть
    "zm_hot_leto",       // раздача отвечает 404, у клиента файл убран
    "zm_hot_sporty",     // то же
    "zm_hot_zima",       // 404 у раздачи, но файл у клиента лежит
}

new g_step = -1
new g_watcher = 0
new g_bot = 0
new cvar_auto

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    // Прогон сам по себе: снять кадры некому, если ждать команды из консоли.
    cvar_auto = register_cvar("zp_pose_auto", "1")

    register_concmd("zp_pose", "cmd_pose", ADMIN_LEVEL_A, "<модель> — надеть на бота и снять кадр")
    register_concmd("zp_pose_go", "cmd_go", ADMIN_LEVEL_A, "прогнать весь список заново")

    // ⚠️ Панели VGUI («SELECT TEAM», брифинг карты) рисует КЛИЕНТ, и без
    // фокуса окна их не закрыть ничем. Зато открывает их сервер сообщением
    // VGUIMenu — вот его и глушим: панель просто не появится, и кадр будет
    // чистым. Текст брифинга клиент читает из СВОЕГО maps/<карта>.txt, поэтому
    // опустошать файл на сервере бесполезно — проверено.
    // ShowMenu НЕ трогаем: им рисуются наши собственные меню, а их-то и надо
    // увидеть на кадре.
    register_message(get_user_msgid("VGUIMenu"), "msg_no_panel")
}

public msg_no_panel(msgid, dest, id)
{
    return PLUGIN_HANDLED;
}

// Модель прекешить надо ДО начала карты, иначе движок роняет сервер.
public plugin_precache()
{
    for (new i = 0; i < sizeof CHECK; i++)
    {
        new path[80]
        formatex(path, charsmax(path), "models/player/%s/%s.mdl", CHECK[i], CHECK[i])
        if (file_exists(path)) precache_model(path)
    }
}

bool:model_exists(const model[])
{
    new path[80]
    formatex(path, charsmax(path), "models/player/%s/%s.mdl", model, model)
    return bool:file_exists(path);
}

// Человека в игру заводим сами: панели «SELECT TEAM» и «CHOOSE A CLASS» без
// фокуса окна не закрываются ничем.
//
// ⚠️ engclient_cmd(id, "jointeam") тут НЕ ГОДИТСЯ: мод вешает свой обработчик
// на "jointeam" и "chooseteam" и команду съедает. Заходим мимо консоли вовсе —
// ставим команду напрямую и просим у игрового модуля возрождение.
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
        log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: заводим наблюдателя в игру")

        // Наблюдение снимаем руками: cs_set_user_team само по себе оставляет
        // игрока в режиме зрителя, и возрождение до него не доходит.
        set_pev(id, pev_iuser1, 0)
        set_pev(id, pev_iuser2, 0)

        // ⚠️ Ни cs_set_user_team, ни zp_respawn_user не помогают, пока игровой
        // модуль считает, что игрок ещё ВЫБИРАЕТ команду: у него своё поле
        // m_iJoiningState, и возрождение из этого состояния он отбрасывает.
        // Переводим состояние напрямую через ReAPI, тогда возрождение проходит.
        rg_join_team(id, TEAM_CT)
        set_member(id, m_iJoiningState, JOINED)
        rg_set_user_team(id, TEAM_CT, MODEL_CT_URBAN)
        rg_round_respawn(id)

        set_task(3.0, "force_join", id + TASK_JOIN)
        return;
    }

    if (!get_pcvar_num(cvar_auto) || g_step >= 0) return;

    g_watcher = id
    g_step = 0
    log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: наблюдатель в игре, начинаем прогон из %d моделей", sizeof CHECK)
    set_task(3.0, "next_step", TASK_STEP)
}

public cmd_go(id, level, cid)
{
    if (!cmd_access(id, level, cid, 1)) return PLUGIN_HANDLED;
    g_watcher = id
    g_step = 0
    remove_task(TASK_STEP)
    set_task(0.5, "next_step", TASK_STEP)
    return PLUGIN_HANDLED;
}

public cmd_pose(id, level, cid)
{
    if (!cmd_access(id, level, cid, 2)) return PLUGIN_HANDLED;
    new model[32]
    read_argv(1, model, charsmax(model))
    g_watcher = id
    pose(model)
    return PLUGIN_HANDLED;
}

// Живой бот, не сам наблюдатель. Боты удобны тем, что не жалуются на
// заморозку и стоят там, куда их поставили.
find_bot()
{
    new players[32], num
    get_players(players, num, "a")   // живые; ботов отбираем сами
    for (new i = 0; i < num; i++)
    {
        if (players[i] == g_watcher) continue;
        if (!is_user_bot(players[i])) continue;
        return players[i];
    }
    return 0;
}

// Второй прогон — то, что делает сам игрок: надевает скин и жмёт «Посмотреть
// на себя». Свою модель в CS не видно никогда, кроме вида со стороны, и
// жалоба «нету модели» могла родиться именно здесь.
new const SELF[][32] = {
    "zm_hot_leto",
    "zm_hot_sporty",
    "zm_hot_zima",
}
new g_self = -1

public next_step(task)
{
    if (g_step >= 0 && g_step < sizeof CHECK)
    {
        new model[32]
        copy(model, charsmax(model), CHECK[g_step])
        g_step++
        pose(model)
        set_task(4.0, "next_step", TASK_STEP)
        return;
    }

    // Список чужих моделей кончился — переходим к виду на себя.
    if (g_self < 0)
    {
        g_self = 0
        log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: теперь смотрим на СЕБЯ")
    }

    if (g_self >= sizeof SELF)
    {
        set_view(g_watcher, CAMERA_NONE)

        // Последними — снимки самих меню: жалоба «нету модели» дословно
        // совпадает с подписью, которой меню помечает скин без файла, и надо
        // увидеть, что там на самом деле написано.
        set_task(1.0, "shot_menu_skins", TASK_SHOT + 1)
        set_task(3.0, "shot_menu_shop", TASK_SHOT + 2)
        set_task(5.5, "done_run", TASK_SHOT + 3)
        return;
    }

    new model[32]
    copy(model, charsmax(model), SELF[g_self])
    g_self++
    pose_self(model)
    set_task(4.0, "next_step", TASK_STEP)
}

public shot_menu_skins(task)
{
    if (!is_user_connected(g_watcher)) return;
    client_cmd(g_watcher, "zp_skin")
    log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: открыли меню скинов")
    set_task(1.2, "just_shot", TASK_SHOT + 4)
}

public shot_menu_shop(task)
{
    if (!is_user_connected(g_watcher)) return;
    client_cmd(g_watcher, "zp_skin_shop")
    log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: открыли магазин скинов")
    set_task(1.2, "just_shot", TASK_SHOT + 5)
}

public just_shot(task)
{
    if (is_user_connected(g_watcher)) client_cmd(g_watcher, "snapshot")
}

public done_run(task)
{
    log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: прогон закончен")
    g_step = -1
}

pose_self(const model[])
{
    if (!is_user_alive(g_watcher))
    {
        log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: наблюдатель мёртв, свой кадр «%s» пропущен", model)
        return;
    }

    zp_override_user_model(g_watcher, model, 0)
    set_view(g_watcher, CAMERA_3RDPERSON)
    g_bot = g_watcher

    log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: на СЕБЯ «%s», вид со стороны", model)

    remove_task(TASK_SHOT)
    set_task(1.5, "take_shot", TASK_SHOT)
}

pose(const model[])
{
    if (!is_user_alive(g_watcher))
    {
        log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: наблюдатель мёртв, кадр «%s» пропущен", model)
        return;
    }
    if (!model_exists(model))
    {
        log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: нет файла для «%s»", model)
        return;
    }

    new bot = find_bot()
    if (!bot)
    {
        log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: живых ботов нет, кадр «%s» пропущен", model)
        return;
    }
    g_bot = bot

    // Ставим бота на 110 единиц перед наблюдателем, на его же высоте.
    static Float:eye[3], Float:ang[3], Float:fwd[3], Float:pos[3]
    pev(g_watcher, pev_origin, eye)
    pev(g_watcher, pev_v_angle, ang)
    ang[0] = 0.0                     // только курс: иначе бот уедет в пол или в потолок
    ang[2] = 0.0
    angle_vector(ang, ANGLEVECTOR_FORWARD, fwd)

    pos[0] = eye[0] + fwd[0] * 110.0
    pos[1] = eye[1] + fwd[1] * 110.0
    pos[2] = eye[2]

    engfunc(EngFunc_SetOrigin, bot, pos)
    set_pev(bot, pev_flags, pev(bot, pev_flags) | FL_FROZEN)

    // Бот должен смотреть на нас, а не спиной.
    static Float:back[3]
    back[0] = 0.0
    back[1] = ang[1] + 180.0
    back[2] = 0.0
    set_pev(bot, pev_angles, back)

    zp_override_user_model(bot, model, 0)

    look_at(g_watcher, pos)

    log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: ставим «%s»", model)

    remove_task(TASK_SHOT)
    set_task(1.5, "take_shot", TASK_SHOT)
}

// Разворачиваем взгляд наблюдателя на точку. pev_fixangle = 1 клиент
// слушается и без фокуса окна — иначе камерой со стороны сервера не повертеть.
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
    dir[2] = pos[2] + 36.0 - eye[2]   // целимся в грудь, а не в ноги

    vector_to_angle(dir, ang)
    set_pev(id, pev_angles, ang)
    set_pev(id, pev_v_angle, ang)
    set_pev(id, pev_fixangle, 1)
}

// Снимок и сразу — что на боте оказалось на самом деле.
public take_shot(task)
{
    if (!is_user_connected(g_watcher)) return;
    client_cmd(g_watcher, "snapshot")

    if (!is_user_connected(g_bot)) return;

    new now[64], who[32]
    cs_get_user_model(g_bot, now, charsmax(now))
    get_user_name(g_bot, who, charsmax(who))
    log_to_file("zp_actions.log", "ИЗМЕРИТЕЛЬ: кадр снят, на %s стоит «%s»", who, now)
}
