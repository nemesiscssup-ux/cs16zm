<?php
/**
 * Уровни привилегий, их флаги и цены.
 *
 * ⚠️ ЭТОТ ФАЙЛ — ТРЕТЬЯ КОПИЯ ОДНОЙ И ТОЙ ЖЕ ТАБЛИЦЫ. Первые две:
 *     custom/plugins/zp_vip.sma   (g_tiers — что уровень даёт в игре)
 *     tools/users-ini.mjs         (TIERS — что пишет локальная панель)
 * Разойдутся — игрок купит «+10 кредитов», а получит другое, и заметит это
 * он, а не мы. Порядок строк ЗНАЧИМ: флаги накопительные, каждый уровень
 * включает все предыдущие.
 *
 * Буквы взяты из amxconst.inc, а не по созвучию с именем константы:
 * ADMIN_LEVEL_H — это «t», а не «h». Ошибиться легко, видно не сразу — запись
 * в базе появится, а прав не будет.
 */

// Полный алфавит флагов AMXX: от «a» до «u», дальше букв нет.
const ALL_FLAGS = 'abcdefghijklmnopqrstu';

/*
 * Админка ПРОДАЁТСЯ, то есть попадает к людям, которых никто не проверял.
 * Набор урезан намеренно: кик, бан, слей, чат и админ-меню — и ничего, чем
 * можно увести сервер. Нет rcon (l), нет смены карты (f), нет правки кваров
 * (g), нет неприкосновенности (a): купивший админку не должен быть неуязвим
 * для других админов. Сроки и число банов дополнительно режет
 * custom/plugins/zp_admin_limits.sma.
 */
const ADMIN_FLAGS = 'bcdeiju';

/**
 * Уровни снизу вверх.
 *
 * sold=false — «Создатель»: он стоит НАД продаваемой лестницей, это главный
 * администратор. В витрине его нет, в панели выдать можно.
 *
 * skin — НАЗВАНИЕ облика, а не их количество: у каждого уровня ровно один
 * облик, он надевается сам. Название обязано совпадать с таблицей в
 * zp_skins.sma.
 */
function tiers()
{
    return array(
        array(
            'id' => 'vip', 'name' => 'VIP', 'letter' => 't',
            'packs' => 3, 'health' => 25, 'knives' => 7, 'skin' => 'Форма VIP',
            'sold' => true,
            'blurb' => 'Первый шаг: заметно легче переживать первые волны.',
            'prices' => array(30 => 79, 90 => 199, 0 => 399),
        ),
        array(
            'id' => 'leader', 'name' => 'Лидер', 'letter' => 's',
            'packs' => 6, 'health' => 50, 'knives' => 9, 'skin' => 'Форма 9',
            'sold' => true,
            'blurb' => 'Вдвое больше кредитов и здоровья, чем у VIP, и ещё два ножа.',
            'prices' => array(30 => 149, 90 => 379, 0 => 749),
        ),
        array(
            'id' => 'imperator', 'name' => 'Император', 'letter' => 'q',
            'packs' => 10, 'health' => 75, 'knives' => 10, 'skin' => 'Отпускник',
            'sold' => true,
            'blurb' => 'Десять кредитов за возрождение — хватает на серьёзное оружие сразу.',
            'prices' => array(30 => 249, 90 => 649, 0 => 1290),
        ),
        array(
            'id' => 'pharaoh', 'name' => 'Фараон', 'letter' => 'p',
            'packs' => 15, 'health' => 100, 'knives' => 11, 'skin' => 'Фараон',
            'sold' => true,
            'blurb' => 'Верхний покупаемый уровень: все ножи и сотня здоровья сверху.',
            'prices' => array(30 => 399, 90 => 999, 0 => 1990),
        ),
        array(
            'id' => 'creator', 'name' => 'Создатель', 'letter' => 'o',
            'packs' => 20, 'health' => 150, 'knives' => 11, 'skin' => 'Создатель',
            'sold' => false,
            'blurb' => 'Главный администратор. Не продаётся.',
            'prices' => array(),
        ),
    );
}

/** Доплата за админку — одинаковая на любом уровне. */
const ADMIN_PRICE = 149;

/** Сроки, которые показываем в витрине. Ключ 0 — «навсегда». */
function terms()
{
    return array(
        30 => array('label' => '30 дней',  'short' => 'мес'),
        90 => array('label' => '90 дней',  'short' => '3 мес'),
        0  => array('label' => 'навсегда', 'short' => '∞'),
    );
}

/** Уровень по идентификатору либо null. */
function tier_by_id($id)
{
    foreach (tiers() as $i => $t) {
        if ($t['id'] === $id) {
            $t['index'] = $i;
            return $t;
        }
    }
    return null;
}

/**
 * Буквы доступа для уровня: он сам и ВСЕ младшие.
 *
 * Накопительность не украшение: zp_knives и zp_skins в allowed() проверяют
 * ровно тот бит, что записан у ножа или скина. Дай Фараону одну букву «p» —
 * и ножи младших уровней окажутся ему закрыты.
 */
function tier_flags($index)
{
    $letters = array();
    foreach (tiers() as $i => $t) {
        if ($i <= $index) {
            $letters[] = $t['letter'];
        }
    }
    sort($letters);
    return implode('', $letters);
}

/** Наивысший уровень в строке флагов, иначе -1. Так же считает tier_of() в zp_vip.sma. */
function tier_of($flags)
{
    $best = -1;
    foreach (tiers() as $i => $t) {
        if (strpos($flags, $t['letter']) !== false) {
            $best = $i;
        }
    }
    return $best;
}

/** Итоговые буквы доступа: уровень плюс, если куплена, админка. */
function access_flags($tierIndex, $withAdmin)
{
    $set = array();
    if ($tierIndex !== null && $tierIndex >= 0) {
        foreach (str_split(tier_flags($tierIndex)) as $c) {
            $set[$c] = true;
        }
    }
    if ($withAdmin) {
        foreach (str_split(ADMIN_FLAGS) as $c) {
            $set[$c] = true;
        }
    }
    $out = array_keys($set);
    sort($out);
    return implode('', $out);
}

/**
 * Флаги записи AMXX.
 *
 * «c» — ключ является SteamID; «a» — выкинуть с сервера при неверном пароле;
 * «e» — пароль не проверяется вовсе. Ровно та же функция, что accountFlags()
 * в tools/users-ini.mjs, чтобы два входа не разъехались в правилах.
 */
function account_flags($isSteamId, $noPassword)
{
    return ($isSteamId ? 'c' : '') . ($noPassword ? 'e' : 'a');
}

/** Цена уровня за срок; null, если такой связки не продаём. */
function price_of($tierId, $days, $withAdmin)
{
    $t = tier_by_id($tierId);
    if ($t === null || !$t['sold'] || !isset($t['prices'][$days])) {
        return null;
    }
    return $t['prices'][$days] + ($withAdmin ? ADMIN_PRICE : 0);
}
