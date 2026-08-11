// Аудит одной сборки CS 1.6: обход дерева, классификация, применение правил, отчёт.
//
// Запуск: node tools/scan.mjs <каталог-сборки> <slug> [--defender]
// Результат: reports/<slug>.json и reports/<slug>.md

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectFile, asciiStrings } from './amxx.mjs'
import { evaluatePlugin, evaluateConfig, evaluateScript, evaluateBinaryStrings, evaluateUsersIni, analyzeSource, SEVERITY, SEVERITY_NAMES } from './rules.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const EXEC_EXT = new Set(['.exe', '.dll', '.so', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.jar', '.scr', '.com', '.msi', '.sh', '.bin'])
const NATIVE_EXT = new Set(['.dll', '.so', '.exe', '.bin'])
const SCRIPT_EXT = new Set(['.bat', '.cmd', '.ps1', '.vbs', '.sh'])
const CONFIG_EXT = new Set(['.cfg', '.ini', '.txt', '.rc'])
const CONTENT_EXT = new Set(['.mdl', '.wav', '.mp3', '.spr', '.bsp', '.tga', '.bmp', '.wad', '.nav', '.pwf', '.res'])

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else out.push({ path: p, size: st.size })
  }
  return out
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex').toUpperCase()

function loadKnownGood() {
  const p = join(ROOT, 'tools', 'rules', 'known-good.json')
  if (!existsSync(p)) return { hashes: {}, names: new Set() }
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return { hashes: j.hashes ?? {}, names: new Set(j.officialNames ?? []) }
  } catch { return { hashes: {}, names: new Set() } }
}

function readTextSafe(path, limit = 2 * 1024 * 1024) {
  try {
    const buf = readFileSync(path)
    return buf.subarray(0, limit).toString('latin1')
  } catch { return '' }
}

function defenderScan(target) {
  const exe = 'C:\\Program Files\\Windows Defender\\MpCmdRun.exe'
  if (!existsSync(exe)) return { available: false }
  try {
    const out = execFileSync(exe, ['-Scan', '-ScanType', '3', '-File', target], {
      encoding: 'latin1', timeout: 15 * 60 * 1000, windowsHide: true,
    })
    return { available: true, threatFound: false, output: out.trim().slice(0, 4000) }
  } catch (err) {
    // Код возврата 2 = найдена угроза; всё остальное — сбой запуска.
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim().slice(0, 4000)
    return { available: true, threatFound: err.status === 2, exitCode: err.status, output: out }
  }
}

// ─────────────────────────────── основной проход ───────────────────────────────

const target = process.argv[2]
const slug = process.argv[3]
const withDefender = process.argv.includes('--defender')
if (!target || !slug) {
  console.error('использование: node tools/scan.mjs <каталог-сборки> <slug> [--defender]')
  process.exit(2)
}
if (!existsSync(target)) { console.error(`нет такого каталога: ${target}`); process.exit(2) }

// --no-known-good нужен для калибровки: заставляет прогнать правила даже по
// заведомо оригинальным файлам, чтобы измерить ложные срабатывания.
const kg = process.argv.includes('--no-known-good') ? { hashes: {}, names: new Set() } : loadKnownGood()
const knownGood = kg.hashes
const officialNames = kg.names
const files = walk(target)
const report = {
  slug,
  target,
  scanned: new Date().toISOString(),
  totals: { files: files.length, bytes: files.reduce((s, f) => s + f.size, 0) },
  defender: null,
  findings: [],
  plugins: [],
  sourceFindings: [],
  inventory: { executables: [], scripts: [], configs: [], plugins: 0, sources: 0, content: 0, other: 0 },
}

// Индекс исходников: имя без расширения -> путь .sma
const sources = new Map()
for (const f of files) {
  if (extname(f.path).toLowerCase() === '.sma') {
    sources.set(basename(f.path, extname(f.path)).toLowerCase(), f.path)
    report.inventory.sources++
  }
}

const officialModified = []
const rel = p => relative(target, p).split(sep).join('/')
const push = (severity, rule, why, evidence, file) =>
  report.findings.push({ severity, rule, why, evidence, file: rel(file) })

