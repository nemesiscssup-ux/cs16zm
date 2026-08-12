<?php
/**
 * Главная: витрина привилегий и новости, а адрес сервера — рядом.
 *
 * Задача страницы — показать, что продаётся и что нового, и тут же дать
 * подключиться, никуда не уходя. Всё остальное (разбор уровней, кредиты) —
 * соседние страницы, и тащить их содержимое сюда значит утопить и то и другое:
 * на главной остаются вывеска и повод вернуться, подробности — по ссылке.
 */

require __DIR__ . '/_boot.php';
require_once ZM_APP . '/view.php';
require_once ZM_APP . '/a2s.php';
require_once ZM_APP . '/news.php';

send_security_headers();

$site = cfg('site');
$info = a2s_info();
$tiers = array_values(array_filter(tiers(), function ($t) { return $t['sold']; }));
$news = news_latest(5);

page_head('Сервер', 'index', '<script src="assets/viewer.js?v=' . h(ZM_ASSET_V) . '" defer></script>');

/*
 * Подпись шапки — строка из игрового чата, и первое, что человек читает.
 *
 * Ник первого зомби сюда не подставить и не выдумать: a2s_info() приносит
 * только карту, счёт и название сервера — имён в ответе A2S нет вовсе.
 * Придуманный ник проверяется одним заходом на сервер, а это первая строка
 * главной, и врать ей нельзя. Поэтому в переменной части стоит то, что сервер
 * действительно сказал, — карта; а кто станет первым зомби, мод выбирает
 * жребием (fnGetRandomAlive в zombie_plague44.sma), о чём строка и говорит.
 *
 * Счёт игроков в строку не взят, хотя он есть: сразу под ней стоит состояние
 * сервера, где эти цифры и место, и смысл — а в чате сервер сыплет не счётом,
 * он называет карту.
 *
 * Сервер молчит или адрес ещё не вписан — строка работает и тогда: без карты
 * остаётся правило мода, верное в любую минуту.
 */
$liveMap = !empty($info['online']) && !empty($info['map']) ? $info['map'] : '';
?>

<?php /* ⚠️ ВНУТРЬ .chat-line НЕ ДОБАВЛЯЙТЕ ЭЛЕМЕНТОВ. Это inline-flex с gap: 9px, и каждый
         лишний <span> — например, чтобы выделить карту красным, как ^x04 в чате, — станет
         отдельным элементом полосы: посреди фразы появится дыра в девять пикселей, а
         перенос строки случится не там, где кончилось слово. Красная здесь только метка. */ ?>
<p class="chat-line">
  <span class="tag">[Вспышка эпидемии]</span>
  <?php if ($liveMap !== ''): ?>
    Сейчас на карте <?= h($liveMap) ?>. Первый зомби — по жребию.
  <?php else: ?>
    Первый зомби — по жребию, остальным бежать.
  <?php endif; ?>
</p>

<section class="hero">
  <div class="hero-text">
    <h1 class="hero-title"><?= h($site['title']) ?></h1>
    <?php /* Подзаголовок набран моноширинным вразрядку (.2em), и длинная фраза в нём
             рассыпается на две строки уже на телефоне. Полное «Counter-Strike 1.6» и так
             стоит в шапке над названием — здесь хватает короткого. */ ?>
    <p class="hero-sub">Зомби-мод для CS 1.6</p>

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
  <?php /* Класса .btn в новом оформлении нет — под лентой новостей такая же простая ссылка. */ ?>
  <p style="margin-top:22px"><a class="more" href="privileges.php">Смотреть подробно →</a></p>
</section>

<?php
/*
 * Новостей нет вовсе — секции нет тоже.
 *
 * Пустая рубрика хуже её отсутствия: заголовок «Новости» над пустым местом
 * говорит посетителю, что сервер заброшен, — а это ровно противоположно тому,
 * зачем лента здесь заведена. Сразу после установки, пока владелец не написал
 * ни строчки, главная должна выглядеть законченной.
 */
if ($news): ?>
  <section class="section">
    <h2>Новости</h2>
    <div class="news">
      <?php foreach ($news as $n): ?>
        <article class="news-item">
          <?php /* published_at у видимой новости всегда заполнен — так её и отбирает news_latest(). */ ?>
          <div class="news-date"><?= h(date('d.m.Y', strtotime($n['published_at']))) ?></div>
          <h3 class="news-title"><?= h($n['title']) ?></h3>
          <?php /* Тело хранится обычным текстом; разметку из него собирает news_html(), она же и экранирует. */ ?>
          <div class="news-body"><?= news_html($n['body']) ?></div>
        </article>
      <?php endforeach; ?>
    </div>
    <p style="margin-top:22px"><a class="more" href="news.php">Все новости →</a></p>
  </section>
<?php endif; ?>

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
