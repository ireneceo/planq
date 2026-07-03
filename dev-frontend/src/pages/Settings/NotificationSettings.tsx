// 알림 설정 매트릭스 (Phase E4)
// 이벤트 × 채널 × On/Off — 사용자 본인 (워크스페이스 컨텍스트)
import { isNativeApp } from '../../services/native';
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation, Trans } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { InboxIcon, ChatIcon, MailIcon } from '../../components/Common/Icons';
import PwaInstallSection from './PwaInstallSection';
import WeeklyReviewAutoSection from '../../components/QTask/WeeklyReviewAutoSection';

interface Props {
  businessId: number;
  isOwner: boolean;
}

// 사이클 N+16-C — 'message' (채팅 일반) + 'comment_mention' (업무 댓글 멘션) 신규 토글.
// 옛 'mention' 은 채팅 @멘션 전용으로 의미 정정. 댓글 멘션은 별도 row.
type EventKind = 'message' | 'mention' | 'comment_mention' | 'signature' | 'invoice' | 'tax_invoice' | 'task' | 'event' | 'invite';
// 4 채널 — 인박스(영구) / 인앱(우측 상단 토스트) / 디바이스(OS push) / 이메일
type Channel = 'inbox' | 'chat' | 'push' | 'email';
type Matrix = Record<EventKind, Record<Channel, boolean>>;

const EVENTS: EventKind[] = [
  'message', 'mention',          // 채팅 (일반 메시지 / @멘션)
  'comment_mention',              // 업무·문서 댓글 @멘션
  'task', 'event', 'invite',     // 업무·일정·초대
  'signature', 'invoice', 'tax_invoice', // 청구·서명
];
const CHANNELS: Channel[] = ['inbox', 'chat', 'push', 'email'];

const NotificationSettings: React.FC<Props> = ({ businessId }) => {
  const { t } = useTranslation('settings');
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/notifications/prefs?business_id=${businessId}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (!j.success) throw new Error(j.message || 'load_failed');
        setMatrix(j.data.matrix as Matrix);
        setError(null);
      })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId]);

  const toggle = async (event: EventKind, channel: Channel) => {
    if (!matrix) return;
    const current = matrix[event][channel];
    const next = !current;
    const key = `${event}-${channel}`;
    setSavingKey(key);
    // 낙관적 업데이트
    setMatrix({ ...matrix, [event]: { ...matrix[event], [channel]: next } });
    try {
      const r = await apiFetch('/api/notifications/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, event_kind: event, channel, enabled: next }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'save_failed');
      // 사이클 N+16-C — Toaster 캐시 무효화 (chat channel 검사 즉시 반영).
      window.dispatchEvent(new Event('planq:notif-prefs-changed'));
    } catch (e) {
      // 실패 시 원복
      setMatrix({ ...matrix, [event]: { ...matrix[event], [channel]: current } });
      setError((e as Error).message);
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) return <Loading>{t('common.loading', '불러오는 중...')}</Loading>;
  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!matrix) return null;

  return (
    <Wrap>
      <PwaInstallSection />
      <PushSection businessId={businessId} />
      <WeeklyReviewAutoSection businessId={businessId} />

      <Section>
        <SectionTitle>{t('notifications.title', '알림 받기')}</SectionTitle>
        <SectionDesc>{t('notifications.desc2', '어떤 일이 생기면 어디로 받을지 정합니다. 기본값은 모든 알림 ON.')}</SectionDesc>

        <Matrix>
          <MatrixHead>
            <HeadCell />
            {CHANNELS.map(ch => (
              <HeadCell key={ch}>
                <ChannelIcon>
                  {ch === 'inbox' && <InboxIcon size={18} />}
                  {ch === 'chat' && <ChatIcon size={18} />}
                  {ch === 'push' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
                    </svg>
                  )}
                  {ch === 'email' && <MailIcon size={18} />}
                </ChannelIcon>
                <ChannelName>{t(`notifications.ch.${ch}`)}</ChannelName>
              </HeadCell>
            ))}
          </MatrixHead>
          {EVENTS.map(ev => (
            <MatrixRow key={ev}>
              <EventCell>
                <EventLabel>{t(`notifications.eventLabel.${ev}`)}</EventLabel>
                <EventDesc>{t(`notifications.eventDesc.${ev}`)}</EventDesc>
              </EventCell>
              {CHANNELS.map(ch => {
                const enabled = matrix[ev][ch];
                const saving = savingKey === `${ev}-${ch}`;
                return (
                  <ToggleCell key={ch}>
                    <Switch
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      $on={enabled}
                      $saving={saving}
                      onClick={() => toggle(ev, ch)}
                      title={enabled ? t('common.on', 'ON') as string : t('common.off', 'OFF') as string}
                    >
                      <SwitchKnob $on={enabled} />
                    </Switch>
                  </ToggleCell>
                );
              })}
            </MatrixRow>
          ))}
        </Matrix>

        <FooterNote>{t('notifications.footerNote', '확인필요(Inbox)는 PlanQ 안에서 직접 보는 알림 영역입니다. 채팅/이메일은 외부로 나가는 알림.')}</FooterNote>
        <PolicyBox>
          <PolicyTitle>{t('notifications.policy.title', '이 매트릭스의 적용 범위')}</PolicyTitle>
          <PolicyItem>
            <PolicyDot />
            <span>{t('notifications.policy.appliesTo', '워크스페이스 멤버에게 가는 알림 (업무 배정·완료·검토, 일정 초대, 멘션, 청구·세금계산서 검토 등) 에만 적용됩니다.')}</span>
          </PolicyItem>
          <PolicyItem>
            <PolicyDot $kind="info" />
            <span>{t('notifications.policy.systemAlways', '가입 인증·비밀번호·서명 OTP 같은 보안 메일은 매트릭스와 무관하게 항상 발송됩니다.')}</span>
          </PolicyItem>
          <PolicyItem>
            <PolicyDot $kind="info" />
            <span>{t('notifications.policy.clientAlways', '고객(외부)에게 가는 청구서·문서 공유·서명 요청 메일도 매트릭스와 무관 — 워크스페이스가 직접 결정한 발송입니다.')}</span>
          </PolicyItem>
        </PolicyBox>
      </Section>
    </Wrap>
  );
};

