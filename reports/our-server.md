# Аудит сборки: our-server

**Вердикт: НЕ ЗАСЛУЖИВАЕТ ДОВЕРИЯ — явных закладок нет, но проверить содержимое нечем**

Проверено 1214 файлов, 46.1 МБ. Дата: 2026-08-03.

| важность | critical | high | medium | low | info |
|---|---|---|---|---|---|
| находок | 0 | 0 | 5 | 0 | 0 |

Состав: плагинов 29, исходников 54, бинарников 55, скриптов 1, конфигов 934, контента 56.

Защитник Windows: угроз не найдено.

## Находки

### medium

- **admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.
  - файл: `cstrike/addons/amxmodx/plugins/zombie_plague44.amxx`
  - улика: `set_user_info + server_cmd, client_cmd, engclient_cmd`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `cstrike/addons/amxmodx/plugins/zombie_plague44.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zombie_plague44.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **src:admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.
  - файл: `cstrike/addons/amxmodx/scripting/zombie_plague44.sma`
  - улика: `cmd_access, set_user_info + server_cmd, client_cmd, engclient_cmd`
- **src:argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `cstrike/addons/amxmodx/scripting/zombie_plague44.sma`
  - улика: `register_clcmd/read_argv + server_cmd`

Совпало с эталоном по SHA256: 27 плагинов — они заведомо оригинальные.