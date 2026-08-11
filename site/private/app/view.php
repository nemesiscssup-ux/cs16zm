<?php
/**
 * Общая обвязка страниц: шапка, меню, подвал.
 *
 * Лежит в закрытой части, а не в корне сайта, по той же причине, что и всё
 * остальное: кусок страницы, открытый сам по себе, — это половина разметки без
 * настроек и с неожиданными ошибками наружу.
 */

/** Разделы меню: адрес, подпись, признак «этот раздел сейчас открыт». */
function nav_items()
{
    return array(
        'index'      => array('href' => 'index.php',      'label' => 'Сервер'),
        'privileges' => array('href' => 'privileges.php', 'label' => 'Привилегии'),
        'shop'       => array('href' => 'shop.php',       'label' => 'Кредиты'),
    );
}

function page_head($title, $active = '', $extra = '')
{
    $site = cfg('site');
    header('Content-Type: text/html; charset=utf-8');
    ?><!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h($title) ?> — <?= h($site['title']) ?></title>
<link rel="stylesheet" href="assets/site.css?v=<?= h(ZM_ASSET_V) ?>">
<?= $extra ?>
</head>
<body>
<div class="wrap">

<header class="top">
  <a class="brand" href="index.php">
    <span class="eyebrow"><?= h($site['tagline']) ?></span>
    <span class="brand-name"><?= h($site['title']) ?></span>
  </a>
  <nav class="nav">
    <?php foreach (nav_items() as $key => $item): ?>
      <a href="<?= h($item['href']) ?>"<?= $key === $active ? ' class="on"' : '' ?>><?= h($item['label']) ?></a>
    <?php endforeach; ?>
  </nav>
</header>
<?php
}

function page_foot()
{
    $site = cfg('site');
    $links = array();
    if (!empty($site['contact']['vk'])) {
        $links[] = '<a href="' . h($site['contact']['vk']) . '">ВКонтакте</a>';
    }
    if (!empty($site['contact']['telegram'])) {
        $links[] = '<a href="' . h($site['contact']['telegram']) . '">Telegram</a>';
    }
    ?>
<p class="foot">
  <?= $links ? 'Связь: ' . implode(' · ', $links) . '<br>' : '' ?>
  Привилегия появляется на сервере в течение минуты после оплаты. Если игрок в это время
  на сервере, права подхватятся со сменой карты.
</p>

</div>
</body>
</html>
<?php
}

/**
 * Окошко модели на карточке.
 *
 * Показывает ЗАРАНЕЕ НАРИСОВАННУЮ картинку, а живой трёхмерный просмотр
 * открывается по щелчку — один на всю страницу.
 *
 * ⚠️ ТАК СДЕЛАНО НЕ ОТ ЛЕНИ. Раньше каждая карточка держала своё окно WebGL, а
 * браузер даёт их около шестнадцати: на странице привилегий их было за
 * двадцать, и у первых карточек контекст отбирался — вместо модели оставался
 * белый квадрат, стоило пролистать вниз и вернуться.
 *
 * Пустой идентификатор — не ошибка: у части вещей моделей нет, и тогда лучше
 * ничего, чем пустая рамка.
 *
 * $extra — что ещё можно посмотреть из этой же карточки: массив
 * [['id' => 'knife-claw', 'name' => 'Коготь', 'desc' => '...'], ...].
 */
function viewer($modelId, $class = '', $title = '', $desc = '', $extra = null)
{
    if (!$modelId) {
        return '';
    }

    $attrs = ' data-model="' . h($modelId) . '"';
    if ($title !== '') {
        $attrs .= ' data-title="' . h($title) . '"';
    }
    if ($desc !== '') {
        $attrs .= ' data-desc="' . h($desc) . '"';
    }
    if ($extra) {
        $attrs .= ' data-extra="' . h(json_encode(array_values($extra), JSON_UNESCAPED_UNICODE)) . '"';
    }

    return '<div class="viewer ' . h($class) . '" role="button" tabindex="0"'
        . ' aria-label="Посмотреть модель"' . $attrs . '>'
        . '<img src="models/' . h($modelId) . '.png?v=' . h(ZM_ASSET_V) . '" alt="" loading="lazy">'
        . '<span class="viewer-open">смотреть в 3D</span>'
        . '</div>';
}
