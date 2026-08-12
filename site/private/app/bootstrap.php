<?php
/**
 * Общее начало для всех страниц: настройки, заголовки, мелкие помощники.
 *
 * Подключается ЕДИНСТВЕННЫМ способом — через public/_boot.php, который сам
 * находит /private, поднимаясь вверх по каталогам. Городить путь вида
 * dirname(dirname(dirname(__DIR__))) в каждой странице нельзя: он молча врёт,
 * стоит переложить файл на уровень глубже, и ломается не сразу.
 */

if (defined('ZM_BOOTED')) {
    return;
}
define('ZM_BOOTED', true);

// Ошибки в браузер не показываем никогда: текст ошибки PHP охотно называет
// пути, имена таблиц и куски запроса. В журнал — да, посетителю — нет.
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);

define('ZM_PRIVATE', dirname(__DIR__));
define('ZM_APP', __DIR__);

/**
 * Версия статики. Подставляется в адрес каждого файла, который браузеру
 * незачем перезапрашивать зря: стиль, просмотрщик, модели.
 *
 * ⚠️ ЭТО НЕ УКРАШЕНИЕ. Хостинг отдаёт картинки с Cache-Control: max-age=86400,
 * и DDoS-Guard раздаёт свою копию по тому же адресу СУТКИ. Обновление
 * страницы с Ctrl+F5 сбрасывает кэш браузера, но не кэш защиты — владелец
 * сутки видел на моделях рекламу, которой на сервере уже не было.
 *
 * Поднимайте число ПРИ КАЖДОЙ правке моделей, стиля или просмотрщика.
 */
define('ZM_ASSET_V', '24');

ini_set('log_errors', '1');
ini_set('error_log', ZM_PRIVATE . '/logs/php-error.log');
if (!is_dir(ZM_PRIVATE . '/logs')) {
    @mkdir(ZM_PRIVATE . '/logs', 0700, true);
}

date_default_timezone_set('Europe/Moscow');
mb_internal_encoding('UTF-8');

// ── настройки ───────────────────────────────────────────────────────────────

$configFile = ZM_PRIVATE . '/config.php';
if (!is_file($configFile)) {
    header('HTTP/1.1 503 Service Unavailable');
    header('Content-Type: text/plain; charset=utf-8');
    // Пути не называем: страница видна всем, включая тех, кто её и ломает.
    exit("Сайт ещё не настроен.\n");
}

$GLOBALS['ZM_CFG'] = require $configFile;

/** Настройка по пути вида 'db.host'; $def — если её нет. */
function cfg($path, $def = null)
{
    $node = $GLOBALS['ZM_CFG'];
    foreach (explode('.', $path) as $key) {
        if (!is_array($node) || !array_key_exists($key, $node)) {
            return $def;
        }
        $node = $node[$key];
    }
    return $node;
}

require ZM_APP . '/tiers.php';
require ZM_APP . '/catalog.php';
require ZM_APP . '/db.php';
require ZM_APP . '/payment.php';

// ── заголовки ───────────────────────────────────────────────────────────────

/**
 * Общая защита для любой страницы.
 *
 * frame-ancestors и X-Frame-Options закрывают подмену страницы поверх чужой:
 * иначе панель можно спрятать в прозрачном окне и заставить админа нажать
 * «снять» вслепую. nosniff не даёт браузеру угадывать тип у загруженного
 * файла — а в корне сайта у нас лежит FastDL с чужими моделями.
 */
function send_security_headers($csp = null)
{
    if (headers_sent()) {
        return;
    }
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()');
    if ($csp === null) {
        // Своё и только своё. Стиль и скрипт лежат внутри страницы — им нужен
        // 'unsafe-inline'; выносить их в файлы ради чистоты CSP значит два
        // лишних запроса на каждую загрузку и ничего больше: сторонних
        // скриптов на сайте нет вообще.
        $csp = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
             . "script-src 'self' 'unsafe-inline'; form-action 'self' https:; "
             . "connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";
    }
    header('Content-Security-Policy: ' . $csp);
    // HSTS ставим только под HTTPS: по HTTP этот заголовок не имеет силы, а на
    // случайном поддомене без сертификата — стреляет в ногу.
    if (is_https()) {
        header('Strict-Transport-Security: max-age=15552000');
    }
}

/**
 * Пришёл ли запрос по HTTPS.
 *
 * ⚠️ Сайт стоит за DDoS-Guard: до Apache доходит уже расшифрованный запрос, и
 * $_SERVER['HTTPS'] бывает пуст, хотя посетитель шёл по https. Поэтому
 * смотрим и на заголовок, который ставит защита.
 */
function is_https()
{
    if (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    $proto = isset($_SERVER['HTTP_X_FORWARDED_PROTO']) ? strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) : '';
    return $proto === 'https';
}

/**
 * Адрес посетителя.
 *
 * REMOTE_ADDR за DDoS-Guard — это адрес самой защиты, один на всех; считать по
 * нему попытки входа значит запереть панель из-за чужого перебора. Настоящий
 * адрес защита кладёт в заголовок. Заголовку верим ТОЛЬКО потому, что снаружи
 * к Apache не подключиться напрямую — весь трафик идёт через защиту, которая
 * этот заголовок перезаписывает.
 */
function client_ip()
{
    foreach (array('HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP') as $h) {
        if (empty($_SERVER[$h])) {
            continue;
        }
        $first = trim(explode(',', $_SERVER[$h])[0]);
        if (filter_var($first, FILTER_VALIDATE_IP)) {
            return $first;
        }
    }
    return isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
}

/** Экранирование для вставки в HTML. Коротко, потому что встречается всюду. */
function h($s)
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Ответ в JSON и выход. */
function json_out($data, $code = 200)
{
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Ошибка в JSON: массив строк, как ждёт панель. */
function json_fail($messages, $code = 400)
{
    json_out(array('error' => is_array($messages) ? array_values($messages) : array($messages)), $code);
}

function redirect($url)
{
    header('Location: ' . $url);
    exit;
}

/** Строка из POST — обрезанная и без управляющих символов. */
function post_str($key, $max = 190)
{
    $v = isset($_POST[$key]) ? $_POST[$key] : '';
    if (!is_string($v)) {
        return '';
    }
    $v = preg_replace('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u', '', $v);
    return mb_substr(trim($v), 0, $max);
}
