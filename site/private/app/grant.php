<?php
/**
 * Выдача, продление и снятие привилегий.
 *
 * Единственное место, где меняется таблица zm_privileges. Сюда приходят оба
 * входа — панель (руками) и касса (после оплаты), — и правила обязаны быть
 * общими: иначе купленное автоматом и выданное вручную начнут отличаться.
 *
 * ⚠️ ЗАПИСЬ НА ИГРОКА ОДНА. Ключ `auth` уникален, и это не оптимизация: сервер
 * при входе игрока берёт ПЕРВОЕ совпадение, поэтому две записи на один ник —
 * лотерея, в которой выигрывает не та, что выдали последней.
 */

require_once ZM_APP . '/rcon.php';
require_once ZM_APP . '/audit.php';

/**
 * Что станет с записью при покупке уровня поверх имеющегося.
 *
 * Правила выбраны так, чтобы покупка НИКОГДА не ухудшала положение игрока —
 * иначе «доплатил и потерял» станет главной темой в чате:
 *   * уровень берётся наивысший из старого и нового;
 *   * админка, если она была, остаётся;
 *   * срок ПРИБАВЛЯЕТСЯ к остатку, а не заменяет его;
 *   * «навсегда» с любой стороны делает запись вечной.
 */
function merge_grant($existing, $tierIndex, $withAdmin, $days, $dbNow)
{
    $oldTier  = $existing ? tier_of($existing['access']) : -1;
    $oldAdmin = $existing ? (bool)$existing['has_admin'] : false;

    $tier  = max($oldTier, $tierIndex === null ? -1 : $tierIndex);
    $admin = $oldAdmin || $withAdmin;

    // Срок
    if ($existing && $existing['expires_at'] === null) {
        $expires = null;                       // уже вечная — вечной и остаётся
    } elseif ((int)$days === 0) {
        $expires = null;                       // купили «навсегда»
    } else {
        $from = $dbNow;
        if ($existing && $existing['expires_at'] !== null && $existing['expires_at'] > $dbNow) {
            $from = $existing['expires_at'];   // прибавляем к остатку
        }
        $expires = date('Y-m-d H:i:s', strtotime($from . ' +' . (int)$days . ' day'));
    }

    return array('tier' => $tier, 'admin' => $admin, 'expires' => $expires);
}

/** Текущее время ГЛАЗАМИ БАЗЫ: срок сверяется с ним же в представлении admins. */
function db_now()
{
    return (string)q_val('SELECT NOW()');
}

/**
 * Выдать или продлить привилегию.
 *
 * $opts:
 *   who           ключ: ник либо STEAM_0:1:12345
 *   is_steamid    ключ — это SteamID
 *   tier_index    номер уровня в tiers() либо null
 *   with_admin    добавить купленную админку
 *   days          срок; 0 — навсегда
 *   password      пароль игрока; '' вместе с no_password — вход без пароля
 *   no_password   не проверять пароль (флаг «e»)
 *   custom_flags  свои буквы вместо уровня (только из панели)
 *   source        'admin' | 'order'
 *   order_id      номер заказа, если из кассы
 *   note          пометка
 *
 * Возвращает массив с ключом error (список претензий) либо с результатом.
 */
