<?php
/**
 * Снимок карты GoldSrc без запуска игры.
 *
 * ⚠️ ЗАЧЕМ ЭТО ВООБЩЕ НАПИСАНО. Для фона сайта нужен вид карты, а не текстура
 * стены. Снимок из игры сделать неоткуда: на машине сборки нет ни клиента, ни
 * браузера. Зато есть сама карта — а в .bsp лежит всё нужное: геометрия,
 * текстуры прямо внутри файла и точка появления игрока. Камеру ставим ровно
 * туда, где он появляется, и смотрим его же глазами.
 *
 * Это НЕ движок. Здесь нет ни освещения (карты хранят его отдельной лампой,
 * и без неё всё выходит равномерно освещённым), ни прозрачных поверхностей,
 * ни видимости по PVS — рисуется всё подряд с проверкой по глубине. Для фона,
 * который лежит под текстом на четверти видимости, этого достаточно, а для
 * чего-то большего надо брать настоящий движок.
 *
 * Запуск:  php site/tools/bsp-shot.php <карта.bsp> <куда.png> [ширина] [высота] [поворот]
 */

if (!extension_loaded('gd')) {
    exit("нужен модуль gd\n");
}

$src  = isset($argv[1]) ? $argv[1] : '';
$dst  = isset($argv[2]) ? $argv[2] : '';
$W    = isset($argv[3]) ? (int)$argv[3] : 1200;
$H    = isset($argv[4]) ? (int)$argv[4] : 800;
$YAW   = isset($argv[5]) ? (float)$argv[5] : 0.0;
$PITCH = isset($argv[6]) ? (float)$argv[6] : 0.0;   // минус — смотреть вниз
$SPOT  = isset($argv[7]) ? (int)$argv[7] : 0;       // какая по счёту точка появления

if (!is_file($src) || $dst === '') {
    exit("нужны: <карта.bsp> <куда.png>\n");
}

// ── чтение лампы ────────────────────────────────────────────────────────────

$fh = fopen($src, 'rb');
if (unpack('V', fread($fh, 4))[1] !== 30) {
    exit("не BSP версии 30\n");
}
$lump = array();
for ($i = 0; $i < 15; $i++) {
    $lump[$i] = unpack('Voff/Vlen', fread($fh, 8));
}
function lump_data($fh, $l)
{
    if ($l['len'] <= 0) {
        return '';
    }
    fseek($fh, $l['off']);
    return fread($fh, $l['len']);
}

// ── вершины, рёбра, грани ───────────────────────────────────────────────────

$vraw = lump_data($fh, $lump[3]);
$verts = array();
for ($i = 0, $n = intdiv(strlen($vraw), 12); $i < $n; $i++) {
    $v = unpack('gx/gy/gz', substr($vraw, $i * 12, 12));
    $verts[] = array($v['x'], $v['y'], $v['z']);
}

$eraw = lump_data($fh, $lump[12]);
$edges = array();
for ($i = 0, $n = intdiv(strlen($eraw), 4); $i < $n; $i++) {
    $e = unpack('va/vb', substr($eraw, $i * 4, 4));
    $edges[] = array($e['a'], $e['b']);
}

$sraw = lump_data($fh, $lump[13]);
$surf = array_values(unpack('l' . intdiv(strlen($sraw), 4), $sraw));

$traw = lump_data($fh, $lump[6]);
$texinfo = array();
for ($i = 0, $n = intdiv(strlen($traw), 40); $i < $n; $i++) {
    $t = unpack('gsx/gsy/gsz/gsd/gtx/gty/gtz/gtd/lmip/lflags', substr($traw, $i * 40, 40));
    $texinfo[] = $t;
}

$fraw = lump_data($fh, $lump[7]);
$faces = array();
for ($i = 0, $n = intdiv(strlen($fraw), 20); $i < $n; $i++) {
    $f = unpack('vplane/vside/lfirst/vnum/vtex', substr($fraw, $i * 20, 16));
    $faces[] = $f;
}

// ── текстуры ────────────────────────────────────────────────────────────────
//
// Каждую разворачиваем в плоский массив цветов один раз: внутри цикла по
// точкам обращаться к файлу нельзя, снимок рисовался бы часами.

fseek($fh, $lump[2]['off']);
$ntex = unpack('V', fread($fh, 4))[1];
$tofs = $ntex > 0 ? array_values(unpack('V' . $ntex, fread($fh, 4 * $ntex))) : array();

