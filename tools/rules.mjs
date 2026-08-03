// Правила выявления закладок в сборках CS 1.6.
//
// Обоснование каждого правила с источниками лежит в rules/indicators.json — это
// доказательная база. Здесь — исполняемая логика: что именно считать находкой.
//
// Ключевой принцип: почти каждый «опасный» натив легитимен в правильном плагине.
// admin.amxx обязан звать set_user_flags и server_cmd. Поэтому одиночный натив
// весит мало, а вердикт делают СОЧЕТАНИЯ возможностей и совпадения со строками.

export const SEVERITY = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }
export const SEVERITY_NAMES = ['info', 'low', 'medium', 'high', 'critical']

export function maxSeverity(findings) {
  return findings.reduce((m, f) => Math.max(m, SEVERITY[f.severity] ?? 0), 0)
}

// ─────────────────────────────── возможности плагина ───────────────────────────────

export const CAPABILITIES = {
  EXEC: ['server_cmd', 'server_exec', 'client_cmd', 'engclient_cmd', 'console_cmd', 'amxclient_cmd'],
  ADMIN: ['set_user_flags', 'remove_user_flags', 'admins_push', 'admins_flush', 'admins_lookup', 'cmd_access', 'set_user_info'],
  NET: ['socket_open', 'socket_close', 'socket_send', 'socket_send2', 'socket_recv', 'socket_is_readable', 'socket_is_writable',
        'curl_init', 'curl_easy_perform', 'grip_request', 'ehttp_request', 'sqlx_thread_query'],
  FS: ['fopen', 'fread', 'fgets', 'fprintf', 'fputs', 'fclose', 'read_file', 'write_file', 'delete_file', 'unlink', 'rename_file', 'fwrite'],
  CVAR_READ: ['get_cvar_string', 'get_pcvar_string', 'get_cvar_pointer'],
  CVAR_WRITE: ['set_cvar_string', 'set_pcvar_string', 'set_cvar_num', 'set_pcvar_num'],
  MSG: ['message_begin', 'emessage_begin', 'write_string'],
  INDIRECT: ['callfunc_begin', 'callfunc_begin_i', 'callfunc_push_str', 'callfunc_end', 'get_func_id'],
  CLIENT_PROBE: ['query_client_cvar', 'get_user_info'],
  IDENTITY: ['get_user_authid', 'get_user_ip', 'get_user_name'],
  CMD_IN: ['register_clcmd', 'register_srvcmd', 'register_concmd', 'read_argv', 'read_args'],
  TIMER: ['set_task'],
}

export function capabilitiesOf(natives) {
  const set = new Set(natives)
  const caps = {}
  for (const [cap, list] of Object.entries(CAPABILITIES)) {
    const hit = list.filter(n => set.has(n))
    if (hit.length) caps[cap] = hit
  }
  return caps
}

// ─────────────────────────────── строковые правила ───────────────────────────────

const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/
const BENIGN_IPS = new Set(['0.0.0.0', '127.0.0.1', '255.255.255.255', '1.0.0.0', '0.0.0.1'])

/** Команда увода игрока на другой сервер — прямо или отложенно через клавишу. */
const REDIRECT_RE = /^\s*(connect\s+[\w.\-]+(:\d+)?\s*$|bind\s+\S+\s+.*\bconnect\b)/i

