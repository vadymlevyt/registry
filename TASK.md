# TASK — Точкові фікси модалки нотатки
# Legal BMS | АБ Левицького | 2026-05-02

Прочитай CLAUDE.md перед початком. Працюємо в гілці main.

---

## БЛОК 1 — Модалка нотатки: додати вибір справи

Файл: `src/components/Dashboard/index.jsx`

Знайти JSX модалки де `modalType === 'note'`.
Додати селект справи — опційний (не обов'язковий):

```jsx
<div style={{ marginBottom: 8 }}>
  <div style={{ fontSize: 10, color: 'var(--text3,#5a6080)', marginBottom: 3 }}>
    СПРАВА (необов'язково)
  </div>
  <select
    value={modalCaseId}
    onChange={e => setModalCaseId(e.target.value)}
    style={{
      width: '100%', padding: '6px 8px', borderRadius: 5,
      background: 'var(--surface2,#222536)', color: 'var(--text,#e8eaf0)',
      border: '1px solid var(--border,#2e3148)', fontSize: 12
    }}>
    <option value=''>— Без прив'язки до справи —</option>
    {cases.filter(c => c.status === 'active').map(c => (
      <option key={c.id} value={c.id}>{c.name}</option>
    ))}
  </select>
</div>
```

---

## БЛОК 2 — Модалка нотатки: прибрати "Час на дорогу"

Знайти блок "🚗 Додати час на дорогу" в JSX модалки.
Він має показуватись ТІЛЬКИ коли `modalType === 'hearing'`.

Перевірити і виправити умову:
```jsx
{modalType === 'hearing' && (
  <div>🚗 Додати час на дорогу...</div>
)}
```

---

## ПІСЛЯ ВИКОНАННЯ

```bash
npm run build
git add -A
git commit -m "fix: note modal — case select + remove travel time"
git push origin main
```

Перевірити:
1. Модалка нотатки має селект справи (необов'язковий)
2. Модалка нотатки не має "Час на дорогу"
3. Модалка засідання має "Час на дорогу" як раніше
