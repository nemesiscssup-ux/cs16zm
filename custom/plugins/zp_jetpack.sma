/*
 * [ZP] Джетпак: покупается в спец-магазине, летает на топливе.
 *
 * Управление: в прыжке зажать ПРОБЕЛ. Топливо тратится, пока летишь, и
 * восстанавливается, пока стоишь на земле. Запас и восстановление видно в HUD
 * отдельной строкой — без неё игрок не понимает, почему полёт вдруг кончился.
 *
 * ⚠️ ПОЛОСКУ РИСУЕТ ЗАДАЧА, А НЕ КАДР ПОЛЁТА. Владелец: «из-за джетпака
 * пропадает остальной худ» — так и было. Крупную надпись (DHUD) клиент НЕ
 * заменяет предыдущей, а ДОБАВЛЯЕТ в список, и живёт их до шестнадцати штук
 * разом. Полоска уходила из PlayerPreThink — сто раз в секунду, — и все
 * шестнадцать мест были заняты ею одной: нижней панели мода, показу урона и
 * отсчёту до заражения места не оставалось вовсе. Теперь надпись выпускает
 * задача, и держится она ровно один шаг задачи: на экране никогда не больше
 * одной. Тем же способом лечился показ урона — там это уже проверено.
 *
 * ПОЧЕМУ СВОЙ, А НЕ ПЕРЕНЕСЁННЫЙ. В CS-DEAD лежит zp_boss_jetpack.sma на 340
 * строк: там ракеты, подбор ранца с земли, выпадение при смерти и своя раздача
 * через натив. Нам из этого нужен только полёт с топливом, а остальное —
 * лишние поверхности, которые пришлось бы чинить вслепую. Модель и звуки взяты
 * оттуда, код свой.
 *
 * ТОЛЬКО ЛЮДЯМ. Зомби и так прыгает выше всех, а Выжившему и Снайперу мод
 * выдаёт свою роль — джетпак сломал бы обе.
 *
 * ДЖЕТПАК — ПРЕДМЕТ, А НЕ СПОСОБНОСТЬ. Его можно бросить (команда zp_jetpack_drop
 * или в чат /джетпак), он выпадает из убитого и лежит на полу, пока его не
 * подберут. Так купленный ранец не пропадает вместе с хозяином: товарищ поднимет
 * и полетит сам, а зомби получит повод дойти до тела. Остаток топлива едет
 * вместе с ранцем — подобравший получает ровно то, что не долетал прежний.
 */

#include <amxmodx>
#include <amxmisc>
#include <dhudmessage>
#include <engine>
#include <fakemeta>
#include <hamsandwich>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Джетпак"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

// Модель на спине — обычная сущность, следующая за игроком, как парашют.
new const MODEL_PACK[] = "models/zm_hot/q_jp_starB.mdl"
new const SOUND_FLY[] = "zm_hot/fly.wav"
new const SOUND_LOW[] = "zm_hot/blow.wav"

// Шаг обновления полоски. Время жизни надписи равно ему же: живи она дольше
// шага — соседние надписи наложились бы, и проценты двоились бы на экране.
const Float:HUD_TICK = 0.2

// Длина звуков, замерена по заголовку wav: fly.wav — 1.13 с, blow.wav — 1.91 с.
// Повторяем чуть раньше конца, чтобы гул шёл сплошняком, но НЕ каждый кадр:
// emit_sound начинает файл заново, и сотня перезапусков в секунду — это уже не
// двигатель, а треск.
const Float:FLY_SND_LEN = 1.0
const Float:LOW_SND_LEN = 1.8

new g_item
new bool:g_has[33]
new Float:g_fuel[33]
new Float:g_snd_at[33]      // когда можно повторить звук двигателя
new g_pack[33]
new bool:g_ready_model, bool:g_ready_fly, bool:g_ready_low

new cvar_enabled, cvar_cost, cvar_fuel, cvar_burn, cvar_regen, cvar_push, cvar_log
new cvar_droplife

