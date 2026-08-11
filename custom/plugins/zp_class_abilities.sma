/*
 * [ZP] Активные способности классов зомби.
 *
 * У каждого класса своя способность с откатом. Вызов — КЛАВИША E, а также
 * команда zp_ability и чат: /сила, /ability.
 *
 *   Обычный   Рывок          мощный толчок вперёд
 *   Раптор    Ускорение      +90 к скорости на 5 секунд
 *   Ядовитый  Облако         травит людей вокруг 4 секунды
 *   Толстяк   Панцирь        входящий урон вдвое меньше 5 секунд
 *   Ведьма    Стая мышей     выпускает мышей: попавшая тянет человека к ней
 *   Студентка Двойной прыжок второй прыжок в воздухе, ПРОБЕЛОМ, с откатом
 *   Спринтер  Спринт         рывок скорости, сильнее обычного ускорения
 *
 * Электрик активной способности НЕ имеет: он обычный зомби, только быстрее.
 * Остальные классы за привилегию — из своих плагинов (cso_class_*), у каждого
 * там своя способность со своими эффектами.
 *
 * Классы опознаются по имени через zp_get_zombie_class_id, а не по номеру:
 * номера зависят от порядка регистрации и поедут, как только добавится
 * шестой класс.
 *
 * ⚠️ ЗВУКИ. Каталог звуков мода зависит от версии: у 4.3 это sound/zombie_plague,
 * у нашей 4.4 — sound/zombie_plague_v44. Со старым путём emit_sound молча не
 * играет ничего («not precached» видно только в консоли сервера), и способность
 * выглядит сломанной. Все звуки перечислены ниже одним списком и precache-ятся.
 */

#include <amxmodx>
#include <amxmisc>
#include <engine>
#include <fakemeta>
#include <hamsandwich>
#include <fun>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Способности классов"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

#define TASK_POISON 5100
#define TASK_END    5200
#define TASK_GLOW   5300
#define TASK_PULL   5400

// Спрайты эффектов. Свои, а не штатные: штатная ударная волна бледная и
// одинаковая у всего, а способность должна читаться с одного взгляда.
// Если файла нет — откатываемся на штатный, сервер из-за косметики не ронять.
new g_spr_ring, g_spr_ball, g_spr_slow

// Звуки способностей. Каталог мода — v44, см. предупреждение в шапке.
new const SND_LEAP[]   = "zombie_plague_v44/zombie_madness1.wav"
new const SND_SPEED[]  = "zombie_plague_v44/zombie_brains1.wav"
new const SND_SPRINT[] = "zombie_plague_v44/zombie_brains2.wav"
new const SND_POISON[] = "zombie_plague_v44/zombie_infec2.wav"
new const SND_SHIELD[] = "zombie_plague_v44/zombie_pain4.wav"
// ⚠️ У Ведьмы был тот же крик, что у Шамана, и способности звучали одинаково.
// Готовой записи летучих мышей нет ни в одной из тринадцати скачанных сборок,
// ни в самой игре — обошли 11 230 файлов и посчитали спектр каждого. Поэтому
// звук собран своим tools/mix-wav.mjs из двух: крик стаи летунов Half-Life
// (писк) и трепет крыльев (модуляция 13.9 Гц — частота взмаха).
new const SND_BATS[]   = "zm_hot/witch-bats.wav"

// Мыши ведьмы: снаряд со своим классом имени, чтобы касание и «подумать»
// цеплялись только на него.
new const MODEL_BAT[] = "models/zm_hot/bat_witch_re.mdl"
new const BAT_CLASS[] = "zm_hot_bat"
new bool:g_bat_ready

// Порядок здесь и в g_ability_name должен совпадать: имя берётся по номеру.
enum { AB_LEAP = 0, AB_SPEED, AB_POISON, AB_SHIELD, AB_BATS, AB_DJUMP, AB_SPRINT, AB_NONE }

// Все классы сборки: пять штатных, два перенесённых и пять из привилегий
// (zp_zclass_vip.sma). Имена должны совпадать буква в букву: классы ищутся по
// имени, а не по номеру — номера зависят от порядка регистрации и поедут при
// любом добавлении.
// Электрика в списке нет намеренно: по просьбе владельца он остался обычным
// зомби без активной способности — «Рёв» ему не шёл, и нажатие E выглядело
// как поломка. Шокер, Охотник, Костяной и Ревенант из сборки убраны совсем.
new const g_class_names[][] = {
    "Обычный", "Раптор", "Ядовитый", "Толстяк", "Ведьма", "Студентка", "Спринтер",
}
new const g_ability_of[] = {
    AB_LEAP, AB_SPEED, AB_POISON, AB_SHIELD, AB_BATS, AB_DJUMP, AB_SPRINT,
}
new const g_ability_name[][] = {
    "Рывок", "Ускорение", "Ядовитое облако", "Панцирь",
    "Стая мышей", "Двойной прыжок", "Спринт",
}

new g_class_id[sizeof g_class_names]

new Float:g_ready_at[33]     // когда способность снова доступна
new bool:g_key_held[33]      // клавиша уже была нажата в прошлом кадре
new bool:g_jump_held[33]     // то же для Пробела
new bool:g_air_jump[33]      // второй прыжок в этом полёте уже сделан
new bool:g_quiet             // вызов пришёл с кнопки: отказы в чат не пишем
new cvar_key
new bool:g_speed_on[33]
new bool:g_sprint_on[33]
new bool:g_shield_on[33]
new g_poison_left[33]
// ⚠️ ОБЛАКО ОСТАЁТСЯ ТАМ, ГДЕ ЕГО ВЫПУСТИЛИ. Раньше оно держалось на самом
// зомби и убегало вместе с ним: со стороны — ничего, изнутри — ничего.
new Float:g_cloud_at[33][3]
// Кого накрыло за всю жизнь облака: по одному биту на игрока, чтобы сказать
// зомби «отравлено трое», а не считать одного и того же восемь раз.
new g_poison_hit[33]
// До какого времени человек вязнет в яде. Скорость выставляет не эта строка, а
// обработчик пересчёта: разовый set_pev мод затрёт первой же сменой оружия.
new Float:g_slow_until[33]
new bool:g_told_poison[33]
new g_msg_fade