for (const f of files) {
  const ext = extname(f.path).toLowerCase()
  const name = basename(f.path)

  if (ext === '.amxx') {
    report.inventory.plugins++
    let buf
    try { buf = readFileSync(f.path) } catch { continue }
    const hash = sha256(buf)
    const good = knownGood[hash]
    const stem = basename(name, ext).toLowerCase()
    const hasSource = sources.has(stem)

    if (good) {
      report.plugins.push({ file: rel(f.path), hash, verdict: 'known-good', knownAs: good, hasSource, findings: [] })
      continue
    }
    // Имя официального плагина при другом содержимом: либо версия AMXX, которой у нас
    // нет для сверки, либо подмена. Разбирать общими правилами бесполезно — admincmd
    // и должен уметь всё; нужна сверка с апстримом той же версии.
    if (officialNames.has(name.toLowerCase())) {
      officialModified.push(rel(f.path))
      report.plugins.push({ file: rel(f.path), hash, verdict: 'official-name-other-content', hasSource, findings: [] })
      continue
    }
    let info
    try { info = inspectFile(f.path) } catch (err) {
      push('medium', 'amxx-unreadable', 'Файл не разбирается как плагин AMX Mod X.', err.message, f.path)
      report.plugins.push({ file: rel(f.path), hash, verdict: 'unreadable', error: err.message, hasSource, findings: [] })
      continue
    }
    const natives = [...new Set(info.plugins.flatMap(p => p.natives ?? []))]
    const strings = [...new Set(info.plugins.flatMap(p => p.strings ?? []))]
    const publics = [...new Set(info.plugins.flatMap(p => p.publics ?? []))]
    const findings = evaluatePlugin({ name, natives, strings, publics, hasSource })
    for (const fi of findings) push(fi.severity, fi.rule, fi.why, fi.evidence, f.path)
    report.plugins.push({
      file: rel(f.path), hash, hasSource,
      verdict: findings.some(x => x.severity === 'critical') ? 'dirty'
             : findings.some(x => x.severity === 'high') ? 'suspicious'
             : findings.length ? 'noted' : 'ok',
      natives: natives.length, strings: strings.length, findings,
    })
    continue
  }

  if (ext === '.sma') {
    // Исходники проверяются теми же правилами: сборка может раздавать закладку
    // именно в виде .sma, рассчитывая, что администратор скомпилирует её сам.
    // Оригинальные исходники AMXX узнаём по хэшу и не трогаем: admincmd.sma
    // обязан работать с rcon_password, это его прямое назначение.
    let srcBuf
    try { srcBuf = readFileSync(f.path) } catch { continue }
    if (knownGood[sha256(srcBuf)]) continue
    if (officialNames.has(name.toLowerCase())) { officialModified.push(rel(f.path)); continue }
    const { natives, strings } = analyzeSource(srcBuf.toString('latin1'))
    const findings = evaluatePlugin({ name, natives, strings, publics: [], hasSource: true })
    for (const fi of findings) push(fi.severity, `src:${fi.rule}`, fi.why, fi.evidence, f.path)
    if (findings.length) {
      report.sourceFindings.push({
        file: rel(f.path),
        verdict: findings.some(x => x.severity === 'critical') ? 'dirty'
               : findings.some(x => x.severity === 'high') ? 'suspicious' : 'noted',
        findings,
      })
    }
    continue
  }

  if (NATIVE_EXT.has(ext)) {
    let buf
    try { buf = readFileSync(f.path) } catch { continue }
    const hash = sha256(buf)
    const good = knownGood[hash]
    report.inventory.executables.push({ file: rel(f.path), size: f.size, hash, knownAs: good ?? null })
    if (good) continue
    // hlds.exe, mp.dll, metamod.so — штатные части серверной поставки. Тревожно не
    // само их наличие, а то, что они не совпадают ни с одним официальным релизом:
    // именно так выглядит пропатченный движок или подменённый модуль.
    //
    // Библиотеки проверять тут ОБЯЗАТЕЛЬНО наравне с .exe. Раньше правило
    // смотрело только на исполняемые файлы, и подмена в .dll/.so проходила мимо —
    // а прятаться удобнее как раз в них: их никто не запускает руками.
    push('medium', 'unverified-executable',
      'Файл не совпадает ни с одним официальным релизом из базы эталонов. '
      + 'Либо это другая версия, либо он изменён. Использовать до сверки нельзя.',
      `${name} (${f.size} байт)`, f.path)
    const strs = asciiStrings(buf, 5)
    for (const fi of evaluateBinaryStrings(name, strs)) push(fi.severity, fi.rule, fi.why, fi.evidence, f.path)
    continue
  }

  if (SCRIPT_EXT.has(ext)) {
    report.inventory.scripts.push(rel(f.path))
    const text = readTextSafe(f.path)
    for (const fi of evaluateScript(name, text)) push(fi.severity, fi.rule, fi.why, fi.evidence, f.path)
    continue
  }

  if (CONFIG_EXT.has(ext)) {
    report.inventory.configs.push(rel(f.path))
    const text = readTextSafe(f.path)
    for (const fi of evaluateConfig(name, text)) push(fi.severity, fi.rule, fi.why, fi.evidence, f.path)
    if (name.toLowerCase() === 'users.ini') {
      for (const fi of evaluateUsersIni(text)) push(fi.severity, fi.rule, fi.why, fi.evidence, f.path)
    }
    continue
  }

  if (CONTENT_EXT.has(ext)) { report.inventory.content++; continue }
  report.inventory.other++
}

