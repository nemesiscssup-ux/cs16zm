<?php
/**
 * Обмен данными с панелью. Всё в JSON, всё только для вошедшего.
 *
 * Разделение с index.php намеренное: страница отдаётся один раз, а список
 * обновляется после каждого действия. Так панель не перерисовывается целиком
 * и не теряет заполненную форму.
 */

require __DIR__ . '/../_boot.php';
require_once ZM_APP . '/auth.php';
require_once ZM_APP . '/csrf.php';
require_once ZM_APP . '/grant.php';

require_admin_json();
send_security_headers();

$do = isset($_GET['do']) ? (string)$_GET['do'] : '';

/** Всё, что панели нужно для отрисовки. */
function panel_state()
{
    $tiers = array();
    foreach (tiers() as $t) {
        $tiers[] = array(
            'id' => $t['id'], 'name' => $t['name'], 'letter' => $t['letter'],
            'packs' => $t['packs'], 'health' => $t['health'],
            'knives' => $t['knives'], 'skin' => $t['skin'], 'sold' => $t['sold'],
        );
    }

    // Заказы, которые ждут решения: оплаченные, но не выданные, и висящие
    // неоплаченными. Выданные и старые в панели не нужны — на них есть журнал.
    $orders = q_all(
        "SELECT * FROM zm_orders
          WHERE status IN ('new','paid','failed')
            AND created_at > (NOW() - INTERVAL 60 DAY)
          ORDER BY id DESC LIMIT 200"
    );

    return array(
        'admins'     => privileges_list(),
        'orders'     => $orders,
        'tiers'      => $tiers,
        'terms'      => terms(),
        'allFlags'   => ALL_FLAGS,
        'adminFlags' => ADMIN_FLAGS,
        'adminPrice' => ADMIN_PRICE,
        'me'         => current_admin()['login'],
        'payment'    => array('provider' => payment_provider(), 'ready' => payment_ready()),
        'rcon'       => array('enabled' => (bool)cfg('rcon.enabled'), 'host' => (string)cfg('rcon.host')),
        'now'        => db_now(),
    );
}

if ($do === 'state' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    json_out(panel_state());
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_fail('нет такой страницы', 404);
}

// Тело всегда JSON: обычная форма с чужой страницы такой запрос не отправит, а
// с заголовком application/json браузер сначала спросит разрешения — и не
// получит его.
if (strpos((string)(isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : ''), 'application/json') !== 0) {
    json_fail('ожидается application/json', 415);
}

$raw = file_get_contents('php://input', false, null, 0, 64 * 1024);
$body = json_decode((string)$raw, true);
if (!is_array($body)) {
    json_fail('не разобрать запрос', 400);
}

csrf_guard(isset($body['csrf']) ? $body['csrf'] : '');

// ── выдать ──────────────────────────────────────────────────────────────────

if ($do === 'grant') {
    $mode = isset($body['flagsMode']) ? $body['flagsMode'] : 'tier';

    /*
     * Свои флаги и «полные права» — оба обходят лестницу уровней, поэтому идут
     * одной дорогой: прямой строкой букв. Разница только в том, откуда строка
     * взялась. Складывать их с уровнем нельзя — «полные права» и так все буквы
     * алфавита, а свои флаги на то и свои, чтобы уровень в них не подмешивался.
     */
    $custom = '';
    if ($mode === 'custom') {
        $custom = isset($body['customFlags']) ? (string)$body['customFlags'] : '';
    } elseif (!empty($body['full'])) {
        $custom = ALL_FLAGS;
    }

    $res = grant_privilege(array(
        'who'          => isset($body['who']) ? $body['who'] : '',
        'is_steamid'   => isset($body['kind']) && $body['kind'] === 'steamid',
        'tier_index'   => ($custom !== '' || !isset($body['tier']) || $body['tier'] === null) ? null : (int)$body['tier'],
        'with_admin'   => $custom === '' && !empty($body['admin']),
        'custom_flags' => $custom,
        'days'         => isset($body['days']) ? (int)$body['days'] : 0,
        'no_password'  => isset($body['passwordMode']) && $body['passwordMode'] === 'none',
        'password'     => (isset($body['passwordMode']) && $body['passwordMode'] === 'manual' && isset($body['password']))
                          ? (string)$body['password'] : '',
        'source'       => 'admin',
        'note'         => isset($body['note']) ? (string)$body['note'] : '',
    ));

    if (isset($res['error'])) {
        json_fail($res['error'], 400);
    }
    $res['state'] = panel_state();
    json_out($res);
}

// ── снять ───────────────────────────────────────────────────────────────────

if ($do === 'revoke') {
    $res = revoke_privilege(isset($body['who']) ? (string)$body['who'] : '');
    if (isset($res['error'])) {
        json_fail($res['error'], 404);
    }
    $res['state'] = panel_state();
    json_out($res);
}

// ── заказы ──────────────────────────────────────────────────────────────────

/*
 * Подтверждение оплаты руками. Нужно, пока касса не подключена, и остаётся
 * нужным после: перевод мимо кассы, возврат, доплата — всё это решается
 * здесь. Действие пишется в журнал с логином того, кто подтвердил, потому что
 * это выдача привилегии за деньги, которых система не видела.
 */
if ($do === 'order_paid') {
    $id = isset($body['id']) ? (int)$body['id'] : 0;
    $order = q_row('SELECT * FROM zm_orders WHERE id = ?', array($id));
    if (!$order) {
        json_fail('заказ не найден', 404);
    }
    if ($order['paid_at'] === null) {
        q('UPDATE zm_orders SET status = ?, paid_at = NOW() WHERE id = ?', array('paid', $id));
    }
    audit('order_paid_manual', $order['auth'], array('order' => $id, 'amount' => $order['amount']));

    $res = apply_order($id);
    if (isset($res['error'])) {
        json_fail($res['error'], 400);
    }
    json_out(array('ok' => true, 'state' => panel_state()));
}

if ($do === 'order_drop') {
    $id = isset($body['id']) ? (int)$body['id'] : 0;
    $order = q_row('SELECT * FROM zm_orders WHERE id = ?', array($id));
    if (!$order) {
        json_fail('заказ не найден', 404);
    }
    q('UPDATE zm_orders SET status = ? WHERE id = ?', array('refunded', $id));
    audit('order_drop', $order['auth'], array('order' => $id));
    json_out(array('ok' => true, 'state' => panel_state()));
}

// ── связь с игровым сервером ────────────────────────────────────────────────

if ($do === 'rcon') {
    $res = rcon_reload_admins();
    audit('rcon_check', '', $res);
    json_out($res);
}

json_fail('нет такой страницы', 404);
