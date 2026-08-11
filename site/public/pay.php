<?php
/**
 * Уведомление кассы об оплате.
 *
 * Единственная страница сайта, которую дёргает не человек. Она же — самая
 * опасная: тот, кто научится подделывать сюда запрос, будет выдавать себе
 * привилегии бесплатно и молча.
 *
 * Поэтому верим только совпавшей подписи и только с адреса кассы, а сумму
 * сверяем с той, что записана в НАШЕМ заказе, а не берём из запроса. Иначе
 * достаточно оплатить рубль, подменив сумму в форме.
 *
 * Ответ кассе — короткое слово без разметки: увидев что-то другое, касса
 * считает уведомление недоставленным и повторяет его часами.
 */

require __DIR__ . '/_boot.php';
require_once ZM_APP . '/grant.php';

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

// Отвечаем и заканчиваем. Подробности — в журнал, наружу ни слова лишнего:
// текст ошибки подскажет тому, кто подбирает подпись, насколько он близок.
function done($text, $logAction, $logDetail, $code = 200)
{
    http_response_code($code);
    try {
        audit($logAction, '', $logDetail, 'касса');
    } catch (Throwable $e) {
        error_log('pay.php: журнал не записан: ' . $e->getMessage());
    }
    echo $text;
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    done('NO', 'pay_bad_method', array('method' => $_SERVER['REQUEST_METHOD']), 405);
}

$ip = client_ip();
$check = payment_verify_callback($_POST, $ip);

if (!$check['ok']) {
    done('NO', 'pay_rejected', array('ip' => $ip, 'why' => $check['error'], 'post' => $_POST), 403);
}

$order = q_row('SELECT * FROM zm_orders WHERE id = ?', array($check['order_id']));
if (!$order) {
    done('NO', 'pay_no_order', array('order' => $check['order_id'], 'ip' => $ip), 404);
}

/*
 * Сумма. Сравниваем с точностью до копейки и с ЗАПАСОМ В МЕНЬШУЮ сторону —
 * касса удерживает комиссию по-разному, и приходить может чуть меньше
 * назначенного. Но «чуть» — это копейки, а не половина: заплатившего рубль
 * вместо четырёхсот пропускать нельзя.
 */
$paid = (float)$check['amount'];
$want = (float)$order['amount'];
if ($paid + 0.01 < $want) {
    q('UPDATE zm_orders SET status = ?, error = ? WHERE id = ?',
        array('failed', sprintf('пришло %.2f вместо %.2f', $paid, $want), $order['id']));
    done('NO', 'pay_underpaid', array('order' => $order['id'], 'paid' => $paid, 'want' => $want), 400);
}

// Отмечаем оплату отдельно от выдачи: деньги пришли — это факт, и он должен
// сохраниться, даже если выдача потом споткнётся.
if ($order['paid_at'] === null) {
    q('UPDATE zm_orders SET status = ?, paid_at = NOW(), provider_id = ? WHERE id = ?',
        array('paid', (string)$check['ext_id'], $order['id']));
}

$res = apply_order((int)$order['id']);

if (isset($res['error'])) {
    // Кассе отвечаем успехом: деньги приняты, повторять уведомление незачем.
    // Разбираться с невыданной привилегией будем в панели — там такой заказ
    // виден как «оплачен, но не выдан».
    done('YES', 'pay_apply_failed', array('order' => $order['id'], 'why' => $res['error']));
}

done(payment_ack(), 'pay_ok', array(
    'order'  => $order['id'],
    'auth'   => $order['auth'],
    'amount' => $paid,
    'already'=> !empty($res['already']),
    'reload' => isset($res['grant']['reload']) ? $res['grant']['reload'] : null,
));
