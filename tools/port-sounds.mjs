// Переносит звуки из скачанных сборок в наш каталог sound/zm_hot.
//
// ЗАЧЕМ. Владелец попросил поискать ещё звуков: оружию, зомби, событиям раунда
// и отсчёту до заражения. Всё это в сборках есть, но лежит в чужих папках с
// чужими именами — и половина завязана на плагины, которых у нас нет.
//
// ⚠️ ПАПКА СВОЯ. Кладём в sound/zm_hot, а не в чужую: у игрока в загрузках
// лежат звуки всех серверов, где он бывал, и файл с тем же путём клиент возьмёт
// СТАРЫЙ. С моделями на этом уже обжигались.
//
// ⚠️ ЧТО НЕ БЕРЁМ. Штатные звуки Half-Life и CS (weapons/, items/, ambience/)
// не переносим вовсе: они есть у каждого игрока, а лишние 20 МБ в раздаче —
// это лишние полминуты на входе.
//
// Запуск: node tools/port-sounds.mjs [--dry]

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'custom', 'content', 'sound', 'zm_hot')

const JP = join(ROOT, 'quarantine', 'justpro-zombie', 'extracted',
  'NEW BALANCE', 'Компелировання', 'sound')

// from — путь внутри сборки, to — наше имя. Имена свои и говорящие: «die03»
// ни о чём не сообщает, а «zombie_die3» видно в конфиге мода без пояснений.
const SOUNDS = [
  // ── отсчёт до заражения ────────────────────────────────────────────────────
  // Голос диктора, числа от одного до пяти. В сборке ими считают до конца
  // голосования; проверено по коду: индекс = сколько секунд осталось минус
  // один, то есть announcer01 — это «один».
  [join(JP, 'jp_maps', 'announcer01.wav'), 'count1.wav'],
  [join(JP, 'jp_maps', 'announcer02.wav'), 'count2.wav'],
  [join(JP, 'jp_maps', 'announcer03.wav'), 'count3.wav'],
  [join(JP, 'jp_maps', 'announcer04.wav'), 'count4.wav'],
  [join(JP, 'jp_maps', 'announcer05.wav'), 'count5.wav'],

  // ── зомби ──────────────────────────────────────────────────────────────────
  [join(JP, 'jp_sounds', 'zombie_pain01.wav'), 'z_pain1.wav'],
  [join(JP, 'jp_sounds', 'zombie_pain02.wav'), 'z_pain2.wav'],
  [join(JP, 'jp_sounds', 'zombie_pain03.wav'), 'z_pain3.wav'],
  [join(JP, 'jp_sounds', 'zombie_pain04.wav'), 'z_pain4.wav'],
  [join(JP, 'jp_sounds', 'zombie_pain05.wav'), 'z_pain5.wav'],
  [join(JP, 'jp_sounds', 'die01.wav'), 'z_die1.wav'],
  [join(JP, 'jp_sounds', 'die02.wav'), 'z_die2.wav'],
  [join(JP, 'jp_sounds', 'die03.wav'), 'z_die3.wav'],
  [join(JP, 'jp_sounds', 'die04.wav'), 'z_die4.wav'],
  [join(JP, 'jp_sounds', 'die05.wav'), 'z_die5.wav'],
  [join(JP, 'jp_sounds', 'brains01.wav'), 'z_idle1.wav'],
  [join(JP, 'jp_sounds', 'brains02.wav'), 'z_idle2.wav'],
  [join(JP, 'jp_sounds', 'jp_scream01.wav'), 'z_infect1.wav'],
  [join(JP, 'jp_sounds', 'jp_scream02.wav'), 'z_infect2.wav'],
  [join(JP, 'jp_sounds', 'jp_scream03.wav'), 'z_infect3.wav'],
  [join(JP, 'jp_sounds', 'jp_scream04.wav'), 'z_infect4.wav'],
  [join(JP, 'jp_sounds', 'nemesis_pain01.wav'), 'nem_pain1.wav'],
  [join(JP, 'jp_sounds', 'nemesis_pain02.wav'), 'nem_pain2.wav'],
  [join(JP, 'jp_sounds', 'nemesis_pain03.wav'), 'nem_pain3.wav'],

  // ── события раунда ─────────────────────────────────────────────────────────
  [join(JP, 'justpro_class_sound', 'humans_win01.wav'), 'win_humans.wav'],
  [join(JP, 'jp_sounds', 'zombies_win01.wav'), 'win_zombies.wav'],
  [join(JP, 'jp_sounds', 'no_win01.wav'), 'win_none.wav'],
  [join(JP, 'zombie_plague', 'armageddon_jp01.wav'), 'round_armageddon.wav'],
  [join(JP, 'zombie_plague', 'madness_jp01.wav'), 'madness.wav'],
  [join(JP, 'zombie_plague', 'make_nemesis_jp01.wav'), 'round_nemesis1.wav'],
  [join(JP, 'zombie_plague', 'make_nemesis_jp02.wav'), 'round_nemesis2.wav'],
  [join(JP, 'zombie_plague', 'make_assassin_jp01.wav'), 'round_assassin.wav'],
  [join(JP, 'zombie_plague', 'sniper01_jp.wav'), 'round_sniper.wav'],
  [join(JP, 'zombie_plague', 'level_jp01.wav'), 'level_up.wav'],
  [join(JP, 'jp_sounds', 'thunderclap01.wav'), 'thunder1.wav'],
  [join(JP, 'jp_sounds', 'thunderclap02.wav'), 'thunder2.wav'],

  // ── серии убийств ──────────────────────────────────────────────────────────
  // Их в сборке объявляет свой плагин, которого у нас нет. Берём только звуки,
  // объявлять будем сами (zp_streaks.sma).
  [join(JP, 'justpro_class_sound', 'first_blood01.wav'), 'streak_first.wav'],
  [join(JP, 'justpro_class_sound', 'double01.wav'), 'streak_double.wav'],
  [join(JP, 'justpro_class_sound', 'triple01.wav'), 'streak_triple.wav'],
  [join(JP, 'justpro_class_sound', 'mega01.wav'), 'streak_mega.wav'],
  [join(JP, 'justpro_class_sound', 'ultra01.wav'), 'streak_ultra.wav'],
  [join(JP, 'justpro_class_sound', 'monster01.wav'), 'streak_monster.wav'],
  [join(JP, 'justpro_class_sound', 'god01.wav'), 'streak_god.wav'],
]

const dry = process.argv.includes('--dry')

let done = 0, bytes = 0, gone = 0
for (const [from, to] of SOUNDS) {
  if (!existsSync(from)) { console.log(`! нет исходника ${from}`); gone++; continue }

  const size = statSync(from).size
  if (!dry) {
    mkdirSync(OUT, { recursive: true })
    copyFileSync(from, join(OUT, to))
  }
  done++
  bytes += size
  console.log(`+ ${to}  (${(size / 1024).toFixed(0)} КБ)`)
}

console.log(dry
  ? `\nпроверка: перенеслось бы ${done} звуков, ${(bytes / 1048576).toFixed(1)} МБ`
  : `\nперенесено ${done} звуков, ${(bytes / 1048576).toFixed(1)} МБ в custom/content/sound/zm_hot`
    + (gone ? `; не нашлось ${gone}` : ''))
