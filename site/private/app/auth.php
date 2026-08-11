<?php
/**
 * Вход в панель: сессии, пароли, счётчик промахов.
 *
 * Панель правит права на игровом сервере и показывает игровые пароли, поэтому
 * «логин и пароль» здесь — не формальность. Что сделано против подбора:
 *
 *   * пароль хранится только хэшем (bcrypt через password_hash);
 *   * сравнение — password_verify, оно постоянное по времени;
 *   * промахи считаются и по логину, и по адресу, и после пяти вход
 *     закрывается на четверть часа;
 *   * ответ на неверный логин и на неверный пароль ОДИНАКОВ — иначе форма
 *     превращается в справочник существующих логинов;
 *   * печенье сессии живёт только по HTTPS, недоступно скриптам и не уходит
 *     на чужие сайты;
 *   * при входе номер сессии меняется — заранее подсунутый номер не сработает.
 */

require_once ZM_APP . '/audit.php';

function auth_start()
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    // Принимаем только те номера сессий, что выдали сами. Без этого чужой
    // может назначить жертве известный ему номер и войти следом за ней.
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');

    session_name('zmadm');
    session_set_cookie_params(array(
        'lifetime' => 0,
        'path'     => '/',
        'domain'   => '',
        'secure'   => is_https(),
        'httponly' => true,
        // Strict, а не Lax: панель никуда не встраивается и переходов на неё
        // со стороны быть не должно.
        'samesite' => 'Strict',
    ));
    session_start();

    // Срок бездействия. Вкладка, забытая открытой на общем компьютере, — самый
    // частый способ потерять доступ, и никакой пароль от этого не спасает.
    $idle = (int)cfg('admin.session_min', 120) * 60;
    if (!empty($_SESSION['admin']) && isset($_SESSION['seen']) && time() - $_SESSION['seen'] > $idle) {
        auth_logout();
    }
    $_SESSION['seen'] = time();
}

function current_admin()
{
    return empty($_SESSION['admin']) ? null : $_SESSION['admin'];
}

/** Пускать дальше только вошедших. Иначе — на страницу входа. */
function require_admin()
{
    auth_start();
    if (!current_admin()) {
        redirect('login.php');
    }
}

/** То же для JSON-запросов: панели нужен разбираемый ответ, а не редирект. */
function require_admin_json()
{
    auth_start();
    if (!current_admin()) {
        json_fail('вход не выполнен — откройте панель заново', 401);
    }
}

/**
 * Сколько промахов накопилось. Считаем по адресу И по логину, беря худшее:
 * перебор пароля к одному логину и перебор логинов с одного адреса — одно и
 * то же занятие с разных сторон.
 */
function auth_recent_failures($login, $ip)
{
    $window = (int)cfg('admin.window_min', 15);
    $byIp = (int)q_val(
        'SELECT COUNT(*) FROM zm_login_attempts WHERE ok = 0 AND ip = ? AND at > (NOW() - INTERVAL ? MINUTE)',
        array($ip, $window)
    );
    $byLogin = (int)q_val(
        'SELECT COUNT(*) FROM zm_login_attempts WHERE ok = 0 AND login = ? AND at > (NOW() - INTERVAL ? MINUTE)',
        array($login, $window)
    );
    return max($byIp, $byLogin);
}

/**
 * Попытка входа. Возвращает null при успехе либо текст отказа.
 *
 * Текст отказа намеренно один на все случаи, кроме блокировки: про неё сказать
 * надо, иначе владелец решит, что забыл пароль, и будет добивать счётчик.
 */
function auth_login($login, $password)
{
    $ip = client_ip();
    $limit = (int)cfg('admin.max_attempts', 5);

    if (auth_recent_failures($login, $ip) >= $limit) {
        audit('login_locked', $login, null, $login);
        return sprintf('слишком много попыток — вход закрыт на %d минут', (int)cfg('admin.lockout_min', 15));
    }

    $user = q_row('SELECT * FROM zm_admin_users WHERE login = ?', array($login));

    if ($user) {
        $ok = password_verify($password, $user['pass_hash']);
    } else {
        // Тратим столько же времени, сколько ушло бы на проверку: иначе ответ
        // на несуществующий логин приходит заметно быстрее, и форма
        // превращается в справочник существующих. Хэш считается и
        // выбрасывается — он нужен только ради потраченных миллисекунд.
        password_hash($password, PASSWORD_BCRYPT, array('cost' => 10));
        $ok = false;
    }

    q('INSERT INTO zm_login_attempts (at, ip, login, ok) VALUES (NOW(), ?, ?, ?)',
        array($ip, $login, $ok ? 1 : 0));

    if (!$ok) {
        audit('login_fail', $login, null, $login);
        return 'неверный логин или пароль';
    }

    // Номер сессии меняем ДО того, как записать в неё вход.
    session_regenerate_id(true);
    $_SESSION['admin'] = array('id' => (int)$user['id'], 'login' => $user['login']);
    $_SESSION['seen'] = time();
    unset($_SESSION['csrf']);   // новый вход — новый одноразовый ключ

    q('UPDATE zm_admin_users SET last_login = NOW(), last_ip = ? WHERE id = ?', array($ip, $user['id']));
    audit('login_ok', $login, null, $user['login']);

    // Старые записи о промахах держать незачем: они нужны на четверть часа.
    q('DELETE FROM zm_login_attempts WHERE at < (NOW() - INTERVAL 1 DAY)');

    return null;
}

function auth_logout()
{
    $who = current_admin();
    if ($who) {
        audit('logout', $who['login'], null, $who['login']);
    }
    $_SESSION = array();
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}

/**
 * Требования к паролю самой панели.
 *
 * Длина важнее набора символов: «Qw1!» перебирается быстрее, чем четыре
 * обычных слова подряд. Двенадцать знаков — нижняя граница, ниже которой
 * bcrypt перестаёт быть препятствием.
 */
function admin_password_problem($password)
{
    if (mb_strlen($password) < 12) {
        return 'пароль короче 12 знаков — такой подберут';
    }
    if (preg_match('/^\d+$/', $password)) {
        return 'пароль из одних цифр подберут за минуты';
    }
    return null;
}
