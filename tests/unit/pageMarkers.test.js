// Ф1 Smart Triage — pageMarkers: чистий примітив посторінкових маркерів.
// Покриває корінь R5/R6 (немає якорів сторінок → AI галюцинує межі).
import { describe, it, expect } from 'vitest';
import { buildPagedText, isPagedLayout, buildStructuralPassport, buildCompactTriagePassport, resolveBoundaryText } from '../../src/services/documentPipeline/pageMarkers.js';

// Реалістичний об'єкт сторінки Document AI (форма як persist у .layout.json).
const centeredTopBlock = (text) => ({
  layout: { boundingPoly: { normalizedVertices: [
    { x: 0.35, y: 0.05 }, { x: 0.65, y: 0.05 }, { x: 0.65, y: 0.10 }, { x: 0.35, y: 0.10 },
  ] } },
});
const wideBlock = () => ({
  layout: { boundingPoly: { normalizedVertices: [
    { x: 0.05, y: 0.20 }, { x: 0.95, y: 0.20 }, { x: 0.95, y: 0.40 }, { x: 0.05, y: 0.40 },
  ] } },
});

const layout = (texts) => ({ schemaVersion: 1, pages: texts.map((t) => ({ _text: t })) });

describe('pageMarkers.isPagedLayout', () => {
  it('null / порожні pages → false', () => {
    expect(isPagedLayout(null)).toBe(false);
    expect(isPagedLayout({})).toBe(false);
    expect(isPagedLayout({ pages: [] })).toBe(false);
  });

  it('непорожні pages → true', () => {
    expect(isPagedLayout(layout(['a', 'b']))).toBe(true);
  });

  it('expectedPageCount розбіжний (resume — неповний layout) → false', () => {
    expect(isPagedLayout(layout(['a', 'b']), 3)).toBe(false);
    expect(isPagedLayout(layout(['a', 'b', 'c']), 3)).toBe(true);
  });
});

describe('pageMarkers.buildPagedText', () => {
  it('маркер === СТОРІНКА N === перед кожною сторінкою, 1-based', () => {
    const out = buildPagedText(layout(['Позовна заява', 'Ухвала суду']));
    expect(out).toBe('=== СТОРІНКА 1 ===\nПозовна заява\n\n=== СТОРІНКА 2 ===\nУхвала суду');
  });

  it('усі сторінки присутні (НЕ обрізається) — велика справа', () => {
    const big = Array.from({ length: 65 }, (_, i) => `сторінка ${i + 1} `.repeat(1500));
    const out = buildPagedText(layout(big));
    expect(out).toContain('=== СТОРІНКА 1 ===');
    expect(out).toContain('=== СТОРІНКА 65 ===');
    expect(out.length).toBeGreaterThan(50000); // стара 50K-обрізка прибрана
  });

  it('layout непридатний (resume / нема структури) → "" (caller лишається на plain тексті)', () => {
    expect(buildPagedText(null)).toBe('');
    expect(buildPagedText(layout(['a', 'b']), 5)).toBe('');
  });

  it('порожній _text сторінки → маркер без тексту (порожня сторінка лишається видимою AI)', () => {
    const out = buildPagedText({ schemaVersion: 1, pages: [{ _text: '' }, { _text: 'X' }] });
    expect(out).toBe('=== СТОРІНКА 1 ===\n\n\n=== СТОРІНКА 2 ===\nX');
  });
});