// OS 감지 — 진단 모달의 시스템 별 안내용
function detectOS(): 'mac' | 'windows' | 'ios' | 'android' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
}

// 사이클 J3 — Web Push 구독 관리 섹션 + 자동 진단 (사이클 N+0 추가)
const PushSection: React.FC<{ businessId: number | null }> = () => {
  const { t } = useTranslation('settings');
  const [permission, setPermission] = React.useState<'granted' | 'denied' | 'default' | 'unsupported' | 'loading'>('loading');
  const [subscribed, setSubscribed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  // 자동 진단 — 테스트 발송 후 5초 안에 SW 가 push 받았는지 추적
  const [diagnoseOpen, setDiagnoseOpen] = React.useState(false);
  const pushReceivedRef = React.useRef(false);

  // SW message listener — push 도착 신호 받음
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'planq:push-received') {
        pushReceivedRef.current = true;
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);

  React.useEffect(() => {
    (async () => {
      // 네이티브 앱: SW 기반 isPushSupported 는 false 라 native 권한 상태로 판정 (알림 켜기/끄기 UI 유지).
      if (isNativeApp()) {
        const { nativePushStatus } = await import('../../services/nativePush');
        const st = await nativePushStatus();
        setPermission(st === 'prompt' ? 'default' : st === 'unknown' ? 'unsupported' : st);
        setSubscribed(st === 'granted');
        return;
      }
      const { isPushSupported, isSubscribed } = await import('../../services/push');
      const supported = await isPushSupported();
      if (!supported) { setPermission('unsupported'); return; }
      setPermission(Notification.permission);
      setSubscribed(await isSubscribed());
    })();
  }, []);

  // 웹은 Notification.permission, 네이티브는 nativePushStatus 로 권한 재조회 (구독/해지 후 반영).
  const refreshPermission = async () => {
    if (isNativeApp()) {
      const { nativePushStatus } = await import('../../services/nativePush');
      const st = await nativePushStatus();
      setPermission(st === 'prompt' ? 'default' : st === 'unknown' ? 'unsupported' : st);
    } else {
      setPermission(Notification.permission);
    }
  };

  const handleSubscribe = async () => {
    setBusy(true); setMsg(null);
    const { subscribe } = await import('../../services/push');
    const r = await subscribe();
    setMsg(r.ok ? t('push.subscribedMsg', '디바이스에 알림이 켜졌습니다') as string : t('push.errMsg', '알림 켜기 실패: {{r}}', { r: r.reason || '' }) as string);
    await refreshPermission();
    setSubscribed(r.ok);
    setBusy(false);
  };
  const handleUnsubscribe = async () => {
    setBusy(true); setMsg(null);
    const { unsubscribe } = await import('../../services/push');
    await unsubscribe();
    setSubscribed(false);
    setMsg(t('push.unsubscribedMsg', '디바이스 알림이 꺼졌습니다') as string);
    setBusy(false);
  };
  const handleTest = async () => {
    setBusy(true); setMsg(null);
    pushReceivedRef.current = false;  // reset
    const { sendTestPush } = await import('../../services/push');
    const r = await sendTestPush();
    if (r.sent === 0) {
      setMsg(t('push.testNoVapidMsg', 'VAPID 키 미설정 — 운영자 설정 필요') as string);
      setBusy(false);
      return;
    }
    setMsg(t('push.testSentMsg', '테스트 알림 발송 완료 ({{n}})', { n: r.sent }) as string);
    // 5초 timeout — SW 가 push 받았는지 확인. 안 받으면 OS 단 차단 가능성 → 진단 모달
    window.setTimeout(() => {
      if (!pushReceivedRef.current) {
        setDiagnoseOpen(true);
      }
      setBusy(false);
    }, 5000);
  };

  // 미구독 (default-off / granted-off) + 차단 (denied) 일 때 강조 attention 표시.
  // 'unsupported' / 'loading' / subscribed 는 일반 표시.
  const isOff = !subscribed && (permission === 'default' || permission === 'granted');
  const isDenied = permission === 'denied';

  return (
    <Section>
      <SectionTitle>{t('push.title', '디바이스 알림 (Web Push)')}</SectionTitle>
      <SectionDesc>{t('push.desc', '브라우저·모바일 홈화면 PWA 에서 푸시 알림을 받습니다. 사용자가 PlanQ 를 안 보고 있어도 도착.')}</SectionDesc>

      {(isOff || isDenied) && (
        <Attention>
          <AttentionIcon>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </AttentionIcon>
          <AttentionBody>
            <AttentionTitle>
              {isDenied
                ? t('pushPrompt.deniedTitle', '디바이스 알림이 차단되어 있습니다')
                : t('pushPrompt.title', '디바이스 알림이 꺼져 있어요')}
            </AttentionTitle>
            <AttentionDesc>
              {isDenied
                ? t('pushPrompt.deniedDesc', '브라우저 사이트 설정에서 알림을 "허용" 으로 변경하면 받을 수 있습니다.')
                : t('pushPrompt.desc', 'PlanQ 를 안 보고 있을 때도 새 메시지·업무 알림을 받으려면 켜주세요.')}
            </AttentionDesc>
          </AttentionBody>
          {!isDenied && (
            <AttentionCta type="button" onClick={handleSubscribe} disabled={busy}>
              {busy ? t('pushPrompt.enabling', '켜는 중…') : t('pushPrompt.enable', '지금 켜기')}
            </AttentionCta>
          )}
        </Attention>
      )}

      <FooterNote>{t('push.scopeHint', '이 설정은 지금 로그인한 본인 계정 + 이 브라우저(또는 PWA) 1개에만 적용됩니다. 다른 멤버나 다른 디바이스에는 영향 없으며, 디바이스마다 따로 켜야 합니다.')}</FooterNote>
      {permission === 'unsupported' && <FooterNote>{t('push.unsupportedMsg', '이 브라우저는 푸시 알림을 지원하지 않습니다.')}</FooterNote>}

      {subscribed && (
        <ActionsRow>
          <SecondaryBtn type="button" onClick={handleUnsubscribe} disabled={busy}>
            {t('push.unsubscribeBtn', '이 디바이스 알림 끄기')}
          </SecondaryBtn>
          <TertiaryBtn type="button" onClick={handleTest} disabled={busy}>
            {t('push.testBtn', '테스트 알림 받기')}
          </TertiaryBtn>
        </ActionsRow>
      )}

      {msg && <ResultNote>{msg}</ResultNote>}
      {diagnoseOpen && (
        <PushDiagnoseModal os={detectOS()} onClose={() => setDiagnoseOpen(false)} onRetry={() => { setDiagnoseOpen(false); handleTest(); }} />
      )}
    </Section>
  );
};

