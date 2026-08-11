/*
 * [ZP] Привилегии: меню и постоянные бонусы.
 *
 * Четыре уровня, каждый включает всё, что даёт предыдущий:
 *
 *   VIP          ADMIN_LEVEL_H  буква t   +кредиты, +здоровье, ножи и скины
 *   Лидер        ADMIN_LEVEL_G  буква s   больше того же, ещё ножи и скины
 *   Император    ADMIN_LEVEL_E  буква q   ещё больше, свой нож и скин
 *   Фараон       ADMIN_LEVEL_D  буква p   верхний ПОКУПАЕМЫЙ: все ножи, «Легенда»
 *   Создатель    ADMIN_LEVEL_C  буква o   главный админ: НЕ продаётся, открыто всё
 *
 * БУКВЫ НЕ СОВПАДАЮТ С НАЗВАНИЕМ КОНСТАНТЫ: ADMIN_LEVEL_H — это «t», а не
 * «h». Сверено по amxconst.inc; на созвучии тут обжигаются все.
 *
 * Флаги те же, что в чужих сборках (ADMIN_LEVEL_H/G/E/C), поэтому одна запись
 * в users.ini открывает разом ножи, скины и оружие своего уровня — плагины
 * оружия из тех сборок проверяют ровно эти флаги.
 *
 * В users.ini буквы НАКОПИТЕЛЬНЫЕ: allowed() в ножах и скинах проверяет ровно
 * тот бит, что записан у вещи, поэтому Создателю нужна строка «oqst», иначе
 * ножи и скины младших уровней ему закрыты. Строку считает панель выдачи
 * (admin.cmd) и tools/add-admin.mjs --flags.
 *
 * Меню: пункт «7. Привилегии» в меню по клавише M, команда zp_vip, чат /вип.
 * Это ещё и вход в выбор ножа и скина: то и другое — часть привилегии, и
 * искать их по разным углам меню игроку незачем. Уровни показаны все, включая
 * те, которых у игрока нет, — иначе не видно, куда расти.
 */

#include <amxmodx>
#include <zm_menu>
#include <amxmisc>
#include <fun>
#include <hamsandwich>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Привилегии"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

enum _:TIER { TNAME[32], TFLAG, PACKS, HEALTH, KNIVES, TSKIN[24], SOLD }

// PACKS — кредиты при каждом возрождении, HEALTH — прибавка к здоровью
// человека, KNIVES — сколько ножей открыто на этом уровне (из одиннадцати),
// TSKIN — ОБЛИК уровня, SOLD — продаётся ли уровень игрокам.
//
// ⚠️ Раньше здесь было ЧИСЛО открытых скинов: уровень открывал сразу несколько,
// и игрок выбирал в меню. По просьбе владельца теперь у каждого уровня РОВНО
// ОДИН облик, он надевается сам, а остальные скины продаются за кредиты.
// Названия должны совпадать с таблицей в zp_skins.sma — их сверяет verify-ru.
//
// Создатель стоит НАД лестницей: это главный администратор. У него открыто всё,
// но игрокам он не продаётся — верхний покупаемый уровень Фараон.
// Самый длинный пункт текущего меню: по нему считается, сколько их влезет
// на страницу (см. include/zm_menu.inc).
new g_longest

new const g_tiers[][TIER] = {
    { "VIP",        ADMIN_LEVEL_H,  3,  25,  7, "Форма VIP", 1 },
    { "Лидер",      ADMIN_LEVEL_G,  6,  50,  9, "Форма 9",   1 },
    { "Император",  ADMIN_LEVEL_E, 10,  75, 10, "Отпускник", 1 },
    { "Фараон",     ADMIN_LEVEL_D, 15, 100, 11, "Фараон",    1 },
    { "Создатель",  ADMIN_LEVEL_C, 20, 150, 11, "Создатель", 0 },
}

// ── что уровень даёт ПО ЗАПРОСУ ─────────────────────────────────────────────────
//
// Кроме прибавки на возрождении у каждого уровня есть три «кнопки»: взять
// кредитов, здоровья, брони. Они не бесконечные — раз в несколько раундов.
//
// ⚠️ ОТДЕЛЬНОЙ ТАБЛИЦЕЙ, а не столбцами в g_tiers: ту таблицу построчно
// сверяет verify-ru с панелью выдачи, и лишние поля сломали бы сверку. Здесь
// же порядок строк тот же — i-я строка про i-й уровень.
enum _:PERK { PCREDITS, PHP, PARMOR }
new const g_perks[][PERK] = {
    {  8,  25,  25 },   // VIP
    { 15,  40,  40 },   // Лидер
    { 25,  60,  60 },   // Император
    { 40,  85,  85 },   // Фараон
    { 60, 120, 100 },   // Создатель
}

