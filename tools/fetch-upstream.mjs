// Скачивает официальные релизы компонентов сервера и фиксирует их SHA256.
//
// Версии прибиты намеренно: MANIFEST.json — это доказательная база всего аудита.
// Любой .so/.dll из скачанной «сборки» сверяется именно с этими файлами.
//
// Запуск: node tools/fetch-upstream.mjs [--force]

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Версии на 2026-08-04, снято через GitHub API releases/latest и amxmodx.org/amxxdrop.
export const COMPONENTS = [
  {
    name: 'ReHLDS', version: '3.15.0.896', platform: 'both',
    url: 'https://github.com/rehlds/ReHLDS/releases/download/3.15.0.896/rehlds-bin-3.15.0.896.zip',
    file: 'rehlds-bin-3.15.0.896.zip',
    role: 'движок HLDS (реверс-инжиниринг, быстрее и безопаснее оригинала)',
  },
  {
    name: 'ReGameDLL_CS', version: '5.30.0.814', platform: 'both',
    url: 'https://github.com/rehlds/ReGameDLL_CS/releases/download/5.30.0.814/regamedll-bin-5.30.0.814.zip',
    file: 'regamedll-bin-5.30.0.814.zip',
    role: 'игровая логика cs.so / mp.dll',
  },
  {
    name: 'Metamod-R', version: '1.3.0.149', platform: 'both',
    url: 'https://github.com/rehlds/Metamod-R/releases/download/1.3.0.149/metamod-bin-1.3.0.149.zip',
    file: 'metamod-bin-1.3.0.149.zip',
    role: 'загрузчик серверных модулей',
  },
  {
    name: 'ReAPI', version: '5.29.0.358', platform: 'both',
    url: 'https://github.com/rehlds/ReAPI/releases/download/5.29.0.358/reapi-bin-5.29.0.358.zip',
    file: 'reapi-bin-5.29.0.358.zip',
    role: 'модуль AMXX с API к ReHLDS/ReGameDLL',
  },
  {
    name: 'ReUnion', version: '0.2.0.25', platform: 'both',
    url: 'https://github.com/rehlds/ReUnion/releases/download/0.2.0.25/reunion-0.2.0.25.zip',
    file: 'reunion-0.2.0.25.zip',
    role: 'поддержка нон-стим клиентов',
  },
  {
    name: 'ReVoice', version: '0.1.0.34', platform: 'both',
    url: 'https://github.com/rehlds/ReVoice/releases/download/0.1.0.34/revoice_0.1.0.34.zip',
    file: 'revoice_0.1.0.34.zip',
    role: 'голосовой чат между разными клиентами',
  },
  {
    name: 'AMX Mod X base', version: '1.10.0-git5479', platform: 'linux',
    url: 'https://www.amxmodx.org/amxxdrop/1.10/amxmodx-1.10.0-git5479-base-linux.tar.gz',
    file: 'amxmodx-1.10.0-git5479-base-linux.tar.gz',
    role: 'платформа плагинов, Linux',
  },
  {
    name: 'AMX Mod X cstrike', version: '1.10.0-git5479', platform: 'linux',
    url: 'https://www.amxmodx.org/amxxdrop/1.10/amxmodx-1.10.0-git5479-cstrike-linux.tar.gz',
    file: 'amxmodx-1.10.0-git5479-cstrike-linux.tar.gz',
    role: 'модуль Counter-Strike для AMXX, Linux',
  },
  {
    name: 'AMX Mod X base', version: '1.10.0-git5479', platform: 'windows',
    url: 'https://www.amxmodx.org/amxxdrop/1.10/amxmodx-1.10.0-git5479-base-windows.zip',
    file: 'amxmodx-1.10.0-git5479-base-windows.zip',
    role: 'платформа плагинов + компилятор amxxpc, Windows',
  },
  {
    name: 'AMX Mod X cstrike', version: '1.10.0-git5479', platform: 'windows',
    url: 'https://www.amxmodx.org/amxxdrop/1.10/amxmodx-1.10.0-git5479-cstrike-windows.zip',
    file: 'amxmodx-1.10.0-git5479-cstrike-windows.zip',
    role: 'модуль Counter-Strike для AMXX, Windows',
  },
]

const dirFor = platform => join(ROOT, 'upstream', platform === 'windows' ? 'windows' : platform === 'linux' ? 'linux' : 'common')

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
  return buf.length
}

const force = process.argv.includes('--force')
const manifest = { generated: new Date().toISOString(), components: [] }
let failed = 0

for (const c of COMPONENTS) {
  const dir = dirFor(c.platform)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, c.file)
  try {
    if (existsSync(dest) && !force) {
      process.stdout.write(`= ${c.file} (уже есть)\n`)
    } else {
      const size = await download(c.url, dest)
      process.stdout.write(`+ ${c.file} (${size} байт)\n`)
    }
    manifest.components.push({ ...c, sha256: sha256(dest), size: readFileSync(dest).length })
  } catch (err) {
    failed++
    process.stdout.write(`! ${c.file}: ${err.message}\n`)
    manifest.components.push({ ...c, error: err.message })
  }
}

writeFileSync(join(ROOT, 'upstream', 'MANIFEST.json'), JSON.stringify(manifest, null, 2))
console.log(`\nMANIFEST.json записан: ${manifest.components.length} компонентов, ошибок ${failed}`)
process.exit(failed ? 1 : 0)
