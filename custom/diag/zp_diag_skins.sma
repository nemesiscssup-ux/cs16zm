/*
 * ВРЕМЕННЫЙ ИЗМЕРИТЕЛЬ. В сборку не попадает: assemble берёт только
 * custom/plugins, а этот файл лежит в custom/diag.
 *
 * ЗАЧЕМ. Владелец: «все новые скины не показывают модель от третьего лица, и
 * некоторые классы зомби тоже». Сервер картинки не видит, поэтому кадр строит
 * он сам, а смотрит — клиент. Прогоняем ПОДРЯД все скины магазина и все модели
 * классов зомби НА СЕБЕ, с видом со стороны — ровно то, что делает игрок
 * пунктом «Посмотреть на себя».
 *
 * Кадры кладутся в Half-Life/cstrike/<карта>NNNN.bmp по порядку, порядок
 * пишется в logs/zp_actions.log. Модель читаем ОБРАТНО с игрока: мод может
 * откатить подмену, и разницу видно только так.
 *
 * ⚠️ Кадры прошлого прогона вышли тёмными и неразборчивыми. Поэтому игрока
 * ставим в известную открытую точку карты и просим клиент включить
 * r_fullbright — иначе «модель не видно» и «в углу темно» неотличимы.
 */

#include <amxmodx>
#include <amxmisc>
#include <cstrike>
#include <engine>
#include <fakemeta>
#include <hamsandwich>
#include <reapi>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Измеритель: скины на себе"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

#define TASK_JOIN 7300
#define TASK_STEP 7400
#define TASK_SHOT 7500

// Порядок нарочно смешанный: сначала заведомо рабочий скин привилегии, потом
// новые из магазина, потом классы зомби. По одному кадру не отличить «эта
// модель плохая» от «не рисуется вообще ничего» — нужна опора.
new const LIST[][32] = {
    "zm_hot_spec",        // опора: привилегия, показывался раньше
    // Разбор по шагам: одна и та же донорская модель «Паладин» в четырёх видах.
    // t0 — сырая копия, t1 — только новое имя, t2 — только затёртые метки,
    // t3 — полный перенос. Что из этого перестаёт рисоваться, то и ломает.
    "zm_hot_t0",
    "zm_hot_t1",
    "zm_hot_t2",
    "zm_hot_t3",
    "zm_hot_monolit",     // опора
    // магазин
    "zm_hot_leto",
    "zm_hot_hero",
    "zm_hot_sporty",
    "zm_hot_zima",
    "zm_hot_doctor",
    "zm_hot_frak",
    "zm_hot_zvezda",
    "zm_hot_zmeya",
    "zm_hot_mask",
    "zm_hot_paladin",
    "zm_hot_knight",
    // классы зомби
    "zombie_source_v44",
    "zm_hot_z_zaraza",
    "zm_hot_z_shaman",
    "zm_hot_z_heavy",
    "zm_hot_z_witch",
    "zm_hot_z_electric",
    "zm_hot_z_student",
    "zm_hot_z_sprinter",
    "zm_hot_z_siren",
    "zm_hot_z_deimos",
    "zm_hot_z_revfire",
    "zm_hot_z_revice",
    "zm_hot_z_revpoison",
}

new g_index[sizeof LIST]
new g_step = -1
new g_watcher = 0
new g_shot = 0

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    register_concmd("zp_skins_go", "cmd_go", ADMIN_LEVEL_A, "прогнать весь список заново")

    // Панели VGUI рисует клиент, и без фокуса окна их не закрыть ничем. Зато
    // открывает их сервер — вот его сообщения и глушим.
    register_message(get_user_msgid("VGUIMenu"), "msg_no_panel")
    register_message(get_user_msgid("MOTD"), "msg_no_panel")
}

public msg_no_panel(msgid, dest, id) return PLUGIN_HANDLED;