$tex = array();
foreach ($tofs as $ti => $o) {
    $tex[$ti] = null;
    if ($o <= 0) {
        continue;
    }
    fseek($fh, $lump[2]['off'] + $o);
    $m = @unpack('a16name/Vw/Vh/Vo1/Vo2/Vo3/Vo4', fread($fh, 40));
    if (!$m || $m['o1'] <= 0 || $m['w'] < 1 || $m['h'] < 1) {
        continue;
    }
    $name = strtolower(substr($m['name'], 0, strcspn($m['name'], "\0")));
    $w = $m['w']; $h = $m['h'];

    fseek($fh, $lump[2]['off'] + $o + $m['o1']);
    $pix = fread($fh, $w * $h);
    fseek($fh, $lump[2]['off'] + $o + $m['o4'] + intdiv($w, 8) * intdiv($h, 8));
    $cnt = @unpack('v', fread($fh, 2));
    $pal = fread($fh, 256 * 3);
    if (strlen($pix) < $w * $h || strlen($pal) < 768) {
        continue;
    }
    $tex[$ti] = array('name' => $name, 'w' => $w, 'h' => $h, 'pix' => $pix, 'pal' => $pal);
}
fclose($fh);

// ── где стоит игрок ─────────────────────────────────────────────────────────
//
// Лампа сущностей — обычный текст. Берём info_player_start: это и есть точка,
// с которой человек видит карту в первый раз, и лучшего вида для снимка не
// придумать.

$ents = lump_data($fh = fopen($src, 'rb'), $lump[0]);
fclose($fh);

/*
 * Собираем ВСЕ точки появления, а не первую попавшуюся. В карте зомби-режима
 * их обычно десятки, разбросанных по всей карте, и вид с каждой свой: с одной
 * упираешься в стену стартовой комнаты, с другой открывается улица. Какая
 * годится — решает глаз, а перебор даёт ему из чего выбирать.
 */
$spots = array();
if (preg_match_all('~\{([^}]*)\}~s', $ents, $blocks)) {
    foreach ($blocks[1] as $b) {
        if (strpos($b, 'info_player_start') === false && strpos($b, 'info_player_deathmatch') === false) {
            continue;
        }
        if (preg_match('~"origin"\s+"([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"~', $b, $m)) {
            // +40 по высоте: origin у точки появления — это ноги, а смотрим
            // мы глазами.
            $spots[] = array((float)$m[1], (float)$m[2], (float)$m[3] + 40.0);
        }
    }
}
if (!$spots) {
    exit("в карте нет точек появления игрока — снимать неоткуда\n");
}

$eye = $spots[$SPOT % count($spots)];
$yaw = $YAW;

printf("точек появления: %d, взята %d; камера %.0f %.0f %.0f, поворот %.0f°, наклон %.0f°\n",
    count($spots), $SPOT % count($spots), $eye[0], $eye[1], $eye[2], $yaw, $PITCH);

// ── проекция ────────────────────────────────────────────────────────────────

$rad = deg2rad($yaw);
$prd   = deg2rad($PITCH);
$fwd   = array(cos($rad) * cos($prd), sin($rad) * cos($prd), sin($prd));
$right = array(sin($rad), -cos($rad), 0.0);
$up    = array(-cos($rad) * sin($prd), -sin($rad) * sin($prd), cos($prd));

$fov = deg2rad(100);
$focal = ($W / 2) / tan($fov / 2);

$img = imagecreatetruecolor($W, $H);
imagefilledrectangle($img, 0, 0, $W, $H, imagecolorallocate($img, 8, 9, 11));
$zbuf = array_fill(0, $W * $H, INF);

/** Точка мира → экран. Возвращает [x, y, глубина] либо null, если позади. */
function project($p, $eye, $fwd, $right, $up, $focal, $W, $H)
{
    $dx = $p[0] - $eye[0]; $dy = $p[1] - $eye[1]; $dz = $p[2] - $eye[2];
    $z = $dx * $fwd[0] + $dy * $fwd[1] + $dz * $fwd[2];
    if ($z < 4) {
        return null;
    }
    $x = $dx * $right[0] + $dy * $right[1] + $dz * $right[2];
    $y = $dx * $up[0] + $dy * $up[1] + $dz * $up[2];
    return array($W / 2 + $focal * $x / $z, $H / 2 - $focal * $y / $z, $z);
}

/**
 * Треугольник с текстурой и проверкой глубины.
 *
 * ⚠️ Делим на глубину. Простое линейное растягивание текстуры по экрану
 * («аффинное») на больших полах даёт волны и заломы — ровно та рябь, по
 * которой узнают игры девяностых. Здесь координаты делятся на z и умножаются
 * обратно на каждой точке.
 */
