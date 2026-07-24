// #207 — 메일 알림 범위. 계정마다 고른다.
//
//   회사 공용 메일함(help@…)은 하루 수십 통이 오고 개인 메일은 몇 통뿐이다. 그래서 "무엇을 알릴지"는
//   워크스페이스 하나가 아니라 **계정 속성**이다(email_accounts.notify_scope). 어떤 채널로 받을지
//   (인앱·모바일·이메일)는 알림 설정 화면의 사용자별 매트릭스가 담당 — 두 축이 겹치지 않는다.
//
//   기본값은 '확인 권장 + 답변 필요' (Irene 지정). 저장 버튼 없이 고르면 바로 저장(PlanQ 표준).
import { useCallback, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

export type NotifyScope = 'all' | 'recommended' | 'reply_only';

interface Props {
  businessId: number;
  accountId: number;
  initialScope: NotifyScope;
}

// 문구는 전부 i18n(qmail ns) — 이 파일에 사용자 노출 문자열을 두지 않는다.
const OPTIONS: Array<{ value: NotifyScope; labelKey: string; descKey: string }> = [
  { value: 'reply_only', labelKey: 'notifyScope.replyOnly', descKey: 'notifyScope.replyOnlyDesc' },
  { value: 'recommended', labelKey: 'notifyScope.recommended', descKey: 'notifyScope.recommendedDesc' },
  { value: 'all', labelKey: 'notifyScope.all', descKey: 'notifyScope.allDesc' },
];

export default function MailNotifyScopeSection({ businessId, accountId, initialScope }: Props) {
  const { t } = useTranslation('qmail');
  const [scope, setScope] = useState<NotifyScope>(initialScope || 'recommended');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(false);

  const save = useCallback(async (next: NotifyScope) => {
    const prev = scope;
    setScope(next);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-accounts/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notify_scope: next }),
      });
      // apiFetch 는 실패해도 throw 하지 않는다 — res.ok 를 봐야 저장 실패가 침묵하지 않는다
      if (!r.ok) throw new Error('save_failed');
      setErr(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setScope(prev);                 // 실패하면 화면도 되돌린다 (저장된 척 금지)
      setErr(true);
      setTimeout(() => setErr(false), 4000);
    }
  }, [businessId, accountId, scope]);

  return (
    <Wrap>
      <Head>
        <Title>{t('notifyScope.title') as string}</Title>
        {saved && <Badge $ok>{t('notifyScope.saved') as string}</Badge>}
        {err && <Badge>{t('notifyScope.failed') as string}</Badge>}
      </Head>
      <Desc>{t('notifyScope.desc') as string}</Desc>
      <Options role="radiogroup" aria-label={t('notifyScope.title') as string}>
        {OPTIONS.map((o) => (
          <Option
            key={o.value}
            type="button"
            role="radio"
            aria-checked={scope === o.value}
            $active={scope === o.value}
            data-testid={`mail-notify-scope-${o.value}`}
            onClick={() => { if (scope !== o.value) save(o.value); }}
          >
            <Dot $active={scope === o.value} aria-hidden="true" />
            <OptText>
              <OptLabel>{t(o.labelKey) as string}</OptLabel>
              <OptDesc>{t(o.descKey) as string}</OptDesc>
            </OptText>
          </Option>
        ))}
      </Options>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  margin-top: 14px; padding-top: 14px; border-top: 1px solid #F1F5F9;
`;
const Head = styled.div`display: flex; align-items: center; gap: 8px;`;
const Title = styled.div`font-size: 13px; font-weight: 700; color: #0F172A;`;
const Badge = styled.span<{ $ok?: boolean }>`
  font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px;
  color: ${(p) => (p.$ok ? '#0F766E' : '#B45309')};
  background: ${(p) => (p.$ok ? '#F0FDFA' : '#FEF3C7')};
`;
const Desc = styled.p`margin: 0; font-size: 12px; color: #94A3B8; line-height: 1.6;`;
const Options = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  @media (min-width: 769px) { flex-direction: row; }
`;
const Option = styled.button<{ $active: boolean }>`
  flex: 1; min-width: 0;
  display: flex; align-items: flex-start; gap: 8px;
  padding: 12px; border-radius: 10px; cursor: pointer; text-align: left;
  background: ${(p) => (p.$active ? '#F0FDFA' : '#FFFFFF')};
  border: 1px solid ${(p) => (p.$active ? '#14B8A6' : '#E2E8F0')};
  transition: background 0.15s, border-color 0.15s;
  &:hover { border-color: ${(p) => (p.$active ? '#0D9488' : '#CBD5E1')}; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.4); outline-offset: 2px; }
`;
const Dot = styled.span<{ $active: boolean }>`
  flex-shrink: 0; margin-top: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid ${(p) => (p.$active ? '#14B8A6' : '#CBD5E1')};
  background: ${(p) => (p.$active ? '#14B8A6' : 'transparent')};
  box-shadow: ${(p) => (p.$active ? 'inset 0 0 0 2px #FFFFFF' : 'none')};
`;
const OptText = styled.span`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const OptLabel = styled.span`font-size: 13px; font-weight: 600; color: #0F172A;`;
const OptDesc = styled.span`font-size: 11px; color: #64748B; line-height: 1.5;`;
