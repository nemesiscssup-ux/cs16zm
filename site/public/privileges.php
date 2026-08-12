<?php
/**
 * Привилегии: витрина уровней, подробности в окне и форма заказа.
 *
 * Страница отвечает на один вопрос — «что я получу за деньги», — и отвечает
 * дважды, на разной глубине. Витрина показывает только название, облик и цену:
 * пробежать глазами четыре уровня должно быть делом секунды. Всё остальное —
 * ножи, класс зомби, числа, цены по срокам — лежит в окне, которое открывается
 * щелчком по карточке.
 *
 * Выбирают же товар в одном месте — в меню Zombie Plague под витриной: тот же
 * нумерованный список, что и в игре, и цифры на клавиатуре в нём работают так
 * же. Раньше вместо него стояли две полоски кнопок; почему их не стало,
 * написано у самой разметки меню.
 *
 * ⚠️ ТАК СДЕЛАНО ПОТОМУ, ЧТО РАНЬШЕ БЫЛО НАОБОРОТ. Страница вываливала сразу
 * всё: четыре карточки с перечнями, потом восемь ножей с моделями, потом
 * четыре класса зомби с четырьмя числами каждый. Прочесть это целиком нельзя,
 * а выбрать по такому — тем более.
 *
 * Заказ страница не создаёт: его создаёт buy.php, и делает это по POST. Заказ,
 * который заводится переходом по ссылке, заведёт и поисковый робот.
 */

require __DIR__ . '/_boot.php';
require_once ZM_APP . '/view.php';

send_security_headers();

$tiers = array_values(array_filter(tiers(), function ($t) {
    return $t['sold'];
}));
$terms       = terms();
$adminTerms  = admin_terms();
$adminPrices = admin_prices();

/*
 * Цены отдаём на страницу разом: пересчёт при каждом щелчке должен быть
 * мгновенным, а ходить за ним на сервер — значит показывать пустое место.
 */
$priceTable = array();
foreach ($tiers as $t) {
    $priceTable[$t['id']] = $t['prices'];
}

/*
 * Ножи, которые ОТКРЫВАЕТ уровень. Доступные всем сюда не идут намеренно:
 * страница отвечает на вопрос «что я получу за деньги», и семь ножей, которые
 * и так есть у каждого, этот ответ только размывают.
 */
$byTier = array();
$classByTier = array();
foreach ($tiers as $t) {
    $byTier[$t['id']] = array();
    $classByTier[$t['id']] = array();
}
foreach (catalog_knives() as $k) {
    if ($k['tier'] !== null && isset($byTier[$k['tier']])) {
        $byTier[$k['tier']][] = $k;
    }
}
foreach (catalog_classes() as $c) {
    if (isset($classByTier[$c['tier']])) {
        $classByTier[$c['tier']][] = $c;
    }
}

/*
 * Что можно покрутить из карточки уровня. Список накопительный — ровно как
 * права: уровни включают все младшие, и игрок получает всё сразу.
 *
 * Первым в окне идёт облик САМОГО уровня (он приходит через data-model), а в
 * стопку складывается всё прочее: ножи и классы этого уровня и всех младших,
 * плюс облики младших.
 *
 * ⚠️ Облики младших уровней появились здесь только сейчас, и это не украшение:
 * zp_skins в allowed() проверяет бит флага, а флаги накопительные — значит
 * Фараон действительно может надеть форму VIP. Раньше об этом на сайте не
 * говорилось нигде, и покрутить их было негде.
 */
$lookAt = array();
$stack = array();
foreach ($tiers as $t) {
    foreach ($byTier[$t['id']] as $k) {
        if ($k['model']) {
            $stack[] = array('id' => $k['model'], 'name' => $k['name'], 'desc' => $k['desc']);
        }
    }
    foreach ($classByTier[$t['id']] as $c) {
        $stack[] = array(
            'id'   => $c['model'],
            'name' => 'Зомби: ' . $c['name'],
            'desc' => $c['ability'] . ' (' . $c['key'] . ') — ' . $c['desc'],
        );
    }

    // Снимок делаем ДО того, как в стопку ляжет собственный облик уровня:
    // он показывается первым и в стопке был бы вторым же изображением.
    $lookAt[$t['id']] = $stack;

    $skin = catalog_tier_skin($t['id']);
    if ($skin) {
        $stack[] = array(
            'id'   => $skin['model'],
            'name' => 'Облик «' . $skin['name'] . '»',
            'desc' => $skin['desc'],
        );
    }
}

