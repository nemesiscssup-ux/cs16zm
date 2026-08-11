// Готовит дерево для FastDL — раздачи файлов обычным веб-сервером.
//
// Встроенная закачка GoldSrc идёт со скоростью порядка 20 КБ/с: наши 19 МБ
// это минут пятнадцать ожидания на каждого нового игрока, и большинство уходит,
// не дождавшись. FastDL отдаёт те же файлы по HTTP на полной скорости.
//
// В дерево попадает ТОЛЬКО то, чего у игрока заведомо нет: файл, побайтово
// совпадающий со штатным из поставки игры, клиент не запрашивает никогда —
// класть его на хостинг значит платить за трафик впустую.
//
// Запуск: node tools/build-fastdl.mjs

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = join(ROOT, 'server', 'cstrike')
const STOCK = join(ROOT, 'build', 'hlds-base', 'cstrike')
const OUT = join(ROOT, 'dist', 'fastdl', 'cstrike')

// Клиент скачивает только эти виды содержимого. Конфиги, плагины и библиотеки
// сервера в раздачу попадать НЕ ДОЛЖНЫ — это чужие глаза на наших настройках.
const DIRS = ['models', 'sound', 'sprites', 'gfx', 'maps']
const EXT = new Set(['.mdl', '.wav', '.mp3', '.spr', '.bsp', '.tga', '.txt', '.res'])

function sha(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}

function walk(dir, out = []) {
  let names
  try { names = readdirSync(dir) } catch { return out }
  for (const n of names) {
    const p = join(dir, n)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

if (!existsSync(SERVER)) {
  console.error(`нет собранного сервера: ${SERVER}\nсначала node tools/assemble.mjs`)
  process.exit(2)
}
if (!existsSync(STOCK)) {
  console.error(`нет эталона игры: ${STOCK}\nбез него не отличить своё от штатного`)
  process.exit(2)
}

rmSync(join(ROOT, 'dist', 'fastdl'), { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

let copied = 0
let bytes = 0
let skipped = 0
const byDir = {}

for (const d of DIRS) {
  const from = join(SERVER, d)
  if (!existsSync(from)) continue

  for (const p of walk(from)) {
    const rel = relative(SERVER, p)
    const ext = rel.slice(rel.lastIndexOf('.')).toLowerCase()
    if (!EXT.has(ext)) continue

    // Есть ли такой же файл в поставке игры — значит он уже у игрока.
    const stockPath = join(STOCK, rel)
    if (existsSync(stockPath)) {
      try {
        if (sha(stockPath) === sha(p)) { skipped++; continue }
      } catch { /* не прочиталось — на всякий случай кладём */ }
    }

    const to = join(OUT, rel)
    mkdirSync(dirname(to), { recursive: true })
    cpSync(p, to)

    copied++
    bytes += statSync(p).size
    const top = rel.split(sep)[0]
    byDir[top] = (byDir[top] ?? 0) + statSync(p).size
  }
}

const mb = n => (n / 1048576).toFixed(1)

console.log(`в раздачу: ${copied} файлов, ${mb(bytes)} МБ`)
console.log(`пропущено как штатное: ${skipped} файлов`)
for (const [d, b] of Object.entries(byDir).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${d.padEnd(10)} ${mb(b)} МБ`)
}

writeFileSync(join(ROOT, 'dist', 'fastdl', 'nginx.conf'), `# Раздача файлов для FastDL. Положить в /etc/nginx/sites-available и включить.
#
# Отдаём СТАТИКУ и только чтение: ни PHP, ни листинга каталогов. Этот сервер
# видит любой игрок, и ничего кроме моделей и звуков ему знать не нужно.

server {
    listen 80;
    server_name fastdl.ВАШ-ДОМЕН;

    root /var/www/fastdl;

    # Листинг выключен: незачем показывать состав сервера посторонним.
    autoindex off;

    # Клиент CS 1.6 запрашивает файлы точно теми же путями, что precache
    # на сервере. Регистр важен: Linux различает Models и models.
    location /cstrike/ {
        try_files $uri =404;

        # Раздаём только игровое содержимое. Всё прочее — 403, даже если
        # случайно окажется в каталоге.
        location ~* \\.(mdl|wav|mp3|spr|bsp|tga|res|txt)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
        location ~* \\.(cfg|ini|amxx|sma|so|dll|log)$ { return 403; }
    }

    location / { return 404; }
}
`, 'utf8')

writeFileSync(join(ROOT, 'dist', 'fastdl', 'КАК-ВЫЛОЖИТЬ.txt'), [
  'FastDL: быстрая раздача файлов игрокам',
  '======================================',
  '',
  `Здесь ${copied} файлов, ${mb(bytes)} МБ — только то, чего у игрока нет.`,
  'Штатные файлы игры не включены: клиент их не запрашивает.',
  '',
  '1. Выложить каталог cstrike/ на веб-сервер так, чтобы открывалось',
  '   https://ваш-домен/fastdl/cstrike/models/... — то есть содержимое',
  '   этой папки кладётся в /var/www/fastdl/ (пример настройки в nginx.conf).',
  '',
  '2. В server.cfg раскомментировать и поправить строку:',
  '      sv_downloadurl "https://ваш-домен/fastdl/cstrike"',
  '   Обратите внимание: в конце ИМЕННО /cstrike, без косой черты после.',
  '',
  '3. sv_allowdownload оставить в 1 — это запасной путь, если файла',
  '   не окажется на сайте.',
  '',
  'Проверка: зайти на сервер чистым клиентом. В консоли игры должно быть',
  'быстрое скачивание, а не многоминутное. Если файл не нашёлся, клиент',
  'молча падает обратно на медленную встроенную закачку — поэтому',
  'проверять надо скоростью, а не наличием ошибок.',
  '',
  'Регистр букв: на Linux models/ и Models/ — разные каталоги. Файлы',
  'выкладывать как есть, ничего не переименовывая.',
  '',
].join('\n'), 'utf8')

console.log(`\nготово: dist/fastdl/`)
console.log('  cstrike/           дерево для выкладки')
console.log('  nginx.conf         пример настройки веб-сервера')
console.log('  КАК-ВЫЛОЖИТЬ.txt   порядок действий')
