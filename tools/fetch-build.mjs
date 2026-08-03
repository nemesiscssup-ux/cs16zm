// Скачивает сборку в карантин и фиксирует её происхождение.
//
// Карантин — это доказательная база: архив «как скачан», его SHA256, дата и адрес.
// Ссылки на файлопомойках живут недолго, поэтому без meta.json отчёт через месяц
// невозможно перепроверить.
//
// Запуск: node tools/fetch-build.mjs <slug> <url> [--referer <url>]

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Публичные ссылки Яндекс.Диска отдают файл только через API. */
async function resolveYandexDisk(url) {
  const api = `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(url)}`
  const res = await fetch(api, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Яндекс.Диск API вернул HTTP ${res.status}`)
  const j = await res.json()
  if (!j.href) throw new Error('Яндекс.Диск не отдал прямую ссылку')
  return j.href
}

function guessName(url, contentType, disposition) {
  if (disposition) {
    const m = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
    if (m) return decodeURIComponent(m[1]).replace(/[^\w.\-]/g, '_')
  }
  const tail = url.split('?')[0].split('/').filter(Boolean).pop() ?? 'download'
  if (/\.(zip|rar|7z|tar|gz|tgz)$/i.test(tail)) return tail
  if (/zip/i.test(contentType ?? '')) return `${tail}.zip`
  if (/rar/i.test(contentType ?? '')) return `${tail}.rar`
  if (/7z/i.test(contentType ?? '')) return `${tail}.7z`
  return tail
}

const [, , slug, url] = process.argv
const refIdx = process.argv.indexOf('--referer')
const referer = refIdx > 0 ? process.argv[refIdx + 1] : undefined
if (!slug || !url) {
  console.error('использование: node tools/fetch-build.mjs <slug> <url> [--referer <url>]')
  process.exit(2)
}

const dir = join(ROOT, 'quarantine', slug)
const archiveDir = join(dir, 'archive')
mkdirSync(archiveDir, { recursive: true })

const meta = {
  slug,
  requestedUrl: url,
  referer: referer ?? null,
  fetchedAt: new Date().toISOString(),
}

try {
  let realUrl = url
  if (/yadi\.sk|disk\.yandex/i.test(url)) {
    realUrl = await resolveYandexDisk(url)
    meta.resolvedVia = 'yandex-disk-api'
  }

  const headers = { 'User-Agent': UA, Accept: '*/*' }
  if (referer) headers.Referer = referer

  const res = await fetch(realUrl, { headers, redirect: 'follow' })
  meta.httpStatus = res.status
  meta.finalUrl = res.url
  meta.contentType = res.headers.get('content-type')
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

  const buf = Buffer.from(await res.arrayBuffer())
  const name = guessName(res.url, meta.contentType, res.headers.get('content-disposition'))
  const dest = join(archiveDir, name)

  // Признак «отдали страницу вместо файла» — частая беда каталогов с ad-gate.
  const head = buf.subarray(0, 512).toString('latin1').toLowerCase()
  const looksHtml = head.includes('<html') || head.includes('<!doctype html')

  await writeFile(dest, buf)
  meta.file = name
  meta.size = buf.length
  meta.sha256 = createHash('sha256').update(buf).digest('hex').toUpperCase()
  meta.looksLikeHtml = looksHtml
  meta.ok = !looksHtml && buf.length > 4096

  console.log(`${slug}: ${meta.ok ? 'скачано' : 'ПОДОЗРИТЕЛЬНЫЙ ОТВЕТ'} ${name} ${buf.length} байт`)
  if (looksHtml) console.log('  вместо архива пришла HTML-страница — вероятно, требуется браузер или реклама-шлюз')
  console.log(`  SHA256 ${meta.sha256}`)
} catch (err) {
  meta.ok = false
  meta.error = err.message
  console.log(`${slug}: ОШИБКА ${err.message}`)
}

writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
process.exit(meta.ok ? 0 : 1)
