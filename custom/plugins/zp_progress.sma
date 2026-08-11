/*
 * [ZP] Сохранение прогресса между картами и перезапусками.
 *
 * Штатное «сохранение» Zombie Plague держит записи в массивах ПАМЯТИ и ищет их
 * ПО ИМЕНИ игрока. Оно переживает переподключение в пределах карты — и теряется
 * при смене карты, перезапуске сервера и смене ника. В его же конфиге так и
 * написано: «Temporarily save».
 *
 * Здесь то же самое кладётся В БАЗУ, а на диск рядом — зеркалом. Работаем через
 * открытые нативы мода, его исходник не трогаем.
 *
 * ⚠️ БАЗА — ГЛАВНАЯ, ФАЙЛ — ЗАПАСНОЙ. Владелец попросил хранить всё в MySQL, и
 * это правильно: файл живёт на одной машине и не переживает переезд сервера.
 * Но у базы есть беда, которой у файла нет — она может не ответить: хостинг
 * перезагрузил её, кончились соединения, моргнула сеть. Поэтому:
 *
 *   читаем   — из базы; не ответила, читаем зеркало на диске;
 *   пишем    — и в базу, и в зеркало;
 *   НЕ ПИШЕМ вовсе, пока не прочитали.
 *
 * Последнее — самое важное. Без него игрок, зашедший в минуту недоступности
 * базы, оказался бы пустым, а на выходе ЗАПИСАЛ БЫ эту пустоту поверх своих
 * кредитов. Потеря была бы необратимой.
 *
 * Ключ выбирается по обстановке. Настоящий SteamID вида STEAM_0:1:12345 —
 * лучший вариант: он переживает смену ника. Но на локальном сервере и у игрока
 * без Steam его просто нет (движок отдаёт STEAM_ID_LAN, VALVE_ID_LAN или
 * число), и тогда ключом становится ник. Именно на этом молча ломается
 * большинство самописных сохранений: проверку «начинается на STEAM_» проходит
 * и STEAM_ID_LAN, после чего все игроки делят одну запись.
 */

#include <amxmodx>
#include <amxmisc>
#include <nvault>
#include <zm_db>
#include <zombie_plague_v44>

#define PLUGIN "[ZP] Сохранение прогресса"
#define VERSION "2.0"
#define AUTHOR "cs16zm"

#define TASK_LOAD 7100
// Сторож ответа из базы. Своё число, а не TASK_LOAD + 33: слоты нумеруются до
// 32, и пересечься эти два ряда не должны ни при каком числе игроков.
#define TASK_GUARD 7200

// Таблица своя, а не общая на все плагины. Иначе два плагина писали бы разные
// столбцы одной строки, а REPLACE INTO заменяет строку ЦЕЛИКОМ — и запись
// скина стирала бы кредиты. У каждого хозяина своя строка.
// ⚠️ ЗАПРОС ОДНОЙ СТРОКОЙ. Pawn не склеивает соседние строковые записи, а
// перенос длинного запроса на несколько строк даёт «invalid function or
// declaration» в месте, где ничего не видно. Держим в одну, как ни хочется.
new const SQL_CREATE[] = "CREATE TABLE IF NOT EXISTS zm_progress (steamid VARBINARY(64) NOT NULL PRIMARY KEY, name VARBINARY(64) NOT NULL DEFAULT '', packs INTEGER NOT NULL DEFAULT 0, zclass VARBINARY(48) NOT NULL DEFAULT '', updated INTEGER NOT NULL DEFAULT 0)"

new g_vault = INVALID_HANDLE
new cvar_enabled, cvar_log, cvar_interval
new bool:g_loaded[33]

public plugin_init()
{
    register_plugin(PLUGIN, VERSION, AUTHOR)

    zm_db_init()
    cvar_enabled  = register_cvar("zp_progress_save", "1")
    // Общий выключатель журнала действий, один на все наши плагины.
    cvar_log      = register_cvar("zp_log_actions", "1")
    // Раз в сколько секунд сбрасывать всё на диск. Нужно потому, что при
    // жёстком снятии процесса ни выход игрока, ни конец раунда не случатся.
    cvar_interval = register_cvar("zp_progress_interval", "60.0")

    register_concmd("zp_progress_show", "cmd_show", ADMIN_LEVEL_A,
        "- показать, под какими ключами сохраняются игроки")

    g_vault = nvault_open("zpprogress")
    if (g_vault == INVALID_HANDLE)
        log_amx("ХРАНИЛИЩЕ НЕ ОТКРЫЛОСЬ — прогресс сохраняться НЕ БУДЕТ")
}

