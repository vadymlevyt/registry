# Знайдені проблеми під час TASK SaaS Foundation v1

**Дата:** 2026-05-04
**Виконавець:** Claude Code Opus 4.7 (1M context)
**Скоуп:** проблеми зафіксовано, але **не виправлено** в цьому TASK (поза скоупом).

---

## 1. agentHistory — три паралельних джерела даних

**Серйозність:** середня (архітектурний борг, не баг — поки що дані не розходяться у видимий спосіб).

**Опис:**
`agentHistory` зараз зберігається одночасно у трьох місцях:

1. **`cases[i].agentHistory[]`** в `registry_data.json` (App.jsx:3228, normalizeCases додає порожній масив).
2. **`localStorage.agent_history_<caseId>`** ([CaseDossier:446](src/components/CaseDossier/index.jsx#L446)) — локальний кеш окремо.
3. **`agent_history.json`** на Drive у папці справи ([CaseDossier:517](src/components/CaseDossier/index.jsx#L517)) — окремий файл.

**Чому це борг:**
- Немає єдиного джерела правди. При синхронізації між пристроями (особливо коли користувач переключається між вкладками браузера або iPad/Mac) можуть лишитися різні версії історії.
- `cases[i].agentHistory` роздуває `registry_data.json` — кожне повідомлення з агентом → +N байт у головний файл.
- Якщо очистити localStorage → втрачається кеш; читання з Drive повільне.

**Рекомендація для майбутнього TASK:**
- Винести з `cases[i].agentHistory` повністю.
- Залишити **тільки** `agent_history.json` на Drive як джерело правди.
- localStorage використовувати як **read-only кеш** з TTL (наприклад, 1 година) — щоб не качати з Drive на кожне відкриття досьє.
- Додати флаг `agentHistoryLastSync` в state щоб уникати зайвих читань.

**Орієнтовно:** окремий TASK на 2-3 години.

---

## 2. `levytskyi_action_log` дублює `auditLog[]` частково

**Серйозність:** низька (легка плутанина, не критично).

**Опис:**
`logAction` ([App.jsx:4289](src/App.jsx)) пише в `localStorage.levytskyi_action_log` записи виду:
```
{ ts, userId, agentId, action, caseId }
```

Цей лог працює паралельно з новим `auditLog[]` в registry_data. Семантично різні (action_log — для аналітики usage, auditLog — для критичних дій), але назва і поля схожі — **легко переплутати**.

**Рекомендація:**
- Перейменувати `logAction` → `usageLog.logAction` або переставити в існуючий `usageLog` об'єкт ([App.jsx:~2700](src/App.jsx)).
- Можливо в майбутньому злити з аналітичним підрозділом auditLog (статус='analytics' замість 'done'/'pending'/'failed').

**Орієнтовно:** 30 хв.

---

## 3. id справ — змішані типи (number vs string)

**Серйозність:** низька (працює завдяки `String()` coerce, але потенційний джерело помилок).

**Опис:**
- `INITIAL_CASES`: `id: 1, 2, ..., 20` (number).
- ACTIONS.create_case: `id: \`case_${Date.now()}\`` (string).
- addCase (UI): `id: Date.now()` (number).

Скрізь у коді використовується `String(c.id) === String(otherId)` — отже не ламається. Але ризик: якщо хтось напише `c.id === 'case_123'` без String() — буде silent failure.

**Адвокат: «НЕ виправляти»** — рішення зафіксовано в Q-сесії TASK SaaS Foundation. Залишаю як є, фіксую борг для майбутнього.

**Рекомендація:**
- При наступному масштабному рефакторингу cases — перевести всі id на string з префіксом `case_`.
- Зробити одну міграцію `migrateCaseId(c)` яка перетворює `1 → 'case_1'` тощо.

---

## 4. driveService.writeCases — DEPRECATED, але залишено

**Серйозність:** інформаційна.

**Опис:**
Після SaaS Foundation `writeCases(token, cases)` пише ТІЛЬКИ масив cases (відкат до schemaVersion 1). Зараз єдиний caller — `AnalysisPanel.connectDrive` (App.jsx:~3018, через `readCases`), який лише читає. Але `writeCases` лишився expoсit'ом для зворотної сумісності.

**Рекомендація:**
- Прибрати `writeCases` після переконання що жодне місце не пише через нього.
- Альтернатива: перетворити в no-op + console.warn.

**Орієнтовно:** 15 хв перевірки + видалення.

---

## 5. PROCEEDINGS і DOCUMENTS у Брановський

**Серйозність:** низька (не баг, але виходить за схему).

**Опис:**
Тільки одна справа (Брановський, INITIAL_CASES[3]) має поля `proceedings[]` і `documents[]`. Решта справ — без них. Це демо-дані для CaseDossier proceedings UI.

**Рекомендація:**
- При написанні Document Processor як окремого сервісу — нормалізувати: усі справи мають порожні `proceedings: []` і `documents: []` за замовчуванням.
- Додати в `normalizeCases`.

---

## Підсумок

| # | Тема | Серйозність | Скоуп фіксу |
| - | ---- | ----------- | ----------- |
| 1 | agentHistory — 3 джерела | середня | окремий TASK 2-3 год |
| 2 | levytskyi_action_log vs auditLog | низька | 30 хв |
| 3 | id mixed types | низька | майбутній рефакторинг |
| 4 | driveService.writeCases deprecated | інформаційна | 15 хв |
| 5 | proceedings/documents не нормалізовано | низька | в межах Document Processor TASK |

**Жоден з цих пунктів не блокує SaaS Foundation v1** — фіксую тут для майбутніх сесій.
