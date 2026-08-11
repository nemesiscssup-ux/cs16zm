/*
 * [ZP] Заработок кредитов: за урон, за время и за события раунда.
 *
 * ЗАЧЕМ. У мода кредиты дают ровно за две вещи: заражение и убийство. Значит
 * платят только тем, кто добивает, — а тот, кто весь раунд сдерживал толпу и
 * умер последним, уходит с пустыми руками. Владелец попросил платить и «за
 * урон, и за отыгранное время, и за разные события».
 *
 * ЧТО СЧИТАЕТСЯ (всё настраивается кварами, ноль отключает):
 *
 *   урон           zp_earn_dmg_per      сколько урона стоит один кредит (400)
 *   время          zp_earn_time_min     сколько минут в игре за кредит (5)
 *   победа         zp_earn_round_win    команде-победителю (2)
 *   выжил          zp_earn_survived     человеку, дожившему до конца раунда (3)
 *   босс           zp_earn_boss_mult    множитель за урон Немезиде и Убийце (2)
 *
 * ⚠️ ПЛАТИМ ОБЕИМ СТОРОНАМ. Урон засчитывается и человеку по зомби, и зомби по
 * человеку: иначе зомби, которому не досталось заражения, за раунд не получит
 * ничего, а он такой же игрок.
 *
 * ⚠️ КОПИМ ДРОБЬ, А НЕ ОКРУГЛЯЕМ КАЖДЫЙ РАЗ. Выстрел на 30 урона при цене
 * кредита в 400 — это 0.075 кредита. Округляя на месте, мы бы платили ноль
 * всегда. Поэтому копится сырой урон, а кредит выдаётся, когда накопилось на
 * целый; остаток переносится дальше и живёт до конца карты.
 *
 * ⚠️ ПРИБАВКА ЗА ПРИВИЛЕГИЮ. У каждого уровня свой процент к ЛЮБОМУ заработку
 * отсюда (VIP +10% … Создатель +60%). Это то, что владелец просил «добавить
 * баффы к прибавке в привилегии»: не разовая подачка на возрождении (она есть
 * в zp_vip.sma), а постоянный множитель на всё, что игрок зарабатывает сам.
 * ⚠️ Проценты обязаны совпадать с тем, что написано на сайте
 * (site/private/app/tiers.php) и в меню привилегий — три места, как и у прочих
 * свойств уровней.
 */

#include <amxmodx>
#include <amxmisc>
#include <engine>
#include <fakemeta>
#include <hamsandwich>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Заработок кредитов"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

#define TASK_MINUTE 8100
#define GIFT_CLASS "zm_hot_gift"

// Уровни: буква флага и прибавка к заработку в процентах. Порядок снизу вверх,
// как в zp_vip.sma и tools/users-ini.mjs.
enum _:TIER { TNAME[24], TFLAG, TBONUS }
new const g_tiers[][TIER] = {
    { "VIP",       ADMIN_LEVEL_H, 10 },
    { "Лидер",     ADMIN_LEVEL_G, 20 },
    { "Император", ADMIN_LEVEL_E, 30 },
    { "Фараон",    ADMIN_LEVEL_D, 45 },
    { "Создатель", ADMIN_LEVEL_C, 60 },
}

new cvar_enabled, cvar_dmg_per, cvar_time_min, cvar_win, cvar_survived
new cvar_boss_mult, cvar_log, cvar_say

new cvar_gift_on, cvar_gift_chance, cvar_gift_min, cvar_gift_max, cvar_gift_life, cvar_gift_model
new g_spr_gift