new cvar_enabled, cvar_log, cvar_adm_packs, cvar_adm_hp
new cvar_perk_rounds, cvar_hp_cap, cvar_armor_cap
new bool:g_bonus_done[33]    // прибавка за эту жизнь уже выдана

// Номер текущего раунда и номер раунда, в котором игрок брал каждую из трёх
// кнопок. Ноль — не брал ни разу.
new g_round
new g_took_packs[33], g_took_hp[33], g_took_armor[33]

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    cvar_enabled = register_cvar("zp_vip", "1")
    cvar_log     = register_cvar("zp_log_actions", "1")

    // Прибавка за админку — сверх уровня. Админка продаётся, и покупатель
    // должен получать не только права, но и что-то в игре.
    // Через сколько раундов кнопку можно нажать снова. Одно число на все три:
    // разные сроки игрок всё равно не удержит в голове.
    cvar_perk_rounds = register_cvar("zp_vip_perk_rounds", "10")
    // Потолки: без них Фараон за раунд набирал бы себе тысячу здоровья.
    cvar_hp_cap    = register_cvar("zp_vip_hp_cap", "400")
    cvar_armor_cap = register_cvar("zp_vip_armor_cap", "200")

    cvar_adm_packs = register_cvar("zp_admin_bonus_packs", "5")
    cvar_adm_hp    = register_cvar("zp_admin_bonus_hp", "50")

    register_clcmd("zp_vip", "cmd_menu")
    register_clcmd("say /вип", "cmd_menu")
    register_clcmd("say /vip", "cmd_menu")
    register_clcmd("say_team /вип", "cmd_menu")

    // Возрождение — главный случай: на старте раунда игрок появляется человеком
    // сразу, и превращения, которое ловит zp_user_humanized_post, не происходит.
    RegisterHam(Ham_Spawn, "player", "fw_spawn_post", 1)
}

// Высший уровень игрока, или -1. Уровни идут по возрастанию, поэтому берём
// последний подошедший: у Создателя обычно стоят и младшие флаги тоже.
tier_of(id)
{
    new flags = get_user_flags(id)
    new best = -1
    for (new i = 0; i < sizeof g_tiers; i++)
        if (flags & g_tiers[i][TFLAG]) best = i
    return best;
}

// Бонусы выдаём людям на возрождении. Зомби не трогаем: их здоровье задаёт
// класс, и прибавка к нему ломала бы баланс классов.
//
// ⚠️ ОДНОГО zp_user_humanized_post МАЛО. Он приходит только тогда, когда зомби
// СТАЛ человеком — противоядием или в конце раунда. На обычном старте раунда
// игрок появляется человеком сразу, никакого «превращения» нет, и бонус не
// выдавался вовсе: у Создателя так и оставалось 100 HP вместо 250.
public zp_user_humanized_post(id) give_bonus(id)

public fw_spawn_post(id)
{
    if (!is_user_alive(id)) return;
    g_bonus_done[id] = false
    give_bonus(id)
}

// Заразили — значит следующая «человеческая» жизнь начнётся заново.
public zp_user_infected_post(id, infector, nemesis) g_bonus_done[id] = false

// Счётчик раундов — по нему считается «раз в N раундов». Ведём свой, а не
// спрашиваем мод: у него счётчика наружу нет.
public zp_round_started(gamemode, id) g_round++

public client_disconnected(id, bool:drop, message[], maxlen)
{
    // Номера слотов переиспользуются: не сбросив, новый игрок унаследовал бы
    // чужой откат и не смог бы нажать кнопку полраунда.
    g_took_packs[id] = 0
    g_took_hp[id] = 0
    g_took_armor[id] = 0
}

public client_putinserver(id)
{
    // С задержкой: мод в этот же миг сбрасывает переменные игрока к стартовым.
    set_task(4.0, "welcome", id)
}

