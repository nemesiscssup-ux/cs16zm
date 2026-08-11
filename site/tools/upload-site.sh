#!/usr/bin/env bash
# Заливка сайта привилегий на хостинг.
#
# Кладёт две части в РАЗНЫЕ места, и это главное, что тут можно перепутать:
#
#   site/public/   → /www/<домен>/        рядом с FastDL, наружу видно
#   site/private/  → /private/            ВЫШЕ корня, наружу не видно
#
# ⚠️ ЕСЛИ ПЕРЕПУТАТЬ, config.php с паролем к базе и паролем rcon окажется на
# виду по адресу вида https://домен/config.php. Скрипт проверяет это сам после
# заливки и ругается, если файл вдруг отдался.
#
# ⚠️ FASTDL НЕ ТРОГАЕМ. В /www/<домен>/ живёт cstrike/ с моделями на 260 МБ.
# Скрипт заливает только свои файлы поимённо и ничего не удаляет — никакого
# «синхронизировать каталог», иначе неверный ключ снесёт раздачу игрокам.
#
# ⚠️⚠️ ПОЧЕМУ ПОСЛЕ КАЖДОГО ФАЙЛА СВЕРЯЕТСЯ ДЛИНА. При исчерпанной дисковой
# квоте этот хостинг ведёт себя подло: FTP создаёт файл, обрывает запись и
# отвечает так, что curl считает передачу удавшейся. На сервере остаётся
# обрезок или ноль байт. Один раз так молча обнулился общий код в /private —
# и весь сайт лёг с пятисоткой, хотя «залилось без ошибок». Проверка по имени
# этого не ловит: имя-то есть. Поэтому сверяем ДЛИНУ и повторяем, пока не
# сойдётся.
#
# ⚠️ И ЛИСТИНГ БЕРЁТСЯ С «LIST -a»: без него FTP не показывает файлы, чьё имя
# начинается с точки, и .htaccess вечно числится незалитым.
#
# Учётные данные берутся из netrc, путь к которому передаётся первым
# аргументом: пароль не должен попадать ни в командную строку, ни в репозиторий.
# Формат файла:
#
#   machine 188.127.241.19 login pw792 password ПАРОЛЬ
#
# Запуск:
#   tools/upload-site.sh <netrc> [ftp-хост] [каталог-сайта] [http-база]
#
# Для нашего хостинга значения по умолчанию уже верные:
#   tools/upload-site.sh netrc

set -u

NETRC="${1:?нужен путь к netrc}"
HOST="${2:-188.127.241.19}"
# ⚠️ КАТАЛОГ САЙТА — ПО ИМЕНИ ДОМЕНА. С 12 августа 2026 это zm.hotcs.ru;
# прежний pw792.castledev.ru остался как техническое имя хостинга и всего лишь
# перенаправляет на новый. Зальёте в старый — правки просто не увидят.
REMOTE="${3:-/www/zm.hotcs.ru}"
HTTPBASE="${4:-https://zm.hotcs.ru}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 2

ok=0
same=0
fail=0

# Листинги каталогов кэшируем: один запрос на каталог, а не на файл.
declare -A LISTED

list_dir() {
  local dir="$1"
  if [ -z "${LISTED[$dir]+x}" ]; then
    LISTED[$dir]=$(curl -s --max-time 60 --netrc-file "$NETRC" -X "LIST -a" "ftp://$HOST$dir/" 2>/dev/null)
  fi
  printf '%s' "${LISTED[$dir]}"
}

remote_size() {
  list_dir "$1" | awk -v n="$2" '$9 == n { print $5; exit }'
}

put() {
  local src="$1" dst="$2"
  local dir name want got i
  dir=$(dirname "$dst")
  name=$(basename "$dst")
  want=$(stat -c%s "$src")

  got=$(remote_size "$dir" "$name")
  if [ "$got" = "$want" ]; then
    # ⚠️ РАВНАЯ ДЛИНА ЕЩЁ НЕ ЗНАЧИТ «ТОТ ЖЕ ФАЙЛ». Правка одной цифры длину не
    # меняет: так на сервере осталась старая версия статики (ZM_ASSET_V с '8' на
    # '9'), и правки моделей не доехали до людей — кэш продолжал отдавать
    # прежнее. Поэтому небольшие файлы сверяем ПОБАЙТНО, скачивая их обратно;
    # для моделей на сотни килобайт это было бы дорого, там хватает длины.
    if [ "$want" -le 262144 ]; then
      if curl -s --max-time 60 --netrc-file "$NETRC" "ftp://$HOST$dst" 2>/dev/null | cmp -s - "$src"; then
        same=$((same + 1))
        return 0
      fi
    else
      same=$((same + 1))
      return 0
    fi
  fi

  for i in 1 2 3 4 5; do
    curl -sS --netrc-file "$NETRC" --ftp-create-dirs --connect-timeout 20 --max-time 180 \
      -T "$src" "ftp://$HOST$dst" >/dev/null 2>&1
    got=$(curl -s --max-time 60 --netrc-file "$NETRC" -X "LIST -a" "ftp://$HOST$dir/" 2>/dev/null \
          | awk -v n="$name" '$9 == n { print $5; exit }')
    if [ "$got" = "$want" ]; then
      echo "  + $dst"
      ok=$((ok + 1))
      return 0
    fi
    sleep $((i * 2))
  done

  echo "  ! $dst — на сервере «$got» вместо $want байт"
  fail=$((fail + 1))
  return 1
}

echo "Открытая часть → $REMOTE"
while IFS= read -r f; do
  put "$f" "$REMOTE/${f#public/}"
done < <(find public -type f | sort)

echo
echo "Закрытая часть → /private"
while IFS= read -r f; do
  rel="${f#private/}"
  # config.php живёт только на сервере и правится там: в нём настоящие пароли.
  [ "$rel" = "config.php" ] && { echo "  · пропущен config.php — он правится прямо на сервере"; continue; }
  put "$f" "/private/$rel"
done < <(find private -type f | sort)

echo
echo "Проверяю, что закрытое осталось закрытым"
for probe in /config.php /config.sample.php /app/db.php /private/config.php /_boot.php; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HTTPBASE$probe" || echo '000')"
  if [ "$code" = "200" ]; then
    echo "  ! ОПАСНО: $HTTPBASE$probe отдаётся (код 200)"
    fail=$((fail + 1))
  else
    echo "  · $probe — $code, как и должно быть"
  fi
done

echo
echo "Проверяю, что открытое открыто"
for probe in / /privileges.php /shop.php /admin/login.php; do
  echo "  · $probe — $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HTTPBASE$probe" || echo '000')"
done
# Раздача игрокам идёт по HTTP и редиректов не переживает: движок GoldSource
# не умеет ни TLS, ни переходов. Проверяем именно так, как ходит клиент.
echo "  · FastDL по http — $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://${HTTPBASE#https://}/cstrike/" || echo '000') (403 — это норма, листинг закрыт)"

echo
echo "Залито: $ok, уже совпадало: $same, не удалось: $fail"
[ "$fail" -eq 0 ]
