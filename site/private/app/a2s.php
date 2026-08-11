<?php
/**
 * Опрос игрового сервера: живой ли он и сколько там народу.
 *
 * Это тот же протокол, которым пользуется список серверов в самой игре, —
 * A2S по UDP на игровой порт. Пароль не нужен: сведения открытые.
 *
 * ⚠️ ОТВЕТ КЭШИРУЕТСЯ. Без кэша каждый посетитель главной слал бы серверу
 * пакет, а сервер отвечал бы вместо того, чтобы считать игру. Тридцати секунд
 * достаточно: число игроков за это время не меняется настолько, чтобы врать.
 *
 * ⚠️ ОТКАЗ — НЕ ОШИБКА. Сервер перезапускается, хостинг моргает, пакет
 * теряется: это UDP. Страница обязана показать «не отвечает» и жить дальше, а
 * не падать пятисоткой из-за того, что игровой сервер сейчас занят.
 */

/** Сведения о сервере либо null. */
function a2s_info()
{
    $host = (string)cfg('rcon.host');
    $port = (int)cfg('rcon.port', 27015);
    if ($host === '' || $host === 'ЗАПОЛНИТЬ') {
        return null;
    }

    $cacheFile = ZM_PRIVATE . '/logs/a2s.json';
    if (is_file($cacheFile) && time() - filemtime($cacheFile) < 30) {
        $cached = json_decode((string)file_get_contents($cacheFile), true);
        if (is_array($cached)) {
            return $cached;
        }
    }

    $info = a2s_query($host, $port);

    // Пишем даже неудачу: иначе при лежащем сервере каждый посетитель будет
    // ждать таймаут по секунде, и главная страница станет медленной для всех.
    @file_put_contents($cacheFile, json_encode($info, JSON_UNESCAPED_UNICODE));
    return $info;
}

function a2s_query($host, $port)
{
    $errno = 0;
    $errstr = '';
    $sock = @stream_socket_client(sprintf('udp://%s:%d', $host, $port), $errno, $errstr, 2);
    if (!$sock) {
        return array('online' => false, 'error' => 'сокет не открыть');
    }
    stream_set_timeout($sock, 2);

    try {
        $request = "\xFF\xFF\xFF\xFFTSource Engine Query\0";
        if (@fwrite($sock, $request) === false) {
            return array('online' => false, 'error' => 'не отправить запрос');
        }

        $answer = @fread($sock, 4096);
        if ($answer === false || strlen($answer) < 5) {
            return array('online' => false, 'error' => 'нет ответа');
        }

        // На запрос могут ответить требованием подтвердить: «A» и четыре байта
        // ключа. Тогда повторяем запрос с ключом — так делает и сама игра.
        if ($answer[4] === 'A' && strlen($answer) >= 9) {
            @fwrite($sock, $request . substr($answer, 5, 4));
            $answer = @fread($sock, 4096);
            if ($answer === false || strlen($answer) < 5) {
                return array('online' => false, 'error' => 'нет ответа на повтор');
            }
        }

        $type = $answer[4];
        $p = 5;
        $str = function () use ($answer, &$p) {
            $end = strpos($answer, "\0", $p);
            if ($end === false) {
                $end = strlen($answer);
            }
            $s = substr($answer, $p, $end - $p);
            $p = $end + 1;
            return $s;
        };

        if ($type === 'I') {           // современный ответ (Source и ReHLDS)
            $p++;                      // версия протокола
            $name = $str();
            $map = $str();
            $str();                    // каталог мода
            $str();                    // название игры
            $p += 2;                   // идентификатор игры
            $players = ord($answer[$p]);
            $max = ord($answer[$p + 1]);
        } elseif ($type === 'm') {     // старый ответ GoldSource
            $str();                    // адрес
            $name = $str();
            $map = $str();
            $str();
            $str();
            $players = ord($answer[$p]);
            $max = ord($answer[$p + 1]);
        } else {
            return array('online' => false, 'error' => 'ответ не разобрать');
        }

        return array(
            'online'  => true,
            'name'    => mb_convert_encoding($name, 'UTF-8', 'UTF-8'),
            'map'     => $map,
            'players' => $players,
            'max'     => $max,
            'error'   => '',
        );
    } finally {
        @fclose($sock);
    }
}
