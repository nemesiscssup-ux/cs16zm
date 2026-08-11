/*
 * [ZP] Скины людей под привилегии.
 *
 * Восемь моделей игрока, разложенных по уровням привилегий. Выбор
 * запоминается на диске и переживает смену карты.
 *
 * Вызов меню: пункт «Скины» в меню привилегий, команда zp_skin (удобно
 * повесить на клавишу) или в чат /скин.
 *
 * ТОЛЬКО ДЛЯ ЛЮДЕЙ. Модель зомби задаёт его класс, Дьяволу, Убийце,
 * Выжившему и Снайперу мод выдаёт свою — это роли, а не косметика.
 *
 * ПОЧЕМУ СВОЙ, А НЕ ПЕРЕНЕСЁННЫЙ. В CS-DEAD скины раздавал сам мод строками
 * ADMIN1..ADMIN4 HUMAN в zombieplague.ini — но так умеет только ZP 4.0: у
 * нашей 4.4 набор админских моделей ОДИН на всех, и разложить его по четырём
 * уровням нечем. В JUST PRO это делал zp43_custom_model.sma, но он ставит
 * модель через rg_set_user_model из ReAPI в обход мода, а мод следит за
 * моделью и возвращает свою обратно. Модели взяты из обеих сборок, код свой.
 *
 * ПРО ПОРЯДОК ЗАГРУЗКИ: модель игрока мод ставит сам, при возрождении и при
 * превращении в человека. Наш плагин обязан идти НИЖЕ zombie_plague44 в
 * plugins.ini, иначе выбор игрока будет затираться.
 */

#include <amxmodx>
#include <zm_menu>
#include <amxmisc>
#include <cstrike>
#include <engine>
#include <fakemeta>
#include <hamsandwich>
#include <nvault>
#include <zm_db>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Скины"
#define VERSION "1.0"
#define AUTHOR "cs16zm"

// Размеры полей с запасом: кириллица в UTF-8 занимает по два байта на букву.
// MODEL — короткое имя, мод сам разворачивает его в
// models/player/<имя>/<имя>.mdl, поэтому длинного пути тут не бывает.
// PRICE > 0 — скин из магазина: покупается за кредиты и уровня не требует.
// FLAG != 0 — скин привилегии: он не продаётся, его открывает уровень.
enum _:SKIN { TITLE[48], HINT[64], MODEL[32], FLAG, PRICE }

// Те же флаги, что в zp_knives и zp_vip: одна запись в users.ini открывает
// разом и нож, и скин своего уровня.
#define VIP       ADMIN_LEVEL_H
#define LEADER    ADMIN_LEVEL_G
#define IMPERATOR ADMIN_LEVEL_E
#define PHARAOH   ADMIN_LEVEL_D
#define CREATOR   ADMIN_LEVEL_C

// ⚠️ ОДИН СКИН НА ПРИВИЛЕГИЮ, ОСТАЛЬНЫЕ — В МАГАЗИН. Так попросил владелец, и
// так честнее: уровень даёт СВОЙ облик, узнаваемый с одного взгляда, а не
// список из четырёх похожих. Выбирать в меню привилегий больше нечего —
// подарочный скин надевается сам.
//
// Первая строка — «снять скин»: она возвращает не обычного бойца, а СКИН
// ПРИВИЛЕГИИ, если он есть. Купил в магазине, разонравилось — снял и снова
// ходишь в своём подарочном.
//
// Порядок: сначала подарочные по возрастанию уровня, потом товар по
// возрастанию цены. Игрок листает меню сверху вниз и должен видеть сначала то,
// на что уже накопил.
//
// Описания сверены по ТЕКСТУРАМ моделей (tools/mdl-textures.mjs), а не выведены
// из имён файлов: имена врут. «rames» оказался Эцио из Assassin's Creed,
// «imperator» — отпускником в гавайке.
// Самый длинный пункт текущего меню: по нему считается, сколько их влезет
// на страницу (см. include/zm_menu.inc).
new g_longest

new const g_skins[][SKIN] = {
    { "Снять скин",   "вернуться к своему по уровню", "",                  0, 0 },

    // Подарочные. Ровно по одному на уровень — соответствие задал владелец.
    { "Форма VIP",    "зелёная форма, номер 9",    "zm_hot_form_vip",       VIP, 0 },
    { "Форма 9",      "красная форма, номер 9",    "zm_hot_form9",       LEADER, 0 },
    { "Отпускник",    "гавайка и шлёпанцы",        "zm_hot_otpusk",   IMPERATOR, 0 },
    // «Фараон» вырезан из пака z7p_Males8_6 (подмодель 5) инструментом
    // tools/mdl-extract.mjs: золотой череп в сине-золотом немесе, золочёная
    // чешуйчатая броня, красный плащ. Отдельным файлом такого скина в сборках
    // нет — только внутри пака на 13 МБ.
    { "Фараон",       "золотой череп в немесе",    "zm_hot_faraon",     PHARAOH, 0 },
    { "Создатель",    "тот самый, из аниме",       "zm_hot_creator",    CREATOR, 0 },

    // Магазин за кредиты: уровня не требуют, покупаются один раз навсегда.
    //
    // Восемь из них — из двух сборок, скачанных владельцем: три от «Казахского
    // Пирога» (Летний, Паладин, Тёмный рыцарь) и пять от «Сборки v1». Отбирали
    // ГЛАЗАМИ по текстурам — имена файлов врут, и половина «людей» оказалась
    // зомби-классами.
    //
    // Спецназ, Монолит, Мечник, Ассасин и Агент переехали сюда из привилегий:
    // подарочный скин теперь один на уровень, а этим нашлось место на прилавке.
    { "Летний",       "красный шарф, рубашка",     "zm_hot_leto",         0,  50 },
    { "Герой",        "плащ и маска",              "zm_hot_hero",         0,  60 },
    { "Спортсменка",  "топ, гетры, хвостики",      "zm_hot_sporty",       0,  60 },
    { "Зимняя",       "вязаное платье и косы",     "zm_hot_zima",         0,  60 },
    { "Спецназ",      "броня и шлем",              "zm_hot_spec",         0,  70 },
    { "Агент",        "куртка и кобура",           "zm_hot_agent",        0,  70 },
    { "Доктор",       "костюм биозащиты",          "zm_hot_doctor",       0,  80 },
    { "Дуэлянт",      "чёрный фрак и клинок",      "zm_hot_frak",         0,  80 },
    { "Звёздная",     "корсет и чулки в звёздах",  "zm_hot_zvezda",       0,  90 },
    { "Змейка",       "змеиная кожа и цепи",       "zm_hot_zmeya",        0,  90 },
    { "Монолит",      "экзоскелет и противогаз",   "zm_hot_monolit",      0,  90 },
    { "Маска",        "без лица",                  "zm_hot_mask",         0, 100 },
    { "Мечник",       "чёрный плащ, меч за спиной", "zm_hot_mechnik",     0, 100 },
    { "Ассасин",      "плащ с капюшоном",          "zm_hot_assassin",     0, 110 },
    { "Паладин",      "бело-золотой доспех",       "zm_hot_paladin",      0, 120 },
    { "Тёмный рыцарь", "чёрно-синяя броня, коса",  "zm_hot_knight",       0, 120 },
}

