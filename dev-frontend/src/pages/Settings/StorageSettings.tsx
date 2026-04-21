// 파일 저장소 연동 설정 — Google Drive / Dropbox / PlanQ 자체
import React, { useEffect, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { fetchStorageStatus, formatBytes, type StorageStatus } from '../../services/files';

interface ProviderState {
  configured: boolean;
  connected: boolean;
  account_email?: string;
  root_folder_id?: string;
  connected_at?: string;
}

interface Props {
  businessId: number;
}

const StorageSettings: React.FC<Props> = ({ businessId }) => {
  const { t } = useTranslation('settings');
  const tr = (k: string, fb?: string) => t(k, (fb ?? '') as string) as unknown as string;

  const [providers, setProviders] = useState<{ gdrive: ProviderState; dropbox: ProviderState }>({
    gdrive: { configured: false, connected: false },
    dropbox: { configured: false, connected: false }
  });
  const [planqStatus, setPlanqStatus] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<'gdrive' | 'dropbox' | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<'gdrive' | 'dropbox' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pv, st, usage] = await Promise.all([
        apiFetch('/api/cloud/providers').then(r => r.json()).catch(() => null),
        apiFetch(`/api/cloud/status/${businessId}`).then(r => r.json()).catch(() => null),
        fetchStorageStatus(businessId)
      ]);
      const next = {
        gdrive: { configured: !!pv?.data?.gdrive?.configured, connected: !!st?.data?.gdrive, ...st?.data?.gdrive },
        dropbox: { configured: !!pv?.data?.dropbox?.configured, connected: !!st?.data?.dropbox, ...st?.data?.dropbox }
      };
      setProviders(next);
      setPlanqStatus(usage);
    } finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  // OAuth 팝업 수신 (gdrive + dropbox)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if ((e.data?.type === 'gdrive:connected' || e.data?.type === 'dropbox:connected') && e.data.ok) {
        setConnecting(null);
        load();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [load]);

  const handleConnect = async (provider: 'gdrive' | 'dropbox') => {
    setConnecting(provider);
    try {
      const r = await apiFetch(`/api/cloud/connect/${provider}/${businessId}`, { method: 'POST' });
      const j = await r.json();
      if (j.success && j.data?.auth_url) {
        const w = 540, h = 640;
        const left = (window.screen.width - w) / 2;
        const top = (window.screen.height - h) / 2;
        window.open(j.data.auth_url, 'planq-oauth', `width=${w},height=${h},left=${left},top=${top}`);
        // 팝업 닫힘 감지 (postMessage 없이 닫은 경우 재로드)
        const timer = setInterval(async () => {
          const pop = window.open('', 'planq-oauth');
          if (pop && pop.closed) {
            clearInterval(timer);
            setConnecting(null);
            await load();
          }
        }, 1500);
      } else {
        setConnecting(null);
      }
    } catch {
      setConnecting(null);
    }
  };

  const handleDisconnect = async () => {
    if (!disconnectTarget) return;
    await apiFetch(`/api/cloud/disconnect/${disconnectTarget}/${businessId}`, { method: 'DELETE' });
    setDisconnectTarget(null);
    await load();
  };

  if (loading) return <Skeleton />;

  const gdriveConnected = providers.gdrive.connected;

  return (
    <Wrap>
      <SectionTitle>{tr('storage.title', '파일 저장소')}</SectionTitle>
      <SectionDesc>{tr('storage.desc', '파일을 PlanQ 자체 스토리지에 보관할지, Google Drive 같은 외부 클라우드에 보관할지 선택하세요. 언제든 전환 가능하며, 기존 파일은 그대로 유지됩니다.')}</SectionDesc>

      {/* PlanQ 자체 */}
      <ProviderCard $active={!gdriveConnected}>
        <CardHead>
          <CardIcon $bg="#F0FDFA" $fg="#0D9488">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </CardIcon>
          <CardTitleWrap>
            <CardTitle>{tr('storage.planq.title', 'PlanQ 자체 스토리지')}</CardTitle>
            <CardSub>{tr('storage.planq.desc', '기본 저장소 · 플랜별 용량 한도 적용')}</CardSub>
          </CardTitleWrap>
          {!gdriveConnected && <StatusBadge $kind="active">{tr('storage.active', '사용 중')}</StatusBadge>}
        </CardHead>
        {planqStatus && (
          <CardBody>
            <UsageRow>
              <UsageBar>
                <UsageFill style={{ width: `${Math.min(100, (planqStatus.bytes_used / Math.max(1, planqStatus.bytes_quota)) * 100).toFixed(1)}%` }} />
              </UsageBar>
              <UsageText>
                {formatBytes(planqStatus.bytes_used)} / {formatBytes(planqStatus.bytes_quota)}
                <small> · {planqStatus.file_count} files · {planqStatus.plan}</small>
              </UsageText>
            </UsageRow>
          </CardBody>
        )}
      </ProviderCard>

      {/* Google Drive */}
      <ProviderCard $active={gdriveConnected}>
        <CardHead>
          <CardIcon $bg="#FEF3C7" $fg="#B45309">
            <svg width="22" height="22" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M17 6l-11 19 5 8 11-19z"/>
              <path fill="#1E88E5" d="M17 6l11 19h11L28 6z"/>
              <path fill="#4CAF50" d="M11 33l5 8h22l-5-8z"/>
              <path fill="#E53935" d="M28 25l11 8h-22z" opacity="0.7"/>
            </svg>
          </CardIcon>
          <CardTitleWrap>
            <CardTitle>{tr('storage.gdrive.title', 'Google Drive')}</CardTitle>
            <CardSub>
              {gdriveConnected
                ? `${tr('storage.connected', '연결됨')} · ${providers.gdrive.account_email || ''}`
                : tr('storage.gdrive.desc', '앱 전용 폴더(drive.file) — PlanQ 가 만든 파일만 접근')}
            </CardSub>
          </CardTitleWrap>
          {gdriveConnected && <StatusBadge $kind="active">{tr('storage.active', '사용 중')}</StatusBadge>}
        </CardHead>
        <CardActions>
          {!providers.gdrive.configured ? (
            <InlineHint>{tr('storage.gdrive.notConfigured', '서버에 OAuth 가 설정되지 않았습니다 (.env 확인 필요)')}</InlineHint>
          ) : gdriveConnected ? (
            <>
              <LinkBtn as="a" href={providers.gdrive.root_folder_id ? `https://drive.google.com/drive/folders/${providers.gdrive.root_folder_id}` : '#'} target="_blank" rel="noreferrer">
                {tr('storage.openInDrive', 'Drive 에서 열기')} ↗
              </LinkBtn>
              <DangerBtn type="button" onClick={() => setDisconnectTarget('gdrive')}>
                {tr('storage.disconnect', '연결 해제')}
              </DangerBtn>
            </>
          ) : (
            <PrimaryBtn type="button" disabled={!!connecting} onClick={() => handleConnect('gdrive')}>
              {connecting === 'gdrive' ? tr('storage.connecting', '연결 중…') : tr('storage.connect', '연결하기')}
            </PrimaryBtn>
          )}
        </CardActions>
      </ProviderCard>

      {/* Dropbox */}
      <ProviderCard $active={providers.dropbox.connected}>
        <CardHead>
          <CardIcon $bg="#DBEAFE" $fg="#1D4ED8">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 2l6 4-6 4-6-4zm12 0l6 4-6 4-6-4zM6 14l6 4-6 4-6-4zm12 0l6 4-6 4-6-4z" transform="scale(0.85) translate(1.5, 1.5)"/>
            </svg>
          </CardIcon>
          <CardTitleWrap>
            <CardTitle>Dropbox</CardTitle>
            <CardSub>
              {providers.dropbox.connected
                ? `${tr('storage.connected', '연결됨')} · ${providers.dropbox.account_email || ''}`
                : tr('storage.dropbox.desc', 'App Folder 모드 — /Apps/PlanQ/ 폴더 외 접근 불가')}
            </CardSub>
          </CardTitleWrap>
          {providers.dropbox.connected && <StatusBadge $kind="active">{tr('storage.active', '사용 중')}</StatusBadge>}
        </CardHead>
        <CardActions>
          {!providers.dropbox.configured ? (
            <InlineHint>{tr('storage.dropbox.notConfigured', '서버에 OAuth 가 설정되지 않았습니다 (.env 확인 필요)')}</InlineHint>
          ) : providers.dropbox.connected ? (
            <DangerBtn type="button" onClick={() => setDisconnectTarget('dropbox')}>
              {tr('storage.disconnect', '연결 해제')}
            </DangerBtn>
          ) : (
            <PrimaryBtn type="button" disabled={!!connecting} onClick={() => handleConnect('dropbox')}>
              {connecting === 'dropbox' ? tr('storage.connecting', '연결 중…') : tr('storage.connect', '연결하기')}
            </PrimaryBtn>
          )}
        </CardActions>
      </ProviderCard>

      {/* 연결 해제 확인 모달 */}
      {disconnectTarget && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget) setDisconnectTarget(null); }}>
          <Dialog>
            <DTitle>{tr('storage.disconnectTitle', '연결을 해제할까요?')}</DTitle>
            <DBody>
              <p>{tr('storage.disconnectDesc', '연결 해제 후에는 신규 업로드가 다시 PlanQ 자체 스토리지로 돌아갑니다.')}</p>
              <p><strong>{tr('storage.disconnectWarn', '외부 클라우드의 기존 파일은 그대로 남아있습니다.')}</strong></p>
            </DBody>
            <DFooter>
              <SecondaryBtn type="button" onClick={() => setDisconnectTarget(null)}>{tr('common.cancel', '취소')}</SecondaryBtn>
              <DangerBtn type="button" onClick={handleDisconnect}>{tr('storage.disconnect', '연결 해제')}</DangerBtn>
            </DFooter>
          </Dialog>
        </Modal>
      )}
    </Wrap>
  );
};