/** Скорость класса в процентах от обычного зомби: 240 — его скорость в моде. */
function speed_gain($speed)
{
    $d = (int)round(((int)$speed - 240) / 240 * 100);
    return $d ? ' (' . ($d > 0 ? '+' : '') . $d . '%)' : '';
}

/**
 * Таблица сроков — списком пар, а не словарём.
 *
 * ⚠️ Порядок сроков ЗНАЧИМ и хрупок: у terms() ключи числовые (30, 90 и 0 —
 * «навсегда»), а JavaScript в объекте раскладывает числовые ключи по
 * возрастанию, что бы ни прислал PHP. Отдай мы словарь — «навсегда» встало бы
 * первым. Здесь порядок задан положением в массиве, и переставить его молча
 * уже нечему.
 */
function term_list($terms)
{
    $out = array();
    foreach ($terms as $days => $t) {
        $out[] = array('days' => (int)$days, 'label' => $t['label']);
    }
    return $out;
}

$manual = !payment_ready();

page_head('Привилегии', 'privileges', '<script src="assets/viewer.js?v=' . h(ZM_ASSET_V) . '" defer></script>');
?>

<section class="lead">
  <h1>Привилегии</h1>
  <p class="lead-text">
    Каждый уровень — это кредиты и здоровье на каждом возрождении, свой облик,
    свои ножи и свой класс зомби. Уровни <b>накопительные</b>: взяв Фараона, вы
    получаете и всё, что открывали младшие. Щёлкните по карточке — покажем
    модель и распишем, что именно уровень даёт на сервере.
  </p>
</section>

<div class="tier-cards" id="shelf">
  <?php foreach ($tiers as $i => $t):
    $skin = catalog_tier_skin($t['id']); ?>
    <article class="tier-card<?= $i === count($tiers) - 1 ? ' top' : '' ?>"
             role="button" tabindex="0"
             data-tier="<?= h($t['id']) ?>"
             aria-label="<?= h($t['name']) ?> — подробнее"
             <?= viewer_attrs(
                   $skin ? $skin['model'] : null,
                   $skin ? $t['name'] . ' — облик «' . $skin['name'] . '»' : $t['name'],
                   $skin ? $skin['desc'] : '',
                   $lookAt[$t['id']],
                   'tpl-tier-' . $t['id']
                 ) ?>>
      <div class="nm"><?= h($t['name']) ?></div>
      <?= model_img($skin ? $skin['model'] : null) ?>
      <?php /* «от» — в <span>: оформление даёт ему мелкий моноширинный шрифт, и
               слово перестаёт спорить с самой ценой. См. «.price span». */ ?>
      <div class="price"><span>от</span> <?= (int)$t['prices'][30] ?> ₽</div>
      <span class="more">Подробнее</span>
    </article>
  <?php endforeach; ?>
</div>

<!--
  Админка — отдельный товар со своим сроком, поэтому и карточка отдельная.
  Модели у неё нет: окно откроется одной правой колонкой, и это законно —
  смотреть там нечего, а читать есть что.
-->
<article class="admin-card" role="button" tabindex="0"
         aria-label="Админка — подробнее"
         <?= viewer_attrs(null, 'Админка', '', null, 'tpl-admin') ?>>
  <div>
    <div class="nm">Админка</div>
    <p class="blurb">
      Кик, бан, слей, админ-чат и меню — и место на забитом сервере.
      Покупается сама по себе, уровень для неё не нужен, и докупить её можно
      поверх уже действующей привилегии.
    </p>
  </div>
  <div class="price"><span>от</span> <?= (int)$adminPrices[30] ?> ₽</div>
  <span class="more">Подробнее</span>
