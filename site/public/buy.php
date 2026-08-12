<?php
/**
 * Оформление заказа: уровень привилегии, админка или кредиты.
 *
 * Заказ — ровно один товар. Админка продаётся отдельно от уровня и своим
 * сроком: пока флажок «плюс админка» жил внутри заказа уровня, в одной строке
 * оказывались два разных срока, и выдавать их приходилось на глаз.
 *
 * Заказ создаётся ТОЛЬКО по POST: заведённый переходом по ссылке заводился бы
 * и поисковым роботом, и любым, кто перешлёт ссылку в чат. После создания —
 * либо переход в кассу, либо страница с номером заказа и реквизитами.
 *
 * Здесь же единственная защита от заваливания базы мусором: считаем, сколько
 * заказов пришло с адреса за час.
 */

require __DIR__ . '/_boot.php';
require_once ZM_APP . '/view.php';

send_security_headers();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    redirect('index.php');
}

$errors = array();

// Вид товара берём только из перечня: незнакомое значение — это «tier», а не
// повод искать цену там, где её нет.
$kindOf = isset($_POST['kind_of']) ? (string)$_POST['kind_of'] : '';
if ($kindOf !== 'packs' && $kindOf !== 'admin') {
    $kindOf = 'tier';
}
$kind     = isset($_POST['kind']) && $_POST['kind'] === 'steamid' ? 'steamid' : 'nick';
$auth     = post_str('auth', 64);
$contact  = post_str('contact', 190);

$tier = null;
$tierId = null;
$days = 0;
$packsTotal = 0;
$amount = null;

if ($kindOf === 'tier') {
    $tierId = post_str('tier', 16);
    $days   = isset($_POST['days']) ? (int)$_POST['days'] : -1;

    $tier = tier_by_id($tierId);
    if ($tier === null || !$tier['sold']) {
        $errors[] = 'такой уровень не продаётся';
    }
    if (!array_key_exists($days, terms())) {
        $errors[] = 'такого срока нет';
    }
    $amount = price_of($tierId, $days);
    if ($amount === null && !$errors) {
        $errors[] = 'для этого уровня такой срок не продаётся';
    }
} elseif ($kindOf === 'admin') {
    // Сроки и цены админки — свои: admin_terms() и admin_price_of(). Взять
    // здесь terms() и цены уровня значило бы продать срок, которого у админки
    // нет, а выдать его потом всё равно нечем.
    $days = isset($_POST['days']) ? (int)$_POST['days'] : -1;
    if (!array_key_exists($days, admin_terms())) {
        $errors[] = 'такого срока нет';
    }
    $amount = admin_price_of($days);
    if ($amount === null && !$errors) {
        $errors[] = 'админка на такой срок не продаётся';
    }
    // Ключ покупателя тут такой же, как у уровня, — ник ЛИБО SteamID. Админка
    // ложится в базу и ждёт игрока сама, живым на сервере он быть не обязан.
} else {
    // Кредиты покупаются только по нику: команда сервера обращается к живому
    // игроку, а живого игрока он знает по имени, а не по SteamID.
    $kind = 'nick';
    $pack = pack_by_id(post_str('pack', 16));
    if ($pack === null) {
        $errors[] = 'такого набора нет';
    } else {
        $packsTotal = $pack['packs'] + $pack['bonus'];
        $amount = $pack['price'];
    }
}

if ($auth === '') {
    $errors[] = $kind === 'steamid' ? 'впишите SteamID' : 'впишите ник';
} else {
    // Длину меряем в БАЙТАХ: движок держит имя в 31 байте, русская буква
    // занимает два. Не проверить здесь — значит продать привилегию на ник,
    // который в игре обрежется и никогда не совпадёт с записью.
    $bad = check_admin($auth, '', 'a', account_flags($kind === 'steamid', false));
    foreach ($bad as $b) {
        // Про пароль и флаги игрок ничего не вводил — эти претензии не к нему.
        if (strpos($b, 'парол') === false && strpos($b, 'флаги') === false) {
            $errors[] = $b;
        }
    }
}

// Слишком много заказов с одного адреса за час — это либо ошибка, либо
// нарочно. Порог высокий: человек может передумать и оформить заново.
if (!$errors) {
    $recent = (int)q_val(
        'SELECT COUNT(*) FROM zm_orders WHERE ip = ? AND created_at > (NOW() - INTERVAL 1 HOUR)',
        array(client_ip())
    );
    if ($recent >= 15) {
        $errors[] = 'слишком много заказов подряд — подождите час или напишите нам';
    }
}

