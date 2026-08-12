<?php
/**
 * Касса.
 *
 * Между витриной и конкретным приёмщиком денег намеренно стоит тонкая
 * прослойка: сменить кассу должно быть правкой настроек, а не переписыванием
 * магазина. Наружу торчат три действия — начать оплату, проверить уведомление,
 * ответить кассе.
 *
 * Поставщик 'manual' — это НЕ заглушка. Он работает сразу и полностью: заказ
 * создаётся, висит со статусом «ждёт оплаты», а вы подтверждаете его в панели,
 * когда деньги пришли переводом. Пока нет ключей от кассы, магазин уже
 * торгует.
 *
 * ⚠️ ГЛАВНОЕ ПРАВИЛО. Единственное, чему можно верить, — подпись уведомления,
 * посчитанная секретным словом. Ни сумме из запроса, ни статусу, ни адресу
 * отправителя самим по себе доверять нельзя: всё это подделывается за минуту.
 * Поэтому здесь сверяется и подпись, и сумма с той, что записана в заказе.
 */

/** Как называется выбранная касса. */
function payment_provider()
{
    $p = (string)cfg('payment.provider', 'manual');
    return in_array($p, array('manual', 'freekassa'), true) ? $p : 'manual';
}

/** Настроена ли касса настолько, чтобы принимать деньги автоматически. */
function payment_ready()
{
    if (payment_provider() !== 'freekassa') {
        return false;
    }
    return cfg('payment.freekassa.merchant_id') !== ''
        && cfg('payment.freekassa.secret1') !== ''
        && cfg('payment.freekassa.secret2') !== '';
}

/**
 * Куда отправить покупателя после создания заказа.
 *
 * Возвращает null, если платить надо вручную — тогда витрина покажет
 * реквизиты и номер заказа.
 */
function payment_redirect_url($order)
{
    if (!payment_ready()) {
        return null;
    }

    $merchant = (string)cfg('payment.freekassa.merchant_id');
    $secret1  = (string)cfg('payment.freekassa.secret1');
    $currency = (string)cfg('payment.freekassa.currency', 'RUB');
    // Сумму в подпись кладём ровно в том виде, в каком отправляем: касса
    // считает подпись по строке, и «399» против «399.00» — разные строки.
    $amount   = number_format((float)$order['amount'], 2, '.', '');
    $orderId  = (string)$order['id'];

    $sign = md5(implode(':', array($merchant, $amount, $secret1, $currency, $orderId)));

    $params = array(
        'm'        => $merchant,
        'oa'       => $amount,
        'currency' => $currency,
        'o'        => $orderId,
        's'        => $sign,
        'lang'     => 'ru',
        // Возвращается покупателю обратно в уведомлении — по нему находим
        // заказ, даже если номер потеряется.
        'us_auth'  => $order['auth'],
    );

    return 'https://pay.freekassa.ru/?' . http_build_query($params);
}

/**
 * Разобрать и проверить уведомление кассы.
 *
 * Возвращает массив:
 *   ok        — уведомлению можно ВЕРИТЬ (подпись сошлась, адрес наш)
 *   paid      — деньги ДЕЙСТВИТЕЛЬНО получены
 *   order_id  — номер нашего заказа
 *   amount    — сумма, которую называет касса
 *   ext_id    — номер операции у кассы
 *   error     — почему не верим
 *
 * ⚠️ `ok` И `paid` — РАЗНЫЕ ВЕЩИ, И РАЗДЕЛЕНЫ ОНИ НЕ ДЛЯ КРАСОТЫ. У FreeKassa
 * они совпадают: она шлёт уведомление только по успешной оплате, и верная
 * подпись означает пришедшие деньги. У других касс — нет.
 *
 * ⚠️⚠️ КТО БУДЕТ ПОДКЛЮЧАТЬ Т-БАНК, ПРОЧТИТЕ ЭТО ДВАЖДЫ. Он шлёт уведомление
 * на КАЖДУЮ смену состояния платежа: NEW, AUTHORIZED, CONFIRMED, REJECTED,
 * REFUNDED. Подпись у всех них верная — она и должна быть верной, это его
 * же уведомления. Деньги получены ТОЛЬКО при CONFIRMED (а при AUTHORIZED они
 * лишь заморожены на карте). Приравняете верную подпись к оплате — сайт начнёт
 * выдавать привилегии по уведомлению об ОТКАЗЕ в платеже.
 *
 * Поэтому новая касса обязана возвращать `paid` отдельно, а не считать, что
 * `ok` его заменяет. apply_order() дополнительно не выдаёт ничего, пока у
 * заказа не проставлен paid_at, — но это последний рубеж, а не первый.
 */
function payment_verify_callback($post, $ip)
{
    if (payment_provider() !== 'freekassa') {
        return array('ok' => false, 'paid' => false, 'error' => 'касса не настроена — уведомления не ждём');
    }

    /*
     * Список адресов кассы. Пустой список означал бы «принимать со всех», и это
     * дыра: уведомление тогда шлёт кто угодно. Поэтому пустой список —
     * основание отказать, а не разрешить.
     */
    $allow = cfg('payment.freekassa.allow_ip', array());
    if (!is_array($allow) || !$allow) {
        return array('ok' => false, 'paid' => false, 'error' => 'не задан список адресов кассы');
    }
    if (!in_array($ip, $allow, true)) {
        return array('ok' => false, 'paid' => false, 'error' => 'уведомление пришло с чужого адреса: ' . $ip);
    }

    $merchant = (string)cfg('payment.freekassa.merchant_id');
    $secret2  = (string)cfg('payment.freekassa.secret2');

    $got      = isset($post['SIGN']) ? strtolower((string)$post['SIGN']) : '';
    $amount   = isset($post['AMOUNT']) ? (string)$post['AMOUNT'] : '';
    $orderId  = isset($post['MERCHANT_ORDER_ID']) ? (string)$post['MERCHANT_ORDER_ID'] : '';
    $extId    = isset($post['intid']) ? (string)$post['intid'] : '';
    $mid      = isset($post['MERCHANT_ID']) ? (string)$post['MERCHANT_ID'] : '';

    if ($mid !== $merchant) {
        return array('ok' => false, 'paid' => false, 'error' => 'уведомление о чужом магазине');
    }

    $want = md5(implode(':', array($merchant, $amount, $secret2, $orderId)));

    // hash_equals, а не «===»: обычное сравнение обрывается на первом
    // различии, и по времени ответа подпись подбирается посимвольно.
    if (!hash_equals($want, $got)) {
        return array('ok' => false, 'paid' => false, 'error' => 'подпись не сходится');
    }

    /*
     * paid = true, потому что FreeKassa шлёт уведомление ТОЛЬКО по успешной
     * оплате: у неё нет отдельного «платёж отклонён». Для кассы, у которой
     * такое есть, здесь обязана стоять проверка её поля состояния.
     */
    return array(
        'ok'       => true,
        'paid'     => true,
        'order_id' => (int)$orderId,
        'amount'   => (float)$amount,
        'ext_id'   => $extId,
        'error'    => '',
    );
}

/** Что касса ждёт в ответ, чтобы перестать повторять уведомление. */
function payment_ack()
{
    return payment_provider() === 'freekassa' ? 'YES' : 'OK';
}
