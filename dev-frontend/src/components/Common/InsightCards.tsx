// InsightCards — Cue 가 능동적으로 알리는 카드 (사이클 D4).
// 인박스/대시보드 상단에 마운트. dismiss 시 sessionStorage 에 기록 (재진입 시 다시 표시).
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../contexts/AuthContext';

interface Insight {
  id: string;
  kind: string;
  severity: 'urgent' | 'warning' | 'today' | 'info';
  title: string;
  body: string;
  action?: { label: string; link: string };
}

const DISMISS_KEY = 'planq_insights_dismissed';

const InsightCards: React.FC = () => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [items, setItems] = useState<Insight[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '[]')); }
    catch { return new Set(); }
  });

  useEffect(() => {
    apiFetch('/api/insights')
      .then(r => r.json())
      .then(j => { if (j.success) setItems(j.data || []); })
      .catch(() => { /* silent */ });
  }, []);

  const handleDismiss = (id: string) => {
    const next = new Set(dismissed); next.add(id);
    setDismissed(next);
    try { sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  };

  const visible = items.filter(it => !dismissed.has(it.id));
  if (visible.length === 0) return null;

  return (
    <Wrap>
      {visible.map(it => (
        <Card key={it.id} $severity={it.severity}>
          <Sparkle aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
          </Sparkle>
          <Body>
            <Title>{it.title}</Title>
            <Desc>{it.body}</Desc>
            {it.action && (
              <ActionBtn type="button" onClick={() => navigate(it.action!.link)}>
                {it.action.label} →
              </ActionBtn>
            )}
          </Body>
          <Close type="button" onClick={() => handleDismiss(it.id)} aria-label={t('cancel', '닫기') as string}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </Close>
        </Card>
      ))}
    </Wrap>
  );
};

export default InsightCards;

const SEV_COLORS = {
  urgent: { bg: '#FEF2F2', border: '#FECACA', accent: '#DC2626', sparkle: '#DC2626' },
  warning: { bg: '#FFFBEB', border: '#FCD34D', accent: '#B45309', sparkle: '#F59E0B' },
  today: { bg: '#F0FDFA', border: '#99F6E4', accent: '#0D9488', sparkle: '#14B8A6' },
  info: { bg: '#F8FAFC', border: '#E2E8F0', accent: '#475569', sparkle: '#64748B' },
} as const;

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  margin-bottom: 12px;
`;
const Card = styled.div<{ $severity: keyof typeof SEV_COLORS }>`
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 16px;
  background: ${p => SEV_COLORS[p.$severity].bg};
  border: 1px solid ${p => SEV_COLORS[p.$severity].border};
  border-radius: 10px;
`;
const Sparkle = styled.div`
  flex-shrink: 0; width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; background: rgba(244,63,94,0.10);
  color: #F43F5E;
`;
const Body = styled.div`flex: 1; min-width: 0;`;
const Title = styled.div`font-size: 13px; font-weight: 700; color: #0F172A; margin-bottom: 4px;`;
const Desc = styled.div`font-size: 12px; color: #475569; line-height: 1.55; white-space: pre-line;`;
const ActionBtn = styled.button`
  margin-top: 8px;
  background: transparent; border: none; padding: 0;
  font-size: 12px; font-weight: 600; color: #0D9488;
  cursor: pointer;
  &:hover { color: #0F766E; text-decoration: underline; }
`;
const Close = styled.button`
  flex-shrink: 0; width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 4px;
  color: #94A3B8; cursor: pointer;
  &:hover { background: rgba(0,0,0,0.04); color: #0F172A; }
`;