export default StorageSettings;

const Skeleton: React.FC = () => (
  <Wrap>
    <SkBar style={{ width: '40%', height: 18, marginBottom: 8 }} />
    <SkBar style={{ width: '80%', height: 12, marginBottom: 24 }} />
    <SkCard /><SkCard /><SkCard />
  </Wrap>
);

const shimmer = `@keyframes sk{0%{background-position:-200px 0}100%{background-position:calc(200px + 100%) 0}}`;
const SkBar = styled.div`background:linear-gradient(90deg,#F1F5F9 0px,#E2E8F0 40px,#F1F5F9 80px);background-size:200px 100%;animation:sk 1.2s linear infinite;border-radius:4px;${shimmer}`;
const SkCard = styled(SkBar)`height:88px;margin-bottom:12px;border-radius:12px;`;

const Wrap = styled.div`display:flex;flex-direction:column;gap:12px;max-width:720px;`;
const SectionTitle = styled.h2`font-size:18px;font-weight:700;color:#0F172A;margin:0;`;
const SectionDesc = styled.p`font-size:13px;color:#64748B;line-height:1.6;margin:0 0 12px;`;

const ProviderCard = styled.div<{ $active: boolean; $disabled?: boolean }>`
  background:#fff;border:1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  border-radius:12px;padding:16px 20px;
  box-shadow:${p => p.$active ? '0 4px 12px rgba(20,184,166,0.08)' : 'none'};
  opacity:${p => p.$disabled ? 0.6 : 1};
  display:flex;flex-direction:column;gap:12px;
`;
const CardHead = styled.div`display:flex;align-items:flex-start;gap:12px;`;
const CardIcon = styled.div<{ $bg: string; $fg: string }>`
  width:40px;height:40px;flex-shrink:0;
  background:${p => p.$bg};color:${p => p.$fg};
  border-radius:10px;display:flex;align-items:center;justify-content:center;
`;
const CardTitleWrap = styled.div`flex:1;min-width:0;`;
const CardTitle = styled.div`font-size:14px;font-weight:700;color:#0F172A;margin-bottom:2px;`;
const CardSub = styled.div`font-size:12px;color:#64748B;line-height:1.5;word-break:break-all;`;
const StatusBadge = styled.span<{ $kind: 'active' | 'soon' }>`
  flex-shrink:0;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;
  ${p => p.$kind === 'active' ? 'background:#F0FDFA;color:#0F766E;' : 'background:#F1F5F9;color:#94A3B8;'}
`;
const CardBody = styled.div`padding-top:4px;`;
const CardActions = styled.div`display:flex;gap:8px;justify-content:flex-end;`;
const UsageRow = styled.div`display:flex;flex-direction:column;gap:6px;`;
const UsageBar = styled.div`height:6px;background:#F1F5F9;border-radius:4px;overflow:hidden;`;
const UsageFill = styled.div`height:100%;background:#14B8A6;transition:width 0.3s;`;
const UsageText = styled.div`font-size:12px;color:#475569;small{color:#94A3B8;}`;