// Плагины без исходников — сводно, а не по одному, чтобы не топить отчёт.
const noSource = report.plugins.filter(p => p.verdict !== 'known-good' && !p.hasSource)
if (noSource.length) {
  report.findings = report.findings.filter(f => f.rule !== 'no-source')
  report.findings.push({
    severity: noSource.length > 3 ? 'high' : 'medium',
    rule: 'no-sources',
    why: 'Плагины без парного .sma нельзя пересобрать и сверить — их содержимое недоказуемо.',
    evidence: `${noSource.length} из ${report.plugins.length}: ${noSource.slice(0, 12).map(p => basename(p.file)).join(', ')}`,
    file: '(сводно)',
  })
}

if (officialModified.length) {
  report.officialModified = officialModified
  report.findings.push({
    severity: 'medium',
    rule: 'official-name-other-content',
    why: 'Файлы носят имена официальных плагинов AMX Mod X, но их содержимое не совпадает ни с одной эталонной версией. '
       + 'Обычно это просто другая сборка AMXX, но именно так выглядит и подмена: нужна сверка с апстримом той же версии.',
    evidence: `${officialModified.length} шт.: ${officialModified.slice(0, 10).map(p => basename(p)).join(', ')}`,
    file: '(сводно)',
  })
}

if (withDefender) report.defender = defenderScan(resolve(target))
if (report.defender?.threatFound) {
  report.findings.push({
    severity: 'critical', rule: 'antivirus',
    why: 'Защитник Windows обнаружил угрозу в файлах сборки.',
    evidence: (report.defender.output ?? '').slice(0, 500), file: '(антивирус)',
  })
}

// ─────────────────────────────── вердикт ───────────────────────────────

const worst = report.findings.reduce((m, f) => Math.max(m, SEVERITY[f.severity] ?? 0), 0)
report.verdict = worst >= SEVERITY.critical ? 'dirty'
               : worst >= SEVERITY.high ? 'suspicious'
               : worst >= SEVERITY.medium ? 'untrusted'
               : 'clean'
report.counts = SEVERITY_NAMES.reduce((acc, n) => {
  acc[n] = report.findings.filter(f => f.severity === n).length
  return acc
}, {})

mkdirSync(join(ROOT, 'reports'), { recursive: true })
writeFileSync(join(ROOT, 'reports', `${slug}.json`), JSON.stringify(report, null, 2))

// ─────────────────────────────── отчёт для чтения ───────────────────────────────

