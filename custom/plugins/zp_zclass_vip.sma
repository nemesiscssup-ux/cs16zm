/*
 * [ZP] Классы зомби под привилегии.
 *
 * Шесть классов по покупаемым уровням. Взять их может только тот, у кого есть
 * уровень: сам мод доступ к классам не разграничивает, поэтому проверку делаем
 * сами — в момент заражения, когда мод уже выбрал класс.
 *
 *   Ганимед         VIP        разгон
 *   Ревенант Огонь  Лидер      огненный шар
 *   Ревенант Лёд    Император  паралич
 *   Ревенант Яд     Фараон     ядовитый шар
 *
 * ⚠️ РОВНО ОДИН КЛАСС НА УРОВЕНЬ — так попросил владелец 12 августа 2026.
 * Спринтер и Шаман были за VIP и Лидера и открыты ВСЕМ: они по-прежнему
 * регистрируются здесь и в cso_class_shaman, но охраны на них больше нет.
 *
 * Раскладку по уровням задал владелец. Она НЕ обязана расти по здоровью:
 * флаги накопительные, и Лидеру остаётся всё, что открыто VIP, поэтому
 * «свой» класс уровня может оказаться слабее уже доступного.
 *
 * Способности к ним раздаёт zp_class_abilities.sma — он ищет классы ПО ИМЕНИ,
 * так что имена ниже и там должны совпадать буква в букву.
 *
 * Модели проверены глазами и распаковщиком: у отброшенных (tank, scarecrow)
 * текстуры больше 512 точек, GoldSrc такие не тянет.
 */

#include <amxmodx>
#include <amxmisc>
#include <cstrike>
#include <fakemeta>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Классы привилегий"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

#define VIP       ADMIN_LEVEL_H
#define LEADER    ADMIN_LEVEL_G
#define IMPERATOR ADMIN_LEVEL_E
#define PHARAOH   ADMIN_LEVEL_D
#define CREATOR   ADMIN_LEVEL_C

// ZCLAW — своя модель рук. У КАЖДОГО класса она должна быть своя: две
// одинаковые лапы игрок читает как «класс не встал», и именно на это
// жаловался владелец. Список свободных лап смотреть распаковщиком по
// quarantine — там их с запасом, просто не все попали в перенос.
// ZINFO — вторая строка пункта меню. По просьбе владельца там теперь не
// описание, а уровень: в меню классов важнее знать, кому класс доступен.
enum _:ZC { ZNAME[32], ZINFO[48], ZMODEL[40], ZCLAW[40], ZFLAG, ZHP, ZSPEED, Float:ZGRAV, Float:ZKNOCK }

// Здоровье поднято вместе со штатными классами — примерно в полтора раза. До
// чужих 5000 всё равно не доводим: класс должен давать облик и способность, а
// не превращать раунд в избиение.
// Остался один: Шокера, Охотника, Костяного и Ревенанта владелец попросил
// убрать — их способности повторяли друг друга и читались хуже, чем у
// перенесённых классов CSO, у которых свои снаряды и свои эффекты.
//
// ⚠️ ZFLAG = 0 означает «доступен всем»: `flag_of` вернёт ноль, и охрана ниже
// такой класс пропустит. Спринтер стоял за VIP и открыт всем — плагин остался
// на месте, потому что кроме своего класса он ведёт охрану ЧУЖИХ.
new const g_classes[][ZC] = {
    // Лапа своя, не общая с Электриком: одинаковые руки у двух классов игрок
    // читает как «класс не встал». Бледная рука со светящимися язвами.
    { "Спринтер", "\rСпринт (E)", "zm_hot_z_sprinter", "v_hand_jumper_jp.mdl", 0, 2100, 300, 0.80, 1.30 },
}

new g_id[sizeof g_classes]

