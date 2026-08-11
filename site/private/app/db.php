<?php
/**
 * Связь с базой. Одно соединение на запрос, лениво — страницы витрины,
 * которым база не нужна, к ней и не пойдут.
 */

function db()
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        cfg('db.host'), (int)cfg('db.port', 3306), cfg('db.name'), cfg('db.charset', 'utf8mb4')
    );

    $pdo = new PDO($dsn, cfg('db.user'), cfg('db.pass'), array(
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        // Настоящие подготовленные запросы, а не подстановка на стороне PHP:
        // подстановка склеивает строку и на кривой кодировке умеет пропустить
        // кавычку. Тут этого не будет никогда.
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::ATTR_TIMEOUT            => 5,
    ));

    // База и сайт должны считать время одинаково: срок действия сравнивается
    // с NOW() базы, а показывается временем PHP. Разъедься они на час — и
    // «купил до 21:00» перестанет совпадать с тем, когда права пропадут.
    $pdo->exec("SET time_zone = '+03:00'");

    return $pdo;
}

/** Запрос с параметрами → PDOStatement. */
function q($sql, $args = array())
{
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}

/** Первая строка либо null. */
function q_row($sql, $args = array())
{
    $r = q($sql, $args)->fetch();
    return $r === false ? null : $r;
}

/** Первый столбец первой строки либо null. */
function q_val($sql, $args = array())
{
    $r = q($sql, $args)->fetchColumn();
    return $r === false ? null : $r;
}

/** Все строки. */
function q_all($sql, $args = array())
{
    return q($sql, $args)->fetchAll();
}

// ── правила, общие с локальной панелью ──────────────────────────────────────
//
// Ровно те же проверки, что в tools/users-ini.mjs. Два входа — веб и локальный
// — обязаны сходиться в мелочах, иначе выданное одним не найдётся другому.

/**
 * Одна ли это запись в глазах сервера.
 *
 * admin.sma сверяет ключи через equali(), а это strncasecmp по байтам: регистр
 * складывается ТОЛЬКО у латиницы. Значит «Vasya» и «vasya» для сервера один
 * игрок, а «Игорь» и «игорь» — разные. Ведём себя так же, иначе склеим две
 * настоящие учётки в одну.
 */
function same_key($a, $b)
{
    return fold_ascii($a) === fold_ascii($b);
}

function fold_ascii($s)
{
    return preg_replace_callback('/[A-Z]/', function ($m) {
        return strtolower($m[0]);
    }, (string)$s);
}

/**
 * Разные для сервера, но неотличимые для человека: тот же ключ с точностью до
 * регистра любых букв, включая русские. Не ошибка, но сказать об этом надо —
 * со стороны это выглядит как та же самая учётка.
 */
function looks_alike($a, $b)
{
    return !same_key($a, $b) && mb_strtolower((string)$a) === mb_strtolower((string)$b);
}

/**
 * Что нельзя записывать.
 *
 * Кавычка ломает разбор users.ini, куда сервер откатывается при недоступной
 * базе: строка распадётся на поля не там, где задумано, и права уедут не тому.
 * Управляющие символы — та же беда, только незаметная.
 */
const FORBIDDEN_RE = '/["\x00-\x1f\x7f]/u';

/**
 * Проверка записи. Возвращает список претензий; пустой список — всё хорошо.
 *
 * Длину меряем В БАЙТАХ: движок держит имя игрока в 31 байте, а кириллическая
 * буква занимает два. Русский ник из шестнадцати букв туда уже не влезает — он
 * обрежется в игре и не совпадёт с записью никогда.
 */
function check_admin($who, $password, $access, $account)
{
    $bad = array();

    if ($who === '') {
        $bad[] = 'не указано, кому выдаём';
    } elseif (preg_match(FORBIDDEN_RE, $who)) {
        $bad[] = 'в имени есть кавычка или служебный символ — так запись не разобрать';
    } elseif (strlen($who) > 31) {
        $bad[] = sprintf('имя не влезает: %d байт из 31 (русская буква занимает два) — в игре оно обрежется и не совпадёт', strlen($who));
    }

    if (preg_match(FORBIDDEN_RE, $password)) {
        $bad[] = 'в пароле есть кавычка или служебный символ';
    } elseif (strlen($password) > 31) {
        $bad[] = sprintf('пароль не влезает: %d байт из 31', strlen($password));
    }

    if (!preg_match('/^[a-u]+$/', $access)) {
        $bad[] = 'флаги доступа — только буквы от «a» до «u», без пробелов';
    }
    if (!preg_match('/^[abcde]+$/', $account)) {
        $bad[] = 'флаги записи — только буквы «a», «b», «c», «d», «e»';
    }
    if (strpos($account, 'c') !== false && !preg_match('/^STEAM_[0-9]:[01]:\d+$/', $who)) {
        $bad[] = sprintf('«%s» не похож на SteamID (ожидается вид STEAM_0:1:12345)', $who);
    }

    return $bad;
}

/** Пароль, который не стыдно выдать игроку: без похожих друг на друга букв. */
function make_password($len = 10)
{
    $alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';   // без l, o, 0, 1
    $out = '';
    $max = strlen($alphabet) - 1;
    for ($i = 0; $i < $len; $i++) {
        $out .= $alphabet[random_int(0, $max)];
    }
    return $out;
}