public welcome(id)
{
    if (!is_user_connected(id) || !get_pcvar_num(cvar_enabled)) return;

    new t = tier_of(id)
    if (t < 0) return;

    client_print_color(id, print_team_default,
        "^x04[Вспышка эпидемии]^x01 Ваш уровень: ^x04%s^x01. Что он даёт — в меню ^x04/вип",
        g_tiers[t][TNAME])
}

give_bonus(id)
{
    if (!get_pcvar_num(cvar_enabled) || !is_user_alive(id)) return;

    // Возрождение и превращение в человека могут прийти оба за одну жизнь —
    // без этой отметки прибавка легла бы дважды.
    if (g_bonus_done[id]) return;

    new t = tier_of(id)
    if (t < 0) return;

    g_bonus_done[id] = true

    new packs = g_tiers[t][PACKS]
    new hp = g_tiers[t][HEALTH]

    // Админка продаётся отдельно и сама по себе даёт прибавку: её берут не
    // только ради кика, но и как платную привилегию. Признак — флаг админ-меню
    // «u»: он есть и у купленной админки, и у полных прав.
    if (get_user_flags(id) & ADMIN_MENU)
    {
        packs += get_pcvar_num(cvar_adm_packs)
        hp += get_pcvar_num(cvar_adm_hp)
    }

    zp_set_user_ammo_packs(id, zp_get_user_ammo_packs(id) + packs)
    set_user_health(id, get_user_health(id) + hp)

    zlog("ПРИВИЛЕГИЯ: %n — уровень %s, +%d кредитов, +%d HP",
        id, g_tiers[t][TNAME], packs, hp)
}

// Сколько раундов осталось до следующего нажатия. Ноль — можно сейчас.
perk_left(took)
{
    if (!took) return 0;
    new every = get_pcvar_num(cvar_perk_rounds)
    new passed = g_round - took
    return passed >= every ? 0 : every - passed;
}

// Строка кнопки: сколько даёт и когда снова. Собираем отдельно, потому что
// Pawn не умеет выбирать между двумя строками выражением.
perk_line(dst[], len, const what[], amount, const unit[], left)
{
    if (left > 0) formatex(dst, len, "\d%s \d(+%d %s, через %d р.)", what, amount, unit, left)
    else formatex(dst, len, "\w%s \y+%d %s", what, amount, unit)
}

// ── кнопки уровня ───────────────────────────────────────────────────────────────
//
// Кредиты берём хоть мёртвым: они и так копятся. Здоровье и броню — только
// живым человеком: зомби здоровье задаёт класс, и добавка сломала бы баланс
// классов, а мёртвому лечиться нечего.
take_perk(id, const what[])
{
    if (!get_pcvar_num(cvar_enabled)) return;

    new mine = tier_of(id)
    if (mine < 0)
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Это для обладателей привилегии.")
        return;
    }

    new took = equal(what, "packs") ? g_took_packs[id]
             : equal(what, "hp") ? g_took_hp[id] : g_took_armor[id]
    new left = perk_left(took)
    if (left > 0)
    {
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Ещё рано: снова можно через ^x04%d^x01 раунд(ов).", left)
        return;
    }

    if (equal(what, "packs"))
    {
        new add = g_perks[mine][PCREDITS]
        zp_set_user_ammo_packs(id, zp_get_user_ammo_packs(id) + add)
        g_took_packs[id] = g_round
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Получено ^x04%d^x01 кредитов по уровню ^x04%s^x01.", add, g_tiers[mine][TNAME])
        zlog("ПРИВИЛЕГИЯ: %n взял %d кредитов (уровень %s)", id, add, g_tiers[mine][TNAME])
        return;
    }

    if (!is_user_alive(id) || zp_get_user_zombie(id))
    {
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Это можно взять только живым человеком.")
        return;
    }

    if (equal(what, "hp"))
    {
        new cap = get_pcvar_num(cvar_hp_cap)
        new now = get_user_health(id)
        if (now >= cap)
        {
            client_print_color(id, print_team_default,
                "^x04[Вспышка эпидемии]^x01 Здоровья и так вдоволь: потолок ^x04%d^x01.", cap)
            return;
        }
        new add = g_perks[mine][PHP]
        if (now + add > cap) add = cap - now
        set_user_health(id, now + add)
        g_took_hp[id] = g_round
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Получено ^x04+%d^x01 здоровья.", add)
        zlog("ПРИВИЛЕГИЯ: %n взял +%d HP (уровень %s)", id, add, g_tiers[mine][TNAME])
        return;
    }

    new cap = get_pcvar_num(cvar_armor_cap)
    new now = get_user_armor(id)
    if (now >= cap)
    {
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Брони и так вдоволь: потолок ^x04%d^x01.", cap)
        return;
    }
    new add = g_perks[mine][PARMOR]
    if (now + add > cap) add = cap - now
    set_user_armor(id, now + add)
    g_took_armor[id] = g_round
    client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Получено ^x04+%d^x01 брони.", add)
    zlog("ПРИВИЛЕГИЯ: %n взял +%d брони (уровень %s)", id, add, g_tiers[mine][TNAME])
}

