<?php
/**
 * Вход в панель.
 *
 * Страница нарочно скупа: ни имени сервера, ни подсказок, ни ссылки на
 * магазин. Всё, что она сообщает постороннему, — что здесь что-то есть.
 */

require __DIR__ . '/../_boot.php';
require_once ZM_APP . '/auth.php';
require_once ZM_APP . '/csrf.php';

auth_start();
send_security_headers();

if (current_admin()) {
    redirect('index.php');
}

$error = null;
$bye = isset($_GET['bye']);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!same_origin() || !csrf_ok(isset($_POST['csrf']) ? $_POST['csrf'] : '')) {
        $error = 'форма устарела — попробуйте ещё раз';
    } else {
        $error = auth_login(post_str('login', 64), isset($_POST['password']) ? (string)$_POST['password'] : '');
        if ($error === null) {
            redirect('index.php');
        }
    }
    $bye = false;
}

header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Вход</title>
<style>
:root {
  --void: #12130f; --panel: #1a1c16; --rule: #2f3327;
  --bone: #e9e7dc; --dim: #848a76; --amber: #ffc21f; --crimson: #d8402f;
  --display: "Bahnschrift", "Franklin Gothic Medium", "Arial Narrow", sans-serif;
  --mono: "Cascadia Mono", Consolas, "Courier New", monospace;
  --text: "Segoe UI", system-ui, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh;
  display: grid; place-items: center;
  padding: 24px;
  background: var(--void); color: var(--bone);
  font: 14px/1.55 var(--text);
}
form { width: 100%; max-width: 360px; background: var(--panel); border: 1px solid var(--rule); padding: 28px; }
h1 {
  margin: 0 0 22px;
  font: 600 24px/1 var(--display); letter-spacing: .06em; text-transform: uppercase;
}
label {
  display: block;
  font: 600 11px/1 var(--display); letter-spacing: .2em; text-transform: uppercase;
  color: var(--dim); margin: 18px 0 8px;
}
input {
  width: 100%;
  background: var(--void); border: 1px solid var(--rule); color: var(--bone);
  font: 14px/1 var(--mono); padding: 12px 13px;
}
input:focus { border-color: var(--amber); outline: none; }
button {
  margin-top: 26px; width: 100%;
  background: var(--amber); border: 0; color: var(--void);
  font: 600 13px/1 var(--display); letter-spacing: .16em; text-transform: uppercase;
  padding: 15px; cursor: pointer;
}
button:hover { background: #ffd45c; }
.msg { margin-top: 18px; border-left: 3px solid var(--crimson); padding: 9px 13px; font-size: 13px; background: rgba(216,64,47,.08); }
.ok { border-left-color: var(--amber); background: rgba(255,194,31,.07); color: var(--dim); }
:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
</style>
</head>
<body>
<form method="post" autocomplete="off">
  <h1>Панель</h1>
  <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">

  <label for="login">Логин</label>
  <input id="login" name="login" type="text" autocomplete="username" autofocus required>

  <label for="password">Пароль</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>

  <button type="submit">Войти</button>

  <?php if ($error !== null): ?>
    <div class="msg"><?= h($error) ?></div>
  <?php elseif ($bye): ?>
    <div class="msg ok">Вы вышли.</div>
  <?php endif; ?>
</form>
</body>
</html>
