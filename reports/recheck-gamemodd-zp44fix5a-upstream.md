# Аудит сборки: recheck-gamemodd-zp44fix5a-upstream

**Вердикт: НЕ ЗАСЛУЖИВАЕТ ДОВЕРИЯ — явных закладок нет, но проверить содержимое нечем**

Проверено 138 файлов, 9.3 МБ. Дата: 2026-08-04.

| важность | critical | high | medium | low | info |
|---|---|---|---|---|---|
| находок | 0 | 0 | 2 | 0 | 0 |

Состав: плагинов 0, исходников 4, бинарников 0, скриптов 0, конфигов 77, контента 56.

## Находки

### medium

- **src:admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.
  - файл: `zp_plugin_44/addons/amxmodx/scripting/zombie_plague44.sma`
  - улика: `cmd_access, set_user_info + server_cmd, client_cmd, engclient_cmd`
- **src:argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `zp_plugin_44/addons/amxmodx/scripting/zombie_plague44.sma`
  - улика: `register_clcmd/read_argv + server_cmd`