// 자동 진단 모달 — 발송 후 5초 안에 알림 안 도착 → OS 별 안내
const PushDiagnoseModal: React.FC<{ os: ReturnType<typeof detectOS>; onClose: () => void; onRetry: () => void }> = ({ os, onClose, onRetry }) => {
  const { t } = useTranslation('settings');
  return (
    <DiagBackdrop onClick={onClose}>
      <DiagCard onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('pushDiag.aria', '알림 진단') as string}>
        <DiagHead>
          <DiagTitle>{t('pushDiag.title', '알림이 도착하지 않았어요') as string}</DiagTitle>
          <DiagClose onClick={onClose} aria-label={t('common:close', '닫기') as string}>×</DiagClose>
        </DiagHead>
        <DiagBody>
          <DiagDesc>{t('pushDiag.desc', '서버는 정상 발송했지만 시스템 단에서 차단된 것 같습니다. 아래 단계로 점검하면 해결됩니다.') as string}</DiagDesc>
          {os === 'mac' && (
            <DiagSteps>
              <li><Trans i18nKey="pushDiag.mac.1" ns="settings" components={{ 1: <strong /> }} defaults='<1>macOS 시스템 환경설정</1> → <1>알림</1> → <1>Google Chrome</1> → "알림 허용" + "사운드 재생" ON' /></li>
              <li><Trans i18nKey="pushDiag.mac.2" ns="settings" components={{ 1: <strong /> }} defaults='화면 우상단 <1>제어 센터</1> → 집중 모드(방해 금지) <1>OFF</1>' /></li>
              <li><Trans i18nKey="pushDiag.mac.3" ns="settings" components={{ 1: <strong />, 2: <code /> }} defaults='Chrome 주소창에 <2>chrome://settings/content/notifications</2> → planq.kr 이 <1>"허용"</1> 목록에 있는지 확인' /></li>
              <li><Trans i18nKey="pushDiag.mac.4" ns="settings" components={{ 1: <strong /> }} defaults='Chrome → 설정 → 시스템 → <1>"Chrome 종료 후에도 백그라운드 앱 실행" ON</1>' /></li>
            </DiagSteps>
          )}
          {os === 'windows' && (
            <DiagSteps>
              <li><Trans i18nKey="pushDiag.windows.1" ns="settings" components={{ 1: <strong /> }} defaults='<1>Windows 설정</1> → 시스템 → 알림 → "알림 받기" + Chrome 알림 허용 ON' /></li>
              <li><Trans i18nKey="pushDiag.windows.2" ns="settings" components={{ 1: <strong /> }} defaults='집중 지원(Focus Assist) <1>OFF</1>' /></li>
              <li><Trans i18nKey="pushDiag.windows.3" ns="settings" components={{ 1: <strong />, 2: <code /> }} defaults='Chrome 주소창 <2>chrome://settings/content/notifications</2> → planq.kr <1>"허용"</1>' /></li>
            </DiagSteps>
          )}
          {os === 'ios' && (
            <DiagSteps>
              <li>{t('pushDiag.ios.1', '홈 화면에 PlanQ 추가했는지 확인 (Safari 공유 → "홈 화면에 추가")') as string}</li>
              <li>{t('pushDiag.ios.2', 'iOS 설정 → 알림 → PlanQ → "알림 허용" + "사운드"·"배지" ON') as string}</li>
              <li>{t('pushDiag.ios.3', '방해 금지 모드 / 집중 모드 OFF') as string}</li>
            </DiagSteps>
          )}
          {os === 'android' && (
            <DiagSteps>
              <li>{t('pushDiag.android.1', 'Android 설정 → 앱 → Chrome 또는 PlanQ → 알림 ON') as string}</li>
              <li>{t('pushDiag.android.2', '방해 금지 모드 OFF') as string}</li>
              <li>{t('pushDiag.android.3', '배터리 최적화에서 Chrome 제외') as string}</li>
            </DiagSteps>
          )}
          {os === 'other' && (
            <DiagSteps>
              <li>{t('pushDiag.other.1', '브라우저 알림 권한이 "허용" 인지 확인') as string}</li>
              <li>{t('pushDiag.other.2', 'OS 시스템 알림 설정에서 브라우저 알림 ON') as string}</li>
              <li>{t('pushDiag.other.3', '방해 금지 모드 OFF') as string}</li>
            </DiagSteps>
          )}
          {os === 'mac' && (
            <DiagShortcut href="x-apple.systempreferences:com.apple.preference.notifications" target="_blank" rel="noreferrer">
              {t('pushDiag.macOpenSettings', 'macOS 알림 설정 직접 열기 →') as string}
            </DiagShortcut>
          )}
        </DiagBody>
        <DiagFooter>
          <DiagPrimary type="button" onClick={onRetry}>{t('pushDiag.retry', '다시 테스트') as string}</DiagPrimary>
          <DiagSecondary type="button" onClick={onClose}>{t('common:close', '닫기') as string}</DiagSecondary>
        </DiagFooter>
      </DiagCard>
    </DiagBackdrop>
  );
};

