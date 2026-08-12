<?php
/**
 * Редактор новостей: написать, сохранить, показать на сайте.
 *
 * Отдельная страница, а не раздел соседней панели, и причина не в объёме кода.
 * Панель выдачи целиком живёт на JSON-запросах и перерисовке списка, а здесь
 * главный орган — большой textarea с текстом на несколько абзацев. Отправлять
 * его через fetch значит держать набранное в памяти вкладки: оборвалась сеть,
 * закрылась вкладка — и текста нет нигде. Обычная форма POST этим не болеет,
 * браузер сам помнит введённое.
 *
 * ⚠️ После КАЖДОГО действия — перенаправление на себя же. Без него обновление
 * страницы повторяет отправку: на сайте заводится вторая такая же новость, а
 * повторённое «удалить» сносит уже другую запись.
 *
 * Тело новости лежит в базе обычным текстом (см. private/app/news.php), и здесь
 * оно нигде не превращается в HTML: ни в форме, ни в списке. Разметку собирает
 * news_html() при показе на сайте — и собирает её из уже экранированного текста.
 */

require __DIR__ . '/../_boot.php';
require_once ZM_APP . '/auth.php';
require_once ZM_APP . '/csrf.php';
require_once ZM_APP . '/news.php';

// Вход проверяем ДО всякого вывода: ниже начнётся разметка, а после первой
// напечатанной строки ни перенаправить, ни поставить заголовок уже нельзя.
require_admin();
send_security_headers();

$me = current_admin();

/** Столько знаков держит title в базе — VARCHAR(120), больше не влезет. */
const NEWS_TITLE_MAX = 120;

/** И столько байт держит body — TEXT. Именно байт, см. news_do_save(). */
const NEWS_BODY_BYTES = 65000;

// ── сообщение, переживающее перенаправление ─────────────────────────────────

/*
 * Между действием и показом страницы стоит перенаправление, а оно не оставляет
 * от запроса ничего. Складываем в сессию — её и так открыл require_admin().
 *
 * Вместе с сообщением кладём ЧЕРНОВИК: отказ без него значил бы, что набранный
 * текст остался только в истории браузера, а «назад» после перенаправления
 * возвращает не форму, а список.
 */
function news_flash_put($flash)
{
    $_SESSION['news_flash'] = $flash;
}

/** Забрать и стереть: сообщение показывается один раз, а не до конца сессии. */
function news_flash_take()
{
    $flash = isset($_SESSION['news_flash']) ? $_SESSION['news_flash'] : null;
    unset($_SESSION['news_flash']);
    return $flash;
}

/**
 * Дата для панели: «12.08.2026 14:30».
 *
 * Цифрами, а не словами, как в архиве: там дата — часть текста и читается
 * фразой, здесь она стоит в узкой колонке столбиком под такими же датами.
 * Секунд нет — важен день, а не мгновение.
 */
function news_when($sqlDate)
{
    $ts = strtotime((string)$sqlDate);
    return $ts === false ? '' : date('d.m.Y H:i', $ts);
}

// ── действия ────────────────────────────────────────────────────────────────

/**
 * Сохранить написанное в форме. $id === 0 — завести новую.
 *
 * ⚠️ Заголовок режем ЗДЕСЬ, на входе, а не оставляем это базе: в строгом режиме
 * MySQL слишком длинную строку не подрежет, а откажется писать запись целиком —
 * владелец увидел бы пустую страницу вместо новости и потерял бы набранное.
 * news_save() режет его вторым рубежом, для всякого, кто её позовёт; но сказать
 * человеку, что заголовок обрезан, может только страница.
 */
