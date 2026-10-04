// AI 앱 연결 동의 (#439) — ChatGPT·Claude 가 «PlanQ 연결» 을 누르면 여기로 온다.
//
//   흐름: 외부 AI → /agent/authorize → 302 /connect/agent?request=<id> → (로그인) → 이 화면
//         → 워크스페이스 하나 + 권한 묶음(읽기만 / 읽기+추가·수정) → [연결] → 외부 AI 로 돌아간다.
//   «누가 연결할 수 있나» 는 서버(services/agent_oauth/grants.canConnect)가 정한다 — 화면은 받은 목록만 보여준다.
//   메일 읽기(M3-a, 설계 docs/AI_AGENT_M3_DESIGN.md §3.1)는 묶음과 따로 체크박스 하나(기본 꺼짐). 켜면 **보일 계정**을 그 자리에
//   그린다 — 어디로 가는지 모르면 확인할 수 없다. 워크스페이스가 꺼 뒀거나 계정이 없으면 비활성 + 이유. 서버도 같은 조건을 다시 본다.
//   앱 틀(사이드바·탭) 밖의 단독 화면이다(초대 수락 화면과 같은 자리).
import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../contexts/AuthContext';
import ActionButton from '../../components/Common/ActionButton';
import PlanQSelect from '../../components/Common/PlanQSelect';

interface MailAccount { account_id: number; email: string; is_personal: boolean; is_active: boolean }
interface Workspace {
  business_id: number; name: string; role: string;
  mail?: { enabled: boolean; accounts: MailAccount[] };
}
interface RequestInfo {
  client_name: string | null;
  provider: string | null;
  provider_label: string | null;
  redirect_host: string | null;
  wants_write: boolean;
  workspaces: Workspace[];
}

const AgentConsentPage: React.FC = () => {
  const { t } = useTranslation('profile');
  const [params] = useSearchParams();
  const requestId = params.get('request') || '';
  const [info, setInfo] = useState<RequestInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bizId, setBizId] = useState<number | null>(null);
  const [access, setAccess] = useState<'read' | 'write'>('write');
  const [mail, setMail] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/agent/oauth/request/${encodeURIComponent(requestId)}`);
        const j = await r.json();
        if (dead) return;
        if (!j.success) { setError(j.message === 'request_expired' ? 'expired' : 'failed'); return; }
        const d = j.data as RequestInfo;
        setInfo(d);
        setAccess(d.wants_write ? 'write' : 'read');
        if (d.workspaces.length === 1) setBizId(d.workspaces[0].business_id);
      } catch { if (!dead) setError('failed'); }
    })();
    return () => { dead = true; };
  }, [requestId]);

  const appName = info?.provider_label || info?.client_name || t('agentConsent.unknownApp');
  const options = useMemo(() => (info?.workspaces || []).map((w) => ({ value: w.business_id, label: w.name })), [info]);
  const ws = useMemo(() => (info?.workspaces || []).find((w) => w.business_id === bizId) || null, [info, bizId]);
  // 체크박스를 못 켜는 이유 — 화면이 말한다(눌리게 두고 서버가 거절하면 «아무 일도 안 일어남» 이다)
  const mailBlocked: string | null = !ws ? 'mailSelectWorkspace'
    : !ws.mail?.enabled ? 'mailDisabledByWorkspace'
      : !(ws.mail?.accounts || []).length ? 'mailNoAccounts' : null;
  // 워크스페이스를 바꾸면 계정 목록이 달라진다 — 앞 워크스페이스에서 켠 체크를 그대로 들고 가지 않는다
  useEffect(() => { setMail(false); }, [bizId]);

  const submit = async (approve: boolean) => {
    if (submitting || (approve && !bizId)) return;
    setSubmitting(true);
    try {
      const r = await apiFetch('/api/agent/oauth/consent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, business_id: bizId, access, approve, mail: approve && mail && !mailBlocked }),
      });
      const j = await r.json();
      if (!j.success || !j.data?.redirect) { setError(j.message === 'request_expired' ? 'expired' : 'failed'); setSubmitting(false); return; }
      window.location.href = j.data.redirect;   // 외부 AI 로 돌아간다 — 버튼은 잠근 채 둔다(두 번 누름 방지)
    } catch { setError('failed'); setSubmitting(false); }
  };

  return (
    <Page>
      <Card role="main" data-testid="agent-consent">
        <Brand>PlanQ</Brand>
        {error ? (
          <>
            <Title>{error === 'expired' ? t('agentConsent.expiredTitle') : t('agentConsent.failedTitle')}</Title>
            <Body>{error === 'expired' ? t('agentConsent.expiredBody') : t('agentConsent.failedBody')}</Body>
          </>
        ) : !info ? (
          <Body>{t('agentConsent.loading')}</Body>
        ) : info.workspaces.length === 0 ? (
          <>
            <Title>{t('agentConsent.title', { app: appName })}</Title>
            <Body>{t('agentConsent.noWorkspace')}</Body>
            <Actions><ActionButton tone="secondary" size="md" onClick={() => submit(false)} disabled={submitting}>{t('agentConsent.cancel')}</ActionButton></Actions>
          </>
        ) : (
          <>
            <Title>{t('agentConsent.title', { app: appName })}</Title>
            {info.redirect_host && <Muted>{t('agentConsent.from', { host: info.redirect_host })}</Muted>}
            <Field>
              <Label>{t('agentConsent.workspace')}</Label>
              <PlanQSelect
                options={options}
                value={options.find((o) => o.value === bizId) || null}
                onChange={(o) => setBizId(o ? Number((o as { value: number }).value) : null)}
                placeholder={t('agentConsent.workspacePlaceholder') as string}
              />
            </Field>
            <Field>
              <Label>{t('agentConsent.access')}</Label>
              <Choice $on={access === 'read'}>
                <input type="radio" name="access" checked={access === 'read'} onChange={() => setAccess('read')} />
                <span><strong>{t('agentConsent.readTitle')}</strong><small>{t('agentConsent.readBody')}</small></span>
              </Choice>
              <Choice $on={access === 'write'}>
                <input type="radio" name="access" checked={access === 'write'} onChange={() => setAccess('write')} />
                <span><strong>{t('agentConsent.writeTitle')}</strong><small>{t('agentConsent.writeBody')}</small></span>
              </Choice>
            </Field>
            <Field data-testid="agent-consent-mail">
              <Choice $on={mail && !mailBlocked} $disabled={!!mailBlocked}>
                <input type="checkbox" checked={mail && !mailBlocked} disabled={!!mailBlocked}
                  onChange={(e) => setMail(e.target.checked)} data-testid="agent-consent-mail-check" />
                <span>
                  <strong>{t('agentConsent.mailTitle')}</strong>
                  <small>{t('agentConsent.mailBody')}</small>
                  {mailBlocked && <Reason data-testid="agent-consent-mail-reason">{t(`agentConsent.${mailBlocked}`)}</Reason>}
                </span>
              </Choice>
              {mail && !mailBlocked && ws?.mail && (
                <Accounts data-testid="agent-consent-mail-accounts">
                  <Label>{t('agentConsent.mailAccounts')}</Label>
                  {ws.mail.accounts.map((a) => (
                    <AccountRow key={a.account_id} data-testid={`agent-consent-account-${a.account_id}`}>
                      <AccountEmail>{a.email}</AccountEmail>
                      <Badge $personal={a.is_personal}>{a.is_personal ? t('agentConsent.personalAccount') : t('agentConsent.sharedAccount')}</Badge>
                    </AccountRow>
                  ))}
                  <Small>{t('agentConsent.mailTransferNote')}</Small>
                </Accounts>
              )}
            </Field>
            <Note>{t('agentConsent.note')} {t('agentConsent.dataNote')}</Note>
            <Actions>
              <ActionButton tone="secondary" size="md" onClick={() => submit(false)} disabled={submitting}>{t('agentConsent.cancel')}</ActionButton>
              <ActionButton tone="primary" size="md" onClick={() => submit(true)} disabled={!bizId || submitting} loading={submitting}
                data-testid="agent-consent-approve">{t('agentConsent.connect')}</ActionButton>
            </Actions>
          </>
        )}
      </Card>
    </Page>
  );
};

export default AgentConsentPage;

const Page = styled.div`
  min-height: 100vh; background: #F8FAFC;
  display: flex; align-items: flex-start; justify-content: center;
  padding: 48px 16px;
  @media (max-width: 640px) { padding: 24px 16px; }