const DiagBackdrop = styled.div`position: fixed; inset: 0; background: rgba(15,23,42,0.5); z-index: 3000; display: flex; align-items: center; justify-content: center; padding: 20px;`;
const DiagCard = styled.div`background: #FFFFFF; border-radius: 14px; max-width: 520px; width: 100%; box-shadow: 0 12px 32px rgba(15,23,42,0.18); display: flex; flex-direction: column; max-height: 90vh; overflow: hidden;`;
const DiagHead = styled.div`display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 12px; border-bottom: 1px solid #E2E8F0;`;
const DiagTitle = styled.h3`margin: 0; font-size: 16px; font-weight: 700; color: #0F172A;`;
const DiagClose = styled.button`background: none; border: none; font-size: 22px; line-height: 1; color: #64748B; cursor: pointer; padding: 4px 8px; &:hover { color: #0F172A; }`;
const DiagBody = styled.div`padding: 16px 20px; overflow-y: auto;`;
const DiagDesc = styled.p`margin: 0 0 14px; font-size: 13px; color: #334155; line-height: 1.55;`;
const DiagSteps = styled.ol`margin: 0 0 14px; padding-left: 22px; font-size: 13px; color: #334155; line-height: 1.7;
  li { margin-bottom: 6px; }
  code { background: #F1F5F9; padding: 1px 6px; border-radius: 4px; font-size: 12px; color: #0F766E; }
`;
const DiagShortcut = styled.a`display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: #0F766E; text-decoration: none; padding: 8px 12px; background: #F0FDFA; border: 1px solid #CCFBF1; border-radius: 8px; margin-top: 4px; &:hover { background: #CCFBF1; }`;
const DiagFooter = styled.div`display: flex; gap: 8px; justify-content: flex-end; padding: 12px 20px 16px; border-top: 1px solid #E2E8F0;`;
const DiagPrimary = styled.button`height: 36px; padding: 0 16px; background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; &:hover { background: #0D9488; }`;
const DiagSecondary = styled.button`height: 36px; padding: 0 16px; background: #FFFFFF; color: #334155; border: 1px solid #CBD5E1; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; &:hover { background: #F8FAFC; }`;

