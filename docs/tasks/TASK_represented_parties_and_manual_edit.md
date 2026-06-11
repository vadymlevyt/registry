# TASK — representedParties + ручне редагування назви/клієнта + захист ручних правок

**Тип:** спека для сесії-виконавця. Адмін-сесія НЕ реалізує сама.
**Статус:** очікує затвердження адвоката → виконавець.
**Дата:** 2026-06-11
**Підстава:** запит сесії розширення 2026-06-11 (пп.1-2): уточнення сторін уже
долітають у envelope (2 живі прогони), але існуючі справи не отримують
оновлених назв; + нова вимога адвоката — ручне редагування справи в системі.

> Пп.1 і 2 зчеплені одним розрізненням: «назва/client автогенеровані» vs
> «правлені руками». Тому один TASK (правило #11: одне розрізнення — одне
> джерело правди, не два паралельні механізми).

---

## 0. Вимоги

1. **CREATE:** нова справа з `representedParties[]` → назва і `client` будуються
   зі СПИСКУ імен: `[ЄСІТС] Іваненко І.І., Петренко П.П. (case_no)`.
2. **UPDATE існуючої:** якщо назва/client **автогенеровані** (ніколи не правлені
   руками) і прийшли `representedParties` → **оновити** назву/client.
   Якщо адвокат правив руками → **НЕ чіпати** (ручне святе).
3. **Ручне редагування:** адвокат може вручну поправити щонайменше назву і
   клієнта прямо в Legal BMS. Вручну відредаговане поле позначається
   «правлено руками» → авто-оновлення з ЄСІТС його більше не перезаписує.

## 1. Envelope (вже шлеться розширенням; адитивно, version=1)

Per-case опційні: `representedParties: string[]` («Прізвище І.П.»),
`representedPartiesFullNames: string[]`. `primaryParty` = перший елемент
(сумісність). Старі envelope без цих полів — валідні.

## 2. Розрізнення «автогенероване vs ручне» — поле `case.nameSource`

