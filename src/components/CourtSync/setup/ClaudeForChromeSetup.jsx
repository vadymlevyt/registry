// ── CLAUDE FOR CHROME SETUP ──────────────────────────────────────────────────
// TASK 0.3 — інструкція встановлення і входу в офіційне розширення Claude for
// Chrome, через яке виконується read-only розвідка ЄСІТС. Сторінка не може
// технічно перевірити підключення (розширення не експонує API в window) —
// адвокат підтверджує вручну.
//
// Компонент рендериться у вкладці Розвідник коли провайдер виконання
// 'claudeForChrome' і ще не позначено пройдений setup. Стан проходу setup —
// у localStorage, prop onDone викликається коли адвокат натискає «Готово».

import React, { useState } from 'react';
import { ExternalLink, Check } from 'lucide-react';
import { ICON_SIZE } from '../../UI/icons.js';
import { Button } from '../../UI/Button.jsx';
import { testProviderConnection } from '../../../services/ecitsService.js';

const CHROME_STORE_URL = 'https://chromewebstore.google.com/';
// Точна сторінка розширення може змінюватись — перевірити при першій
// інтеграції з продакшн-релізом Anthropic. Поки що ведемо адвоката на
// корінь магазину з підказкою шукати «Claude for Chrome».

function StepHeader({ index, title, done }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontWeight: 'var(--weight-bold)',
      fontSize: 'var(--text-sm)',
      color: done ? 'var(--color-text-2)' : 'var(--color-text)',
    }}>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        borderRadius: '50%',
        border: '1px solid var(--color-border)',
        background: done ? 'var(--color-bg-2)' : 'transparent',
        fontSize: 11,
      }}>
        {done ? <Check size={ICON_SIZE.xs} /> : index}
      </span>
      <span>{title}</span>
    </div>
  );
}

export default function ClaudeForChromeSetup({ onDone }) {
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  async function handleVerify() {
    setVerifying(true);
    try {
      const res = await testProviderConnection();
      setVerifyResult(res);
    } catch (err) {
      setVerifyResult({
        detected: false,
        reason: err?.message || 'Помилка перевірки',
        provider: 'claudeForChrome',
      });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={{
          fontFamily: 'var(--font-heading)',
          fontSize: 'var(--text-md)',
          fontWeight: 'var(--weight-bold)',
          marginBottom: 4,
        }}>
          Підключення Claude for Chrome
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)' }}>
          Розвідка ЄСІТС виконується через офіційне браузерне розширення Claude.
          Воно працює зі своєю підпискою (Anthropic Pro або Max).
        </div>
      </div>

      {/* Крок 1 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <StepHeader index={1} title="Встановіть Claude for Chrome" />
        <div style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-2)',
          paddingLeft: 30,
        }}>
          Відкрийте Chrome Web Store, знайдіть «Claude for Chrome», натисніть
          Add to Chrome і підтвердіть встановлення. Потім закрийте вкладку
          магазину.
        </div>
        <div style={{ paddingLeft: 30 }}>
          <Button
            variant="secondary"
            size="sm"
            iconRight={<ExternalLink size={ICON_SIZE.sm} />}
            onClick={() => window.open(CHROME_STORE_URL, '_blank', 'noopener,noreferrer')}
          >
            Відкрити Chrome Web Store
          </Button>
        </div>
      </div>

      {/* Крок 2 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <StepHeader index={2} title="Увійдіть у Claude for Chrome" />
        <div style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-2)',
          paddingLeft: 30,
        }}>
          Натисніть на іконку Claude у правому верхньому куті браузера.
          Увійдіть зі своїм Anthropic-акаунтом (потрібна підписка Pro або Max).
        </div>
      </div>

      {/* Крок 3 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <StepHeader index={3} title="Перевірте підключення" />
        <div style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-2)',
          paddingLeft: 30,
        }}>
          Claude for Chrome ми технічно не можемо перевірити з нашої сторінки —
          розширення не дає доступу до свого стану з зовнішніх вкладок.
          Якщо ви встановили розширення і увійшли — натисніть «Готово».
        </div>
        <div style={{ paddingLeft: 30, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleVerify}
            loading={verifying}
          >
            Перевірити
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Check size={ICON_SIZE.sm} />}
            onClick={() => onDone?.()}
          >
            Готово
          </Button>
        </div>
        {verifyResult && (
          <div style={{
            paddingLeft: 30,
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-2)',
          }}>
            {verifyResult.detected
              ? 'Підключення виявлено.'
              : `Автоматична перевірка недоступна (${verifyResult.reason}). Підтвердіть вручну.`}
          </div>
        )}
      </div>
    </div>
  );
}