// ⚠️ Запрос одной строкой: Pawn не склеивает соседние строковые записи.
new const SQL_CREATE[] = "CREATE TABLE IF NOT EXISTS zm_skin (steamid VARBINARY(64) NOT NULL PRIMARY KEY, worn VARBINARY(40) NOT NULL DEFAULT '', owned VARBINARY(255) NOT NULL DEFAULT '')"

new g_choice[33]
// Скин, выданный администратором вручную. Держим отдельным флагом, а не
// подкруткой прав: он действует до выхода игрока, на диск не пишется и
// снимается, как только игрок сам выберет что-то в меню.
// ⚠️ ЧТЕНИЕ ЗАВЕРШИЛОСЬ — ХОТЬ КАК-НИБУДЬ. Пока ответа из базы нет, сохранять
// нельзя: выход игрока записал бы пустой список покупок поверх оплаченных
// скинов. База на чужом хостинге отвечает не всегда, и это поймала живая
// проверка — прогресс и статистика не сохранились вовсе.
new bool:g_read[33]

#define TASK_READ  4300
#define TASK_GUARD 4400

new bool:g_admin_set[33]

// Купленные в магазине скины — битовой маской: их немного, а хранить надо
// вместе с выбором, одной записью в хранилище.
new g_bought[33]

new bool:g_ready[sizeof g_skins]
new g_index[sizeof g_skins]
new g_vault = INVALID_HANDLE
new cvar_enabled, cvar_log, cvar_view

// Свою модель игрок не видит никогда — камера сидит у неё в голове. Поэтому
// «посмотреть на себя» ставит перед ним манекен с его же моделью и сам его
// убирает. Смещение задачи, чтобы не столкнуться с чужими: номера задач общие
// на сервер.
#define TASK_VIEW 4200
#define DUMMY_DIST 110.0        // на сколько единиц впереди ставить манекен
new bool:g_looking[33]
new g_dummy[33]
// Сказали ли игроку про его подарочный скин — один раз за заход.
new bool:g_told_gift[33]

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    cvar_enabled = register_cvar("zp_skins", "1")
    cvar_log     = register_cvar("zp_log_actions", "1")

    // Сколько секунд держать вид со стороны. Это ПРЕДПРОСМОТР, а не режим
    // игры: из-за спины видно за угол, и оставлять его насовсем нечестно.
    // Ноль — не возвращать, тогда вид переключается только вручную.
    cvar_view    = register_cvar("zp_skin_view_time", "8")

    register_clcmd("zp_skin", "cmd_menu")
    register_clcmd("say /скин", "cmd_menu")
    register_clcmd("say /skin", "cmd_menu")
    register_clcmd("say_team /скин", "cmd_menu")

    register_clcmd("zp_skin_shop", "cmd_shop")
    register_clcmd("say /магскин", "cmd_shop")
    register_clcmd("say /skinshop", "cmd_shop")

    // Отдельной командой — чтобы повесить на клавишу: bind "v" "zp_skin_view"
    register_clcmd("zp_skin_view", "cmd_look")
    register_clcmd("say /вид", "cmd_look")
    register_clcmd("say /view", "cmd_look")
    register_clcmd("say_team /вид", "cmd_look")

    // Ставит скин игроку из консоли. Нужна и по делу — вернуть человека к
    // обычному виду, если он застрял в чужой модели, — и для проверки: с
    // серверной консоли видно, что модель действительно встала.
    register_concmd("zp_skin_set", "cmd_set", ADMIN_LEVEL_A, "<ник> <номер скина> — поставить скин")

    // Возрождение мод обрабатывает своим обработчиком того же события. Наш
    // плагин грузится ниже, поэтому пост-обработчик отработает после него —
    // модель уже будет проставлена модом, и мы поверх ставим выбранную.
    RegisterHam(Ham_Spawn, "player", "fw_spawn_post", 1)

    // Смерть возвращает вид сама, но флаг надо сбросить: иначе первое нажатие
    // после возрождения только «выключит» то, чего уже нет.
    RegisterHam(Ham_Killed, "player", "fw_killed_post", 1)

    zm_db_init()
    if (zm_db_on()) zm_db_create(SQL_CREATE)

    g_vault = nvault_open("zpskins")
    if (g_vault == INVALID_HANDLE) log_amx("хранилище скинов не открылось — выбор сохраняться не будет")
}

public plugin_end()
{
    if (g_vault != INVALID_HANDLE) nvault_close(g_vault)
}

public plugin_precache()
{
    // Нет файла — скин просто не появится в меню. Ронять сервер из-за
    // косметики нельзя, а precache_model на отсутствующий файл делает именно это.
    //
    // Индекс модели запоминаем: мод раздаёт клиентам не только имя модели, но
    // и её номер в списке предзагруженного, и без номера часть игроков увидит
    // чужую модель.
    for (new i = 0; i < sizeof g_skins; i++)
    {
        if (!g_skins[i][MODEL][0]) { g_ready[i] = true; continue; }   // «обычный боец»

        new path[80]
        formatex(path, charsmax(path), "models/player/%s/%s.mdl", g_skins[i][MODEL], g_skins[i][MODEL])

        if (!file_exists(path))
        {
            log_amx("нет модели: %s", path)
            continue;
        }

        g_index[i] = precache_model(path)
        g_ready[i] = true
    }
}

// ── ключ хранилища ──────────────────────────────────────────────────────────────
//
// Настоящий SteamID вида STEAM_0:1:N, иначе — по нику. Проверяем ФОРМАТ, а не
// префикс: под «начинается на STEAM_» подходит и STEAM_ID_LAN, и тогда все
// игроки делят одну запись.
// ⚠️ given — ID, пришедший вместе с форвардом авторизации: спрашивать его у
// движка можно не всегда (подробности у load()).
key_of(id, key[], len, const given[] = "")
{
    new authid[44]
    if (given[0]) copy(authid, charsmax(authid), given)
    else get_user_authid(id, authid, charsmax(authid))

    if (strlen(authid) > 9 && equal(authid, "STEAM_", 6)
        && authid[7] == ':' && (authid[8] == '0' || authid[8] == '1') && authid[9] == ':')
    {
        copy(key, len, authid)
        return;
    }

    new name[32]
    get_user_name(id, name, charsmax(name))
    formatex(key, len, "ник:%s", name)
}

