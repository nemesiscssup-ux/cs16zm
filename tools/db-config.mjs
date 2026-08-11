// Собирает configs/sql.cfg — настройки базы данных для AMXX.
//
// ⚠️ ПАРОЛЬ В РЕПОЗИТОРИЙ НЕ ПОПАДАЕТ. Ровно как с администраторами: настоящие
// значения лежат в custom/db.ini, он в .gitignore, а в сборку они попадают
// только в момент сборки. Файл sql.cfg сам по себе тоже уезжает на хостинг
// вместе с сервером — но не в git и не в архив на раздаче.
//
// ⚠️ НЕТ ФАЙЛА — НЕ ПОЛОМКА. Тогда собираем сборку на SQLite: база в одном
// файле рядом с сервером. Так работают и локальный прогон, и проверки, и
// свежая копия репозитория у другого человека — им незачем знать пароль от
// боевой базы. Переключение обратно на MySQL — это появление custom/db.ini,
// пересборка и всё.
//
// Формат custom/db.ini (строки «ключ = значение», решётка — комментарий):
//
//   host = 188.127.241.19
//   user = pw792_zm
//   pass = ...
//   db   = pw792_zm
//   # порт указывать не надо, если он обычный 3306
//
// Запуск отдельно: node tools/db-config.mjs [--dry]

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'custom', 'db.ini')

// Имя таблицы администраторов — то, что ищет штатный admin.amxx.
export const ADMIN_TABLE = 'zm_admins'

/** Читает custom/db.ini. Возвращает null, если файла нет. */
export function readDbIni(path = SRC) {
  if (!existsSync(path)) return null

  const out = {}
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/[;#].*$/, '').trim()
    if (!line) continue
    const at = line.indexOf('=')
    if (at < 0) continue
    out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
  }
  return out
}

/**
 * Пишет configs/sql.cfg в собранный сервер.
 * Возвращает описание того, что получилось, — для журнала сборки.
 */
export function writeSqlCfg(amxxDir, { dry = false } = {}) {
  const db = readDbIni()
  const out = join(amxxDir, 'configs', 'sql.cfg')

  const head = [
    '// Настройки базы данных. Файл СОБИРАЕТСЯ (tools/db-config.mjs), править',
    '// его здесь бесполезно: следующая сборка перезапишет. Настоящие значения',
    '// лежат в custom/db.ini — он вне репозитория, потому что содержит пароль.',
    '',
  ]

  // ⚠️ Пароль пустой — это НЕ «база без пароля», а «мы его не знаем». Молча
  // собрать сборку, которая ломится в боевую базу без пароля, нельзя.
  if (db && (!db.host || !db.user || !db.db)) {
    throw new Error('в custom/db.ini не хватает host, user или db —'
      + ' сборка с половиной настроек молча ушла бы в базу «amx» на 127.0.0.1')
  }

  const lines = db
    ? [
      ...head,
      `amx_sql_host    "${db.host}"`,
      `amx_sql_user    "${db.user}"`,
      `amx_sql_pass    "${db.pass ?? ''}"`,
      `amx_sql_db      "${db.db}"`,
      `amx_sql_table   "${ADMIN_TABLE}"`,
      'amx_sql_type    "mysql"',
      // Секунда — это про ОЖИДАНИЕ СОЕДИНЕНИЯ, и шестьдесят здесь опасны:
      // при недоступной базе поток запроса висел бы минуту на каждом входе.
      'amx_sql_timeout "5"',
      '',
    ]
    : [
      ...head,
      '// custom/db.ini не найден — собрано на SQLite: база лежит одним файлом',
      '// в addons/amxmodx/data/sqlite3. Ничего настраивать не нужно, но и',
      '// смотреть в неё снаружи нечем.',
      'amx_sql_host    "127.0.0.1"',
      'amx_sql_user    ""',
      'amx_sql_pass    ""',
      'amx_sql_db      "cs16zm"',
      `amx_sql_table   "${ADMIN_TABLE}"`,
      'amx_sql_type    "sqlite"',
      'amx_sql_timeout "10"',
      '',
    ]

  if (!dry) writeFileSync(out, lines.join('\n'), 'latin1')

  return db
    ? { type: 'mysql', where: `${db.user}@${db.host}/${db.db}` }
    : { type: 'sqlite', where: 'data/sqlite3/cs16zm.sq3' }
}

// Запуск напрямую — для проверки, что именно получится.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const db = readDbIni()
  console.log(db
    ? `custom/db.ini найден: ${db.user}@${db.host}/${db.db} (пароль ${db.pass ? 'задан' : 'ПУСТ'})`
    : 'custom/db.ini нет — сборка пойдёт на SQLite')
}