function tri($img, &$zbuf, $W, $H, $a, $b, $c, $t)
{
    $minx = max(0, (int)floor(min($a[0], $b[0], $c[0])));
    $maxx = min($W - 1, (int)ceil(max($a[0], $b[0], $c[0])));
    $miny = max(0, (int)floor(min($a[1], $b[1], $c[1])));
    $maxy = min($H - 1, (int)ceil(max($a[1], $b[1], $c[1])));
    if ($minx > $maxx || $miny > $maxy) {
        return;
    }
    $den = ($b[1] - $c[1]) * ($a[0] - $c[0]) + ($c[0] - $b[0]) * ($a[1] - $c[1]);
    if (abs($den) < 1e-9) {
        return;
    }

    $tw = $t['w']; $th = $t['h']; $pix = $t['pix']; $pal = $t['pal'];

    for ($y = $miny; $y <= $maxy; $y++) {
        for ($x = $minx; $x <= $maxx; $x++) {
            $px = $x + 0.5; $py = $y + 0.5;
            $w0 = (($b[1] - $c[1]) * ($px - $c[0]) + ($c[0] - $b[0]) * ($py - $c[1])) / $den;
            $w1 = (($c[1] - $a[1]) * ($px - $c[0]) + ($a[0] - $c[0]) * ($py - $c[1])) / $den;
            $w2 = 1 - $w0 - $w1;
            if ($w0 < 0 || $w1 < 0 || $w2 < 0) {
                continue;
            }

            $iz = $w0 / $a[2] + $w1 / $b[2] + $w2 / $c[2];
            if ($iz <= 0) {
                continue;
            }
            $z = 1 / $iz;
            $k = $y * $W + $x;
            if ($z >= $zbuf[$k]) {
                continue;
            }

            $u = ($w0 * $a[3] / $a[2] + $w1 * $b[3] / $b[2] + $w2 * $c[3] / $c[2]) * $z;
            $v = ($w0 * $a[4] / $a[2] + $w1 * $b[4] / $b[2] + $w2 * $c[4] / $c[2]) * $z;

            $tu = ((int)$u % $tw + $tw) % $tw;
            $tv = ((int)$v % $th + $th) % $th;
            $idx = ord($pix[$tv * $tw + $tu]);

            // Даль тонет в темноте: без этого дальняя стена такая же яркая,
            // как ближняя, и глубины на снимке не читается вовсе.
            $fog = max(0.15, min(1.0, 1.0 - $z / 2600));
            $r = (int)(ord($pal[$idx * 3]) * $fog);
            $g = (int)(ord($pal[$idx * 3 + 1]) * $fog);
            $bl = (int)(ord($pal[$idx * 3 + 2]) * $fog);

            $zbuf[$k] = $z;
            imagesetpixel($img, $x, $y, ($r << 16) | ($g << 8) | $bl);
        }
    }
}

// ── обход граней ────────────────────────────────────────────────────────────

$drawn = 0;
foreach ($faces as $f) {
    if ($f['num'] < 3 || !isset($texinfo[$f['tex']])) {
        continue;
    }
    $ti = $texinfo[$f['tex']];
    $t = isset($tex[$ti['mip']]) ? $tex[$ti['mip']] : null;
    if ($t === null) {
        continue;
    }
    // Небо рисовать нечем: его текстура лежит в отдельных файлах, не в карте.
    if (strpos($t['name'], 'sky') === 0) {
        continue;
    }

    $poly = array();
    for ($i = 0; $i < $f['num']; $i++) {
        $se = $surf[$f['first'] + $i];
        $vi = $se >= 0 ? $edges[$se][0] : $edges[-$se][1];
        $p = $verts[$vi];
        $pr = project($p, $eye, $fwd, $right, $up, $focal, $W, $H);
        if ($pr === null) {
            $poly = array();
            break;                       // грань пересекает камеру — пропускаем
        }
        $u = $p[0] * $ti['sx'] + $p[1] * $ti['sy'] + $p[2] * $ti['sz'] + $ti['sd'];
        $v = $p[0] * $ti['tx'] + $p[1] * $ti['ty'] + $p[2] * $ti['tz'] + $ti['td'];
        $poly[] = array($pr[0], $pr[1], $pr[2], $u, $v);
    }
    if (count($poly) < 3) {
        continue;
    }
    for ($i = 1; $i < count($poly) - 1; $i++) {
        tri($img, $zbuf, $W, $H, $poly[0], $poly[$i], $poly[$i + 1], $t);
    }
    $drawn++;
}

imagepng($img, $dst, 6);

/*
 * Разброс глубины — мера того, есть ли на снимке даль. Стена в упор даёт почти
 * ноль: все точки на одном расстоянии. Улица с видом до горизонта даёт тысячи.
 * По этому числу и отбираются виды, когда карт и точек десятки, а смотреть
 * глазами надо на единицы.
 */
$seen = array();
foreach ($zbuf as $z) {
    if ($z < INF) {
        $seen[] = $z;
    }
}
$spread = 0;
if (count($seen) > 8) {
    $mean = array_sum($seen) / count($seen);
    $s2 = 0.0;
    foreach ($seen as $z) {
        $s2 += ($z - $mean) * ($z - $mean);
    }
    $spread = (int)sqrt($s2 / count($seen));
}
printf("граней %d из %d, глубина %d, заполнено %d%% → %s\n",
    $drawn, count($faces), $spread, (int)round(count($seen) / ($W * $H) * 100), $dst);