function news_do_save($id, $author)
{
    $title = post_str('title', 400);
    $cut   = mb_strlen($title) > NEWS_TITLE_MAX;
    if ($cut) {
        $title = mb_substr($title, 0, NEWS_TITLE_MAX);
    }

    // ⚠️ TEXT — это 65535 БАЙТ, а не символов, а русская буква занимает в UTF-8
    // два. Считать здесь символами значило бы пропустить вдвое больше, чем
    // влезает. mb_strcut режет по байтам, но не разваливает букву пополам, как
    // сделал бы substr — битый UTF-8 в базе хуже обрезанного текста.
    $body = mb_strcut(post_str('body', NEWS_BODY_BYTES), 0, NEWS_BODY_BYTES);

    if ($title === '') {
        news_flash_put(array(
            'bad'   => array('без заголовка новость не сохранить — по нему её находят и в панели, и в ленте'),
            'draft' => array('id' => (int)$id, 'title' => $title, 'body' => $body),
        ));
        return;
    }

    /*
     * Правим новость, которой уже нет: её могли удалить из соседней вкладки или
     * со второго компьютера. UPDATE в этом случае не тронет ни одной строки и
     * промолчит — набранный текст исчез бы бесследно. Поэтому сохраняем его
     * новой записью и говорим об этом вслух.
     */
    $note = '';
    if ($id > 0 && news_by_id($id) === null) {
        $id   = 0;
        $note = 'Новость, которую вы правили, кто-то удалил — текст сохранён как новая. ';
    }

    $isNew = ((int)$id === 0);
    $newId = news_save($id, $title, $body, $author);

    // ⚠️ target в журнале — VARCHAR(31), заголовок туда не влезет и записи не
    // будет вовсе. Номер влезает всегда, а заголовок кладём в detail: после
    // удаления журнал — единственное место, где он ещё останется.
    audit('news_save', '#' . $newId, array('title' => $title, 'new' => $isNew));

    news_flash_put(array('note' => $note
        . ($isNew
            ? 'Сохранено черновиком: на сайте новость появится после «опубликовать».'
            : 'Правка сохранена.')
        . ($cut ? ' Заголовок был длиннее ' . NEWS_TITLE_MAX . ' знаков и обрезан.' : '')));
}

/**
 * Показать новость на сайте либо вернуть её в черновики.
 *
 * ⚠️ Повторная публикация ставит СВЕЖУЮ дату и поднимает новость в начало
 * ленты: published_at отвечает и за видимость, и за порядок (почему так — в
 * заголовке private/app/news.php). Снял, поправил запятую, вернул — и новость
 * снова первая на главной, хотя написана была месяц назад.
 */
function news_do_publish($id, $on)
{
    $item = news_by_id($id);
    if ($item === null) {
        news_flash_put(array('bad' => array('такой новости уже нет — её удалили, пока страница была открыта')));
        return;
    }

    news_publish($id, $on);
    audit('news_publish', '#' . (int)$id, array('title' => $item['title'], 'on' => $on ? 1 : 0));

    news_flash_put(array('note' => $on
        ? 'Новость на сайте — и она первая в ленте на главной.'
        : 'Новость снята с сайта. Текст цел, её просто не видно.'));
}

/**
 * Удалить насовсем. Корзины нет — так решено в private/app/news.php.
 *
 * Заголовок читаем ДО удаления: после него он не восстановится ниоткуда, а
 * строка журнала без него говорила бы только «удалили новость №7».
 */
function news_do_delete($id)
{
    $item = news_by_id($id);
    if ($item === null) {
        news_flash_put(array('bad' => array('такой новости уже нет — видимо, её удалили в другой вкладке')));
        return;
    }

    news_delete($id);
    audit('news_delete', '#' . (int)$id, array('title' => $item['title']));

    news_flash_put(array('note' => 'Новость удалена. Вернуть её нечем — но заголовок остался в журнале.'));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    /*
     * ⚠️ csrf_guard() при отказе отвечает JSON-ом: он общий с api.php. Для
     * страницы с обычными формами это выглядит нелепо, но увидеть такой ответ
     * может только подделка — у вошедшего ключ на месте, а истёкший вход уводит
     * на login.php ещё раньше, в require_admin().
     */
    csrf_guard(isset($_POST['csrf']) ? $_POST['csrf'] : '');

    $do = post_str('do', 16);
    $id = isset($_POST['id']) ? (int)$_POST['id'] : 0;

    if ($do === 'save') {
        news_do_save($id, $me['login']);
    } elseif ($do === 'publish') {
        // Нажатие «опубликовать» и «скрыть» — одно действие с разным «on»: два
        // отдельных действия разъехались бы первой же правкой одного из них.
        news_do_publish($id, isset($_POST['on']) && $_POST['on'] === '1');
    } elseif ($do === 'delete') {
        news_do_delete($id);
    }

    // На себя же и БЕЗ ?edit: после сохранения форма должна быть пустой, иначе
    // следующая новость пишется поверх только что сохранённой.
    redirect('news.php');
}

header('Content-Type: text/html; charset=utf-8');

$flash = news_flash_take();
$items = news_all();

