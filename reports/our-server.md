# Аудит сборки: our-server

**Вердикт: ГРЯЗНАЯ — найдены закладки или их прямые признаки**

Проверено 1421 файлов, 69.0 МБ. Дата: 2026-08-04.

| важность | critical | high | medium | low | info |
|---|---|---|---|---|---|
| находок | 1 | 0 | 27 | 0 | 0 |

Состав: плагинов 52, исходников 77, бинарников 57, скриптов 1, конфигов 964, контента 137.

## Находки

### critical

- **users-passwordless-admin** — Полные права выдаются без пароля: достаточно совпасть по «sadking». Любой, кто знает эту строку — а её знает каждый скачавший сборку, — становится администратором.
  - файл: `cstrike/addons/amxmodx/configs/users.ini`
  - улика: `строка 13: "sadking" "" "abcdefghijklmnopqrstu" "e"`
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
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_ak47long.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_as50.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_fnp45.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_hk416.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_m1887.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_mg36.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_mk48.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_sfgun.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_skull1.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_skull11.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_sl8.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_spas12.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_trg42.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_usas12camo.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_vsk94.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp43_weapon_wa2000.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp_class_abilities.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp_damage_hud.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp_knives.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp_shop_weapons.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/plugins/zp_zombie_nades.amxx`
  - улика: `callfunc_begin_i, callfunc_push_str, callfunc_end, get_func_id`
- **src:admin-plus-exec** — Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.
  - файл: `cstrike/addons/amxmodx/scripting/zombie_plague44.sma`
  - улика: `cmd_access, set_user_info + server_cmd, client_cmd, engclient_cmd`
- **src:argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `cstrike/addons/amxmodx/scripting/zombie_plague44.sma`
  - улика: `register_clcmd/read_argv + server_cmd`
- **src:indirect-call** — Вызов функций по имени-строке скрывает цель вызова от статического анализа.
  - файл: `cstrike/addons/amxmodx/scripting/zp_shop_weapons.sma`
  - улика: `get_func_id`

Совпало с эталоном по SHA256: 27 плагинов — они заведомо оригинальные.