new Float:g_dmg_left[33]      // недоплаченный урон, переносится дальше
new g_seconds[33]             // отыгранные секунды, ещё не оплаченные
new g_earned[33]              // сколько накапало за карту — для строки в чате

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    cvar_enabled   = register_cvar("zp_earn_enabled", "1")
    cvar_dmg_per   = register_cvar("zp_earn_dmg_per", "400")
    cvar_time_min  = register_cvar("zp_earn_time_min", "5")
    cvar_win       = register_cvar("zp_earn_round_win", "2")
    cvar_survived  = register_cvar("zp_earn_survived", "3")
    cvar_boss_mult = register_cvar("zp_earn_boss_mult", "2")
    cvar_say       = register_cvar("zp_earn_say", "1")     // писать ли в чат
    cvar_log       = register_cvar("zp_log_actions", "1")

    cvar_gift_on     = register_cvar("zp_gift_enabled", "1")
    cvar_gift_chance = register_cvar("zp_gift_chance", "100")   // с какой вероятностью падает, %
    cvar_gift_min    = register_cvar("zp_gift_min", "1")        // кредитов внутри, от
    cvar_gift_max    = register_cvar("zp_gift_max", "3")        // и до
    cvar_gift_life   = register_cvar("zp_gift_life", "30")      // сколько лежит, секунд
    cvar_gift_model  = register_cvar("zp_gift_model", "models/w_weaponbox.mdl")

    // Урон считаем ПОСЛЕ применения: до него значение ещё могут изменить чужие
    // обработчики (броня, щит Панциря, половинный урон), и мы заплатили бы за
    // то, чего не случилось.
    RegisterHam(Ham_TakeDamage, "player", "fw_damage_post", 1)
    RegisterHam(Ham_Killed, "player", "fw_killed_post", 1)
    register_touch(GIFT_CLASS, "player", "gift_touch")

    register_concmd("zp_earn_info", "cmd_info", ADMIN_LEVEL_A,
        "<ник> — сколько игрок заработал за карту и какая у него прибавка")
}

public plugin_precache()
{
    g_spr_gift = precache_model("sprites/zerogxplode.spr")

    // ⚠️ Модель ящика лежит в БАЗОВОЙ части игры (valve/models), а file_exists
    // смотрит только в каталог мода и отвечает «нет». Предзагружаем без
    // проверки: движок сам возьмёт файл из valve, а не найдёт — скажет в
    // консоль, и это будет видно.
    new model[64]
    get_pcvar_string(cvar_gift_model, model, charsmax(model))
    if (model[0]) precache_model(model)
}

public plugin_cfg()
{
    remove_task(TASK_MINUTE)
    set_task(60.0, "minute_tick", TASK_MINUTE, _, _, "b")
}

public client_putinserver(id)
{
    g_dmg_left[id] = 0.0
    g_seconds[id] = 0
    g_earned[id] = 0
}

// ── прибавка за уровень ─────────────────────────────────────────────────────────

tier_of(id)
{
    new flags = get_user_flags(id)
    new best = -1
    for (new i = 0; i < sizeof g_tiers; i++)
        if (flags & g_tiers[i][TFLAG]) best = i
    return best;
}

// Сколько на самом деле выдать: столько же плюс процент уровня.
with_bonus(id, amount)
{
    new t = tier_of(id)
    if (t < 0 || amount <= 0) return amount;

    return amount + (amount * g_tiers[t][TBONUS]) / 100;
}

// Выдать и рассказать. Возвращает, сколько дали на руки.
pay(id, amount, const why[])
{
    if (amount <= 0 || !is_user_connected(id)) return 0;

    new give = with_bonus(id, amount)
    zp_set_user_ammo_packs(id, zp_get_user_ammo_packs(id) + give)
    g_earned[id] += give

    if (get_pcvar_num(cvar_say))
    {
        new extra[32]
        extra[0] = 0
        if (give > amount) formatex(extra, charsmax(extra), " ^x03(+%d за уровень)^x01", give - amount)

        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 +%d кредит(ов) за %s%s.", give, why, extra)
    }

    if (get_pcvar_num(cvar_log))
    {
        new name[32]
        get_user_name(id, name, charsmax(name))
        log_to_file("zp_actions.log", "ЗАРАБОТОК: %s +%d за %s", name, give, why)
    }
    return give;
}

// ── урон ────────────────────────────────────────────────────────────────────────

public fw_damage_post(victim, inflictor, attacker, Float:damage, damagebits)
{
    if (!get_pcvar_num(cvar_enabled)) return;
    if (!is_user_connected(attacker) || attacker == victim) return;
    if (!is_user_connected(victim)) return;

    // Свои своих не оплачивают: иначе двое договорившихся настреляют друг по
    // другу сколько угодно.
    if (zp_get_user_zombie(attacker) == zp_get_user_zombie(victim)) return;

    new per = get_pcvar_num(cvar_dmg_per)
    if (per <= 0) return;

    // Боссы мода бьются долго, и платить за них по общей цене — значит не
    // платить вовсе: множитель делает драку с Немезидой заметной в кошельке.
    new Float:worth = damage
    if (zp_get_user_nemesis(victim) || zp_get_user_assassin(victim))
    {
        new mult = get_pcvar_num(cvar_boss_mult)
        if (mult > 1) worth *= float(mult)
    }

    g_dmg_left[attacker] += worth

    new whole = floatround(g_dmg_left[attacker] / float(per), floatround_floor)
    if (whole <= 0) return;

    g_dmg_left[attacker] -= float(whole * per)
    pay(attacker, whole, "урон")
}

