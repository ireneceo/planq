// 파일 저장소 연동 설정 — Google Drive / PlanQ 자체
import React, { useEffect, useState, useCallback } from 'react';
import { startAuthPopup } from '../../services/oauth';
import { isNativeApp } from '../../services/native';
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
  last_error?: string | null;
  needs_reconnect?: boolean;
}

interface Props {
  businessId: number;
}

const StorageSettings: React.FC<Props> = ({ businessId }) => {
  const { t } = useTranslation('settings');
  const tr = (k: string, fb?: string) => t(k, (fb ?? '') as string) as unknown as string;

  const [providers, setProviders] = useState<{ gdrive: ProviderState; gcal: ProviderState }>({
    gdrive: { configured: false, connected: false },
    gcal:   { configured: false, connected: false },
  });
  const [planqStatus, setPlanqStatus] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<'gdrive' | 'gcal' | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<'gdrive' | 'gcal' | null>(null);
  // 독립 서버(S3 호환) — 운영 #29
  const [defaultProvider, setDefaultProvider] = useState<'planq' | 'gdrive' | 's3'>('planq');
  const [s3, setS3] = useState<{ endpoint?: string; region?: string; bucket?: string; path_prefix?: string; public_base_url?: string; is_active?: boolean; verified_at?: string | null; has_credentials?: boolean } | null>(null);
  const [s3Open, setS3Open] = useState(false);
  const [s3f, setS3f] = useState({ endpoint: '', region: 'us-east-1', bucket: '', path_prefix: '', public_base_url: '', access_key: '', secret_key: '' });
  const [s3busy, setS3busy] = useState(false);
  const [s3msg, setS3msg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pv, st, usage, stg] = await Promise.all([
        apiFetch('/api/cloud/providers').then(r => r.json()).catch(() => null),
        apiFetch(`/api/cloud/status/${businessId}`).then(r => r.json()).catch(() => null),
        fetchStorageStatus(businessId),
        apiFetch(`/api/businesses/${businessId}/storage`).then(r => r.json()).catch(() => null),
      ]);
      const next = {
        gdrive: { configured: !!pv?.data?.gdrive?.configured, connected: !!st?.data?.gdrive, ...st?.data?.gdrive },
        gcal:   { configured: !!pv?.data?.gcal?.configured,   connected: !!st?.data?.gcal,   ...st?.data?.gcal },
      };
      setProviders(next);
      setPlanqStatus(usage);
      if (stg?.success) {
        setDefaultProvider(stg.data?.default_storage_provider || 'planq');
        setS3(stg.data?.s3 || null);
        if (stg.data?.s3) setS3f(f => ({ ...f, endpoint: stg.data.s3.endpoint || '', region: stg.data.s3.region || 'us-east-1', bucket: stg.data.s3.bucket || '', path_prefix: stg.data.s3.path_prefix || '', public_base_url: stg.data.s3.public_base_url || '' }));
      }
    } finally { setLoading(false); }
  }, [businessId]);

  const saveS3 = async () => {
    setS3busy(true); setS3msg(null);
    try {
      const body: Record<string, unknown> = { endpoint: s3f.endpoint.trim(), region: s3f.region.trim() || 'us-east-1', bucket: s3f.bucket.trim(), path_prefix: s3f.path_prefix.trim() || null, public_base_url: s3f.public_base_url.trim() || null };
      if (s3f.access_key.trim()) body.access_key = s3f.access_key.trim();
      if (s3f.secret_key.trim()) body.secret_key = s3f.secret_key.trim();
      const r = await apiFetch(`/api/businesses/${businessId}/storage`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s3: body }) });
      const j = await r.json();
      if (r.ok && j.success) { setS3msg({ tone: 'ok', text: tr('storage.s3.saved', '저장됨 — 연결 테스트를 진행하세요') }); setS3f(f => ({ ...f, access_key: '', secret_key: '' })); await load(); }
      else setS3msg({ tone: 'err', text: j.message || tr('storage.s3.saveFail', '저장 실패') });
    } catch { setS3msg({ tone: 'err', text: tr('storage.s3.saveFail', '저장 실패') }); }
    finally { setS3busy(false); }
  };
  const testS3 = async () => {
    setS3busy(true); setS3msg(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/storage/test`, { method: 'POST' });
      const j = await r.json();
      if (r.ok && j.success) { setS3msg({ tone: 'ok', text: tr('storage.s3.verified', '연결 성공 — 이제 저장소로 선택할 수 있습니다') }); await load(); }
      else setS3msg({ tone: 'err', text: j.message || tr('storage.s3.testFail', '연결 실패') });
    } catch { setS3msg({ tone: 'err', text: tr('storage.s3.testFail', '연결 실패') }); }
    finally { setS3busy(false); }
  };
  const selectProvider = async (p: 'planq' | 'gdrive' | 's3') => {
    setS3busy(true); setS3msg(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/storage`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ default_storage_provider: p }) });
      const j = await r.json();
      if (r.ok && j.success) { setDefaultProvider(p); }
      else setS3msg({ tone: 'err', text: j.message || tr('storage.s3.selectFail', '선택 실패') });
    } catch { setS3msg({ tone: 'err', text: tr('storage.s3.selectFail', '선택 실패') }); }
    finally { setS3busy(false); }
  };

  useEffect(() => { load(); }, [load]);

  // OAuth 팝업 수신 (회사 공용 gdrive/gcal) — 웹 postMessage + 네이티브 planq:oauth-connected
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if ((e.data?.type === 'gdrive:connected' || e.data?.type === 'gcal:connected') && e.data.ok) {
        setConnecting(null);
        load();
      }
    };
    // 네이티브: 시스템 브라우저 OAuth 완료 후 앱 복귀(App.tsx appUrlOpen) 시 발행.
    const onNativeDone = () => { setConnecting(null); load(); };
    // 시스템 브라우저가 닫힘(성공/취소 공통) — 연결 중 스피너 해제 (L-4).
    const onDismiss = () => setConnecting(null);
    window.addEventListener('message', onMsg);
    window.addEventListener('planq:oauth-connected', onNativeDone);
    window.addEventListener('planq:oauth-dismissed', onDismiss);
    return () => {
      window.removeEventListener('planq:oauth-connected', onNativeDone);
      window.removeEventListener('planq:oauth-dismissed', onDismiss);
      window.removeEventListener('message', onMsg);
    };
  }, [load]);

  const handleConnect = async (provider: 'gdrive' | 'gcal') => {
    setConnecting(provider);
    try {
      const r = await apiFetch(`/api/cloud/connect/${provider}/${businessId}`, { method: 'POST' });
      const j = await r.json();
      if (!j.success || !j.data?.auth_url) {
        setConnecting(null);
        return;
      }
      const w = 540, h = 640;
      const left = (window.screen.width - w) / 2;
      const top = (window.screen.height - h) / 2;
      // 직접 popup 참조 보관 — 이름으로 다시 찾는 window.open('', 'name') 패턴은
      // 명명창이 사라진 후 빈 새 창을 만들어내므로 절대 사용하지 않는다.
      // 웹: 팝업 + closed 폴링. 네이티브: 시스템 브라우저 → 완료는 planq:oauth-connected 이벤트로(§6.8).
      const popup = await startAuthPopup(j.data.auth_url, `planq-oauth-${provider}`, `width=${w},height=${h},left=${left},top=${top}`);
      if (isNativeApp()) return;  // 네이티브: 앱 복귀 이벤트가 load() 담당 (아래 useEffect)
      if (!popup) {
        // 팝업 차단됨
        setConnecting(null);
        return;
      }
      // postMessage 가 도착하지 않은 채로 사용자가 popup 을 닫는 케이스 — 참조의 closed 만 폴링.
      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer);
          // 약간의 grace — postMessage 가 unload 직전에 도달하는 경우가 있어 200ms 대기 후 상태 정리
          window.setTimeout(() => { setConnecting(null); load(); }, 200);
        }
      }, 800);
    } catch {
      setConnecting(null);
    }
  };

  const handleDisconnect = async () => {
    if (!disconnectTarget) return;
    const r = await apiFetch(`/api/cloud/disconnect/${disconnectTarget}/${businessId}`, { method: 'DELETE' });
    if (!r.ok) {  // apiFetch 는 throw 안 함 — 실패 시 모달 유지 + 에러 표시(거짓 해제 방지)
      const j = await r.json().catch(() => ({}));
      setS3msg({ tone: 'err', text: j?.message || tr('storage.disconnectFailed') });
      return;
    }
    setDisconnectTarget(null);
    await load();
  };

  if (loading) return <Skeleton />;

  const gdriveConnected = providers.gdrive.connected;

  return (
    <Wrap>
      {/* 외부 헤더 (WorkspaceSettingsPage 의 pageTitle) 가 이미 "파일·외부 연동" 표시.
          내부 제목 중복 노출 차단 — desc 만 유지. */}
      <SectionDesc>{tr('storage.desc', '워크스페이스 파일 보관 위치와 외부 연동을 설정합니다. 자체 스토리지 또는 Google Drive 중 선택, Google Calendar 연결 시 화상회의 자동 발급.')}</SectionDesc>

      <Notice>
        <NoticeIcon aria-hidden>!</NoticeIcon>
        <NoticeText>
          <strong>{tr('storage.scopeTitle', '파일 보관 위치 — 워크스페이스 공용 vs 개인 보관함')}</strong>
          <ul>
            <li>{tr('storage.scopeBackedUp', '워크스페이스 공용 (프로젝트·업무·채팅 첨부): Drive 연결 시 Drive 로, 미연결 시 자체 스토리지')}</li>
            <li>{tr('storage.scopeLocal', '개인 보관함 (내 파일·개인 메모): 항상 자체 스토리지 — Drive 연동과 무관, 개인별 분리 없음 (워크스페이스 공용 quota 안 합산)')}</li>
            <li>{tr('storage.scopeOneWay', 'Drive 에서 직접 만들거나 삭제한 파일은 PlanQ 와 동기화되지 않습니다. 파일 관리는 PlanQ 안에서만 해주세요.')}</li>
          </ul>
        </NoticeText>
      </Notice>

      {/* PlanQ 자체 — 항상 "사용 중" (개인 보관함은 Drive 무관, 항상 자체) */}
      <ProviderCard $active={true}>
        <CardHead>
          <CardIcon $bg="#F0FDFA" $fg="#0D9488">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </CardIcon>
          <CardTitleWrap>
            <CardTitle>{tr('storage.planq.title', 'PlanQ 자체 스토리지')}</CardTitle>
            <CardSub>
              {gdriveConnected
                ? tr('storage.planq.descConnected', '개인 보관함은 항상 자체 스토리지. 워크스페이스 공용 신규 업로드는 Drive 로 — 기존 파일 그대로 유지.')
                : tr('storage.planq.desc', '워크스페이스 공용 + 개인 보관함 모두 자체 스토리지. 플랜별 용량 한도 적용.')}
            </CardSub>
          </CardTitleWrap>
          <StatusBadge $kind="active">{tr('storage.active', '사용 중')}</StatusBadge>
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

      {/* 회사 공용 Google Drive (워크스페이스, owner/admin 권한) */}
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
            <CardTitle>{tr('storage.gdriveTeam.title', '회사 공용 Google Drive')}</CardTitle>
            <CardSub>
              {gdriveConnected
                ? `${tr('storage.connected', '연결됨')} · ${providers.gdrive.account_email || ''}`
                : tr('storage.gdriveTeam.desc', '워크스페이스 공용, 프로젝트 자료 저장 · 앱 전용 폴더(drive.file)')}
            </CardSub>
          </CardTitleWrap>
          {gdriveConnected && (providers.gdrive.needs_reconnect
            ? <StatusBadge $kind="inactive">{tr('storage.reconnectNeeded', '재연결 필요')}</StatusBadge>
            : <StatusBadge $kind="active">{tr('storage.active', '사용 중')}</StatusBadge>)}
        </CardHead>
        {gdriveConnected && providers.gdrive.needs_reconnect && (
          <CardActions>
            <S3Msg $tone="err">{tr('storage.tokenError', 'Google 인증이 만료되었습니다 — 다시 연결해 주세요')}</S3Msg>
            <PrimaryBtn type="button" disabled={!!connecting} onClick={() => handleConnect('gdrive')}>
              {connecting === 'gdrive' ? tr('storage.connecting', '연결 중…') : tr('storage.reconnect', '다시 연결')}
            </PrimaryBtn>
          </CardActions>
        )}
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

      {/* 독립 서버 (S3 호환) — 운영 #29 */}
      <ProviderCard $active={defaultProvider === 's3'}>
        <CardHead>
          <CardIcon $bg="#F0FDFA" $fg="#0F766E">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
            </svg>
          </CardIcon>
          <CardTitleWrap>
            <CardTitle>{tr('storage.s3.title', '독립 서버 (S3 호환)')}</CardTitle>
            <CardSub>
              {s3?.verified_at
                ? `${tr('storage.connected', '연결됨')} · ${s3.bucket}`
                : tr('storage.s3.desc', '내 서버/S3 호환 스토리지(MinIO·Cloudflare R2·Wasabi·AWS S3)를 파일 저장소로 사용합니다. 자격은 암호화 저장.')}
            </CardSub>
          </CardTitleWrap>
          {defaultProvider === 's3' && <StatusBadge $kind="active">{tr('storage.active', '사용 중')}</StatusBadge>}
        </CardHead>
        <CardActions>
          <LinkBtn type="button" onClick={() => setS3Open(o => !o)}>
            {s3Open ? tr('storage.s3.collapse', '접기') : (s3?.has_credentials ? tr('storage.s3.edit', '설정 수정') : tr('storage.s3.setup', '설정하기'))}
          </LinkBtn>
          {s3?.verified_at && defaultProvider !== 's3' && (
            <PrimaryBtn type="button" disabled={s3busy} onClick={() => selectProvider('s3')}>{tr('storage.s3.use', '이 저장소 사용')}</PrimaryBtn>
          )}
          {defaultProvider === 's3' && (
            <DangerBtn type="button" disabled={s3busy} onClick={() => selectProvider('planq')}>{tr('storage.s3.revert', '자체로 되돌리기')}</DangerBtn>
          )}
        </CardActions>
        {s3Open && (
          <S3Form>
            <S3Field><S3Label>Endpoint (https)</S3Label><S3Input value={s3f.endpoint} onChange={e => setS3f(f => ({ ...f, endpoint: e.target.value }))} placeholder="https://s3.example.com" /></S3Field>
            <S3Row>
              <S3Field><S3Label>Region</S3Label><S3Input value={s3f.region} onChange={e => setS3f(f => ({ ...f, region: e.target.value }))} placeholder="us-east-1" /></S3Field>
              <S3Field><S3Label>Bucket</S3Label><S3Input value={s3f.bucket} onChange={e => setS3f(f => ({ ...f, bucket: e.target.value }))} placeholder="my-bucket" /></S3Field>
            </S3Row>
            <S3Row>
              <S3Field><S3Label>Access Key</S3Label><S3Input type="password" value={s3f.access_key} onChange={e => setS3f(f => ({ ...f, access_key: e.target.value }))} placeholder={s3?.has_credentials ? tr('storage.s3.savedKey', '저장됨 (변경 시만 입력)') : ''} /></S3Field>
              <S3Field><S3Label>Secret Key</S3Label><S3Input type="password" value={s3f.secret_key} onChange={e => setS3f(f => ({ ...f, secret_key: e.target.value }))} placeholder={s3?.has_credentials ? tr('storage.s3.savedKey', '저장됨 (변경 시만 입력)') : ''} /></S3Field>
            </S3Row>
            <S3Field><S3Label>{tr('storage.s3.prefix', '경로 접두 (선택)')}</S3Label><S3Input value={s3f.path_prefix} onChange={e => setS3f(f => ({ ...f, path_prefix: e.target.value }))} placeholder="planq" /></S3Field>
            <S3Field><S3Label>{tr('storage.s3.publicUrl', 'Public Base URL (선택 · CDN)')}</S3Label><S3Input value={s3f.public_base_url} onChange={e => setS3f(f => ({ ...f, public_base_url: e.target.value }))} placeholder="https://cdn.example.com" /></S3Field>
            {s3msg && <S3Msg $tone={s3msg.tone}>{s3msg.text}</S3Msg>}
            <S3Actions>
              <PrimaryBtn type="button" disabled={s3busy} onClick={saveS3}>{tr('common.save', '저장')}</PrimaryBtn>
              <LinkBtn type="button" disabled={s3busy || !s3?.has_credentials} onClick={testS3}>{tr('storage.s3.test', '연결 테스트')}</LinkBtn>
              {s3?.verified_at && <S3Verified>✓ {tr('storage.s3.verifiedBadge', '검증됨')}</S3Verified>}
            </S3Actions>
          </S3Form>
        )}
      </ProviderCard>

      {/* Google Calendar — 화상회의 자동 생성용 (사이클 N+13, Daily.co 완전 교체) */}
      <ProviderCard $active={providers.gcal.connected}>
        <CardHead>
          <CardIcon $bg="#DBEAFE" $fg="#1D4ED8">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </CardIcon>
          <CardTitleWrap>
            <CardTitle>{tr('storage.gcal.title', 'Google Calendar (Meet 자동 생성)')}</CardTitle>
            <CardSub>
              {providers.gcal.connected
                ? `${tr('storage.connected', '연결됨')} · ${providers.gcal.account_email || ''}`
                : tr('storage.gcal.desc', '화상 미팅 일정 만들 때 Google Meet 링크가 자동으로 발급됩니다 (calendar.events scope)')}
            </CardSub>
          </CardTitleWrap>
          {providers.gcal.connected && <StatusBadge $kind="active">{tr('storage.active', '사용 중')}</StatusBadge>}
        </CardHead>
        <CardActions>
          {!providers.gcal.configured ? (
            <InlineHint>{tr('storage.gcal.notConfigured', '서버에 Google OAuth 가 설정되지 않았습니다 (.env 확인 필요)')}</InlineHint>
          ) : providers.gcal.connected ? (
            <DangerBtn type="button" onClick={() => setDisconnectTarget('gcal')}>
              {tr('storage.disconnect', '연결 해제')}
            </DangerBtn>
          ) : (
            <PrimaryBtn type="button" disabled={!!connecting} onClick={() => handleConnect('gcal')}>
              {connecting === 'gcal' ? tr('storage.connecting', '연결 중…') : tr('storage.connect', '연결하기')}
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

const Wrap = styled.div`display:flex;flex-direction:column;gap:12px;`;
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
const StatusBadge = styled.span<{ $kind: 'active' | 'soon' | 'inactive' }>`
  flex-shrink:0;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;
  ${p => p.$kind === 'active'
    ? 'background:#F0FDFA;color:#0F766E;'
    : p.$kind === 'inactive'
      ? 'background:#F1F5F9;color:#64748B;border:1px solid #E2E8F0;'
      : 'background:#F1F5F9;color:#94A3B8;'}
`;
const Notice = styled.div`
  display:flex;align-items:flex-start;gap:10px;
  background:#FEF3C7;border:1px solid #FDE68A;border-radius:10px;
  padding:10px 14px;margin-bottom:4px;
`;
const NoticeIcon = styled.span`
  flex-shrink:0;width:20px;height:20px;
  background:#F59E0B;color:#fff;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:700;line-height:1;
`;
const NoticeText = styled.div`
  font-size:12.5px;color:#78350F;line-height:1.55;
  strong { display:block; color:#78350F; font-weight:700; margin-bottom:4px; }
  ul { margin:0; padding-left:18px; }
  li { margin-bottom:2px; }
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
// 독립 서버(S3) 설정 폼 (운영 #29)
const S3Form = styled.div`margin-top:12px;padding:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;display:flex;flex-direction:column;gap:10px;`;
const S3Row = styled.div`display:flex;gap:10px;@media (max-width:560px){flex-direction:column;}`;
const S3Field = styled.div`flex:1;display:flex;flex-direction:column;gap:4px;min-width:0;`;
const S3Label = styled.label`font-size:12px;font-weight:600;color:#334155;`;
const S3Input = styled.input`width:100%;padding:7px 10px;font-size:13px;color:#0F172A;background:#fff;border:1px solid #E2E8F0;border-radius:6px;&:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15);}`;
const S3Msg = styled.div<{ $tone:'ok'|'err' }>`font-size:12px;padding:8px 12px;border-radius:8px;background:${p=>p.$tone==='ok'?'#F0FDF4':'#FEF2F2'};color:${p=>p.$tone==='ok'?'#166534':'#B91C1C'};`;
const S3Actions = styled.div`display:flex;align-items:center;gap:10px;`;
const S3Verified = styled.span`font-size:12px;font-weight:700;color:#166534;`;

const Modal = styled.div`
  position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.24);
  display:flex;align-items:center;justify-content:center;padding:20px;
  @media (max-width: 640px) { padding:0; align-items:stretch; }
`;
const Dialog = styled.div`
  background:#fff;border-radius:14px;width:100%;max-width:440px;
  box-shadow:0 20px 50px rgba(15,23,42,.2);display:flex;flex-direction:column;overflow:hidden;
  @media (max-width: 640px) {
    max-width:none;border-radius:0;
    margin-top:60px;max-height:calc(100vh - 60px);max-height:calc(100dvh - 60px);
    overflow-y:auto;
  }
`;
const DTitle = styled.div`padding:18px 20px 10px;font-size:15px;font-weight:700;color:#0F172A;`;
const DBody = styled.div`padding:0 20px 16px;font-size:13px;color:#475569;line-height:1.5;strong{color:#0F172A;}p{margin:4px 0;}`;
const DFooter = styled.div`padding:12px 20px;border-top:1px solid #E2E8F0;display:flex;gap:8px;justify-content:flex-end;`;