describe('pageMarkers.buildStructuralPassport (Ф0)', () => {
  it('контракт як buildPagedText: непридатний layout → ""', () => {
    expect(buildStructuralPassport(null)).toBe('');
    expect(buildStructuralPassport({ pages: [] })).toBe('');
    expect(buildStructuralPassport({ schemaVersion: 1, pages: [{ _text: 'a' }] }, 3)).toBe('');
  });

  it('маркер + текст сторінки завжди присутні (дайджест — додатковий рядок)', () => {
    const out = buildStructuralPassport({ schemaVersion: 1, pages: [{ _text: 'Тіло документа' }] });
    expect(out).toContain('=== СТОРІНКА 1 ===');
    expect(out).toContain('Тіло документа');
  });

  it('заголовок: короткий центрований верхній блок → [заголовок:"..."]', () => {
    const out = buildStructuralPassport({ schemaVersion: 1, pages: [
      { _text: 'РІШЕННЯ\nІменем України...', blocks: [centeredTopBlock(), wideBlock()] },
    ] });
    expect(out).toMatch(/\[.*заголовок:"РІШЕННЯ".*\]/);
  });

  it('широкий некороткий перший блок → без заголовка', () => {
    const out = buildStructuralPassport({ schemaVersion: 1, pages: [
      { _text: 'довгий суцільний абзац тексту без ознак заголовка ' .repeat(4), blocks: [wideBlock()] },
    ] });
    expect(out).not.toContain('заголовок:');
  });

  it('детект скидання нумерації: футер 12 → футер 1 на наступній = СКИДАННЯ-НУМЕРАЦІЇ', () => {
    const out = buildStructuralPassport({ schemaVersion: 1, pages: [
      { _text: 'Документ А, остання сторінка\n12' },
      { _text: 'Документ Б, перша сторінка\n1' },
    ] });
    const p1 = out.split('=== СТОРІНКА 2 ===')[0];
    const p2 = '=== СТОРІНКА 2 ===' + out.split('=== СТОРІНКА 2 ===')[1];
    expect(p1).toContain('футер-№:12');
    expect(p1).not.toContain('СКИДАННЯ-НУМЕРАЦІЇ');
    expect(p2).toContain('футер-№:1');
    expect(p2).toContain('СКИДАННЯ-НУМЕРАЦІЇ');
  });

  it('orientation + dimension + tables + formFields у дайджесті', () => {
    const out = buildStructuralPassport({ schemaVersion: 1, pages: [{
      _text: 'таблична сторінка',
      layout: { orientation: 'PAGE_RIGHT' },
      dimension: { width: 595, height: 842, unit: 'POINTS' }, // A4-портрет ≈ 0.71
      tables: [{}],
      formFields: [{}],
    }] });
    expect(out).toContain('орієнтація:270°');
    expect(out).toContain('формат:портрет(0.71)');
    expect(out).toContain('таблиці');
    expect(out).toContain('поля-форми');
  });

  it('захищеність: відсутні структурні поля → дайджесту нема, паспорт не падає', () => {
    const out = buildStructuralPassport({ schemaVersion: 1, pages: [{ _text: 'лише текст' }] });
    expect(out).toBe('=== СТОРІНКА 1 ===\nлише текст');
  });

  it('повна справа (>50K) не обрізається; кожна сторінка має маркер', () => {
    const pages = Array.from({ length: 65 }, (_, i) => ({ _text: `сторінка ${i + 1} `.repeat(1200) }));
    const out = buildStructuralPassport({ schemaVersion: 1, pages });
    expect(out).toContain('=== СТОРІНКА 1 ===');
    expect(out).toContain('=== СТОРІНКА 65 ===');
    expect(out.length).toBeGreaterThan(50000);
  });
});

