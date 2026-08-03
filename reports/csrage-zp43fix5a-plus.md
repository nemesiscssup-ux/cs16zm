# Аудит сборки: csrage-zp43fix5a-plus

**Вердикт: ГРЯЗНАЯ — найдены закладки или их прямые признаки**

Проверено 6587 файлов, 782.7 МБ. Дата: 2026-08-03.

| важность | critical | high | medium | low | info |
|---|---|---|---|---|---|
| находок | 1 | 5 | 16 | 6 | 0 |

Состав: плагинов 32, исходников 53, бинарников 71, скриптов 0, конфигов 1197, контента 4823.

## Находки

### critical

- **users-passwordless-admin** — Полные права выдаются без пароля: достаточно совпасть по «r0». Любой, кто знает эту строку — а её знает каждый скачавший сборку, — становится администратором.
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/configs/users.ini`
  - улика: `строка 54: "r0" "" "abcdefghijklmnopqrstuv" "ek"`
### high

- **users-passwordless-entry** — Права выдаются без пароля по совпадению с «XxXx».
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/configs/users.ini`
  - улика: `строка 55: "XxXx" "" "deu" "e"`
- **users-passwordless-entry** — Права выдаются без пароля по совпадению с «r1».
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/configs/users.ini`
  - улика: `строка 56: "r1" "" "peu" "e"`
- **users-passwordless-entry** — Права выдаются без пароля по совпадению с «r2».
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/configs/users.ini`
  - улика: `строка 57: "r2" "" "deu" "e"`
- **users-passwordless-entry** — Права выдаются без пароля по совпадению с «r3».
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/configs/users.ini`
  - улика: `строка 58: "r3" "" "teu" "e"`
- **users-passwordless-entry** — Права выдаются без пароля по совпадению с «r4».
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/configs/users.ini`
  - улика: `строка 59: "r4" "" "zeu" "e"`
### medium

- **unverified-executable** — Исполняемый файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Запускать до сверки нельзя.
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/data/WinCSX.exe`
  - улика: `WinCSX.exe (168448 байт)`
- **admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/plugins/potti.amxx`
  - улика: `set_user_info + server_cmd, client_cmd, engclient_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/plugins/potti.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/plugins/zp_core.amxx`
  - улика: `set_user_info + server_cmd, client_cmd, engclient_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/plugins/zp_core.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/plugins/zp_core.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **unverified-executable** — Исполняемый файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Запускать до сверки нельзя.
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/scripting/amxxpc.exe`
  - улика: `amxxpc.exe (171008 байт)`
- **src:admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/scripting/zp_core.sma`
  - улика: `set_user_info + server_cmd, client_cmd, engclient_cmd`
- **src:argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `ZP 4.3 fix5a/cstrike/addons/amxmodx/scripting/zp_core.sma`
  - улика: `register_clcmd/read_argv + server_cmd`
- **rcon-in-cfg** — В сборке приложен готовый RCON-пароль. Он известен всем, кто её скачал.
  - файл: `ZP 4.3 fix5a/cstrike/server.cfg`
  - улика: `rcon_password ""`
- **unverified-executable** — Исполняемый файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Запускать до сверки нельзя.
  - файл: `ZP 4.3 fix5a/hlds.exe`
  - улика: `hlds.exe (287744 байт)`
- **unverified-executable** — Исполняемый файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Запускать до сверки нельзя.
  - файл: `ZP 4.3 fix5a/hlds_console.exe`
  - улика: `hlds_console.exe (460404 байт)`
- **unverified-executable** — Исполняемый файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Запускать до сверки нельзя.
  - файл: `ZP 4.3 fix5a/hlds_gui.exe`
  - улика: `hlds_gui.exe (404904 байт)`
- **unverified-executable** — Исполняемый файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Запускать до сверки нельзя.
  - файл: `ZP 4.3 fix5a/hltv.exe`
  - улика: `hltv.exe (289792 байт)`
- **no-sources** — Плагины без парного .sma нельзя пересобрать и сверить — их содержимое недоказуемо.
  - файл: `(сводно)`
  - улика: `3 из 32: admin_sql.amxx, Camera_Changer.amxx, potti.amxx`
- **official-name-other-content** — Файлы носят имена официальных плагинов AMX Mod X, но их содержимое не совпадает ни с одной эталонной версией. Обычно это просто другая сборка AMXX, но именно так выглядит и подмена: нужна сверка с апстримом той же версии.
  - файл: `(сводно)`
  - улика: `28 шт.: csstats.amxx, admin.amxx, adminchat.amxx, admincmd.amxx, adminhelp.amxx, adminslots.amxx, adminvote.amxx, admin_sql.amxx, antiflood.amxx, cmdmenu.amxx`
### low

- **exec-unknown** — Цепочка exec. Проверить каждый вызываемый файл.
  - файл: `ZP 4.3 fix5a/cstrike/autoexec.cfg`
  - улика: `exec game.cfg`
- **exec-unknown** — Цепочка exec. Проверить каждый вызываемый файл.
  - файл: `ZP 4.3 fix5a/cstrike/config.cfg`
  - улика: `exec userconfig.cfg`
- **exec-unknown** — Цепочка exec. Проверить каждый вызываемый файл.
  - файл: `ZP 4.3 fix5a/cstrike/server.cfg`
  - улика: `exec banned.cfg`
- **exec-unknown** — Цепочка exec. Проверить каждый вызываемый файл.
  - файл: `ZP 4.3 fix5a/valve/autoexec.cfg`
  - улика: `exec violence.cfg`
- **exec-unknown** — Цепочка exec. Проверить каждый вызываемый файл.
  - файл: `ZP 4.3 fix5a/valve/server.cfg`
  - улика: `exec listip.cfg`
- **exec-unknown** — Цепочка exec. Проверить каждый вызываемый файл.
  - файл: `ZP 4.3 fix5a/valve/valve.rc`
  - улика: `exec language.cfg`
