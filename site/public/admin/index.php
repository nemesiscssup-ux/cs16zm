<?php
/**
 * Панель выдачи привилегий.
 *
 * Перенесена с локальной панели (tools/admin-web.html) почти дословно: тот же
 * вид, те же приёмы, та же полоса флагов. Отличий три, и все они от того, что
 * панель переехала из своего компьютера в сеть:
 *
 *   1. вместо ключа в адресной строке — вход по логину и паролю;
 *   2. вместо custom/admins.ini — таблица в базе, которую читает игровой
 *      сервер, поэтому появился СРОК действия;
 *   3. добавились заказы из магазина — их надо подтверждать.
 *
 * Кнопки «закрыть панель» больше нет: закрывать нечего, панель живёт, пока
 * работает сайт. Вместо неё выход.
 */

require __DIR__ . '/../_boot.php';
require_once ZM_APP . '/auth.php';
require_once ZM_APP . '/csrf.php';

require_admin();
send_security_headers();
header('Content-Type: text/html; charset=utf-8');

$me = current_admin();
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>Выдача привилегий</title>
<style>
/*
 * Панель одета в свой сервер: цвета взяты из кодов меню Zombie Plague
 * (\y жёлтый, \r красный, \w белый, \d серый), данные набраны моноширинным —
 * это буквы флагов и строка записи, а не проза. Жёлтый ведёт, красный отвечает
 * только за опасное: снять запись, выдать вход без пароля.
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
.subhead b { color: var(--amber); font-weight: 500; }
.subhead .bad { color: var(--crimson); }
.subhead .good { color: var(--green); }

.ghost {
  background: none; border: 1px solid var(--rule); color: var(--dim);
  font: 11px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase;
  padding: 9px 14px; cursor: pointer; text-decoration: none; display: inline-block;
}
.ghost:hover { color: var(--bone); border-color: var(--dim); }

hr.rule { border: 0; border-top: 1px solid var(--rule); margin: 22px 0 26px; }

.cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; }
@media (min-width: 940px) { .cols { grid-template-columns: minmax(0, 5fr) minmax(0, 4fr); gap: 28px; } }

.card { background: var(--panel); border: 1px solid var(--rule); padding: 22px; }
aside > .card:not([hidden]) + .card { margin-top: 22px; }
@media (min-width: 940px) { aside { position: sticky; top: 24px; align-self: start; } }

.label { display: block; font: 600 11px/1 var(--display); letter-spacing: .2em; text-transform: uppercase; color: var(--dim); margin: 0 0 10px; }
.group + .group { margin-top: 26px; }
.hint { font-size: 12.5px; color: var(--dim); margin: 8px 0 0; }

.seg { display: flex; border: 1px solid var(--rule); width: fit-content; max-width: 100%; flex-wrap: wrap; }
.seg button {
  background: none; border: 0; border-right: 1px solid var(--rule); color: var(--dim);
  font: 12px/1 var(--mono); padding: 10px 16px; cursor: pointer;
}
.seg button:last-child { border-right: 0; }
.seg button[aria-pressed="true"] { background: var(--amber); color: var(--void); font-weight: 600; }
.seg button.danger[aria-pressed="true"] { background: var(--crimson); color: var(--bone); }
.seg button:hover:not([aria-pressed="true"]) { color: var(--bone); }

input[type="text"] {
  width: 100%; background: var(--void); border: 1px solid var(--rule); color: var(--bone);
  font: 14px/1 var(--mono); padding: 12px 13px;
}
input[type="text"]::placeholder { color: #5c6152; }
input[type="text"]:focus { border-color: var(--amber); outline: none; }

.field { margin-top: 10px; }
:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

/* ── уровни ──────────────────────────────────────────────────────────────── */

.tiers { display: grid; gap: 1px; background: var(--rule); border: 1px solid var(--rule); }
.tier { display: flex; align-items: baseline; gap: 12px; background: var(--panel); padding: 13px 15px; cursor: pointer; }
.tier:hover { background: var(--raise); }
.tier input { position: absolute; opacity: 0; width: 0; height: 0; }
.tier .mark { font: 600 13px/1 var(--mono); color: var(--dim); width: 1.2em; }
.tier .nm { font: 600 15px/1.1 var(--display); letter-spacing: .04em; text-transform: uppercase; flex: 1; }
.tier .gives { font: 11.5px/1.3 var(--mono); color: var(--dim); text-align: right; }

@media (max-width: 620px) {
  .tier { flex-wrap: wrap; }
  .tier .nm { flex: 1 0 auto; }
  .tier .gives { width: 100%; text-align: left; padding-top: 6px; }
}
.tier.nosale .gives { color: var(--crimson); }
.tier.nosale:has(input:checked) { box-shadow: inset 3px 0 0 var(--crimson); }
.tier:has(input:checked) { background: var(--raise); box-shadow: inset 3px 0 0 var(--amber); }
.tier:has(input:checked) .mark, .tier:has(input:checked) .nm { color: var(--amber); }
.tier:has(input:focus-visible) { outline: 2px solid var(--amber); outline-offset: -2px; }