</article>

<form class="order" method="post" action="buy.php" id="order">
  <input type="hidden" name="kind_of" id="f-what" value="tier">
  <input type="hidden" name="tier" id="f-tier" value="<?= h($tiers[0]['id']) ?>">
  <input type="hidden" name="days" id="f-days" value="30">

  <section class="card">
    <?php
    /*
     * ── меню Zombie Plague ────────────────────────────────────────────────
     *
     * ⚠️ ЗДЕСЬ БЫЛО ДВЕ ПОЛОСКИ КНОПОК: «что покупаем» (уровень или админка) и
     * «уровень». Товар при этом один, а выбирали его в двух местах, и второе
     * ещё и пряталось, когда выбрана админка, — то есть полстраницы прыгало от
     * щелчка по соседней кнопке.
     *
     * Теперь это один список, и он списан не с других сайтов, а с самого мода:
     * в игре выбор делают ровно так — всплывает нумерованный список, слева
     * красные цифры, жмёшь цифру. Поэтому нумерация здесь СКВОЗНАЯ, через
     * разделитель: жмут номер строки, а не номер внутри своей группы.
     */
    ?>
    <div class="group">
      <div class="zp-menu" id="pick">
        <div class="zp-head">
          <span class="zp-mod">Вспышка эпидемии</span>
          <span class="zp-keys">щёлкните строку или нажмите её цифру</span>
        </div>
        <ul class="zp-items">
          <?php foreach ($tiers as $i => $t): ?>
            <li>
              <button type="button" class="zp-row" data-pick="tier:<?= h($t['id']) ?>"
                      aria-pressed="<?= $i === 0 ? 'true' : 'false' ?>">
                <span class="zp-num"><?= $i + 1 ?>.</span>
                <span class="zp-name"><?= h($t['name']) ?></span>
                <?php /* Цена — за выбранный срок, и JS пересчитывает её вместе со
                         счётом. В разметке стоит цена начального срока: до первого
                         щелчка страница обязана быть верной сама по себе. */ ?>
                <span class="zp-cost"><?= (int)$t['prices'][30] ?> ₽</span>
              </button>
            </li>
          <?php endforeach; ?>

          <?php /* Черта: дальше идёт не пятый уровень, а отдельный товар со своим
                   сроком. Без неё админка читалась бы продолжением лестницы. */ ?>
          <li class="zp-sep"></li>
          <li>
            <button type="button" class="zp-row" data-pick="admin" aria-pressed="false">
              <span class="zp-num"><?= count($tiers) + 1 ?>.</span>
              <span class="zp-name">Админка</span>
              <span class="zp-cost"><?= (int)$adminPrices[30] ?> ₽</span>
            </button>
          </li>
        </ul>
        <div class="zp-foot"><span class="zp-num">0.</span> Сбросить выбор</div>
      </div>
      <?php /* Про цифры сказано в шапке самого меню, а не здесь: подсказка под
               списком стоит там, куда уже не смотрят — выбор к этому моменту
               сделан. Здесь остаётся только то, чего в меню не видно. */ ?>
      <p class="hint">Подробности о каждом уровне — в карточках выше.</p>
    </div>

    <div class="group">
      <span class="label">Срок</span>
      <!-- Кнопки сроков рисует JS: у уровня и у админки таблицы сроков свои, и
           разъехаться они вправе в любой момент — см. admin_terms(). -->
      <div class="seg" id="terms"></div>
    </div>

    <div class="group">
      <span class="label">Кому выдать</span>
      <div class="seg" id="kind">
        <button type="button" data-v="nick" aria-pressed="true">по нику</button>
        <button type="button" data-v="steamid" aria-pressed="false">по SteamID</button>
      </div>
      <input type="hidden" name="kind" id="f-kind" value="nick">
      <div class="field">
        <input type="text" name="auth" id="f-auth" maxlength="31" autocomplete="off" spellcheck="false"
               placeholder="ник ровно как в игре" required>
      </div>
      <p class="hint" id="auth-hint">
        Ник должен совпадать буква в букву — сервер узнаёт игрока по нему.
        Вместе с привилегией вы получите пароль: без него ваш ник смог бы занять кто угодно.
      </p>
    </div>

    <div class="group">
      <span class="label">Связь с вами</span>
      <div class="field">
        <input type="text" name="contact" maxlength="190" autocomplete="off"
               placeholder="ВКонтакте, Telegram или почта — необязательно">
      </div>
      <p class="hint">Пригодится, если с заказом что-то пойдёт не так и надо будет вас найти.</p>
    </div>
  </section>

  <aside>
    <section class="card">
      <span class="label">Заказ</span>
      <div class="bill">
        <div class="row"><span>товар</span><b id="b-what"><?= h($tiers[0]['name']) ?></b></div>
        <div class="row"><span>срок</span><b id="b-term">30 дней</b></div>
        <div class="total">
          <span class="label" style="margin:0">итого</span>
          <span class="sum" id="b-sum"><?= (int)$tiers[0]['prices'][30] ?> ₽</span>
        </div>
      </div>

      <button class="go" type="submit"><?= $manual ? 'Оформить заказ' : 'Перейти к оплате' ?></button>

      <?php if ($manual): ?>
        <p class="note">
          Автоматическая оплата пока не подключена: после оформления вы увидите номер заказа
          и реквизиты. Привилегию выдадим, как только увидим перевод.
        </p>
      <?php endif; ?>

      <p class="note">
        Покупка поверх действующей привилегии <b>прибавляет</b> срок к остатку,
        а уровень берёт наивысший. Потерять уже купленное доплатой невозможно.
        У админки срок <b>свой</b>: она не двигает срок уровня, и уровень не двигает её.
      </p>
    </section>
  </aside>
