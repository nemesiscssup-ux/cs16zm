<?php
/**
 * Привилегии: что даёт каждый уровень, как выглядит его облик и какие ножи он
 * открывает — плюс форма заказа.
 *
 * Страница ничего не пишет в базу. Заказ создаёт buy.php, и делает это по POST:
 * заказ, который заводится переходом по ссылке, заведёт и поисковый робот.
 */

require __DIR__ . '/_boot.php';
require_once ZM_APP . '/view.php';

send_security_headers();

$tiers = array_values(array_filter(tiers(), function ($t) {
    return $t['sold'];
}));
$terms = terms();

// Цены отдаём на страницу разом: пересчёт при каждом щелчке должен быть
// мгновенным, а ходить за ним на сервер — значит показывать пустое место.
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
foreach ($tiers as $t) {
    $byTier[$t['id']] = array();
}
foreach (catalog_knives() as $k) {
    if ($k['tier'] !== null && isset($byTier[$k['tier']])) {
        $byTier[$k['tier']][] = $k;
    }
}

// Классы зомби — так же по уровням и так же накопительно.
$classByTier = array();
foreach ($tiers as $t) {
    $classByTier[$t['id']] = array();
}
foreach (catalog_classes() as $c) {
    if (isset($classByTier[$c['tier']])) {
        $classByTier[$c['tier']][] = $c;
    }
}