function grant_privilege($opts)
{
    $who        = isset($opts['who']) ? trim((string)$opts['who']) : '';
    $isSteam    = !empty($opts['is_steamid']);
    $withAdmin  = !empty($opts['with_admin']);
    $days       = isset($opts['days']) ? (int)$opts['days'] : 0;
    $noPassword = !empty($opts['no_password']);
    $custom     = isset($opts['custom_flags']) ? strtolower(preg_replace('/\s+/', '', (string)$opts['custom_flags'])) : '';
    $tierIndex  = array_key_exists('tier_index', $opts) && $opts['tier_index'] !== null ? (int)$opts['tier_index'] : null;

    // Ищем ТАК ЖЕ, как найдёт сервер: по ключу со свёрнутой латиницей. Искать
    // по точному написанию нельзя — «Vasya» и «vasya» завели бы две записи на
    // одного игрока, и какая из них сработает, решал бы порядок строк.
    $key = fold_ascii($who);
    $existing = q_row('SELECT * FROM zm_privileges WHERE auth_key = ?', array($key));

    // Пароль. У существующей записи он остаётся прежним: игрок его уже
    // где-то записал, и менять пароль при продлении — это молча отобрать вход.
    if ($noPassword) {
        $password = '';
    } elseif (isset($opts['password']) && $opts['password'] !== '') {
        $password = (string)$opts['password'];
    } elseif ($existing && $existing['password'] !== '') {
        $password = $existing['password'];
    } else {
        $password = make_password();
    }

    $now = db_now();

    if ($custom !== '') {
        // Свои флаги — обход лестницы уровней целиком. Доступно только из
        // панели: касса такого прислать не может.
        $access  = $custom;
        $tier    = tier_of($custom);
        $admin   = $withAdmin;
        $expires = $days === 0 ? null : date('Y-m-d H:i:s', strtotime($now . ' +' . $days . ' day'));
    } else {
        $merged  = merge_grant($existing, $tierIndex, $withAdmin, $days, $now);
        $tier    = $merged['tier'];
        $admin   = $merged['admin'];
        $expires = $merged['expires'];
        $access  = access_flags($tier < 0 ? null : $tier, $admin);
    }

    $account = account_flags($isSteam, $noPassword);

    if ($access === '') {
        return array('error' => array('не выбран уровень — отметьте его или впишите свои флаги'));
    }
    $bad = check_admin($who, $password, $access, $account);
    if ($bad) {
        return array('error' => $bad);
    }

    $tiers = tiers();
    $tierId = ($tier >= 0 && isset($tiers[$tier])) ? $tiers[$tier]['id'] : null;

    if ($existing) {
        // Написание обновляем на свежее: игрок мог сменить регистр в нике, и
        // серверу всё равно (он свернёт), а владельцу в списке приятнее видеть
        // то, как игрок пишется сейчас.
        q(
            'UPDATE zm_privileges
                SET auth = ?, password = ?, access = ?, account = ?, tier = ?, has_admin = ?,
                    expires_at = ?, source = ?, order_id = ?, note = ?
              WHERE id = ?',
            array($who, $password, $access, $account, $tierId, $admin ? 1 : 0, $expires,
                  isset($opts['source']) ? $opts['source'] : 'admin',
                  isset($opts['order_id']) ? $opts['order_id'] : null,
                  isset($opts['note']) ? (string)$opts['note'] : '',
                  $existing['id'])
        );
    } else {
        q(
            'INSERT INTO zm_privileges
                (auth, auth_key, password, access, account, tier, has_admin, granted_at, expires_at, source, order_id, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)',
            array($who, $key, $password, $access, $account, $tierId, $admin ? 1 : 0, $expires,
                  isset($opts['source']) ? $opts['source'] : 'admin',
                  isset($opts['order_id']) ? $opts['order_id'] : null,
                  isset($opts['note']) ? (string)$opts['note'] : '')
        );
    }

    // Запись, отличающаяся только регистром РУССКИХ букв, — для сервера чужая:
    // он складывает регистр лишь у латиницы. Заменить её мы не вправе, но и
    // промолчать нельзя: со стороны это выглядит как та же самая учётка.
    $twin = null;
    foreach (q_all('SELECT auth FROM zm_privileges') as $row) {
        if (looks_alike($row['auth'], $who)) {
            $twin = $row['auth'];
            break;
        }
    }

    audit($existing ? 'extend' : 'grant', $who, array(
        'access' => $access, 'account' => $account, 'expires' => $expires,
        'tier' => $tierId, 'admin' => $admin, 'days' => $days,
        'source' => isset($opts['source']) ? $opts['source'] : 'admin',
    ));

    // Сетевой вызов внутри чужой транзакции — плохая идея: он держит запертую
    // строку заказа все три секунды ожидания. Кто выдаёт из транзакции
    // (apply_order), просит отложить перезагрузку и делает её сам, после
    // commit.
    $reload = empty($opts['defer_reload']) ? rcon_reload_admins() : null;

    return array(
        'auth'     => $who,
        'password' => $password,
        'access'   => $access,
        'account'  => $account,
        'tier'     => $tier,
        'admin'    => $admin,
        'expires'  => $expires,
        'replaced' => $existing ? array('access' => $existing['access'], 'expires' => $existing['expires_at']) : null,
        'notice'   => $twin === null ? null : sprintf(
            'Рядом есть запись «%s» — сервер считает её ДРУГИМ игроком: регистр русских букв он не сглаживает.', $twin),
        'reload'   => $reload,
    );
}