</form>

<?php
/*
 * ── правые колонки окна ──────────────────────────────────────────────────
 *
 * По одному <template> на товар. Просмотрщик клонирует содержимое в .mv-side
 * при каждом открытии и больше ничего о нём не знает — ни про цены, ни про
 * уровни. Кнопка внутри помечена data-mv-close: окно закроется, а сам щелчок
 * дойдёт до document, где его поймает обработчик внизу страницы.
 */
?>
<?php foreach ($tiers as $t):
  $skin = catalog_tier_skin($t['id']);
  $knives = $byTier[$t['id']];
  $classes = $classByTier[$t['id']]; ?>
  <template id="tpl-tier-<?= h($t['id']) ?>">
    <div class="mv-h">Что даёт на сервере</div>
    <ul class="mv-list">
      <li><b>+<?= (int)$t['packs'] ?></b> кредитов за каждое возрождение</li>
      <li><b>+<?= (int)$t['health'] ?></b> здоровья</li>
      <li>ножей <b><?= (int)$t['knives'] ?></b> из 11</li>
      <?php if ($skin): ?>
        <li>облик <b><?= h($skin['name']) ?></b> — <?= h($skin['desc']) ?>, надевается сам</li>
      <?php endif; ?>
    </ul>

    <?php if ($knives): ?>
      <div class="mv-h">Ножи, которые открывает уровень</div>
      <ul class="mv-list">
        <?php foreach ($knives as $k): ?>
          <li><b><?= h($k['name']) ?></b> — <?= h($k['desc']) ?></li>
        <?php endforeach; ?>
      </ul>
    <?php endif; ?>

    <?php foreach ($classes as $c): ?>
      <div class="mv-h">Класс зомби «<?= h($c['name']) ?>»</div>
      <ul class="mv-list">
        <li><b><?= h($c['ability']) ?></b> (<?= h($c['key']) ?>) — <?= h($c['desc']) ?></li>
        <li>здоровья <b><?= (int)$c['health'] ?></b></li>
        <li>скорость <b><?= (int)$c['speed'] ?></b><?= h(speed_gain($c['speed'])) ?></li>
        <li>прыжок <b><?= h(number_format(1 / $c['gravity'], 2)) ?>×</b></li>
        <li>отбрасывание <b><?= h(number_format($c['knockback'], 2)) ?></b></li>
      </ul>
    <?php endforeach; ?>

    <p class="hint">
      Уровни накопительные: сюда добавляется всё, что открывают младшие.
      Ножи и класс выбираются в игровом меню и держатся до конца раунда.
    </p>

    <div class="mv-h">Сколько стоит</div>
    <ul class="mv-prices">
      <?php foreach ($terms as $days => $term):
        if (!isset($t['prices'][$days])) continue; ?>
        <li><span><?= h($term['label']) ?></span><b><?= (int)$t['prices'][$days] ?> ₽</b></li>
      <?php endforeach; ?>
    </ul>

    <button type="button" class="mv-buy" data-mv-close data-pick-tier="<?= h($t['id']) ?>">
      Выбрать этот уровень
    </button>
  </template>
