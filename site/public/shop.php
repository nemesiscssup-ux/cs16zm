<?php
/**
 * Магазин кредитов.
 *
 * Кредиты («паки» в терминах мода) — игровая валюта: за них покупают оружие в
 * раундовом магазине и облики навсегда. Здесь их продают наборами.
 *
 * ⚠️ ВЫДАЧА КРЕДИТОВ РАБОТАЕТ ТОЛЬКО ПО ЖИВОМУ ИГРОКУ. Команда сервера
 * обращается к игроку по нику, а ник существует, пока человек на сервере.
 * Поэтому здесь честно написано: зайдите на сервер и не выходите. Заказ,
 * который не удалось выдать, не пропадает — он ждёт в панели.
 */

require __DIR__ . '/_boot.php';
require_once ZM_APP . '/view.php';

send_security_headers();

$packs = catalog_packs();
$skins = catalog_shop_skins();
$weapons = catalog_weapons();
$manual = !payment_ready();

page_head('Кредиты', 'shop', '<script src="assets/viewer.js?v=' . h(ZM_ASSET_V) . '" defer></script>');
?>

<section class="lead">
  <h1>Кредиты</h1>
  <p class="lead-text">
    Кредиты — игровая валюта сервера. За них берут оружие в раундовом магазине
    (команда <code>/магазин</code> в чате) и облики, которые остаются навсегда.
    В бою они капают сами, здесь — сразу и много.
  </p>
</section>

<div class="shelf" id="shelf">
  <?php foreach ($packs as $i => $p):
    $total = $p['packs'] + $p['bonus']; ?>
    <label class="item<?= $i === count($packs) - 1 ? ' top' : '' ?>" data-pack="<?= h($p['id']) ?>">
      <input type="radio" name="pack" value="<?= h($p['id']) ?>" hidden<?= $i === 0 ? ' checked' : '' ?>>
      <div class="nm"><?= (int)$total ?> кредитов</div>
      <?php if ($p['bonus']): ?>
        <div class="bonus">+<?= (int)$p['bonus'] ?> сверху</div>
      <?php else: ?>
        <div class="blurb">начальный набор</div>
      <?php endif; ?>
      <ul class="perks">
        <li>это <b><?= (int)floor($total / 20) ?></b> покупок оружия в раунде</li>
        <li>или <b><?= (int)floor($total / 80) ?></b> обликов навсегда</li>
      </ul>
      <div class="price"><?= (int)$p['price'] ?> ₽ <span>/ <?= (int)round($p['price'] / $total * 100) ?> ₽ за 100</span></div>
    </label>
  <?php endforeach; ?>
</div>

<form class="order" method="post" action="buy.php">
  <input type="hidden" name="kind_of" value="packs">
  <input type="hidden" name="pack" id="f-pack" value="<?= h($packs[0]['id']) ?>">

  <section class="card">
    <div class="group">
      <span class="label">Кому начислить</span>
      <div class="field">
        <input type="text" name="auth" maxlength="31" autocomplete="off" spellcheck="false"
               placeholder="ник ровно как в игре" required>
      </div>
      <p class="hint">
        Ник должен совпадать буква в букву — сервер узнаёт игрока по нему.
      </p>
    </div>

    <div class="group">
      <span class="label">Связь с вами</span>
      <div class="field">
        <input type="text" name="contact" maxlength="190" autocomplete="off"
               placeholder="ВКонтакте, Telegram или почта — необязательно">
      </div>
    </div>

    <div class="warn-box">
      <span class="label">Важно</span>
      <p>
        Кредиты начисляются <b>игроку, который сейчас на сервере</b>: сервер знает вас по нику,
        пока вы к нему подключены. Зайдите в игру и оставайтесь на сервере, пока идёт оплата.
      </p>
      <p class="hint">
        Не успели — ничего не потеряно: заказ останется в очереди, и мы начислим его вручную.
      </p>
    </div>
  </section>

  <aside>
    <section class="card">
      <span class="label">Заказ</span>
      <div class="bill">
        <div class="row"><span>кредитов</span><b id="b-packs"><?= (int)($packs[0]['packs'] + $packs[0]['bonus']) ?></b></div>
        <div class="row" id="b-bonus-row"<?= $packs[0]['bonus'] ? '' : ' hidden' ?>>
          <span>из них сверху</span><b id="b-bonus">+<?= (int)$packs[0]['bonus'] ?></b>
        </div>
        <div class="total">
          <span class="label" style="margin:0">итого</span>
          <span class="sum" id="b-sum"><?= (int)$packs[0]['price'] ?> ₽</span>
        </div>
      </div>

      <button class="go" type="submit"><?= $manual ? 'Оформить заказ' : 'Перейти к оплате' ?></button>

      <?php if ($manual): ?>
        <p class="note">
          Автоматическая оплата пока не подключена: после оформления вы увидите номер заказа
          и реквизиты.
        </p>
      <?php endif; ?>
    </section>
  </aside>
</form>

<section class="section">
  <h2>На что тратить</h2>
  <p class="lead-text">
    Оружие покупается на раунд, облики — навсегда. Модели можно покрутить мышью.
  </p>

  <h3 class="group-title">Оружие</h3>
  <div class="grid">
    <?php foreach ($weapons as $w): ?>
      <article class="thing">
        <?= viewer($w['model'], '', $w['name'], $w['desc']) ?>
        <div class="thing-name"><?= h($w['name']) ?></div>
        <div class="thing-desc"><?= h($w['desc']) ?></div>
        <div class="thing-price"><?= (int)$w['packs'] ?> кредитов за раунд</div>
      </article>
    <?php endforeach; ?>
  </div>
  <p class="hint">Это три из шестнадцати — остальные видно в игровом меню <code>/магазин</code>.</p>

  <h3 class="group-title">Облики навсегда</h3>
  <div class="skin-list">
    <?php foreach ($skins as $s): ?>
      <div class="skin-row">
        <span class="skin-name"><?= h($s['name']) ?></span>
        <span class="skin-desc"><?= h($s['desc']) ?></span>
        <span class="skin-price"><?= (int)$s['packs'] ?></span>
      </div>
    <?php endforeach; ?>
  </div>
</section>

<script>
"use strict";
const PACKS = <?= json_encode(array_column($packs, null, 'id'), JSON_UNESCAPED_UNICODE) ?>;
const $ = id => document.getElementById(id);

document.getElementById("shelf").addEventListener("change", e => {
  if (e.target.name !== "pack") return;
  const p = PACKS[e.target.value];
  const total = p.packs + p.bonus;
  $("f-pack").value = p.id;
  $("b-packs").textContent = total;
  $("b-bonus").textContent = "+" + p.bonus;
  $("b-bonus-row").hidden = !p.bonus;
  $("b-sum").textContent = p.price + " ₽";
  document.querySelectorAll(".item").forEach(el => el.classList.toggle("on", el.dataset.pack === p.id));
});

// Первый набор отмечен в разметке — подсветим его и на глаз.
document.querySelector(".item").classList.add("on");
</script>

<?php page_foot(); ?>
