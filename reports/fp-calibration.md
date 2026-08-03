# Аудит сборки: fp-calibration

**Вердикт: ГРЯЗНАЯ — найдены закладки или их прямые признаки**

Проверено 1001 файлов, 14.5 МБ. Дата: 2026-08-03.

| важность | critical | high | medium | low | info |
|---|---|---|---|---|---|
| находок | 10 | 29 | 11 | 0 | 0 |

Состав: плагинов 22, исходников 45, бинарников 15, скриптов 0, конфигов 850, контента 0.

## Находки

### critical

- **users-all-flags** — Полный набор прав в конфиге.
  - файл: `addons/amxmodx/configs/users.ini`
  - улика: `abcdefghijklmnopqrstu`
- **rcon-password** — Плагин обращается к RCON-паролю. Внутри плагина get_cvar_string возвращает его открытым текстом.
  - файл: `addons/amxmodx/plugins/admincmd.amxx`
  - улика: `rcon_password | rcon_password %s`
- **reads-rcon-password** — Плагин читает значение rcon_password. Легитимной причины у игрового плагина нет.
  - файл: `addons/amxmodx/plugins/admincmd.amxx`
  - улика: `get_pcvar_string, get_cvar_pointer`
- **writes-rcon-password** — Плагин меняет rcon_password — молчаливый перехват управления сервером.
  - файл: `addons/amxmodx/plugins/admincmd.amxx`
  - улика: `set_pcvar_string, set_pcvar_num`
- **stufftext-injection** — Отправка клиенту консольной команды через сетевое сообщение в обход client_cmd.
  - файл: `addons/amxmodx/plugins/admincmd.amxx`
  - улика: `message_begin`
- **rcon-password** — Плагин обращается к RCON-паролю. Внутри плагина get_cvar_string возвращает его открытым текстом.
  - файл: `addons/amxmodx/plugins/adminvote.amxx`
  - улика: `rcon_password`
- **reads-rcon-password** — Плагин читает значение rcon_password. Легитимной причины у игрового плагина нет.
  - файл: `addons/amxmodx/plugins/adminvote.amxx`
  - улика: `get_cvar_pointer`
- **rcon-password** — Плагин обращается к RCON-паролю. Внутри плагина get_cvar_string возвращает его открытым текстом.
  - файл: `addons/amxmodx/plugins/pluginmenu.amxx`
  - улика: `rcon_password`
- **reads-rcon-password** — Плагин читает значение rcon_password. Легитимной причины у игрового плагина нет.
  - файл: `addons/amxmodx/plugins/pluginmenu.amxx`
  - улика: `get_pcvar_string, get_cvar_pointer`
- **writes-rcon-password** — Плагин меняет rcon_password — молчаливый перехват управления сервером.
  - файл: `addons/amxmodx/plugins/pluginmenu.amxx`
  - улика: `set_pcvar_string`
### high

- **users-no-password** — Запись users.ini с флагом «e» — вход админом без пароля.
  - файл: `addons/amxmodx/configs/users.ini`
  - улика: `"loopback" "" "abcdefghijklmnopqrstuv" "de"`
- **amx-addadmin** — Команда добавления админа. В теле плагина — тихая выдача прав.
  - файл: `addons/amxmodx/plugins/admin.amxx`
  - улика: `amx_addadmin`
- **users-ini** — Прямое обращение к файлу админов вместо штатного API.
  - файл: `addons/amxmodx/plugins/admin.amxx`
  - улика: `<playername|auth> <accessflags> [password] [authtype] - add specified player as an admin to users.ini | %s/users.ini`
- **admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды — набор для тихого захвата.
  - файл: `addons/amxmodx/plugins/admin.amxx`
  - улика: `set_user_flags, remove_user_flags, admins_push, admins_flush, admins_lookup + server_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды — путь к удалённому управлению.
  - файл: `addons/amxmodx/plugins/admin.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **touches-secrets** — Файловые операции с конфигами, где лежат админы и пароли.
  - файл: `addons/amxmodx/plugins/admin.amxx`
  - улика: `fopen, fgets, fclose, read_file, write_file`