/** Снять привилегию целиком. */
function revoke_privilege($who)
{
    // По свёрнутому ключу, как и выдача: иначе «снять» промахнётся мимо записи,
    // заведённой в другом регистре, и скажет «такого нет» при живой привилегии.
    $row = q_row('SELECT * FROM zm_privileges WHERE auth_key = ?', array(fold_ascii($who)));
    if (!$row) {
        return array('error' => array(sprintf('записи «%s» больше нет — список уже обновился', $who)));
    }
    q('DELETE FROM zm_privileges WHERE id = ?', array($row['id']));
    audit('revoke', $who, array('access' => $row['access'], 'expires' => $row['expires_at']));

    return array('ok' => true, 'reload' => rcon_reload_admins());
}

/**
 * Список для панели.
 *
 * Просроченные записи здесь ВИДНЫ, в отличие от представления admins: на
 * сервере их уже нет, но владельцу надо понимать, у кого срок вышел вчера, —
 * это первый кандидат на продление, а не мусор.
 */
function privileges_list()
{
    $rows = q_all('SELECT * FROM zm_privileges ORDER BY (expires_at IS NULL) DESC, expires_at DESC, auth ASC');
    $now = db_now();
    $tiers = tiers();
    $out = array();

    foreach ($rows as $r) {
        $tier = tier_of($r['access']);
        $expired = $r['expires_at'] !== null && $r['expires_at'] <= $now;
        $out[] = array(
            'auth'     => $r['auth'],
            'password' => $r['password'],
            'access'   => $r['access'],
            'account'  => $r['account'],
            'tier'     => $tier,
            'tierName' => $tier >= 0 ? $tiers[$tier]['name'] : null,
            'admin'    => (bool)$r['has_admin'],
            'full'     => $r['access'] === ALL_FLAGS,
            'nopass'   => strpos($r['account'], 'e') !== false,
            'steamid'  => strpos($r['account'], 'c') !== false,
            'expires'  => $r['expires_at'],
            'expired'  => $expired,
            'left'     => $r['expires_at'] === null ? null : days_left($now, $r['expires_at']),
            'source'   => $r['source'],
            'note'     => $r['note'],
        );
    }
    return $out;
}

/** Сколько суток осталось; отрицательное — сколько прошло с окончания. */
function days_left($now, $until)
{
    $diff = strtotime($until) - strtotime($now);
    return (int)floor($diff / 86400);
}

/**
 * Начислить кредиты живому игроку.
 *
 * ⚠️ ТОЛЬКО ЖИВОМУ. Команда сервера ищет игрока по нику среди подключённых —
 * вышедшему начислить некому: его баланс лежит в nvault сервера, и снаружи мы
 * туда не дотянемся. Поэтому неудача здесь — обычное дело, а не поломка:
 * заказ остаётся ждать в панели, и владелец начислит его, когда игрок зайдёт.
 *
 * ⚠️ ШТАТНАЯ zp_packs НЕ ГОДИТСЯ: она УСТАНАВЛИВАЕТ баланс, а не прибавляет,
 * то есть покупка стёрла бы всё заработанное. Нужна команда-прибавка, её имя
 * берётся из настроек; как её добавить — в site/server-side/README.md.
 */