new cvar_enabled, cvar_cooldown, cvar_leap_force, cvar_speed_bonus
new cvar_poison_dmg, cvar_poison_radius, cvar_log, cvar_sprint_bonus
new cvar_djump_force
new cvar_bats_count, cvar_bats_speed, cvar_bats_spread, cvar_bats_life, cvar_bats_pull
new cvar_bats_hold, cvar_bats_near

// Кого сейчас тащит мышь и до какого времени. Держим по жертве, а не по ведьме:
// одна стая может зацепить нескольких, и каждого ведут отдельно.
new g_pull_to[33]
new Float:g_pull_end[33]

// Тот же трюк, что в самом ZP: он вешает пересчёт скорости не на настоящий
// Ham_CS_Player_ResetMaxSpeed, а на Ham_Item_PreFrame. Цепляемся туда же,
// иначе наш бонус будет затираться при каждой смене оружия.
new Ham:Ham_Player_ResetMaxSpeed = Ham_Item_PreFrame

public plugin_precache()
{
    g_spr_ring = spr("sprites/zm_hot/ef_leapstr_ring.spr")
    g_spr_ball = spr("sprites/zm_hot/ef_leapstr_ballexp.spr")
    g_spr_slow = spr("sprites/zm_hot/zbt_slow.spr")

    // Каждый звук — только если файл на месте. Отсутствие файла не роняет
    // сервер само по себе, но precache_sound на пустоту тратит слот и потом
    // всё равно молчит, а мы об этом не узнаем.
    snd(SND_LEAP); snd(SND_SPEED); snd(SND_SPRINT); snd(SND_POISON)
    snd(SND_SHIELD); snd(SND_BATS)

    // Нет модели — способность просто скажет об этом, а не уронит сервер.
    g_bat_ready = bool:file_exists(MODEL_BAT)
    if (g_bat_ready) precache_model(MODEL_BAT)
}

// Звук со страховкой: если файла нет, о нём надо УЗНАТЬ, а не гадать потом,
// почему способность беззвучная. Путь к звуку пишется от каталога sound/.
snd(const path[])
{
    static full[80]
    formatex(full, charsmax(full), "sound/%s", path)
    if (!file_exists(full))
    {
        log_amx("нет звука способности: %s", full)
        return;
    }
    precache_sound(path)
}

// Спрайт со страховкой: нет файла — берём штатную ударную волну, она есть
// у каждого игрока.
spr(const path[])
{
    // Через буфер, а не тернарником: Pawn не умеет выбирать между двумя
    // строками выражением — «array must be indexed».
    new use[64]
    if (file_exists(path)) copy(use, charsmax(use), path)
    else copy(use, charsmax(use), "sprites/shockwave.spr")

    return precache_model(use);
}

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    g_msg_fade = get_user_msgid("ScreenFade")

    cvar_enabled       = register_cvar("zp_ability_enabled", "1")
    cvar_cooldown      = register_cvar("zp_ability_cooldown", "20.0")
    cvar_leap_force    = register_cvar("zp_ability_leap_force", "560")
    cvar_speed_bonus   = register_cvar("zp_ability_speed_bonus", "90")
    cvar_poison_dmg    = register_cvar("zp_ability_poison_dmg", "12")
    cvar_poison_radius = register_cvar("zp_ability_poison_radius", "300")
    cvar_sprint_bonus  = register_cvar("zp_ability_sprint_bonus", "150")   // прибавка скорости спринтеру
    cvar_djump_force   = register_cvar("zp_ability_djump_force", "290")    // сила второго прыжка
    cvar_bats_count    = register_cvar("zp_ability_bats_count", "5")      // сколько мышей в стае
    cvar_bats_speed    = register_cvar("zp_ability_bats_speed", "800.0")  // скорость полёта
    cvar_bats_spread   = register_cvar("zp_ability_bats_spread", "9.0")   // разлёт веера, градусов
    cvar_bats_life     = register_cvar("zp_ability_bats_life", "3.0")     // сколько живёт мышь
    cvar_bats_pull     = register_cvar("zp_ability_bats_pull", "900.0")   // сила притяжения
    // Сколько секунд мышь ТАЩИТ пойманного. Один толчок человек просто
    // отшагивал: подтолкнуло и всё. Владелец попросил, чтобы мышь захватывала
    // цель и вела её к ведьме — значит тянуть надо непрерывно.
    cvar_bats_hold     = register_cvar("zp_ability_bats_hold", "1.8")
    // Ближе этого расстояния тянуть перестаём: иначе жертву вбивает в ведьму и
    // обоих растаскивает столкновением.
    cvar_bats_near     = register_cvar("zp_ability_bats_near", "110.0")
    // Общий выключатель журнала действий, один на все наши плагины.
    cvar_log           = register_cvar("zp_log_actions", "1")

    register_clcmd("zp_ability", "cmd_ability")

    // Проверить способность иначе нечем: увидеть её можно только сев за клиент
    // зомби нужного класса и дождавшись отката. Эти две команды дают то же
    // самое из консоли — и админу, и при сборке.
    register_concmd("zp_ability_info", "cmd_ability_info", ADMIN_LEVEL_A, "<ник> — какой класс и способность у игрока")
    register_concmd("zp_ability_fire", "cmd_ability_fire", ADMIN_LEVEL_A, "<ник> — применить способность за игрока")
    register_clcmd("say /сила", "cmd_ability")
    register_clcmd("say /ability", "cmd_ability")
    register_clcmd("say_team /сила", "cmd_ability")

    // ГЛАВНОЕ: способность должна вызываться КЛАВИШЕЙ, которая у игрока уже
    // есть. Команду надо сначала забиндить, а чат-триггер «/сила» набран
    // кириллицей — совпадёт он или нет, зависит от раскладки и кодировки
    // клиента. Проверить это со стороны сервера нельзя, а игрок просто видит,
    // что «способности не работают». Поэтому вешаем на клавишу E (использовать).
    cvar_key = register_cvar("zp_ability_key", "1")
    register_forward(FM_PlayerPreThink, "fw_PreThink")

    // По имени класса, а не по всем сущностям подряд: чужие снаряды не наши.
    register_touch(BAT_CLASS, "player", "fw_bat_touch")
    register_think(BAT_CLASS, "fw_bat_think")

    RegisterHam(Ham_TakeDamage, "player", "fw_TakeDamage", 0)
    RegisterHam(Ham_Player_ResetMaxSpeed, "player", "fw_ResetSpeed_Post", 1)
}