`;
const Card = styled.div`
  width: 100%; max-width: 460px; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 14px; padding: 28px 24px;
  display: flex; flex-direction: column; gap: 14px;
`;
const Brand = styled.div`font-size: 0.875rem; font-weight: 800; color: #0F766E; letter-spacing: 0.2px;`;
const Title = styled.h1`margin: 0; font-size: 1.125rem; font-weight: 700; color: #0F172A; line-height: 1.4;`;
const Body = styled.p`margin: 0; font-size: 0.875rem; color: #475569; line-height: 1.6;`;
const Muted = styled.div`font-size: 0.75rem; color: #94A3B8;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Label = styled.div`font-size: 0.75rem; font-weight: 600; color: #334155;`;
const Choice = styled.label<{ $on: boolean; $disabled?: boolean }>`
  display: flex; gap: 10px; align-items: flex-start; cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  opacity: ${(p) => (p.$disabled ? 0.75 : 1)};
  padding: 10px 12px; border-radius: 10px;
  border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  background: ${(p) => (p.$on ? '#F0FDFA' : '#FFFFFF')};
  input { margin-top: 3px; }
  span { display: flex; flex-direction: column; gap: 2px; }
  strong { font-size: 0.8125rem; color: #0F172A; }
  small { font-size: 0.75rem; color: #64748B; line-height: 1.5; }
`;
const Reason = styled.em`font-style: normal; font-size: 0.75rem; color: #B45309; line-height: 1.5;`;
const Accounts = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px; border-radius: 10px; background: #F8FAFC; border: 1px solid #E2E8F0;
`;
const AccountRow = styled.div`display: flex; align-items: center; gap: 8px; min-width: 0;`;
const AccountEmail = styled.span`flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; font-size: 0.8125rem; color: #0F172A;`;
const Badge = styled.span<{ $personal: boolean }>`
  flex: 0 0 auto; padding: 2px 8px; border-radius: 999px; font-size: 0.6875rem; font-weight: 600;
  background: ${(p) => (p.$personal ? '#FFF1F2' : '#F0FDFA')}; color: ${(p) => (p.$personal ? '#BE123C' : '#0F766E')};
`;
const Small = styled.p`margin: 2px 0 0; font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Note = styled.p`margin: 0; font-size: 0.75rem; color: #64748B; line-height: 1.6;`;
const Actions = styled.div`display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;`;
