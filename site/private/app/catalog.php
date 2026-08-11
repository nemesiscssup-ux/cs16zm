<?php
/**
 * Что показывать на витрине: ножи, облики, оружие.
 *
 * ⚠️ ЭТО ОПИСЬ ТОГО, ЧТО УЖЕ ЕСТЬ В ИГРЕ, а не источник правды. Названия,
 * описания и уровни взяты один в один из
 *     custom/plugins/zp_knives.sma  (g_knives)
 *     custom/plugins/zp_skins.sma   (g_skins)
 *     custom/plugins/zp_shop_weapons.sma (g_weapons)
 * Разойдётся — игрок увидит на сайте нож, которого в меню нет, и напишет, что
 * его обманули. Правя таблицы в плагинах, правьте и здесь.
 *
 * Поле `model` — идентификатор из site/tools/build-models.mjs. Пустое означает
 * «трёхмерной модели нет», и страница просто не покажет окошко: пустое место
 * лучше, чем крутящееся ничто.
 *
 * `tier` — с какого уровня открыт. null означает «доступен всем».
 */

/**
 * Ножи. Порядок тот же, что в g_knives: он же порядок в игровом меню.
 */
function catalog_knives()
{
    return array(
        array('name' => 'Боевой нож',    'desc' => 'быстрее всех, урон обычный',              'tier' => null,        'model' => 'knife-combat'),
        array('name' => 'Крюк',          'desc' => 'средний, урон +30%',                      'tier' => null,        'model' => 'knife-hook'),
        array('name' => 'Колун',         'desc' => 'медленный, урон ×3, изредка поджигает',   'tier' => null,        'model' => 'knife-axe'),
        array('name' => 'Ножик',         'desc' => 'средний, урон ×3, пьёт здоровье',         'tier' => null,        'model' => 'knife-blade'),
        array('name' => 'Бензопила',     'desc' => 'медленная, урон ×5, поджигает',           'tier' => null,        'model' => 'knife-saw'),
        array('name' => 'Молоток',       'desc' => 'урон ×4, отбрасывает зомби',              'tier' => null,        'model' => 'knife-mallet'),
        array('name' => 'Лазерный меч',  'desc' => 'очень быстрый, урон ×5, поджигает',       'tier' => null,        'model' => 'knife-laser'),

        array('name' => 'Коготь',        'desc' => 'обычная скорость, урон ×2, слепит',       'tier' => 'vip',       'model' => 'knife-claw'),
        array('name' => 'Катана',        'desc' => 'быстрый, урон +30%, лечит за удар',       'tier' => 'vip',       'model' => 'knife-katana'),

        array('name' => 'Бур',           'desc' => 'быстрый, урон ×6, сбивает с ног',         'tier' => 'leader',    'model' => 'knife-drill'),
        array('name' => 'Кувалда',       'desc' => 'очень быстрый, урон ×6, сносит с ног',    'tier' => 'leader',    'model' => 'knife-sledge'),

        array('name' => 'Молот',         'desc' => 'медленный, урон +60%, изредка отталкивает', 'tier' => 'imperator', 'model' => 'knife-hammer'),
        array('name' => 'Ледяной посох', 'desc' => 'очень быстрый, урон ×2, замораживает',    'tier' => 'imperator', 'model' => 'knife-ice'),

        array('name' => 'Коса фараона',  'desc' => 'очень быстрый, урон ×7, пьёт здоровье',   'tier' => 'pharaoh',   'model' => 'knife-scythe'),
        array('name' => 'Молот фараона', 'desc' => 'очень быстрый, урон ×8, замораживает',    'tier' => 'pharaoh',   'model' => 'knife-pharaoh'),
    );
}

/**
 * Классы зомби, которые открывает уровень.
 *
 * ⚠️ Числа — из самих плагинов (custom/plugins/*.sma, константы zclass_health,
 * zclass_speed, zclass_gravity, zclass_knockback), а не на глаз. Разойдутся —
 * игрок купит уровень ради «3600 здоровья» и получит другое.
 *
 * Общедоступные классы (Электрик, Студентка, Спринтер, Шаман) сюда не входят:
 * страница отвечает на вопрос «что даёт уровень», а они есть у всех и так.
 * ⚠️ Спринтер и Шаман были за VIP и Лидера до 12 августа 2026 — владелец решил
 * оставить за деньгами РОВНО ОДИН класс на уровень, и их открыл всем.
 *
 * ⚠️ УРОВЕНЬ ЗДЕСЬ ОБЯЗАН СОВПАДАТЬ С g_foreign_flag В zp_zclass_vip.sma — там
 * охрана, здесь витрина. Разойдутся — игрок купит уровень ради класса, а класс
 * ему в игре вернут обратно на обычного. Раскладку задал владелец, и она НЕ
 * растёт по здоровью ровно: уровни накопительные, поэтому «свой» класс уровня
 * может оказаться слабее того, что уже открыт младшим.
 *
 * `key` — буква способности в игре, `desc` — что она делает.
 */
