// WorkManagementSettings — 워크스페이스 "업무 관리" 설정 (사이클 N+26)
//
// 주간 보고 자동 확정 요일·시각 (owner/admin 만 PUT).
// 권한 매트릭스의 weekly_team 메뉴는 PermissionsSettings 에서 관리 (분리).

import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import AutoSaveField from '../Common/AutoSaveField';
import { apiFetch } from '../../contexts/AuthContext';
import PlanQSelect from '../Common/PlanQSelect';

interface Settings {
  timezone: string;
  weekly_finalize_dow: number;
  weekly_finalize_hour: number;
  weekly_finalize_enabled: boolean;
}

interface Props { businessId: number; isAdmin: boolean; }

const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const WorkManagementSettings: React.FC<Props> = ({ businessId, isAdmin }) => {
  const { t } = useTranslation('settings');
  const [s, setS] = useState<Settings | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/businesses/${businessId}/weekly-finalize`);
        const j = await r.json();
        if (cancelled) return;
        if (j.success) setS(j.data);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  // ★ 2026-09-09 — 바꾸면 바로 저장되는데 **저장됐다는 표시가 없었다**
  //   (Irene: "자동저장되는 체크아이콘 표시 없는 곳이 너무 많아. 특히 설정들").
  //   AutoSaveField 계약에 맞춰 둘로 가른다 — 래퍼가 300ms 뒤 persist 를 부르므로
  //   컨트롤 쪽에서 저장까지 하면 **두 번** 나간다.
  //     · stage   = 화면만 먼저 바꾸고 보낼 값을 모아 둔다
  //     · persist = 래퍼가 부르는 실제 저장. 실패하면 던져야 ! 뱃지가 뜬다.
  const pendingRef = useRef<Partial<Settings>>({});
  const stage = (patch: Partial<Settings>) => {
    if (!isAdmin) return;
    pendingRef.current = { ...pendingRef.current, ...patch };
    setS(prev => (prev ? { ...prev, ...patch } : prev));
  };
  const persist = async () => {
    if (!isAdmin) return;
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (!Object.keys(patch).length) return;
    const r = await apiFetch(`/api/businesses/${businessId}/weekly-finalize`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.message || 'save_failed');
    setS(prev => prev ? { ...prev, ...j.data } : prev);
  };

  if (!s) return null;

  // 다음 자동 확정 시각 계산
  const nextFinalize = (() => {
    if (!s.weekly_finalize_enabled) return null;
    const now = new Date();
    const target = new Date(now);
    const todayDow = now.getDay();
    let daysUntil = (s.weekly_finalize_dow - todayDow + 7) % 7;
    target.setDate(now.getDate() + daysUntil);
    target.setHours(s.weekly_finalize_hour, 0, 0, 0);
    if (daysUntil === 0 && target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 7);
    }
    return target;
  })();

  return (
    <Card>
      <SectionTitle>{t('workManagement.autoFinalize.title', '주간 보고 자동 확정')}</SectionTitle>
      <SectionDesc>{t('workManagement.autoFinalize.desc', '지정한 요일·시각에 지난 주 워크스페이스 통합 보고서가 자동으로 만들어져요. 워크스페이스 timezone({{tz}}) 기준입니다.', { tz: s.timezone || 'Asia/Seoul' })}</SectionDesc>

      <Row>
        <Field>
          <FieldLabel>{t('workManagement.autoFinalize.enabled', '자동 확정 활성')}</FieldLabel>
          <FieldHint>{t('workManagement.autoFinalize.enabledHint', '꺼두면 자동 생성을 멈춰요. 수동으로 "이번 주 확정" 버튼은 그대로 사용 가능.')}</FieldHint>
        </Field>
        <AutoSaveField type="toggle" onSave={persist}>
          <Switch
            role="switch" aria-checked={s.weekly_finalize_enabled} type="button"
            $on={s.weekly_finalize_enabled}
            disabled={!isAdmin}
            onClick={() => stage({ weekly_finalize_enabled: !s.weekly_finalize_enabled })}
          >
            <Knob $on={s.weekly_finalize_enabled} />
          </Switch>
        </AutoSaveField>
      </Row>

      {s.weekly_finalize_enabled && (
        <SubOptions>
          <Row>
            <Field>
              <FieldLabel>{t('workManagement.autoFinalize.dow', '요일')}</FieldLabel>
              <FieldHint>{t('workManagement.autoFinalize.dowHint', '지난 주 데이터를 이 요일 기준으로 확정합니다 (default: 월요일).')}</FieldHint>
            </Field>
            <Control>
              <AutoSaveField type="select" onSave={persist}>
                <PlanQSelect
                  value={{ value: String(s.weekly_finalize_dow), label: t(`workManagement.dow.${DOW_KEYS[s.weekly_finalize_dow]}`) as string }}
                  onChange={(opt) => {
                    const v = Number((opt as { value: string } | null)?.value);
                    if (Number.isFinite(v)) stage({ weekly_finalize_dow: v });
                  }}
                  options={DOW_KEYS.map((k, i) => ({ value: String(i), label: t(`workManagement.dow.${k}`) as string }))}
                  size="md"
                  isDisabled={!isAdmin}
                />
              </AutoSaveField>
            </Control>
          </Row>

          <Row>
            <Field>
              <FieldLabel>{t('workManagement.autoFinalize.hour', '시각')}</FieldLabel>
              <FieldHint>{t('workManagement.autoFinalize.hourHint', '워크스페이스 timezone 기준 (default: 자정 직후 00시).')}</FieldHint>
            </Field>
            <Control>
              <AutoSaveField type="select" onSave={persist}>
                <PlanQSelect
                  value={{ value: String(s.weekly_finalize_hour), label: `${String(s.weekly_finalize_hour).padStart(2, '0')}:00` }}
                  onChange={(opt) => {
                    const v = Number((opt as { value: string } | null)?.value);
                    if (Number.isFinite(v)) stage({ weekly_finalize_hour: v });
                  }}
                  options={Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: `${String(i).padStart(2, '0')}:00` }))}
                  size="md"
                  isDisabled={!isAdmin}
                />
              </AutoSaveField>
            </Control>
          </Row>
        </SubOptions>
      )}

      {nextFinalize && (
        <NextHint>
          {t('workManagement.autoFinalize.nextLabel', '다음 자동 확정')}: <strong>{nextFinalize.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</strong>
        </NextHint>
      )}

      {!isAdmin && (
        <ReadOnlyHint>{t('workManagement.readOnly', '워크스페이스 관리자만 변경할 수 있습니다.')}</ReadOnlyHint>
      )}
    </Card>
  );
};

export default WorkManagementSettings;

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
  font-size: 1rem; font-weight: 700; color: #0F172A; letter-spacing: -0.2px;
`;
const SectionDesc = styled.p`
  margin: 0 0 20px;
  font-size: 0.8125rem; color: #475569; line-height: 1.6;
`;
const Row = styled.div`
  display: flex; align-items: center; gap: 16px;
  padding: 12px 0;
  & + & { border-top: 1px solid #F1F5F9; }
`;
const Field = styled.div`flex: 1; min-width: 0;`;
const FieldLabel = styled.div`
  font-size: 0.875rem; font-weight: 600; color: #0F172A; margin-bottom: 2px;
`;
const FieldHint = styled.div`
  font-size: 0.75rem; color: #64748B; line-height: 1.5;
`;
const Control = styled.div`
  flex-shrink: 0; min-width: 140px;
`;
const Switch = styled.button<{ $on: boolean }>`
  position: relative;
  width: 44px; height: 24px; flex-shrink: 0;
  background: ${p => p.$on ? '#14B8A6' : '#CBD5E1'};
  border: none; border-radius: 999px;
  cursor: pointer; padding: 0;
  transition: background 0.15s;
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.4); outline-offset: 2px; }
`;
const Knob = styled.span<{ $on: boolean }>`
  position: absolute; top: 2px;
  left: ${p => p.$on ? '22px' : '2px'};
  width: 20px; height: 20px;
  background: #FFFFFF; border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: left 0.18s ease;
`;
const SubOptions = styled.div`
  margin-top: 8px; padding: 16px;
  background: #F8FAFC; border-radius: 8px;
`;
const NextHint = styled.div`
  margin-top: 16px; padding: 10px 14px;
  background: #F0FDFA; border: 1px solid #CCFBF1; border-radius: 8px;
  font-size: 0.8125rem; color: #0F766E;
  strong { font-weight: 700; }
`;
const ReadOnlyHint = styled.div`
  margin-top: 12px; font-size: 0.75rem; color: #94A3B8; font-style: italic;
`;