// Класс лежащего на полу ранца. Отдельный от надетого («zm_hot_jetpack»):
// касание надетого игроками происходит постоянно, и путать их нельзя.
new const PICKUP_CLASS[] = "zm_hot_jetpack_drop"

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    cvar_enabled = register_cvar("zp_jetpack", "1")
    cvar_cost    = register_cvar("zp_jetpack_cost", "45")     // цена в кредитах
    cvar_fuel    = register_cvar("zp_jetpack_fuel", "100")    // полный бак
    cvar_burn    = register_cvar("zp_jetpack_burn", "1.2")    // расход за кадр полёта
    cvar_regen   = register_cvar("zp_jetpack_regen", "12.0")  // восстановление в секунду на земле
    cvar_push    = register_cvar("zp_jetpack_push", "260")    // сила тяги
    cvar_log     = register_cvar("zp_log_actions", "1")
    // Сколько секунд лежит брошенный ранец. Ноль — до конца раунда. Слишком
    // долго нельзя: к концу карты пол будет усеян чужими покупками.
    cvar_droplife = register_cvar("zp_jetpack_drop_life", "60")

    register_forward(FM_PlayerPreThink, "fw_PreThink")

    // Полоска топлива — по расписанию, а не из кадра полёта. Почему именно так,
    // написано в шапке: иначе она вытесняет с экрана весь остальной HUD.
    set_task(HUD_TICK, "hud_tick", 0, _, _, "b")

    // Бросить ранец. Командой, а не только меню: в бою в меню не полазишь.
    register_clcmd("zp_jetpack_drop", "cmd_drop")
    register_clcmd("say /джетпак", "cmd_drop")
    register_clcmd("say /jetpack", "cmd_drop")
    register_clcmd("say_team /джетпак", "cmd_drop")

    register_touch(PICKUP_CLASS, "player", "fw_pickup_touch")
    register_think(PICKUP_CLASS, "fw_pickup_think")

    RegisterHam(Ham_Killed, "player", "fw_killed_post", 1)
    RegisterHam(Ham_Spawn, "player", "fw_spawn_post", 1)

    // ⚠️ Пометка уровня прямо в названии: в магазине три десятка позиций, и без
    // неё игрок узнаёт об отказе только после нажатия. Сам уровень проверяем в
    // zp_extra_item_selected — отдельным сторожем нельзя: форвард покупки
    // возвращает результат ПОСЛЕДНЕГО плагина, и владелец вещи затёр бы чужой
    // отказ, успев вещь выдать.
    g_item = zp_register_extra_item("Джетпак \r[Лидер]", get_pcvar_num(cvar_cost), ZP_TEAM_HUMAN)
}

public plugin_precache()
{
    // Нет файла — летать всё равно можно, просто без ранца за спиной. Ронять
    // сервер из-за косметики нельзя, а precache на отсутствующий файл делает
    // именно это.
    // bool: явным приведением — file_exists возвращает обычное число, и без
    // него компилятор ругается на несовпадение тегов.
    g_ready_model = bool:file_exists(MODEL_PACK)
    if (g_ready_model) precache_model(MODEL_PACK)

    new path[64]
    formatex(path, charsmax(path), "sound/%s", SOUND_FLY)
    g_ready_fly = bool:file_exists(path)
    if (g_ready_fly) precache_sound(SOUND_FLY)

    formatex(path, charsmax(path), "sound/%s", SOUND_LOW)
    g_ready_low = bool:file_exists(path)
    if (g_ready_low) precache_sound(SOUND_LOW)
}

// ── выдача ──────────────────────────────────────────────────────────────────────