/** Строковые индикаторы. Проверяются по каждому литералу, извлечённому из плагина. */
export const STRING_RULES = [
  { id: 'rcon-password', re: /rcon_password/i, severity: 'critical',
    why: 'Плагин обращается к RCON-паролю. Внутри плагина get_cvar_string возвращает его открытым текстом.' },
  // Флаги доступа AMX Mod X заканчиваются на «u». Продолжение vwxyz — это уже
  // алфавит, он встречается в тестах и в наборах символов, а не в правах.
  { id: 'all-access-flags', re: /abcdefghijklmnopqrstu(?!vwxyz)/, severity: 'critical',
    why: 'Строка «все флаги доступа» AMX Mod X — выдача полных админских прав.' },
  { id: 'amx-addadmin', re: /amx_addadmin/i, severity: 'high',
    why: 'Команда добавления админа. В теле плагина — тихая выдача прав.' },
  { id: 'steamid-hardcoded', re: /STEAM_\d:\d:\d{3,}/, severity: 'high',
    why: 'Зашитый SteamID — привилегия по опознанию конкретного человека.' },
  { id: 'belonard-c2', re: /(csgoogle\.ru|valve-ms\.ru)/i, severity: 'critical',
    why: 'Домен управляющего сервера ботнета Belonard.' },
  { id: 'asi-payload', re: /\.asi\b/i, severity: 'critical',
    why: 'Файлы .asi автоматически подгружаются клиентом Half-Life — носитель заражения игроков.' },
  { id: 'logaddress', re: /logaddress_add/i, severity: 'high',
    why: 'Пересылка всех логов сервера на внешний хост, включая rcon-команды.' },
  { id: 'log-off', re: /^log\s+off$/i, severity: 'high',
    why: 'Отключение логирования — антифорензика.' },
  { id: 'users-ini', re: /users\.ini/i, severity: 'high',
    why: 'Прямое обращение к файлу админов вместо штатного API.' },
  { id: 'motd-write', re: /motd_write/i, severity: 'high',
    why: 'Запись MOTD из плагина — типовой канал редиректа игроков.' },
  { id: 'connect-redirect', re: /^\s*connect\s+\S+:\d+/i, severity: 'high',
    why: 'Команда подключения к другому серверу — угон игроков.' },
  { id: 'bind-redirect', re: /^\s*bind\s+.*\bconnect\b/i, severity: 'critical',
    why: 'Привязка клавиши к переходу на чужой сервер: срабатывает у игрока много позже.' },
  { id: 'quit-killswitch', re: /^(quit|exit)$/i, severity: 'medium',
    why: 'Команда остановки сервера. В связке с проверкой пароля/имени — «плагин-заложник».' },
  { id: 'amxmod-backdoor-cmds', re: /^(mrp|cmdr|cmdc|slog)$/, severity: 'critical',
    why: 'Скрытая команда бэкдора AMX Mod 2010.1.' },
  { id: 'is-dev-authid', re: /is_dev_authid/, severity: 'critical',
    why: 'Функция-аутентификатор бэкдора AMX Mod 2010.1.' },
  { id: 'smtp-exfil', re: /^(smtp|stmp|MAIL FROM|RCPT TO|HELO)\b/i, severity: 'high',
    why: 'Почтовая отправка из плагина — канал кражи файлов сервера.' },
  { id: 'admin-password-field', re: /^_pw$/, severity: 'medium',
    why: 'setinfo-поле с паролем админа на клиенте.' },
  { id: 'url', re: /https?:\/\/[^\s"']+/i, severity: 'low',
    why: 'Внешний адрес внутри плагина. Сам по себе не приговор, но требует объяснения.' },
  { id: 'base64-blob', re: /^[A-Za-z0-9+/]{48,}={0,2}$/, severity: 'medium',
    why: 'Длинный base64-блок — типовая обфускация полезной нагрузки.' },
]

function matchStrings(strings, rule) {
  const hits = []
  for (const s of strings) {
    if (rule.re.test(s)) hits.push(s)
    if (hits.length >= 5) break
  }
  return hits
}

function ipHits(strings) {
  const out = []
  for (const s of strings) {
    const m = s.match(IP_RE)
    if (m && !BENIGN_IPS.has(m[0]) && !/^0\./.test(m[0])) out.push(s)
    if (out.length >= 5) break
  }
  return out
}

// ─────────────────────────────── оценка плагина ───────────────────────────────

/**
 * @param {{name:string, natives:string[], strings:string[], publics:string[], hasSource:boolean}} p
 * @returns {Array<{severity:string, rule:string, why:string, evidence:string}>}
 */
export function evaluatePlugin(p) {
  const findings = []
  const caps = capabilitiesOf(p.natives)
  const has = c => Boolean(caps[c])
  const add = (severity, rule, why, evidence) => findings.push({ severity, rule, why, evidence })

  // 1. Строковые индикаторы.
  for (const rule of STRING_RULES) {
    const hits = matchStrings(p.strings, rule)
    if (hits.length) add(rule.severity, rule.id, rule.why, hits.join(' | ').slice(0, 300))
  }
  const ips = ipHits(p.strings)
  if (ips.length) {
    add(has('NET') || has('EXEC') ? 'high' : 'medium', 'ip-literal',
      'IP-адрес внутри плагина. С сетью или исполнением команд — канал управления или угон.',
      ips.join(' | ').slice(0, 300))
  }

  // 2. Сеть в геймплейном плагине не нужна никогда.
  if (has('NET')) {
    add('critical', 'net-in-plugin',
      'Плагин открывает сетевые соединения. Канал утечки конфигов и приёма команд извне.',
      caps.NET.join(', '))
  }

  // 3. Сочетания возможностей.
  // Сами по себе сочетания возможностей — не улика, а повод посмотреть глазами:
  // крупный игровой мод вроде Zombie Plague законно регистрирует админ-команды.
  // Вес находке дают строки, поэтому здесь важность умеренная.
  if (has('ADMIN') && has('EXEC')) {
    add('medium', 'admin-plus-exec',
      'Плагин и раздаёт права, и выполняет серверные команды. Для админ-панели это норма, для игрового плагина — нет.',
      `${caps.ADMIN.join(', ')} + ${caps.EXEC.join(', ')}`)
  }
  if (has('ADMIN') && has('IDENTITY')) {
    const steam = p.strings.filter(s => /STEAM_\d:\d:\d{3,}/.test(s))
    if (steam.length) {
      add('critical', 'admin-by-hardcoded-id',
        'Опознание игрока по зашитому SteamID с последующей выдачей прав — скрытый суперадмин.',
        steam.join(' | ').slice(0, 200))
    }
  }
  if (has('CVAR_READ') && p.strings.some(s => /rcon_password/i.test(s))) {
    add('critical', 'reads-rcon-password',
      'Плагин читает значение rcon_password. Легитимной причины у игрового плагина нет.',
      caps.CVAR_READ.join(', '))
  }
  if (has('CVAR_WRITE') && p.strings.some(s => /rcon_password/i.test(s))) {
    add('critical', 'writes-rcon-password',
      'Плагин меняет rcon_password — молчаливый перехват управления сервером.',
      caps.CVAR_WRITE.join(', '))
  }
  if (has('EXEC') && p.strings.some(s => /^(quit|exit)$/i.test(s))) {
    add('high', 'kill-switch',
      'Плагин умеет останавливать сервер. Обычно это «привязка» к паролю или хостингу.',
      caps.EXEC.join(', '))
  }
  if (has('CMD_IN') && has('EXEC') && p.natives.includes('read_argv')) {
    // Повышаем важность только если рядом есть строка, ради которой такой путь и строят.
    const loaded = p.strings.some(s => /rcon_password|abcdefghijklmnopqrstu|amx_addadmin/i.test(s))
    add(loaded ? 'critical' : 'medium', 'argv-to-exec',
      loaded
        ? 'Аргумент пользовательской команды доходит до исполнения серверной команды, и в плагине есть строки захвата прав.'
        : 'Аргумент пользовательской команды может дойти до исполнения серверной команды. Проверить обработчик глазами.',
      'register_clcmd/read_argv + server_cmd')
  }
  // Только команды-редиректы. Строка вида "exec cfg/что-то.cfg" — штатная загрузка
  // конфига самим модом, из-за неё правило раньше красило любой нормальный плагин.
  const redirect = p.strings.filter(s => REDIRECT_RE.test(s))
  if (has('MSG') && redirect.length) {
    add('critical', 'stufftext-injection',
      'Отправка клиенту команды подключения к другому серверу через сетевое сообщение в обход client_cmd.',
      redirect.join(' | ').slice(0, 200))
  }
  if (has('INDIRECT')) {
    add('medium', 'indirect-call',
      'Вызов функций по имени-строке скрывает цель вызова от статического анализа.',
      caps.INDIRECT.join(', '))
  }
  if (has('CLIENT_PROBE') && p.strings.some(s => /^_pw$/.test(s))) {
    add('high', 'steals-admin-password',
      'Плагин читает клиентское поле с паролем администратора.',
      caps.CLIENT_PROBE.join(', '))
  }
  if (has('FS') && p.strings.some(s => /users\.ini|server\.cfg/i.test(s))) {
    add('high', 'touches-secrets',
      'Файловые операции с конфигами, где лежат админы и пароли.',
      caps.FS.join(', '))
  }

  // 4. Отсутствие исходника — не находка сама по себе, но снимает возможность проверки.
  if (p.hasSource === false) {
    add('low', 'no-source',
      'Нет парного .sma: содержимое недоказуемо, пересобрать и сверить нельзя.',
      p.name)
  }

  return findings
}

// ─────────────────────────────── исходники .sma ───────────────────────────────

/**
 * Достаёт из текста плагина то же, что разборщик достаёт из скомпилированного:
 * список вызванных функций и строковые литералы. Это позволяет применить к
 * исходнику ровно те же правила, что и к .amxx.
 *
 * Без этого сборка, раздающая только исходники, проходила бы аудит «чистой»
 * просто потому, что в ней нет ни одного .amxx.
 */
export function analyzeSource(rawText) {
  const text = rawText
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')

  const strings = new Set()
  // В Pawn экранирование по умолчанию — символ «^», а не обратная косая.
  for (const m of text.matchAll(/"((?:\^.|[^"\n])*)"/g)) strings.add(m[1])

  const calls = new Set()
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) calls.add(m[1])

  return { natives: [...calls], strings: [...strings] }
}

