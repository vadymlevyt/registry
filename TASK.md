# TASK.md — Точковий фікс: реєстр проступає під досьє
Дата: 08.04.2026

## СУТЬ ПРОБЛЕМИ

Коли відкрите досьє (dossierCase !== null) — реєстр справ все одно
рендерується і видимий знизу під досьє.

Треба: коли відкрите досьє — реєстр НЕ рендерується взагалі.

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md

```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

Знайти де в App.jsx рендеряться реєстр і досьє:

```bash
grep -n "dossierCase\|CaseDossier\|Registry\|currentView.*registry\|registry.*currentView" src/App.jsx | head -30
```

Показати результат. Скоріш за все картина така:
```jsx
{currentView === 'registry' && <Registry ... />}
{dossierCase && <CaseDossier ... />}
```

Або:
```jsx
<Registry ... />  {/* рендерується завжди */}
{dossierCase && <CaseDossier ... />}
```

---

## КРОК 2 — ФІКС

Замінити логіку рендеру на взаємовиключну:

```jsx
{dossierCase
  ? <CaseDossier
      caseData={dossierCase}
      cases={cases}
      notes={notes}
      onClose={() => setDossierCase(null)}
      onUpdateCase={updateCase}
      onAddNote={addNote}
      onDeleteNote={deleteNote}
      apiKey={apiKey}
    />
  : currentView === 'registry' && <Registry
      cases={cases}
      onOpenDossier={setDossierCase}
      onUpdateCase={updateCase}
      apiKey={apiKey}
    />
}
```

Якщо реєстр рендерується в окремому місці (не в тому ж блоці) —
знайти і прибрати або огорнути умовою `{!dossierCase && ...}`.

---

## КРОК 3 — ПЕРЕВІРКА

```bash
grep -n "Registry\|dossierCase" src/App.jsx | head -30
```

Переконатись що немає місця де реєстр рендерується без умови `!dossierCase`.

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: hide registry when dossier is open" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Відкрив досьє — реєстр НЕ видимий знизу
- [ ] Закрив досьє (← Реєстр) — реєстр з'являється знову
- [ ] Universal Panel працює і в досьє і в реєстрі однаково
- [ ] Верхнє меню видиме завжди

---

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] Реєстр і досьє — взаємовиключний рендер
Симптом: реєстр проступає під досьє
Причина: обидва рендеряться одночасно в App.jsx
Рішення: {dossierCase ? <CaseDossier /> : currentView === 'registry' && <Registry />}
Правило: будь-які два "повноекранні" види — завжди взаємовиключні через тернарний оператор
```