public zp_extra_item_selected(id, itemid)
{
    if (itemid != g_item) return PLUGIN_CONTINUE;
    if (!get_pcvar_num(cvar_enabled)) return ZP_PLUGIN_HANDLED;

    // Уровень Лидера и выше. ZP_PLUGIN_HANDLED мод понимает как «покупка не
    // состоялась» и сам возвращает кредиты.
    if (!(get_user_flags(id) & ADMIN_LEVEL_G))
    {
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Джетпак — вещь уровня ^x04Лидер^x01.")
        return ZP_PLUGIN_HANDLED;
    }

    if (!is_user_alive(id) || zp_get_user_zombie(id))
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Джетпак — только для живых людей.")
        return ZP_PLUGIN_HANDLED;
    }
    if (zp_get_user_survivor(id) || zp_get_user_sniper(id))
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 У этой роли своё снаряжение.")
        return ZP_PLUGIN_HANDLED;
    }
    if (g_has[id])
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Джетпак уже за спиной — бак долит доверху.")
        g_fuel[id] = get_pcvar_float(cvar_fuel)
        return ZP_PLUGIN_HANDLED;
    }

    give(id)

    new name[32]
    get_user_name(id, name, charsmax(name))
    zlog("ДЖЕТПАК: %s купил за %d", name, get_pcvar_num(cvar_cost))

    client_print_color(id, print_team_default,
        "^x04[Вспышка эпидемии]^x01 Джетпак ваш. В прыжке зажмите ^x04ПРОБЕЛ^x01 — полетите, пока есть топливо.")
    return PLUGIN_CONTINUE;
}

give(id)
{
    g_has[id] = true
    g_fuel[id] = get_pcvar_float(cvar_fuel)
    attach(id)
}

// Ранец за спиной — отдельная сущность, привязанная к игроку. Ровно так же
// сделан парашют: своей модели игрок не видит, зато её видят остальные.
attach(id)
{
    if (!g_ready_model || g_pack[id]) return;

    new ent = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, "info_target"))
    if (!ent) return;

    set_pev(ent, pev_classname, "zm_hot_jetpack")
    set_pev(ent, pev_aiment, id)
    set_pev(ent, pev_owner, id)
    set_pev(ent, pev_movetype, MOVETYPE_FOLLOW)
    engfunc(EngFunc_SetModel, ent, MODEL_PACK)

    g_pack[id] = ent
}

// Снять ранец со спины. Сам предмет при этом никуда не девается — что с ним
// делать дальше, решает вызывающий: убрать совсем или уронить на пол.
drop(id)
{
    if (g_pack[id])
    {
        if (pev_valid(g_pack[id])) engfunc(EngFunc_RemoveEntity, g_pack[id])
        g_pack[id] = 0
    }
    g_has[id] = false
    g_fuel[id] = 0.0
}

// ── ранец как предмет: бросить, уронить, подобрать ──────────────────────────────

public cmd_drop(id)
{
    if (!get_pcvar_num(cvar_enabled)) return PLUGIN_HANDLED;

    if (!g_has[id])
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Джетпака у вас нет.")
        return PLUGIN_HANDLED;
    }
    if (!is_user_alive(id))
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Мёртвым бросать нечего.")
        return PLUGIN_HANDLED;
    }

    new Float:fuel = g_fuel[id]
    drop(id)
    spill(id, fuel, true)

    client_print_color(id, print_team_default,
        "^x04[Вспышка эпидемии]^x01 Джетпак брошен. Подобрать может любой человек — просто наступите.")

    new name[32]
    get_user_name(id, name, charsmax(name))
    zlog("ДЖЕТПАК: %s бросил ранец, топлива %.0f", name, fuel)
    return PLUGIN_HANDLED;
}

