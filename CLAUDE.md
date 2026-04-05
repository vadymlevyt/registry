# CLAUDE.md — Legal BMS АБ Левицького

## Що це за проект
Реєстр справ адвокатського бюро Левицького.
Стек: React 18 + Babel CDN, один файл index.html (~3100 рядків).
Хостинг: GitHub Pages — https://vadymlevyt.github.io/registry/
Репо: github.com/vadymlevyt/registry

## КРИТИЧНЕ ПРАВИЛО №1 — Гілки
Завжди працювати в гілці main. НЕ створювати окремі гілки.
Після змін: git add -A && git commit -m "..." && git push origin main

## КРИТИЧНЕ ПРАВИЛО №2 — textarea в QI
textarea в Quick Input ЗАВЖДИ має фіксовану height: 120px.
НЕ flex:1, НЕ min-height, НЕ height:100%.
Кнопки (Файл/Нотатка/Аналізувати) розміщуються поза scrollable div з flexShrink:0.
Порушення цього правила виштовхує кнопки за межі екрану.

## КРИТИЧНЕ ПРАВИЛО №3 — Merge конфлікти
При merge двох версій коду — НІКОЛИ не залишати обидва варіанти.
Перевіряти після merge:
- Немає дублікатів змінних (accessibleFile і workingFile одночасно)
- Немає мертвого коду після return
- В catch блоках немає return який блокує fallback

## КРИТИЧНЕ ПРАВИЛО №4 — Blank page
Blank page = JS помилка яка не перехоплена.
При будь-якій зміні в async функціях — обгортати в try/catch.
Особливо: pdfjsLib, FileReader, fetch до API.
При помилці — показувати setErrorCategory(), не давати сторінці впасти.

## КРИТИЧНЕ ПРАВИЛО №5 — Апострофи в українському тексті
Апостроф у словах (пам'ять, пов'язаний) в JS рядках в одинарних лапках — ламає синтаксис.
Весь україномовний текст — в подвійних лапках або шаблонних рядках (`...`).

## АРХІТЕКТУРА СИСТЕМИ

### Два окремих system prompt (НЕ один спільний):
- HAIKU_SYSTEM_PROMPT — для аналізу документів. Повертає ТІЛЬКИ JSON.
- SONNET_CHAT_PROMPT — для чату. Повертає текст + ACTION_JSON.
Змішувати не можна — Haiku плутається і перестає повертати JSON.

### ACTION_JSON парсинг — depth counter, НЕ regex:
```js
const idx = responseText.indexOf('ACTION_JSON:');
const start = responseText.indexOf('{', idx);
let depth = 0;
for (let i = start; i < responseText.length; i++) {
  if (responseText[i] === '{') depth++;
  else if (responseText[i] === '}') { depth--; if (depth === 0) { ... } }
}
```
Regex [\s\S]*? зупиняється на першій } — не використовувати для JSON.

### Моделі:
- claude-haiku-4-5-20251001 — аналіз документів (Haiku)
- claude-sonnet-4-20250514 — чат команди (Sonnet)

### Дії в sendChat — обробники є для:
update_case_date, update_deadline, update_case_field,
update_case_status, delete_case, create_case, save_note

Для кожної нової дії — додавати окремий блок в sendChat.
Агент без обробника пише "виконую" але нічого не робить.

### findCaseForAction — пошук по 5 варіантах:
1. Точний збіг імені
2. Базове ім'я без номера в дужках
3. По номеру справи case_no
4. Часткове співпадіння
5. По прізвищу в полі client

### handleFile — читання файлів:
- Завжди використовувати workingFile (не accessibleFile, не file напряму)
- MIME fallback якщо немає розширення в імені
- Drive файли з хмари не читаються через <input> на Android — це обмеження платформи

## СТРУКТУРА ДАНИХ

### Справа (Case):
id, name, client, category (civil/criminal/military/administrative),
status (active/paused/closed), court, case_no,
hearing_date (YYYY-MM-DD), hearing_time (HH:MM),
deadline (YYYY-MM-DD), deadline_type, next_action, notes

### Нотатки:
localStorage 'levytskyi_notes' — масив {text, result, ts}

### Drive sync:
registry_data.json на Google Drive.
Scope: drive.file (тільки файли створені системою).
Token: localStorage 'levytskyi_drive_token'.

## ПІСЛЯ VITE (не зараз)
- Блокнот — src/components/Notebook/
- Календар — src/components/Calendar/
- Досьє справи — src/components/CaseDossier/
- Google Picker API для Drive файлів
- Семантична перевірка дублів документів

## ПОТОЧНИЙ СТАН
Фаза 1 завершена. Фаза 2 в процесі.
Наступний крок: перехід на Vite (потрібен десктоп).