public plugin_cfg()
{
    // Только сейчас классы уже зарегистрированы модом.
    for (new i = 0; i < sizeof g_class_names; i++)
    {
        g_class_id[i] = zp_get_zombie_class_id(g_class_names[i])
        if (g_class_id[i] == -1)
            log_amx("класс «%s» не найден — способность для него работать не будет", g_class_names[i])
    }
}

// Четыре параметра обязательны: форвард с одним не вызывается вовсе.
public client_disconnected(id, bool:drop, message[], maxlen)
{
    reset_player(id)
}
public zp_user_humanized_post(id) reset_player(id)

// Про кнопку надо сказать вслух: сама она себя не покажет, а без этого игрок
// так и не узнает, что у класса вообще есть способность.
public zp_user_infected_post(id, infector, nemesis)
{
    if (!get_pcvar_num(cvar_enabled) || !is_user_connected(id)) return;

    new ab = ability_for(id)
    if (ab == AB_NONE) return;

    client_print_color(id, print_team_default,
        // ⚠️ ТОЧКА С ЗАПЯТОЙ ПОСЛЕ ^x04 ОБЯЗАТЕЛЬНА. В Pawn `^` — знак
        // подстановки, и `^x` берёт СТОЛЬКО шестнадцатеричных цифр, сколько
        // найдёт. Буква E — цифра шестнадцатеричная, поэтому `^x04E`
        // склеивалось в один символ 0x4E, то есть в «N»: игрок читал
        // «клавиша N», жал N (это фонарь) и делал вывод, что способности не
        // работают. Поймано разбором собранного .amxx, в исходнике не видно.
        "^x04[Вспышка эпидемии]^x01 Способность класса: ^x04%s^x01 — клавиша ^x04;E^x01.", g_ability_name[ab])
}
public zp_round_started(gamemode, id) for (new i = 1; i <= 32; i++) reset_player(i)

reset_player(id)
{
    g_told_poison[id] = false
    g_slow_until[id] = 0.0
    g_ready_at[id] = 0.0
    g_speed_on[id] = false
    g_sprint_on[id] = false
    g_shield_on[id] = false
    g_poison_left[id] = 0
    remove_task(id + TASK_POISON)
    remove_task(id + TASK_END)
    remove_task(id + TASK_GLOW)
    // Захват мышью снимаем и с жертвы, и как ведьму: иначе тягач переживёт и
    // смену раунда, и выход игрока — и потащит уже чужого по номеру слота.
    grab_stop(id)
    for (new v = 1; v <= 32; v++) if (g_pull_to[v] == id) grab_stop(v)
    if (is_user_connected(id)) set_user_rendering(id, kRenderFxNone, 0, 0, 0, kRenderNormal, 0)
}

ability_for(id)
{
    new cls = zp_get_user_zombie_class(id)
    for (new i = 0; i < sizeof g_class_id; i++)
        if (g_class_id[i] != -1 && g_class_id[i] == cls) return g_ability_of[i];
    return AB_NONE;
}

// Ловим НАЖАТИЕ, а не удержание: без этого способность уходила бы в откат
// каждый кадр, пока кнопка зажата, и первое же нажатие съедало бы её впустую.
public fw_PreThink(id)
{
    if (!get_pcvar_num(cvar_key) || !is_user_alive(id)) return FMRES_IGNORED;

    // Клавиша E. Ею же открывают двери и жмут кнопки на карте, но зомби это
    // почти не нужно, а вот способность нужна постоянно.
    new pressed = pev(id, pev_button) & IN_USE
    if (pressed && !g_key_held[id] && zp_get_user_zombie(id))
    {
        // Молча: клавишей E жмут часто (двери, кнопки), и отказ «у класса
        // нет способности» на каждое нажатие засыпал бы чат.
        g_quiet = true
        cmd_ability(id)
        g_quiet = false
    }
    g_key_held[id] = pressed != 0

    // Двойной прыжок Студентки — на ПРОБЕЛЕ, а не на кнопке способности: так
    // его и просили, и так он ощущается прыжком, а не «умением».
    new jump = pev(id, pev_button) & IN_JUMP
    new bool:on_ground = (pev(id, pev_flags) & FL_ONGROUND) != 0

    if (on_ground) g_air_jump[id] = false
    else if (jump && !g_jump_held[id] && !g_air_jump[id]
        && zp_get_user_zombie(id) && ability_for(id) == AB_DJUMP)
    {
        g_air_jump[id] = true     // второй прыжок в этом полёте только один
        g_quiet = true
        cmd_ability(id)
        g_quiet = false
    }
    g_jump_held[id] = jump != 0

    return FMRES_IGNORED;
}

