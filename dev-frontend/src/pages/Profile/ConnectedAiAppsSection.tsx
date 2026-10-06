// 연결된 AI 앱 (#439) — ChatGPT·Claude 등에 내가 이 워크스페이스로 준 연결을 보고 끊는다.
//
//   연결은 사람 × 워크스페이스 하나다(설계 docs/AI_AGENT_INTEGRATION_DESIGN.md §4.3). 그래서 목록도 지금 워크스페이스만 보여준다.
//   연결하는 문은 AI 앱 쪽에 있다(ChatGPT 커스텀 커넥터에 아래 주소를 넣으면 PlanQ 동의 화면이 뜬다).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { Section, SectionTitle, SectionSub, Empty, ConnList, ConnRow, ConnInfo, ConnTitle, ConnSub, ConnMeta, DangerBtn } from './integrationStyles';

interface Grant {
  id: number;
  provider: string | null;
  client_name: string | null;
  access: 'read' | 'write';
  mail?: boolean;          // 메일 읽기(mail:read)를 받은 연결 — 「메일 포함」 칩(설계 M3 §3.1: 어느 연결이 메일을 보는지 알아야 끊는다)
  connected: boolean;
  created_at: string;
  last_used_at: string | null;
  outdated?: boolean;
}

const PROVIDER_LABEL: Record<string, string> = { openai: 'ChatGPT', anthropic: 'Claude', local: 'Local app' };

// AI 앱 쪽 «연결 추가» 화면 — 사용자가 메뉴를 찾아 헤매지 않게 바로 연다(2026-10-04, Irene: "링크까지 손쉽게 제대로 안내했어?").
//   ★ 메뉴 위치는 그쪽이 자주 바꾼다(2026-07 ChatGPT Connectors→Plugins 개명으로 우리 안내가 한 번 틀렸다).
//     주소가 바뀌면 여기와 도움말 «connect-chatgpt-claude» 를 같이 고친다.
const OPEN_URLS = {
  chatgpt: 'https://chatgpt.com/plugins',
  claude: 'https://claude.ai/customize/connectors',
};