public client_putinserver(id)
{
    g_choice[id] = 0
    g_admin_set[id] = false
    g_looking[id] = false
    g_dummy[id] = 0
    g_told_gift[id] = false
    g_bought[id] = 0
    g_read[id] = false
    load(id, "")
}

// ⚠️⚠️ ЧИТАЕМ И ЗДЕСЬ ТОЖЕ. Ключ хранилища — SteamID, а на входе в игру его
// может ЕЩЁ НЕ БЫТЬ: в amxmodx.inc про putinserver прямо сказано, что порядок
// с авторизацией не определён. Пока ID нет, get_user_authid отдаёт
// STEAM_ID_PENDING, ключ съезжает на «ник:Имя», а сохраняемся мы при выходе под
// настоящим SteamID — и купленное не находится. На ножах это уже поймали.
public client_authorized(id, const authid[]) load(id, authid)

load(id, const authid[])
{
    if (!zm_db_on()) { load_from_vault(id, authid); g_read[id] = true; return; }

    // ⚠️ НЕ СРАЗУ И ВРАЗНОБОЙ: очередь запросов у сервера одна, а на смене
    // карты входят все сразу — см. шапку include/zm_db.inc. Вторая задача
    // заменяет первую, поэтому вход и авторизация дают ОДИН запрос, и к его
    // времени SteamID уже пришёл.
    remove_task(id + TASK_READ)
    set_task(zm_db_when(id, 3.8), "read_later", id + TASK_READ)
}

public read_later(taskid)
{
    new id = taskid - TASK_READ
    if (!is_user_connected(id)) return;
    load_from_db(id, "")

    remove_task(id + TASK_GUARD)
    set_task(zm_db_patience(), "read_guard", id + TASK_GUARD)
}

public read_guard(taskid)
{
    new id = taskid - TASK_GUARD
    if (!is_user_connected(id) || g_read[id]) return;
    log_amx("БАЗА: скины — ответа нет, читаем зеркало")
    load_from_vault(id, "")
}

load_from_db(id, const authid[])
{
    new key[64]
    zm_db_key(id, key, charsmax(key), authid)

    new sql[192]
    formatex(sql, charsmax(sql), "SELECT worn, owned FROM zm_skin WHERE steamid = '%s'", key)

    // ⚠️ Везём userid: пока база отвечает, слот может занять другой человек, и
    // ему достались бы чужие покупки.
    new data[2]
    data[0] = id
    data[1] = get_user_userid(id)
    SQL_ThreadQuery(zm_db_tuple(), "sql_loaded", sql, data, sizeof data)
}

public sql_loaded(failstate, Handle:query, const error[], errnum, const data[], size, Float:queuetime)
{
    new id = data[0]
    if (!is_user_connected(id) || get_user_userid(id) != data[1]) return;

    if (failstate != TQUERY_SUCCESS)
    {
        log_amx("БАЗА: скины не прочитались (%d): %s — читаем зеркало", errnum, error)
        load_from_vault(id, "")
        return;
    }
    if (SQL_NumResults(query) < 1) { load_from_vault(id, ""); return; }

    new sel[32], own[224]
    SQL_ReadResult(query, 0, sel, charsmax(sel))
    SQL_ReadResult(query, 1, own, charsmax(own))
    take(id, sel, own)
    g_read[id] = true
}

public sql_saved(failstate, Handle:query, const error[], errnum, const data[], size, Float:queuetime)
{
    if (failstate == TQUERY_SUCCESS) return;
    log_amx("БАЗА: скины не сохранились (%d): %s", errnum, error)
}

load_from_vault(id, const authid[])
{
    // «В зеркале пусто» — тоже ответ: после него сохранять уже можно.
    g_read[id] = true
    if (g_vault == INVALID_HANDLE) return;

    // ⚠️ ХРАНИМ ИМЕНАМИ МОДЕЛЕЙ, А НЕ НОМЕРАМИ. Номер скина — это его место в
    // таблице выше, и стоит вставить одну строку в середину, как все записи
    // ниже начинают указывать на чужой скин: игрок покупал «Маску», а получает
    // «Паладина». Ровно на этом уже горели классы зомби в zp_progress.
    // Запись: «модель-выбора купленные,через,запятую», «-» вместо пустого.
    // Старые числовые записи просто не находятся по имени и читаются как
    // «ничего не выбрано, ничего не куплено» — это безопасный исход.
    new key[64], data[256]
    key_of(id, key, charsmax(key), authid)
    if (!nvault_get(g_vault, key, data, charsmax(data))) return;

    new sel[32], own[224]
    parse(data, sel, charsmax(sel), own, charsmax(own))
    take(id, sel, own)
}

// Разложить прочитанное по игроку. Одна на оба источника: база и зеркало
// обязаны давать одинаковый результат.
take(id, const sel[], const own[])
{
    new piece[32], pos = 0
    while (own[pos])
    {
        new k = 0
        while (own[pos] && own[pos] != ',' && k < charsmax(piece)) piece[k++] = own[pos++]
        piece[k] = 0
        while (own[pos] && own[pos] != ',') pos++      // хвост слишком длинного имени
        if (own[pos] == ',') pos++
        new bought = index_of_model(piece)
        if (bought > 0) g_bought[id] |= (1 << bought)
    }

    // Привилегия могла кончиться, пока игрока не было: тогда сохранённый скин
    // ему больше не положен и молча возвращаем обычного бойца. Купленный
    // остаётся: за него заплачено.
    new n = index_of_model(sel)
    if (n > 0 && g_ready[n] && allowed(id, n)) g_choice[id] = n
}

// Номер скина по имени его модели. «Обычный боец» модели не имеет, поэтому
// пустая строка и наш заполнитель «-» дают 0, а незнакомое имя — минус один.
index_of_model(const model[])
{
    if (!model[0] || equal(model, "-")) return 0;
    for (new i = 0; i < sizeof g_skins; i++)
        if (equal(g_skins[i][MODEL], model)) return i;
    return -1;
}