/*
 * Что можно покрутить из карточки уровня: сам облик, ножи и классы зомби ЭТОГО
 * уровня и всех младших — уровни накопительные, и игрок получает всё сразу.
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
            'id' => $c['model'],
            'name' => 'Зомби: ' . $c['name'],
            'desc' => $c['ability'] . ' (' . $c['key'] . ') — ' . $c['desc'],
        );
    }
    $lookAt[$t['id']] = $stack;
}

$manual = !payment_ready();

page_head('Привилегии', 'privileges', '<script src="assets/viewer.js?v=' . h(ZM_ASSET_V) . '" defer></script>');
?>

<section class="lead">
  <h1>Привилегии</h1>
  <p class="lead-text">
    Каждый уровень — это кредиты и здоровье на каждом возрождении, свой облик и свои ножи.
    Уровни <b>накопительные</b>: взяв Фараона, вы получаете и всё, что открывали младшие.
    Модель под названием можно покрутить мышью.
  </p>
</section>

<div class="shelf" id="shelf">
  <?php foreach ($tiers as $i => $t):
    $skin = catalog_tier_skin($t['id']); ?>
    <label class="item<?= $i === count($tiers) - 1 ? ' top' : '' ?>" data-tier="<?= h($t['id']) ?>">
      <input type="radio" name="tier" value="<?= h($t['id']) ?>" hidden<?= $i === 0 ? ' checked' : '' ?>>
      <div class="nm"><?= h($t['name']) ?></div>
      <?= viewer(
            $skin ? $skin['model'] : null,
            'viewer-tall',
            $skin ? $t['name'] . ' — облик «' . $skin['name'] . '»' : $t['name'],
            $skin ? $skin['desc'] : '',
            $lookAt[$t['id']]
          ) ?>
      <div class="blurb"><?= h($t['blurb']) ?></div>
      <ul class="perks">
        <li><b>+<?= (int)$t['packs'] ?></b> кредитов за возрождение</li>
        <li><b>+<?= (int)$t['health'] ?></b> здоровья</li>
        <li>ножей <b><?= (int)$t['knives'] ?></b> из 11</li>
        <?php if (!empty($classByTier[$t['id']])): ?>
          <li>класс зомби <b><?= h(implode(', ', array_column($classByTier[$t['id']], 'name'))) ?></b></li>
        <?php endif; ?>
        <?php if ($skin): ?><li>облик <b><?= h($skin['name']) ?></b> — <?= h($skin['desc']) ?></li><?php endif; ?>
      </ul>
      <div class="price" data-price="<?= h($t['id']) ?>">
        <?= (int)$t['prices'][30] ?> ₽ <span>/ 30 дней</span>
      </div>
    </label>
  <?php endforeach; ?>
</div>

<form class="order" method="post" action="buy.php" id="order">
  <input type="hidden" name="kind_of" value="tier">
  <input type="hidden" name="tier" id="f-tier" value="<?= h($tiers[0]['id']) ?>">
  <input type="hidden" name="days" id="f-days" value="30">

  <section class="card">
    <div class="group">
      <span class="label">Срок</span>
      <div class="seg" id="terms">
        <?php $first = true; foreach ($terms as $days => $term): ?>
          <button type="button" data-days="<?= (int)$days ?>" aria-pressed="<?= $first ? 'true' : 'false' ?>"><?= h($term['label']) ?></button>
        <?php $first = false; endforeach; ?>
      </div>
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
      <span class="label">Дополнительно</span>
      <label class="check">
        <input type="checkbox" name="with_admin" id="f-admin" value="1">
        <span>
          Админка — кик, бан до 30 минут, чат и админ-меню. <b>+<?= (int)ADMIN_PRICE ?> ₽</b>
          <span class="hint" style="display:block;margin-top:2px">
            Полных прав она не даёт: ни смены карты, ни rcon, ни неприкосновенности.
          </span>
        </span>
      </label>
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
        <div class="row"><span>уровень</span><b id="b-tier"><?= h($tiers[0]['name']) ?></b></div>
        <div class="row"><span>срок</span><b id="b-term">30 дней</b></div>
        <div class="row" id="b-admin-row" hidden><span>админка</span><b>+<?= (int)ADMIN_PRICE ?> ₽</b></div>
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
      </p>
    </section>
  </aside>
</form>

<section class="section">
  <h2>Ножи, которые открывает уровень</h2>
  <p class="lead-text">
    Нож выбирается в игровом меню и остаётся до конца раунда. Уровни
    <b>накопительные</b>: взяв старший, вы получаете и все ножи младших.
    Щёлкните по модели, чтобы покрутить её.
  </p>

  <?php foreach ($tiers as $t):
    if (empty($byTier[$t['id']])) continue; ?>
    <h3 class="group-title">С уровня <?= h($t['name']) ?></h3>
    <div class="grid">
      <?php foreach ($byTier[$t['id']] as $k): ?>
        <article class="thing">
          <?= viewer($k['model'], '', $k['name'], $k['desc']) ?>
          <div class="thing-name"><?= h($k['name']) ?></div>
          <div class="thing-desc"><?= h($k['desc']) ?></div>
        </article>
      <?php endforeach; ?>
    </div>
  <?php endforeach; ?>
</section>

<section class="section">
  <h2>Классы зомби, которые открывает уровень</h2>
  <p class="lead-text">
    Класс выбирается в меню зомби и остаётся до конца раунда. У каждого своя
    способность на отдельной клавише. Уровни <b>накопительные</b>: старший даёт
    и классы младших.
  </p>

  <?php foreach ($tiers as $t):
    if (empty($classByTier[$t['id']])) continue; ?>
    <h3 class="group-title">С уровня <?= h($t['name']) ?></h3>
    <div class="grid">
      <?php foreach ($classByTier[$t['id']] as $c): ?>
        <article class="thing">
          <?= viewer($c['model'], '', 'Зомби: ' . $c['name'],
                $c['ability'] . ' (' . $c['key'] . ') — ' . $c['desc']) ?>
          <div class="thing-name"><?= h($c['name']) ?></div>
          <div class="thing-desc">
            <?= h($c['ability']) ?> <b>(<?= h($c['key']) ?>)</b> — <?= h($c['desc']) ?>
          </div>
          <ul class="perks" style="margin-top:8px">
            <li>здоровья <b><?= (int)$c['health'] ?></b></li>
            <li>скорость <b><?= (int)$c['speed'] ?></b><?php
              // 240 — скорость обычного зомби в моде; от неё и считаем разницу.
              $d = (int)round(($c['speed'] - 240) / 240 * 100);
              echo $d ? ' <span style="color:var(--dim)">(' . ($d > 0 ? '+' : '') . $d . '%)</span>' : '';
            ?></li>
            <li>прыжок <b><?= h(number_format(1 / $c['gravity'], 2)) ?>×</b></li>
            <li>отбрасывание <b><?= h(number_format($c['knockback'], 2)) ?></b></li>
          </ul>
        </article>
      <?php endforeach; ?>
    </div>
  <?php endforeach; ?>
</section>

<script>
"use strict";

const PRICES = <?= json_encode($priceTable, JSON_UNESCAPED_UNICODE) ?>;
const NAMES = <?= json_encode(array_column($tiers, 'name', 'id'), JSON_UNESCAPED_UNICODE) ?>;
const TERMS = <?= json_encode(array_map(function ($t) { return $t['label']; }, $terms), JSON_UNESCAPED_UNICODE) ?>;
const ADMIN_PRICE = <?= (int)ADMIN_PRICE ?>;

const $ = id => document.getElementById(id);
const state = { tier: <?= json_encode($tiers[0]['id']) ?>, days: 30, admin: false };

function draw() {
  const sum = (PRICES[state.tier][state.days] || 0) + (state.admin ? ADMIN_PRICE : 0);

  $("b-tier").textContent = NAMES[state.tier];
  $("b-term").textContent = TERMS[state.days];
  $("b-admin-row").hidden = !state.admin;
  $("b-sum").textContent = sum + " ₽";
  $("f-tier").value = state.tier;
  $("f-days").value = state.days;

  // Цена на карточке следует за выбранным сроком: иначе витрина показывает
  // одно, счёт другое, и это выглядит как обман.
  for (const id in PRICES) {
    const cell = document.querySelector(`[data-price="${id}"]`);
    if (cell) cell.innerHTML = PRICES[id][state.days] + " ₽ <span>/ " + TERMS[state.days] + "</span>";
  }
  document.querySelectorAll(".item").forEach(el =>
    el.classList.toggle("on", el.dataset.tier === state.tier));
}

// Щелчок по модели крутит её, а не выбирает уровень: иначе покрутить нельзя.
document.querySelectorAll(".item .viewer").forEach(v =>
  v.addEventListener("click", e => e.preventDefault()));

$("shelf").addEventListener("change", e => {
  if (e.target.name === "tier") { state.tier = e.target.value; draw(); }
});

function seg(id, pick) {
  $(id).addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    [...$(id).children].forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    pick(b.dataset);
  });
}

seg("terms", d => { state.days = Number(d.days); draw(); });

seg("kind", d => {
  $("f-kind").value = d.v;
  const steam = d.v === "steamid";
  $("f-auth").placeholder = steam ? "STEAM_0:1:12345" : "ник ровно как в игре";
  $("auth-hint").textContent = steam
    ? "SteamID не подделать чужим ником. Сервер пускает и без Steam — таким игрокам он выдаёт SteamID сам, и он может смениться."
    : "Ник должен совпадать буква в букву — сервер узнаёт игрока по нему. Вместе с привилегией вы получите пароль: без него ваш ник смог бы занять кто угодно.";
});

$("f-admin").addEventListener("change", e => { state.admin = e.target.checked; draw(); });

draw();
</script>

<?php page_foot(); ?>