// Печатает то, на чём способность и ломается: какой класс мод считает текущим,
// нашёлся ли он в нашем списке и что ему полагается.
public cmd_ability_info(id, level, cid)
{
    if (!cmd_access(id, level, cid, 2)) return PLUGIN_HANDLED;

    new who[32]
    read_argv(1, who, charsmax(who))
    new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF)
    if (!target) { console_print(id, "нет такого игрока: %s", who); return PLUGIN_HANDLED; }

    new name[32]
    get_user_name(target, name, charsmax(name))

    new cls = zp_get_user_zombie_class(target)
    new next = zp_get_user_next_class(target)
    new ab = ability_for(target)

    console_print(id, "%s: зомби=%d класс=%d следующий=%d способность=%s",
        name, zp_get_user_zombie(target) ? 1 : 0, cls, next,
        ab == AB_NONE ? "нет" : g_ability_name[ab])

    // Облик прямо из движка — тот самый, который видит клиент. Нужен не для
    // способностей, а для проверки боссов режимов: иначе подтвердить, что у
    // Дьявола свой вид, нечем — только смотреть глазами.
    // ⚠️ Читается так только потому, что мод держит модель НА САМОМ ИГРОКЕ
    // (HANDLE MODELS ON SEPARATE ENT = 0). С отдельной сущностью здесь лежал бы
    // исходный боец, а настоящую модель пришлось бы искать у той сущности.
    new model[32], view[64]
    get_user_info(target, "model", model, charsmax(model))
    pev(target, pev_viewmodel2, view, charsmax(view))
    console_print(id, "  облик=%s руки=%s", model, view)

    // Кредиты и ночное зрение — по ним видно, вернулось ли купленное в новом
    // раунде и не списали ли за возврат второй раз (tools/test-keep.mjs).
    console_print(id, "  кредиты=%d свет=%d",
        zp_get_user_ammo_packs(target), zp_get_user_nightvision(target) ? 1 : 0)

    for (new i = 0; i < sizeof g_class_names; i++)
        console_print(id, "  %-12s номер %d%s", g_class_names[i], g_class_id[i], g_class_id[i] == cls ? "  <- текущий" : "")

    return PLUGIN_HANDLED;
}

// Применяет способность ЗА игрока, минуя откат: проверяем саму способность, а
// не таймер. Откат после этого всё равно ставится — чтобы поведение совпадало.
public cmd_ability_fire(id, level, cid)
{
    if (!cmd_access(id, level, cid, 2)) return PLUGIN_HANDLED;

    new who[32]
    read_argv(1, who, charsmax(who))
    new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF)
    if (!target) { console_print(id, "нет такого игрока: %s", who); return PLUGIN_HANDLED; }

    g_ready_at[target] = 0.0
    cmd_ability(target)

    new ab = ability_for(target)
    console_print(id, "применено: %s", ab == AB_NONE ? "нечего" : g_ability_name[ab])
    return PLUGIN_HANDLED;
}

public cmd_ability(id)
{
    if (!get_pcvar_num(cvar_enabled)) return PLUGIN_HANDLED;

    if (!is_user_alive(id) || !zp_get_user_zombie(id))
    {
        tell(id, "Способности есть только у живых зомби.")
        return PLUGIN_HANDLED;
    }

    // У Дьявола и Убийцы свой набор возможностей от мода — не мешаемся.
    if (zp_get_user_nemesis(id) || zp_get_user_assassin(id))
    {
        tell(id, "У этого облика своя сила.")
        return PLUGIN_HANDLED;
    }

    new Float:now = get_gametime()
    if (now < g_ready_at[id])
    {
        set_dhudmessage(255, 160, 60, -1.0, 0.62, 0, 0.0, 1.2, 0.02, 0.2)
        show_dhudmessage(id, "Откат: %d", floatround(g_ready_at[id] - now, floatround_ceil))
        return PLUGIN_HANDLED;
    }

    new ab = ability_for(id)
    if (ab == AB_NONE)
    {
        tell(id, "У вашего класса нет активной способности.")
        return PLUGIN_HANDLED;
    }

    switch (ab)
    {
        case AB_LEAP:   do_leap(id)
        case AB_SPEED:  do_speed(id)
        case AB_POISON: do_poison(id)
        case AB_SHIELD: do_shield(id)
        case AB_BATS:   do_bats(id)
        case AB_SPRINT: do_sprint(id)
        // Двойной прыжок жмётся Пробелом в воздухе, а не кнопкой способности,
        // поэтому сюда попасть может только через zp_ability_fire.
        case AB_DJUMP:  do_djump(id)
    }

    g_ready_at[id] = now + get_pcvar_float(cvar_cooldown)

    set_dhudmessage(120, 255, 120, -1.0, 0.62, 0, 0.0, 1.2, 0.02, 0.2)
    show_dhudmessage(id, "%s", g_ability_name[ab])

    new name[32]
    get_user_name(id, name, charsmax(name))
    zlog("СПОСОБНОСТЬ: %s применил «%s»", name, g_ability_name[ab])

    return PLUGIN_HANDLED;
}