/*
 * Что показывает форма. Черновик из неудавшейся отправки важнее ?edit: иначе
 * набранный текст потерялся бы ради того, что и так лежит в базе.
 *
 * ?edit с чужим или уже удалённым номером даёт пустую форму, а не отказ:
 * заводить новость — то же самое действие, и незачем гнать человека обратно.
 */
$edit = null;
if ($flash !== null && !empty($flash['draft'])) {
    $edit = $flash['draft'];
} elseif (isset($_GET['edit'])) {
    $edit = news_by_id((int)$_GET['edit']);
}

$formId    = $edit ? (int)$edit['id'] : 0;
$formTitle = $edit ? (string)$edit['title'] : '';
$formBody  = $edit ? (string)$edit['body'] : '';
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>Новости</title>
<style>
/*
 * Одежда та же, что у панели выдачи: те же переменные, те же классы. Страницы
 * стоят рядом и переходят одна в другую ссылками в шапке — разъедься их вид,
 * и переход читался бы как уход на чужой сайт.
 */
:root {
  --void:    #12130f;
  --panel:   #1a1c16;
  --raise:   #22251d;
  --rule:    #2f3327;
  --bone:    #e9e7dc;
  --dim:     #848a76;
  --amber:   #ffc21f;
  --crimson: #d8402f;
  --green:   #7fb069;

  --display: "Bahnschrift", "Franklin Gothic Medium", "Arial Narrow", sans-serif;
  --mono: "Cascadia Mono", Consolas, "Courier New", monospace;
  --text: "Segoe UI", system-ui, sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 28px 20px 64px;
  background: var(--void);
  color: var(--bone);
  font: 14px/1.55 var(--text);
  -webkit-font-smoothing: antialiased;
}

.wrap { max-width: 1180px; margin: 0 auto; }

header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }

.eyebrow { font: 500 11px/1 var(--mono); letter-spacing: .22em; text-transform: uppercase; color: var(--dim); }

h1 { margin: 8px 0 6px; font: 600 clamp(30px, 5vw, 44px)/1 var(--display); letter-spacing: .01em; text-transform: uppercase; }

.subhead { font: 12px/1.7 var(--mono); color: var(--dim); }

.ghost {
  background: none; border: 1px solid var(--rule); color: var(--dim);
  font: 11px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase;
  padding: 9px 14px; cursor: pointer; text-decoration: none; display: inline-block;
}
.ghost:hover { color: var(--bone); border-color: var(--dim); }

hr.rule { border: 0; border-top: 1px solid var(--rule); margin: 22px 0 26px; }

.card { background: var(--panel); border: 1px solid var(--rule); padding: 22px; }

.label { display: block; font: 600 11px/1 var(--display); letter-spacing: .2em; text-transform: uppercase; color: var(--dim); margin: 0 0 10px; }
.hint { font-size: 12.5px; color: var(--dim); margin: 8px 0 0; }
.field { margin-top: 10px; }
:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