// Классы, которые регистрируют ДРУГИЕ плагины (перенесённые из «Казахского
// Пирога»): у каждого своя способность со своими эффектами, и охрана по
// уровню им нужна такая же. Здесь только имя и уровень — всё остальное живёт
// в своём плагине. Номер класса узнаём у мода по имени уже после регистрации.
// ⚠️ ДВА МАССИВА ЧИТАЮТСЯ ПО ОДНОМУ И ТОМУ ЖЕ НОМЕРУ. Переставите имя, не
// переставив уровень, — класс молча откроется не тому, и увидит это игрок, а не
// мы. Строка уровня видна и в меню классов: её задаёт zclass_info в самом
// плагине класса (cso_class_*.sma), и она обязана совпадать со здешней.
// ⚠️ Шаман здесь БОЛЬШЕ НЕ ЧИСЛИТСЯ — он открыт всем. Плагин cso_class_shaman
// на месте и класс регистрирует; отсутствие имени в этом списке и означает
// «охраны нет». Вернёте имя — не забудьте про подпись в patch-ported.mjs и про
// место в CLASS_ORDER, иначе меню и охрана разойдутся.
new const g_foreign[][] = { "Ганимед", "Ревенант Огонь", "Ревенант Лёд", "Ревенант Яд" }
new const g_foreign_flag[] = { VIP,     LEADER,          IMPERATOR,      PHARAOH }
new g_foreign_id[sizeof g_foreign]
new cvar_enabled, cvar_log

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    cvar_enabled = register_cvar("zp_zclass_vip", "1")
    cvar_log     = register_cvar("zp_log_actions", "1")

    // Поставить игроку класс из консоли. Нужна по делу — вернуть застрявшего к
    // обычному, показать новичку класс — и для проверки: иначе увидеть, какая
    // модель встала на самом деле, можно только сев за клиент.
    register_concmd("zp_class_set", "cmd_set", ADMIN_LEVEL_A, "<ник> <номер класса> — поставить класс зомби")

    // ⚠️ Когти зомби — обычная v-модель, а в ней бывает НЕСКОЛЬКО подмоделей:
    // у толстяка это рука, китайский тесак и кувалда «джаггернаут». Какая
    // видна, решает pev_body, и его же крутят перенесённые стволы под свои
    // модели. Значение остаётся на игроке после смены оружия, поэтому лапа
    // толстяка доставалась то кувалдой, то тесаком. Возвращаем нулевую
    // подмодель — руку — на каждое взятие ножа в руки.
    // 29 = CSW_KNIFE.
    register_event("CurWeapon", "event_knife", "be", "1=1", "2=29")
}

public event_knife(id)
{
    if (!is_user_alive(id) || !zp_get_user_zombie(id)) return;
    if (pev(id, pev_body) != 0) set_pev(id, pev_body, 0)
}

public cmd_set(id, level, cid)
{
    if (!cmd_access(id, level, cid, 3)) return PLUGIN_HANDLED;

    new who[32], what[8]
    read_argv(1, who, charsmax(who))
    read_argv(2, what, charsmax(what))

    new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF)
    if (!target) return PLUGIN_HANDLED;

    new n = str_to_num(what)
    zp_set_user_zombie_class(target, n)

    // ⚠️ Мод берёт класс ТОЛЬКО в момент заражения: живому зомби смена класса
    // ничего не меняет до следующего раза. Поэтому расчеловечиваем и заражаем
    // заново — иначе команда выглядит сломанной, хотя класс уже стоит.
    if (is_user_alive(target))
    {
        if (zp_get_user_zombie(target)) zp_disinfect_user(target, 1)
        zp_infect_user(target, 0, 1, 0)
    }
    set_task(2.0, "check_class", target)

    console_print(id, "[ZP] %s -> класс %d", who, n)
    return PLUGIN_HANDLED;
}

public check_class(id)
{
    if (!is_user_connected(id)) return;

    // ⚠️ Лапу видно ТОЛЬКО с ножом в руках: с гранатой в pev_viewmodel2 лежит
    // граната, и в журнале это выглядит как «класс дал не ту лапу». Зомби
    // грызут и швыряются постоянно, поэтому сначала берём нож, потом смотрим.
    if (is_user_alive(id) && get_user_weapon(id) != CSW_KNIFE)
    {
        engclient_cmd(id, "weapon_knife")
        set_task(0.5, "log_class", id)
        return;
    }
    log_class(id)
}

public log_class(id)
{
    if (!is_user_connected(id)) return;

    new name[32], mdl[64], claw[80]
    get_user_name(id, name, charsmax(name))
    if (!is_user_alive(id)) copy(mdl, charsmax(mdl), "мёртв")
    else cs_get_user_model(id, mdl, charsmax(mdl))

    // Лапу пишем рядом с моделью: одинаковые руки у двух классов иначе видно
    // только глазами из игры, а это как раз то, на что жаловался владелец.
    pev(id, pev_viewmodel2, claw, charsmax(claw))
    replace(claw, charsmax(claw), "models/zombie_plague_v44/", "")

    zlog("КЛАСС: на %s класс %d, модель «%s», лапа «%s»", name, zp_get_user_zombie_class(id), mdl, claw)
}

