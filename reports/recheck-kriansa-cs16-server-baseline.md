# Аудит сборки: recheck-kriansa-cs16-server-baseline

**Вердикт: ГРЯЗНАЯ — найдены закладки или их прямые признаки**

Проверено 250 файлов, 15.5 МБ. Дата: 2026-08-04.

| важность | critical | high | medium | low | info |
|---|---|---|---|---|---|
| находок | 2 | 0 | 7 | 2 | 0 |

Состав: плагинов 31, исходников 44, бинарников 32, скриптов 0, конфигов 54, контента 7.

## Находки

### critical

- **users-passwordless-admin** — Полные права выдаются без пароля: достаточно совпасть по «loopback». Любой, кто знает эту строку — а её знает каждый скачавший сборку, — становится администратором.
  - файл: `cs-16-server-master/cstrike/addons/amxmodx/configs/users.ini`
  - улика: `строка 52: "loopback" "" "abcdefghijklmnopqrstu" "de"`
- **users-passwordless-admin** — Полные права выдаются без пароля: достаточно совпасть по «STEAM_0:0:53506913». Любой, кто знает эту строку — а её знает каждый скачавший сборку, — становится администратором.
  - файл: `cs-16-server-master/cstrike/addons/amxmodx/configs/users.ini`
  - улика: `строка 53: "STEAM_0:0:53506913" "" "abcdefghijklmnopqrstu" "ce"`
### medium

- **unverified-executable** — Файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Использовать до сверки нельзя.
  - файл: `cs-16-server-master/cstrike/addons/amxmodx/modules/cstrike_amxx.dll`
  - улика: `cstrike_amxx.dll (180224 байт)`
- **argv-to-exec** — Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.
  - файл: `cs-16-server-master/cstrike/addons/amxmodx/plugins/amx_hpk.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **unverified-executable** — Файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Использовать до сверки нельзя.
  - файл: `cs-16-server-master/cstrike/addons/metamod/dlls/metamod.dll`
  - улика: `metamod.dll (738816 байт)`
- **unverified-executable** — Файл не совпадает ни с одним официальным релизом из базы эталонов. Либо это другая версия, либо он изменён. Использовать до сверки нельзя.
  - файл: `cs-16-server-master/cstrike/addons/metamod/dlls/metamod.so`
  - улика: `metamod.so (1096432 байт)`
- **rcon-in-cfg** — В сборке приложен готовый RCON-пароль. Он известен всем, кто её скачал.
  - файл: `cs-16-server-master/cstrike/cfgs/base.cfg`
  - улика: `rcon_password ""`
- **no-sources** — Плагины без парного .sma нельзя пересобрать и сверить — их содержимое недоказуемо.
  - файл: `(сводно)`
  - улика: `3 из 31: amx_hpk.amxx, csnadedrops.amxx, nonadesthruwalls.amxx`
- **official-name-other-content** — Файлы носят имена официальных плагинов AMX Mod X, но их содержимое не совпадает ни с одной эталонной версией. Обычно это просто другая сборка AMXX, но именно так выглядит и подмена: нужна сверка с апстримом той же версии.
  - файл: `(сводно)`
  - улика: `14 шт.: amxmod_compat.sma, core.sma, mysql.sma, vexdum.sma, pluginmenu.sma, admins_test.sma, arraytest.sma, callfunc_test.sma, fakemeta_tests.sma, fmttest.sma`
### low

- **exec-unknown** — Цепочка exec. Проверить каждый вызываемый файл.
  - файл: `cs-16-server-master/cstrike/addons/amxmodx/configs/amxx.cfg`
  - улика: `exec cfgs/hpk.cfg`
- **exec-unknown** — Цепочка exec. Проверить каждый вызываемый файл.
  - файл: `cs-16-server-master/cstrike/server.cfg`
  - улика: `exec cfgs/base.cfg`

Совпало с эталоном по SHA256: 28 плагинов — они заведомо оригинальные.