.check { display: flex; align-items: center; gap: 10px; margin-top: 12px; cursor: pointer; font-size: 13.5px; }
.check input { accent-color: var(--amber); width: 15px; height: 15px; }

/* ── полоса флагов ───────────────────────────────────────────────────────── */

/* Ровно 21 колонка, одной строкой: это алфавит флагов AMXX целиком, и
   разорванный переносом он читается как случайный набор букв. */
.strip { display: grid; grid-template-columns: repeat(21, minmax(0, 1fr)); gap: 3px; }
.flag {
  min-width: 0; height: 32px; display: grid; place-items: center;
  background: var(--void); border: 1px solid var(--rule); color: #4e5344;
  font: 13px/1 var(--mono); position: relative;
  transition: background .12s linear, color .12s linear, border-color .12s linear;
}
.flag.on { background: var(--amber); border-color: var(--amber); color: var(--void); font-weight: 700; }
.flag.lvl::after {
  content: ""; position: absolute; left: 3px; right: 3px; bottom: -4px;
  height: 2px; background: var(--amber); opacity: .35;
}
.flag.lvl.on::after { opacity: 1; }
@media (max-width: 560px) { .flag { font-size: 11px; height: 28px; } }

.legend { margin: 16px 0 0; font: 12px/1.7 var(--mono); color: var(--dim); }
.legend b { color: var(--bone); font-weight: 400; }