// Задача заводится здесь, а не в plugin_init: конфиги сервера выполняются
// ПОЗЖЕ инициализации, и прочитанное там значение было бы всегда заводским —
// настройка из server.cfg просто не доходила бы до плагина.
public plugin_cfg()
{
    new Float:interval = get_pcvar_float(cvar_interval)
    if (interval < 10.0) interval = 10.0

    remove_task(0)
    set_task(interval, "save_everyone", 0, _, _, "b")

    // Таблицу заводим сами: база может быть пустой — первый запуск, новый
    // хостинг, чистая копия для проверки. Заставлять человека создавать
    // таблицы руками — значит однажды получить сервер, который молча ничего
    // не сохраняет.
    if (zm_db_on()) zm_db_create(SQL_CREATE)
}

public plugin_end()
{
    // ⚠️ ЗДЕСЬ ЗАПРОС НЕ ПОТОКОВЫЙ, И ЭТО НАРОЧНО. Карта меняется, плагин
    // выгружается — очередь потоковых запросов вместе с ним и пропадёт, а
    // последнее сохранение как раз самое ценное. Ждать ответа базы в этот миг
    // не жалко: игроки уже на загрузочном экране.
    save_everyone()
    flush_db_blocking()

    // Без закрытия nVault не уплотняет журнал в основной файл.
    if (g_vault != INVALID_HANDLE) nvault_close(g_vault)
}

// Ключ игрока теперь общий на все плагины — он в include/zm_db.inc. Раньше
// каждый плагин строил его своей копией, и когда выяснилось, что на входе в
// игру SteamID ещё нет, чинить пришлось каждую копию по отдельности.
bool:key_of(id, key[], len) return zm_db_key(id, key, len);

public client_putinserver(id)
{
    g_loaded[id] = false
    if (!get_pcvar_num(cvar_enabled)) return;

    // С задержкой: мод в этот же миг сбрасывает переменные игрока к стартовым
    // (reset_vars ставит zp_starting_ammo_packs), и загрузка раньше него
    // была бы тут же затёрта.
    // ⚠️ И вразнобой: на смене карты все заходят разом, а очередь запросов у
    // сервера одна. Подробности — в шапке include/zm_db.inc.
    remove_task(id + TASK_LOAD)
    set_task(zm_db_when(id, 3.0), "load_player", id + TASK_LOAD)
}

// ВНИМАНИЕ на число параметров. В AMXX два форварда отключения:
// client_disconnect(id) — устаревший, с одним параметром, и
// client_disconnected(id, drop, message, maxlen) — нынешний, с четырьмя.
// Объявленный как client_disconnected(id) не вызывается ВООБЩЕ: компилятор
// молчит, плагин грузится, а сохранение при выходе просто не происходит.
public client_disconnected(id, bool:drop, message[], maxlen)
{
    remove_task(id + TASK_LOAD)
    remove_task(id + TASK_GUARD)
    save_player(id)
    flush_vault()      // на диск сразу: до следующего общего сохранения сервер может и не дожить
    g_loaded[id] = false
}

public zp_round_ended(winteam) save_everyone()

public save_everyone()
{
    if (!get_pcvar_num(cvar_enabled) || g_vault == INVALID_HANDLE) return;

    // Без флагов — это ВСЕ подключённые. Осторожно: флаг "c" у get_players
    // означает «пропустить ботов», а вовсе не «connected», как читается.
    // Ботов не исключаем: у них тоже нет SteamID, они сохранятся по нику —
    // ровно как игрок без Steam. Заодно это единственный способ проверить
    // сохранение целиком, не сажая за клиент живого человека.
    new players[32], num
    get_players(players, num)
    for (new i = 0; i < num; i++) save_player(players[i])

    flush_vault()
}