<?php endforeach; ?>

<template id="tpl-admin">
  <div class="mv-h">Что даёт админка</div>
  <?php
  /*
   * Буквы флагов (b, c, d…) покупателю не показываем: для него это шум. Они
   * есть в admin_powers() и видны в панели выдачи — там их читает владелец, и
   * там они к месту.
   */
  ?>
  <table>
    <?php foreach (admin_powers() as $p): ?>
      <tr><td><?= h($p['name']) ?></td><td><?= h($p['desc']) ?></td></tr>
    <?php endforeach; ?>
  </table>

  <div class="mv-h">Чего она не даёт</div>
  <ul class="mv-list">
    <?php foreach (admin_denied() as $d): ?>
      <li><?= h($d) ?></li>
    <?php endforeach; ?>
  </ul>
  <p class="hint">
    Набор урезан нарочно: админка продаётся, то есть попадает к людям, которых
    никто не проверял. Ничего, чем можно увести сервер, в ней нет.
  </p>

  <div class="mv-h">Сколько стоит</div>
  <ul class="mv-prices">
    <?php foreach ($adminTerms as $days => $term):
      if (!isset($adminPrices[$days])) continue; ?>
      <li><span><?= h($term['label']) ?></span><b><?= (int)$adminPrices[$days] ?> ₽</b></li>
    <?php endforeach; ?>
  </ul>
  <p class="hint">
    Срок у админки свой. Докупить её можно поверх действующей привилегии — срок
    привилегии от этого не сдвинется, и наоборот.
  </p>

  <button type="button" class="mv-buy" data-mv-close data-pick-admin="1">
    Купить админку
  </button>
</template>

<script>
"use strict";

const PRICES       = <?= json_encode($priceTable, JSON_UNESCAPED_UNICODE) ?>;
const NAMES        = <?= json_encode(array_column($tiers, 'name', 'id'), JSON_UNESCAPED_UNICODE) ?>;
const ADMIN_PRICES = <?= json_encode($adminPrices, JSON_UNESCAPED_UNICODE) ?>;

/*
 * Сроки уезжают СПИСКОМ, а не словарём «дни → подпись».
 *
 * ⚠️ И это не вкусовщина. Ключи у сроков числовые (30, 90 и 0 — «навсегда»), а
 * JavaScript в объекте всегда раскладывает числовые ключи по возрастанию,
 * какой бы порядок ни прислал PHP. Словарь превратил бы «30 дней, 90 дней,
 * навсегда» в «навсегда, 30 дней, 90 дней»: самый дорогой срок встал бы первым
 * и выглядел бы выбранным по умолчанию. У массива такого своеволия нет.
 */
const TERMS       = <?= json_encode(term_list($terms), JSON_UNESCAPED_UNICODE) ?>;
const ADMIN_TERMS = <?= json_encode(term_list($adminTerms), JSON_UNESCAPED_UNICODE) ?>;

const $ = id => document.getElementById(id);
const state = { what: "tier", tier: <?= json_encode($tiers[0]['id']) ?>, days: 30 };