Нове top-level поле справи (одне речення сенсу, правило #11):
**`nameSource: 'auto' | 'manual'`** — хто востаннє визначив name/client:
система (імпорт/автогенерація) чи людина руками.

- `create_case` з `origin='ecits_import'` → `nameSource:'auto'`.
- Ручне створення справи адвокатом (форма) → `'manual'`.
- Ручне редагування name АБО client (UI, або агентський `update_case_field`
  з `field∈{name,client}` від НЕ-court_sync агента) → ставить `'manual'`.
- Дефолт для існуючих справ (міграція/нормалізація): якщо name починається з
  `[ЄСІТС] ` → `'auto'`, інакше `'manual'` (консервативно: усе, що не явно
  автогенероване, вважаємо ручним — щоб нічого не перезаписати помилково).
- БЕЗ bump schemaVersion: адитивне nullable-поле, дефолт виводиться ліниво в
  `ensureCaseSaasAndEcitsFields` + при UPDATE-рішенні (null → виводимо за
  префіксом `[ЄСІТС] `). Якщо виконавець вважає за потрібне formal-міграцію —
  СПИТАТИ адвоката, не вирішувати самому.

> НЕ «два прапори на name і client окремо» — у поточному UX вони міняються
> разом (одне джерело — представлені сторони). Якщо колись треба роздільно —
> тоді й розділимо (золота середина).

## 3. Зміна A — scenarioProcessor: CREATE з representedParties

`buildCreateCaseParams`:
- `partiesArr = Array.isArray(ec.representedParties) && ec.representedParties.length
    ? ec.representedParties : (ec.primaryParty ? [ec.primaryParty] : [])`
- `displayParties = partiesArr.join(', ')`
- `name`: `[ЄСІТС] ${displayParties} (${case_no})` (як зараз, але зі списком);
  без сторін — `[ЄСІТС] ${case_no}` (як зараз).
- `client = displayParties || null`.
- `nameSource: 'auto'`.
- `representedPartiesFullNames` — поки зберегти на справі як
  `case.representedPartiesFullNames[]` (top-level, для майбутнього backfill
  `parties[]`; НЕ чіпати canonical parties[] зараз).

## 4. Зміна B — scenarioProcessor: UPDATE існуючої з representedParties

У гілці «існуюча справа» (`processCase`), якщо envelope-кейс має
`representedParties` (непорожній):
- визначити `effectiveNameSource(existing)`: `existing.nameSource ??
  (String(existing.name||'').startsWith('[ЄСІТС] ') ? 'auto' : 'manual')`;
- якщо `'auto'` → викликати оновлення name/client (новий або існуючий ACTION —
  див. нижче) з новими значеннями за тим самим шаблоном; `nameSource`
  лишається `'auto'`;
- якщо `'manual'` → НЕ чіпати name/client (лише ecitsState як зараз).

**ACTION-шлях (не обходити executeAction):** використати `update_case_field`
двічі (name, client) АБО додати компактний `update_case_identity({caseId, name,
client, nameSource})` — на розсуд виконавця, АЛЕ: виклик від `court_sync_agent`
НЕ має перемикати nameSource на manual; перевірити, що `court_sync_agent` має
відповідний дозвіл у PERMISSIONS (зараз `update_case_field` йому НЕ дозволений —
додати дозвіл або новий ACTION у allowlist; нові ACTIONS — у звіт).

Кейси приймання від розширення: «[ЄСІТС] 757/9362/25-ц» (без імені) → має стати
з іменами Бабенків; «[ЄСІТС] Пироженко Є.В. (363/4635/25)» → Махді А.С.

## 5. Зміна C — ручне inline-редагування назви/клієнта (UI)

UX (узгоджено з пропозицією адвоката, реалізація в дизайн-системі):
- У картці/модалці справи name і client стають **inline-editable**: клік по
  полю (або іконка ✎ поряд) → поле перетворюється на input з курсором →
  Enter/blur зберігає, Esc скасовує.
- Збереження — через `executeAction('update_case_field', {caseId, field, value})`
  від UI-агента (як інші UI-правки) + виставити `nameSource:'manual'`.
- Мінімум: name + client. Інші поля — поза scope (вже є форма редагування).
- Токени дизайн-системи (`tokens.css`), без inline-кольорів.

## 6. Тести (обов'язково, `npm test` зелений)

- buildCreateCaseParams: список → назва «[ЄСІТС] А, Б (no)», client join;
  один елемент → як раніше; без сторін → fallback case_no; nameSource auto.
- UPDATE: existing auto + representedParties → name/client оновлені;
  existing manual → НЕ чіпається; existing без nameSource → виводиться за
  префіксом `[ЄСІТС] `; кейси Бабенки/Махді як інтеграційні.
- Ручне редагування: update_case_field(name) від UI → nameSource manual;
  наступний імпорт з representedParties → name НЕ перезаписаний.
- court_sync-оновлення НЕ ставить manual.
- Старі envelope (без representedParties) — поведінка незмінна.

## 7. Межі / SEMANTIC CLARITY

- `nameSource` — ОДНЕ розрізнення для name+client разом; не плодити по прапору
  на поле. Не плутати з `origin` (звідки справа) і `addedBy`.
- НЕ чіпати canonical `parties[]`/processParticipants (backfill — окремий TASK).
- НЕ перезаписувати name/client коли nameSource='manual' — ЗА ЖОДНИХ умов
  автоматично.
- Двозначність → ЗУПИНИСЬ і спитай.

## 8. Воркфлоу / здача

- НЕ пушити в main. Запуш СВОЮ гілку, назви її → адмін-звірка діфа →
  одне-реченнєве «ок» адвоката → FF.
- Звіт: `docs/reports/report_task_represented_parties_and_manual_edit.md`.

Критерій готовності: CREATE зі списком імен; UPDATE оновлює автогенеровані
назви (Бабенки/Махді-кейси), не чіпає ручні; inline-редагування працює і
захищає поле від авто-перезапису; старі envelope без змін; npm test зелений.