export default NotificationSettings;

// ─── styled ───
const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const Loading = styled.div`text-align: center; padding: 40px; color: #94A3B8; font-size: 13px;`;
const ErrorBanner = styled.div`padding: 10px 14px; background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; border-radius: 8px; font-size: 12px;`;
const Section = styled.section`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 20px;
  display: flex; flex-direction: column; gap: 12px;
`;
const SectionTitle = styled.h3`font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;`;
const SectionDesc = styled.div`font-size: 12px; color: #64748B;`;
const Matrix = styled.div`
  display: flex; flex-direction: column; gap: 0;
`;
const MatrixHead = styled.div`
  display: grid; grid-template-columns: minmax(160px, 1fr) repeat(4, 84px);
  border-bottom: 1px solid #E2E8F0;
`;
const HeadCell = styled.div`
  padding: 12px 14px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
`;
const ChannelIcon = styled.div`
  display: inline-flex; align-items: center; justify-content: center;
  color: #475569; height: 18px;
`;
const ChannelName = styled.div`font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px;`;
const MatrixRow = styled.div`
  display: grid; grid-template-columns: minmax(160px, 1fr) repeat(4, 84px);
  border-top: 1px solid #F1F5F9;
  &:first-child { border-top: none; }
  &:hover { background: #FAFBFC; }
`;
const EventCell = styled.div`padding: 14px 14px; display: flex; flex-direction: column; gap: 2px;`;
const EventLabel = styled.div`font-size: 13px; font-weight: 600; color: #0F172A;`;
const EventDesc = styled.div`font-size: 11px; color: #94A3B8; line-height: 1.4;`;
const ToggleCell = styled.div`padding: 14px 0; display: flex; align-items: center; justify-content: center;`;
const Switch = styled.button<{ $on: boolean; $saving: boolean }>`
  width: 36px; height: 20px; border-radius: 999px; border: none;
  background: ${p => p.$on ? '#14B8A6' : '#CBD5E1'};
  position: relative; cursor: pointer;
  transition: background 0.15s;
  opacity: ${p => p.$saving ? 0.6 : 1};
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const SwitchKnob = styled.span<{ $on: boolean }>`
  position: absolute; top: 2px; left: ${p => p.$on ? '18px' : '2px'};
  width: 16px; height: 16px; border-radius: 50%; background: #fff;
  transition: left 0.15s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
