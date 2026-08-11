// Разговор с MySQL/MariaDB напрямую, без сторонних библиотек.
//
// Зачем свой клиент. Базу держит сайт привилегий на чужом хостинге; чтобы
// завести там наши таблицы и перелить в них накопленное из nvault, нужен хоть
// какой-то клиент. На машине сборки нет ни mysql.exe, ни php, ни python, а
// тянуть в проект зависимость ради десятка запросов не хочется: весь остальной
// инструментарий здесь — чистый Node.
//
// Что поддерживается: протокол 4.1, вход по mysql_native_password (это то, что
// отдаёт MariaDB 10.5 на хостинге), обычные запросы и чтение ответов. Ни
// подготовленных выражений, ни сжатия, ни TLS — для разовых работ по базе они
// не нужны.
//
// ⚠️ ПАРОЛЬ БЕРЁТСЯ ИЗ custom/db.ini И НИКОГДА НЕ ИДЁТ В КОМАНДНУЮ СТРОКУ:
// аргументы процесса видны любому пользователю машины, а файл лежит вне
// репозитория.
//
// Запуск:
//   node tools/mysql.mjs "SELECT 1"           — выполнить запрос и показать ответ
//   node tools/mysql.mjs --file путь.sql      — выполнить файл по одному запросу
//   node tools/mysql.mjs --tables             — что вообще есть в базе

import { createHash } from 'node:crypto'
import { connect } from 'node:net'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readDbIni } from './db-config.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── разбор пакетов ──────────────────────────────────────────────────────────
// Кадр: три байта длины (младшим вперёд), байт номера, дальше тело.

class Reader {
  constructor(buf) { this.buf = buf; this.at = 0 }
  byte() { return this.buf[this.at++] }
  int(n) { let v = 0; for (let i = 0; i < n; i++) v += this.buf[this.at++] * 2 ** (8 * i); return v }
  skip(n) { this.at += n }
  strNull() { const end = this.buf.indexOf(0, this.at); const s = this.buf.toString('latin1', this.at, end); this.at = end + 1; return s }
  bytes(n) { const b = this.buf.subarray(this.at, this.at + n); this.at += n; return b }
  rest() { return this.buf.subarray(this.at) }
  // Длина «с переменным началом»: до 251 — сама длина, дальше признак размера.
  lenenc() {
    const first = this.byte()
    if (first < 0xfb) return first
    if (first === 0xfb) return null              // NULL
    if (first === 0xfc) return this.int(2)
    if (first === 0xfd) return this.int(3)
    return this.int(8)
  }
  lenencStr() {
    const len = this.lenenc()
    if (len === null) return null
    return this.bytes(len).toString('utf8')
  }
}

// Ответ на пароль: старая добрая схема «двойной SHA1 и XOR».
function nativePassword(password, scramble) {
  if (!password) return Buffer.alloc(0)
  const sha = b => createHash('sha1').update(b).digest()
  const one = sha(Buffer.from(password, 'utf8'))
  const two = sha(one)
  const three = sha(Buffer.concat([scramble, two]))
  const out = Buffer.alloc(20)
  for (let i = 0; i < 20; i++) out[i] = one[i] ^ three[i]
  return out
}

export class MySQL {
  constructor(opts) { this.opts = opts; this.seq = 0; this.queue = [] }

