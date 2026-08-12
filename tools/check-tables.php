<?php
/**
 * Сторож таблиц, которые связаны номерами и переписаны в нескольких местах.
 *
 * ⚠️ ОБЕ ПРОВЕРКИ НАПИСАНЫ ПО СЛЕДАМ НАСТОЯЩИХ ПОЛОМОК, а не на всякий случай.
 *
 *   1. МЕНЮ МАГАЗИНА. g_cat_items в zp_shop_weapons.sma держит НОМЕРА строк
 *      таблицы g_weapons. Balrog-1 вписали вторым пистолетом — и всё, что ниже,
 *      съехало на единицу: пистолет оказался в «Дробовиках», дробовик в
 *      «Автоматах», а AS50, Арбалет и Гранатомёт M32 не показывались вовсе.
 *      Три ствола, добавленные специально, были в игре недоступны, и увидеть
 *      это можно было только зайдя в магазин.
 *
 *   2. ЧИСЛО НОЖЕЙ У УРОВНЯ. Оно живёт в ЧЕТЫРЁХ местах: g_tiers в zp_vip.sma,
 *      site/private/app/tiers.php, tools/users-ini.mjs — и считается по
 *      g_knives в zp_knives.sma. Ножей стало пятнадцать вместо одиннадцати,
 *      число обновили не везде, и покупатель читал «ножей 15 из 11».
 *
 * ⚠️ ПОЧЕМУ PHP, А НЕ NODE, КАК ОСТАЛЬНЫЕ tools. На машине, где это писалось,
 * Node не было, а проверка нужна была сегодня. Переписать на Node — работа на
 * полчаса, и её стоит сделать, когда до неё дойдут руки.
 *
 * Запуск:  php tools/check-tables.php
 * Возвращает 1, если что-то разошлось, — годится для проверки перед сборкой.
 */

$ROOT = dirname(__DIR__);
$bad = 0;

/** Строки таблицы без комментариев: числа из «// AS50» иначе примешаются. */
function table_rows($text)
{
    $out = array();
    foreach (explode("\n", $text) as $line) {
        $line = trim(preg_replace('~//.*$~', '', $line));
        if ($line !== '' && $line[0] === '{') {
            $out[] = $line;
        }
    }
    return $out;
}

// ── 1. все ли стволы попадают в меню ────────────────────────────────────────

$shop = @file_get_contents($ROOT . '/custom/plugins/zp_shop_weapons.sma');
if ($shop === false) {
    echo "не читается zp_shop_weapons.sma\n";
    $bad++;
} else {
    preg_match('~new const g_weapons\[\]\[WPN\] = \{(.*?)\n\}~s', $shop, $m);
    preg_match_all('~\{\s*"(\[[^\]]+\][^"]*)"~', isset($m[1]) ? $m[1] : '', $w);
    $guns = $w[1];

    preg_match('~new const g_cat_items\[\]\[\] = \{(.*?)\n\}~s', $shop, $m2);
    preg_match('~new const g_cat_names\[\]\[\] = \{(.*?)\}~s', $shop, $m3);
    preg_match_all('~"([^"]+)"~', isset($m3[1]) ? $m3[1] : '', $cn);

    $rows = table_rows(isset($m2[1]) ? $m2[1] : '');
    printf("Магазин: стволов %d, разделов %d, строк таблицы %d\n",
        count($guns), count($cn[1]), count($rows));

    if (count($rows) !== count($cn[1])) {
        printf("  ‼ разделов %d, а строк с номерами %d — меню покажет не то\n",
            count($cn[1]), count($rows));
        $bad++;
    }

    $seen = array();
    foreach ($rows as $r) {
        preg_match_all('~-?\d+~', $r, $nums);
        foreach ($nums[0] as $x) {
            $x = (int)$x;
            if ($x < 0) {
                continue;
            }
            if (!isset($guns[$x])) {
                printf("  ‼ в разделе стоит номер %d, а столько стволов нет\n", $x);
                $bad++;
            }
            if (isset($seen[$x])) {
                printf("  ‼ ствол #%d (%s) попал в меню дважды\n", $x, $guns[$x]);
                $bad++;
            }
            $seen[$x] = true;
        }
    }
    foreach ($guns as $i => $nm) {
        if (!isset($seen[$i])) {
            printf("  ‼ ствол #%d «%s» НЕ ПОПАЛ НИ В ОДИН РАЗДЕЛ — в игре его не купить\n", $i, $nm);
            $bad++;
        }
    }

    // Нативы привязаны к тому же порядку: их число обязано совпадать.
    preg_match('~new const g_natives\[\]\[\] = \{(.*?)\n\}~s', $shop, $mn);
    preg_match_all('~"([^"]+)"~', isset($mn[1]) ? $mn[1] : '', $nv);
    if (count($nv[1]) !== count($guns)) {
        printf("  ‼ стволов %d, а нативов %d — покупка попадёт не в тот плагин\n",
            count($guns), count($nv[1]));
        $bad++;
    }
}

// ── 2. сходится ли число ножей во всех копиях ───────────────────────────────

$knivesFile = @file_get_contents($ROOT . '/custom/plugins/zp_knives.sma');
$expected = null;
if ($knivesFile !== false) {
    preg_match('~new const g_knives\[\]\[KNIFE\] = \{(.*?)\n\}~s', $knivesFile, $mk);
    // Уровень — третье число после двух скоростей: «270, 100, 0,» либо «…, VIP,».
    preg_match_all('~,\s*\d+,\s*\d+,\s*(0|VIP|LEADER|IMPERATOR|PHARAOH)\s*,~',
        isset($mk[1]) ? $mk[1] : '', $lv);
    $order = array('0', 'VIP', 'LEADER', 'IMPERATOR', 'PHARAOH');
    $count = array_fill(0, 5, 0);
    foreach ($lv[1] as $t) {
        $i = array_search($t, $order, true);
        if ($i !== false) {
            $count[$i]++;
        }
    }
    // Накопительно: у уровня открыто своё и всё, что ниже.
    $expected = array();
    $sum = $count[0];
    for ($i = 1; $i <= 4; $i++) {
        $sum += $count[$i];
        $expected[] = $sum;
    }
    $expected[] = $sum;   // Создатель — столько же, сколько у Фараона
    printf("\nНожи: всего %d (доступно всем %d), по уровням %s\n",
        array_sum($count), $count[0], implode('/', $expected));
}

$copies = array(
    'custom/plugins/zp_vip.sma'        => '~ADMIN_LEVEL_[A-Z],\s*\d+,\s*\d+,\s*(\d+),~',
    'site/private/app/tiers.php'       => '~\'knives\' => (\d+)~',
    'tools/users-ini.mjs'              => '~knives: (\d+)~',
);
foreach ($copies as $rel => $re) {
    $text = @file_get_contents($ROOT . '/' . $rel);
    if ($text === false) {
        printf("  ‼ не читается %s\n", $rel);
        $bad++;
        continue;
    }
    preg_match_all($re, $text, $m);
    $got = array_map('intval', $m[1]);
    $ok = ($expected === null) ? null : ($got === $expected);
    printf("  %-30s %s%s\n", $rel, implode('/', $got),
        $ok === null ? '' : ($ok ? '  ✓' : '  ‼ РАСХОДИТСЯ с подсчётом по g_knives'));
    if ($ok === false) {
        $bad++;
    }
}

printf("\nитог: расхождений %d\n", $bad);
exit($bad === 0 ? 0 : 1);
