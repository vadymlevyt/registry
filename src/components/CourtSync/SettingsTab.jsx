// ── COURT SYNC — SETTINGS TAB ────────────────────────────────────────────────
// Налаштування модуля. MVP TASK 0.4: тільки ecitsCabinetIdentifier (РНОКПП
// або email адвоката як він відомий у кабінеті ЄСІТС). Потрібен для
// майбутньої multi-user dedupe.
//
// Один сенс: "як адвокат ідентифікований у ЄСІТС". UI читає з
// DEFAULT_USER.ecitsCabinetIdentifier (поки single-user). Запис у поточному
// MVP — інформативний (поле в стейті users[], реальна персистентність
// через update_user_settings action — окремий майбутній TASK).

import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { ICON_SIZE } from '../UI/icons.js';
import { getCurrentUser } from '../../services/tenantService.js';

export default function SettingsTab() {
  const user = getCurrentUser();
  const [identifier, setIdentifier] = useState(user?.ecitsCabinetIdentifier || '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 600 }}>
      <section style={{
        padding: 16,
        background: 'var(--color-bg-1)',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
      }}>
        <label style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 500,
          marginBottom: 6,
        }}>
          Ідентифікатор у кабінеті ЄСІТС
        </label>
        <div style={{
          fontSize: 12,
          color: 'var(--color-text-2)',
          marginBottom: 10,
          lineHeight: 1.5,
        }}>
          РНОКПП або email адвоката як він відомий у кабінеті. Потрібен
          для дедуплікації коли в майбутньому в одному бюро кілька адвокатів
          синхронізують ті самі справи з різних кабінетів.
        </div>
        <input
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="2958638797 або advocate@example.com"
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            fontSize: 13,
            boxSizing: 'border-box',
          }}
        />
        <div style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
          fontSize: 12,
          color: 'var(--color-text-2)',
        }}>
          <Info size={ICON_SIZE.sm} />
          <span>
            У MVP single-user збереження через окремий ACTION (наступний TASK
            multi-user activation). Поточне значення:&nbsp;
            <code>{user?.ecitsCabinetIdentifier ?? 'null'}</code>
          </span>
        </div>
      </section>
    </div>
  );
}