input[type="text"] {
  width: 100%; background: var(--void); border: 1px solid var(--rule); color: var(--bone);
  font: 14px/1 var(--mono); padding: 12px 13px;
}
input[type="text"]::placeholder { color: #5c6152; }
input[type="text"]:focus { border-color: var(--amber); outline: none; }

/*
 * Заголовок набирается моноширинным, как всё остальное в панели, а тело —
 * обычным: это проза на несколько абзацев, и мерить её глазом в моноширинном
 * шрифте неудобно ровно настолько же, насколько удобно мерить им флаги.
 * Ширина строки ограничена — строка во весь экран читается вдвое хуже.
 */
textarea {
  width: 100%; min-height: 320px; resize: vertical;
  background: var(--void); border: 1px solid var(--rule); color: var(--bone);
  font: 15px/1.6 var(--text); padding: 13px; max-width: 82ch;
}
textarea::placeholder { color: #5c6152; }
textarea:focus { border-color: var(--amber); outline: none; }

.go {
  margin-top: 26px; background: var(--amber); border: 0; color: var(--void);
  font: 600 14px/1 var(--display); letter-spacing: .16em; text-transform: uppercase;
  padding: 16px 34px; cursor: pointer;
}
.go:hover { background: #ffd45c; }

.errors { margin-top: 18px; border-left: 3px solid var(--crimson); padding: 10px 14px; background: rgba(216,64,47,.08); font-size: 13px; }
.errors ul { margin: 0; padding-left: 18px; }

/* Удавшееся действие говорит тем же местом, что и неудавшееся, только жёлтым:
   искать ответ на нажатие в двух разных углах страницы никто не станет. */
.note { margin-top: 18px; border-left: 3px solid var(--amber); padding: 10px 14px; background: rgba(255,194,31,.07); font-size: 13px; color: var(--dim); }

/* ── таблица ─────────────────────────────────────────────────────────────── */

/* Таблица уезжает внутри своей рамки, а не растягивает страницу: заголовки
   новостей длинные, и на узком экране они вытолкнули бы кнопки за край. */
#list { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; margin-top: 14px; min-width: 640px; }
th {
  text-align: left; font: 600 10.5px/1 var(--display); letter-spacing: .18em; text-transform: uppercase;
  color: var(--dim); padding: 0 12px 10px 0; border-bottom: 1px solid var(--rule); white-space: nowrap;
}
td { padding: 13px 12px 13px 0; border-bottom: 1px solid var(--rule); font: 13px/1.4 var(--mono); vertical-align: top; }
tr:hover td { background: var(--raise); }
td.who { color: var(--bone); word-break: break-word; font: 14px/1.4 var(--text); }
td:last-child, th:last-child { padding-right: 0; text-align: right; white-space: nowrap; }

/* Строка, которая сейчас в форме: без метки легко дописать правку не в ту
   новость — в списке они выглядят одинаково. */
tr.editing td { background: var(--raise); }
tr.editing td:first-child { box-shadow: inset 3px 0 0 var(--amber); }

.badge {
  display: inline-block; border: 1px solid var(--amber); color: var(--amber);
  font: 11px/1 var(--mono); padding: 5px 9px; letter-spacing: .04em; white-space: nowrap;
}
.badge.wait { border-color: var(--dim); color: var(--dim); }

.act {
  background: none; border: 1px solid var(--rule); color: var(--dim);
  font: 11px/1 var(--mono); padding: 8px 10px; cursor: pointer; margin-left: 6px;
}
.act:hover { color: var(--bone); border-color: var(--dim); }
.act.kill:hover { color: var(--crimson); border-color: var(--crimson); }
.act.show:hover { color: var(--green); border-color: var(--green); }

/* «Править» — ссылка, а не кнопка: она ничего не меняет, и открыть её в новой
   вкладке нормально. Оттого .act и приходится учить выглядеть ссылкой. */
a.act { text-decoration: none; display: inline-block; }

/* Каждая кнопка действия — своя форма (вложить форму в форму нельзя), а формы
   блочные: без этого три кнопки встали бы столбиком. */
td form { display: inline; }

.empty { padding: 26px 0 6px; color: var(--dim); font-size: 13.5px; }
.foot { margin-top: 34px; font: 12px/1.7 var(--mono); color: #5c6152; }
</style>
</head>
<body>
<div class="wrap">

<header>
  <div>
    <div class="eyebrow">Зомби-чума · сервер</div>
    <h1>Новости</h1>
    <div class="subhead">лента на главной и архив берут отсюда</div>
  </div>
  <div style="text-align:right">
    <div class="subhead" style="margin-bottom:8px"><?= h($me['login']) ?></div>
    <a class="ghost" href="index.php">← Выдача привилегий</a>
    <a class="ghost" href="logout.php">Выйти</a>
  </div>
</header>

<hr class="rule">

<section class="card">
  <span class="label"><?= $formId > 0 ? 'Правка новости №' . $formId : 'Новая новость' ?></span>

  <form method="post" action="news.php">
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
    <input type="hidden" name="do" value="save">
    <?php /* Ноль — «завести новую»; так это понимает news_save(). */ ?>
    <input type="hidden" name="id" value="<?= $formId ?>">

    <div class="field">
      <label class="label" for="title">Заголовок</label>
      <?php /* ⚠️ Кавычка в заголовке без h() закрыла бы value= и вынесла остаток
               текста в разметку. maxlength — только удобство: он подсказывает
               браузеру, а режет всё равно сервер, в news_do_save(). */ ?>
      <input type="text" id="title" name="title" maxlength="<?= NEWS_TITLE_MAX ?>" required
             placeholder="о чём новость" value="<?= h($formTitle) ?>" autocomplete="off">
    </div>

    <div class="field">
      <label class="label" for="body">Текст</label>
      <?php /* ⚠️ h() обязателен и здесь: угловая скобка в тексте закрыла бы
               </textarea> раньше времени, и остаток новости стал бы разметкой.
               Текст стоит вплотную к тегу нарочно — браузер съедает первый
               перевод строки сразу после <textarea>, и абзацы поехали бы. */ ?>
      <textarea id="body" name="body" placeholder="пустая строка начинает новый абзац"><?= h($formBody) ?></textarea>
      <p class="hint">
        Обычный текст, как в письме: пустая строка начинает абзац, адреса
        http:// и https:// сами станут ссылками. Теги писать бессмысленно —
        они покажутся буквами, и это нарочно.
      </p>
    </div>

    <button class="go" type="submit">Сохранить</button>
    <?php if ($formId > 0): ?>
      <a class="ghost" style="margin-left:12px" href="news.php">завести новую</a>
    <?php endif; ?>
  </form>

  <?php if ($flash !== null && !empty($flash['bad'])): ?>
    <div class="errors">
      <ul><?php foreach ($flash['bad'] as $bad): ?><li><?= h($bad) ?></li><?php endforeach; ?></ul>
    </div>
  <?php elseif ($flash !== null && !empty($flash['note'])): ?>
    <div class="note"><?= h($flash['note']) ?></div>
  <?php endif; ?>
</section>

<section style="margin-top:34px">
  <span class="label">Все новости</span>
  <div id="list">
    <?php if (!$items): ?>
      <p class="empty">Пока ни одной. Напишите первую — на главной ленты не будет, пока её нет.</p>
    <?php else: ?>
      <table>
        <thead><tr><th>Новость</th><th>Состояние</th><th>Автор</th><th>Написана</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($items as $n): ?>
          <?php
          $nid   = (int)$n['id'];
          $draft = ($n['published_at'] === null);
          ?>
          <tr<?= $nid === $formId ? ' class="editing"' : '' ?>>
            <td class="who">
              <?= h($n['title']) ?>
              <?php /* ⚠️ news_excerpt() отдаёт ТЕКСТ, а не разметку, — в отличие
                       от соседней news_html(). Без h() тело новости попало бы в
                       страницу как есть. */ ?>
              <div class="hint"><?= h(news_excerpt($n['body'], 120)) ?></div>
            </td>
            <td>
              <?php if ($draft): ?>
                <span class="badge wait">черновик</span>
              <?php else: ?>
                <span class="badge">на сайте</span>
                <div class="hint"><?= h(news_when($n['published_at'])) ?></div>
              <?php endif; ?>
            </td>
            <td style="color:var(--dim)"><?= h($n['author']) ?></td>
            <td style="color:var(--dim)">
              <?= h(news_when($n['created_at'])) ?>
              <?php if ($n['updated_at'] !== null): ?>
                <div class="hint">правлена <?= h(news_when($n['updated_at'])) ?></div>
              <?php endif; ?>
            </td>
            <td>
              <a class="act" href="?edit=<?= $nid ?>">править</a>

              <form method="post" action="news.php">
                <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
                <input type="hidden" name="do" value="publish">
                <input type="hidden" name="id" value="<?= $nid ?>">
                <input type="hidden" name="on" value="<?= $draft ? '1' : '0' ?>">
                <button class="act<?= $draft ? ' show' : '' ?>" type="submit"><?= $draft ? 'опубликовать' : 'скрыть' ?></button>
              </form>

              <?php /* Спрашиваем перед удалением: один промах мышью по соседней
                       кнопке уносит текст, которого больше нигде нет. */ ?>
              <form method="post" action="news.php"
                    data-confirm="Удалить «<?= h($n['title']) ?>» насовсем? Текст не восстановится.">
                <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
                <input type="hidden" name="do" value="delete">
                <input type="hidden" name="id" value="<?= $nid ?>">
                <button class="act kill" type="submit">удалить</button>
              </form>
            </td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
      <p class="hint">
        «Скрыть» не стирает текст — новость возвращается в черновики. Но вернув
        её на сайт, вы поставите ей свежую дату: она снова окажется первой
        в ленте, потому что дата публикации задаёт и порядок.
      </p>
    <?php endif; ?>
  </div>
</section>

<p class="foot">Новости видит любой посетитель сразу после «опубликовать» — правок никто не подтверждает.</p>

</div>

<script>
"use strict";

/*
 * Подтверждение вешаем на отправку формы, а не на щелчок по кнопке: так вопрос
 * задаётся ровно один раз и ровно той форме, которая уходит на сервер, — хоть
 * мышью, хоть Enter'ом с клавиатуры.
 */
document.addEventListener("submit", e => {
  const ask = e.target.dataset.confirm;
  if (ask && !confirm(ask)) e.preventDefault();
});
</script>
</body>
</html>
