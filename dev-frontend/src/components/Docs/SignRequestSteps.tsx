// 서명 요청 창의 단계 표시 · 3단계 «이렇게 보냅니다» 요약 (2026-10-05, docs/SIGNATURE_ITEMS_DESIGN.md §2-1)
// PostSignatureModal 이 800줄 문턱을 넘어 뺐다 — 창의 흐름(상태)은 그쪽, 보이는 조각은 여기.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export const SignStepsBar: React.FC<{ step: 1 | 2 | 3 }> = ({ step }) => {
  const { t } = useTranslation('qdocs');
  const names = [
    t('sign.steps.spots', { defaultValue: '서명 자리' }),
    t('sign.steps.people', { defaultValue: '서명할 사람' }),
    t('sign.steps.send', { defaultValue: '보내기' }),
  ];
  return (
    <Steps aria-label={t('sign.steps.aria', { defaultValue: '서명 요청 단계' }) as string} data-testid="sign-steps">
      {names.map((name, i) => {
        const n = i + 1;
        return (
          <StepDot key={n} $on={step === n} $done={step > n} aria-current={step === n ? 'step' : undefined}>
            <b>{n}</b>{name}
          </StepDot>
        );
      })}
    </Steps>
  );
};

export interface RecipientRow { key: string; label: string | null; party: 'us' | 'them'; name: string; email: string }

/** 받는 쪽은 메일 주소, 보내는 쪽은 멤버 이름(앱 안 서명 — 메일 없음). 보낼 주소를 확인 문구에 적는다(CLAUDE.md «외부 발송은 확인을 받는다»). */
export const SignRecipients: React.FC<{ rows: RecipientRow[] }> = ({ rows }) => {
  const { t } = useTranslation('qdocs');
  const partyText = (p: 'us' | 'them') => (p === 'us'
    ? t('editor.sigFieldUs', { defaultValue: '보내는 쪽' })
    : t('editor.sigFieldThem', { defaultValue: '받는 쪽' })) as string;
  return (
    <Wrap data-testid="sign-recipients">
      <Label>{t('sign.recipients', { defaultValue: '이렇게 보냅니다' })}</Label>
      <List>
        {rows.map((r) => (
          <li key={r.key}>
            <b>{r.label || partyText(r.party)}</b> — {r.party === 'us'
              ? (r.name || t('sign.recipientMember', { defaultValue: '멤버' }))
              : `${r.name ? `${r.name} · ` : ''}${r.email}`}
            {r.party === 'us' && <Note>{t('sign.recipientInApp', { defaultValue: '(앱에서 서명 — 메일 안 감)' })}</Note>}
          </li>
        ))}
      </List>
      <Hint>{t('sign.recipientsHint', { defaultValue: '받는 쪽 주소로 서명 링크 메일이 나갑니다. 주소를 한 번 더 확인하세요.' })}</Hint>
    </Wrap>
  );
};

const Steps = styled.ol`display: flex; gap: 6px; list-style: none; margin: 12px 0 10px; padding: 0;`;
const StepDot = styled.li<{ $on: boolean; $done: boolean }>`
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 8px;
  font-size: 0.75rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  background: ${(p) => (p.$on ? '#F0FDFA' : '#F8FAFC')}; color: ${(p) => (p.$on ? '#0F766E' : p.$done ? '#334155' : '#94A3B8')};
  border: 1px solid ${(p) => (p.$on ? '#99F6E4' : '#E2E8F0')};
  b { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; padding: 2px 0; border-radius: 50%; line-height: 1;
    font-size: 0.6875rem; flex-shrink: 0; background: ${(p) => (p.$on || p.$done ? '#0D9488' : '#CBD5E1')}; color: #fff; }
`;
const Wrap = styled.section`margin-bottom: 14px;`;
const Label = styled.div`font-size: 0.75rem; font-weight: 600; color: #0F172A; margin-bottom: 6px;`;
const List = styled.ul`margin: 4px 0 6px; padding-left: 18px; font-size: 0.8125rem; color: #0F172A; line-height: 1.7; word-break: break-all;`;
const Note = styled.span`margin-left: 6px; font-size: 0.75rem; color: #64748B;`;
const Hint = styled.div`font-size: 0.6875rem; color: #94A3B8; line-height: 1.5; margin-top: 4px;`;
