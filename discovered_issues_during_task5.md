# Discovered issues during TASK 5

**Дата:** 2026-05-08

## 1. Vitest 4.x: `environmentMatchGlobs` прибрано

TASK 5.5 пропонував:
```js
environmentMatchGlobs: [['tests/unit/**/*.test.jsx', 'jsdom']]
```

У Vitest 4.x ця опція деприкейтнута / видалена. Не дає очікуваного ефекту — `.jsx` тести запускаються в node і падають з `ReferenceError: document is not defined`.

**Виправлення:** додав `// @vitest-environment jsdom` як перший рядок у кожен `.test.jsx` файл (per-file directive — стабільний API). 5 файлів. Сервісні `.test.js / .test.mjs` лишаються в node за замовчуванням (швидше).

Якщо у майбутньому додаються нові .jsx тести — додай цей коментар першим рядком.

## 2. Vitest потребує `@vitejs/plugin-react` у конфігу

Сам Vitest не транспілює JSX автоматично. Без `plugins: [react()]` падає з `ReferenceError: React is not defined` навіть у jsdom environment.

**Виправлення:** додано `plugins: [react()]` у `vitest.config.js`. Plugin вже був у devDependencies (для Vite).

## 3. App.css містить старі кольори що НЕ збігаються з tokens.css

App.css задає `--accent: #4f7cff`, tokens.css — `--color-accent: #3b82f6`. Це навмисно: TASK 5 явно сказав не чіпати App.css зараз. Старі стилі CaseDossier використовують inline-кольори (`#0d0f1a`, `#1a1d27`, `#2e3148`) — тимчасово залишаються.

**Окремий TASK Migration to tokens** (Фаза 1.6, після TASK 6 базових компонентів):
- Перейменувати `--accent` → `--color-accent` у App.css або створити мост-aliases.
- Замінити inline-кольори в CaseDossier на CSS-змінні.
- Замінити inline-кольори в Dashboard, DocumentProcessor, Notebook.
- Замінити emoji-іконки на lucide-react у міру міграції модулів.

## 4. lucide-react версіонується дивно (1.x замість 0.x)

Поточний npm registry для lucide-react показує лише версії `1.x` (1.11.0–1.14.0). Реальний публічний lucide-react на npmjs.com має версії `0.460+`. Підозрюю особливість конфігурації npm registry в Codespace, або нещодавно змінили версіонування пакету.

Перевірив runtime: `import('lucide-react')` повертає компоненти `ChevronDown`, `Star`, `Trash2` — все працює. Якщо колись виникнуть проблеми сумісності, перевірити чи npm registry повертає очікувану версію.

## 5. Body styles не задаю в tokens.css

TASK 5.1 пропонував body { margin:0, font-family, background } у tokens.css. Я свідомо НЕ зробив цього, бо App.css вже задає background через body і app-shell класи. Дублювання могло б призвести до візуального конфлікту.

`tokens.css` обмежено `* { box-sizing: border-box }` і `button { font-family: inherit }`. Все інше — старий App.css. Очищення глобальних body-стилів — у міграційному TASK.

## 6. 6 packages with vulnerabilities після install

Після `npm install lucide-react` і `@testing-library/react / jsdom`:
```
6 vulnerabilities (1 low, 1 moderate, 4 high)
```
У транзитивних залежностях dev-пакетів (jsdom з'їв половину). Не блокує prod build, не deploy. Окремий TASK безпеки `npm audit` коли почнемо комерціалізацію.