// Кладём ранец в мир. thrown — брошен руками (тогда летит вперёд) или выпал из
// убитого (тогда просто падает под ноги).
spill(id, Float:fuel, bool:thrown)
{
    if (!g_ready_model) return;

    new ent = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, "info_target"))
    if (!ent) return;

    set_pev(ent, pev_classname, PICKUP_CLASS)
    engfunc(EngFunc_SetModel, ent, MODEL_PACK)
    set_pev(ent, pev_movetype, MOVETYPE_TOSS)
    set_pev(ent, pev_solid, SOLID_TRIGGER)

    // Коробка касания вручную: у модели она своя и бывает в половину точки —
    // тогда предмет не поднять, сколько по нему ни топчись.
    static Float:mins[3], Float:maxs[3]
    mins[0] = -12.0; mins[1] = -12.0; mins[2] = -4.0
    maxs[0] =  12.0; maxs[1] =  12.0; maxs[2] = 20.0
    engfunc(EngFunc_SetSize, ent, mins, maxs)

    static Float:pos[3]
    pev(id, pev_origin, pos)
    pos[2] += 8.0
    engfunc(EngFunc_SetOrigin, ent, pos)

    if (thrown)
    {
        static Float:vel[3]
        velocity_by_aim(id, 260, vel)
        vel[2] += 120.0
        set_pev(ent, pev_velocity, vel)
    }

    // Топливо едет вместе с ранцем: подобравший получает ровно тот остаток,
    // который не долетал прежний хозяин.
    set_pev(ent, pev_fuser1, fuel)

    // Заметность: без свечения ранец теряется на полу среди трупов и коробок.
    set_pev(ent, pev_renderfx, kRenderFxGlowShell)
    set_pev(ent, pev_rendercolor, Float:{60.0, 200.0, 255.0})
    set_pev(ent, pev_rendermode, kRenderNormal)
    set_pev(ent, pev_renderamt, 16.0)

    new life = get_pcvar_num(cvar_droplife)
    if (life > 0) set_pev(ent, pev_nextthink, get_gametime() + float(life))
}

// Срок вышел — ранец истлел. Без этого к концу карты пол усеян покупками.
public fw_pickup_think(ent)
{
    if (pev_valid(ent)) engfunc(EngFunc_RemoveEntity, ent)
}

public fw_pickup_touch(ent, id)
{
    if (!pev_valid(ent) || !is_user_alive(id)) return;
    if (!get_pcvar_num(cvar_enabled)) return;

    // Зомби ранец не поднимает — но и не мешает: пусть лежит для людей.
    if (zp_get_user_zombie(id)) return;
    if (zp_get_user_survivor(id) || zp_get_user_sniper(id)) return;

    if (g_has[id])
    {
        // Свой уже есть — доливаем бак, если поднятый полнее. Иначе игрок,
        // пробежавший по чужому ранцу, потерял бы его зря.
        static Float:had
        pev(ent, pev_fuser1, had)
        if (had > g_fuel[id])
        {
            g_fuel[id] = had
            client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Из брошенного ранца долит бак.")
            engfunc(EngFunc_RemoveEntity, ent)
        }
        return;
    }

    static Float:fuel
    pev(ent, pev_fuser1, fuel)
    if (fuel < 1.0) fuel = 1.0

    g_has[id] = true
    g_fuel[id] = fuel
    attach(id)
    engfunc(EngFunc_RemoveEntity, ent)

    client_print_color(id, print_team_default,
        "^x04[Вспышка эпидемии]^x01 Джетпак подобран, топлива ^x04%d%%^x01. В прыжке зажмите ^x04ПРОБЕЛ^x01.",
        floatround(fuel * 100.0 / get_pcvar_float(cvar_fuel)))

    new name[32]
    get_user_name(id, name, charsmax(name))
    zlog("ДЖЕТПАК: %s подобрал ранец, топлива %.0f", name, fuel)
}

// Все лежащие ранцы — со старта раунда: остатки прошлого раунда только путают.
sweep_drops()
{
    new ent = -1
    while ((ent = find_ent_by_class(ent, PICKUP_CLASS)) > 0)
        if (pev_valid(ent)) engfunc(EngFunc_RemoveEntity, ent)
}

// ── полёт ───────────────────────────────────────────────────────────────────────