function deliver_packs($auth, $packs)
{
    $cmd = trim((string)cfg('shop.packs_command', ''));
    if ($cmd === '') {
        return array('ok' => false, 'error' => 'команда начисления кредитов не настроена');
    }
    if (!preg_match('/^[a-z0-9_]+$/i', $cmd)) {
        return array('ok' => false, 'error' => 'имя команды начисления выглядит подозрительно');
    }
    if (strpos($auth, '"') !== false) {
        return array('ok' => false, 'error' => 'в нике кавычка — такую команду не собрать');
    }

    $res = rcon_exec(sprintf('%s "%s" %d', $cmd, $auth, (int)$packs));
    if (!$res['ok']) {
        return array('ok' => false, 'error' => $res['error']);
    }

    // Сервер отвечает текстом. «не найден» — это наш игрок вышел, а не сбой.
    if (mb_stripos($res['out'], 'не найден') !== false || stripos($res['out'], 'not found') !== false) {
        return array('ok' => false, 'error' => 'игрока нет на сервере — начислим, когда зайдёт', 'offline' => true);
    }

    return array('ok' => true, 'out' => $res['out'], 'error' => '');
}

/**
 * Применить оплаченный заказ.
 *
 * ⚠️ РОВНО ОДИН РАЗ. Касса умеет прислать уведомление повторно — при её
 * собственном сбое, при ручном повторе из кабинета, просто по таймауту. Без
 * отметки applied_at второе уведомление продлило бы срок ещё раз, бесплатно.
 * Отметку ставим в той же транзакции, что и выдачу.
 */
function apply_order($orderId)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        // FOR UPDATE: два уведомления могут прийти одновременно, и оба увидят
        // «ещё не применён», если строку не запереть.
        $order = q_row('SELECT * FROM zm_orders WHERE id = ? FOR UPDATE', array($orderId));
        if (!$order) {
            $pdo->rollBack();
            return array('error' => array('заказ не найден'));
        }
        if ($order['applied_at'] !== null) {
            $pdo->rollBack();
            return array('ok' => true, 'already' => true);
        }

        // Кредиты идут мимо базы привилегий: их хранит сам игровой сервер.
        // Транзакцию закрываем ДО обращения к серверу — сетевой вызов не должен
        // держать запертую строку заказа все секунды ожидания.
        if ($order['kind'] === 'packs') {
            $pdo->commit();

            $res = deliver_packs($order['auth'], (int)$order['packs']);
            audit('packs', $order['auth'], array(
                'order' => (int)$order['id'], 'packs' => (int)$order['packs'], 'result' => $res,
            ));

            if (!$res['ok']) {
                // Заказ остаётся неприменённым НАРОЧНО: оплата принята, а
                // начисление ждёт. В панели он виден как «оплачен, не выдан».
                q('UPDATE zm_orders SET error = ? WHERE id = ?',
                    array(mb_substr($res['error'], 0, 250), $order['id']));
                return array('error' => array($res['error']));
            }

            q('UPDATE zm_orders SET status = ?, applied_at = NOW(), error = ? WHERE id = ?',
                array('applied', '', $order['id']));
            return array('ok' => true, 'packs' => (int)$order['packs'], 'order' => $order);
        }

        $tier = tier_by_id($order['tier']);
        if ($tier === null) {
            $pdo->rollBack();
            return array('error' => array('в заказе неизвестный уровень: ' . $order['tier']));
        }

        $res = grant_privilege(array(
            'who'         => $order['auth'],
            'is_steamid'  => (bool)$order['is_steamid'],
            'tier_index'  => $tier['index'],
            'with_admin'  => (bool)$order['with_admin'],
            'days'        => (int)$order['days'],
            'source'      => 'order',
            'order_id'    => (int)$order['id'],
            'note'        => sprintf('заказ №%d', $order['id']),
            'defer_reload' => true,
        ));

        if (isset($res['error'])) {
            q('UPDATE zm_orders SET status = ?, error = ? WHERE id = ?',
                array('failed', mb_substr(implode('; ', $res['error']), 0, 250), $order['id']));
            $pdo->commit();
            return $res;
        }

        q('UPDATE zm_orders SET status = ?, applied_at = NOW(), error = ? WHERE id = ?',
            array('applied', '', $order['id']));
        $pdo->commit();

        // Только теперь, когда строка заказа отпущена: игровой сервер может
        // отвечать секундами, а держать на это время запертую запись нельзя.
        $res['reload'] = rcon_reload_admins();

        return array('ok' => true, 'grant' => $res, 'order' => $order);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('заказ ' . $orderId . ' не применён: ' . $e->getMessage());
        return array('error' => array('внутренняя ошибка при выдаче'));
    }
}
