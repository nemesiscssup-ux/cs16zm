# Аудит сборки: calibration

**Вердикт: ГРЯЗНАЯ — найдены закладки или их прямые признаки**

Проверено 4 файлов, 0.0 МБ. Дата: 2026-08-03.

| важность | critical | high | medium | low | info |
|---|---|---|---|---|---|
| находок | 6 | 2 | 2 | 0 | 0 |

Состав: плагинов 2, исходников 2, бинарников 0, скриптов 0, конфигов 0, контента 0.

## Находки

### critical

- **rcon-password** — Плагин обращается к RCON-паролю. Внутри плагина get_cvar_string возвращает его открытым текстом.
  - файл: `positive_control.amxx`
  - улика: `rcon_password`
- **reads-rcon-password** — Плагин читает значение rcon_password. Легитимной причины у игрового плагина нет.
  - файл: `positive_control.amxx`
  - улика: `get_cvar_string`
- **argv-to-exec** — Аргумент пользовательской команды доходит до исполнения серверной команды, и в плагине есть строки захвата прав.
  - файл: `positive_control.amxx`
  - улика: `register_clcmd/read_argv + server_cmd`
- **src:rcon-password** — Плагин обращается к RCON-паролю. Внутри плагина get_cvar_string возвращает его открытым текстом.
  - файл: `positive_control.sma`
  - улика: `rcon_password`
- **src:reads-rcon-password** — Плагин читает значение rcon_password. Легитимной причины у игрового плагина нет.
  - файл: `positive_control.sma`
  - улика: `get_cvar_string`
- **src:argv-to-exec** — Аргумент пользовательской команды доходит до исполнения серверной команды, и в плагине есть строки захвата прав.
  - файл: `positive_control.sma`
  - улика: `register_clcmd/read_argv + server_cmd`
### high

- **kill-switch** — Плагин умеет останавливать сервер. Обычно это «привязка» к паролю или хостингу.
  - файл: `positive_control.amxx`
  - улика: `server_cmd, server_exec`
- **src:kill-switch** — Плагин умеет останавливать сервер. Обычно это «привязка» к паролю или хостингу.
  - файл: `positive_control.sma`
  - улика: `server_cmd, server_exec`
### medium

- **quit-killswitch** — Команда остановки сервера. В связке с проверкой пароля/имени — «плагин-заложник».
  - файл: `positive_control.amxx`
  - улика: `quit | exit`
- **src:quit-killswitch** — Команда остановки сервера. В связке с проверкой пароля/имени — «плагин-заложник».
  - файл: `positive_control.sma`
  - улика: `quit | exit`

## Плагины, требующие удаления или замены

- `positive_control.amxx` — dirty, исходник есть
  - critical: rcon-password
  - medium: quit-killswitch
  - critical: reads-rcon-password
  - high: kill-switch
  - critical: argv-to-exec

## Исходники с закладками

Проблема найдена прямо в тексте плагина — компилировать такое нельзя.

- `positive_control.sma` — dirty
  - critical: rcon-password — `rcon_password`
  - medium: quit-killswitch — `quit | exit`
  - critical: reads-rcon-password — `get_cvar_string`
  - high: kill-switch — `server_cmd, server_exec`
  - critical: argv-to-exec — `register_clcmd/read_argv + server_cmd`