.line {
  margin-top: 20px; padding: 14px 15px; background: var(--void); border: 1px solid var(--rule);
  font: 13px/1.6 var(--mono); word-break: break-all; color: var(--dim);
}
.line .who { color: var(--bone); }
.line .pw { color: var(--dim); }
.line .fl { color: var(--amber); }
.line .hole { color: #4e5344; }

.gives-list { margin: 18px 0 0; padding: 0; list-style: none; font: 12.5px/1.9 var(--mono); color: var(--dim); }
.gives-list b { color: var(--bone); font-weight: 400; }

.go {
  margin-top: 26px; width: 100%; background: var(--amber); border: 0; color: var(--void);
  font: 600 14px/1 var(--display); letter-spacing: .16em; text-transform: uppercase;
  padding: 16px; cursor: pointer;
}
.go:hover { background: #ffd45c; }
.go:disabled { background: var(--rule); color: var(--dim); cursor: default; }

.errors { margin-top: 18px; border-left: 3px solid var(--crimson); padding: 10px 14px; background: rgba(216,64,47,.08); font-size: 13px; }
.errors ul { margin: 0; padding-left: 18px; }

.warn { margin-top: 12px; border-left: 3px solid var(--crimson); padding: 8px 13px; font-size: 12.5px; color: #f0a79c; background: rgba(216,64,47,.07); }

.done { border-color: var(--amber); }
.done .label { color: var(--amber); }

.pair { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.pair code {
  flex: 1; background: var(--void); border: 1px solid var(--rule); padding: 11px 13px;
  font: 13px/1.4 var(--mono); word-break: break-all; color: var(--bone);
}
.copy {
  background: none; border: 1px solid var(--rule); color: var(--dim);
  font: 11px/1 var(--mono); padding: 11px 12px; cursor: pointer; white-space: nowrap;
}
.copy:hover { color: var(--amber); border-color: var(--amber); }

.step { margin-top: 20px; font-size: 13px; }
.step .label { margin-bottom: 6px; }

/* ── таблицы ─────────────────────────────────────────────────────────────── */

/* Таблица уезжает внутри своей рамки, а не растягивает всю страницу: колонок
   моноширинного текста больше, чем влезает в узкий экран, — а в ростере их
   стало на одну больше с тех пор, как у админки завёлся свой срок. */
#roster, #orders { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; margin-top: 14px; min-width: 560px; }
th {
  text-align: left; font: 600 10.5px/1 var(--display); letter-spacing: .18em; text-transform: uppercase;
  color: var(--dim); padding: 0 12px 10px 0; border-bottom: 1px solid var(--rule); white-space: nowrap;
}
td { padding: 13px 12px 13px 0; border-bottom: 1px solid var(--rule); font: 13px/1.4 var(--mono); vertical-align: middle; }
tr:hover td { background: var(--raise); }
td.who { color: var(--bone); word-break: break-all; }
td:last-child, th:last-child { padding-right: 0; text-align: right; white-space: nowrap; }

.badge {
  display: inline-block; border: 1px solid var(--amber); color: var(--amber);
  font: 11px/1 var(--mono); padding: 5px 9px; letter-spacing: .04em; white-space: nowrap;
}
.badge.none { border-color: var(--rule); color: var(--dim); }
.badge.full { background: var(--amber); color: var(--void); font-weight: 700; }
.badge.dead { border-color: var(--crimson); color: var(--crimson); }
.badge.wait { border-color: var(--dim); color: var(--dim); }
.badge.money { border-color: var(--green); color: var(--green); }

.pw-cell { color: var(--dim); cursor: pointer; }
.pw-cell:hover { color: var(--bone); }
.pw-cell.no { color: var(--crimson); cursor: default; }

.term { color: var(--dim); white-space: nowrap; }
.term.soon { color: var(--amber); }
.term.dead { color: var(--crimson); }
.term.forever { color: var(--bone); }

.act {
  background: none; border: 1px solid var(--rule); color: var(--dim);
  font: 11px/1 var(--mono); padding: 8px 10px; cursor: pointer; margin-left: 6px;
}
.act:hover { color: var(--bone); border-color: var(--dim); }
.act.kill:hover { color: var(--crimson); border-color: var(--crimson); }
.act.pay:hover { color: var(--green); border-color: var(--green); }

.empty { padding: 26px 0 6px; color: var(--dim); font-size: 13.5px; }
.foot { margin-top: 34px; font: 12px/1.7 var(--mono); color: #5c6152; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<div class="wrap">

<header>
  <div>
    <div class="eyebrow">Зомби-чума · сервер</div>
    <h1>Выдача привилегий</h1>
    <div class="subhead" id="where">пишет в базу, игровой сервер читает её сам</div>
  </div>
  <div style="text-align:right">
    <div class="subhead" style="margin-bottom:8px"><?= h($me['login']) ?></div>
    <a class="ghost" href="news.php">Новости</a>
    <button class="ghost" id="ping" type="button">Проверить сервер</button>
    <a class="ghost" href="logout.php">Выйти</a>
  </div>
</header>

<hr class="rule">

<div class="cols">

  <section class="card">

    <div class="group">
      <span class="label">Кому</span>
      <div class="seg" id="kind">
        <button type="button" data-v="nick" aria-pressed="true">по нику</button>
        <button type="button" data-v="steamid" aria-pressed="false">по SteamID</button>
      </div>
      <div class="field"><input type="text" id="who" placeholder="ник как в игре" autocomplete="off" spellcheck="false"></div>
      <p class="hint" id="who-hint">Ник надёжен, пока рядом стоит пароль: без него права заберёт любой, кто напишется так же.</p>
    </div>

    <div class="group">
      <span class="label">Уровень</span>
      <div class="tiers" id="tiers"></div>
      <label class="check"><input type="checkbox" id="admin-sold"> Плюс админка — кик, бан до 30 минут, чат и админ-меню</label>
      <!-- Свой переключатель срока, а не общий с уровнем: у админки отдельный
           столбец в базе и отдельный срок, и продление уровня его не двигает.
           Спрятан, пока флажок не нажат: пустой ряд кнопок без товара сбивает. -->
      <div class="field" id="admin-days-wrap" hidden>
        <div class="seg" id="admin-days"></div>
        <p class="hint">Срок админки считается отдельно от срока уровня — их и покупают порознь.</p>
      </div>
      <label class="check"><input type="checkbox" id="admin-full"> Плюс ПОЛНЫЕ права — всё, включая rcon (только себе)</label>
      <label class="check"><input type="checkbox" id="custom-on"> Свои флаги, без уровней</label>
      <div class="field" id="custom-wrap" hidden>
        <input type="text" id="custom" placeholder="например: tsqo" autocomplete="off" spellcheck="false">
      </div>
    </div>

    <div class="group">
      <span class="label">На какой срок</span>
      <div class="seg" id="days"></div>
      <p class="hint">
        Это срок <b>уровня</b>: у админки свой, рядом с её флажком.
        Срок считает база, а не плагин: просроченная запись просто перестаёт попадать серверу.
        Выдача поверх действующей <b>прибавляет</b> срок к остатку.
      </p>
    </div>

    <div class="group">
      <span class="label">Как входить</span>
      <div class="seg" id="pw-mode">
        <button type="button" data-v="auto" aria-pressed="true">придумать за меня</button>
        <button type="button" data-v="manual" aria-pressed="false">свой пароль</button>
        <button type="button" data-v="none" aria-pressed="false" class="danger">без пароля</button>
      </div>
      <div class="field" id="pw-wrap" hidden>
        <input type="text" id="password" placeholder="пароль для игрока" autocomplete="off" spellcheck="false">
      </div>
      <div class="warn" id="pw-warn" hidden>Права получит любой, кто возьмёт это имя. Годится, пока сервер закрыт.</div>
      <p class="hint" id="pw-keep" hidden>У этого игрока уже есть пароль — при продлении он останется прежним.</p>
    </div>

    <button class="go" id="go">Выдать привилегию</button>
    <div class="errors" id="errors" hidden></div>
  </section>

  <aside>
    <section class="card done" id="result" hidden></section>

    <section class="card" id="preview">
      <span class="label">Что запишется</span>
      <div class="strip" id="strip"></div>
      <p class="legend" id="legend"></p>
      <div class="line" id="line"></div>
      <ul class="gives-list" id="gives"></ul>
    </section>
  </aside>

</div>

<section style="margin-top:34px" id="orders-box" hidden>
  <span class="label">Заказы из магазина</span>
  <div id="orders"></div>
</section>

<section style="margin-top:34px">
  <span class="label">Кому уже выдано</span>
  <div id="roster"></div>
</section>

<p class="foot" id="foot"></p>

</div>

<script>
"use strict";

const CSRF = <?= json_encode(csrf_token()) ?>;
const $ = id => document.getElementById(id);

let TIERS = [];
let KNIVES_TOTAL = 0;   // сколько всего ножей в игре — знаменатель строки «ножей N из M»
let TERMS = {};
let ADMIN_TERMS = {};
let ALL = "abcdefghijklmnopqrstu";
let ADMIN = "bcdeiju";
let ADMINS = [];
let NOW = null;
let reveal = new Set();

// days — срок уровня, adminDays — срок админки. Два поля, а не одно: сроки
// живут в базе порознь, и склеить их здесь значило бы врать форме о том, что
// запишется.
const form = {
  kind: "nick", tier: null, admin: false, full: false, custom: false,
  pwMode: "auto", days: 30, adminDays: 30,
};

// ── связь с панелью ─────────────────────────────────────────────────────────

async function api(action, body) {
  const url = "api.php?do=" + encodeURIComponent(action);
  const res = await fetch(url, body === undefined
    ? { credentials: "same-origin" }
    : {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.assign({ csrf: CSRF }, body)),
      });

  // Вход мог истечь, пока вкладка была открыта. Молча показывать «ошибка» тут
  // нельзя: человек будет жать кнопку и не поймёт, почему ничего не выходит.
  if (res.status === 401) {
    location.href = "login.php";
    throw new Error("вход истёк");
  }

  let data = null;
  try { data = await res.json(); } catch { /* ответ без тела — разберём по коду */ }
  if (!res.ok) throw new Error((data && data.error || ["панель ответила " + res.status]).join("\n"));
  return data;
}

// ── что уйдёт в базу ────────────────────────────────────────────────────────

/*
 * Буквы, которые увидит игровой сервер. Админка складывается с уровнем прямо
 * здесь — и полоса ниже подсвечивает её буквы, как раньше, — но в базу они
 * ложатся ОТДЕЛЬНЫМ столбцом admin_access со своим сроком admin_until, а
 * обратно в одну строку их склеивает представление zm_admins.
 *
 * ⚠️ Значит, полоса и строка «Что запишется» — правда ровно до первого
 * истечения: представление подставляет каждую половину, только пока жив её
 * срок. Кончится срок уровня — сервер увидит одни буквы админки, кончится срок
 * админки — одни буквы уровня. Читать полосу как «так будет всегда» нельзя.
 */
function flags() {
  if (form.custom) return ($("custom").value || "").replace(/\s+/g, "").toLowerCase();
  if (form.full) return ALL;
  const set = new Set();
  if (form.tier !== null) TIERS.slice(0, form.tier + 1).forEach(t => set.add(t.letter));
  if (form.admin) ADMIN.split("").forEach(c => set.add(c));
  return [...set].sort().join("");
}

const account = () => (form.kind === "steamid" ? "c" : "") + (form.pwMode === "none" ? "e" : "a");

function drawStrip(on) {
  const marks = new Set(TIERS.map(t => t.letter));
  $("strip").innerHTML = ALL.split("").map(c =>
    `<span class="flag${marks.has(c) ? " lvl" : ""}${on.includes(c) ? " on" : ""}">${c}</span>`).join("");
  $("legend").innerHTML = "черта под буквой — уровень: "
    + TIERS.map(t => `<b>${t.letter}</b> ${t.name}`).join(" · ");
}

// Строка ровно та, что ляжет в базу, и в том же порядке полей, в каком её
// читает сервер: кто, пароль, доступ, флаги записи.
function drawLine(on) {
  const known = ADMINS.find(a => sameKey(a.auth, $("who").value.trim()));
  const pw = form.pwMode === "none" ? `<span class="pw">""</span>`
    : form.pwMode === "auto"
      ? (known && !known.nopass
          ? `<span class="pw">"${esc(known.password)}"</span>`
          : `<span class="hole">"придумается"</span>`)
      : slot("pw", $("password").value, "пароль");

  $("line").innerHTML = slot("who", $("who").value.trim(), "кто") + " " + pw + " "
    + slot("fl", on, "флаги") + ` <span class="pw">"${account()}"</span>`;

  $("pw-keep").hidden = !(known && !known.nopass && form.pwMode === "auto");
}

const slot = (cls, value, name) => value
  ? `<span class="${cls}">"${esc(value)}"</span>`
  : `<span class="hole">"${name}"</span>`;

const termWords = days => (days === 0 ? "навсегда" : `на ${days} дней`);

function drawGives() {
  const t = form.custom || form.full ? highestTier(flags()) : form.tier;
  const rows = [];

  if (t === null || t < 0) {
    rows.push(`<li>Уровень не выбран — игрок останется обычным бойцом.</li>`);
  } else {
    const v = TIERS[t];
    rows.push(
      `<li>уровень <b>${v.name}</b>, <b>${termWords(form.days)}</b></li>`,
      `<li><b>+${v.packs}</b> кредитов и <b>+${v.health}</b> HP на каждом возрождении</li>`,
      // ⚠️ Знаменатель приходит с сервера, а не пишется здесь. Раньше стояло
      // «из 11» — число из той поры, когда ножей было одиннадцать. Их стало
      // пятнадцать, числитель вырос вместе с описью, а знаменатель остался, и
      // при выдаче Фараона панель показывала «ножей 15 из 11».
      `<li>ножей <b>${v.knives}</b> из ${KNIVES_TOTAL || '?'}, облик <b>${v.skin}</b></li>`);
  }

  // Админка идёт отдельной строкой со своим сроком, а не приписывается к
  // уровню: в базе это отдельный столбец, и продление уровня его не двигает.
  // Свои флаги и полные права её не подмешивают — там она и не выдаётся.
  if (form.admin && !form.custom && !form.full) {
    rows.push(`<li>админка — кик, бан, чат и меню, <b>${termWords(form.adminDays)}</b></li>`);
  }

  $("gives").innerHTML = rows.join("");
}

const highestTier = f => TIERS.reduce((best, t, i) => f.includes(t.letter) ? i : best, -1);

// Как сравнивает сервер: складывает регистр ТОЛЬКО у латиницы.
const foldAscii = s => String(s).replace(/[A-Z]/g, c => c.toLowerCase());
const sameKey = (a, b) => foldAscii(a) === foldAscii(b);

function refresh() {
  const on = flags();
  drawStrip(on);
  drawLine(on);
  drawGives();
  $("go").disabled = !on || !$("who").value.trim();
}

// ── форма ───────────────────────────────────────────────────────────────────

function seg(id, onPick) {
  $(id).addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    [...$(id).children].forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    onPick(b.dataset);
  });
}

seg("kind", d => {
  form.kind = d.v;
  $("who").placeholder = d.v === "steamid" ? "STEAM_0:1:12345" : "ник как в игре";
  $("who-hint").textContent = d.v === "steamid"
    ? "SteamID не подделать чужим ником — но сервер пускает и без Steam, а таким игрокам его выдаёт сам. Пароль нужен всё равно."
    : "Ник надёжен, пока рядом стоит пароль: без него права заберёт любой, кто напишется так же.";
  refresh();
});

seg("pw-mode", d => {
  form.pwMode = d.v;
  $("pw-wrap").hidden = d.v !== "manual";
  $("pw-warn").hidden = d.v !== "none";
  refresh();
});

seg("days", d => { form.days = Number(d.days); refresh(); });
seg("admin-days", d => { form.adminDays = Number(d.days); refresh(); });

$("admin-sold").addEventListener("change", e => {
  form.admin = e.target.checked;
  // Ряд сроков появляется только вместе с товаром: кнопки над ненажатым
  // флажком читаются как второй срок уровня, и по ним жмут не глядя.
  $("admin-days-wrap").hidden = !form.admin;
  refresh();
});
$("admin-full").addEventListener("change", e => { form.full = e.target.checked; refresh(); });

$("custom-on").addEventListener("change", e => {
  form.custom = e.target.checked;
  $("custom-wrap").hidden = !form.custom;
  $("tiers").style.opacity = form.custom ? ".4" : "1";
  refresh();
});

["who", "password", "custom"].forEach(id => $(id).addEventListener("input", refresh));
$("who").addEventListener("keydown", e => { if (e.key === "Enter" && !$("go").disabled) grant(); });
$("go").addEventListener("click", grant);

$("ping").addEventListener("click", async () => {
  $("ping").textContent = "проверяю…";
  try {
    const r = await api("rcon", {});
    alert(r.ok
      ? "Игровой сервер ответил. Список админов перечитан.\n\n" + (r.out || "").slice(0, 400)
      : "Не вышло: " + r.error + "\n\nПривилегии всё равно доедут — сервер сам перечитает базу со сменой карты.");
  } catch (err) {
    alert(String(err.message));
  }
  $("ping").textContent = "Проверить сервер";
});

// ── действия ────────────────────────────────────────────────────────────────

async function grant() {
  $("errors").hidden = true;
  $("go").disabled = true;
  try {
    const out = await api("grant", {
      who: $("who").value.trim(),
      kind: form.kind,
      tier: form.custom || form.full ? null : form.tier,
      admin: form.custom || form.full ? false : form.admin,
      full: form.full,
      flagsMode: form.custom ? "custom" : "tier",
      customFlags: $("custom").value,
      days: form.days,
      adminDays: form.adminDays,
      passwordMode: form.pwMode,
      password: $("password").value,
    });
    showResult(out);
    apply(out.state);
  } catch (err) {
    showErrors(String(err.message).split("\n"));
  }
  refresh();
}

async function revoke(who) {
  if (!confirm(`Снять все привилегии с «${who}»?`)) return;
  try {
    const out = await api("revoke", { who });
    apply(out.state);
    $("result").hidden = true;
  } catch (err) {
    showErrors(String(err.message).split("\n"));
  }
}

async function orderPaid(id, who, sum) {
  if (!confirm(`Подтвердить оплату заказа №${id} (${who}, ${sum} ₽) и выдать покупку?`)) return;
  try {
    apply((await api("order_paid", { id })).state);
  } catch (err) {
    showErrors(String(err.message).split("\n"));
  }
}

async function orderDrop(id) {
  if (!confirm(`Отменить заказ №${id}? Привилегия выдана не будет.`)) return;
  try {
    apply((await api("order_drop", { id })).state);
  } catch (err) {
    showErrors(String(err.message).split("\n"));
  }
}

function showErrors(list) {
  $("errors").innerHTML = "<ul>" + list.map(e => `<li>${esc(e)}</li>`).join("") + "</ul>";
  $("errors").hidden = false;
  $("errors").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showResult(out) {
  const t = highestTier(out.access);
  const rows = [];

  if (out.account.includes("e")) {
    rows.push(`<p class="warn" style="margin-top:14px">Пароля нет: права заберёт любой, кто возьмёт это имя.</p>`);
  } else {
    rows.push(pair("Пароль игроку", out.password));
    rows.push(pair("Игрок вводит в консоли один раз", `setinfo _pw "${out.password}"`));
  }

  /*
   * Сроков в ответе два, и печатаются они порознь — по одной строке на живую
   * половину записи.
   *
   * ⚠️ Пустой уровень с expires === null — это НЕ «навсегда», это «уровня нет
   * вовсе»: так выглядит запись, где куплена одна админка. Печатать здесь одно
   * «навсегда» значило бы пообещать вечный уровень, которого не выдавали.
   */
  const untilWords = ts => ts
    ? `до <b>${esc(String(ts).slice(0, 16).replace("T", " "))}</b>`
    : "<b>навсегда</b>";

  const got = [];
  if (out.access) got.push(`${t < 0 ? "свои флаги" : esc(TIERS[t].name)}, ${untilWords(out.expires)}`);
  if (out.admin_access) got.push(`админка, ${untilWords(out.admin_until)}`);

  // Про rcon говорим ровно то, что произошло: молчаливое «выдано» при
  // недоступном сервере — это обещание, которого панель не сдержала.
  const applied = out.reload && out.reload.ok
    ? `<p class="hint">Игровой сервер уже перечитал список — права действуют.</p>`
    : `<p class="warn">Игровой сервер сейчас не отозвался${out.reload && out.reload.error ? ` (${esc(out.reload.error)})` : ""}.
        Привилегия записана и подхватится со сменой карты.</p>`;

  $("result").innerHTML = `
    <span class="label">Выдано${out.replaced ? " · срок продлён" : ""}</span>
    <p style="margin:0;font:15px/1.4 var(--mono);color:var(--bone)">${esc(out.auth)} — ${got.join("; ")}</p>
    ${out.replaced ? `<p class="hint">Было: «${esc(out.replaced.access)}»${out.replaced.expires ? ` до ${esc(String(out.replaced.expires).slice(0, 16))}` : " навсегда"}.</p>` : ""}
    ${out.notice ? `<p class="warn">${esc(out.notice)}</p>` : ""}
    ${rows.join("")}
    ${applied}`;
  $("result").hidden = false;
  $("result").querySelectorAll(".copy").forEach(b => b.addEventListener("click", () => copy(b)));
}

function pair(label, value) {
  return `${label ? `<span class="label" style="margin:16px 0 0">${esc(label)}</span>` : ""}
    <div class="pair"><code>${esc(value)}</code><button class="copy" type="button" data-copy="${esc(value)}">копировать</button></div>`;
}

async function copy(btn) {
  const text = btn.dataset.copy;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const was = btn.textContent;
  btn.textContent = "скопировано";
  setTimeout(() => { btn.textContent = was; }, 1400);
}

// ── отрисовка ───────────────────────────────────────────────────────────────

function apply(state) {
  TIERS = state.tiers;
  KNIVES_TOTAL = state.knivesTotal || 0;
  TERMS = state.terms;
  ADMIN_TERMS = state.adminTerms || state.terms;
  ALL = state.allFlags;
  ADMIN = state.adminFlags || ADMIN;
  ADMINS = state.admins;
  NOW = state.now;

  const rc = state.rcon.enabled
    ? `<span class="good">rcon настроен</span> · ${esc(state.rcon.host)}`
    : `<span class="bad">rcon не настроен</span> — права появятся со сменой карты`;
  const pay = state.payment.ready
    ? `касса <b>${esc(state.payment.provider)}</b>`
    : `<span class="bad">касса не подключена</span> — заказы подтверждаются руками`;
  $("where").innerHTML = `${rc}<br>${pay}`;

  drawTerms();
  drawTiers();
  drawOrders(state.orders);
  drawRoster(state.admins);
  refresh();
}

// Оба ряда сроков рисует одна функция: таблицы у них разные (terms() и
// admin_terms()), а разметка обязана быть одна — иначе две почти одинаковые
// строки кода разойдутся первой же правкой вида кнопок.
function drawTermRow(id, list, picked) {
  $(id).innerHTML = Object.entries(list).map(([days, t]) =>
    `<button type="button" data-days="${days}" aria-pressed="${Number(days) === picked}">${esc(t.label)}</button>`).join("");
}

function drawTerms() {
  drawTermRow("days", TERMS, form.days);
  drawTermRow("admin-days", ADMIN_TERMS, form.adminDays);
}

function drawTiers() {
  $("tiers").innerHTML = TIERS.map((t, i) => `
    <label class="tier${t.sold ? "" : " nosale"}">
      <input type="radio" name="tier" value="${i}"${form.tier === i ? " checked" : ""}>
      <span class="mark">${t.letter}</span>
      <span class="nm">${esc(t.name)}</span>
      <span class="gives">${t.sold
        ? `+${t.packs} кр · +${t.health} HP · ножей ${t.knives} · облик ${t.skin}`
        : "главный админ · не продаётся · открыто всё"}</span>
    </label>`).join("");
  $("tiers").querySelectorAll("input").forEach(r =>
    r.addEventListener("change", () => { form.tier = Number(r.value); refresh(); }));
}

/*
 * Срок словами. «Осталось 0 дней» звучит как «уже нет», поэтому у последних
 * суток свой текст.
 *
 * Одна функция на оба столбца ростера — уровня и админки: сроки у них разные и
 * считаются в базе порознь, а читаться должны одинаково. Разъедься счёт на
 * «жёлтое» — и «3 дн.» в одной колонке значило бы не то же, что в другой.
 *
 * ⚠️ Первый аргумент — есть ли сторона ВООБЩЕ. Без него пусто и «навсегда»
 * сливаются: у записи без уровня expires тоже null, и колонка врала бы про
 * вечный уровень там, где куплена одна админка.
 */
function termCell(has, forever, expired, left) {
  if (!has) return `<span class="term">—</span>`;
  if (forever) return `<span class="term forever">навсегда</span>`;
  if (expired) return `<span class="term dead">истекла</span>`;
  if (left <= 0) return `<span class="term soon">сегодня</span>`;
  if (left <= 3) return `<span class="term soon">${left} дн.</span>`;
  return `<span class="term">${left} дн.</span>`;
}

const tierTerm  = a => termCell(a.access !== "", a.expires === null, a.expired, a.left);
const adminTerm = a => termCell(a.admin, a.adminForever, a.adminExpired, a.adminLeft);

function drawRoster(admins) {
  if (!admins.length) {
    $("roster").innerHTML = `<p class="empty">Пока никого. Впишите ник, выберите уровень — и он появится здесь.</p>`;
    return;
  }
  const rows = admins.map(a => {
    // Значок говорит только про УРОВЕНЬ: про админку рядом стоит своя колонка
    // со своим сроком, и приписка «+админка» здесь была бы вторым, менее
    // точным ответом на тот же вопрос.
    const badge = a.full
      ? `<span class="badge full">полные права</span>`
      : a.tierName
      ? `<span class="badge${a.expired ? " dead" : ""}">${esc(a.tierName)}</span>`
      : a.access !== "" ? `<span class="badge none">свои флаги</span>` : `<span class="badge none">нет</span>`;
    const pw = a.nopass
      ? `<span class="pw-cell no" title="вход без пароля">без пароля</span>`
      : `<span class="pw-cell" data-pw="${esc(a.auth)}">${reveal.has(a.auth) ? esc(a.password) : "••••••••"}</span>`;
    return `<tr>
      <td class="who">${esc(a.auth)}${a.steamid ? ` <span style="color:var(--dim)">· SteamID</span>` : ""}</td>
      <td>${badge}</td>
      <td style="color:var(--amber)">${esc(a.access)}</td>
      <td>${pw}</td>
      <td>${tierTerm(a)}</td>
      <td>${adminTerm(a)}</td>
      <td>
        <button class="act" data-edit="${esc(a.auth)}">изменить</button>
        <button class="act kill" data-kill="${esc(a.auth)}">снять</button>
      </td>
    </tr>`;
  }).join("");

  // «Срок уровня» и «Админка» — два разных срока, и заголовки названы так,
  // чтобы это было видно без пояснений: одинокое «Срок» рядом со второй датой
  // читается как срок всей записи, а такого срока больше нет.
  $("roster").innerHTML = `<table>
    <thead><tr><th>Кто</th><th>Уровень</th><th>Флаги</th><th>Пароль</th>
      <th>Срок уровня</th><th>Админка</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;

  $("roster").querySelectorAll("[data-kill]").forEach(b => b.addEventListener("click", () => revoke(b.dataset.kill)));
  $("roster").querySelectorAll("[data-pw]").forEach(s => s.addEventListener("click", () => {
    reveal.has(s.dataset.pw) ? reveal.delete(s.dataset.pw) : reveal.add(s.dataset.pw);
    drawRoster(admins);
  }));
  $("roster").querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => {
    const a = admins.find(x => x.auth === b.dataset.edit);
    if (a) fill(a);
  }));
}

function drawOrders(orders) {
  $("orders-box").hidden = !orders.length;
  if (!orders.length) return;

  const rows = orders.map(o => {
    const state = o.status === "paid" ? `<span class="badge money">оплачен, не выдан</span>`
      : o.status === "failed" ? `<span class="badge dead">сбой</span>`
      : `<span class="badge wait">ждёт оплаты</span>`;
    // Три товара, и путать их в одной колонке нельзя: у кредитов нет ни
    // уровня, ни срока, а у админки есть срок, но нет уровня.
    //
    // ⚠️ « + админка» у заказа уровня — это ИСТОРИЯ: так продавалось раньше,
    // одним заказом с общим сроком. Новые заказы with_admin не пишут, но
    // старые лежат в базе, и прочитаться они должны как были куплены.
    const packs = o.kind === "packs";
    const what = packs
      ? `<span style="color:var(--amber)">${Number(o.packs)} кредитов</span>`
      : o.kind === "admin"
      ? `<span style="color:var(--amber)">админка</span>`
      : `${esc(o.tier || "")}${Number(o.with_admin) ? " + админка" : ""}`;
    const term = packs ? "—" : (Number(o.days) === 0 ? "навсегда" : `${o.days} дн.`);
    return `<tr>
      <td>№${o.id}</td>
      <td class="who">${esc(o.auth)}${Number(o.is_steamid) ? ` <span style="color:var(--dim)">· SteamID</span>` : ""}</td>
      <td>${what}</td>
      <td>${term}</td>
      <td style="color:var(--amber)">${Math.round(o.amount)} ₽</td>
      <td>${state}${o.error ? `<div class="hint">${esc(o.error)}</div>` : ""}</td>
      <td style="color:var(--dim)">${esc(String(o.created_at).slice(0, 16))}${o.contact ? `<div class="hint">${esc(o.contact)}</div>` : ""}</td>
      <td>
        <button class="act pay" data-paid="${o.id}" data-who="${esc(o.auth)}" data-sum="${Math.round(o.amount)}">выдать</button>
        <button class="act kill" data-drop="${o.id}">отменить</button>
      </td>
    </tr>`;
  }).join("");

  $("orders").innerHTML = `<table>
    <thead><tr><th>Заказ</th><th>Кому</th><th>Что</th><th>Срок</th><th>Сумма</th><th>Состояние</th><th>Когда</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;

  $("orders").querySelectorAll("[data-paid]").forEach(b =>
    b.addEventListener("click", () => orderPaid(Number(b.dataset.paid), b.dataset.who, b.dataset.sum)));
  $("orders").querySelectorAll("[data-drop]").forEach(b =>
    b.addEventListener("click", () => orderDrop(Number(b.dataset.drop))));
}

// Перенести запись в форму: сменить уровень или продлить чаще нужно, чем
// завести нового.
function fill(a) {
  $("who").value = a.auth;
  form.kind = a.steamid ? "steamid" : "nick";
  [...$("kind").children].forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === form.kind)));

  form.full = a.full;
  form.admin = !!a.admin;
  $("admin-full").checked = a.full;
  $("admin-sold").checked = form.admin;
  // Ряд сроков админки идёт за флажком и здесь: иначе он останется спрятанным
  // у записи, где админка уже есть, и продлить её было бы нечем.
  $("admin-days-wrap").hidden = !form.admin;
  form.tier = a.tier < 0 ? null : a.tier;
  form.custom = a.tier < 0 && !a.full && !form.admin;
  $("custom-on").checked = form.custom;
  $("custom-wrap").hidden = !form.custom;
  $("custom").value = form.custom ? a.access : "";
  $("tiers").style.opacity = form.custom ? ".4" : "1";
  drawTiers();

  // Пароль не переносим в поле: он и так сохранится сам, а показывать его в
  // форме — лишний повод случайно его затереть.
  form.pwMode = a.nopass ? "none" : "auto";
  $("password").value = "";
  [...$("pw-mode").children].forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === form.pwMode)));
  $("pw-wrap").hidden = true;
  $("pw-warn").hidden = form.pwMode !== "none";

  $("result").hidden = true;
  refresh();
  $("who").scrollIntoView({ behavior: "smooth", block: "center" });
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ── старт ───────────────────────────────────────────────────────────────────

api("state").then(s => {
  apply(s);
  $("foot").textContent = "Панель видна только вошедшим. Вход закроется сам, если о нём забыть.";
}).catch(err => {
  document.body.innerHTML = `<div class="wrap"><h1>Панель не отвечает</h1>`
    + `<p class="foot">${esc(err.message)}</p></div>`;
});
</script>
</body>
</html>
