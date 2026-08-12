<?php
/**
 * Проверка главного денежного правила: без оплаты привилегия не выдаётся.
 *
 * ⚠️ ЗАЧЕМ ОНА ЕСТЬ. apply_order() раздаёт товар, и до 12 августа 2026 она
 * НЕ проверяла оплату вовсе — полагалась на то, что звонящий сам убедился.
 * Оба звонящих убеждались, так что бесплатных привилегий никто не получил, но
 * охрана денег стояла вне той функции, которая их раздаёт. Проверка написана
 * ровно затем, чтобы это не вернулось: уберите условие из apply_order — и она
 * покраснеет.
 *
 * Настоящую базу тест не трогает: там боевые заказы. Вместо db.php ему
 * подсовываются таблицы в памяти, а вместо rcon и журнала — пустышки.
 *
 * Запуск:  php site/tools/test-apply-order.php
 */

$APP = dirname(__DIR__) . '/private/app';
$TMP = sys_get_temp_dir() . '/zm-test-apply-' . getmypid();
@mkdir($TMP, 0777, true);

/*
 * grant.php сам подключает rcon.php и audit.php по пути ZM_APP. Направляем
 * ZM_APP во временный каталог с пустышками: настоящий rcon полез бы в сеть, а
 * журнал — в базу.
 */
file_put_contents($TMP . '/rcon.php',
    "<?php\nfunction rcon_reload_admins() { return array('ok' => true); }\n"
    . "function rcon_exec(\$c) { return array('ok' => false, 'out' => '', 'error' => 'заглушка'); }\n");
file_put_contents($TMP . '/audit.php',
    "<?php\nfunction audit(\$a, \$t = '', \$d = null, \$w = '') { return true; }\n");

define('ZM_APP', $TMP);

// ── поддельная база ─────────────────────────────────────────────────────────

$GLOBALS['T'] = array('orders' => array(), 'priv' => array());

class ZmFakePdo
{
    private $in = false;
    public function beginTransaction() { $this->in = true; return true; }
    public function commit() { $this->in = false; return true; }
    public function rollBack() { $this->in = false; return true; }
    public function inTransaction() { return $this->in; }
    public function lastInsertId() { return 1; }
}

function db()
{
    static $p = null;
    if ($p === null) { $p = new ZmFakePdo(); }
    return $p;
}

function q($sql, $args = array())
{
    if (strpos($sql, 'UPDATE zm_orders') !== false) {
        $id = (int)end($args);
        foreach ($GLOBALS['T']['orders'] as $i => $o) {
            if ((int)$o['id'] !== $id) { continue; }
            if (strpos($sql, 'applied_at = NOW()') !== false) {
                $GLOBALS['T']['orders'][$i]['applied_at'] = '2026-08-12 20:00:00';
            }
            if (strpos($sql, 'status = ?') !== false) {
                $GLOBALS['T']['orders'][$i]['status'] = $args[0];
            }
        }
        return true;
    }
    if (strpos($sql, 'INSERT INTO zm_privileges') !== false) {
        $GLOBALS['T']['priv'][] = array(
            'auth' => $args[0], 'auth_key' => $args[1], 'password' => $args[2],
            'access' => $args[3], 'account' => $args[4], 'tier' => $args[5],
            'admin_access' => $args[6], 'expires_at' => $args[7], 'admin_until' => $args[8],
        );
    }
    return true;
}

function q_row($sql, $args = array())
{
    if (strpos($sql, 'FROM zm_orders') !== false) {
        foreach ($GLOBALS['T']['orders'] as $o) {
            if ((int)$o['id'] === (int)$args[0]) { return $o; }
        }
    }
    if (strpos($sql, 'FROM zm_privileges') !== false) {
        foreach ($GLOBALS['T']['priv'] as $p) {
            if ($p['auth_key'] === $args[0]) { return $p; }
        }
    }
    return null;
}

function q_all($sql, $args = array()) { return $GLOBALS['T']['priv']; }
function q_val($sql, $args = array()) { return '2026-08-12 20:00:00'; }

// Мелочи из db.php и bootstrap.php, без которых grant.php не соберётся.
function fold_ascii($s) { return preg_replace_callback('~[A-Z]~', function ($m) { return strtolower($m[0]); }, $s); }
function looks_alike($a, $b) { return false; }
function make_password() { return 'zzz12345'; }
function check_admin($who, $pass, $access, $account) { return array(); }
function cfg($path, $def = null) { return $def; }
function h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

require $APP . '/tiers.php';
require $APP . '/grant.php';

// ── сами проверки ───────────────────────────────────────────────────────────

function zm_order($over = array())
{
    return array_merge(array(
        'id' => 1, 'auth' => 'проверка', 'is_steamid' => 0,
        'kind' => 'admin', 'tier' => null, 'days' => 30, 'packs' => 0,
        'amount' => '149.00', 'status' => 'new',
        'paid_at' => null, 'applied_at' => null, 'error' => '',
    ), $over);
}

function zm_case($name, $ord, $expectGranted, $why)
{
    $GLOBALS['T'] = array('orders' => array($ord), 'priv' => array());
    $res = apply_order(1);

    $granted = count($GLOBALS['T']['priv']) > 0;
    $ok = ($granted === $expectGranted);
    printf("%s %s\n        %s\n        выдано: %s | ответ: %s\n\n",
        $ok ? '  OK  ' : '  ХУДО', $name, $why,
        $granted ? 'ДА' : 'нет',
        isset($res['error']) ? implode('; ', $res['error'])
            : (!empty($res['already']) ? 'уже применён' : 'ok'));
    return $ok ? 0 : 1;
}

$bad = 0;

$bad += zm_case('заказ НЕ оплачен', zm_order(), false,
    'paid_at пуст — выдавать нечего, кто бы ни позвал');

$bad += zm_case('заказ оплачен', zm_order(array('paid_at' => '2026-08-12 19:00:00', 'status' => 'paid')), true,
    'деньги пришли — админка выдана');

$bad += zm_case('уже выдан раньше', zm_order(array(
        'paid_at' => '2026-08-12 19:00:00', 'applied_at' => '2026-08-12 19:05:00', 'status' => 'applied')), false,
    'повторное уведомление кассы не выдаёт второй раз');

$bad += zm_case('оплачен, но уровня такого нет', zm_order(array(
        'kind' => 'tier', 'tier' => 'выдуманный', 'paid_at' => '2026-08-12 19:00:00')), false,
    'битый заказ не выдаёт ничего');

// Покупка админки не смеет выдать уровень: это разные товары с разными сроками.
$GLOBALS['T'] = array('orders' => array(zm_order(array('paid_at' => '2026-08-12 19:00:00'))), 'priv' => array());
apply_order(1);
$p = $GLOBALS['T']['priv'][0];
$clean = ($p['tier'] === null && $p['access'] === '' && $p['admin_access'] === ADMIN_FLAGS);
printf("  %s покупка админки не выдала уровня (уровень=%s, буквы админки=%s)\n\n",
    $clean ? 'OK  ' : 'ХУДО', var_export($p['tier'], true), $p['admin_access']);
$bad += $clean ? 0 : 1;

@unlink($TMP . '/rcon.php');
@unlink($TMP . '/audit.php');
@rmdir($TMP);

printf("итог: провалов %d\n", $bad);
exit($bad === 0 ? 0 : 1);