// nVault держит записи в памяти и переносит их в файл только при закрытии.
// Проверено: сервер, снятый жёстко, теряет ВСЁ с последней смены карты — а
// именно так его обычно и останавливают. Отдельного сброса на диск в модуле
// нет, поэтому закрываем хранилище и тут же открываем снова: это и есть сброс.
flush_vault()
{
    if (g_vault == INVALID_HANDLE) return;

    nvault_close(g_vault)
    g_vault = nvault_open("zpprogress")

    if (g_vault == INVALID_HANDLE)
        log_amx("хранилище не открылось обратно после сброса — сохранение остановлено")
}

// ── имена классов ───────────────────────────────────────────────────────────────
//
// Натива «имя класса по номеру» мод наружу не отдаёт, зато он сам пишет список
// классов в конфиг при старте карты — и порядок секций там и есть нумерация.
// Читаем его один раз, лениво: к первому сохранению файл уже на месте, а в
// plugin_cfg мод мог до него ещё не дойти.
new Array:g_class_names = Invalid_Array

load_class_names()
{
    if (g_class_names != Invalid_Array) return;
    g_class_names = ArrayCreate(32, 1)

    new path[128]
    get_configsdir(path, charsmax(path))
    add(path, charsmax(path), "/zp_zombie_classes_v44.ini")

    new f = fopen(path, "rt")
    if (!f) { log_amx("нет списка классов %s — класс запомнить не получится", path); return; }

    new line[64]
    while (!feof(f))
    {
        fgets(f, line, charsmax(line))
        trim(line)
        new n = strlen(line)
        if (n < 3 || line[0] != '[' || line[n - 1] != ']') continue;
        line[n - 1] = 0
        ArrayPushString(g_class_names, line[1])
    }
    fclose(f)
}

class_name_of(cls, out[], len)
{
    out[0] = 0
    load_class_names()
    if (cls < 0 || cls >= ArraySize(g_class_names)) return;
    ArrayGetString(g_class_names, cls, out, len)
}

save_player(id)
{
    if (!get_pcvar_num(cvar_enabled)) return;
    if (!is_user_connected(id)) return;

    // ⚠️ НЕ СОХРАНЯЕМ ТО, ЧЕГО НЕ ЗАГРУЖАЛИ. Иначе игрок, отключившийся в первые
    // три секунды — или зашедший в минуту, когда база молчала, — затрёт свою
    // настоящую запись стартовыми значениями. Потеря необратима.
    if (!g_loaded[id]) return;

    new key[64]
    new bool:by_steam = key_of(id, key, charsmax(key))

    // В базу — первым делом: файл рядом переживёт что угодно, а вот база у нас
    // главная, и запись в неё важнее.
    save_to_db(id, key)

    if (g_vault == INVALID_HANDLE) return;

    // ⚠️ КЛАСС ХРАНИМ ИМЕНЕМ, А НЕ НОМЕРОМ. Номер у мода — это порядок
    // регистрации плагинов: стоит добавить один класс, и все номера ниже
    // съезжают. Сохранённая «11» после этого возвращает игроку СОВСЕМ ДРУГОЙ
    // класс, и со стороны это выглядит как «классы поломались сами». Имя
    // переживает любые добавления, а если класс убрали — запись просто не
    // найдётся, и игрок останется обычным.
    new cls[32]
    class_name_of(zp_get_user_next_class(id), cls, charsmax(cls))

    new data[64]
    formatex(data, charsmax(data), "%d %s", zp_get_user_ammo_packs(id), cls)
    nvault_set(g_vault, key, data)

    zlog("СОХРАНЕНО: %s -> кредиты и класс «%s» (ключ %s)",
        key, data, by_steam ? "SteamID" : "по нику")
}

// ── база ────────────────────────────────────────────────────────────────────────

// Что сохранить — собираем в одном месте: и потоковая запись, и та, что уходит
// при смене карты, обязаны писать ОДНО И ТО ЖЕ. Две копии этой строки однажды
// разъехались бы, и половина сохранений теряла бы класс.
build_save_sql(id, const key[], sql[], len)
{
    new cls[32], name[32], safe_name[64]
    class_name_of(zp_get_user_next_class(id), cls, charsmax(cls))
    get_user_name(id, name, charsmax(name))
    zm_db_safe(safe_name, charsmax(safe_name), name)

    formatex(sql, len, "REPLACE INTO zm_progress (steamid, name, packs, zclass, updated) VALUES ('%s', '%s', %d, '%s', %d)",
        key, safe_name, zp_get_user_ammo_packs(id), cls, get_systime())
}