// ── время ───────────────────────────────────────────────────────────────────────

public minute_tick()
{
    if (!get_pcvar_num(cvar_enabled)) return;

    new need = get_pcvar_num(cvar_time_min)
    if (need <= 0) return;

    // Без флагов — это ВСЕ подключённые, вместе с ботами. Флаг «c» у
    // get_players означает «пропустить ботов», а вовсе не «connected».
    new players[32], num
    get_players(players, num)

    for (new i = 0; i < num; i++)
    {
        new id = players[i]

        // Зрителю не платим: сидеть в наблюдателях — не игра.
        if (!is_user_alive(id) && zp_get_user_zombie(id) == 0 && get_user_team(id) == 0) continue;

        g_seconds[id] += 60
        if (g_seconds[id] < need * 60) continue;

        new whole = g_seconds[id] / (need * 60)
        g_seconds[id] -= whole * need * 60
        pay(id, whole, "время в игре")
    }
}

// ── события раунда ──────────────────────────────────────────────────────────────

public zp_round_ended(winteam)
{
    if (!get_pcvar_num(cvar_enabled)) return;

    new win = get_pcvar_num(cvar_win)
    new alive = get_pcvar_num(cvar_survived)

    new players[32], num
    get_players(players, num)

    for (new i = 0; i < num; i++)
    {
        new id = players[i]
        new bool:zombie = zp_get_user_zombie(id) != 0

        // ZP_TEAM_ZOMBIE и ZP_TEAM_HUMAN приходят номерами сторон.
        if (win == 0) {}
        else if ((winteam == ZP_TEAM_ZOMBIE && zombie) || (winteam == ZP_TEAM_HUMAN && !zombie))
            pay(id, win, "победу в раунде")

        // Человек, доживший до конца, — отдельная награда: именно этого не
        // хватало тому, кто весь раунд убегал и никого не добил.
        if (alive > 0 && !zombie && is_user_alive(id))
            pay(id, alive, "то, что выжил")
    }
}

// ── справка ─────────────────────────────────────────────────────────────────────

public cmd_info(id, level, cid)
{
    if (!cmd_access(id, level, cid, 2)) return PLUGIN_HANDLED;

    new who[32]
    read_argv(1, who, charsmax(who))
    new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF)
    if (!target) return PLUGIN_HANDLED;

    new name[32]
    get_user_name(target, name, charsmax(name))
    new t = tier_of(target)

    // ⚠️ Тернарник, возвращающий МАССИВ, Pawn не переваривает («array must be
    // indexed»): выбор имени уровня приходится писать обычным условием.
    new tier[24]
    if (t >= 0) copy(tier, charsmax(tier), g_tiers[t][TNAME])
    else copy(tier, charsmax(tier), "нет")

    console_print(id, "%s: заработано за карту %d, уровень %s, прибавка %d%%, недоплаченный урон %.0f, секунд к оплате %d",
        name, g_earned[target], tier, t >= 0 ? g_tiers[t][TBONUS] : 0,
        g_dmg_left[target], g_seconds[target])
    return PLUGIN_HANDLED;
}

// ── падение подарка ─────────────────────────────────────────────────────────────

public fw_killed_post(victim, attacker, shouldgib)
{
    if (!get_pcvar_num(cvar_gift_on)) return;
    if (!is_user_connected(victim) || !zp_get_user_zombie(victim)) return;

    // Своих не считаем: зомби, добивший зомби, подарка не роняет.
    if (!is_user_connected(attacker) || attacker == victim) return;
    if (zp_get_user_zombie(attacker)) return;

    if (random_num(1, 100) > get_pcvar_num(cvar_gift_chance)) return;

    static Float:origin[3]
    pev(victim, pev_origin, origin)
    drop_gift(origin)
}