// Все игровые события пишем в ОТДЕЛЬНЫЙ файл, а не в общий журнал сервера:
// в нём они тонут между строками движка, а консоль уезжает за секунды.
// Файл: addons/amxmodx/logs/zp_actions.log
zlog(const fmt[], any:...)
{
    if (!get_pcvar_num(cvar_log)) return;

    static msg[256]
    vformat(msg, charsmax(msg), fmt, 2)
    log_to_file("zp_actions.log", "%s", msg)
}

// ── видимая часть способностей ──────────────────────────────────────────────────
//
// Способность, которую не видно, читается как «ничего не произошло»: и сам
// игрок не понимает, сработало ли, и противник не понимает, что случилось.
// Поэтому у каждой — своё кольцо и свой цвет.
//
// ⚠️ ГЛАВНОЕ ПРО ВИДИМОСТЬ. Зомби смотрит на мир через ночное зрение мода —
// экран у него залит сплошным зелёным (проверено снимком с живого клиента).
// В такой засветке тонкая ниточка на полу не читается вообще, а кольцо у
// СВОИХ ног из первого лица просто вне кадра: смотришь вперёд, а оно внизу.
// Поэтому эффект обязан быть: (1) толстым, (2) на уровне глаз, а не пола,
// (3) не одним кольцом. Иначе игрок честно скажет «партиклов нет».

// Расходящееся кольцо. `high` поднимает его на уровень груди — так его видно
// и от первого лица, а не только со стороны.
ring(const Float:origin[3], radius, r, g, b, life = 12, width = 40, sprite = 0, Float:high = 0.0)
{
    static Float:at[3]
    at[0] = origin[0]
    at[1] = origin[1]
    at[2] = origin[2] - 20.0 + high

    message_begin(MSG_PVS, SVC_TEMPENTITY, at)
    write_byte(TE_BEAMCYLINDER)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2])
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2] + float(radius))
    write_short(sprite ? sprite : g_spr_ring)
    write_byte(0)                // начальный кадр
    write_byte(0)                // частота кадров
    write_byte(life)
    write_byte(width)
    write_byte(0)                // шум
    write_byte(r)
    write_byte(g)
    write_byte(b)
    write_byte(255)              // яркость: на зелёном экране полутон пропадает
    write_byte(0)                // скорость
    message_end()
}

// Две волны разом — по полу и на уровне груди. Одна на всё: любой способности
// нужен и след на земле, и что-то в поле зрения самого игрока.
wave(const Float:origin[3], radius, r, g, b, sprite = 0)
{
    ring(origin, radius, r, g, b, 14, 46, sprite)
    ring(origin, radius * 2 / 3, r, g, b, 10, 34, sprite, 46.0)
}

// Вспышка спрайтом прямо перед глазами: то, чего не хватало больше всего.
// Кольцо расходится в стороны и из первого лица едва задевает край кадра, а
// вспышка на уровне взгляда видна всегда.
flash(id, r, g, b, sprite = 0, scale = 16)
{
    static Float:at[3]
    pev(id, pev_origin, at)
    at[2] += 26.0

    message_begin(MSG_PVS, SVC_TEMPENTITY, at)
    write_byte(TE_SPRITE)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2])
    write_short(sprite ? sprite : g_spr_ball)
    write_byte(scale)            // размер в десятых
    write_byte(255)              // яркость
    message_end()

    // Динамический свет: единственное, что пробивает зелёную засветку насквозь.
    message_begin(MSG_PVS, SVC_TEMPENTITY, at)
    write_byte(TE_DLIGHT)
    engfunc(EngFunc_WriteCoord, at[0])
    engfunc(EngFunc_WriteCoord, at[1])
    engfunc(EngFunc_WriteCoord, at[2])
    write_byte(26)               // радиус в 10 единицах
    write_byte(r)
    write_byte(g)
    write_byte(b)
    write_byte(10)               // время жизни в десятых
    write_byte(24)               // спад
    message_end()
}

// Всплеск частиц: короткий фонтан в точке. Дёшево и хорошо читается.
burst(const Float:origin[3], r, g, b, count = 40)
{
    message_begin(MSG_PVS, SVC_TEMPENTITY, origin)
    write_byte(TE_PARTICLEBURST)
    engfunc(EngFunc_WriteCoord, origin[0])
    engfunc(EngFunc_WriteCoord, origin[1])
    engfunc(EngFunc_WriteCoord, origin[2])
    write_short(count)
    write_byte((r + g + b) / 12)   // цвет палитры: грубо, но заметно
    write_byte(20)                 // время жизни
    message_end()
}

// Свечение самого игрока на время действия. Возвращаем обычный вид отдельной
// задачей — иначе зомби светился бы до конца раунда.
glow(id, r, g, b, Float:secs)
{
    set_user_rendering(id, kRenderFxGlowShell, r, g, b, kRenderNormal, 25)
    remove_task(id + TASK_GLOW)
    set_task(secs, "glow_off", id + TASK_GLOW)
}

public glow_off(task)
{
    new id = task - TASK_GLOW
    if (is_user_connected(id)) set_user_rendering(id, kRenderFxNone, 0, 0, 0, kRenderNormal, 0)
}

// ── мыши ведьмы ─────────────────────────────────────────────────────────────────
//
// Ведьма выпускает веер летучих мышей. Мышь, попавшая в человека, тянет его к
// ведьме: смысл способности не в уроне, а в том, чтобы выдернуть человека из
// строя и подтащить к себе.
//
// Мышь — обычная сущность с моделью и своим классом имени. По классу на неё и
// вешаются касание и «подумать»: так мы не перехватываем чужие сущности.