const isAdmin    = () => state.what === "admin";
const termTable  = () => (isAdmin() ? ADMIN_TERMS : TERMS);
const priceTable = () => (isAdmin() ? ADMIN_PRICES : (PRICES[state.tier] || {}));
const termLabel  = d => { const t = termTable().find(x => x.days === d); return t ? t.label : ""; };

/** Что записано в data-pick строки меню: "admin" либо "tier:<уровень>". */
const pickedTier = v => (v === "admin" ? "" : v.slice(v.indexOf(":") + 1));

/*
 * Цена в строке меню — за ВЫБРАННЫЙ срок: меню и счёт обязаны показывать одно
 * и то же число, иначе одно из двух врёт.
 *
 * ⚠️ Товар может не продавать выбранный срок: сроки уровня и админки вправе
 * разойтись в любой день (см. drawTerms). Тогда пишем «от» и самую дешёвую
 * цену — молча подставить цену другого срока значит соврать в ценнике.
 */
function costOf(table) {
  const price = table[state.days];
  if (price != null) {
    return price + " ₽";
  }
  const all = Object.keys(table).map(d => Number(table[d]));
  return all.length ? "от " + Math.min(...all) + " ₽" : "";
}

/*
 * Кнопки сроков перерисовываем при каждой смене товара, а не прячем лишние.
 * Сегодня admin_terms() возвращает то же, что terms(), но это решение владельца
 * на один день: разойдутся — уровень и админка должны показать РАЗНЫЕ наборы,
 * а не один общий, из которого половина ведёт к «такого срока нет».
 */
function drawTerms() {
  const table = termTable();

  // Выбранный срок мог исчезнуть вместе с таблицей — тогда берём первый.
  if (!table.some(t => t.days === state.days)) {
    state.days = table[0].days;
  }

  $("terms").innerHTML = table.map(t =>
    `<button type="button" data-days="${t.days}" aria-pressed="${t.days === state.days}">${t.label}</button>`
  ).join("");
}

function draw() {
  const sum = priceTable()[state.days] || 0;

  $("b-what").textContent = isAdmin() ? "Админка" : NAMES[state.tier];
  $("b-term").textContent = termLabel(state.days);
  $("b-sum").textContent = sum + " ₽";

  $("f-what").value = state.what;
  // Уровень в заказе админки не участвует вовсе: buy.php запишет в этот
  // столбец NULL, что бы ни лежало в скрытом поле.
  $("f-tier").value = state.tier;
  $("f-days").value = state.days;

  // Меню: нажатая строка помечена, цена в каждой — за выбранный срок.
  rows.forEach(row => {
    const id = pickedTier(row.dataset.pick);
    const mine = id === "" ? isAdmin() : (!isAdmin() && id === state.tier);
    row.setAttribute("aria-pressed", String(mine));
    row.querySelector(".zp-cost").textContent = costOf(id === "" ? ADMIN_PRICES : (PRICES[id] || {}));
  });

  // Витрина светится вслед за меню: выбор один, а показан в двух местах, и
  // разойтись им нельзя — иначе человек читает карточку одного уровня, а
  // покупает другой.
  document.querySelectorAll(".tier-card").forEach(el =>
    el.classList.toggle("on", !isAdmin() && el.dataset.tier === state.tier));
  [...$("terms").children].forEach(b =>
    b.setAttribute("aria-pressed", String(Number(b.dataset.days) === state.days)));
}

/** Общий обработчик для полосок кнопок: нажатая помечается, остальные гаснут. */
function seg(id, pick) {
  $(id).addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b || !$(id).contains(b)) return;
    pick(b.dataset);
  });
}

seg("terms", d => { state.days = Number(d.days); draw(); });

seg("kind", d => {
  $("f-kind").value = d.v;
  const steam = d.v === "steamid";
  [...$("kind").children].forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === d.v)));
  $("f-auth").placeholder = steam ? "STEAM_0:1:12345" : "ник ровно как в игре";
  $("auth-hint").textContent = steam
    ? "SteamID не подделать чужим ником. Сервер пускает и без Steam — таким игрокам он выдаёт SteamID сам, и он может смениться."
    : "Ник должен совпадать буква в букву — сервер узнаёт игрока по нему. Вместе с привилегией вы получите пароль: без него ваш ник смог бы занять кто угодно.";
});