- **admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды — набор для тихого захвата.
  - файл: `addons/amxmodx/plugins/admincmd.amxx`
  - улика: `set_user_info + server_cmd, server_exec, client_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды — путь к удалённому управлению.
  - файл: `addons/amxmodx/plugins/admincmd.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды — путь к удалённому управлению.
  - файл: `addons/amxmodx/plugins/adminvote.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **amx-addadmin** — Команда добавления админа. В теле плагина — тихая выдача прав.
  - файл: `addons/amxmodx/plugins/admin_sql.amxx`
  - улика: `amx_addadmin`
- **users-ini** — Прямое обращение к файлу админов вместо штатного API.
  - файл: `addons/amxmodx/plugins/admin_sql.amxx`
  - улика: `<playername|auth> <accessflags> [password] [authtype] - add specified player as an admin to users.ini | %s/users.ini`
- **admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды — набор для тихого захвата.
  - файл: `addons/amxmodx/plugins/admin_sql.amxx`
  - улика: `set_user_flags, remove_user_flags, admins_push, admins_flush, admins_lookup + server_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды — путь к удалённому управлению.
  - файл: `addons/amxmodx/plugins/admin_sql.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **touches-secrets** — Файловые операции с конфигами, где лежат админы и пароли.
  - файл: `addons/amxmodx/plugins/admin_sql.amxx`
  - улика: `fopen, fgets, fclose, read_file, write_file`
- **kill-switch** — Плагин умеет останавливать сервер. Обычно это «привязка» к паролю или хостингу.
  - файл: `addons/amxmodx/plugins/cmdmenu.amxx`
  - улика: `server_cmd, client_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды — путь к удалённому управлению.
  - файл: `addons/amxmodx/plugins/cmdmenu.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **kill-switch** — Плагин умеет останавливать сервер. Обычно это «привязка» к паролю или хостингу.
  - файл: `addons/amxmodx/plugins/menufront.amxx`
  - улика: `server_cmd, client_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды — путь к удалённому управлению.
  - файл: `addons/amxmodx/plugins/menufront.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды — набор для тихого захвата.
  - файл: `addons/amxmodx/plugins/multilingual.amxx`
  - улика: `set_user_info + client_cmd`
- **kill-switch** — Плагин умеет останавливать сервер. Обычно это «привязка» к паролю или хостингу.
  - файл: `addons/amxmodx/plugins/multilingual.amxx`
  - улика: `client_cmd`
- **kill-switch** — Плагин умеет останавливать сервер. Обычно это «привязка» к паролю или хостингу.
  - файл: `addons/amxmodx/plugins/pausecfg.amxx`
  - улика: `server_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды — путь к удалённому управлению.
  - файл: `addons/amxmodx/plugins/pausecfg.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **kill-switch** — Плагин умеет останавливать сервер. Обычно это «привязка» к паролю или хостингу.
  - файл: `addons/amxmodx/plugins/plmenu.amxx`
  - улика: `server_cmd, server_exec, client_cmd, engclient_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды — путь к удалённому управлению.
  - файл: `addons/amxmodx/plugins/plmenu.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **kill-switch** — Плагин умеет останавливать сервер. Обычно это «привязка» к паролю или хостингу.
  - файл: `addons/amxmodx/plugins/pluginmenu.amxx`
  - улика: `client_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды — путь к удалённому управлению.
  - файл: `addons/amxmodx/plugins/pluginmenu.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды — путь к удалённому управлению.
  - файл: `addons/amxmodx/plugins/timeleft.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **foreign-executable** — Исполняемый файл Windows внутри серверной сборки. Классический носитель кражи данных с компьютера администратора.
  - файл: `addons/amxmodx/scripting/amxxpc.exe`
  - улика: `amxxpc.exe (187392 байт)`
- **foreign-executable** — Исполняемый файл Windows внутри серверной сборки. Классический носитель кражи данных с компьютера администратора.
  - файл: `addons/amxmodx/scripting/compile.exe`
  - улика: `compile.exe (102912 байт)`
### medium

- **quit-killswitch** — Команда остановки сервера. В связке с проверкой пароля/имени — «плагин-заложник».
  - файл: `addons/amxmodx/plugins/cmdmenu.amxx`
  - улика: `EXIT`
- **quit-killswitch** — Команда остановки сервера. В связке с проверкой пароля/имени — «плагин-заложник».
  - файл: `addons/amxmodx/plugins/mapsmenu.amxx`
  - улика: `EXIT`