  // Пакеты приходят кусками и склеиваются: читаем поток и режем по кадрам.
  #feed(chunk) {
    this.tail = this.tail ? Buffer.concat([this.tail, chunk]) : chunk
    for (;;) {
      if (this.tail.length < 4) return
      const len = this.tail[0] | (this.tail[1] << 8) | (this.tail[2] << 16)
      if (this.tail.length < 4 + len) return
      const seq = this.tail[3]
      const body = this.tail.subarray(4, 4 + len)
      this.tail = this.tail.subarray(4 + len)
      const waiter = this.queue.shift()
      if (waiter) waiter({ seq, body })
      else (this.pending ??= []).push({ seq, body })
    }
  }

  #packet() {
    const ready = this.pending?.shift()
    if (ready) return Promise.resolve(ready)
    return new Promise(done => this.queue.push(done))
  }

  #send(payload, seq) {
    const head = Buffer.alloc(4)
    head.writeUIntLE(payload.length, 0, 3)
    head[3] = seq
    this.sock.write(Buffer.concat([head, payload]))
  }

  async connect() {
    const { host, port = 3306, user, password, database } = this.opts
    this.sock = connect({ host, port })
    this.sock.on('data', c => this.#feed(c))
    await new Promise((ok, bad) => {
      this.sock.once('connect', ok)
      this.sock.once('error', bad)
      this.sock.setTimeout(20000, () => bad(new Error(`${host}:${port} не отвечает`)))
    })
    this.sock.setTimeout(0)

    const hello = new Reader((await this.#packet()).body)
    if (hello.byte() !== 10) throw new Error('незнакомая версия протокола')
    this.version = hello.strNull()
    hello.skip(4)                                   // номер соединения
    const scramble1 = hello.bytes(8)
    hello.skip(1)
    hello.skip(2)                                   // возможности, младшая половина
    hello.skip(1)                                   // кодировка
    hello.skip(2)                                   // состояние
    hello.skip(2)                                   // возможности, старшая половина
    const scrambleLen = hello.byte()
    hello.skip(10)
    const scramble2 = hello.bytes(Math.max(13, scrambleLen - 8) - 1)
    const scramble = Buffer.concat([scramble1, scramble2])
    const plugin = hello.strNull()
    if (plugin && plugin !== 'mysql_native_password') {
      throw new Error(`сервер просит вход через «${plugin}» — этот клиент умеет только mysql_native_password`)
    }

    // Возможности: протокол 4.1, длинный пароль, база в приветствии, имя способа входа.
    const CAPS = 0x00000001 | 0x00000004 | 0x00000008 | 0x00000200 | 0x00002000 | 0x00008000 | 0x00080000
    const auth = nativePassword(password, scramble)
    const answer = Buffer.concat([
      // Кодировка соединения. 45 — utf8mb4, 8 — latin1. Latin1 нужен, чтобы
      // повторить поведение модуля MySQL из AMXX: он соединяется именно так, и
      // разница видна только на кириллице.
      (() => { const b = Buffer.alloc(32); b.writeUInt32LE(CAPS, 0); b.writeUInt32LE(0x1000000, 4); b[8] = this.opts.charset ?? 45; return b })(),
      Buffer.from(`${user}\0`, 'utf8'),
      Buffer.from([auth.length]), auth,
      Buffer.from(`${database ?? ''}\0`, 'utf8'),
      Buffer.from('mysql_native_password\0', 'latin1'),
    ])
    this.#send(answer, 1)

    const reply = await this.#packet()
    if (reply.body[0] === 0xff) throw new Error(this.#error(reply.body))
    return this
  }

  #error(body) {
    const r = new Reader(body)
    r.byte()
    const code = r.int(2)
    r.skip(6)                                       // «#» и состояние
    return `MySQL ${code}: ${r.rest().toString('utf8')}`
  }

  /** Выполняет один запрос. Возвращает {rows, fields} для выборки или {affected} иначе. */
  async query(sql) {
    this.#send(Buffer.concat([Buffer.from([0x03]), Buffer.from(sql, 'utf8')]), 0)

    const first = await this.#packet()
    if (first.body[0] === 0xff) throw new Error(`${this.#error(first.body)}\n  запрос: ${sql.slice(0, 160)}`)
    if (first.body[0] === 0x00 || first.body[0] === 0xfe) {
      const r = new Reader(first.body)
      r.byte()
      return { affected: r.lenenc() ?? 0, rows: [], fields: [] }
    }

    const count = new Reader(first.body).lenenc()
    const fields = []
    for (let i = 0; i < count; i++) {
      const r = new Reader((await this.#packet()).body)
      r.lenencStr(); r.lenencStr(); r.lenencStr(); r.lenencStr()   // каталог, база, таблица, таблица-как-есть
      fields.push(r.lenencStr())
    }
    await this.#packet()                            // конец описания столбцов

    const rows = []
    for (;;) {
      const p = await this.#packet()
      if (p.body[0] === 0xfe && p.body.length < 9) break
      if (p.body[0] === 0xff) throw new Error(this.#error(p.body))
      const r = new Reader(p.body)
      const row = {}
      for (const f of fields) row[f] = r.lenencStr()
      rows.push(row)
    }
    return { rows, fields, affected: 0 }
  }

  close() { this.sock?.end() }
}

/** Открывает соединение по custom/db.ini. */
export async function open({ charset } = {}) {
  const ini = readDbIni()
  if (!ini) throw new Error('нет custom/db.ini — подключаться некуда (см. custom/db.ini.example)')
  const db = new MySQL({ host: ini.host, port: Number(ini.port ?? 3306), user: ini.user, password: ini.pass, database: ini.db, charset })
  await db.connect()
  return db
}

/**
 * Режет файл .sql на отдельные запросы. Точка с запятой внутри строки в
 * кавычках концом запроса не считается — иначе рассыплется любой ник с ней.
 */
export function splitSql(text) {
  const out = []
  let cur = ''
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      cur += c
      if (c === '\\') { cur += text[++i] ?? ''; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue }
    // Правило MySQL: «--» с пробелом после — комментарий до конца строки, где
    // бы он ни стоял. Прежняя проверка «только в начале строки» пропускала
    // комментарии с отступом, а они есть внутри каждого CREATE TABLE — и
    // запрос уезжал в базу вместе с ними.
    if (c === '-' && text[i + 1] === '-' && /[\s]/.test(text[i + 2] ?? ' ')) {
      const end = text.indexOf('\n', i)
      i = end < 0 ? text.length : end
      continue
    }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/mysql.mjs')) {
  const args = process.argv.slice(2).filter(a => a !== '--latin1')
  // --latin1: спросить базу так же, как это делает модуль AMXX.
  const db = await open({ charset: process.argv.includes('--latin1') ? 8 : 45 })
  console.log(`подключились: ${db.opts.user}@${db.opts.host}/${db.opts.database}, сервер ${db.version}`)

  try {
    if (args[0] === '--tables') {
      const { rows } = await db.query('SHOW TABLE STATUS')
      for (const r of rows) console.log(`  ${(r.Name ?? '').padEnd(24)} ${(r.Comment === 'VIEW' ? 'представление' : `${r.Rows ?? '?'} строк`)}`)
      console.log(`всего: ${rows.length}`)
    } else if (args[0] === '--file') {
      const text = readFileSync(resolve(ROOT, args[1]), 'utf8')
      const statements = splitSql(text)
      let done = 0
      let rows = 0
      for (const sql of statements) {
        const r = await db.query(sql)
        rows += r.affected ?? 0
        done++
        if (done % 50 === 0) console.log(`  ...${done} из ${statements.length}`)
      }
      console.log(`выполнено запросов ${done}, затронуто строк ${rows}`)
    } else if (args.length) {
      const r = await db.query(args.join(' '))
      if (r.rows.length) {
        console.log(r.fields.join(' | '))
        for (const row of r.rows.slice(0, 50)) console.log(r.fields.map(f => row[f]).join(' | '))
        if (r.rows.length > 50) console.log(`...и ещё ${r.rows.length - 50} строк`)
      } else {
        console.log(`строк затронуто: ${r.affected}`)
      }
    } else {
      console.log('использование: node tools/mysql.mjs "<запрос>" | --file <путь.sql> | --tables')
    }
  } finally {
    db.close()
  }
}
