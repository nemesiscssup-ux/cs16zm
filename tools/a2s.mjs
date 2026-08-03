// Опрашивает сервер игровым протоколом A2S_INFO.
//
// Это единственное честное доказательство, что сервер действительно поднялся:
// лог может писать что угодно, а на запрос отвечает только живой сервер.
//
// Запуск: node tools/a2s.mjs [хост] [порт]

import { createSocket } from 'node:dgram'

const host = process.argv[2] ?? '127.0.0.1'
const port = Number(process.argv[3] ?? 27015)

const REQUEST = Buffer.concat([
  Buffer.from([0xff, 0xff, 0xff, 0xff]),
  Buffer.from('TSource Engine Query\0', 'latin1'),
])

function readCString(buf, offset) {
  let end = offset
  while (end < buf.length && buf[end] !== 0) end++
  return { value: buf.toString('utf8', offset, end), next: end + 1 }
}

function parseInfo(buf) {
  // 4 байта заголовка пакета + 1 байт типа ответа
  let p = 5
  const header = buf[4]
  if (header !== 0x49 && header !== 0x6d) return null
  const out = {}
  if (header === 0x49) p += 1 // protocol
  let r = readCString(buf, p); out.name = r.value; p = r.next
  r = readCString(buf, p); out.map = r.value; p = r.next
  r = readCString(buf, p); out.folder = r.value; p = r.next
  r = readCString(buf, p); out.game = r.value; p = r.next
  if (header === 0x49) p += 2 // appid
  out.players = buf[p++]
  out.maxPlayers = buf[p++]
  return out
}

const sock = createSocket('udp4')
let done = false

const timer = setTimeout(() => {
  if (done) return
  done = true
  console.log(`НЕТ ОТВЕТА от ${host}:${port} за 8 секунд`)
  sock.close()
  process.exit(1)
}, 8000)

sock.on('message', msg => {
  if (done) return
  done = true
  clearTimeout(timer)
  const info = parseInfo(msg)
  if (info) {
    console.log('сервер отвечает на игровой запрос:')
    console.log(`   имя:    ${info.name}`)
    console.log(`   карта:  ${info.map}`)
    console.log(`   мод:    ${info.folder} / ${info.game}`)
    console.log(`   игроки: ${info.players}/${info.maxPlayers}`)
  } else {
    console.log(`ответ получен (${msg.length} байт), но формат неожиданный: 0x${msg[4]?.toString(16)}`)
  }
  sock.close()
  process.exit(info ? 0 : 1)
})

sock.on('error', err => {
  if (done) return
  done = true
  clearTimeout(timer)
  console.log(`ошибка сокета: ${err.message}`)
  process.exit(1)
})

sock.send(REQUEST, port, host)
