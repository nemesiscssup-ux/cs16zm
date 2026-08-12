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

// ── два срока, считаемые порознь ────────────────────────────────────────────
//
// У записи их теперь два: expires_at — срок УРОВНЯ, admin_until — срок
// АДМИНКИ. Считать их надо раздельно, иначе покупка одного двигала бы срок
// другого, а это и есть «доплатил и потерял».

/**
 * Прибавить купленный срок к тому, что уже оплачено.
 *
 * $hasLetters — есть ли у этой стороны буквы вообще; без этого вопроса не
 * обойтись.
 *
 * ⚠️ NULL в сроке читается как «навсегда» — но только рядом с непустыми
 * буквами. У записи, где куплена одна админка, expires_at лежит NULL просто
 * потому, что уровня нет. Не спроси мы про буквы, покупка уровня поверх такой
 * записи выдала бы вечный уровень по цене месяца. То же самое зеркально:
 * admin_until у записи без админки.
 */
function extend_term($until, $hasLetters, $days, $dbNow)
{
    if ($hasLetters && $until === null) {
        return null;                       // уже вечное — вечным и остаётся
    }
    if ((int)$days === 0) {
        return null;                       // купили «навсегда»
    }
    // Прибавляем к ОСТАТКУ, а не начинаем отсчёт заново: иначе доплата в
    // середине срока молча укоротила бы оплаченное.
    $from = ($hasLetters && $until !== null && $until > $dbNow) ? $until : $dbNow;

    return date('Y-m-d H:i:s', strtotime($from . ' +' . (int)$days . ' day'));
}

/**
 * Что станет с записью при покупке поверх имеющегося.
 *
 * Правила выбраны так, чтобы покупка НИКОГДА не ухудшала положение игрока —
 * иначе «доплатил и потерял» станет главной темой в чате:
 *   * уровень берётся наивысший из ЖИВОГО старого и нового — просроченный в
 *     сравнении не участвует, иначе его можно воскресить дешёвой покупкой;
 *   * $tierIndex === null — «уровень не трогать»: старые буквы и срок уровня
 *     переносятся как есть, поэтому покупка админки не сдвигает срок уровня;
 *   * $wantAdmin === false оставляет уже купленную админку нетронутой, поэтому
 *     доплата за уровень её не отбирает и не укорачивает;
 *   * каждый срок ПРИБАВЛЯЕТСЯ к своему остатку, а не заменяет его;
 *   * «навсегда» с любой стороны делает соответствующий срок вечным.
 */
