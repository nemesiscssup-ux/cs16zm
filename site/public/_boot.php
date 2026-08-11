<?php
/**
 * Единственный мостик из корня сайта к коду, лежащему ВЫШЕ корня.
 *
 * Ищем каталог private, поднимаясь вверх, а не считаем dirname() нужное число
 * раз: посчитанный путь молча врёт, стоит переложить страницу на уровень
 * глубже, и ломается не в момент правки, а когда-нибудь потом.
 */

$dir = __DIR__;
$found = null;
for ($i = 0; $i < 6; $i++) {
    $try = $dir . '/private/app/bootstrap.php';
    if (is_file($try)) {
        $found = $try;
        break;
    }
    $up = dirname($dir);
    if ($up === $dir) {
        break;
    }
    $dir = $up;
}

if ($found === null) {
    header('HTTP/1.1 503 Service Unavailable');
    header('Content-Type: text/plain; charset=utf-8');
    exit("Сайт ещё не настроен.\n");
}

require $found;
