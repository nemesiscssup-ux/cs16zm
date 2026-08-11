<?php
/**
 * RCON для GoldSource (HLDS/ReHLDS) — по UDP, на тот же порт, куда заходят
 * игроки.
 *
 * Зачем он нам вообще. База — единственный источник правды о привилегиях, и
 * игровой сервер перечитывает её сам при запуске каждой карты. То есть выдача
 * доедет и БЕЗ rcon — просто со сменой карты, а это до получаса ожидания.
 * Одна команда `amx_reloadadmins` сокращает это до секунды. Поэтому rcon здесь
 * — УСКОРИТЕЛЬ, а не несущая конструкция: любая его ошибка не должна ронять
 * оплату. Отсюда и подпись функций — они возвращают исход, а не бросают.
 *
 * Порядок обмена:
 *   1. шлём  \xFF\xFF\xFF\xFF challenge rcon\n
 *   2. в ответ \xFF\xFF\xFF\xFF challenge rcon <число>
 *   3. шлём  \xFF\xFF\xFF\xFF rcon <число> "<пароль>" <команда>\n
 *   4. в ответ \xFF\xFF\xFF\xFF l <текст> \x00
 *
 * ⚠️ ПАРОЛЬ ИДЁТ ОТКРЫТЫМ ТЕКСТОМ. Шифрования у этого протокола нет вовсе.
 * Поэтому пароль rcon обязан быть отдельным и не совпадать ни с чем другим.
 *
 * ⚠️ ПРОМАХИ СЧИТАЮТСЯ. В ReHLDS есть sv_rcon_maxfailures и sv_rcon_banpenalty:
 * несколько запросов с неверным паролем — и адрес отправителя забанен на
 * несколько минут. Ошибка в пароле здесь тихо выключит выдачу до истечения
 * бана, поэтому при отказе мы НЕ повторяем запрос по кругу.
 */

/**
 * Выполнить команду. Возвращает массив:
 *   ok      — дошло ли
 *   out     — что ответил сервер
 *   error   — почему не дошло
 */
function rcon_exec($command)
{
    if (!cfg('rcon.enabled')) {
        return array('ok' => false, 'out' => '', 'error' => 'rcon выключен в настройках');
    }

    $host = (string)cfg('rcon.host');
    $port = (int)cfg('rcon.port', 27015);
    $pass = (string)cfg('rcon.password');
    $wait = (float)cfg('rcon.timeout', 3);

    if ($host === '' || $host === 'ЗАПОЛНИТЬ' || $pass === '' || $pass === 'ЗАПОЛНИТЬ') {
        return array('ok' => false, 'out' => '', 'error' => 'не заданы адрес или пароль rcon');
    }
    // Кавычка в пароле разорвала бы пакет по своему месту, и остаток пароля
    // движок принял бы за команду. Лучше отказаться, чем гадать.
    if (strpos($pass, '"') !== false || preg_match('/[\x00-\x1f]/', $pass)) {
        return array('ok' => false, 'out' => '', 'error' => 'в пароле rcon есть кавычка или служебный символ');
    }
    if (preg_match('/[\x00-\x1f]/', $command)) {
        return array('ok' => false, 'out' => '', 'error' => 'в команде есть служебный символ');
    }

    $errno = 0;
    $errstr = '';
    $sock = @stream_socket_client(
        sprintf('udp://%s:%d', $host, $port), $errno, $errstr, $wait, STREAM_CLIENT_CONNECT
    );
    if (!$sock) {
        return array('ok' => false, 'out' => '', 'error' => sprintf('не открыть сокет: %s', $errstr ?: $errno));
    }
    stream_set_timeout($sock, (int)$wait, (int)(($wait - (int)$wait) * 1000000));

    try {
        $challenge = rcon_challenge($sock);
        if ($challenge === null) {
            return array('ok' => false, 'out' => '', 'error' => 'сервер не ответил на запрос ключа — выключен или недоступен');
        }

        $packet = "\xFF\xFF\xFF\xFF" . sprintf('rcon %s "%s" %s', $challenge, $pass, $command) . "\n";
        if (@fwrite($sock, $packet) === false) {
            return array('ok' => false, 'out' => '', 'error' => 'не отправить команду');
        }

        $out = rcon_read($sock);
        if ($out === null) {
            return array('ok' => false, 'out' => '', 'error' => 'сервер принял команду, но не ответил');
        }

        // Движок отвечает текстом, а не кодом. Единственный надёжный признак
        // отказа — прямая жалоба на пароль.
        if (stripos($out, 'Bad rcon_password') !== false || stripos($out, 'Bad challenge') !== false) {
            return array('ok' => false, 'out' => $out, 'error' => 'сервер не принял пароль rcon');
        }
        if (stripos($out, 'Banned') !== false) {
            return array('ok' => false, 'out' => $out, 'error' => 'адрес сайта забанен на сервере за промахи по паролю');
        }

        return array('ok' => true, 'out' => $out, 'error' => '');
    } finally {
        @fclose($sock);
    }
}

/** Одноразовый ключ, без которого команду не примут. */
function rcon_challenge($sock)
{
    if (@fwrite($sock, "\xFF\xFF\xFF\xFFchallenge rcon\n") === false) {
        return null;
    }
    $answer = rcon_read($sock);
    if ($answer === null) {
        return null;
    }
    return preg_match('/challenge\s+rcon\s+(-?\d+)/i', $answer, $m) ? $m[1] : null;
}

/**
 * Прочитать ответ, склеив его из нескольких пакетов, если он длинный.
 *
 * Длинный ответ движок режет на части с заголовком \xFE\xFF\xFF\xFF: дальше
 * идёт номер запроса и байт, в старшей половине которого номер части, а в
 * младшей — их общее число. Порядок прихода не гарантирован, поэтому
 * складываем по номеру, а не по очереди.
 */
function rcon_read($sock)
{
    $parts = array();
    $total = 1;
    $plain = null;

    for ($i = 0; $i < 12; $i++) {
        $buf = @fread($sock, 4096);
        if ($buf === false || $buf === '') {
            break;
        }
        if (strlen($buf) < 5) {
            continue;
        }

        $head = substr($buf, 0, 4);

        if ($head === "\xFF\xFF\xFF\xFF") {
            // Первый байт после заголовка — тип ответа: «l» у rcon, «A» у
            // запроса ключа. Он нам не нужен, но и в текст его пускать нельзя.
            $plain = rtrim(substr($buf, 5), "\x00\n");
            break;
        }

        if ($head === "\xFE\xFF\xFF\xFF") {
            $meta  = ord($buf[8]);
            $index = $meta >> 4;
            $total = $meta & 0x0F;
            $chunk = substr($buf, 9);
            // Первая часть несёт ещё и заголовок одиночного пакета — снимаем.
            if ($index === 0 && substr($chunk, 0, 4) === "\xFF\xFF\xFF\xFF") {
                $chunk = substr($chunk, 5);
            }
            $parts[$index] = $chunk;
            if ($total > 0 && count($parts) >= $total) {
                break;
            }
            continue;
        }
    }

    if ($plain !== null) {
        return $plain;
    }
    if (!$parts) {
        return null;
    }
    ksort($parts);
    return rtrim(implode('', $parts), "\x00\n");
}

/**
 * Перечитать список админов на игровом сервере.
 *
 * Вызывается после каждой правки базы. Тихо возвращает исход: витрина и панель
 * не должны падать оттого, что игровой сервер сейчас перезагружается.
 */
function rcon_reload_admins()
{
    return rcon_exec('amx_reloadadmins');
}