save_to_db(id, const key[])
{
    if (!zm_db_on()) return;

    new sql[320]
    build_save_sql(id, key, sql, charsmax(sql))
    SQL_ThreadQuery(zm_db_tuple(), "sql_saved", sql)
}

public sql_saved(failstate, Handle:query, const error[], errnum, const data[], size, Float:queuetime)
{
    if (failstate == TQUERY_SUCCESS) return;

    // Молчать нельзя: зеркало на диске уцелело, но владелец должен знать, что
    // база не принимает записи, — иначе он узнает об этом через неделю.
    log_amx("БАЗА: не сохранилось (%d): %s", errnum, error)
}

// Последнее сохранение при смене карты. Единственное место, где мы ЖДЁМ базу.
flush_db_blocking()
{
    if (!zm_db_on() || !get_pcvar_num(cvar_enabled)) return;

    new err[192], errnum
    new Handle:db = SQL_Connect(zm_db_tuple(), errnum, err, charsmax(err))
    if (db == Empty_Handle)
    {
        log_amx("БАЗА: перед сменой карты не подключились (%d): %s", errnum, err)
        return;
    }

    new players[32], num, saved = 0
    get_players(players, num)
    for (new i = 0; i < num; i++)
    {
        new id = players[i]
        if (!g_loaded[id]) continue;

        new key[64], sql[320]
        key_of(id, key, charsmax(key))
        build_save_sql(id, key, sql, charsmax(sql))

        new Handle:q = SQL_PrepareQuery(db, sql)
        if (SQL_Execute(q)) saved++
        else log_amx("БАЗА: строка не сохранилась при смене карты: %s", sql)
        SQL_FreeHandle(q)
    }
    SQL_FreeHandle(db)

    if (saved) zlog("БАЗА: перед сменой карты сохранено игроков: %d", saved)
}

// Загрузка из базы. Ответ придёт не сразу — поэтому проверяем в обработчике,
// что игрок ещё тот же самый.
load_from_db(id)
{
    new key[64]
    key_of(id, key, charsmax(key))

    new sql[192]
    formatex(sql, charsmax(sql),
        "SELECT packs, zclass FROM zm_progress WHERE steamid = '%s'", key)

    // ⚠️ ВЕЗЁМ С СОБОЙ userid, А НЕ ТОЛЬКО НОМЕР СЛОТА. Пока база отвечает,
    // игрок может выйти, а его слот занять другой человек — и мы вручили бы
    // чужие кредиты. userid у каждого подключения свой и не повторяется.
    new data[2]
    data[0] = id
    data[1] = get_user_userid(id)
    SQL_ThreadQuery(zm_db_tuple(), "sql_loaded", sql, data, sizeof data)
}