// ─────────────────────────────── конфиги ───────────────────────────────

export const CONFIG_RULES = [
  { id: 'default-access', re: /^\s*amx_default_access\s+"?(?!"?z"?\s*$)([a-y]+)"?/im, severity: 'critical',
    why: 'amx_default_access не равен "z" — указанные права получают ВСЕ подключившиеся.' },
  { id: 'downloadurl', re: /^\s*sv_downloadurl\s+"?(\S+)/im, severity: 'medium',
    why: 'Адрес FastDL. Чужой домен = канал доставки файлов вашим игрокам.' },
  { id: 'rcon-in-cfg', re: /^\s*rcon_password\s+"?(\S+)/im, severity: 'medium',
    why: 'В сборке приложен готовый RCON-пароль. Он известен всем, кто её скачал.' },
  { id: 'logaddress-cfg', re: /^\s*logaddress_add\s+(\S+)/im, severity: 'critical',
    why: 'Пересылка логов сервера на внешний адрес.' },
  { id: 'log-off-cfg', re: /^\s*log\s+off/im, severity: 'high',
    why: 'Логирование отключено — скрытие следов.' },
  { id: 'exec-unknown', re: /^\s*exec\s+(\S+\.cfg)/gim, severity: 'low',
    why: 'Цепочка exec. Проверить каждый вызываемый файл.' },
  // users.ini разбирается отдельно, построчно и по полям — см. evaluateUsersIni.
  { id: 'motd-active', re: /<\s*(script|iframe|meta\s+http-equiv)/i, severity: 'high',
    why: 'Активное содержимое в MOTD исполняется встроенным браузером клиента.' },
  { id: 'belonard-cfg', re: /(csgoogle\.ru|valve-ms\.ru)/i, severity: 'critical',
    why: 'Домен ботнета Belonard в конфигурации.' },
]

