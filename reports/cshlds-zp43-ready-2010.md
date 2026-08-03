# Аудит сборки: cshlds-zp43-ready-2010

**Вердикт: ПОДОЗРИТЕЛЬНАЯ — есть находки высокой важности**

Проверено 355 файлов, 15.5 МБ. Дата: 2026-08-03.

| важность | critical | high | medium | low | info |
|---|---|---|---|---|---|
| находок | 0 | 2 | 13 | 1 | 0 |

Состав: плагинов 37, исходников 46, бинарников 21, скриптов 1, конфигов 123, контента 44.

## Находки

### high

- **users-shipped-credentials** — В сборке приложен готовый администраторский аккаунт с паролем. Пароль известен всем, кто скачал сборку, и его обязательно менять до запуска.
  - файл: `zombie_plague_4.3/addons/amxmodx/configs/users.ini`
  - улика: `строка 52: "admin" "admin" "abcdefghijklmnopqrstu" "a"`
- **no-sources** — Плагины без парного .sma нельзя пересобрать и сверить — их содержимое недоказуемо.
  - файл: `(сводно)`
  - улика: `10 из 37: admins.amxx, admin_sql.amxx, alx_lowping.amxx, amx_namelock.amxx, cl_cameratype.amxx, zp_extra_give_ammopaks.amxx, zp_extra_human_armor.amxx, zp_extra_lasermine.amxx, zp_extra_unlimited_clip.amxx, zp_killbomb.amxx`
### medium

- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `zombie_plague_4.3/addons/amxmodx/plugins/alx_lowping.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.
  - файл: `zombie_plague_4.3/addons/amxmodx/plugins/zombie_plague40.amxx`
  - улика: `set_user_info + server_cmd, client_cmd, engclient_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `zombie_plague_4.3/addons/amxmodx/plugins/zombie_plague40.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `zombie_plague_4.3/addons/amxmodx/plugins/zombie_plague40.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `zombie_plague_4.3/addons/amxmodx/plugins/zp_extra_antidotegun1.6.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `zombie_plague_4.3/addons/amxmodx/plugins/zp_extra_jetpack_bazooka32.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `zombie_plague_4.3/addons/amxmodx/plugins/zp_extra_lasermine.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `zombie_plague_4.3/addons/amxmodx/plugins/zp_killbomb.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **unverified-executable** — Исполняемый файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Запускать до сверки нельзя.
  - файл: `zombie_plague_4.3/addons/amxmodx/scripting/amxxpc.exe`
  - улика: `amxxpc.exe (110592 байт)`
- **src:admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.
  - файл: `zombie_plague_4.3/addons/amxmodx/scripting/zombie_plague40.sma`
  - улика: `cmd_access, set_user_info + server_cmd, client_cmd, engclient_cmd`
- **src:argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `zombie_plague_4.3/addons/amxmodx/scripting/zombie_plague40.sma`
  - улика: `register_clcmd/read_argv + server_cmd`
- **rcon-in-cfg** — В сборке приложен готовый RCON-пароль. Он известен всем, кто её скачал.
  - файл: `zombie_plague_4.3/server.cfg`
  - улика: `rcon_password "napoJIb"`
- **official-name-other-content** — Файлы носят имена официальных плагинов AMX Mod X, но их содержимое не совпадает ни с одной эталонной версией. Обычно это просто другая сборка AMXX, но именно так выглядит и подмена: нужна сверка с апстримом той же версии.
  - файл: `(сводно)`
  - улика: `47 шт.: admin.amxx, adminchat.amxx, admincmd.amxx, adminhelp.amxx, adminslots.amxx, adminvote.amxx, admin_sql.amxx, amxmod_compat.amxx, antiflood.amxx, cmdmenu.amxx`
### low

- **exec-unknown** — Цепочка exec. Проверить каждый вызываемый файл.
  - файл: `zombie_plague_4.3/server.cfg`
  - улика: `exec banned.cfg`