- **quit-killswitch** — Команда остановки сервера. В связке с проверкой пароля/имени — «плагин-заложник».
  - файл: `addons/amxmodx/plugins/menufront.amxx`
  - улика: `EXIT`
- **quit-killswitch** — Команда остановки сервера. В связке с проверкой пароля/имени — «плагин-заложник».
  - файл: `addons/amxmodx/plugins/multilingual.amxx`
  - улика: `EXIT`
- **quit-killswitch** — Команда остановки сервера. В связке с проверкой пароля/имени — «плагин-заложник».
  - файл: `addons/amxmodx/plugins/pausecfg.amxx`
  - улика: `EXIT`
- **quit-killswitch** — Команда остановки сервера. В связке с проверкой пароля/имени — «плагин-заложник».
  - файл: `addons/amxmodx/plugins/plmenu.amxx`
  - улика: `EXIT`
- **quit-killswitch** — Команда остановки сервера. В связке с проверкой пароля/имени — «плагин-заложник».
  - файл: `addons/amxmodx/plugins/pluginmenu.amxx`
  - улика: `EXIT`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `addons/amxmodx/plugins/pluginmenu.amxx`
  - улика: `callfunc_begin, callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **quit-killswitch** — Команда остановки сервера. В связке с проверкой пароля/имени — «плагин-заложник».
  - файл: `addons/amxmodx/plugins/statscfg.amxx`
  - улика: `EXIT`
- **quit-killswitch** — Команда остановки сервера. В связке с проверкой пароля/имени — «плагин-заложник».
  - файл: `addons/amxmodx/plugins/telemenu.amxx`
  - улика: `EXIT`
- **no-sources** — Плагины без парного .sma нельзя пересобрать и сверить — их содержимое недоказуемо.
  - файл: `(сводно)`
  - улика: `1 из 22: admin_sql.amxx`

## Плагины, требующие удаления или замены

- `addons/amxmodx/plugins/admin.amxx` — suspicious, исходник есть
  - high: amx-addadmin
  - high: users-ini
  - high: admin-plus-exec
  - high: argv-to-exec
  - high: touches-secrets
- `addons/amxmodx/plugins/admincmd.amxx` — dirty, исходник есть
  - critical: rcon-password
  - high: admin-plus-exec
  - critical: reads-rcon-password
  - critical: writes-rcon-password
  - high: argv-to-exec
  - critical: stufftext-injection
- `addons/amxmodx/plugins/adminvote.amxx` — dirty, исходник есть
  - critical: rcon-password
  - critical: reads-rcon-password
  - high: argv-to-exec
- `addons/amxmodx/plugins/admin_sql.amxx` — suspicious, исходник ОТСУТСТВУЕТ
  - high: amx-addadmin
  - high: users-ini
  - high: admin-plus-exec
  - high: argv-to-exec
  - high: touches-secrets
  - low: no-source
- `addons/amxmodx/plugins/cmdmenu.amxx` — suspicious, исходник есть
  - medium: quit-killswitch
  - high: kill-switch
  - high: argv-to-exec
- `addons/amxmodx/plugins/menufront.amxx` — suspicious, исходник есть
  - medium: quit-killswitch
  - high: kill-switch
  - high: argv-to-exec
- `addons/amxmodx/plugins/multilingual.amxx` — suspicious, исходник есть
  - medium: quit-killswitch
  - high: admin-plus-exec
  - high: kill-switch
- `addons/amxmodx/plugins/pausecfg.amxx` — suspicious, исходник есть
  - medium: quit-killswitch
  - high: kill-switch
  - high: argv-to-exec
- `addons/amxmodx/plugins/plmenu.amxx` — suspicious, исходник есть
  - medium: quit-killswitch
  - high: kill-switch
  - high: argv-to-exec
- `addons/amxmodx/plugins/pluginmenu.amxx` — dirty, исходник есть
  - critical: rcon-password
  - medium: quit-killswitch
  - critical: reads-rcon-password
  - critical: writes-rcon-password
  - high: kill-switch
  - high: argv-to-exec
  - medium: indirect-call
- `addons/amxmodx/plugins/timeleft.amxx` — suspicious, исходник есть
  - high: argv-to-exec