function catalog_classes()
{
    return array(
        array(
            'name' => 'Ганимед', 'tier' => 'vip', 'model' => 'zclass-ganymede',
            'key' => 'G', 'ability' => 'Разгон', 'desc' => 'резко набирает скорость',
            'health' => 3000, 'speed' => 245, 'gravity' => 0.79, 'knockback' => 0.49,
        ),
        array(
            'name' => 'Ревенант Огонь', 'tier' => 'leader', 'model' => 'zclass-revfire',
            'key' => 'G', 'ability' => 'Огненный шар', 'desc' => 'поджигает всех, кого задел',
            'health' => 3600, 'speed' => 270, 'gravity' => 0.80, 'knockback' => 0.10,
        ),
        array(
            'name' => 'Ревенант Лёд', 'tier' => 'imperator', 'model' => 'zclass-revice',
            'key' => 'G', 'ability' => 'Паралич', 'desc' => 'замораживает на месте',
            'health' => 3400, 'speed' => 245, 'gravity' => 0.69, 'knockback' => 1.00,
        ),
        array(
            'name' => 'Ревенант Яд', 'tier' => 'pharaoh', 'model' => 'zclass-revpoison',
            'key' => 'G', 'ability' => 'Ядовитый шар', 'desc' => 'отравляет всех, кого задел',
            'health' => 4000, 'speed' => 270, 'gravity' => 0.80, 'knockback' => 0.10,
        ),
    );
}

/** Подарочный облик уровня: ровно один на уровень, надевается сам. */
function catalog_tier_skin($tierId)
{
    $map = array(
        'vip'       => array('name' => 'Форма VIP', 'desc' => 'зелёная форма, номер 9',  'model' => 'skin-vip'),
        'leader'    => array('name' => 'Форма 9',   'desc' => 'красная форма, номер 9',  'model' => 'skin-leader'),
        'imperator' => array('name' => 'Отпускник', 'desc' => 'гавайка и шлёпанцы',      'model' => 'skin-imperator'),
        'pharaoh'   => array('name' => 'Фараон',    'desc' => 'золотой череп в немесе',  'model' => 'skin-pharaoh'),
        'creator'   => array('name' => 'Создатель', 'desc' => 'тот самый, из аниме',     'model' => 'skin-creator'),
    );
    return isset($map[$tierId]) ? $map[$tierId] : null;
}

/**
 * Облики за игровые кредиты. Уровня не требуют, покупаются один раз навсегда —
 * прямо в игре, в меню. На сайте они показаны затем, чтобы было видно, на что
 * кредиты вообще тратятся.
 */
function catalog_shop_skins()
{
    return array(
        array('name' => 'Летний',        'desc' => 'красный шарф, рубашка',        'packs' => 50),
        array('name' => 'Герой',         'desc' => 'плащ и маска',                 'packs' => 60),
        array('name' => 'Спортсменка',   'desc' => 'топ, гетры, хвостики',         'packs' => 60),
        array('name' => 'Зимняя',        'desc' => 'вязаное платье и косы',        'packs' => 60),
        array('name' => 'Спецназ',       'desc' => 'броня и шлем',                 'packs' => 70),
        array('name' => 'Агент',         'desc' => 'куртка и кобура',              'packs' => 70),
        array('name' => 'Доктор',        'desc' => 'костюм биозащиты',             'packs' => 80),
        array('name' => 'Дуэлянт',       'desc' => 'чёрный фрак и клинок',         'packs' => 80),
        array('name' => 'Звёздная',      'desc' => 'корсет и чулки в звёздах',     'packs' => 90),
        array('name' => 'Змейка',        'desc' => 'змеиная кожа и цепи',          'packs' => 90),
        array('name' => 'Монолит',       'desc' => 'экзоскелет и противогаз',      'packs' => 90),
        array('name' => 'Маска',         'desc' => 'без лица',                     'packs' => 100),
        array('name' => 'Мечник',        'desc' => 'чёрный плащ, меч за спиной',   'packs' => 100),
        array('name' => 'Ассасин',       'desc' => 'плащ с капюшоном',             'packs' => 110),
        array('name' => 'Паладин',       'desc' => 'бело-золотой доспех',          'packs' => 120),
        array('name' => 'Тёмный рыцарь', 'desc' => 'чёрно-синяя броня, коса',      'packs' => 120),
    );
}

/**
 * Оружие из игрового магазина. Цена — в кредитах за раунд, как в g_weapons.
 * Показываем не всё, а то, у чего есть модель: список из шестнадцати строк
 * без картинок ничего не объясняет, а три с моделью — объясняют.
 */
function catalog_weapons()
{
    return array(
        array('name' => 'AK-47 Long', 'desc' => 'автомат, урон +30%',                  'packs' => 18, 'model' => 'gun-ak47long'),
        array('name' => 'ВСК-94',     'desc' => 'снайперская, урон +25%, скорость +15%', 'packs' => 22, 'model' => 'gun-vsk94'),
        array('name' => 'Devil Baby', 'desc' => 'пистолет ближнего боя',                'packs' => 14, 'model' => 'gun-devilbaby'),
    );
}

/**
 * Наборы кредитов на продажу.
 *
 * Кредиты («паки») — игровая валюта: за них покупают оружие в раундовом
 * магазине и облики навсегда. Цены подобраны так, чтобы крупный набор был
 * заметно выгоднее мелкого, иначе покупать будут только самый дешёвый.
 */
function catalog_packs()
{
    return array(
        array('id' => 'p100',  'packs' => 100,  'price' => 59,  'bonus' => 0),
        array('id' => 'p300',  'packs' => 300,  'price' => 149, 'bonus' => 30),
        array('id' => 'p700',  'packs' => 700,  'price' => 299, 'bonus' => 100),
        array('id' => 'p1500', 'packs' => 1500, 'price' => 549, 'bonus' => 300),
    );
}

/** Набор кредитов по идентификатору либо null. */
function pack_by_id($id)
{
    foreach (catalog_packs() as $p) {
        if ($p['id'] === $id) {
            return $p;
        }
    }
    return null;
}