`;
const FooterNote = styled.div`
  font-size: 11px; color: #94A3B8; line-height: 1.5;
  padding-top: 4px;
`;
const PolicyBox = styled.div`
  margin-top: 4px; display: flex; flex-direction: column; gap: 6px;
`;
const PolicyTitle = styled.div`
  font-size: 11px; font-weight: 700; color: #475569;
  text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px;
`;
const PolicyItem = styled.div`
  display: flex; gap: 8px; align-items: flex-start;
  font-size: 12px; color: #64748B; line-height: 1.5;
`;
const PolicyDot = styled.span<{ $kind?: 'info' }>`
  flex-shrink: 0; margin-top: 6px; width: 5px; height: 5px;
  border-radius: 50%; background: ${(p) => p.$kind === 'info' ? '#CBD5E1' : '#14B8A6'};
`;

// PushSection 강조 영역
const Attention = styled.div`
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  background: #FFF7ED;
  border: 1px solid #FED7AA;
  border-radius: 10px;
  margin-top: 4px;
`;
const AttentionIcon = styled.div`
  width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  background: #FFEDD5;
  color: #C2410C;
  border-radius: 8px;
`;
const AttentionBody = styled.div`min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const AttentionTitle = styled.div`font-size: 13px; font-weight: 700; color: #9A3412; line-height: 1.3;`;
const AttentionDesc = styled.div`font-size: 12px; color: #7C2D12; line-height: 1.4;`;
const AttentionCta = styled.button`
  height: 36px; padding: 0 16px;
  background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const ActionsRow = styled.div`
  display: flex; gap: 8px; margin-top: 12px;
`;
const SecondaryBtn = styled.button`
  height: 32px; padding: 0 14px;
  background: transparent; color: #475569;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const TertiaryBtn = styled.button`
  height: 32px; padding: 0 14px;
  background: #F0FDFA; color: #0D9488;
  border: 1px solid #99F6E4; border-radius: 6px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #CCFBF1; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const ResultNote = styled.div`
  font-size: 11px; color: #0D9488; margin-top: 12px; line-height: 1.5;
`;
