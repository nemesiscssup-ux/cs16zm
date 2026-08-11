<?php
/** Выход из панели. */

require __DIR__ . '/../_boot.php';
require_once ZM_APP . '/auth.php';

auth_start();
auth_logout();
send_security_headers();
redirect('login.php?bye=1');
