# Handoff — Lane B: UI-борги image editor (нова сесія)

**Дата:** 2026-05-31
**Це продовження** координаційної сесії (relay-тригер, винос дублів, консолідація UI-боргів).
Ти береш **смугу B** плану `docs/consultations/consultation_ui_debt_consolidation_plan.md` —
розгрібання накопичених UI-боргів навколо image-editor / Document Processor.

---

## 1. ЩО ПРОЧИТАТИ НА СТАРТІ (економно — лише це)

**Обовʼязково:**
- `CLAUDE.md` + `DEVELOPMENT_PHILOSOPHY.md` (правило старту; особливо #11 і «Спільний рендер UI»).
- `docs/consultations/consultation_ui_debt_consolidation_plan.md` — **твій бриф** (смуги, межі, порядок).
- `docs/tasks/TASK_imageeditor_share_remaining_helpers.md` — детальна спека B1 (перед кодом — §0 перезаудит).

**Як зразок проробленого патерну** (винос у спільне зроблено САМЕ так — дзеркаль його):
- `docs/tasks/TASK_dp_duplicate_handling_share.md` (винос групування дублів у `grid/displayItems.js`,
  обидва споживачі імпортують, копії видалені, grep-доказ).

**Не читати на старті:** roadmap-файли, історію relay/ai_usage. Лише за потреби.

---

## 2. ТВОЇ ТАСКИ (серіально, один відкритий DP, окремі коміти)

Усе orbits `DpImageMergeEditor.jsx` → **в одній сесії послідовно**, не паралельні гілки на одному файлі.

- **B1 — Винос решти спільних хелперів (#33).** Чисті функції (`cropStateByIndex`, лічильники банера,
  `flatPositions`, `uncertainSet`) у спільне + хук `usePreviewUrls` (Фаза 2). Обидва споживачі
  (модалка `ImageMergePanel/`, DP `DpImageMergeEditor`) **імпортують**, інлайн-копії **видалити**.
  Деталі — у спеці B1. **Першим** — дає чисту дедупльовану базу під B2.
- **B2 — Вільне перетягування між групами + add-group (борг #36/#28).** На очищеній базі:
  `useDroppable` per `GroupSection` (контейнерний ID `g::<docId>::container` уже зарезервований у
  `ItemIdDecode`), `DragOverlay` для прев'ю, reconciliation drop-on-порожню/over-container. Add-group
  лишити необмеженим + зробити порожню групу **придатною drop-ціллю** (зараз марна — drop лише НА фото).
  Продуктовий драйвер: розділити набір фото на N документів, перетягнувши аркуші в нову групу.
- **B3 — Прогрес фото-обробки (фото-частина боргу #34).** Спільний компонент-індикатор (поп-ап/бейдж),
  підключений до фаз `DpImageMergeEditor` startup (`prepareImagesForMerge` + per-group `sortImageDocument`).
  Будувати **одразу спільним** (правило #30), не локальний дубль. **Контекст-частину #34 (CaseDossier)
  НЕ робити** — вона поза смугою B (перетин із Lane C).

---

## 3. МЕЖІ ФАЙЛІВ (анти-колізія — паралельно йдуть інші сесії)

| Смуга | Файли | Хто |
|-------|-------|-----|
| A | `src/App.jsx` | сесія ai_usage guard |
| **B (твоя)** | `DpImageMergeEditor.jsx`, `ImageMergePanel/`, `ImageEditor/` | ти |
| C | clean-text сервіс, `CaseDossier` Огляд, `DocumentProcessorV2/index.jsx` | сесія TASK 3 |

- **НЕ чіпати:** `App.jsx`, `DocumentProcessorV2/index.jsx`, `CaseDossier/index.jsx` (Огляд),
  `contextGenerator.js`. Тільки три файли/теки своєї смуги.
- Якщо B3 «тягне» у CaseDossier (контекст-прогрес) — **зупинись**, це не твоя зона (окремий крок потім).

---

## 4. ПРОЦЕС

- Harness видасть власну гілку `claude/*` — працюй на ній, коміть, пуш.
- **НЕ зводь у main сам.** Закінчив крок (B1/B2/B3) — повідом; координатор (ця сесія) звірить за
  патерном «спільне, нуль дублювання / DnD без регресій» і зробить FF у main. main свіжий.
- Тести: юніт на кожну чисту функцію B1; для B2 — оновити/додати DnD-тести (drop-on-empty-group);
  `npm test` зелений + `npm run build` OK на кожному кроці.
- Звіт наприкінці: `docs/reports/report_laneB_ui_debts.md`.

---

## 5. КОНТЕКСТ — СТАН НА 2026-05-31 (у main)

- ✅ relay-тригер контексту, спільна логіка дублів (`displayItems.js`), ai_usage write-guard, таск-доки.
- 🟡 Борги твоєї смуги: #33 (хелпери→B1), #36/#28 (drag→B2), #34 фото-частина (→B3).
- Паралельно: TASK 3 (clean text, смуга C), глибша діагностика ai_usage (#35, смуга A) — не твоє.
