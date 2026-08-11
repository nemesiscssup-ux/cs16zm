<?php
/**
 * Заведение первого администратора панели.
 *
 * Задача с подвохом: страница, которая создаёт хозяина, обязана быть доступна
 * ровно один раз и никому больше. Поэтому она открывается только при двух
 * условиях СРАЗУ:
 *
 *   1. в zm_admin_users никого нет — то есть заводить действительно нечего;
 *   2. рядом с настройками лежит файл-разрешение /private/setup-allowed.
 *
 * Второе условие снимает главный страх: если однажды все учётные записи
 * удалят (или база потеряется), страница сама по себе не откроется — нужен
 * доступ по FTP, чтобы положить файл. А после успешного создания файл
 * удаляется сам.
 */

require __DIR__ . '/../_boot.php';
require_once ZM_APP . '/auth.php';
require_once ZM_APP . '/csrf.php';

auth_start();
send_security_headers();
header('Content-Type: text/html; charset=utf-8');

$marker = ZM_PRIVATE . '/setup-allowed';

function setup_stop($why)
{
    http_response_code(403);
    echo '<!doctype html><meta charset="utf-8"><title>Закрыто</title>'
       . '<body style="background:#12130f;color:#848a76;font:14px system-ui;padding:40px">'
       . h($why) . '</body>';
    exit;
}

if (!is_file($marker)) {
    setup_stop('Настройка закрыта. Чтобы открыть её, положите пустой файл private/setup-allowed по FTP.');
}

$count = (int)q_val('SELECT COUNT(*) FROM zm_admin_users');
if ($count > 0) {
    setup_stop('Администратор уже заведён. Удалите его из таблицы zm_admin_users, если нужно завести заново.');
}

$error = null;
$done = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!same_origin() || !csrf_ok(isset($_POST['csrf']) ? $_POST['csrf'] : '')) {
        $error = 'форма устарела — обновите страницу';
    } else {
        $login = post_str('login', 64);
        $pass  = isset($_POST['password']) ? (string)$_POST['password'] : '';
        $again = isset($_POST['password2']) ? (string)$_POST['password2'] : '';

        if (!preg_match('/^[a-zA-Z0-9_.-]{3,64}$/', $login)) {
            $error = 'логин: латиница, цифры, точка, дефис или подчёркивание, от 3 знаков';
        } elseif ($pass !== $again) {
            $error = 'пароли не совпали';
        } elseif (($p = admin_password_problem($pass)) !== null) {
            $error = $p;
        } else {
            q('INSERT INTO zm_admin_users (login, pass_hash, created_at) VALUES (?, ?, NOW())',
                array($login, password_hash($pass, PASSWORD_BCRYPT, array('cost' => 12))));
            audit('setup_admin', $login, null, $login);

            // Дверь за собой закрываем сразу. Если файл не удалился (права,
            // блокировка) — говорим об этом прямо: оставленное разрешение
            // опаснее, чем неудобство удалить его руками.
            $closed = @unlink($marker);
            $done = true;
        }
    }
}
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Первая настройка</title>
<style>
:root { --void:#12130f; --panel:#1a1c16; --rule:#2f3327; --bone:#e9e7dc; --dim:#848a76; --amber:#ffc21f; --crimson:#d8402f; }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
  background:var(--void); color:var(--bone); font:14px/1.55 "Segoe UI",system-ui,sans-serif; }
form, .done { width:100%; max-width:420px; background:var(--panel); border:1px solid var(--rule); padding:28px; }
h1 { margin:0 0 8px; font:600 24px/1 "Bahnschrift","Arial Narrow",sans-serif; letter-spacing:.06em; text-transform:uppercase; }
p.lead { margin:0 0 18px; color:var(--dim); font-size:13px; }
label { display:block; font:600 11px/1 "Bahnschrift",sans-serif; letter-spacing:.2em; text-transform:uppercase; color:var(--dim); margin:18px 0 8px; }
input { width:100%; background:var(--void); border:1px solid var(--rule); color:var(--bone); font:14px/1 Consolas,monospace; padding:12px 13px; }
input:focus { border-color:var(--amber); outline:none; }
button { margin-top:26px; width:100%; background:var(--amber); border:0; color:var(--void);
  font:600 13px/1 "Bahnschrift",sans-serif; letter-spacing:.16em; text-transform:uppercase; padding:15px; cursor:pointer; }
.msg { margin-top:18px; border-left:3px solid var(--crimson); padding:9px 13px; font-size:13px; background:rgba(216,64,47,.08); }
.ok { border-left-color:var(--amber); background:rgba(255,194,31,.07); color:var(--dim); }
a { color:var(--amber); }
</style>
</head>
<body>
<?php if ($done): ?>
  <div class="done">
    <h1>Готово</h1>
    <p class="lead">Администратор заведён. Теперь можно войти.</p>
    <?php if (!$closed): ?>
      <div class="msg">
        Не удалось удалить файл <b>private/setup-allowed</b> — удалите его по FTP руками.
        Пока он лежит, эта страница снова откроется, если удалить все учётные записи.
      </div>
    <?php else: ?>
      <div class="msg ok">Файл-разрешение удалён — страница закрылась сама.</div>
    <?php endif; ?>
    <p style="margin-top:22px"><a href="login.php">Войти в панель →</a></p>
  </div>
<?php else: ?>
  <form method="post" autocomplete="off">
    <h1>Первая настройка</h1>
    <p class="lead">Заведите себе вход в панель. Пароль — от 12 знаков; лучше несколько обычных слов подряд, чем короткая абракадабра.</p>
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">

    <label for="login">Логин</label>
    <input id="login" name="login" type="text" autocomplete="off" autofocus required>

    <label for="password">Пароль</label>
    <input id="password" name="password" type="password" autocomplete="new-password" required>

    <label for="password2">Ещё раз</label>
    <input id="password2" name="password2" type="password" autocomplete="new-password" required>

    <button type="submit">Завести</button>

    <?php if ($error !== null): ?><div class="msg"><?= h($error) ?></div><?php endif; ?>
  </form>
<?php endif; ?>
</body>
</html>