public cmd_menu(id)
{
    if (!get_pcvar_num(cvar_enabled)) return PLUGIN_HANDLED;

    new mine = tier_of(id)

    // Отдельная переменная, а не тернарник прямо в аргументе: Pawn не умеет
    // выбирать между двумя строками выражением — «array must be indexed».
    new who[32]
    if (mine < 0) copy(who, charsmax(who), "обычный игрок")
    else copy(who, charsmax(who), g_tiers[mine][TNAME])

    new title[192]
    formatex(title, charsmax(title),
        "\y[Вспышка эпидемии]\w Привилегии^n\wВаш уровень: \y%s", who)

    g_longest = 0

    new menu = menu_create(title, "menu_pick")

    // ⚠️ СНАЧАЛА — ТО, ЧТО ЕСТЬ У ЭТОГО ИГРОКА. Раньше меню было одинаковым для
    // всех: лестница уровней и две строки «выбрать». Владелец попросил, чтобы
    // при нажатии показывались опции ЕГО привилегии, а не общий список. Свои
    // кнопки идут наверху, лестница осталась ниже — как справка «куда расти».
    if (mine >= 0)
    {
        new line[112]
        new left

        left = perk_left(g_took_packs[id])
        perk_line(line, charsmax(line), "Взять кредиты", g_perks[mine][PCREDITS], "кр.", left)
        zm_menu_seen(g_longest, line)
        menu_additem(menu, line, "packs", 0)

        left = perk_left(g_took_hp[id])
        perk_line(line, charsmax(line), "Взять здоровье", g_perks[mine][PHP], "HP", left)
        zm_menu_seen(g_longest, line)
        menu_additem(menu, line, "hp", 0)

        left = perk_left(g_took_armor[id])
        perk_line(line, charsmax(line), "Взять броню", g_perks[mine][PARMOR], "бр.", left)
        zm_menu_seen(g_longest, line)
        menu_additem(menu, line, "armor", 0)
    }

    // ⚠️ БОЛЬШЕ ЗДЕСЬ НИЧЕГО НЕТ. Было: выбор скина, выбор ножа и лестница из
    // пяти уровней со справкой по каждому. Владелец попросил убрать всё, кроме
    // своего: ножи открываются своей командой (/нож), скины — своей (/скин), а
    // чужие уровни игроку в его собственном меню ни к чему.
    if (mine < 0)
        menu_additem(menu, "\dУ вас нет привилегии", "none", 0)

    menu_setprop(menu, MPROP_EXITNAME, "Выход")
    zm_menu_fit(menu, title, g_longest)
    menu_display(id, menu)
    return PLUGIN_HANDLED;
}

public menu_pick(id, menu, item)
{
    if (item != MENU_EXIT)
    {
        // Остались только три кнопки своего уровня. Ключ строковый — сравнивать
        // надо со словами, а не числом: str_to_num("hp") вернул бы ноль.
        new info[8], name[96], access, callback
        menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback)

        if (equal(info, "packs") || equal(info, "hp") || equal(info, "armor"))
        {
            menu_destroy(menu)
            take_perk(id, info)
            return PLUGIN_HANDLED;
        }
    }

    menu_destroy(menu)
    return PLUGIN_HANDLED;
}

// Все игровые события пишем в ОТДЕЛЬНЫЙ файл, а не в общий журнал сервера:
// в нём они тонут между строками движка, а консоль уезжает за секунды.
zlog(const fmt[], any:...)
{
    if (!get_pcvar_num(cvar_log)) return;

    static msg[256]
    vformat(msg, charsmax(msg), fmt, 2)
    log_to_file("zp_actions.log", "%s", msg)
}