do_bats(id)
{
    if (!g_bat_ready)
    {
        tell(id, "Мыши не готовы: нет модели.")
        return;
    }

    static Float:eyes[3], Float:angles[3]
    pev(id, pev_origin, eyes)
    pev(id, pev_v_angle, angles)
    eyes[2] += 16.0

    new count = get_pcvar_num(cvar_bats_count)
    new Float:spread = get_pcvar_float(cvar_bats_spread)

    // Веером: крайние мыши уходят вбок, средняя летит прямо. Так способность
    // накрывает группу, а не требует прицела в одного.
    for (new i = 0; i < count; i++)
    {
        new Float:yaw = angles[1] + (float(i) - float(count - 1) / 2.0) * spread
        bat(id, eyes, angles[0], yaw)
    }

    emit_sound(id, CHAN_VOICE, SND_BATS, 1.0, ATTN_NORM, 0, PITCH_HIGH)
    wave(eyes, 90, 200, 60, 255, g_spr_ball)
    flash(id, 200, 60, 255, g_spr_ball, 20)
}

bat(owner, const Float:from[3], Float:pitch, Float:yaw)
{
    new ent = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, "info_target"))
    if (!ent) return;

    set_pev(ent, pev_classname, BAT_CLASS)
    engfunc(EngFunc_SetModel, ent, MODEL_BAT)
    set_pev(ent, pev_movetype, MOVETYPE_FLY)
    set_pev(ent, pev_solid, SOLID_TRIGGER)
    set_pev(ent, pev_owner, owner)

    static Float:mins[3], Float:maxs[3]
    mins[0] = -4.0; mins[1] = -4.0; mins[2] = -4.0
    maxs[0] = 4.0;  maxs[1] = 4.0;  maxs[2] = 4.0
    engfunc(EngFunc_SetSize, ent, mins, maxs)
    engfunc(EngFunc_SetOrigin, ent, from)

    static Float:ang[3], Float:dir[3]
    ang[0] = pitch; ang[1] = yaw; ang[2] = 0.0
    engfunc(EngFunc_MakeVectors, ang)
    global_get(glb_v_forward, dir)

    new Float:speed = get_pcvar_float(cvar_bats_speed)
    dir[0] *= speed; dir[1] *= speed; dir[2] *= speed
    set_pev(ent, pev_velocity, dir)
    set_pev(ent, pev_angles, ang)

    // Крылья машут, иначе мышь летит бревном.
    set_pev(ent, pev_sequence, 0)
    set_pev(ent, pev_framerate, 1.0)
    set_pev(ent, pev_animtime, get_gametime())

    // Живёт недолго: пролетевшая мимо мышь не должна кружить по карте.
    set_pev(ent, pev_nextthink, get_gametime() + get_pcvar_float(cvar_bats_life))
}

public fw_bat_think(ent)
{
    if (pev_valid(ent)) engfunc(EngFunc_RemoveEntity, ent)
}

