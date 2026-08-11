// Переименование модели GoldSrc вместе с её ВНУТРЕННИМ именем.
//
// В заголовке studiohdr_t по смещению 8 лежит собственное имя модели (64 байта).
// У моделей из чужих паков оно обычно совпадает со штатным («v_ak47.mdl»), и
// тогда на клиенте рядом оказываются две разные модели с одинаковым именем.
// Переименовать один файл мало — надо править и заголовок.
//
// Длина файла при этом не меняется, поэтому поле length (смещение 72) остаётся
// верным и проверка tools/mdl.mjs продолжает проходить.
//
// Запуск: node tools/mdl-rename.mjs <каталог> <префикс>
//   node tools/mdl-rename.mjs custom/models/zpshop shop_
// Превратит v_ak47.mdl в v_shop_ak47.mdl (префикс ставится ПОСЛЕ v_/p_).

import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const NAME_OFFSET = 8
const NAME_SIZE = 64

export function renameModel(path, newBase) {
  const buf = readFileSync(path)
  if (buf.length < NAME_OFFSET + NAME_SIZE) throw new Error(`${path}: файл короче заголовка`)
  if (buf.readUInt32LE(0) !== 0x54534449) throw new Error(`${path}: это не модель GoldSrc`)

  const bytes = Buffer.from(newBase, 'latin1')
  if (bytes.length >= NAME_SIZE) throw new Error(`имя «${newBase}» не влезает в 64 байта`)

  // Затираем поле целиком, иначе от старого имени останется хвост.
  buf.fill(0, NAME_OFFSET, NAME_OFFSET + NAME_SIZE)
  bytes.copy(buf, NAME_OFFSET)

  const target = join(dirname(path), newBase)
  writeFileSync(path, buf)
  if (target !== path) renameSync(path, target)
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , dirArg, prefix] = process.argv
  if (!dirArg || !prefix) {
    console.error('использование: node tools/mdl-rename.mjs <каталог> <префикс>')
    process.exit(2)
  }

  const dir = resolve(dirArg)
  const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.mdl'))
  if (!files.length) { console.error('моделей не найдено'); process.exit(2) }

  let done = 0
  for (const f of files) {
    // Префикс ставим после v_ / p_, чтобы движок по-прежнему различал
    // вид от первого лица и модель в руках у других игроков.
    const m = f.match(/^([vp]_)(.+)$/i)
    if (!m) { console.log(`= ${f} (не v_/p_, пропущен)`); continue }
    if (m[2].startsWith(prefix)) { console.log(`= ${f} (уже переименован)`); continue }

    const newBase = `${m[1]}${prefix}${m[2]}`
    renameModel(join(dir, f), newBase)
    console.log(`+ ${basename(f)} -> ${newBase} (и внутри заголовка тоже)`)
    done++
  }
  console.log(`\nпереименовано: ${done}`)
}
