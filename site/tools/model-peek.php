<?php
/**
 * Из отрисовки «руки в стороны» делаем «выглядывает из-за края».
 *
 * Запуск:  php site/tools/model-peek.php <модель.png> <куда.png> [доля_ширины] [доля_высоты] [наклон]
 * Пример:  php site/tools/model-peek.php public/models/zclass-revpoison.png public/assets/zombie-peek.png 0.80 0.50 12
 *
 * Отрисовщик моделей рисует их в опорной позе: фигура анфас, руки разведены.
 * Стоящий истукан у края страницы читается наклейкой. Но если взять от него
 * только голову, плечо и одну руку и слегка наклонить — выйдет тот, кто
 * заглядывает из-за угла. Ничего рисовать заново не надо, надо кадрировать.
 *
 * Берём ЛЕВУЮ часть фигуры: зомби стоит у ПРАВОГО края экрана, значит к нам
 * повёрнут его левый бок, а правый ушёл за край.
 */

$src   = $argv[1];
$dst   = $argv[2];
$partW = isset($argv[3]) ? (float)$argv[3] : 0.60;   // доля ширины фигуры
$partH = isset($argv[4]) ? (float)$argv[4] : 0.72;   // доля высоты фигуры
$angle = isset($argv[5]) ? (float)$argv[5] : 10.0;   // наклон в градусах

$im = imagecreatefrompng($src);
imagealphablending($im, false);
imagesavealpha($im, true);
$w = imagesx($im);
$h = imagesy($im);

// Где на холсте сама фигура: всё прочее прозрачно.
$minx = $w; $miny = $h; $maxx = -1; $maxy = -1;
for ($y = 0; $y < $h; $y++) {
    for ($x = 0; $x < $w; $x++) {
        if (((imagecolorat($im, $x, $y) >> 24) & 0x7F) < 100) {
            if ($x < $minx) { $minx = $x; }
            if ($x > $maxx) { $maxx = $x; }
            if ($y < $miny) { $miny = $y; }
            if ($y > $maxy) { $maxy = $y; }
        }
    }
}
if ($maxx < 0) {
    exit("фигуры не видно\n");
}
$fw = $maxx - $minx + 1;
$fh = $maxy - $miny + 1;

$cw = (int)round($fw * $partW);
$ch = (int)round($fh * $partH);

$cut = imagecreatetruecolor($cw, $ch);
imagealphablending($cut, false);
imagesavealpha($cut, true);
imagefilledrectangle($cut, 0, 0, $cw, $ch, imagecolorallocatealpha($cut, 0, 0, 0, 127));
imagecopy($cut, $im, 0, 0, $minx, $miny, $cw, $ch);

/*
 * ⚠️ imagerotate заливает углы, и по умолчанию — чёрным. Прозрачный цвет надо
 * передать явно и не забыть alphablending=false, иначе вокруг наклонённой
 * фигуры появится чёрный ромб, который на тёмной странице заметишь не сразу,
 * а на светлой карточке — сразу.
 */
$clear = imagecolorallocatealpha($cut, 0, 0, 0, 127);
$out = imagerotate($cut, $angle, $clear);
imagealphablending($out, false);
imagesavealpha($out, true);

imagepng($out, $dst, 9);
printf("фигура %dx%d → взято %dx%d, наклон %.0f° → %s (%d КБ)\n",
    $fw, $fh, $cw, $ch, $angle, basename($dst), (int)(filesize($dst) / 1024));

/*
 * Поворот оставляет вокруг фигуры прозрачные поля, и их надо срезать: иначе
 * отступ в CSS отсчитывается не от края фигуры, а от края пустоты, и «на
 * сколько он уходит за край экрана» перестаёт значить то, что написано.
 */
$ow = imagesx($out); $oh = imagesy($out);
$tx1 = $ow; $ty1 = $oh; $tx2 = -1; $ty2 = -1;
for ($y = 0; $y < $oh; $y++) {
    for ($x = 0; $x < $ow; $x++) {
        if (((imagecolorat($out, $x, $y) >> 24) & 0x7F) < 100) {
            if ($x < $tx1) { $tx1 = $x; }
            if ($x > $tx2) { $tx2 = $x; }
            if ($y < $ty1) { $ty1 = $y; }
            if ($y > $ty2) { $ty2 = $y; }
        }
    }
}
if ($tx2 > 0) {
    $tw = $tx2 - $tx1 + 1; $th = $ty2 - $ty1 + 1;
    $trim = imagecreatetruecolor($tw, $th);
    imagealphablending($trim, false);
    imagesavealpha($trim, true);
    imagefilledrectangle($trim, 0, 0, $tw, $th, imagecolorallocatealpha($trim, 0, 0, 0, 127));
    imagecopy($trim, $out, 0, 0, $tx1, $ty1, $tw, $th);
    imagepng($trim, $dst, 9);
    printf("подрезано до %dx%d (%d КБ)\n", $tw, $th, (int)(filesize($dst) / 1024));
}