// ВНИМАНИЕ: у AMXX два обработчика выхода, и работает ЧЕТЫРЁХПАРАМЕТРНЫЙ.
// Однопараметрный client_disconnected не вызывается вовсе — выбор молча
// теряется, что мы уже ловили в другом плагине.
public client_disconnected(id, bool:drop, message[], maxlen)
{
    // Манекен и задача переживут игрока: манекен останется стоять посреди
    // карты, а задача выстрелит уже по чужому слоту.
    unlook(id)
    remove_task(id + TASK_VIEW)
    remove_task(id + TASK_READ)
    remove_task(id + TASK_GUARD)

    if (g_vault == INVALID_HANDLE) return;

    save(id)
}

// ⚠️ nvault держит записи В ПАМЯТИ и пишет их на диск только при закрытии.
// Пока сервер не остановят штатно, на диске ничего нет: закрыли окно, упал,
// перезапустили батником — и выбор со всеми покупками пропал. Поэтому после
// записи закрываем и открываем хранилище заново: это и есть сброс на диск.
save(id)
{
    // ⚠️ НЕ СОХРАНЯЕМ НЕПРОЧИТАННОЕ: иначе выход затрёт список купленных
    // скинов пустотой, а они куплены за кредиты.
    if (!g_read[id]) return;

    // Выданное администратором на диск не пишем: это подарок на один заход,
    // а не купленная привилегия. Покупки пишем всегда.
    new key[64], data[256], own[224]
    key_of(id, key, charsmax(key))

    own[0] = 0
    // Покупаются только скины с ценой, их и перечисляем.
    for (new i = 1; i < sizeof g_skins; i++)
    {
        if (g_skins[i][PRICE] <= 0 || !(g_bought[id] & (1 << i))) continue;
        if (own[0]) add(own, charsmax(own), ",")
        add(own, charsmax(own), g_skins[i][MODEL])
    }
    if (!own[0]) copy(own, charsmax(own), "-")

    // Тройной вопрос со строкой в Pawn не собирается: массив нельзя выбрать
    // выражением, его надо сначала положить в переменную.
    new pick[32]
    copy(pick, charsmax(pick), "-")
    new sel = g_admin_set[id] ? 0 : g_choice[id]
    if (sel > 0) copy(pick, charsmax(pick), g_skins[sel][MODEL])

    // В базу и в зеркало на диске — одним и тем же: иначе после отказа базы
    // игрок получил бы не то, что покупал.
    if (zm_db_on())
    {
        new sql[512]
        formatex(sql, charsmax(sql), "REPLACE INTO zm_skin (steamid, worn, owned) VALUES ('%s', '%s', '%s')", key, pick, own)
        SQL_ThreadQuery(zm_db_tuple(), "sql_saved", sql)
    }

    if (g_vault == INVALID_HANDLE) return;

    formatex(data, charsmax(data), "%s %s", pick, own)
    nvault_set(g_vault, key, data)

    nvault_close(g_vault)
    g_vault = nvault_open("zpskins")
    if (g_vault == INVALID_HANDLE) log_amx("хранилище скинов не открылось после записи")
}

// ── что кому доступно ───────────────────────────────────────────────────────────

// Подарочный скин игрока — тот, что положен его СТАРШЕЙ привилегии. Идём с
// конца таблицы: буквы в users.ini накопительные, у Фараона есть и VIP, и
// Лидер, и Император, а носить он должен фараона.
tier_skin(id)
{
    if (!is_user_connected(id)) return 0;
    new flags = get_user_flags(id)
    for (new i = sizeof g_skins - 1; i > 0; i--)
    {
        if (g_skins[i][PRICE] > 0 || g_skins[i][FLAG] == 0) continue;
        if (!g_ready[i]) continue;
        if (flags & g_skins[i][FLAG]) return i;
    }
    return 0;
}

// Что на игроке должно быть надето прямо сейчас. Купленный и выбранный скин
// главнее подарочного; снял купленный — вернулся подарочный.
effective(id)
{
    new n = g_choice[id]
    if (n > 0 && g_ready[n] && allowed(id, n)) return n;
    return tier_skin(id);
}

// Коротко: каким уровнем открывается подарочный скин. Нужно для журнала и для
// строчки в чате при возрождении — в меню подарочные больше не показываются.
tier_mark(flag)
{
    static s[24]
    switch (flag)
    {
        case VIP:       copy(s, charsmax(s), "VIP")
        case LEADER:    copy(s, charsmax(s), "Лидер")
        case IMPERATOR: copy(s, charsmax(s), "Император")
        case PHARAOH:   copy(s, charsmax(s), "Фараон")
        case CREATOR:   copy(s, charsmax(s), "Создатель")
        default:        copy(s, charsmax(s), "всем")
    }
    return s;
}

// Игрок должен УЗНАТЬ, что у него есть подарочный скин: сам он его не видит, а
// в меню выбирать больше нечего. Говорим один раз за заход (g_told_gift).
tell_gift(id)
{
    if (g_told_gift[id] || !is_user_connected(id)) return;

    new mine = tier_skin(id)
    if (mine <= 0) return;

    g_told_gift[id] = true
    client_print_color(id, print_team_default,
        "^x04[Вспышка эпидемии]^x01 Скин уровня ^x04%s^x01: ^x04%s^x01 (%s). Он надевается сам; в /скин — магазин.",
        tier_mark(g_skins[mine][FLAG]), g_skins[mine][TITLE], g_skins[mine][HINT])
}

// ── меню ────────────────────────────────────────────────────────────────────────

// ⚠️ МЕНЮ ТЕПЕРЬ ОДНО. Выбирать подарочный скин больше не из чего — он один на
// уровень и надевается сам, — поэтому «Скины» это прилавок магазина плюс две
// служебные строки: снять купленное и посмотреть на себя.
// ⚠️ МЕНЮ РАЗБИТО НА РАЗДЕЛЫ. Скинов стало двадцать один, и одним списком их
// уже не листать: на страницу GoldSrc влезает пять строк, то есть пять
// переходов только чтобы дойти до конца. Владелец попросил разложить по
// полкам — облики привилегий, свой инвентарь и прилавок отдельно.
//
// Строка заголовка одна на все разделы: сверху видно, что надето сейчас и
// сколько кредитов — иначе за покупкой приходится выходить и смотреть.
head(id, dst[], len, const what[])
{
    new mine = tier_skin(id)
    new now = effective(id)

    new gift[48], worn[48]
    if (mine > 0) copy(gift, charsmax(gift), g_skins[mine][TITLE])
    else copy(gift, charsmax(gift), "нет")
    if (now > 0) copy(worn, charsmax(worn), g_skins[now][TITLE])
    else copy(worn, charsmax(worn), "обычный боец")

    formatex(dst, len,
        "\y[Вспышка эпидемии]\w %s^n\wНадет: \y%s\w   По уровню: \y%s^n\wКредитов: \y%d",
        what, worn, gift, zp_get_user_ammo_packs(id))
}