// ── ФД-0 · buildCompactTriagePassport (доповнення: масштаб 200-250 стор.) ────
// Критерій якості: компактний паспорт несе СУКУПНІСТЬ дорадчих сигналів межі
// (§3.2) і КРАЇ тексту замість тіла; том не переповнює вікно Haiku. Якщо
// хтось зведе паспорт назад до повнотекстового — ці тести червоні.
describe('pageMarkers.buildCompactTriagePassport (ФД-0)', () => {
  it('контракт порожнечі як у buildPagedText: непридатний layout → ""', () => {
    expect(buildCompactTriagePassport(null)).toBe('');
    expect(buildCompactTriagePassport({ pages: [] })).toBe('');
    expect(buildCompactTriagePassport({ schemaVersion: 1, pages: [{ _text: 'a' }] }, 3)).toBe('');
  });

  it('buildStructuralPassport НЕ зачеплено (окрема функція, той самий вхід)', () => {
    const L = { schemaVersion: 1, pages: [{ _text: 'лише текст' }] };
    expect(buildStructuralPassport(L)).toBe('=== СТОРІНКА 1 ===\nлише текст');
  });

  it('маркери цілі і 1-based для всіх сторінок (том 65 стор.)', () => {
    const pages = Array.from({ length: 65 }, (_, i) => ({ _text: `тіло сторінки ${i + 1} `.repeat(80) }));
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages });
    expect(out).toContain('=== СТОРІНКА 1 ===');
    expect(out).toContain('=== СТОРІНКА 65 ===');
    expect(out).not.toContain('=== СТОРІНКА 66 ===');
    expect((out.match(/=== СТОРІНКА \d+ ===/g) || []).length).toBe(65);
  });

  it('наявні сигнали збережені: orientation+формат+таблиці+поля-форми+заголовок', () => {
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [{
      _text: 'РІШЕННЯ\nІменем України', blocks: [centeredTopBlock(), wideBlock()],
      layout: { orientation: 'PAGE_RIGHT' },
      dimension: { width: 595, height: 842 }, tables: [{}], formFields: [{}],
    }] });
    expect(out).toContain('орієнтація:270°');
    expect(out).toContain('формат:портрет(0.71)');
    expect(out).toContain('таблиці');
    expect(out).toContain('поля-форми');
    expect(out).toMatch(/заголовок:"РІШЕННЯ"/);
  });

  it('детект скидання нумерації збережений (футер 12 → 1)', () => {
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [
      { _text: 'Документ А, остання сторінка\n12' },
      { _text: 'Документ Б, перша сторінка\n1' },
    ] });
    const p2 = '=== СТОРІНКА 2 ===' + out.split('=== СТОРІНКА 2 ===')[1];
    expect(p2).toContain('футер-№:1');
    expect(p2).toContain('СКИДАННЯ-НУМЕРАЦІЇ');
  });

  it('новий сигнал: печатка/підпис з visualElements (тип)', () => {
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [{
      _text: 'договір з печаткою сторін '.repeat(20),
      visualElements: [{ type: 'stamp' }, { type: 'signature' }, { type: 'stamp' }],
    }] });
    expect(out).toContain('печатка/підпис:stamp,signature');
  });

  it('новий сигнал: стрибок якості vs попередня сторінка', () => {
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [
      { _text: 'чіткий друкований документ '.repeat(20), imageQualityScores: { qualityScore: 0.92 } },
      { _text: 'розмитий скан квитанції '.repeat(20), imageQualityScores: { qualityScore: 0.50 } },
    ] });
    const p1 = out.split('=== СТОРІНКА 2 ===')[0];
    const p2 = '=== СТОРІНКА 2 ===' + out.split('=== СТОРІНКА 2 ===')[1];
    expect(p1).not.toContain('стрибок-якості');         // перша сторінка — нема з чим порівняти
    expect(p2).toContain('стрибок-якості:Δ0.42');
  });

  it('новий сигнал: розрідженість (мало блоків + короткий текст)', () => {
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [
      { _text: 'Квитанція №123' },                                  // 0 блоків, короткий → розріджена
      { _text: 'повноцінний абзац документа '.repeat(30), blocks: [wideBlock()] }, // довгий → НЕ розріджена
    ] });
    const p1 = out.split('=== СТОРІНКА 2 ===')[0];
    const p2 = '=== СТОРІНКА 2 ===' + out.split('=== СТОРІНКА 2 ===')[1];
    expect(p1).toContain('розріджена');
    expect(p2).not.toContain('розріджена');
  });

  it('новий сигнал: дельта формату та орієнтації vs попередня', () => {
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [
      { _text: 'А4 портрет документ '.repeat(20), dimension: { width: 595, height: 842 }, layout: { orientation: 'PAGE_RIGHT' } },
      { _text: 'квадратне фото '.repeat(20), dimension: { width: 1000, height: 1000 }, layout: { orientation: 'PAGE_UP' } },
    ] });
    const p2 = '=== СТОРІНКА 2 ===' + out.split('=== СТОРІНКА 2 ===')[1];
    expect(p2).toContain('зміна-формату');
    expect(p2).toContain('зміна-орієнтації');
  });

  it('новий сигнал (слабкий): зміна мови vs попередня', () => {
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [
      { _text: 'українська сторінка тексту '.repeat(20), detectedLanguages: [{ languageCode: 'uk' }] },
      { _text: 'english page of text '.repeat(20), detectedLanguages: [{ languageCode: 'en' }] },
    ] });
    const p2 = '=== СТОРІНКА 2 ===' + out.split('=== СТОРІНКА 2 ===')[1];
    expect(p2).toContain('зміна-мови:uk→en');
  });

  it('сукупність: різнорідні сигнали в ОДНОМУ дужковому дайджесті (квитанція)', () => {
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [
      { _text: 'тіло позовної заяви '.repeat(40), dimension: { width: 595, height: 842 }, imageQualityScores: { qualityScore: 0.95 }, blocks: [wideBlock()] },
      { _text: 'КВИТАНЦІЯ\nсудовий збір 1', blocks: [centeredTopBlock()], dimension: { width: 1000, height: 1000 }, imageQualityScores: { qualityScore: 0.55 }, visualElements: [{ type: 'stamp' }] },
    ] });
    const p2 = '=== СТОРІНКА 2 ===' + out.split('=== СТОРІНКА 2 ===')[1];
    const digest = p2.split('\n')[1];
    expect(digest.startsWith('[')).toBe(true);
    expect(digest.endsWith(']')).toBe(true);
    expect(digest).toContain('заголовок:"КВИТАНЦІЯ"');
    expect(digest).toContain('стрибок-якості');
    expect(digest).toContain('зміна-формату');
    expect(digest).toContain('печатка/підпис');
    expect(digest).toContain('розріджена');
    expect(digest.split(' | ').length).toBeGreaterThanOrEqual(4);
  });

  it('краї тексту замість тіла: head + ⟨…⟩ + tail, середина викинута', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `РЯДОК-${i + 1} короткий зміст`);
    // dimension → сигнал є → edgeText завжди (без неоднозначності fullText).
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [{
      _text: lines.join('\n'), dimension: { width: 595, height: 842 },
    }] });
    expect(out).toContain('РЯДОК-1 короткий');
    expect(out).toContain('РЯДОК-12 короткий');
    expect(out).toContain('⟨…⟩');
    expect(out).not.toContain('РЯДОК-6');                // тіло викинуте
    expect(out).not.toContain('РЯДОК-9');
  });

  it('head/tail обрізані по headChars/tailChars', () => {
    const longHead = 'A'.repeat(2000);
    const longTail = 'B'.repeat(2000);
    const mid = Array.from({ length: 6 }, (_, i) => `mid${i}`).join('\n');
    const out = buildCompactTriagePassport(
      { schemaVersion: 1, pages: [{ _text: `${longHead}\n${mid}\n${longTail}` }] },
      null,
      { headChars: 100, tailChars: 50 },
    );
    const [headPart, tailPart] = out.split('⟨…⟩');
    expect(headPart).toContain('A'.repeat(100));
    expect(headPart).not.toContain('A'.repeat(101));     // cap headChars
    expect(tailPart).toContain('B'.repeat(50));
    expect(tailPart).not.toContain('B'.repeat(51));      // cap tailChars
  });

  it('fullTextIfNoSignal вузький: нема сигналу + коротка → повний _text (середина ціла)', () => {
    // Жодного сигналу: без блоків/dimension/футер-№/мови; текст >200 (не
    // «розріджена») і ≤1200 (коротка). Слова без числа в кінці рядка.
    const words = ['альфа', 'бета', 'гама', 'дельта', 'епсилон', 'дзета', 'ета', 'тета', 'йота', 'каппа', 'лямбда', 'мю'];
    const lines = words.map((w) => `${w} рядок без числа достатньої довжини щоб не бути розрідженим тут`);
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [{ _text: lines.join('\n') }] });
    expect(out).not.toContain('⟨…⟩');                    // не різали — віддали повністю
    expect(out).not.toContain('[');                       // дайджест порожній
    expect(out).toContain('дельта рядок');
    expect(out).toContain('епсилон рядок');
  });

  it('fullTextIfNoSignal НЕ спрацьовує коли є сигнал (краї навіть на короткій)', () => {
    const lines = ['ЗАГОЛОВОК', ...Array.from({ length: 9 }, (_, i) => `рядок ${i + 1}`)];
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [{
      _text: lines.join('\n'), blocks: [centeredTopBlock(), wideBlock()],
    }] });
    expect(out).toContain('заголовок:"ЗАГОЛОВОК"');       // сигнал є
    expect(out).toContain('⟨…⟩');                        // отже краї, не повний текст
  });

  it('fullTextIfNoSignal НЕ спрацьовує на довгій сторінці без сигналу (краї)', () => {
    const body = Array.from({ length: 10 }, (_, i) => `LN${i} ${'довгий зміст '.repeat(30)}`).join('\n');
    expect(body.length).toBeGreaterThan(1200);            // > ambiguousMaxChars
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [{ _text: body }] });
    expect(out).toContain('⟨…⟩');
    expect(out).not.toContain('LN5');
  });

  it('у рази компактніший за buildStructuralPassport на великій сторінці', () => {
    const big = { schemaVersion: 1, pages: [{ _text: 'слово '.repeat(8000) }] }; // ~48K симв.
    const structural = buildStructuralPassport(big);
    const compact = buildCompactTriagePassport(big);
    expect(structural.length).toBeGreaterThan(40000);
    expect(compact.length).toBeLessThan(structural.length / 10);
  });

  it('том 250 стор. компактного паспорта тримається в зоні якості (статичний baseline)', () => {
    // Кирилиця ~2 симв/токен (спека §0). Ціль: ≤~70K токенів ⇒ ≤~140K симв.
    // Реалістична OCR-сторінка — багаторядкова (Document AI _text з \n), а
    // не один суцільний рядок: краї беруться по рядках, тіло викидається.
    const pages = Array.from({ length: 250 }, (_, i) => ({
      _text: [`Сторінка ${i + 1} судової справи`,
        ...Array.from({ length: 40 }, (_, k) => `Рядок ${k + 1} реального обсягу абзацу судового документа з контекстом`)].join('\n'),
    }));
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages });
    expect((out.match(/=== СТОРІНКА \d+ ===/g) || []).length).toBe(250);
    expect(out.length).toBeLessThan(140000);              // ≈ ≤~70K токенів — зона якості Haiku
  });

  it('ідемпотентна (чиста, без спільного стану між викликами)', () => {
    const L = { schemaVersion: 1, pages: [
      { _text: 'А\n12', dimension: { width: 595, height: 842 }, imageQualityScores: { qualityScore: 0.9 } },
      { _text: 'Б\n1', dimension: { width: 1000, height: 1000 }, imageQualityScores: { qualityScore: 0.4 } },
    ] };
    expect(buildCompactTriagePassport(L)).toBe(buildCompactTriagePassport(L));
  });

  it('null-safe: відсутні структурні поля → дайджесту нема, паспорт не падає', () => {
    const out = buildCompactTriagePassport({ schemaVersion: 1, pages: [{ _text: 'довільний текст без жодної структури сторінки тут' }] });
    expect(out).toContain('=== СТОРІНКА 1 ===');
    expect(out).toContain('довільний текст');
  });
});