/*
 * ── меню Zombie Plague ──────────────────────────────────────────────────────
 *
 * Выбор товара сходится в одну воронку: сюда ведут и щелчок по строке меню, и
 * цифра с клавиатуры, и кнопки из окна просмотра. Две дороги к одному состоянию
 * расходятся молча — рано или поздно одна из них забудет перерисовать сроки.
 */
function choose(v) {
  const id = pickedTier(v);
  if (id === "") {
    state.what = "admin";
  } else {
    state.what = "tier";
    state.tier = id;
  }
  drawTerms();
  draw();
}

/*
 * Строки меню по порядку — он же порядок цифр: первая строка это «1», вторая
 * «2» и так далее, сквозь разделитель до админки. Нумерацию рисует PHP по тому
 * же списку, так что второго источника правды здесь нет.
 *
 * <li class="zp-sep"> кнопки не содержит и в счёт не идёт — потому цифры и
 * остаются теми же, что нарисованы.
 */
const rows = [...document.querySelectorAll("#pick .zp-row")];

$("pick").addEventListener("click", e => {
  const row = e.target.closest(".zp-row");
  if (row) choose(row.dataset.pick);
});

document.addEventListener("keydown", e => {
  /*
   * ⚠️ ПОКА ЧЕЛОВЕК ПЕЧАТАЕТ, ЦИФРЫ ПРИНАДЛЕЖАТ ПОЛЮ, А НЕ МЕНЮ. Без этой
   * проверки тот, кто набирает ник «zm1x», молча переключал бы себе товар:
   * меню в этот момент выше по странице и в глаза не бросается, и узнал бы он
   * об этом уже в счёте — если бы вообще заметил.
   *
   * Ctrl/Alt/Meta пропускаем по той же причине: Ctrl+1 — чужое сочетание
   * (вкладки браузера, расширения), и присваивать его себе мы не вправе.
   */
  const el = e.target;
  const tag = el && el.tagName ? el.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea" || (el && el.isContentEditable)) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  // Открыто окно просмотра — клавиши его: там свой Escape, а переключать под
  // ним товар, которого не видно, — то же молчаливое переключение.
  if (document.body.classList.contains("mv-open")) return;

  /*
   * ⚠️ Смотрим e.key, а НЕ e.keyCode. У верхнего ряда и цифровой клавиатуры
   * коды разные (49 и 97), а e.key у обеих даёт "1" — по коду половина
   * клавиатур молча перестала бы работать.
   */
  if (!/^[0-9]$/.test(e.key)) return;

  // Ноль — как в игре: сброс. Возвращаемся к первому уровню, а не в пустоту:
  // заказ без товара отправлять некуда.
  const row = e.key === "0" ? rows[0] : rows[Number(e.key) - 1];
  if (row) choose(row.dataset.pick);
});

/*
 * Кнопки «Выбрать этот уровень» и «Купить админку» живут внутри <template>, и
 * до открытия окна их в странице нет вовсе.
 *
 * ⚠️ ПОЭТОМУ ОБРАБОТЧИК ТОЛЬКО ДЕЛЕГИРОВАННЫЙ, НА document. Узлы внутри
 * <template> неживые: обработчик, повешенный прямо на них, не сработает
 * никогда, и это тихая поломка — разметка на месте, кнопка нажимается,
 * а не происходит ничего.
 *
 * Просмотрщик к этому моменту уже закрыл окно (он видит data-mv-close), но
 * всплытие не остановил — щелчок доходит сюда.
 */
document.addEventListener("click", e => {
  const btn = e.target.closest("[data-pick-tier], [data-pick-admin]");
  if (!btn) return;

  choose(btn.dataset.pickTier ? "tier:" + btn.dataset.pickTier : "admin");

  const smooth = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  $("order").scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
});

drawTerms();
draw();
</script>

<?php page_foot(); ?>