public plugin_precache()
{
    // Регистрировать классы можно только здесь: мод собирает их список до
    // старта карты, позже добавленный класс в меню не попадёт.
    for (new i = 0; i < sizeof g_classes; i++)
    {
        new path[80]
        formatex(path, charsmax(path), "models/player/%s/%s.mdl", g_classes[i][ZMODEL], g_classes[i][ZMODEL])

        // Нет файла — класс просто не регистрируем. Мод на отсутствующей модели
        // роняет сервер при первом же заражении.
        if (!file_exists(path))
        {
            g_id[i] = -1
            log_amx("нет модели класса «%s»: %s", g_classes[i][ZNAME], path)
            continue;
        }

        // Коготь мод ищет в СВОЁМ каталоге models/zombie_plague_v44/, поэтому
        // передаём только имя файла — путь он подставит сам.
        g_id[i] = zp_register_zombie_class(g_classes[i][ZNAME], g_classes[i][ZINFO],
            g_classes[i][ZMODEL], g_classes[i][ZCLAW],
            g_classes[i][ZHP], g_classes[i][ZSPEED], g_classes[i][ZGRAV], g_classes[i][ZKNOCK])
    }
}

// Номера чужих классов узнаём здесь: к plugin_cfg мод уже собрал весь список,
// а во время plugin_precache порядок регистрации плагинов не определён.
public plugin_cfg()
{
    for (new i = 0; i < sizeof g_foreign; i++)
    {
        g_foreign_id[i] = zp_get_zombie_class_id(g_foreign[i])
        if (g_foreign_id[i] == -1)
            log_amx("класс «%s» не найден — охрана по уровню для него не работает", g_foreign[i])
    }
}

// Уровень, который открывает класс, или 0 если класс не наш.
flag_of(classid)
{
    for (new i = 0; i < sizeof g_classes; i++)
        if (g_id[i] != -1 && g_id[i] == classid) return g_classes[i][ZFLAG];
    for (new i = 0; i < sizeof g_foreign; i++)
        if (g_foreign_id[i] != -1 && g_foreign_id[i] == classid) return g_foreign_flag[i];
    return 0;
}

name_of(classid)
{
    static s[32]
    copy(s, charsmax(s), "")
    for (new i = 0; i < sizeof g_classes; i++)
        if (g_id[i] != -1 && g_id[i] == classid) copy(s, charsmax(s), g_classes[i][ZNAME])
    for (new i = 0; i < sizeof g_foreign; i++)
        if (g_foreign_id[i] != -1 && g_foreign_id[i] == classid) copy(s, charsmax(s), g_foreign[i])
    return s;
}

// Мод сам доступ к классам не проверяет: в меню классов видны все. Ловим на
// заражении — к этому моменту класс уже выбран, и его можно подменить.
public zp_user_infected_post(id, infector, nemesis)
{
    if (!get_pcvar_num(cvar_enabled) || !is_user_connected(id)) return;

    new cls = zp_get_user_zombie_class(id)
    new flag = flag_of(cls)
    if (!flag) return;

    if (get_user_flags(id) & flag) return;

    // Класс не по уровню — возвращаем к обычному и говорим об этом вслух:
    // молчаливая подмена выглядит как поломка мода.
    new was[32]
    copy(was, charsmax(was), name_of(cls))

    zp_set_user_zombie_class(id, 0)
    client_print_color(id, print_team_default,
        "^x04[Вспышка эпидемии]^x01 Класс ^x04%s^x01 открывает привилегия. Вернули обычного — со следующего заражения.", was)

    new who[32]
    get_user_name(id, who, charsmax(who))
    zlog("КЛАСС: %s взял «%s» без уровня — возвращён к обычному", who, was)
}

zlog(const fmt[], any:...)
{
    if (!get_pcvar_num(cvar_log)) return;

    static msg[256]
    vformat(msg, charsmax(msg), fmt, 2)
    log_to_file("zp_actions.log", "%s", msg)
}