public cmd_menu(id)
{
    if (!get_pcvar_num(cvar_enabled)) return PLUGIN_HANDLED;

    new title[224]
    head(id, title, charsmax(title), "Скины")
    g_longest = 0
    new menu = menu_create(title, "menu_pick")

    // Сколько чего лежит — числа прямо в строках раздела: без них непонятно,
    // стоит ли туда заходить.
    new mine = tier_skin(id)
    new owned = 0, forSale = 0
    for (new i = 1; i < sizeof g_skins; i++)
    {
        if (g_skins[i][PRICE] <= 0 || !g_ready[i]) continue;
        forSale++
        if (g_bought[id] & (1 << i)) owned++
    }

    new line[112]

    // Облики привилегий. Выбирать их может только Создатель, остальным раздел
    // показывает, что у них есть и что открывается выше.
    //
    // Отдельный буфер, а не тернарник в аргументе: Pawn не умеет выбирать
    // между двумя строками выражением — «array must be indexed».
    new gift[48]
    if (mine > 0) copy(gift, charsmax(gift), g_skins[mine][TITLE])
    else copy(gift, charsmax(gift), "нет")
    formatex(line, charsmax(line), "\wОблики привилегий \d(ваш: %s)", gift)
    zm_menu_seen(g_longest, line)
    menu_additem(menu, line, "tier", 0)

    formatex(line, charsmax(line), "\wМой инвентарь \d(куплено %d)", owned)
    zm_menu_seen(g_longest, line)
    menu_additem(menu, line, "own", 0)

    formatex(line, charsmax(line), "\yМагазин скинов \d(всего %d)", forSale)
    zm_menu_seen(g_longest, line)
    menu_additem(menu, line, "shop", 0)

    // Снять купленное. Возвращает не «обычного бойца», а подарочный скин
    // уровня, если он есть: за уровень заплачено, ходить без облика незачем.
    new off[96]
    if (g_choice[id] > 0)
    {
        if (mine > 0) formatex(off, charsmax(off), "\wСнять скин \d(вернётся %s)", g_skins[mine][TITLE])
        else copy(off, charsmax(off), "\wСнять скин \d(обычный боец)")
    }
    else copy(off, charsmax(off), "\dСнять скин \d(и так снят)")
    zm_menu_seen(g_longest, off)
    menu_additem(menu, off, "0", 0)

    // Свою модель игрок не видит никогда, поэтому выбор вслепую бессмысленен.
    menu_additem(menu, "\wПосмотреть на себя", "look", 0)

    menu_setprop(menu, MPROP_PERPAGE, 5)
    menu_setprop(menu, MPROP_EXITNAME, "Выход")
    zm_menu_fit(menu, title, g_longest)
    menu_display(id, menu)
    return PLUGIN_HANDLED;
}

// ── раздел: облики привилегий ───────────────────────────────────────────────────
//
// Порядок — по возрастанию уровня, он же порядок в таблице. Свой выделен
// жёлтым, чужие серые: сразу видно, что уже есть и куда расти.
menu_tier(id)
{
    new title[224]
    head(id, title, charsmax(title), "Облики привилегий")
    g_longest = 0
    new menu = menu_create(title, "menu_pick")

    new bool:boss = (get_user_flags(id) & CREATOR) != 0
    for (new i = 1; i < sizeof g_skins; i++)
    {
        if (g_skins[i][PRICE] > 0 || g_skins[i][FLAG] == 0) continue;

        new line[112], num[4]
        num_to_str(i, num, charsmax(num))

        if (!g_ready[i])
            formatex(line, charsmax(line), "\d%s \rнет модели", g_skins[i][TITLE])
        else if (i == g_choice[id])
            formatex(line, charsmax(line), "\y%s \d(надет)", g_skins[i][TITLE])
        else if (allowed(id, i))
            formatex(line, charsmax(line), "\w%s \y%s", g_skins[i][TITLE], tier_mark(g_skins[i][FLAG]))
        else
            formatex(line, charsmax(line), "\d%s \r%s", g_skins[i][TITLE], tier_mark(g_skins[i][FLAG]))

        zm_menu_seen(g_longest, line)

        menu_additem(menu, line, num, 0)
    }

    if (!boss)
        menu_additem(menu, "\dВыбирать облики может только Создатель", "back", 0)

    menu_setprop(menu, MPROP_PERPAGE, 6)
    menu_setprop(menu, MPROP_EXITNAME, "Назад")
    zm_menu_fit(menu, title, g_longest)
    menu_display(id, menu)
}

// ── раздел: инвентарь ───────────────────────────────────────────────────────────

menu_owned(id)
{
    new title[224]
    head(id, title, charsmax(title), "Мой инвентарь")
    g_longest = 0
    new menu = menu_create(title, "menu_pick")

    new count = 0
    for (new i = 1; i < sizeof g_skins; i++)
    {
        if (g_skins[i][PRICE] <= 0 || !g_ready[i]) continue;
        if (!(g_bought[id] & (1 << i))) continue;

        new line[112], num[4]
        num_to_str(i, num, charsmax(num))
        if (i == g_choice[id]) formatex(line, charsmax(line), "\y%s \d(надет)", g_skins[i][TITLE])
        else formatex(line, charsmax(line), "\w%s \d%s", g_skins[i][TITLE], g_skins[i][HINT])
        zm_menu_seen(g_longest, line)
        menu_additem(menu, line, num, 0)
        count++
    }

    if (!count) menu_additem(menu, "\dПусто — купите что-нибудь в магазине", "shop", 0)

    menu_setprop(menu, MPROP_PERPAGE, 6)
    menu_setprop(menu, MPROP_EXITNAME, "Назад")
    zm_menu_fit(menu, title, g_longest)
    menu_display(id, menu)
}

