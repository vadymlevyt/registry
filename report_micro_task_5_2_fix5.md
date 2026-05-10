# Звіт мікро-TASK 5.2-fix5 — scanned PDF теж через pdfjs viewer iframe

**Дата:** 2026-05-10
**Гілка:** main
**Тести:** 481 зелених
**Білд:** успішний

---

## 1. Що зроблено

Уніфіковано рендер усіх PDF (searchable і scanned) у `DocumentViewer` через
`PdfRenderer` (pdfjs viewer iframe Mozilla). Раніше scanned PDF в режимі Скан
показувався через Drive iframe `/preview` — інший тулбар, інша поведінка zoom,
сторонні елементи Drive UI. Тепер один UI для всіх PDF: pdfjs viewer тулбар,
нативне виділення, узгоджений pinch-zoom і scroll.

Для scanned PDF поведінка перемикача незмінна:
- **Скан** — pdfjs viewer iframe (порожній textLayer, бо немає ембедденого
  тексту — це очікувано)
- **Текст** — плашка extracted OCR-тексту (як зараз через `TextContent`)

## 2. Які рядки змінено

**Файл:** `src/components/DocumentViewer/DocumentViewerContent.jsx`

### а) JSDoc-коментар вгорі (рядки 10–28)

Оновлено опис логіки вибору рендеру. Замість «mode='scan' для scanned (PDF/image)
→ Drive iframe / `<img>`» — тепер «PDF (searchable і scanned) → PdfRenderer
(pdfjs viewer iframe)». Зображення винесено в окремий пункт.

### б) Прибрано scanned-PDF-specific гілку в `ScanContent`

Було (рядки 103–115 у попередній версії):

```js
// Scanned PDF — без текстового шару, виділяти нічого. Drive iframe як було.
if (document.documentNature === 'scanned') {
  return (
    <div className="document-viewer__content document-viewer__content--scan">
      <iframe
        className="document-viewer__iframe"
        src={`https://drive.google.com/file/d/${document.driveId}/preview`}
        title={document.name}
        allow="autoplay"
      />
    </div>
  );
}

// Searchable — обираємо власний рендер за типом файлу.
if (isPdf(document)) {
  return <PdfRenderer driveId={document.driveId} name={document.name} />;
}
```

Стало:

```js
// Усі PDF (searchable і scanned) — pdfjs viewer iframe. Одноманітний UI:
// той самий тулбар, та сама поведінка zoom/scroll. Виділення тексту в
// scanned PDF буде порожнім (немає textLayer бо немає ембедденого тексту) —
// це очікувано: для роботи з текстом сканованого документа адвокат
// перемикається на режим Текст і працює з extracted OCR-плашкою.
if (isPdf(document)) {
  return <PdfRenderer driveId={document.driveId} name={document.name} />;
}
```

Гілка для зображень (`mimeType.startsWith('image/')` → `<img>`) — без змін.
Гілка для DOCX (`isDocx` → `DocxRenderer`) — без змін.
Гілка для HTML (`isHtml` → `HtmlRenderer`) — без змін.
Fallback Drive iframe для XLSX/RTF/TXT — без змін.

## 3. Інструкція тестування

### а) Адвокатський запит (scanned PDF)

1. Відкрити справу з документом «Адвокатський запит» (`documentNature: 'scanned'`,
   PDF з Drive).
2. Клік на документ у досьє → `DocumentViewer` відкривається.
3. **Очікувано:** перемикач Скан/Текст видимий, активний — Скан.
4. У режимі Скан: рендериться pdfjs viewer iframe (`pdf-iframe`) — той самий
   тулбар що для searchable PDF (zoom, page-width, navigator стрілки).
   Нема Drive UI обгортки.
5. Клік на «Текст» у перемикачі → плашка з extracted OCR-текстом (не змінилось).
6. Клік назад на «Скан» → знову pdfjs viewer.

### б) Довідка садок (scanned PDF)

Той самий сценарій що (а) — будь-який інший scanned PDF. Поведінка ідентична.

### в) Searchable PDF

1. Відкрити документ «Позов.pdf» (`documentNature: 'searchable'`).
2. **Очікувано:** перемикач прихований (як раніше). Тільки pdfjs viewer.
3. Жодних змін у вигляді — рендер той самий що в попередній версії 5.2-fix4.

### г) Зображення (JPG/PNG/HEIC/WEBP)

1. Відкрити документ-фото (`mimeType: 'image/...'`).
2. **Очікувано:** перемикач Скан/Текст видимий, у режимі Скан — `<img>` з Drive
   (як раніше). У режимі Текст — плашка тексту.
3. Жодних змін.

### д) DOCX, HTML, XLSX

- DOCX → `DocxRenderer` (mammoth → HTML) — без змін.
- HTML → `HtmlRenderer` (charset detection + iframe srcdoc) — без змін.
- XLSX/RTF/TXT → Drive iframe fallback — без змін.

## 4. Що НЕ зроблено

- DocxRenderer і HtmlRenderer не чіпались.
- Зображення через `<img>` — без змін.
- Footer кнопки `DocumentViewer` — без змін.
- Pipeline `AddDocumentModal` — без змін.
- Папка `02_ОБРОБЛЕНІ` і логіка OCR-кешу — без змін.
- Перемикач Скан/Текст для сканованих документів — залишається.
- Жодних змін у структурі схеми документа, міграціях, executeAction.
- Тести не довелось оновлювати — існуючі assertions перевіряли наявність/
  відсутність `iframe.document-viewer__iframe`, а pdfjs viewer рендериться
  через `iframe.pdf-iframe`. Усі 481 тестів зелені без правок.
