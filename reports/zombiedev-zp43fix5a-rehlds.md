# Аудит сборки: zombiedev-zp43fix5a-rehlds

**Вердикт: ПОДОЗРИТЕЛЬНАЯ — есть находки высокой важности**

Проверено 6469 файлов, 766.8 МБ. Дата: 2026-08-03.

| важность | critical | high | medium | low | info |
|---|---|---|---|---|---|
| находок | 0 | 2 | 16 | 3 | 0 |

Состав: плагинов 36, исходников 7, бинарников 58, скриптов 1, конфигов 1124, контента 4782.

## Находки

### high

- **users-shipped-credentials** — В сборке приложен готовый администраторский аккаунт с паролем. Пароль известен всем, кто скачал сборку, и его обязательно менять до запуска.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/configs/users.ini`
  - улика: `строка 49: "xman2030" "1" "abcdefghijklmnopqrstu" "a"`
- **no-sources** — Плагины без парного .sma нельзя пересобрать и сверить — их содержимое недоказуемо.
  - файл: `(сводно)`
  - улика: `6 из 36: csstats.amxx, mapchooser.amxx, menufront.amxx, mutemenu.amxx, red_cannon.amxx, weaponmenu.amxx`
### medium

- **users-malformed** — Строка не начинается с кавычки: похоже на неудачную попытку комментария. AMX Mod X разберёт её позиционно, результат непредсказуем. Строку нужно убрать.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/configs/users.ini`
  - улика: `строка 46: : Àäìèíêà ïî IP "192.168.0.152" "" "abcdefghijkmnopqrstu" "de"`
- **unverified-executable** — Исполняемый файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Запускать до сверки нельзя.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/data/WinCSX.exe`
  - улика: `WinCSX.exe (131072 байт)`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/plugins/red_cannon.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/plugins/zombie_plague40.amxx`
  - улика: `set_user_info + server_cmd, client_cmd, engclient_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/plugins/zombie_plague40.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/plugins/zombie_plague40.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/plugins/zp_level_system.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/scripting/compiled/zombie_plague40.amxx`
  - улика: `set_user_info + server_cmd, client_cmd, engclient_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/scripting/compiled/zombie_plague40.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/scripting/compiled/zombie_plague40.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **src:admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/scripting/zombie_plague40.sma`
  - улика: `cmd_access, set_user_info + server_cmd, client_cmd, engclient_cmd`
- **src:argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `REHLDS_ZP43-ZA.RU/cstrike/addons/amxmodx/scripting/zombie_plague40.sma`
  - улика: `register_clcmd/read_argv + server_cmd`
- **unverified-executable** — Исполняемый файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Запускать до сверки нельзя.
  - файл: `REHLDS_ZP43-ZA.RU/hlds.exe`
  - улика: `hlds.exe (278016 байт)`
- **unverified-executable** — Исполняемый файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Запускать до сверки нельзя.
  - файл: `REHLDS_ZP43-ZA.RU/hlds_console.exe`
  - улика: `hlds_console.exe (460404 байт)`
- **unverified-executable** — Исполняемый файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Запускать до сверки нельзя.
  - файл: `REHLDS_ZP43-ZA.RU/hltv.exe`
  - улика: `hltv.exe (289792 байт)`
- **official-name-other-content** — Файлы носят имена официальных плагинов AMX Mod X, но их содержимое не совпадает ни с одной эталонной версией. Обычно это просто другая сборка AMXX, но именно так выглядит и подмена: нужна сверка с апстримом той же версии.
  - файл: `(сводно)`
  - улика: `4 шт.: csstats.amxx, amxmod_compat.amxx, mapchooser.amxx, menufront.amxx`
### low

- **exec-unknown** — Цепочка exec. Проверить каждый вызываемый файл.
  - файл: `REHLDS_ZP43-ZA.RU/valve/autoexec.cfg`
  - улика: `exec violence.cfg`
- **exec-unknown** — Цепочка exec. Проверить каждый вызываемый файл.
  - файл: `REHLDS_ZP43-ZA.RU/valve/server.cfg`
  - улика: `exec listip.cfg`
- **exec-unknown** — Цепочка exec. Проверить каждый вызываемый файл.
  - файл: `REHLDS_ZP43-ZA.RU/valve/valve.rc`
  - улика: `exec language.cfg`

Совпало с эталоном по SHA256: 24 плагинов — они заведомо оригинальные.