/**
 * Отбрасывает закомментированные строки. Штатный users.ini целиком состоит из
 * примеров под «;», и без этого любой нормальный сервер выглядит взломанным.
 */
function stripComments(text) {
  return text.split(/\r?\n/).filter(l => !/^\s*([;#]|\/\/)/.test(l)).join('\n')
}

export function evaluateConfig(name, rawText) {
  const findings = []
  const text = stripComments(rawText)
  const lower = name.toLowerCase()
  for (const rule of CONFIG_RULES) {
    // motd-правило применяем только к motd-файлам, иначе ловит любую html-страницу в сборке
    if (rule.id === 'motd-active' && !lower.includes('motd')) continue
    if (rule.id.startsWith('users-') && !lower.includes('users.ini')) continue
    const m = text.match(rule.re)
    if (m) findings.push({ severity: rule.severity, rule: rule.id, why: rule.why, evidence: String(m[0]).trim().slice(0, 200) })
  }
  return findings
}

// ─────────────────────────────── список администраторов ───────────────────────────────

/** Флаги доступа AMX Mod X, кроме «z» — обычного игрока. */
const POWER_FLAGS = 'abcdefghijklmnopqrstuvwxy'

/**
 * Разбирает users.ini построчно. Формат строки:
 *   "имя_или_SteamID_или_IP" "пароль" "флаги_доступа" "флаги_аккаунта"
 * Флаги аккаунта: a — кик при неверном пароле, b — клан-тег, c — SteamID,
 * d — IP, e — пароль НЕ проверяется, k — регистрозависимость.
 *
 * Это самая ценная проверка во всём аудите: готовая админ-запись в сборке
 * означает, что администратором станет любой, кто эту сборку скачал.
 */
export function evaluateUsersIni(rawText) {
  const findings = []
  const lines = rawText.split(/\r?\n/)

  lines.forEach((line, idx) => {
    const t = line.trim()
    if (!t || /^[;#]/.test(t) || /^\/\//.test(t)) return

    // Запись начинается с кавычки. Если перед ней есть текст — автор, скорее всего,
    // пытался закомментировать строку неверным символом (комментарий здесь «;»).
    // AMXX разберёт такую строку позиционно и получит мусор, а не то, что задумано.
    if (!t.startsWith('"')) {
      findings.push({ severity: 'medium', rule: 'users-malformed',
        why: 'Строка не начинается с кавычки: похоже на неудачную попытку комментария. '
           + 'AMX Mod X разберёт её позиционно, результат непредсказуем. Строку нужно убрать.',
        evidence: `строка ${idx + 1}: ${t.slice(0, 160)}` })
      return
    }

    const fields = [...t.matchAll(/"([^"]*)"/g)].map(m => m[1])
    if (fields.length < 3) {
      if (/"/.test(t)) {
        findings.push({ severity: 'medium', rule: 'users-malformed',
          why: 'Строка списка администраторов не соответствует формату и будет разобрана непредсказуемо.',
          evidence: `строка ${idx + 1}: ${t.slice(0, 160)}` })
      }
      return
    }

    const [who, password, access, account = ''] = fields
    const power = [...new Set(access.replace(/z/g, ''))].filter(c => POWER_FLAGS.includes(c)).length
    const noPassword = account.includes('e')
    const label = `строка ${idx + 1}: ${t.slice(0, 160)}`

    if (noPassword && power >= 15) {
      findings.push({ severity: 'critical', rule: 'users-passwordless-admin',
        why: `Полные права выдаются без пароля: достаточно совпасть по «${who}». `
           + 'Любой, кто знает эту строку — а её знает каждый скачавший сборку, — становится администратором.',
        evidence: label })
    } else if (noPassword && power > 0) {
      findings.push({ severity: 'high', rule: 'users-passwordless-entry',
        why: `Права выдаются без пароля по совпадению с «${who}».`,
        evidence: label })
    } else if (password && power >= 15) {
      findings.push({ severity: 'high', rule: 'users-shipped-credentials',
        why: `В сборке приложен готовый администраторский аккаунт с паролем. `
           + 'Пароль известен всем, кто скачал сборку, и его обязательно менять до запуска.',
        evidence: label })
    } else if (password) {
      findings.push({ severity: 'medium', rule: 'users-shipped-account',
        why: 'В сборке приложен готовый аккаунт с паролем.',
        evidence: label })
    }
  })

  return findings
}

// ─────────────────────────────── скрипты запуска ───────────────────────────────

export const SCRIPT_RULES = [
  { id: 'ld-preload', re: /LD_PRELOAD/, severity: 'critical',
    why: 'Подгрузка произвольной библиотеки в процесс сервера до Metamod — полный контроль.' },
  { id: 'pipe-to-shell', re: /(curl|wget)[^\n|]*\|\s*(ba)?sh/i, severity: 'critical',
    why: 'Загрузка и немедленное исполнение кода из сети.' },
  { id: 'base64-decode', re: /base64\s+(-d|--decode)|openssl\s+enc\s+-d|xxd\s+-r/i, severity: 'critical',
    why: 'Обфускация команд в скрипте запуска.' },
  { id: 'persistence', re: /(crontab|@reboot|\/etc\/cron|systemctl\s+enable|authorized_keys)/i, severity: 'high',
    why: 'Механизм закрепления, переживающий переустановку сервера.' },
  { id: 'reverse-shell', re: /(\/dev\/tcp\/|\bnc\s+-[a-z]*e|ncat\s.*-e)/i, severity: 'critical',
    why: 'Обратное соединение с внешним хостом.' },
  { id: 'ps-encoded', re: /powershell[^\n]*-e(nc|ncodedcommand)/i, severity: 'critical',
    why: 'Закодированная команда PowerShell.' },
  { id: 'certutil-download', re: /certutil[^\n]*-urlcache/i, severity: 'critical',
    why: 'Скачивание файла средством, которое обычно используют для обхода контроля.' },
  { id: 'net-in-launcher', re: /\b(wget|curl)\b/i, severity: 'medium',
    why: 'Обращение в сеть из скрипта запуска игрового сервера.' },
]

export function evaluateScript(name, text) {
  const findings = []
  for (const rule of SCRIPT_RULES) {
    const m = text.match(rule.re)
    if (m) findings.push({ severity: rule.severity, rule: rule.id, why: rule.why, evidence: String(m[0]).trim().slice(0, 200) })
  }
  return findings
}

// ─────────────────────────────── нативные модули ───────────────────────────────

export const BINARY_STRING_RULES = [
  // Голое имя «system» есть в таблице импорта почти любого бинарника на C и уликой
  // не является. Значимы только явные признаки запуска оболочки.
  { id: 'bin-shell', re: /^(\/bin\/sh|\/bin\/bash|popen|execve|\/bin\/sh -c)$/, severity: 'critical',
    why: 'Бинарник умеет запускать команды операционной системы через оболочку.' },
  { id: 'bin-ldpreload', re: /LD_PRELOAD/, severity: 'critical', why: 'Подмена библиотек из модуля.' },
  { id: 'bin-net-tool', re: /^(wget|curl|nc)$/, severity: 'high', why: 'Сетевой инструмент внутри модуля.' },
  { id: 'bin-ssh', re: /authorized_keys|\.ssh\//, severity: 'critical', why: 'Обращение к ключам SSH.' },
  { id: 'bin-amxmod-backdoor', re: /^(mrp|cmdr|cmdc|slog|is_dev_authid)$/, severity: 'critical',
    why: 'Сигнатура бэкдора AMX Mod 2010.1.' },
  { id: 'bin-belonard', re: /(csgoogle\.ru|valve-ms\.ru)/i, severity: 'critical', why: 'Домен ботнета Belonard.' },
  { id: 'bin-crontab', re: /crontab/, severity: 'high', why: 'Закрепление через планировщик.' },
]

export function evaluateBinaryStrings(name, strings) {
  const findings = []
  for (const rule of BINARY_STRING_RULES) {
    const hits = strings.filter(s => rule.re.test(s)).slice(0, 5)
    if (hits.length) findings.push({ severity: rule.severity, rule: rule.id, why: rule.why, evidence: hits.join(' | ').slice(0, 200) })
  }
  return findings
}