const VERDICT_TEXT = {
  dirty: 'ГРЯЗНАЯ — найдены закладки или их прямые признаки',
  suspicious: 'ПОДОЗРИТЕЛЬНАЯ — есть находки высокой важности',
  untrusted: 'НЕ ЗАСЛУЖИВАЕТ ДОВЕРИЯ — явных закладок нет, но проверить содержимое нечем',
  clean: 'ЧИСТАЯ по имеющимся правилам',
}
const order = f => -(SEVERITY[f.severity] ?? 0)
const sorted = [...report.findings].sort((a, b) => order(a) - order(b))

const md = []
md.push(`# Аудит сборки: ${slug}`)
md.push('')
md.push(`**Вердикт: ${VERDICT_TEXT[report.verdict]}**`)
md.push('')
md.push(`Проверено ${report.totals.files} файлов, ${(report.totals.bytes / 1048576).toFixed(1)} МБ. Дата: ${report.scanned.slice(0, 10)}.`)
md.push('')
md.push(`| важность | critical | high | medium | low | info |`)
md.push(`|---|---|---|---|---|---|`)
md.push(`| находок | ${report.counts.critical} | ${report.counts.high} | ${report.counts.medium} | ${report.counts.low} | ${report.counts.info} |`)
md.push('')
md.push(`Состав: плагинов ${report.inventory.plugins}, исходников ${report.inventory.sources}, `
  + `бинарников ${report.inventory.executables.length}, скриптов ${report.inventory.scripts.length}, `
  + `конфигов ${report.inventory.configs.length}, контента ${report.inventory.content}.`)
md.push('')
if (report.defender) {
  md.push(`Защитник Windows: ${report.defender.threatFound ? '**УГРОЗА НАЙДЕНА**' : 'угроз не найдено'}.`)
  md.push('')
}

if (sorted.length) {
  md.push('## Находки')
  md.push('')
  let cur = null
  for (const f of sorted) {
    if (f.severity !== cur) { cur = f.severity; md.push(`### ${cur}`); md.push('') }
    md.push(`- **${f.rule}** — ${f.why}`)
    md.push(`  - файл: \`${f.file}\``)
    md.push(`  - улика: \`${String(f.evidence).replace(/`/g, "'").slice(0, 400)}\``)
  }
  md.push('')
} else {
  md.push('Находок нет.')
  md.push('')
}

const risky = report.plugins.filter(p => p.verdict === 'dirty' || p.verdict === 'suspicious')
if (risky.length) {
  md.push('## Плагины, требующие удаления или замены')
  md.push('')
  for (const p of risky) {
    md.push(`- \`${p.file}\` — ${p.verdict}, исходник ${p.hasSource ? 'есть' : 'ОТСУТСТВУЕТ'}`)
    for (const f of p.findings) md.push(`  - ${f.severity}: ${f.rule}`)
  }
  md.push('')
}

const badSources = report.sourceFindings.filter(s => s.verdict === 'dirty' || s.verdict === 'suspicious')
if (badSources.length) {
  md.push('## Исходники с закладками')
  md.push('')
  md.push('Проблема найдена прямо в тексте плагина — компилировать такое нельзя.')
  md.push('')
  for (const s of badSources) {
    md.push(`- \`${s.file}\` — ${s.verdict}`)
    for (const f of s.findings) md.push(`  - ${f.severity}: ${f.rule} — \`${String(f.evidence).replace(/`/g, "'").slice(0, 160)}\``)
  }
  md.push('')
}

const goodCount = report.plugins.filter(p => p.verdict === 'known-good').length
if (goodCount) md.push(`Совпало с эталоном по SHA256: ${goodCount} плагинов — они заведомо оригинальные.`)

writeFileSync(join(ROOT, 'reports', `${slug}.md`), md.join('\n'))

console.log(`${slug}: ${report.verdict} | critical ${report.counts.critical}, high ${report.counts.high}, `
  + `medium ${report.counts.medium}, low ${report.counts.low} | плагинов ${report.inventory.plugins}, файлов ${report.totals.files}`)
console.log(`отчёт: reports/${slug}.md`)