function merge_grant($existing, $tierIndex, $days, $wantAdmin, $adminDays, $dbNow)
{
    // Пустые буквы — это «стороны нет вовсе», и её срок ничего не значит.
    $hasTier        = $existing && $existing['access'] !== '';
    $hasAdmin       = $existing && $existing['admin_access'] !== '';
    $oldTier        = $hasTier ? tier_of($existing['access']) : -1;
    $oldExpires     = $hasTier ? $existing['expires_at'] : null;
    $oldAdminUntil  = $hasAdmin ? $existing['admin_until'] : null;

    /*
     * ⚠️ ЖИВ ЛИ СТАРЫЙ УРОВЕНЬ — ОТДЕЛЬНЫЙ ВОПРОС, И НЕ ЗАДАТЬ ЕГО СТОИТ ДЕНЕГ.
     * Буквы из `access` при окончании срока НЕ СТИРАЮТСЯ: просроченную запись
     * прячет представление zm_admins, а в таблице она лежит как лежала. Значит
     * tier_of() честно вернёт «Фараон» и через год после того, как Фараон
     * кончился. Засчитай мы такой уровень в max() ниже — и человек с истёкшим
     * вчера Фараоном покупал бы VIP за 79 ₽ и получал полного Фараона на
     * тридцать дней. Купить больше оплаченного можно было бы бесконечно, раз
     * за разом, самым дешёвым уровнем.
     *
     * Поэтому в сравнение уровней идёт только ЖИВОЙ уровень. Мёртвый при этом
     * не стирается: если человек пришёл за одной админкой, его протухшие буквы
     * остаются лежать нетронутыми — серверу их всё равно не покажут.
     */
    $tierLive = $hasTier && ($oldExpires === null || $oldExpires > $dbNow);
    $liveTier = $tierLive ? $oldTier : -1;

    if ($tierIndex === null) {
        // Уровня не касаемся ни буквой, ни днём: пришли за админкой.
        $tier    = $oldTier;
        $access  = $hasTier ? $existing['access'] : '';
        $expires = $oldExpires;
    } else {
        $tier    = max($liveTier, (int)$tierIndex);
        $access  = $tier >= 0 ? tier_flags($tier) : '';
        $expires = extend_term($oldExpires, $tierLive, $days, $dbNow);
    }

    if ($wantAdmin) {
        $adminAccess = ADMIN_FLAGS;
        $adminUntil  = extend_term($oldAdminUntil, $hasAdmin, $adminDays, $dbNow);
    } else {
        // Куплена — значит куплена: доплата за уровень её не отбирает.
        $adminAccess = $hasAdmin ? $existing['admin_access'] : '';
        $adminUntil  = $oldAdminUntil;
    }

    return array(
        'tier'         => $tier,
        'access'       => $access,
        'expires'      => $expires,
        'admin_access' => $adminAccess,
        'admin_until'  => $adminUntil,
    );
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
 *   tier_index    номер уровня в tiers(); null — уровень не трогать вовсе
 *   with_admin    добавить или продлить купленную админку
 *   days          срок УРОВНЯ; 0 — навсегда
 *   admin_days    срок АДМИНКИ; 0 — навсегда
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
    // ⚠️ Забытый admin_days — это НЕ ноль: ноль означает «навсегда», и вечная
    // админка раздавалась бы по недосмотру вызывающего. Пока ключа нет, срок
    // админки равен сроку уровня — ровно так вело себя старое общее поле.
    $adminDays  = isset($opts['admin_days']) ? (int)$opts['admin_days'] : $days;
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
        $expires = $days === 0 ? null : date('Y-m-d H:i:s', strtotime($now . ' +' . $days . ' day'));

        // ⚠️ Своими флагами админка НЕ дополняется (api.php шлёт with_admin
        // только при пустых своих флагах) — но и не отбирается: она куплена
        // отдельно, за отдельные деньги и со своим сроком. Считаем её тем же
        // слиянием, попросив не трогать уровень, и берём только её половину.
        $side        = merge_grant($existing, null, 0, $withAdmin, $adminDays, $now);
        $adminAccess = $side['admin_access'];
        $adminUntil  = $side['admin_until'];
    } else {
        $merged      = merge_grant($existing, $tierIndex, $days, $withAdmin, $adminDays, $now);
        $tier        = $merged['tier'];
        $access      = $merged['access'];
        $expires     = $merged['expires'];
        $adminAccess = $merged['admin_access'];
        $adminUntil  = $merged['admin_until'];
    }

    $account = account_flags($isSteam, $noPassword);

    if ($access === '' && $adminAccess === '') {
        return array('error' => array('не выбрано ничего: ни уровень, ни админка, ни свои флаги'));
    }
    // Проверяем СКЛЕЕННЫЕ буквы: представление zm_admins отдаёт серверу
    // access и admin_access одной строкой, и придираться надо к ней же.
    $bad = check_admin($who, $password, $access . $adminAccess, $account);
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
                SET auth = ?, password = ?, access = ?, account = ?, tier = ?, admin_access = ?,
                    expires_at = ?, admin_until = ?, source = ?, order_id = ?, note = ?
              WHERE id = ?',
            array($who, $password, $access, $account, $tierId, $adminAccess, $expires, $adminUntil,
                  isset($opts['source']) ? $opts['source'] : 'admin',
                  isset($opts['order_id']) ? $opts['order_id'] : null,
                  isset($opts['note']) ? (string)$opts['note'] : '',
                  $existing['id'])
        );
    } else {
        q(
            'INSERT INTO zm_privileges
                (auth, auth_key, password, access, account, tier, admin_access,
                 granted_at, expires_at, admin_until, source, order_id, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)',
            array($who, $key, $password, $access, $account, $tierId, $adminAccess, $expires, $adminUntil,
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
        'tier' => $tierId, 'days' => $days,
        'admin_access' => $adminAccess, 'admin_until' => $adminUntil, 'admin_days' => $adminDays,
        'source' => isset($opts['source']) ? $opts['source'] : 'admin',
    ));

    // Сетевой вызов внутри чужой транзакции — плохая идея: он держит запертую
    // строку заказа все три секунды ожидания. Кто выдаёт из транзакции
    // (apply_order), просит отложить перезагрузку и делает её сам, после
    // commit.
    $reload = empty($opts['defer_reload']) ? rcon_reload_admins() : null;

    return array(
        'auth'         => $who,
        'password'     => $password,
        'access'       => $access,
        'account'      => $account,
        'tier'         => $tier,
        'expires'      => $expires,
        'admin_access' => $adminAccess,
        'admin_until'  => $adminUntil,
        'replaced'     => $existing ? array('access' => $existing['access'], 'expires' => $existing['expires_at']) : null,
        'notice'       => $twin === null ? null : sprintf(
            'Рядом есть запись «%s» — сервер считает её ДРУГИМ игроком: регистр русских букв он не сглаживает.', $twin),
        'reload'       => $reload,
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
    // В журнал идут обе половины: снятие уносит и купленную админку, а «у меня
    // забрали админку» — спор, который решается только записью о том, что было.
    audit('revoke', $who, array(
        'access' => $row['access'], 'expires' => $row['expires_at'],
        'admin_access' => $row['admin_access'], 'admin_until' => $row['admin_until'],
    ));

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
    /*
     * Сортировка смотрит на ОБЕ жизни записи. Сортируй мы по одному
     * expires_at, запись с протухшим уровнем, но живой купленной админкой
     * улетела бы в самый хвост, к мёртвым, — а она действующая, и владелец
     * должен видеть её среди живых. Сверху вечные (вечное хоть с одной
     * стороны), дальше — по позднейшему из двух сроков.
     *
     * Пустые буквы выбрасывают свою сторону из счёта: срок без букв ничего не
     * значит (см. extend_term).
     */
    $rows = q_all(
        "SELECT * FROM zm_privileges
          ORDER BY ((`access` <> ''       AND `expires_at`  IS NULL)
                 OR (`admin_access` <> '' AND `admin_until` IS NULL)) DESC,
                   GREATEST(
                     IF(`access` <> '',       COALESCE(`expires_at`,  '9999-12-31'), '1000-01-01'),
                     IF(`admin_access` <> '', COALESCE(`admin_until`, '9999-12-31'), '1000-01-01')
                   ) DESC,
                   `auth` ASC"
    );
    $now = db_now();
    $tiers = tiers();
    $out = array();

    foreach ($rows as $r) {
        $tier     = tier_of($r['access']);
        $hasTier  = $r['access'] !== '';
        $hasAdmin = $r['admin_access'] !== '';
        // expired и left — про УРОВЕНЬ; у админки свои четыре поля рядом.
        $expired      = $hasTier && $r['expires_at'] !== null && $r['expires_at'] <= $now;
        $adminExpired = $hasAdmin && $r['admin_until'] !== null && $r['admin_until'] <= $now;
        $left         = ($hasTier && $r['expires_at'] !== null) ? days_left($now, $r['expires_at']) : null;
        $adminLeft    = ($hasAdmin && $r['admin_until'] !== null) ? days_left($now, $r['admin_until']) : null;

        $out[] = array(
            'auth'         => $r['auth'],
            'password'     => $r['password'],
            'access'       => $r['access'],
            'account'      => $r['account'],
            'tier'         => $tier,
            'tierName'     => $tier >= 0 ? $tiers[$tier]['name'] : null,
            'admin'        => $hasAdmin,
            'full'         => $r['access'] === ALL_FLAGS,
            'nopass'       => strpos($r['account'], 'e') !== false,
            'steamid'      => strpos($r['account'], 'c') !== false,
            'expires'      => $hasTier ? $r['expires_at'] : null,
            'expired'      => $expired,
            'left'         => $left,
            'adminUntil'   => $hasAdmin ? $r['admin_until'] : null,
            'adminLeft'    => $adminLeft,
            'adminExpired' => $adminExpired,
            'adminForever' => $hasAdmin && $r['admin_until'] === null,
            'source'       => $r['source'],
            'note'         => $r['note'],
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

        /*
         * ⚠️ БЕЗ ОПЛАТЫ НЕ ВЫДАЁМ. ЭТА ПРОВЕРКА — ПОСЛЕДНЯЯ, А НЕ ЕДИНСТВЕННАЯ,
         * И СТОИТ ОНА ЗДЕСЬ НАРОЧНО.
         *
         * Раньше её здесь не было вовсе: apply_order() раздавала привилегии,
         * полагаясь на то, что звонящий сам убедился в оплате. Оба звонящих
         * действительно убеждались — pay.php сверяет подпись, адрес кассы и
         * сумму, а панель требует входа владельца, — то есть дыры не было. Но
         * охрана денег жила ВНЕ той функции, которая раздаёт товар: третий
         * вызов, забывчивая правка или новая касса — и привилегии пошли бы
         * бесплатно. Владелец собирается подключать Т-Банк, то есть править
         * ровно эту часть, и оставлять так нельзя.
         *
         * paid_at ставится ДО вызова: касса — в pay.php после сверки подписи и
         * суммы, владелец — в панели, подтверждая перевод руками. Здесь мы
         * лишь отказываемся выдавать то, за что никто не расписался.
         */
        if ($order['paid_at'] === null) {
            $pdo->rollBack();
            return array('error' => array('заказ не оплачен — выдавать нечего'));
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

        if ($order['kind'] === 'admin') {
            // Админка — отдельный товар со своим сроком. tier_index = null
            // здесь обязателен: без него слияние тронуло бы уровень, а покупка
            // админки не смеет ни повысить его, ни сдвинуть его срок.
            $res = grant_privilege(array(
                'who'          => $order['auth'],
                'is_steamid'   => (bool)$order['is_steamid'],
                'tier_index'   => null,
                'with_admin'   => true,
                'admin_days'   => (int)$order['days'],
                'source'       => 'order',
                'order_id'     => (int)$order['id'],
                'note'         => sprintf('заказ №%d', $order['id']),
                'defer_reload' => true,
            ));
        } else {
            $tier = tier_by_id($order['tier']);
            if ($tier === null) {
                $pdo->rollBack();
                return array('error' => array('в заказе неизвестный уровень: ' . $order['tier']));
            }

            // with_admin не передаём вовсе: в заказе на уровень админки больше
            // нет — у неё свой заказ, со своим сроком.
            //
            // ⚠️ Если на день перехода остался НЕприменённый старый заказ с
            // with_admin = 1, админку по нему придётся выдать руками: срок
            // админки в нём не записан, а угадывать за игрока нельзя. Такие
            // заказы видно в панели — она показывает этот столбец, когда он 1.
            $res = grant_privilege(array(
                'who'          => $order['auth'],
                'is_steamid'   => (bool)$order['is_steamid'],
                'tier_index'   => $tier['index'],
                'days'         => (int)$order['days'],
                'source'       => 'order',
                'order_id'     => (int)$order['id'],
                'note'         => sprintf('заказ №%d', $order['id']),
                'defer_reload' => true,
            ));
        }

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