const PrimaryBtn = styled.button`
  height:34px;padding:0 16px;background:#14B8A6;color:#fff;border:none;border-radius:8px;
  font-size:13px;font-weight:600;cursor:pointer;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{opacity:0.5;cursor:not-allowed;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const SecondaryBtn = styled.button`
  height:34px;padding:0 14px;background:#fff;color:#0F172A;
  border:1px solid #CBD5E1;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
  &:hover{background:#F8FAFC;}
`;
const DangerBtn = styled.button`
  height:34px;padding:0 14px;background:#fff;color:#DC2626;
  border:1px solid #FCA5A5;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
  &:hover{background:#FEF2F2;border-color:#DC2626;}
`;
const LinkBtn = styled.button`
  height:34px;padding:0 14px;background:#F0FDFA;color:#0F766E;border:1px solid #99F6E4;border-radius:8px;
  font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none;
  &:hover{background:#CCFBF1;}
`;
const InlineHint = styled.div`font-size:12px;color:#94A3B8;padding:8px 12px;background:#F8FAFC;border-radius:8px;`;

const Modal = styled.div`position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.24);display:flex;align-items:center;justify-content:center;padding:20px;`;
const Dialog = styled.div`background:#fff;border-radius:14px;width:100%;max-width:440px;box-shadow:0 20px 50px rgba(15,23,42,.2);display:flex;flex-direction:column;overflow:hidden;`;
const DTitle = styled.div`padding:18px 20px 10px;font-size:15px;font-weight:700;color:#0F172A;`;
const DBody = styled.div`padding:0 20px 16px;font-size:13px;color:#475569;line-height:1.5;strong{color:#0F172A;}p{margin:4px 0;}`;
const DFooter = styled.div`padding:12px 20px;border-top:1px solid #EEF2F6;display:flex;gap:8px;justify-content:flex-end;`;
