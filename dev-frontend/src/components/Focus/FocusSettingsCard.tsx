// FocusSettingsCard — 개인 프로필 안 "내 업무 흐름" 섹션 (사이클 N+26)
//
// focus_enabled / focus_idle_min / focus_auto_pause_min / focus_daily_prompt 4개 설정.
// 자동 저장 (debounce) — AutoSaveField 패턴. 변경 즉시 ✓ 뱃지.

import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import PlanQSelect from '../Common/PlanQSelect';

interface Settings {
  focus_enabled: boolean;
  focus_idle_min: number;
  focus_auto_pause_min: number;
  focus_daily_prompt: boolean;
}

const FocusSettingsCard: React.FC = () => {
  const { t } = useTranslation('focus');
  const [s, setS] = useState<Settings | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch('/api/focus/settings');
        const j = await r.json();
        if (cancelled) return;
        if (j.success) {
          setS({
            focus_enabled: !!j.data.focus_enabled,
            focus_idle_min: Number(j.data.focus_idle_min) || 15,
            focus_auto_pause_min: Number(j.data.focus_auto_pause_min) || 30,
            focus_daily_prompt: !!j.data.focus_daily_prompt,
          });
        }
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = async (patch: Partial<Settings>, key: string) => {
    setSavingKey(key);
    try {
      const r = await apiFetch('/api/focus/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (j.success) {
        setS(prev => prev ? { ...prev, ...j.data } : prev);
        // N+63 — 즉시 반영. 사이드바 FocusWidget 가 setting fetch 1회만 하므로
        // toggle 변경 후 새로고침 없이 위젯 표시/숨김 + 옵션 변경 즉시 반영.
        window.dispatchEvent(new CustomEvent('focus:settings-changed', { detail: j.data }));
      }
    } finally { setSavingKey(null); }
  };

  if (!s) return null;

  return (
    <Card>
      <SectionTitle>{t('settings.sectionTitle')}</SectionTitle>
      <Description>{t('settings.sectionDesc')}</Description>

      {/* 1) 메인 토글 — focus_enabled */}
      <ToggleRow>
        <ToggleBody>
          <ToggleLabel>{t('settings.enabled')}</ToggleLabel>
          <ToggleHint>{t('settings.enabledHint')}</ToggleHint>
        </ToggleBody>
        <Switch
          role="switch" aria-checked={s.focus_enabled}
          $active={s.focus_enabled}
          onClick={() => save({ focus_enabled: !s.focus_enabled }, 'enabled')}
          disabled={savingKey === 'enabled'}
          type="button"
        >
          <SwitchKnob $active={s.focus_enabled} />
        </Switch>
      </ToggleRow>

      {/* 활성 시에만 보이는 추가 옵션 */}
      {s.focus_enabled && (
        <SubOptions>
          <FieldRow>
            <FieldLabel>
              <span>{t('settings.idleMin')}</span>
              <FieldHint>{t('settings.idleMinHint')}</FieldHint>
            </FieldLabel>
            <FieldControl>
              <PlanQSelect
                value={{ value: String(s.focus_idle_min), label: t('settings.minutes', { n: s.focus_idle_min }) as string }}
                onChange={(opt) => {
                  const v = Number((opt as { value: string } | null)?.value);
                  if (Number.isFinite(v)) save({ focus_idle_min: v }, 'idle');
                }}
                options={[5, 10, 15, 20, 30, 45, 60].map(n => ({ value: String(n), label: t('settings.minutes', { n }) as string }))}
                size="md"
              />
            </FieldControl>
          </FieldRow>

          <FieldRow>
            <FieldLabel>
              <span>{t('settings.autoPauseMin')}</span>
              <FieldHint>{t('settings.autoPauseMinHint')}</FieldHint>
            </FieldLabel>
            <FieldControl>
              <PlanQSelect
                value={{ value: String(s.focus_auto_pause_min), label: t('settings.minutes', { n: s.focus_auto_pause_min }) as string }}
                onChange={(opt) => {
                  const v = Number((opt as { value: string } | null)?.value);
                  if (Number.isFinite(v)) save({ focus_auto_pause_min: v }, 'autopause');
                }}
                options={[15, 30, 45, 60, 90, 120].map(n => ({ value: String(n), label: t('settings.minutes', { n }) as string }))}
                size="md"
              />
            </FieldControl>
          </FieldRow>

          <ToggleRow>
            <ToggleBody>
              <ToggleLabel>{t('settings.dailyPrompt')}</ToggleLabel>
              <ToggleHint>{t('settings.dailyPromptHint')}</ToggleHint>
            </ToggleBody>
            <Switch
              role="switch" aria-checked={s.focus_daily_prompt}
              $active={s.focus_daily_prompt}
              onClick={() => save({ focus_daily_prompt: !s.focus_daily_prompt }, 'prompt')}
              disabled={savingKey === 'prompt'}
              type="button"
            >
              <SwitchKnob $active={s.focus_daily_prompt} />
            </Switch>
          </ToggleRow>
        </SubOptions>
      )}
    </Card>
  );
};

export default FocusSettingsCard;

// ─── styled ─────────────────────────────────────────────────────
const Card = styled.section`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 16px;
`;
const SectionTitle = styled.h3`
  margin: 0 0 8px;
  font-size: 16px; font-weight: 700; color: #0F172A;
  letter-spacing: -0.2px;
`;
const Description = styled.p`
  margin: 0 0 16px;
  font-size: 13px; color: #475569; line-height: 1.6;
`;
const ToggleRow = styled.div`
  display: flex; align-items: center; gap: 16px;
  padding: 12px 0;
  & + & { border-top: 1px solid #F1F5F9; }
`;
const ToggleBody = styled.div`flex: 1; min-width: 0;`;
const ToggleLabel = styled.div`
  font-size: 14px; font-weight: 600; color: #0F172A; margin-bottom: 2px;
`;
const ToggleHint = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.5;
`;
const Switch = styled.button<{ $active: boolean }>`
  position: relative;
  width: 44px; height: 24px; flex-shrink: 0;
  background: ${p => p.$active ? '#14B8A6' : '#CBD5E1'};
  border: none; border-radius: 999px;
  cursor: pointer; padding: 0;
  transition: background 0.15s;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.4); outline-offset: 2px; }
`;
const SwitchKnob = styled.span<{ $active: boolean }>`
  position: absolute; top: 2px;
  left: ${p => p.$active ? '22px' : '2px'};
  width: 20px; height: 20px;
  background: #FFFFFF; border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: left 0.18s ease;
`;
const SubOptions = styled.div`
  margin-top: 8px; padding: 16px;
  background: #F8FAFC; border-radius: 8px;
`;
const FieldRow = styled.div`
  display: flex; align-items: flex-start; gap: 16px;
  margin-bottom: 14px;
  &:last-child { margin-bottom: 0; }
`;
const FieldLabel = styled.div`
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 2px;
  font-size: 14px; font-weight: 600; color: #0F172A;
`;
const FieldHint = styled.span`
  font-size: 12px; font-weight: 500; color: #64748B; line-height: 1.5;
`;
const FieldControl = styled.div`
  flex-shrink: 0;
  min-width: 140px;
`;