$order = null;
if (!$errors) {
    q(
        'INSERT INTO zm_orders
            (created_at, auth, is_steamid, kind, tier, days, packs, with_admin, amount, currency, contact, provider, status, ip)
         VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        array(
            $auth,
            $kind === 'steamid' ? 1 : 0,
            $kindOf,
            // Уровень есть только у заказа уровня: у админки и у кредитов в
            // этом столбце NULL, а не пустая строка — пустую строку потом не
            // отличить от «уровень стёрли».
            $kindOf === 'tier' ? $tierId : null,
            $days,
            $packsTotal,
            // with_admin остался ради истории старых заказов, где админка шла
            // довеском к уровню. Новые заказы всегда пишут сюда 0: админка
            // теперь отдельный заказ со своим kind и своим сроком.
            0,
            $amount,
            (string)cfg('payment.freekassa.currency', 'RUB'),
            $contact,
            payment_provider(),
            'new',
            client_ip(),
        )
    );

    $order = q_row('SELECT * FROM zm_orders WHERE id = ?', array((int)db()->lastInsertId()));

    $url = payment_redirect_url($order);
    if ($url !== null) {
        redirect($url);
    }
}

$site = cfg('site');
page_head($errors ? 'Заказ не принят' : 'Заказ №' . (int)$order['id'], '');
?>

<section class="lead">
  <h1><?= $errors ? 'Заказ не принят' : 'Заказ принят' ?></h1>
</section>

<?php if ($errors): ?>

  <section class="card" style="max-width:640px">
    <span class="label">Что не так</span>
    <div class="errors">
      <ul><?php foreach ($errors as $e): ?><li><?= h($e) ?></li><?php endforeach; ?></ul>
    </div>
    <p class="hint" style="margin-top:18px"><a href="<?= $kindOf === 'packs' ? 'shop.php' : 'privileges.php' ?>">← вернуться и поправить</a></p>
  </section>

<?php else: ?>

  <section class="card big-ok" style="max-width:640px">
    <span class="label">Заказ №<?= (int)$order['id'] ?></span>

    <div class="bill" style="margin-bottom:6px">
      <?php if ($kindOf === 'tier'): ?>
        <div class="row"><span>уровень</span><b><?= h($tier['name']) ?></b></div>
        <div class="row"><span>срок</span><b><?= h(terms()[$days]['label']) ?></b></div>
      <?php elseif ($kindOf === 'admin'): ?>
        <div class="row"><span>товар</span><b>админка</b></div>
        <div class="row"><span>срок</span><b><?= h(admin_terms()[$days]['label']) ?></b></div>
      <?php else: ?>
        <div class="row"><span>кредитов</span><b><?= (int)$packsTotal ?></b></div>
      <?php endif; ?>
      <div class="row"><span><?= $kind === 'steamid' ? 'SteamID' : 'ник' ?></span><b><?= h($auth) ?></b></div>
      <div class="total">
        <span class="label" style="margin:0">к оплате</span>
        <span class="sum"><?= (int)$amount ?> ₽</span>
      </div>
    </div>

    <?php if (!empty($site['manual_requisites'])): ?>
      <span class="label" style="margin-top:24px">Куда переводить</span>
      <div class="pair">
        <code><?= h($site['manual_requisites']) ?></code>
        <button class="copy" type="button" data-copy="<?= h($site['manual_requisites']) ?>">копировать</button>
      </div>
    <?php endif; ?>

    <?php
    // Что именно мы сделаем после оплаты — по строке на вид заказа. Считаем
    // заранее, а не тройным «?:» внутри разметки: вложенные тернарники в PHP 7.4
    // требуют скобок и читаются как загадка.
    $promise = 'выдадим привилегию';
    if ($kindOf === 'packs') {
        $promise = 'начислим кредиты';
    } elseif ($kindOf === 'admin') {
        $promise = 'выдадим админку';
    }
    ?>
    <?php /* big-steps — крупнее и с воздухом: это единственное, что человеку
             осталось сделать после оплаты, и читать он это будет один раз. */ ?>
    <ol class="steps big-steps">
      <li>Переведите <b><?= (int)$amount ?> ₽</b><?= empty($site['manual_requisites']) ? ' по реквизитам, которые мы пришлём' : '' ?>.</li>
      <li>В комментарии к переводу укажите <b>номер заказа <?= (int)$order['id'] ?></b> — по нему мы вас найдём.</li>
      <li>Напишите нам<?php
        $l = array();
        if (!empty($site['contact']['vk'])) { $l[] = '<a href="' . h($site['contact']['vk']) . '">ВКонтакте</a>'; }
        if (!empty($site['contact']['telegram'])) { $l[] = '<a href="' . h($site['contact']['telegram']) . '">Telegram</a>'; }
        echo $l ? ' (' . implode(' или ', $l) . ')' : '';
      ?>, и мы <?= $promise ?>.</li>
      <?php /*
        Шаг «зайдите на сервер» — только для кредитов: их начисляет команда
        живому игроку, и без него начислять некому. Уровень и админка ложатся
        в базу и ждут игрока сами — звать его на сервер незачем.
      */ ?>
      <?php if ($kindOf === 'packs'): ?>
        <li><b>Зайдите на сервер</b> и оставайтесь на нём — кредиты начисляются игроку, который сейчас в игре.</li>
      <?php endif; ?>
    </ol>

    <p class="note"><?= h($site['manual_note']) ?></p>
    <p class="hint" style="margin-top:18px"><a href="index.php">← на главную</a></p>
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
