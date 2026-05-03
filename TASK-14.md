# TASK.md — Фікс blank page при зображеннях (QI-C1)
# Legal BMS | АБ Левицького
# Дата: 03.05.2026
# ТІЛЬКИ КРИТИЧНИЙ БАГ — решта в окремому TASK

---

## КРОК 0 — ПРОЧИТАТИ LESSONS.md

```bash
cat LESSONS.md
```

---

## КОНТЕКСТ

При підставленні скріншоту (PNG/JPG) або зображення в QI —
сайт падає в чорний екран (blank page).

Діагностика показала:
- analyzeImageWithVision (1229-1280) — захищена, catch є
- Проблема в гілці зображень: readImageAsBase64 → reader.onload
  викликає analyzeImageWithVision але якщо там падає виняток —
  він летить з onload і нічим не перехоплюється
- ErrorBoundary в App.jsx відсутній

---

## ФІКС 1 — Знайти точне місце падіння

```bash
sed -n '1060,1160p' src/App.jsx
```

Знайти гілку обробки зображень в handleFile.
Перевірити чи є там try/catch навколо:
- виклику readImageAsBase64
- виклику analyzeImageWithVision після отримання base64

Виписати рядки де захист відсутній.

---

## ФІКС 2 — Обгорнути handleFile в try/catch

Знайти функцію handleFile:

```bash
grep -n "const handleFile\|handleFile = " src/App.jsx | head -5
```

Якщо немає зовнішнього try/catch — обгорнути весь вміст:

```javascript
const handleFile = async (file) => {
  try {
    // весь існуючий код без змін
  } catch (err) {
    console.error('handleFile error:', err);
    setErrorCategory('extraction_failed');
    setErrorDetail('Не вдалось обробити файл. Спробуйте ще раз.');
    setLoading(false);
  }
};
```

---

## ФІКС 3 — Захистити reader.onload

Знайти reader.onload в readImageAsBase64:

```bash
grep -n "reader.onload\|onload" src/App.jsx | head -10
```

Знайти місце де після onload викликається analyzeImageWithVision.
Обгорнути виклик в try/catch якщо немає:

```javascript
reader.onload = async () => {
  try {
    const base64 = reader.result.split(',')[1];
    const result = await analyzeImageWithVision(base64);
    // існуючий код обробки результату
  } catch (err) {
    console.error('Vision error:', err);
    setErrorCategory('extraction_failed');
    setErrorDetail('Не вдалось розпізнати зображення. Спробуйте ще раз.');
    setLoading(false);
  }
};
```

---

## ФІКС 4 — Додати ErrorBoundary в main.jsx

Відкрити src/main.jsx. Додати клас перед викликом render:

```javascript
import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('App crash:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          color: 'white',
          background: '#1a1a2e',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem'
        }}>
          <h2>Щось пішло не так</h2>
          <p style={{color:'#aaa', textAlign:'center'}}>
            {this.state.error?.message || 'Невідома помилка'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1.5rem',
              background: '#4f8ef7',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '1rem'
            }}
          >
            Перезавантажити
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

Обгорнути App:

```javascript
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
```

---

## ФІКС 5 — Прибрати DEBUG коментар

```bash
grep -n "DEBUG" src/App.jsx
```

Видалити знайдений рядок з // DEBUG коментарем (~1216).

---

## ПЕРЕВІРКА

```bash
grep -n "ErrorBoundary" src/main.jsx
grep -n "handleFile.*try\|try.*handleFile" src/App.jsx
grep -n "DEBUG" src/App.jsx
```

---

## ТЕСТОВА МАТРИЦЯ після деплою

1. Підставити PNG скріншот з Viber
   → Vision читає зображення і розпізнає текст
   → НЕ blank page за жодних умов

2. Підставити PDF скан (зображення всередині)
   → pdf.js бачить мало тексту (< 50 символів)
   → автоматично йде через Vision
   → розпізнає як зображення

3. Підставити пошкоджений або незрозумілий файл
   → показує повідомлення про помилку
   → НЕ blank page, НЕ крашиться

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: blank page захист — try/catch handleFile + ErrorBoundary" && git push origin main
```

---

## ДОПИСАТИ В LESSONS.md

```
### [2026-05-03] blank page фікс
- ErrorBoundary в main.jsx — захист від будь-якого краша React
- handleFile обгорнуто в try/catch
- reader.onload → analyzeImageWithVision захищено try/catch
- Скріншоти PNG/JPG тепер обробляються через Vision без краша
- PDF скани (< 50 символів тексту) автоматично йдуть через Vision
```