// ── раздел: магазин ─────────────────────────────────────────────────────────────
//
// Порядок — по возрастанию цены: игрок листает сверху вниз и должен видеть
// сначала то, на что уже накопил. Купленное помечено и в конец не уезжает —
// иначе непонятно, почему знакомого скина нет на месте.
menu_shop(id)
{
    new title[224]
    head(id, title, charsmax(title), "Магазин скинов")
    g_longest = 0
    new menu = menu_create(title, "menu_pick")

    new packs = zp_get_user_ammo_packs(id)
    for (new i = 1; i < sizeof g_skins; i++)
    {
        if (g_skins[i][PRICE] <= 0) continue;

        new line[112], num[4]
        num_to_str(i, num, charsmax(num))

        if (!g_ready[i])
            formatex(line, charsmax(line), "\d%s \rнет модели", g_skins[i][TITLE])
        else if (i == g_choice[id])
            formatex(line, charsmax(line), "\y%s \d(надет)", g_skins[i][TITLE])
        else if (g_bought[id] & (1 << i))
            formatex(line, charsmax(line), "\w%s \d(куплен)", g_skins[i][TITLE])
        else if (packs >= g_skins[i][PRICE])
            formatex(line, charsmax(line), "\w%s \y%d \dкр.", g_skins[i][TITLE], g_skins[i][PRICE])
        else
            formatex(line, charsmax(line), "\d%s \r%d \dкр.", g_skins[i][TITLE], g_skins[i][PRICE])

        zm_menu_seen(g_longest, line)

        menu_additem(menu, line, num, 0)
    }

    menu_setprop(menu, MPROP_PERPAGE, 6)
    menu_setprop(menu, MPROP_EXITNAME, "Назад")
    zm_menu_fit(menu, title, g_longest)
    menu_display(id, menu)
}

public menu_pick(id, menu, item)
{
    if (item == MENU_EXIT) { menu_destroy(menu); return PLUGIN_HANDLED; }

    new info[8], name[64], access, callback
    menu_item_getinfo(menu, item, access, info, charsmax(info), name, charsmax(name), callback)
    menu_destroy(menu)

    // Ключ строковый, поэтому со словами сравниваем ПЕРВЫМ: str_to_num("look")
    // вернёт 0, и без этой проверки пункт снимал бы скин.
    if (equal(info, "look")) { look(id); return PLUGIN_HANDLED; }
    if (equal(info, "tier")) { menu_tier(id); return PLUGIN_HANDLED; }
    if (equal(info, "own"))  { menu_owned(id); return PLUGIN_HANDLED; }
    if (equal(info, "shop")) { menu_shop(id); return PLUGIN_HANDLED; }
    if (equal(info, "back")) { cmd_menu(id); return PLUGIN_HANDLED; }

    new n = str_to_num(info)

    // Ноль — «снять скин». Возвращаем не обычного бойца, а подарочный скин
    // уровня: за уровень заплачено, и ходить без облика игроку незачем.
    if (n == 0)
    {
        g_choice[id] = 0
        g_admin_set[id] = false
        save(id)
        apply(id)

        new mine = tier_skin(id)
        if (mine > 0)
            client_print_color(id, print_team_default,
                "^x04[Вспышка эпидемии]^x01 Скин снят — вернулся ваш по уровню: ^x04%s^x01.", g_skins[mine][TITLE])
        else
            client_print_color(id, print_team_default,
                "^x04[Вспышка эпидемии]^x01 Скин снят — вы обычный боец.")
        return PLUGIN_HANDLED;
    }

    // Подарочный облик может выбрать только Создатель — остальным они
    // достаются сами по уровню, и в меню их нет.
    if (n > 0 && n < sizeof g_skins && g_skins[n][PRICE] <= 0)
    {
        if (!allowed(id, n) || !g_ready[n])
        {
            client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Этот облик вам не открыт.")
            return PLUGIN_HANDLED;
        }

        g_choice[id] = n
        g_admin_set[id] = false
        save(id)
        apply(id)

        new why[80]
        if (can_wear_now(id, why, charsmax(why)))
            client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Надет облик ^x04%s^x01.", g_skins[n][TITLE])
        else
            client_print_color(id, print_team_default,
                "^x04[Вспышка эпидемии]^x01 Выбран облик ^x04%s^x01 — ^x03%s^x01.", g_skins[n][TITLE], why)
        return PLUGIN_HANDLED;
    }

    return buy_or_wear(id, n);
}

// ── магазин скинов ──────────────────────────────────────────────────────────────

// Отдельного прилавка больше нет: подарочный скин один на уровень и выбирать
// его не из чего, поэтому «Скины» и «Магазин скинов» — одно и то же меню.
// Команду оставили: у людей она в биндах.
public cmd_shop(id)
{
    cmd_menu(id)
    return PLUGIN_HANDLED;
}

buy_or_wear(id, n)
{
    if (n <= 0 || n >= sizeof g_skins || g_skins[n][PRICE] <= 0 || !g_ready[n])
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Этого скина в магазине нет.")
        return PLUGIN_HANDLED;
    }

    new why[80]

    // Уже купленный просто надеваем — платить второй раз не за что.
    if (g_bought[id] & (1 << n))
    {
        g_choice[id] = n
        g_admin_set[id] = false
        apply(id)
        if (can_wear_now(id, why, charsmax(why)))
            client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Надет скин ^x04%s^x01.", g_skins[n][TITLE])
        else
            client_print_color(id, print_team_default,
                "^x04[Вспышка эпидемии]^x01 Выбран скин ^x04%s^x01 — ^x03%s^x01.", g_skins[n][TITLE], why)
        return PLUGIN_HANDLED;
    }

    new packs = zp_get_user_ammo_packs(id)
    if (packs < g_skins[n][PRICE])
    {
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Не хватает ^x04%d^x01 кредитов: «%s» стоит ^x04%d^x01.",
            g_skins[n][PRICE] - packs, g_skins[n][TITLE], g_skins[n][PRICE])
        return PLUGIN_HANDLED;
    }

    zp_set_user_ammo_packs(id, packs - g_skins[n][PRICE])
    g_bought[id] |= (1 << n)
    g_choice[id] = n
    g_admin_set[id] = false
    save(id)                  // покупка — тем более: за неё заплачено
    apply(id)

    new who[32]
    get_user_name(id, who, charsmax(who))
    zlog("МАГАЗИН СКИНОВ: %s купил «%s» за %d", who, g_skins[n][TITLE], g_skins[n][PRICE])

    // ⚠️ Про момент говорим ОБЯЗАТЕЛЬНО. Купить скин можно и зомби, и мёртвым,
    // но надеться он тогда не может: мод держит на игроке свою модель. Раньше
    // покупка в такой момент молча ничего не меняла — со стороны это выглядит
    // как «купил, а модели нет».
    if (can_wear_now(id, why, charsmax(why)))
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Куплен скин ^x04%s^x01 (%s). Он остаётся за вами навсегда.",
            g_skins[n][TITLE], g_skins[n][HINT])
    else
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Куплен скин ^x04%s^x01 (%s) — ^x03%s^x01. Он остаётся за вами навсегда.",
            g_skins[n][TITLE], g_skins[n][HINT], why)
    return PLUGIN_HANDLED;
}

