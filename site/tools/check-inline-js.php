<?php
/**
 * Поиск обращений к несуществующим именам во встроенных скриптах страниц.
 *
 * ⚠️ ЗАЧЕМ ЭТО ЕСТЬ. Скрипты сайта живут прямо в страницах, и проверить их
 * нечем: php -l смотрит только PHP, а браузера на машине сборки нет. Ошибка
 * вида «переменной нет» синтаксически безупречна и валится лишь при запуске —
 * причём молча: обработчик падает, страница остаётся на месте, и со стороны
 * это выглядит как «кнопка не нажимается».
 *
 * Так уже случалось дважды. Последний раз при замене меню на кнопки удалили
 * список `rows`, которым пользуется draw() двумястами строками выше: первое же
 * нажатие роняло отрисовку, выбор не переключался, подсветка навсегда
 * оставалась на первой кнопке.
 *
 * ⚠️ ЭТО СИТО, А НЕ РАЗБОРЩИК JAVASCRIPT. Оно не понимает области видимости и
 * не отличает свойство от переменной — оно лишь сверяет список имён, которые
 * читаются, со списком объявленных и заведомо известных. Ложные срабатывания
 * возможны: увидели незнакомое имя из браузерного набора — допишите его в
 * $known ниже. Пропуски тоже возможны. Но тот случай, ради которого оно
 * написано, оно ловит, а стоит один запуск.
 *
 * Запуск:  php site/tools/check-inline-js.php
 */

$dir = dirname(__DIR__) . '/public';

/** Что даёт браузер и язык. Список неполный — дополняйте по мере надобности. */
$known = array(
    'window', 'document', 'navigator', 'console', 'location', 'history', 'screen',
    'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
    'RegExp', 'Error', 'Promise', 'Map', 'Set', 'Symbol', 'BigInt',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame', 'fetch', 'alert',
    'Image', 'Element', 'HTMLElement', 'Event', 'CustomEvent', 'FormData',
    'URLSearchParams', 'encodeURIComponent', 'decodeURIComponent',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'NaN', 'Infinity', 'undefined',
    'true', 'false', 'null', 'this', 'arguments', 'globalThis',
    // ключевые слова: попадают в выборку как обычные слова
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
    'do', 'break', 'continue', 'new', 'typeof', 'instanceof', 'in', 'of',
    'try', 'catch', 'finally', 'throw', 'switch', 'case', 'default', 'delete',
    'void', 'class', 'extends', 'super', 'async', 'await', 'yield', 'static',
    'get', 'set', 'use', 'strict',
);

$bad = 0;
$checked = 0;

foreach (glob($dir . '/*.php') as $file) {
    $html = file_get_contents($file);

    // Встроенные скрипты. Внешние (viewer.js) сюда не входят — их проверяют
    // отдельно, целым файлом.
    if (!preg_match_all('~<script>(.*?)</script>~s', $html, $m)) {
        continue;
    }

    foreach ($m[1] as $js) {
        $checked++;

        /*
         * Сперва выбрасываем вставки PHP целиком. Внутри скрипта они дают
         * готовые значения — таблицы цен, названия, — и разбирать их как
         * JavaScript бессмысленно: json_encode и имена переменных PHP попадут
         * в список «неизвестных» и утопят настоящие находки.
         */
        $clean = preg_replace('~<\?.*?\?>~s', ' 0 ', $js);

        // Дальше убираем то, что именами не является: строки, шаблоны,
        // комментарии. Иначе слова из текста попадут в разбор.
        $clean = preg_replace('~/\*.*?\*/~s', ' ', $clean);
        $clean = preg_replace('~//[^\n]*~', ' ', $clean);
        $clean = preg_replace('~"(\\\\.|[^"\\\\])*"~', ' ', $clean);
        $clean = preg_replace("~'(\\\\.|[^'\\\\])*'~", ' ', $clean);
        $clean = preg_replace('~`(\\\\.|[^`\\\\])*`~', ' ', $clean);

        // Объявленные: const/let/var/function/class, разбор списков и деструктуризации.
        $declared = array();
        preg_match_all('~\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)~', $clean, $d);
        $declared = array_merge($declared, $d[1]);
        preg_match_all('~\bfunction\s+([A-Za-z_$][\w$]*)~', $clean, $d);
        $declared = array_merge($declared, $d[1]);
        // Разбор объекта и массива: const { a, b } = …, const [x, y] = …
        preg_match_all('~\b(?:const|let|var)\s*[\{\[]([^\}\]]*)[\}\]]~', $clean, $d);
        foreach ($d[1] as $list) {
            preg_match_all('~[A-Za-z_$][\w$]*~', $list, $names);
            $declared = array_merge($declared, $names[0]);
        }
        // Имена доводов у функций и стрелок — грубо, зато без пропусков.
        preg_match_all('~\(([^()]*)\)\s*(?:=>|\{)~', $clean, $d);
        foreach ($d[1] as $list) {
            preg_match_all('~[A-Za-z_$][\w$]*~', $list, $names);
            $declared = array_merge($declared, $names[0]);
        }
        preg_match_all('~([A-Za-z_$][\w$]*)\s*=>~', $clean, $d);
        $declared = array_merge($declared, $d[1]);
        // Счётчики циклов for…of / for…in.
        preg_match_all('~\bfor\s*\(\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)~', $clean, $d);
        $declared = array_merge($declared, $d[1]);
        /*
         * Имена, объявленные строками, которые собирает PHP прямо в скрипте.
         *
         * ⚠️ Закрывающую скобку PHP в комментариях этого файла писать НЕЛЬЗЯ
         * даже в пояснении: она закрывает режим PHP прямо посреди строки, и
         * дальше всё уезжает в разметку. Здесь на этом уже споткнулись.
         */
        preg_match_all('~\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=~', $js, $d);
        $declared = array_merge($declared, $d[1]);

        $declared = array_unique(array_merge($declared, $known));

        // Используемые: имя, ПЕРЕД которым нет точки (иначе это свойство) и за
        // которым не двоеточие (иначе это ключ объекта).
        preg_match_all('~(?<![.\w$])([A-Za-z_$][\w$]*)\s*(?![\w$]*\s*:)~', $clean, $u);

        $missing = array();
        foreach (array_unique($u[1]) as $name) {
            if (!in_array($name, $declared, true)) {
                $missing[$name] = true;
            }
        }

        if ($missing) {
            printf("%s: неизвестные имена — %s\n", basename($file), implode(', ', array_keys($missing)));
            $bad++;
        }
    }
}

printf("\nпроверено встроенных скриптов: %d, с находками: %d\n", $checked, $bad);
exit($bad === 0 ? 0 : 1);