// Модели прекешим до начала карты: иначе движок роняет сервер. Индекс
// запоминаем и передаём в мод ровно так же, как это делает боевой zp_skins.
public plugin_precache()
{
    for (new i = 0; i < sizeof LIST; i++)
    {
        new path[80]
        formatex(path, charsmax(path), "models/player/%s/%s.mdl", LIST[i], LIST[i])
        if (file_exists(path)) g_index[i] = precache_model(path)
        else g_index[i] = 0
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

    // ⚠️ Первый прогон утонул в шуме: боты расстреливали наблюдателя, а он сам
    // стоял в тёмном углу. Поднимаем в воздух на фоне неба, делаем бессмертным
    // и держим угол постоянным — иначе «модель не видно» и «камера смотрит в
    // стену» неотличимы.
    server_cmd("sv_cheats 1; bot_kick")
    client_cmd(id, "r_fullbright 1; brightness 2; hud_draw 0")
    lift(id)
    set_view(id, CAMERA_3RDPERSON)

    log_to_file("zp_actions.log", "СКИНЫ: наблюдатель в игре, прогон из %d моделей", sizeof LIST)

    // ⚠️ Ночное небо со звёздами делает тёмную модель неотличимой от пустоты, и
    // по кадрам легко решить неверно. Поэтому первым делом снимаем ФОН — тот же
    // кадр, но с невидимым игроком. Дальше каждый кадр сравнивается с фоном
    // попиксельно, и «нарисовалась ли модель» перестаёт быть делом глазомера.
    set_pev(id, pev_effects, pev(id, pev_effects) | EF_NODRAW)
    set_task(2.0, "shot_background", TASK_STEP + 9)
}

public shot_background(task)
{
    if (!is_user_connected(g_watcher)) return;
    client_cmd(g_watcher, "snapshot")
    log_to_file("zp_actions.log", "СКИНЫ: кадр %d = ФОН без модели", g_shot)
    g_shot++
    set_task(2.0, "unhide_and_start", TASK_STEP + 10)
}

public unhide_and_start(task)
{
    if (!is_user_connected(g_watcher)) return;
    set_pev(g_watcher, pev_effects, pev(g_watcher, pev_effects) & ~EF_NODRAW)
    set_task(1.0, "next_step", TASK_STEP)
}

// Точка съёмки: один раз запоминаем место в воздухе и на каждом шаге ставим
// туда же. Иначе игрока сносит, и кадры нельзя класть рядом.
new Float:g_spot[3]
new bool:g_spot_set = false

lift(id)
{
    if (!g_spot_set)
    {
        pev(id, pev_origin, g_spot)
        g_spot[2] += 8.0
        g_spot_set = true
    }
    set_pev(id, pev_movetype, MOVETYPE_NOCLIP)
    set_pev(id, pev_takedamage, DAMAGE_NO)
    engfunc(EngFunc_SetOrigin, id, g_spot)
    set_pev(id, pev_velocity, Float:{0.0, 0.0, 0.0})

    // ⚠️ Небо в сборке своё, со звёздами, и оно ДВИЖЕТСЯ: кадр на его фоне
    // отличается от фона целиком, и сравнение с фоном перестаёт работать.
    // Поэтому смотрим вниз — под ногами неподвижная земля.
    static Float:ang[3]
    ang[0] = 32.0
    ang[1] = 90.0
    ang[2] = 0.0
    set_pev(id, pev_angles, ang)
    set_pev(id, pev_v_angle, ang)
    set_pev(id, pev_fixangle, 1)
}

public cmd_go(id, level, cid)
{
    if (!cmd_access(id, level, cid, 1)) return PLUGIN_HANDLED;
    g_watcher = id
    g_step = 0
    g_shot = 0
    set_view(id, CAMERA_3RDPERSON)
    remove_task(TASK_STEP)
    set_task(0.5, "next_step", TASK_STEP)
    return PLUGIN_HANDLED;
}

public next_step(task)
{
    if (g_step < 0 || g_step >= sizeof LIST)
    {
        set_view(g_watcher, CAMERA_NONE)
        log_to_file("zp_actions.log", "СКИНЫ: прогон закончен, кадров %d", g_shot)
        g_step = -1
        return;
    }

    if (!is_user_alive(g_watcher))
    {
        log_to_file("zp_actions.log", "СКИНЫ: наблюдатель мёртв, ждём")
        set_task(2.0, "next_step", TASK_STEP)
        return;
    }

    new i = g_step
    g_step++

    new path[80]
    formatex(path, charsmax(path), "models/player/%s/%s.mdl", LIST[i], LIST[i])
    if (!file_exists(path))
    {
        log_to_file("zp_actions.log", "СКИНЫ: №%d «%s» — НЕТ ФАЙЛА НА СЕРВЕРЕ, кадр пропущен", i, LIST[i])
        set_task(0.2, "next_step", TASK_STEP)
        return;
    }

    // Ровно как в боевом плагине: с номером предзагрузки.
    zp_override_user_model(g_watcher, LIST[i], g_index[i])
    lift(g_watcher)

    // ⚠️ Владелец: «модель полупрозрачная при осмотре». На кадрах так и есть —
    // сквозь тело видно доски. При этом сервер говорит, что рисование обычное.
    // Пробуем задавить это в лоб: нечётные шаги — как есть, чётные — с
    // принудительно плотной отрисовкой. Разница между соседними кадрами и
    // покажет, слушается ли клиент.
    if (i % 2 == 0) set_user_rendering(g_watcher, kRenderFxNone, 0, 0, 0, kRenderNormal, 255)
    else set_user_rendering(g_watcher, kRenderFxNone, 0, 0, 0, kRenderNormal, 16)

    set_view(g_watcher, CAMERA_3RDPERSON)

    log_to_file("zp_actions.log", "СКИНЫ: кадр %d = №%d «%s» (индекс %d)", g_shot, i, LIST[i], g_index[i])

    remove_task(TASK_SHOT)
    set_task(1.6, "take_shot", TASK_SHOT)
    set_task(2.6, "next_step", TASK_STEP)
}

public take_shot(task)
{
    if (!is_user_connected(g_watcher)) return;

    new now[64]
    cs_get_user_model(g_watcher, now, charsmax(now))

    // ⚠️ Клиент грузит ВСЕ модели без ошибок, но часть не рисует на живом
    // игроке. Значит дело не в файле, а в том, что стоит на самом игроке в этот
    // миг: номер анимации, кадр, часть тела, прозрачность, масштаб. Пишем всё.
    new Float:scale, Float:framerate, Float:amt
    pev(g_watcher, pev_scale, scale)
    pev(g_watcher, pev_framerate, framerate)
    pev(g_watcher, pev_renderamt, amt)
    log_to_file("zp_actions.log",
        "СКИНЫ:   «%s» анимация %d (ход %d) кадр %.0f тело %d режим %d/%.0f эффект-рис %d масштаб %.2f темп %.2f эффекты %d",
        now, pev(g_watcher, pev_sequence), pev(g_watcher, pev_gaitsequence),
        float(pev(g_watcher, pev_frame)), pev(g_watcher, pev_body),
        pev(g_watcher, pev_rendermode), amt, pev(g_watcher, pev_renderfx),
        scale, framerate, pev(g_watcher, pev_effects))

    client_cmd(g_watcher, "snapshot")
    g_shot++
}