// ── применение ──────────────────────────────────────────────────────────────────

// Доступен ли скин этому игроку.
bool:allowed(id, i)
{
    // Выданный администратором скин действует и без флага — но только тот
    // самый, а не весь его уровень.
    if (g_admin_set[id] && i == g_choice[id]) return true;

    // Товар магазина уровня не требует — только покупки.
    if (g_skins[i][PRICE] > 0) return (g_bought[id] & (1 << i)) != 0;

    // ⚠️ СОЗДАТЕЛЮ ОТКРЫТЫ ВСЕ ПОДАРОЧНЫЕ ОБЛИКИ. Он главный администратор, его
    // уровень не продаётся, и запирать от него облики младших уровней смысла
    // нет — владелец попросил дать ему выбор.
    if (get_user_flags(id) & CREATOR) return true;

    new flag = g_skins[i][FLAG]
    return flag == 0 || (get_user_flags(id) & flag) != 0;
}


// Может ли скин надеться прямо сейчас. Отдельно от allowed(): там про право,
// здесь про момент. Зомби и ролям мод ставит свою модель, и наша подмена
// молча ничего не сделает — а игрок в это время смотрит и не понимает, за что
// заплатил. Поэтому причину проговариваем вслух.
bool:can_wear_now(id, reason[], len)
{
    if (!is_user_alive(id))
    {
        copy(reason, len, "наденется при возрождении")
        return false;
    }
    if (zp_get_user_zombie(id))
    {
        copy(reason, len, "сейчас вы зомби — скин виден, только когда вы человек")
        return false;
    }
    if (zp_get_user_survivor(id) || zp_get_user_sniper(id))
    {
        copy(reason, len, "у Выжившего и Снайпера своя модель — скин вернётся после раунда")
        return false;
    }
    reason[0] = 0
    return true;
}

apply(id)
{
    if (!get_pcvar_num(cvar_enabled) || !is_user_alive(id)) return;

    // ⚠️ НАДЕВАЕМ НЕ ВЫБРАННОЕ, А ДЕЙСТВУЮЩЕЕ. Купленный скин главнее, но если
    // его сняли (или он больше не доступен), на игроке должен оказаться
    // подарочный скин его уровня, а не «обычный боец». Раньше здесь стоял
    // g_choice, и снятие купленного оставляло владельца привилегии голым.
    new i = effective(id)
    if (i <= 0 || !g_ready[i]) return;

    // Только люди. Модель зомби задаёт его класс, а Дьяволу, Убийце,
    // Выжившему и Снайперу мод выдаёт свою — это роли, а не косметика.
    if (zp_get_user_zombie(id)) return;
    if (zp_get_user_survivor(id) || zp_get_user_sniper(id)) return;

    // Ставим ЧЕРЕЗ МОД, а не мимо него: у мода есть свой присмотр за моделью
    // игрока, и подмена в обход просто откатывается назад через полсекунды.
    zp_override_user_model(id, g_skins[i][MODEL], g_index[i])
}

public fw_spawn_post(id)
{
    if (!is_user_alive(id)) return;

    // Перезапуск раунда возрождает без смерти, и Ham_Killed не сработает —
    // без этого перед игроком остался бы стоять манекен весь раунд.
    unlook(id)
    apply(id)
    tell_gift(id)
}

// ── посмотреть на себя ──────────────────────────────────────────────────────────

public cmd_look(id)
{
    look(id)
    return PLUGIN_HANDLED;
}

look(id)
{
    if (!get_pcvar_num(cvar_enabled)) return;

    if (!is_user_alive(id))
    {
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Посмотреть на себя можно только живым.")
        return;
    }

    if (g_looking[id]) { unlook(id); return; }

    // Модель берём С ИГРОКА, а не из своей таблицы: так в осмотре видно ровно
    // то, что сейчас на нём, — и зомби своего класса, и Выжившего.
    new model[32], path[80]
    cs_get_user_model(id, model, charsmax(model))
    if (!model[0])
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Сейчас не на что смотреть.")
        return;
    }
    formatex(path, charsmax(path), "models/player/%s/%s.mdl", model, model)
    if (!file_exists(path))
    {
        client_print_color(id, print_team_default,
            "^x04[Вспышка эпидемии]^x01 Файла модели «%s» на сервере нет — покажите это администратору.", model)
        return;
    }

    new ent = create_dummy(id, path)
    if (!ent)
    {
        client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Не вышло показать: кончились свободные предметы.")
        return;
    }

    g_looking[id] = true
    g_dummy[id] = ent

    new secs = get_pcvar_num(cvar_view)
    if (secs > 0) set_task(float(secs), "view_back", id + TASK_VIEW)

    // Отдельный буфер, а не тернарник в аргументе: Pawn не умеет выбирать
    // между двумя строками выражением — «array must be indexed».
    new how[64]
    if (secs > 0) formatex(how, charsmax(how), "Уберётся сам через %d с.", secs)
    else copy(how, charsmax(how), "Нажмите ещё раз, чтобы убрать.")

    client_print_color(id, print_team_default, "^x04[Вспышка эпидемии]^x01 Ваш облик — перед вами. %s", how)
}

