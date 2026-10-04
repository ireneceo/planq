// 연결된 AI 앱 (#439) — ChatGPT·Claude 등에 내가 이 워크스페이스로 준 연결을 보고 끊는다.
//
//   연결은 사람 × 워크스페이스 하나다(설계 docs/AI_AGENT_INTEGRATION_DESIGN.md §4.3). 그래서 목록도 지금 워크스페이스만 보여준다.
//   연결하는 문은 AI 앱 쪽에 있다(ChatGPT 커스텀 커넥터에 아래 주소를 넣으면 PlanQ 동의 화면이 뜬다).
import React, { useCallback, useEffect, useState } from 'react';
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
}

const PROVIDER_LABEL: Record<string, string> = { openai: 'ChatGPT', anthropic: 'Claude', local: 'Local app' };

const ConnectedAiAppsSection: React.FC<{ businessId: number }> = ({ businessId }) => {
  const { t } = useTranslation('profile');
  const { formatDateTime } = useTimeFormat();
  const [items, setItems] = useState<Grant[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState<Grant | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const connectorUrl = `${window.location.origin}/agent/mcp`;

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
    <Section data-testid="connected-ai-apps">
      <SectionTitle>{t('aiApps.title')}</SectionTitle>
      <SectionSub>{t('aiApps.sub')}</SectionSub>
      <HowTo>
        <span>{t('aiApps.howTo')}</span>
        <UrlRow>
          <Url>{connectorUrl}</Url>
          <CopyBtn type="button" onClick={copy}>{copied ? t('aiApps.copied') : t('aiApps.copy')}</CopyBtn>
        </UrlRow>
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
                <ConnMeta>
                  {g.last_used_at
                    ? t('aiApps.lastUsed', { date: formatDateTime(g.last_used_at) })
                    : t('aiApps.connectedAt', { date: formatDateTime(g.created_at) })}
                </ConnMeta>
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
const UrlRow = styled.div`display: flex; gap: 8px; align-items: center; flex-wrap: wrap;`;
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
