# TASK.md — Спрощення Сховища + Drive токен для Document Processor
Дата: 08.04.2026

## КРОК 0 — ПРОЧИТАТИ LESSONS.md
```bash
cat LESSONS.md
```

---

## КРОК 1 — ДІАГНОСТИКА

```bash
# Знайти блок Сховище в CaseDossier
grep -n "СХОВИЩЕ\|storageState\|structureStatus\|checkFolder\|handleCreate" src/components/CaseDossier/index.jsx | head -30

# Знайти де передається Drive токен в DocumentProcessor
grep -n "drive_token\|driveToken\|levytskyi_drive_token\|storage.*driveFolderId" src/components/DocumentProcessor/index.jsx | head -20

# Знайти пропси DocumentProcessor в App.jsx або CaseDossier
grep -n "DocumentProcessor\|docProcessor" src/components/CaseDossier/index.jsx | head -10
```

---

## ФІКС 1 — СПРОСТИТИ БЛОК СХОВИЩЕ

Замінити весь складний блок Сховище на простий:

```jsx
// ВИДАЛИТИ:
// - checkFolderStatus і весь structureStatus
// - useEffect що перевіряє структуру
// - handleRestoreFromTrash
// - всі стани: structureStatus, creatingStructure (якщо тільки для структури)
// - кнопку "Змінити папку" і folderBrowser (тимчасово)

// ЗАЛИШИТИ тільки:
const hasFolder = !!storageState?.driveFolderId;

// UI блоку Сховище:
<div style={{ marginTop: 24 }}>
  <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', marginBottom: 8 }}>
    СХОВИЩЕ
  </div>

  {!hasFolder ? (
    // Немає папки — кнопка створити
    <button
      onClick={handleCreateDriveStructure}
      disabled={creatingStructure}
      style={{
        background: creatingStructure ? '#2a2d3e' : '#1a4a8a',
        color: '#fff', border: 'none', borderRadius: 6,
        padding: '8px 16px', cursor: creatingStructure ? 'wait' : 'pointer', fontSize: 13,
      }}
    >
      {creatingStructure ? '⏳ Створюю...' : '📁 Створити структуру на Drive'}
    </button>
  ) : (
    // Папка є — показати назву і кнопку відкрити
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ color: '#4caf50', fontSize: 13 }}>
        ☁️ {storageState.driveFolderName || 'Drive папка'}
      </span>
      <button
        onClick={() => window.open(
          `https://drive.google.com/drive/folders/${storageState.driveFolderId}`,
          '_blank'
        )}
        style={{
          background: 'none', border: '1px solid #333', borderRadius: 6,
          padding: '4px 10px', color: '#aaa', cursor: 'pointer', fontSize: 12,
        }}
      >
        🔗 Відкрити
      </button>
    </div>
  )}

  {/* Повідомлення про результат */}
  {storageMsg && (
    <div style={{
      marginTop: 6, fontSize: 12,
      color: storageMsg.startsWith('✅') ? '#4caf50' : '#f44336',
    }}>
      {storageMsg}
    </div>
  )}
</div>
```

### handleCreateDriveStructure — проста версія:

```jsx
const handleCreateDriveStructure = async () => {
  const token = localStorage.getItem('levytskyi_drive_token');
  if (!token) { showMsg('❌ Підключіть Google Drive'); return; }

  setCreatingStructure(true);
  try {
    const caseName = `${caseData.name}_${caseData.case_no || caseData.id}`
      .replace(/[/\s\\:*?"<>|]+/g, '_');

    const { caseFolderId, caseFolderName } = await createCaseStructure(caseName, token);

    const newStorage = {
      driveFolderId: caseFolderId,
      driveFolderName: caseFolderName,
      localFolderPath: null,
      lastSyncAt: new Date().toISOString(),
    };
    updateCase(caseData.id, 'storage', newStorage);
    setStorageState(newStorage);
    showMsg('✅ Структуру створено: ' + caseFolderName);
  } catch (e) {
    showMsg('❌ Помилка: ' + e.message);
  } finally {
    setCreatingStructure(false);
  }
};
```

---

## ФІКС 2 — ПЕРЕДАТИ DRIVE ТОКЕН І FOLDER ID В DOCUMENT PROCESSOR

Document Processor пише "Drive не підключено" бо не отримує токен і folderId.

### В CaseDossier де рендериться DocumentProcessor — передати пропси:

```bash
# Знайти де рендериться DocumentProcessor
grep -n "DocumentProcessor" src/components/CaseDossier/index.jsx
```

Додати пропси:
```jsx
<DocumentProcessor
  caseData={caseData}
  updateCase={updateCase}
  driveFolderId={storageState?.driveFolderId}
  driveToken={localStorage.getItem('levytskyi_drive_token')}
  // ... інші існуючі пропси
/>
```

### В DocumentProcessor — використати пропси:

```bash
# Знайти як DocumentProcessor отримує пропси
grep -n "props\|driveFolderId\|driveToken\|function DocumentProcessor" src/components/DocumentProcessor/index.jsx | head -10
```

Змінити щоб читав з пропсів замість localStorage напряму:
```jsx
function DocumentProcessor({ caseData, updateCase, driveFolderId, driveToken, ...props }) {
  // Використовувати driveFolderId і driveToken з пропсів
  // замість: const token = localStorage.getItem('levytskyi_drive_token')
  // замість: const folderId = caseData?.storage?.driveFolderId
}
```

### В handleConfirm — перевірити з пропсів:

```jsx
// Замінити перевірку:
if (driveToken && driveFolderId) {
  // записати на Drive
} else {
  addAgentMessage('⚠️ Drive не підключено. Підключіть в блоці Сховище.');
}
```

---

## ДЕПЛОЙ

```bash
git add -A && git commit -m "fix: simplify storage UI, pass drive token to DocumentProcessor" && git push origin main
```

## ЧЕКЛІСТ

- [ ] Досьє без папки → кнопка "📁 Створити структуру на Drive"
- [ ] Після створення → "☁️ [назва папки]" + кнопка "🔗 Відкрити"
- [ ] Кнопка Відкрити → відкриває папку на Drive
- [ ] Нарізав документи → "Підтвердити нарізку" → файли записуються на Drive
- [ ] Матеріали оновлюються після збереження
- [ ] Немає повідомлення "Drive не підключено"

## ПІСЛЯ ВИКОНАННЯ — ДОПИСАТИ В LESSONS.md

```
### [2026-04-08] Сховище — мінімальна логіка
Тільки два стани: немає папки (кнопка Створити) і є папка (назва + Відкрити).
Без перевірки підпапок, без статусів, без Змінити.
Додаткова логіка додається поступово після стабільної базової версії.

### [2026-04-08] DocumentProcessor — Drive через пропси
Передавати driveFolderId і driveToken як пропси з CaseDossier.
Не читати localStorage напряму всередині Document Processor.
```
