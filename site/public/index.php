<?php
/**
 * Главная: что за сервер, живой ли он сейчас и куда идти дальше.
 *
 * Задача страницы одна — за десять секунд объяснить незнакомому человеку, куда
 * он попал, и дать ему подключиться. Всё остальное (привилегии, кредиты) —
 * соседние страницы, и тащить их содержимое сюда значит утопить и то и другое.
 */

require __DIR__ . '/_boot.php';
require_once ZM_APP . '/view.php';
require_once ZM_APP . '/a2s.php';

send_security_headers();

$site = cfg('site');
$info = a2s_info();
$tiers = array_values(array_filter(tiers(), function ($t) { return $t['sold']; }));
$knives = catalog_knives();
$skins = catalog_shop_skins();

page_head('Сервер', 'index', '<script src="assets/viewer.js?v=' . h(ZM_ASSET_V) . '" defer></script>');
?>

<section class="hero">
  <div class="hero-text">
    <h1 class="hero-title"><?= h($site['title']) ?></h1>
    <p class="hero-sub">Зомби-мод для Counter-Strike 1.6</p>
    <p class="lead-text">
      Люди против заражённых: выжившие держат оборону и отстреливаются, зомби ломятся
      врукопашную. За убитых дают кредиты, на кредиты берут оружие, облики и ножи —
      и к концу вечера уже понятно, кто на сервере кто.
    </p>

    <div class="cta">
      <a class="btn" href="privileges.php">Купить привилегию</a>
      <a class="btn ghost-btn" href="shop.php">Пополнить кредиты</a>
    </div>

    <div class="status">
      <?php if ($info === null): ?>
        <span class="dot dim"></span>
        <span>адрес сервера пока не указан</span>
      <?php elseif (!empty($info['online'])): ?>
        <span class="dot live"></span>
        <span>
          сервер работает — <b><?= (int)$info['players'] ?></b> из <?= (int)$info['max'] ?> игроков,
          карта <b><?= h($info['map']) ?></b>
        </span>
      <?php else: ?>
        <span class="dot dead"></span>
        <span>сервер сейчас не отвечает</span>
      <?php endif; ?>
    </div>

    <?php if (!empty($site['connect'])): ?>
      <div class="connect">
        <span class="label">Подключиться</span>
        <div class="pair">
          <code>connect <?= h($site['connect']) ?></code>
          <button class="copy" type="button" data-copy="connect <?= h($site['connect']) ?>">копировать</button>
        </div>
        <p class="hint">
          В игре нажмите <b>~</b>, вставьте строку и нажмите Enter. Всё нужное —
          модели, звуки и значки — докачается с этого же сайта само.
        </p>
      </div>
    <?php endif; ?>
  </div>

  <div class="hero-model">
    <?= viewer('skin-pharaoh', 'viewer-hero', 'Фараон — облик «Фараон»', 'золотой череп в немесе') ?>
    <p class="hint" style="text-align:center">Облик «Фараон» — верхний покупаемый уровень. Покрутите мышью.</p>
  </div>
</section>

<section class="section">
  <h2>Что на сервере</h2>
  <div class="facts">
    <article class="fact">
      <div class="fact-num"><?= count($knives) ?></div>
      <div class="fact-name">ножей</div>
      <p>Каждый работает по-своему: один поджигает, другой замораживает, третий пьёт здоровье за удар.</p>
    </article>
    <article class="fact">
      <div class="fact-num">16</div>
      <div class="fact-name">стволов в магазине</div>
      <p>Покупаются за кредиты прямо в раунде: от пистолетов до крупнокалиберных снайперских.</p>
    </article>
    <article class="fact">
      <div class="fact-num">13</div>
      <div class="fact-name">классов зомби</div>
      <p>У каждого своя способность — от прыжка через полкарты до заморозки и огня.</p>
    </article>
    <article class="fact">
      <div class="fact-num"><?= count($skins) + count($tiers) + 1 ?></div>
      <div class="fact-name">обликов</div>
      <p>Часть открывается уровнем привилегии, остальные покупаются за кредиты навсегда.</p>
    </article>
  </div>
</section>

<section class="section">
  <h2>Привилегии</h2>
  <p class="lead-text">
    Четыре покупаемых уровня. Каждый даёт кредиты и здоровье на каждом возрождении,
    свой облик и свои ножи — и всё, что открывали уровни ниже.
  </p>
  <div class="tier-row">
    <?php foreach ($tiers as $t): $skin = catalog_tier_skin($t['id']); ?>
      <a class="tier-brief" href="privileges.php">
        <?= viewer($skin ? $skin['model'] : null, '',
              $t['name'] . ($skin ? ' — облик «' . $skin['name'] . '»' : ''),
              $skin ? $skin['desc'] : '') ?>
        <div class="nm"><?= h($t['name']) ?></div>
        <div class="thing-desc">+<?= (int)$t['packs'] ?> кредитов · +<?= (int)$t['health'] ?> HP</div>
        <div class="price-small">от <?= (int)$t['prices'][30] ?> ₽</div>
      </a>
    <?php endforeach; ?>
  </div>
  <p style="margin-top:22px"><a class="btn" href="privileges.php">Смотреть подробно</a></p>
</section>

<section class="section">
  <h2>Как начать</h2>
  <ol class="steps big-steps">
    <li><b>Зайдите на сервер</b><?= !empty($site['connect']) ? ' по адресу выше' : '' ?>. Ничего скачивать заранее не нужно — контент подтянется сам.</li>
    <li><b>Играйте.</b> Кредиты капают за убитых зомби и за выигранные раунды.</li>
    <li><b>Тратьте.</b> Меню магазина — команда <code>/магазин</code> в чате, выбор ножа и облика — там же.</li>
    <li><b>Хотите больше</b> — возьмите привилегию или пополните кредиты на этом сайте.</li>
  </ol>
</section>

<script>
"use strict";
document.querySelectorAll(".copy").forEach(b => b.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(b.dataset.copy); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = b.dataset.copy;
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  const was = b.textContent;
  b.textContent = "скопировано";
  setTimeout(() => { b.textContent = was; }, 1400);
}));
</script>

<?php page_foot(); ?>