drop_gift(const Float:at[3])
{
    new ent = create_entity("info_target")
    if (!ent) return;

    entity_set_string(ent, EV_SZ_classname, GIFT_CLASS)

    new model[64]
    get_pcvar_string(cvar_gift_model, model, charsmax(model))
    entity_set_model(ent, model)

    // Коробка маленькая, а трогать её надо уверенно: рамка касания чуть шире
    // самой модели, иначе игрок пробегает сквозь подарок и не понимает почему.
    static Float:mins[3], Float:maxs[3]
    mins[0] = -12.0; mins[1] = -12.0; mins[2] = -4.0
    maxs[0] = 12.0;  maxs[1] = 12.0;  maxs[2] = 20.0
    entity_set_size(ent, mins, maxs)

    static Float:origin[3]
    origin[0] = at[0]
    origin[1] = at[1]
    origin[2] = at[2] + 16.0
    entity_set_origin(ent, origin)

    entity_set_int(ent, EV_INT_movetype, MOVETYPE_TOSS)
    entity_set_int(ent, EV_INT_solid, SOLID_TRIGGER)

    // Лёгкий подскок: так видно, что вещь ВЫПАЛА, а не стояла тут всегда.
    static Float:push[3]
    push[0] = random_float(-40.0, 40.0)
    push[1] = random_float(-40.0, 40.0)
    push[2] = random_float(120.0, 180.0)
    entity_set_vector(ent, EV_VEC_velocity, push)

    static Float:spin[3]
    spin[0] = 0.0; spin[1] = random_float(90.0, 220.0); spin[2] = 0.0
    entity_set_vector(ent, EV_VEC_avelocity, spin)

    // Золотое свечение — единственная примета, по которой ящик виден в толпе и
    // сквозь зелёный экран ночного зрения.
    entity_set_int(ent, EV_INT_renderfx, kRenderFxGlowShell)
    entity_set_vector(ent, EV_VEC_rendercolor, Float:{ 255.0, 200.0, 40.0 })
    entity_set_int(ent, EV_INT_rendermode, kRenderNormal)
    entity_set_float(ent, EV_FL_renderamt, 16.0)

    // Сколько кредитов внутри — решаем сразу и храним в самой вещи: так два
    // подарка на полу не перепутаются.
    new lo = get_pcvar_num(cvar_gift_min), hi = get_pcvar_num(cvar_gift_max)
    if (hi < lo) hi = lo
    entity_set_int(ent, EV_INT_iuser1, random_num(lo, hi))

    new Float:life = get_pcvar_float(cvar_gift_life)
    if (life < 5.0) life = 5.0
    entity_set_float(ent, EV_FL_nextthink, get_gametime() + life)
    register_think(GIFT_CLASS, "gift_think")
}

public gift_think(ent)
{
    if (!is_valid_ent(ent)) return;
    remove_entity(ent)
}

// ── подбор ──────────────────────────────────────────────────────────────────────

public gift_touch(ent, id)
{
    if (!is_valid_ent(ent) || !is_user_alive(id)) return;

    // Зомби подарки не берут: награда за убитого зомби принадлежит людям.
    if (zp_get_user_zombie(id)) return;

    new packs = entity_get_int(ent, EV_INT_iuser1)
    if (packs < 1) packs = 1

    // Начисляем через общий pay(): там же прибавка за уровень и запись в журнал.
    pay(id, packs, "подарок")

    emit_sound(id, CHAN_ITEM, "items/9mmclip1.wav", 1.0, ATTN_NORM, 0, PITCH_NORM)

    // Вспышка на месте подарка — видно и тому, кто не успел.
    static Float:at[3]
    entity_get_vector(ent, EV_VEC_origin, at)
    message_begin_f(MSG_PVS, SVC_TEMPENTITY, at)
    write_byte(TE_SPRITE)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2] + 8.0)
    write_short(g_spr_gift)
    write_byte(6)
    write_byte(200)
    message_end()

    if (get_pcvar_num(cvar_log))
    {
        new name[32]
        get_user_name(id, name, charsmax(name))
        log_to_file("zp_actions.log", "ПОДАРОК: %s подобрал %d кредит(ов)", name, packs)
    }

    remove_entity(ent)
}