public fw_bat_touch(ent, other)
{
    if (!pev_valid(ent) || !is_user_alive(other)) return;

    new owner = pev(ent, pev_owner)

    // Свои не в счёт: мышь пролетает сквозь зомби и сквозь саму ведьму.
    if (other == owner || zp_get_user_zombie(other))
    {
        return;
    }

    if (is_user_connected(owner))
    {
        // ⚠️ РАНЬШЕ БЫЛ ОДИН ТОЛЧОК. Мышь придавала скорость в сторону ведьмы и
        // исчезала — человек делал полшага и шёл дальше, способность читалась
        // как «слегка подтолкнуло». Владелец попросил, чтобы мышь ЗАХВАТЫВАЛА
        // цель и вела её. Теперь ставим захват на время и тянем каждый тик.
        grab_start(other, owner)

        static Float:his[3]
        pev(other, pev_origin, his)
        ring(his, 50, 200, 60, 255, 10, 12, g_spr_ball)
        client_print_color(other, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Мышь вцепилась — вас тащит к ведьме!")
        zlog("СПОСОБНОСТЬ: мышь дотянулась до %n", other)
    }

    engfunc(EngFunc_RemoveEntity, ent)
}

// ── захват мышью ────────────────────────────────────────────────────────────────

grab_start(victim, witch)
{
    g_pull_to[victim] = witch
    g_pull_end[victim] = get_gametime() + get_pcvar_float(cvar_bats_hold)

    // Задача одна на жертву: повторный укус только продлевает срок, а не
    // заводит второго тягача — иначе двойная скорость и жертва улетает мимо.
    if (!task_exists(victim + TASK_PULL)) set_task(0.1, "pull_step", victim + TASK_PULL, _, _, "b")
}

grab_stop(victim)
{
    g_pull_to[victim] = 0
    g_pull_end[victim] = 0.0
    remove_task(victim + TASK_PULL)
}

public pull_step(task)
{
    new victim = task - TASK_PULL
    new witch = g_pull_to[victim]

    // Всё, что делает захват бессмысленным: кто-то вышел, умер, жертва сама
    // стала зомби или срок вышел.
    if (!is_user_alive(victim) || !is_user_alive(witch) || zp_get_user_zombie(victim)
        || get_gametime() >= g_pull_end[victim])
    {
        grab_stop(victim)
        return;
    }

    static Float:his[3], Float:mine[3], Float:vel[3]
    pev(victim, pev_origin, his)
    pev(witch, pev_origin, mine)

    vel[0] = mine[0] - his[0]
    vel[1] = mine[1] - his[1]
    new Float:len = floatsqroot(vel[0] * vel[0] + vel[1] * vel[1])

    // Дотащили — отпускаем сами: у ног ведьмы тянуть уже некуда, а продолжать
    // значит вбивать жертву в неё и растаскивать столкновением.
    if (len <= get_pcvar_float(cvar_bats_near))
    {
        grab_stop(victim)
        return;
    }

    new Float:force = get_pcvar_float(cvar_bats_pull)
    vel[0] = vel[0] / len * force
    vel[1] = vel[1] / len * force

    // Вверх подкидываем только пока жертва на земле: в воздухе добавка копится
    // и человек улетает свечкой.
    pev(victim, pev_velocity, mine)
    vel[2] = (pev(victim, pev_flags) & FL_ONGROUND) ? force / 4.0 : mine[2]
    set_pev(victim, pev_velocity, vel)

    // Видимая нить от жертвы к ведьме: без неё непонятно, кто и куда тащит.
    message_begin(MSG_PVS, SVC_TEMPENTITY, his)
    write_byte(TE_BEAMENTS)
    write_short(victim)
    write_short(witch)
    write_short(g_spr_ring)
    write_byte(0)        // начальный кадр
    write_byte(0)        // кадров в секунду
    write_byte(2)        // жизнь, десятые доли
    write_byte(8)        // толщина
    write_byte(0)        // дрожь
    write_byte(200)
    write_byte(60)
    write_byte(255)
    write_byte(180)      // яркость
    write_byte(0)        // скорость бега по нити
    message_end()
}

// Рёв: расшвыривает людей вокруг. Урона нет — это способ разорвать строй, а
// не убить, иначе класс перекрывал бы всё остальное.

// Второй прыжок в воздухе. Не толчок по взгляду, а именно прыжок: гасим
// падение и подбрасываем вверх, иначе на спуске способность почти не работает.
do_djump(id)
{
    static Float:vel[3]
    pev(id, pev_velocity, vel)
    if (vel[2] < 0.0) vel[2] = 0.0
    vel[2] += float(get_pcvar_num(cvar_djump_force))
    set_pev(id, pev_velocity, vel)

    static Float:o[3]
    pev(id, pev_origin, o)
    wave(o, 70, 120, 200, 255)
    flash(id, 120, 200, 255)
    emit_sound(id, CHAN_VOICE, SND_LEAP, 0.7, ATTN_NORM, 0, PITCH_HIGH)
}

do_leap(id)
{
    static Float:angles[3], Float:velocity[3]
    pev(id, pev_v_angle, angles)
    angles[0] = -14.0    // немного вверх, иначе рывок утыкается в пол
    velocity_by_aim(id, get_pcvar_num(cvar_leap_force), velocity)
    set_pev(id, pev_velocity, velocity)

    static Float:o[3]
    pev(id, pev_origin, o)
    wave(o, 90, 255, 200, 60)
    flash(id, 255, 200, 60)
    emit_sound(id, CHAN_VOICE, SND_LEAP, 0.8, ATTN_NORM, 0, PITCH_NORM)
}

do_speed(id)
{
    static Float:o[3]
    pev(id, pev_origin, o)
    wave(o, 100, 90, 255, 120)
    flash(id, 90, 255, 120)
    glow(id, 60, 255, 120, 5.0)
    emit_sound(id, CHAN_VOICE, SND_SPEED, 1.0, ATTN_NORM, 0, PITCH_NORM)

    g_speed_on[id] = true
    g_sprint_on[id] = false
    ExecuteHamB(Ham_Player_ResetMaxSpeed, id)
    remove_task(id + TASK_END)
    set_task(5.0, "end_speed", id + TASK_END)
}

// Спринт: то же ускорение, но заметно сильнее и дольше — это способность за
// привилегию, и она должна отличаться от бесплатной не только названием.
do_sprint(id)
{
    static Float:o[3]
    pev(id, pev_origin, o)
    wave(o, 120, 255, 220, 60)
    burst(o, 255, 220, 60, 35)
    flash(id, 255, 220, 60, _, 20)
    glow(id, 255, 200, 60, 7.0)
    emit_sound(id, CHAN_VOICE, SND_SPRINT, 1.0, ATTN_NORM, 0, PITCH_NORM)

    g_speed_on[id] = true
    g_sprint_on[id] = true
    ExecuteHamB(Ham_Player_ResetMaxSpeed, id)
    remove_task(id + TASK_END)
    set_task(7.0, "end_speed", id + TASK_END)
}

public end_speed(taskid)
{
    new id = taskid - TASK_END
    g_speed_on[id] = false
    g_sprint_on[id] = false
    if (is_user_alive(id)) ExecuteHamB(Ham_Player_ResetMaxSpeed, id)
}

do_shield(id)
{
    static Float:o[3]
    pev(id, pev_origin, o)

    wave(o, 110, 60, 90, 255, g_spr_slow)
    burst(o, 60, 90, 255, 25)
    flash(id, 60, 90, 255, g_spr_slow, 20)
    emit_sound(id, CHAN_VOICE, SND_SHIELD, 1.0, ATTN_NORM, 0, PITCH_LOW)

    g_shield_on[id] = true
    set_user_rendering(id, kRenderFxGlowShell, 40, 40, 200, kRenderNormal, 16)
    remove_task(id + TASK_END)
    set_task(5.0, "end_shield", id + TASK_END)
}

public end_shield(taskid)
{
    new id = taskid - TASK_END
    g_shield_on[id] = false
    if (is_user_alive(id)) set_user_rendering(id)
}


do_poison(id)
{
    // Облако встаёт ЗДЕСЬ и здесь остаётся: это площадь, куда человеку нельзя
    // соваться, а не аура, бегающая за зомби.
    pev(id, pev_origin, g_cloud_at[id])
    burst(g_cloud_at[id], 120, 255, 60, 50)
    flash(id, 120, 255, 60, _, 22)

    emit_sound(id, CHAN_VOICE, SND_POISON, 1.0, ATTN_NORM, 0, PITCH_NORM)

    g_poison_hit[id] = 0
    g_poison_left[id] = 8    // 8 тиков по 0.5 с = 4 секунды
    remove_task(id + TASK_POISON)
    set_task(0.5, "poison_tick", id + TASK_POISON, _, _, "b")
    poison_tick(id + TASK_POISON)   // первый клуб сразу, а не через полсекунды
}

public poison_tick(taskid)
{
    new id = taskid - TASK_POISON

    // ⚠️ Смерть зомби облако не развеивает: оно уже выпущено и живёт свои
    // четыре секунды. А вот выход игрока прекращает всё — некому приписывать
    // урон. Раньше облако гасло вместе с прыжком владельца в сторону, и это
    // тоже читалось как «не работает».
    if (!is_user_connected(id) || g_poison_left[id] <= 0)
    {
        remove_task(taskid)
        if (is_user_connected(id) && g_poison_hit[id])
        {
            new caught = 0
            for (new v = 1; v <= 32; v++) if (g_poison_hit[id] & (1 << v)) caught++
            set_dhudmessage(120, 255, 120, -1.0, 0.66, 0, 0.0, 1.5, 0.02, 0.2)
            show_dhudmessage(id, "Отравлено: %d", caught)
            zlog("СПОСОБНОСТЬ: облако накрыло %d чел.", caught)
        }
        g_poison_left[id] = 0
        return;
    }
    g_poison_left[id]--

    static Float:origin[3]
    origin[0] = g_cloud_at[id][0]
    origin[1] = g_cloud_at[id][1]
    origin[2] = g_cloud_at[id][2]

    // Кольцо на каждом тике, а не одно на бросок: четыре секунды подряд видно,
    // где стоит яд.
    wave(origin, get_pcvar_num(cvar_poison_radius), 120, 255, 60)

    new Float:radius = float(get_pcvar_num(cvar_poison_radius))
    new dmg = get_pcvar_num(cvar_poison_dmg)

    new players[32], num
    get_players(players, num, "a")

    for (new i = 0; i < num; i++)
    {
        new victim = players[i]
        if (zp_get_user_zombie(victim)) continue;

        static Float:pos[3]
        pev(victim, pev_origin, pos)
        if (get_distance_f(origin, pos) > radius) continue;

        // Через Ham, а не set_user_health: так срабатывают все чужие обработчики
        // урона — счёт, показ урона, защита. Иначе они просто не узнают.
        ExecuteHamB(Ham_TakeDamage, victim, 0, id, float(dmg), DMG_POISON)

        g_poison_hit[id] |= (1 << victim)

        // Человек должен ПОНЯТЬ, что его травят. Три приметы разом: экран
        // зеленеет, ноги вязнут, и один раз приходит строка. Без них яд
        // отличался от обычного урона только цифрой.
        g_slow_until[victim] = get_gametime() + 1.2
        green_screen(victim)
        if (!g_told_poison[victim])
        {
            g_told_poison[victim] = true
            client_print_color(victim, print_team_default,
                "^x04[Вспышка эпидемии]^x01 Вы в ^x04ядовитом облаке^x01 — уходите, оно травит и вяжет ноги.")
        }
    }

    // Зелёное облако вокруг зомби.
    engfunc(EngFunc_MessageBegin, MSG_PVS, SVC_TEMPENTITY, origin, 0)
    write_byte(TE_SMOKE)
    engfunc(EngFunc_WriteCoord, origin[0])
    engfunc(EngFunc_WriteCoord, origin[1])
    engfunc(EngFunc_WriteCoord, origin[2] - 20.0)
    write_short(engfunc(EngFunc_PrecacheModel, "sprites/steam1.spr"))
    write_byte(20)
    write_byte(10)
    message_end()
}

public fw_TakeDamage(victim, inflictor, attacker, Float:damage, damagebits)
{
    if (!g_shield_on[victim]) return HAM_IGNORED;

    SetHamParamFloat(4, damage * 0.5)
    return HAM_HANDLED;
}

public fw_ResetSpeed_Post(id)
{
    if (!is_user_alive(id)) return;

    static Float:speed
    pev(id, pev_maxspeed, speed)
    if (speed <= 1.0) return;   // связан, заморожен, в покупке — не трогаем

    // Яд вяжет ноги. Ставится здесь, а не в тике: мод пересчитывает скорость
    // сам, и разовое значение он бы стёр.
    if (g_slow_until[id] > get_gametime())
    {
        set_pev(id, pev_maxspeed, speed * 0.55)
        return;
    }

    if (!g_speed_on[id]) return;

    new bonus = g_sprint_on[id] ? get_pcvar_num(cvar_sprint_bonus) : get_pcvar_num(cvar_speed_bonus)
    set_pev(id, pev_maxspeed, speed + float(bonus))
}

// Экран жертвы зеленеет на полсекунды. Дешевле любого спрайта и, в отличие от
// него, виден всегда — даже если облако осталось за спиной.
green_screen(id)
{
    if (!g_msg_fade) return;

    message_begin(MSG_ONE_UNRELIABLE, g_msg_fade, _, id)
    write_short(1 << 11)      // сколько гаснет: 1<<12 — это секунда
    write_short(1 << 11)      // сколько держится
    write_short(0)            // обычное затухание, не «в чёрное»
    write_byte(0)
    write_byte(190)
    write_byte(0)
    write_byte(80)            // прозрачность: сквозь такое ещё видно игру
    message_end()
}

tell(id, const msg[])
{
    if (g_quiet) return;
    client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 %s", msg)
}
