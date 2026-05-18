// WorkspaceFinalizeBanner — 워크스페이스 통합 주간보고 페이지 상단 안내 띠 (사이클 N+26)
//
// "다음 자동 확정 시각 + 설정 변경 진입점" — 사용자 표현: "자동 확정 중이라고 안내하고 설정버튼 눌러서 설정페이지로"
// owner/admin 자동 + member 는 weekly_team 권한 있어야 페이지 자체 진입됨 (백엔드 403)

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

interface Settings {
  timezone: string;
  weekly_finalize_dow: number;
  weekly_finalize_hour: number;
  weekly_finalize_enabled: boolean;
}

const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const WorkspaceFinalizeBanner: React.FC<{ businessId: number }> = ({ businessId }) => {
  const { t } = useTranslation('qtask');
  const [s, setS] = useState<Settings | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/businesses/${businessId}/weekly-finalize`);
        const j = await r.json();
        if (cancelled) return;
        if (j.success) setS(j.data);
      } catch { /* 권한 없으면 settings GET 도 막힘 — 그 경우 안내 띠 미노출 */ }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  if (!s) return null;

  const nextDate = (() => {
    if (!s.weekly_finalize_enabled) return null;
    const now = new Date();
    const target = new Date(now);
    const todayDow = now.getDay();
    const daysUntil = (s.weekly_finalize_dow - todayDow + 7) % 7;
    target.setDate(now.getDate() + daysUntil);
    target.setHours(s.weekly_finalize_hour, 0, 0, 0);
    if (daysUntil === 0 && target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 7);
    }
    return target;
  })();

  if (!s.weekly_finalize_enabled) {
    return (
      <Bar $tone="warn">
        <Icon $tone="warn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </Icon>
        <Body>
          <Title>{t('workspaceWeekly.banner.disabledTitle', { defaultValue: '자동 확정이 꺼져 있어요' })}</Title>
          <Desc>{t('workspaceWeekly.banner.disabledDesc', { defaultValue: '관리자가 "업무 관리" 설정에서 자동 확정을 켜면 매주 자동으로 통합 보고서가 만들어집니다.' })}</Desc>
        </Body>
        <SettingsLink to="/business/settings/work-flow" title={t('workspaceWeekly.banner.toSettings', { defaultValue: '설정 변경' }) as string}>
          {t('workspaceWeekly.banner.toSettings', { defaultValue: '설정 변경' })} →
        </SettingsLink>
      </Bar>
    );
  }

  return (
    <Bar $tone="info">
      <Icon $tone="info">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      </Icon>
      <Body>
        <Title>
          {t('workspaceWeekly.banner.enabledTitle', {
            dow: t(`workspaceWeekly.dow.${DOW_KEYS[s.weekly_finalize_dow]}`, { defaultValue: DOW_KEYS[s.weekly_finalize_dow] }),
            hour: `${String(s.weekly_finalize_hour).padStart(2, '0')}:00`,
            defaultValue: '매주 {{dow}} {{hour}} 에 자동 확정',
          }) as string}
        </Title>
        {nextDate && (
          <Desc>
            {t('workspaceWeekly.banner.nextLabel', { defaultValue: '다음 자동 확정' })}: <strong>{nextDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</strong>
          </Desc>
        )}
      </Body>
      <SettingsLink to="/business/settings/work-flow" title={t('workspaceWeekly.banner.toSettings', { defaultValue: '설정 변경' }) as string}>
        {t('workspaceWeekly.banner.toSettings', { defaultValue: '설정 변경' })} →
      </SettingsLink>
    </Bar>
  );
};

export default WorkspaceFinalizeBanner;

const TONE = {
  info: { bg: '#F0FDFA', border: '#CCFBF1', icon: '#0F766E', title: '#0F766E' },
  warn: { bg: '#FFFBEB', border: '#FCD34D', icon: '#B45309', title: '#B45309' },
};

const Bar = styled.div<{ $tone: 'info' | 'warn' }>`
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: ${p => TONE[p.$tone].bg};
  border: 1px solid ${p => TONE[p.$tone].border};
  border-radius: 10px;
  margin-bottom: 12px;
`;
const Icon = styled.span<{ $tone: 'info' | 'warn' }>`
  flex-shrink: 0;
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  color: ${p => TONE[p.$tone].icon};
`;
const Body = styled.div`flex: 1; min-width: 0;`;
const Title = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A; margin-bottom: 2px;
`;
const Desc = styled.div`
  font-size: 12px; color: #475569; line-height: 1.45;
  strong { color: #0F172A; font-weight: 700; }
`;
const SettingsLink = styled(Link)`
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 12px;
  background: #FFFFFF; color: #0F766E;
  border: 1px solid #14B8A6; border-radius: 6px;
  font-size: 12px; font-weight: 700;
  text-decoration: none;
  transition: background 0.12s, color 0.12s;
  &:hover { background: #14B8A6; color: #FFFFFF; }
`;