const ConnectedAiAppsSection: React.FC<{ businessId: number }> = ({ businessId }) => {
  const { t } = useTranslation('profile');
  const { formatDateTime } = useTimeFormat();
  const [items, setItems] = useState<Grant[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState<Grant | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const connectorUrl = `${window.location.origin}/agent/mcp`;
  // 시작 안내의 «AI 앱 연결» 에서 오면(?focus=ai) 이 칸으로 내려 준다
  const rootRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('focus') === 'ai') {
        window.setTimeout(() => rootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 300);
      }
    } catch { /* noop */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/agent/grants?business_id=${businessId}`);
      const j = await r.json();
      if (!j.success) throw new Error(j.message);
      setItems(j.data as Grant[]);
      setFailed(false);
    } catch { setFailed(true); setItems([]); }
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

  const revoke = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/agent/grants/${target.id}`, { method: 'DELETE' });
      const j = await r.json();
      if (!j.success) throw new Error(j.message);
      setTarget(null);
      await load();
    } catch { setFailed(true); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(connectorUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* 복사 불가 환경 — 주소는 화면에 보인다 */ }
  };

  return (
    <Section data-testid="connected-ai-apps" id="ai" ref={rootRef as React.RefObject<HTMLDivElement>}>
      <SectionTitle>{t('aiApps.title')}</SectionTitle>
      <SectionSub>{t('aiApps.sub')}</SectionSub>
      <HowTo>
        <Steps>
          <li>
            <span>{t('aiApps.step1')}</span>
            <UrlRow>
              <Url>{connectorUrl}</Url>
              <CopyBtn type="button" data-testid="ai-apps-copy" onClick={copy}>{copied ? t('aiApps.copied') : t('aiApps.copy')}</CopyBtn>
            </UrlRow>
          </li>
          <li>
            <span>{t('aiApps.step2')}</span>
            <OpenRow>
              <OpenLink href={OPEN_URLS.chatgpt} target="_blank" rel="noopener noreferrer" data-testid="ai-apps-open-chatgpt">{t('aiApps.openChatgpt')} ↗</OpenLink>
              <OpenLink href={OPEN_URLS.claude} target="_blank" rel="noopener noreferrer" data-testid="ai-apps-open-claude">{t('aiApps.openClaude')} ↗</OpenLink>
            </OpenRow>
            <Hint>{t('aiApps.step2Hint')}</Hint>
          </li>
          <li><span>{t('aiApps.step3')}</span></li>
          <li><span>{t('aiApps.step4')}</span></li>
        </Steps>
        <HelpLink href="/guide/a/connect-chatgpt-claude" target="_blank" rel="noopener noreferrer">{t('aiApps.helpLink')} ↗</HelpLink>
      </HowTo>
      {items === null ? null : items.length === 0 ? (
        <Empty><span>{failed ? t('aiApps.loadFailed') : t('aiApps.empty')}</span></Empty>
      ) : (
        <ConnList>
          {items.map((g) => (
            <ConnRow key={g.id} data-testid={`ai-app-${g.id}`}>
              <ConnInfo>
                <ConnTitle>{(g.provider && PROVIDER_LABEL[g.provider]) || g.client_name || t('aiApps.unknownApp')}</ConnTitle>
                <ConnSub>
                  {g.access === 'write' ? t('aiApps.accessWrite') : t('aiApps.accessRead')}
                  {g.mail && <MailChip data-testid={`ai-app-mail-${g.id}`}>{t('aiApps.mailIncluded')}</MailChip>}
                </ConnSub>
                {/* 같은 이름(ChatGPT)이 둘일 때 구별할 수 있게 연결일과 마지막 사용을 같이 적는다 —
                    ChatGPT 웹과 Codex 처럼 다른 곳에서 각각 연결하면 연결이 둘이 된다(정상). */}
                <ConnMeta>
                  {t('aiApps.connectedAt', { date: formatDateTime(g.created_at) })}
                  {g.last_used_at && <> · {t('aiApps.lastUsed', { date: formatDateTime(g.last_used_at) })}</>}
                </ConnMeta>
                {g.outdated && <ConnMeta data-testid={`ai-app-outdated-${g.id}`}>{t('aiApps.outdated')}</ConnMeta>}
              </ConnInfo>
              <DangerBtn type="button" onClick={() => setTarget(g)}>{t('aiApps.disconnect')}</DangerBtn>
            </ConnRow>
          ))}
        </ConnList>
      )}
      <ConfirmDialog
        isOpen={!!target}
        onClose={() => setTarget(null)}
        onConfirm={revoke}
        title={t('aiApps.disconnectTitle')}
        message={t('aiApps.disconnectMessage', { app: (target?.provider && PROVIDER_LABEL[target.provider]) || target?.client_name || '' })}
        confirmText={busy ? t('aiApps.disconnecting') : t('aiApps.disconnect')}
        variant="danger"
      />
    </Section>
  );
};

export default ConnectedAiAppsSection;

const MailChip = styled.span`
  display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; vertical-align: middle;
  background: #FFF1F2; color: #BE123C; font-size: 0.6875rem; font-weight: 600;
`;
const HowTo = styled.div`
  display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px;
  font-size: 0.75rem; color: #475569; line-height: 1.5;
`;
const UrlRow = styled.div`display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 6px;`;
const Steps = styled.ol`
  margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 10px;
  li::marker { color: #0D9488; font-weight: 700; }
`;
const OpenRow = styled.div`display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px;`;
const OpenLink = styled.a`
  height: 32px; padding: 0 12px; display: inline-flex; align-items: center; border-radius: 6px;
  background: #F0FDFA; border: 1px solid #99F6E4; color: #0F766E; font-size: 0.75rem; font-weight: 600; text-decoration: none;
  &:hover { background: #CCFBF1; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
  @media (max-width: 640px) { height: 40px; }
`;
const Hint = styled.div`margin-top: 4px; font-size: 0.6875rem; color: #64748B;`;
const HelpLink = styled.a`
  align-self: flex-start; font-size: 0.75rem; font-weight: 600; color: #0D9488; text-decoration: none;
  &:hover { text-decoration: underline; }
`;
const Url = styled.code`
  flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere;
  padding: 6px 10px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 0.75rem; color: #0F172A;
`;
const CopyBtn = styled.button`
  height: 32px; padding: 0 12px; border-radius: 6px; cursor: pointer;
  background: #FFFFFF; border: 1px solid #CBD5E1; color: #334155; font-size: 0.75rem; font-weight: 600;
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