public fw_PreThink(id)
{
    if (!get_pcvar_num(cvar_enabled) || !g_has[id] || !is_user_alive(id)) return FMRES_IGNORED;

    // Заразили посреди полёта — ранец забираем сразу, а не по возрождению.
    if (zp_get_user_zombie(id)) { drop(id); return FMRES_IGNORED; }

    new flags = pev(id, pev_flags)
    new Float:full = get_pcvar_float(cvar_fuel)

    // На земле бак наполняется. Считаем по времени, а не по кадрам: иначе
    // скорость восстановления зависела бы от загрузки сервера.
    if (flags & FL_ONGROUND)
    {
        if (g_fuel[id] < full)
        {
            static Float:last[33]
            new Float:now = get_gametime()
            new Float:dt = now - last[id]
            last[id] = now
            if (dt > 0.0 && dt < 1.0) g_fuel[id] += get_pcvar_float(cvar_regen) * dt
            if (g_fuel[id] > full) g_fuel[id] = full
        }
        return FMRES_IGNORED;
    }

    if (!(pev(id, pev_button) & IN_JUMP) || g_fuel[id] <= 0.0)
        return FMRES_IGNORED;

    // Тяга по направлению взгляда плюс подъём: так джетпак несёт туда, куда
    // смотришь, а не только вверх. Прежнюю вертикальную скорость запоминаем
    // ДО подмены вектора, иначе полёт вверх не набирал бы высоту.
    static Float:vel[3]
    pev(id, pev_velocity, vel)
    new Float:up = vel[2] + 32.0

    velocity_by_aim(id, get_pcvar_num(cvar_push), vel)
    vel[2] = up > 300.0 ? 300.0 : up
    set_pev(id, pev_velocity, vel)

    g_fuel[id] -= get_pcvar_float(cvar_burn)
    if (g_fuel[id] < 0.0) g_fuel[id] = 0.0

    // ⚠️ Звук повторяем ПО ЧАСАМ, а не каждый кадр: emit_sound начинает файл
    // заново, и сто перезапусков в секунду слышны как треск — до первой сотой
    // секунды записи дело просто не доходит.
    //
    // Звук выбираем ветвлением, а не тернарником: Pawn не умеет выбирать между
    // двумя строками выражением — «array must be indexed».
    new Float:t = get_gametime()
    if (t >= g_snd_at[id])
    {
        if (g_fuel[id] > full / 4.0)
        {
            if (g_ready_fly)
            {
                emit_sound(id, CHAN_STREAM, SOUND_FLY, VOL_NORM, ATTN_NORM, 0, PITCH_NORM)
                g_snd_at[id] = t + FLY_SND_LEN
            }
        }
        else if (g_ready_low)
        {
            emit_sound(id, CHAN_STREAM, SOUND_LOW, VOL_NORM, ATTN_NORM, 0, PITCH_NORM)
            g_snd_at[id] = t + LOW_SND_LEN
        }
    }

    return FMRES_IGNORED;
}

// Полоску рисуем всем, у кого ранец за спиной. Раз в HUD_TICK — и ни разу
// чаще: почему, написано в шапке.
public hud_tick()
{
    if (!get_pcvar_num(cvar_enabled)) return;

    static players[32], num, i, id
    get_players(players, num, "ch")   // подключённые, без ботов

    for (i = 0; i < num; i++)
    {
        id = players[i]
        if (!g_has[id] || !is_user_alive(id)) continue;
        show_fuel(id)
    }
}

// Полоска топлива — иначе полёт обрывается «без причины». Рисуем над нижней
// панелью мода, чтобы не наложиться на его строки.
//
// ⚠️ Вызывать ТОЛЬКО из hud_tick. Прямой вызов из кадра вернёт ту самую
// поломку, из-за которой с экрана пропадал весь остальной HUD.
show_fuel(id)
{
    new Float:full = get_pcvar_float(cvar_fuel)
    new pct = full > 0.0 ? floatround(g_fuel[id] * 100.0 / full) : 0
    if (pct < 0) pct = 0
    if (pct > 100) pct = 100

    new bar[24]
    new filled = pct / 10
    for (new i = 0; i < 10; i++) bar[i] = i < filled ? '|' : '.'
    bar[10] = 0

    // Цвет ведёт себя как индикатор: зелёный — полно, красный — на исходе.
    new r = pct > 50 ? 0 : 255
    new g = pct > 25 ? 200 : 60

    // Подпись отдельной переменной: Pawn не выбирает между двумя строками
    // выражением, а в аргументе формата это как раз выбор.
    new tail[24]
    if ((pev(id, pev_flags) & FL_ONGROUND) && pct < 100) copy(tail, charsmax(tail), "  восполняется")
    else tail[0] = 0

    // DHUD, а не обычный HUD: каналов у GoldSrc всего четыре, и мод занял все.
    // Пятая строка через set_hudmessage либо не покажется, либо затрёт чужую.
    //
    // ⚠️ Держим надпись РОВНО ОДИН ШАГ задачи и без затуханий: затухание тоже
    // продлевает жизнь, и надписи начали бы копиться одна на другой.
    set_dhudmessage(r, g, 60, -1.0, 0.70, 0, 0.0, HUD_TICK, 0.0, 0.0)
    show_dhudmessage(id, "ДЖЕТПАК [%s] %d%%%s", bar, pct, tail)
}