// ⚠️ ПОЧЕМУ МАНЕКЕН, А НЕ ВИД ИЗ-ЗА СПИНЫ. Раньше осмотр включал камеру за
// спиной (set_view CAMERA_3RDPERSON). Владелец: «модель полупрозрачная». Так и
// есть — измерено кадрами: СВОЙ игрок в виде от третьего лица рисуется
// клиентом просвечивающим, сквозь тело видно доски, и сервер на это не влияет
// (pev_rendermode у игрока обычный). Поэтому показываем не себя, а копию:
// обычный предмет с той же моделью рисуется плотно. Заодно видно спереди, а не
// в затылок, и не открывается обзор за угол — прежний вид со спины этим грешил.
create_dummy(id, const path[])
{
    new ent = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, "info_target"))
    if (!pev_valid(ent)) return 0;

    engfunc(EngFunc_SetModel, ent, path)
    set_pev(ent, pev_classname, "zp_skin_dummy")
    set_pev(ent, pev_movetype, MOVETYPE_NONE)
    set_pev(ent, pev_solid, SOLID_NOT)
    set_pev(ent, pev_owner, id)

    // Первая анимация — «стойка». Нулевая у части моделей это двухкадровая
    // заглушка, спрятанная ниже пола, и манекен был бы пустым местом.
    set_pev(ent, pev_sequence, 1)
    set_pev(ent, pev_framerate, 1.0)
    set_pev(ent, pev_animtime, get_gametime())

    // Ставим прямо перед лицом, но не дальше стены: в тесном коридоре манекен
    // иначе уедет внутрь кирпича и его не будет видно.
    static Float:eye[3], Float:ofs[3], Float:ang[3], Float:fwd[3], Float:want[3]
    pev(id, pev_origin, eye)
    pev(id, pev_view_ofs, ofs)
    eye[0] += ofs[0]
    eye[1] += ofs[1]
    eye[2] += ofs[2]

    pev(id, pev_v_angle, ang)
    ang[0] = 0.0
    ang[2] = 0.0
    angle_vector(ang, ANGLEVECTOR_FORWARD, fwd)

    want[0] = eye[0] + fwd[0] * DUMMY_DIST
    want[1] = eye[1] + fwd[1] * DUMMY_DIST
    want[2] = eye[2]

    engfunc(EngFunc_TraceLine, eye, want, IGNORE_MONSTERS, id, 0)
    static Float:hit[3], Float:frac
    get_tr2(0, TR_vecEndPos, hit)
    get_tr2(0, TR_flFraction, frac)
    if (frac < 1.0)
    {
        // Отступаем от стены на четверть шага, иначе манекен в неё влипнет.
        hit[0] -= fwd[0] * 16.0
        hit[1] -= fwd[1] * 16.0
    }

    // Ищем пол под этой точкой.
    static Float:down[3]
    down[0] = hit[0]
    down[1] = hit[1]
    down[2] = hit[2] - 128.0
    engfunc(EngFunc_TraceLine, hit, down, IGNORE_MONSTERS, id, 0)
    get_tr2(0, TR_vecEndPos, hit)

    // ⚠️ И ПОДНИМАЕМ НА ПОЛВЫСОТЫ. Владелец: «персонаж в земле, точнее его
    // ноги». Так и было: у ИГРОКА начало координат — СЕРЕДИНА габарита, на 36
    // единиц над полом (VEC_HULL_MIN по Z = -36), и модель человека нарисована
    // относительно этой середины, а не относительно ступней. Манекен же
    // ставился началом координат прямо на пол — и уходил в него ровно по пояс.
    hit[2] += 36.0
    engfunc(EngFunc_SetOrigin, ent, hit)

    // Габарит как у игрока — на случай, если модель придётся ронять на пол
    // повторно (уклон, ступенька): без размера DropToFloor не работает.
    static Float:mins[3], Float:maxs[3]
    mins[0] = -16.0; mins[1] = -16.0; mins[2] = -36.0
    maxs[0] =  16.0; maxs[1] =  16.0; maxs[2] =  36.0
    engfunc(EngFunc_SetSize, ent, mins, maxs)

    // Лицом к игроку и медленно поворачивается: так видно и спину, и перёд.
    static Float:face[3]
    face[0] = 0.0
    face[1] = ang[1] + 180.0
    face[2] = 0.0
    set_pev(ent, pev_angles, face)
    set_pev(ent, pev_avelocity, Float:{0.0, 45.0, 0.0})

    return ent;
}

unlook(id)
{
    if (!g_looking[id]) return;

    g_looking[id] = false
    remove_task(id + TASK_VIEW)

    if (pev_valid(g_dummy[id]))
    {
        new cls[24]
        pev(g_dummy[id], pev_classname, cls, charsmax(cls))
        if (equal(cls, "zp_skin_dummy")) engfunc(EngFunc_RemoveEntity, g_dummy[id])
    }
    g_dummy[id] = 0
}

public view_back(task) unlook(task - TASK_VIEW)

public fw_killed_post(id) unlook(id)

// Обратился в зомби — вид возвращаем: предпросмотр был для своей модели, а из-за
// спины видно за угол, и оставлять это в бою нечестно.
public zp_user_infected_post(id, infector, nemesis) unlook(id)

// ── команда администратора ──────────────────────────────────────────────────────

public cmd_set(id, level, cid)
{
    if (!cmd_access(id, level, cid, 3)) return PLUGIN_HANDLED;

    new who[32], what[8]
    read_argv(1, who, charsmax(who))
    read_argv(2, what, charsmax(what))

    new target = cmd_target(id, who, CMDTARGET_ALLOW_SELF)
    if (!target) return PLUGIN_HANDLED;

    new n = str_to_num(what)
    if (n < 0 || n >= sizeof g_skins || !g_ready[n])
    {
        console_print(id, "[ZP] Нет такого скина: %s. Всего скинов: %d (нумерация с нуля).",
            what, sizeof g_skins)
        return PLUGIN_HANDLED;
    }

    // Уровень привилегии здесь НЕ проверяем: смысл команды в том числе —
    // выдать скин вручную, минуя флаги. Но одной записи в g_choice мало:
    // apply() сверяется с правами, и без этой отметки выдача молча ничего бы
    // не сделала. На это уже наступили при проверке на ботах.
    g_choice[target] = n
    g_admin_set[target] = (n > 0)
    apply(target)

    new name[32]
    get_user_name(target, name, charsmax(name))
    console_print(id, "[ZP] %s: скин «%s». Что встало на самом деле — строкой ниже в logs/zp_actions.log.",
        name, g_skins[n][TITLE])
    zlog("СКИН: администратор поставил %s скин «%s»", name, g_skins[n][TITLE])

    // Сверку откладываем: мод меняет модель не сразу, а через задержку из
    // MODELCHANGE DELAY (защита от SVC_BAD), и сразу после вызова с игрока
    // читается ещё СТАРАЯ модель. На это уже наступили при первой проверке.
    set_task(1.5, "check_applied", target)
    return PLUGIN_HANDLED;
}

// Читаем модель ОБРАТНО с игрока, а не рапортуем о своём намерении: мод мог
// откатить подмену — например у зомби, — и разницу видно только так.
public check_applied(id)
{
    if (!is_user_connected(id)) return;

    new name[32], now[64]
    get_user_name(id, name, charsmax(name))

    if (!is_user_alive(id)) copy(now, charsmax(now), "мёртв, встанет при возрождении")
    else cs_get_user_model(id, now, charsmax(now))

    zlog("СКИН: на %s стоит модель «%s»", name, now)
}

public zp_user_humanized_post(id) apply(id)

// Все игровые события пишем в ОТДЕЛЬНЫЙ файл, а не в общий журнал сервера:
// в нём они тонут между строками движка, а консоль уезжает за секунды.
zlog(const fmt[], any:...)
{
    if (!get_pcvar_num(cvar_log)) return;

    static msg[256]
    vformat(msg, charsmax(msg), fmt, 2)
    log_to_file("zp_actions.log", "%s", msg)
}
