// ── DrivePicker · DriveList (TASK 4 · етапи B/B2) ───────────────────────────
// Список елементів папки: стани loading/error(auth|network|http)/empty + hint
// при досягненні PAGE_LIMIT. У multi-режимі чекбокси на файлах; multiFilter
// 'images' ховає не-зображення.
import { filterForPicker, PAGE_LIMIT, FOLDER_MIME } from './helpers.js';
import { DriveListItem } from './DriveListItem.jsx';

export function DriveList({
  items, loading, error, hitLimit, onItemClick, onRetry,
  selectionMode = 'single', multiFilter = 'all', selectedFiles,
}) {
  const filtered = filterForPicker(items, selectionMode, multiFilter);
  const isMulti = selectionMode === 'multi';
  const emptyText = isMulti && multiFilter === 'images' ? 'Зображень не знайдено' : 'Папка порожня';
  return (
    <div className="add-document-modal__drive-list">
      {loading && (
        <div className="add-document-modal__drive-empty">Завантаження...</div>
      )}
      {!loading && error === 'auth' && (
        <div className="add-document-modal__drive-empty">
          Перепідключіть Drive — токен застарів.
          <button
            type="button"
            className="add-document-modal__drive-retry"
            onClick={onRetry}
          >
            Спробувати ще
          </button>
        </div>
      )}
      {!loading && error === 'network' && (
        <div className="add-document-modal__drive-empty">
          Не вдалось завантажити список з Drive.
          <button
            type="button"
            className="add-document-modal__drive-retry"
            onClick={onRetry}
          >
            Повторити
          </button>
        </div>
      )}
      {!loading && error === 'http' && (
        <div className="add-document-modal__drive-empty">
          Помилка Drive API.
          <button
            type="button"
            className="add-document-modal__drive-retry"
            onClick={onRetry}
          >
            Повторити
          </button>
        </div>
      )}
      {!loading && !error && filtered?.length === 0 && (
        <div className="add-document-modal__drive-empty">{emptyText}</div>
      )}
      {!loading && !error && filtered?.map((item) => (
        <DriveListItem
          key={item.id}
          item={item}
          onClick={() => onItemClick(item)}
          selected={selectedFiles?.has?.(item.id) || false}
          showCheckbox={isMulti && item.mimeType !== FOLDER_MIME}
        />
      ))}
      {!loading && !error && hitLimit && (
        <div className="add-document-modal__drive-hint">
          Показано {PAGE_LIMIT}. Перейдіть у вкладену папку щоб уточнити.
        </div>
      )}
    </div>
  );
}