public sql_loaded(failstate, Handle:query, const error[], errnum, const data[], size, Float:queuetime)
{
    new id = data[0]
    if (!is_user_connected(id) || get_user_userid(id) != data[1]) return;

    // ⚠️ ОПОЗДАВШИЙ ОТВЕТ НЕ ПРИНИМАЕМ. Сторож ниже мог уже поднять игрока из
    // зеркала, и тот успел заработать кредиты; пришедшая через полминуты
    // выборка вернула бы его к тому, что было до входа.
    if (g_loaded[id]) return;

    if (failstate != TQUERY_SUCCESS)
    {
        log_amx("БАЗА: не прочиталось (%d): %s — читаем зеркало на диске", errnum, error)
        load_from_vault(id)
        return;
    }

    if (SQL_NumResults(query) < 1)
    {
        // В базе записи нет. Может, игрок правда новый, а может, это первый
        // запуск после переезда — тогда всё лежит в зеркале, и оттуда же
        // попадёт в базу при первом же сохранении.
        load_from_vault(id)
        return;
    }

    new cls[32]
    new packs = SQL_ReadResult(query, 0)
    SQL_ReadResult(query, 1, cls, charsmax(cls))

    apply(id, packs, cls, "базы")
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

public load_player(taskid)
{
    new id = taskid - TASK_LOAD
    if (!is_user_connected(id)) return;

    if (!zm_db_on()) { load_from_vault(id); return; }

    load_from_db(id)

    // ⚠️⚠️ СТОРОЖ НА СЛУЧАЙ МОЛЧАНИЯ. Потерянное соединение к хостингу не
    // отвечает ни успехом, ни ошибкой — обработчик просто не зовут. А пока
    // игрок «не загружен», его прогресс НЕ СОХРАНЯЕТСЯ вообще: правило «не
    // сохраняем, если не загрузились» защищает от затирания. Живая проверка
    // это и поймала: ножи со скинами в базе есть, прогресса нет ни строчки.
    // Через zm_db_patience() поднимаем игрока из зеркала и живём дальше.
    remove_task(id + TASK_GUARD)
    set_task(zm_db_patience(), "load_guard", id + TASK_GUARD)
}

public load_guard(taskid)
{
    new id = taskid - TASK_GUARD
    if (!is_user_connected(id) || g_loaded[id]) return;

    log_amx("БАЗА: ответа за %.0f с не пришло — читаем зеркало на диске", zm_db_patience())
    load_from_vault(id)
}

// Запасной путь: зеркало на диске. Оно же — единственный путь, когда база
// выключена кваром zp_use_db.
load_from_vault(id)
{
    if (!is_user_connected(id)) return;
    if (g_vault == INVALID_HANDLE)
    {
        g_loaded[id] = true   // сохранять всё равно можно, просто нечего было брать
        return;
    }

    new key[64]
    new bool:by_steam = key_of(id, key, charsmax(key))

    new data[32]
    if (!nvault_get(g_vault, key, data, charsmax(data)))
    {
        g_loaded[id] = true
        zlog("ВХОД: %s — записи нет, игрок новый", key)
        return;
    }

    // ⚠️ Имя класса бывает из двух слов («Ревенант Огонь»), поэтому parse брать
    // нельзя: он режет по пробелу. Кредиты — до первого пробела, класс — всё
    // остальное.
    new packs_s[16], class_s[32]
    new space = contain(data, " ")
    if (space < 0) space = strlen(data)
    copy(packs_s, min(space, charsmax(packs_s)), data)
    copy(class_s, charsmax(class_s), data[space + (space < strlen(data) ? 1 : 0)])
    trim(class_s)

    apply(id, str_to_num(packs_s), class_s, by_steam ? "зеркала (ключ SteamID)" : "зеркала (ключ по нику)")
}

// Разложить прочитанное по игроку. Одна на оба источника: база и зеркало
// обязаны давать одинаковый результат, иначе восстановление зависело бы от
// того, откуда сегодня прочиталось.
apply(id, packs, const class_s[], const from[])
{
    if (packs < 0) packs = 0
    zp_set_user_ammo_packs(id, packs)

    // Класс ищем ПО ИМЕНИ. Старые записи хранили номер — их пропускаем: после
    // добавления классов номер указывает уже на другой класс, и восстанавливать
    // по нему хуже, чем не восстанавливать вовсе.
    new class = -1
    if (class_s[0] && !(class_s[0] >= '0' && class_s[0] <= '9'))
        class = zp_get_zombie_class_id(class_s)
    if (class >= 0) zp_set_user_zombie_class(id, class)

    g_loaded[id] = true

    new key[64]
    key_of(id, key, charsmax(key))
    zlog("ВХОД: %s — из %s: кредитов %d, класс «%s» (%d)", key, from, packs, class_s, class)

    client_print_color(id, print_team_default,
        "^x04[Вспышка эпидемии]^x01 Прогресс восстановлен: ^x04%d^x01 кредитов.", packs)
}

public cmd_show(id, level, cid)
{
    if (!cmd_access(id, level, cid, 1)) return PLUGIN_HANDLED;

    console_print(id, "хранилище: %s", g_vault == INVALID_HANDLE ? "НЕ ОТКРЫТО" : "открыто")

    new players[32], num
    get_players(players, num)   // все, включая ботов: это диагностика
    for (new i = 0; i < num; i++)
    {
        new p = players[i], key[64], name[32]
        get_user_name(p, name, charsmax(name))
        new bool:by_steam = key_of(p, key, charsmax(key))
        console_print(id, "  %-20s ключ %-40s (%s) загружен: %s",
            name, key, by_steam ? "SteamID" : "по нику", g_loaded[p] ? "да" : "нет")
    }
    if (!num) console_print(id, "  на сервере никого")

    return PLUGIN_HANDLED;
}