// ── ФД-1 · resolveBoundaryText → компактний (єдина точка входу Triage) ──────
// Критерій якості: якщо хтось поверне buildStructuralPassport у ланцюг —
// великий том знову переповнить вікно Haiku (тихий passthrough). Цей тест
// ловить регрес: resolveBoundaryText мусить бути компактним, не повнотекстовим.
describe('pageMarkers.resolveBoundaryText (ФД-1)', () => {
  it('великий том (>100 стор.) → стартовий мінімум: у рази менший за структурний', () => {
    // 120 стор. — вище RICH_PASSPORT_MAX_PAGES → дефолти компактного паспорта
    // (без зайвої тіла-тексту, безпечно для вікна Haiku).
    const big = { schemaVersion: 1, pages: Array.from({ length: 120 }, (_, p) => ({
      _text: Array.from({ length: 45 }, (_, k) =>
        `Сторінка ${p + 1} рядок ${k + 1} реального обсягу абзацу судового документа`).join('\n'),
    })) };
    const out = resolveBoundaryText(big, null, 'PLAIN-FALLBACK');
    expect(out).toContain('=== СТОРІНКА 1 ===');
    expect(out).toContain('=== СТОРІНКА 120 ===');
    expect(out).not.toContain('PLAIN-FALLBACK');
    expect(out).toBe(buildCompactTriagePassport(big));            // дефолти на великому
    expect(out.length).toBeLessThan(buildStructuralPassport(big).length / 5);
  });

  it('малий том (≤100 стор.) → rich profile: head 10 + tail 10 (Брановський-зрізає)', () => {
    // Реалістична багаторядкова OCR-сторінка (Document AI _text з \n).
    // 65 стор. ≤ RICH_PASSPORT_MAX_PAGES → активується rich profile: head/tail
    // 10/10 по 1500 симв. На сторінці з 30 рядками rich покриває 1-10 + 21-30
    // (20 з 30), середина 11-20 елідується ⟨…⟩. Дефолтний компактний покривав
    // би лише 1-3 + 29-30 (5 з 30) — у 4x менше тексту для дискримінації меж.
    // dimension забезпечує непорожній дайджест (fullTextIfNoSignal не лізе).
    const small = { schemaVersion: 1, pages: Array.from({ length: 65 }, (_, p) => ({
      _text: Array.from({ length: 30 }, (_, k) =>
        `Сторінка ${p + 1} рядок ${k + 1} реального обсягу абзацу судового документа`).join('\n'),
      dimension: { width: 595, height: 842 },
    })) };
    const adaptive = resolveBoundaryText(small, null, 'PLAIN-FALLBACK');
    const pureDefault = buildCompactTriagePassport(small);
    expect(adaptive).toContain('=== СТОРІНКА 1 ===');
    expect(adaptive).toContain('=== СТОРІНКА 65 ===');
    // Rich значно щільніший за дефолтний компактний (відновлення якості).
    expect(adaptive.length).toBeGreaterThan(pureDefault.length * 2);
    // Rich на 30-рядковій сторінці покриває рядки 1-10 і 21-30.
    expect(adaptive).toContain('рядок 10 реального');                // tail head'у
    expect(adaptive).toContain('рядок 21 реального');                // початок tail'у
    expect(adaptive).toContain('⟨…⟩');                               // середина елідована
    // Дефолтний компактний таких рядків НЕ дав би (head 3 + tail 2).
    expect(pureDefault).not.toContain('рядок 10 реального');
    expect(pureDefault).not.toContain('рядок 21 реального');
  });

  it('поріг переходу: 100 → rich, 101 → дефолти (один сенс — за обсягом)', () => {
    // dimension → непорожній дайджест → fullTextIfNoSignal не плутає тест.
    const make = (n) => ({ schemaVersion: 1, pages: Array.from({ length: n }, () => ({
      _text: Array.from({ length: 30 }, (_, k) => `рядок ${k + 1} достатньо інформативний для тесту`).join('\n'),
      dimension: { width: 595, height: 842 },
    })) });
    const at100 = resolveBoundaryText(make(100), null, '');
    const at101 = resolveBoundaryText(make(101), null, '');
    // Розмір на сторінку: rich значно більший за дефолтний (близько 4x при
    // 30 рядках per page; беремо безпечний поріг 2x).
    expect(at100.length / 100).toBeGreaterThan(at101.length / 101 * 2);
  });

  it('layout непридатний → fallback на plain текст цілий', () => {
    expect(resolveBoundaryText(null, null, 'сирий OCR без структури')).toBe('сирий OCR без структури');
    expect(resolveBoundaryText({ pages: [] }, null, 'plain')).toBe('plain');
    // resume — неповний layout (expectedPageCount розбіжний) → plain
    expect(resolveBoundaryText({ schemaVersion: 1, pages: [{ _text: 'a' }] }, 5, 'plain-resume')).toBe('plain-resume');
  });

  it('layout непридатний і plain порожній → ""', () => {
    expect(resolveBoundaryText(null, null, '')).toBe('');
    expect(resolveBoundaryText(null, null, null)).toBe('');
  });
});