// ── жизненный цикл ──────────────────────────────────────────────────────────────

// Убили — ранец падает под ноги, а не исчезает вместе с хозяином. Так за
// человеком с джетпаком есть смысл охотиться, а его товарищам — добежать до
// тела. Остаток топлива уезжает вместе с ранцем.
public fw_killed_post(victim, attacker, shouldgib)
{
    if (!g_has[victim]) return;

    new Float:fuel = g_fuel[victim]
    drop(victim)
    spill(victim, fuel, false)
}

public fw_spawn_post(id)
{
    // Возродился — ранца на спине нет: он остался лежать там, где выпал.
    if (is_user_alive(id)) drop(id)
}

// Заразили — ранец сваливается с плеч на пол: зомби им не пользуется, но и
// пропадать покупке незачем.
public zp_user_infected_post(id, infector, nemesis)
{
    if (!g_has[id]) { drop(id); return; }

    new Float:fuel = g_fuel[id]
    drop(id)
    if (is_user_alive(id)) spill(id, fuel, false)
}

public client_putinserver(id)
{
    g_has[id] = false
    g_fuel[id] = 0.0
    g_snd_at[id] = 0.0
    g_pack[id] = 0
}

// Четыре параметра обязательны: форвард с одним не вызывается вовсе.
public client_disconnected(id, bool:drop_, message[], maxlen) drop(id)

// ⚠️ РАНЕЦ СО СПИНЫ ЗДЕСЬ НЕ СНИМАЕМ. Раньше снимали — покупка задумывалась на
// один раунд. Владелец попросил обратного: купленное снаряжение возвращается
// каждый раунд (мод, zm_hot_keep_regive). Ранец выдаётся заново через долю
// секунды после возрождения, а этот форвард приходит ПОЗЖЕ — в миг первого
// заражения, — и снимал бы только что выданное. Игрок летал бы первые секунды
// раунда и терял ранец ровно тогда, когда он нужен.
//
// А вот лежащие на полу ранцы убрать надо: остатки прошлого раунда только
// путают, да и подобрать чужую покупку задаром — не то, за что платили.
public zp_round_started(gamemode, id)
{
    sweep_drops()

    // ⚠️ У ВЫЖИВШЕГО И СНАЙПЕРА РАНЦА БЫТЬ НЕ ДОЛЖНО. Их выбирают ПОСЛЕ
    // возрождения, а снаряжение возвращается сразу после него — то есть роль
    // достаётся игроку, у которого ранец уже за спиной, и наша проверка при
    // покупке его не ловит. Летающий Выживший с пулемётом — это не роль, а
    // отмена раунда.
    if ((gamemode == MODE_SURVIVOR || gamemode == MODE_SNIPER) && is_user_connected(id))
    {
        if (g_has[id])
        {
            drop(id)
            client_print_color(id, print_team_default,
                "^x04[Вспышка эпидемии]^x01 Ранец снят: у этой роли своё снаряжение. Вернётся в следующем раунде.")
        }
    }
}

zlog(const fmt[], any:...)
{
    if (!get_pcvar_num(cvar_log)) return;

    static msg[256]
    vformat(msg, charsmax(msg), fmt, 2)
    log_to_file("zp_actions.log", "%s", msg)
}
