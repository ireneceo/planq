// 알림 설정 매트릭스 (Phase E4)
// 이벤트 × 채널 × On/Off — 사용자 본인 (워크스페이스 컨텍스트)
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

interface Props {
  businessId: number;
  isOwner: boolean;
}

type EventKind = 'signature' | 'invoice' | 'tax_invoice' | 'task' | 'event' | 'invite' | 'mention';
type Channel = 'inbox' | 'chat' | 'email';
type Matrix = Record<EventKind, Record<Channel, boolean>>;

const EVENTS: EventKind[] = ['signature', 'invoice', 'tax_invoice', 'task', 'event', 'invite', 'mention'];
const CHANNELS: Channel[] = ['inbox', 'chat', 'email'];

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
      <Section>
        <SectionTitle>{t('notifications.title', '알림 받기')}</SectionTitle>
        <SectionDesc>{t('notifications.desc2', '어떤 일이 생기면 어디로 받을지 정합니다. 기본값은 모든 알림 ON.')}</SectionDesc>

        <Matrix>
          <MatrixHead>
            <HeadCell />
            {CHANNELS.map(ch => (
              <HeadCell key={ch}>
                <ChannelIcon>
                  {ch === 'inbox' && '📋'}
                  {ch === 'chat' && '💬'}
                  {ch === 'email' && '✉'}
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
      </Section>

      <PushSection businessId={businessId} />
    </Wrap>
  );
};

// 사이클 J3 — Web Push 구독 관리 섹션
const PushSection: React.FC<{ businessId: number | null }> = () => {
  const { t } = useTranslation('settings');
  const [permission, setPermission] = React.useState<'granted' | 'denied' | 'default' | 'unsupported' | 'loading'>('loading');
  const [subscribed, setSubscribed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      const { isPushSupported, isSubscribed } = await import('../../services/push');
      const supported = await isPushSupported();
      if (!supported) { setPermission('unsupported'); return; }
      setPermission(Notification.permission);
      setSubscribed(await isSubscribed());
    })();
  }, []);

  const handleSubscribe = async () => {
    setBusy(true); setMsg(null);
    const { subscribe } = await import('../../services/push');
    const r = await subscribe();
    setMsg(r.ok ? t('push.subscribedMsg', '디바이스에 알림이 켜졌습니다') as string : t('push.errMsg', '알림 켜기 실패: {{r}}', { r: r.reason || '' }) as string);
    setPermission(Notification.permission);
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
    const { sendTestPush } = await import('../../services/push');
    const r = await sendTestPush();
    setMsg(r.sent > 0
      ? t('push.testSentMsg', '테스트 알림 발송 완료 ({{n}})', { n: r.sent }) as string
      : t('push.testNoVapidMsg', 'VAPID 키 미설정 — 운영자 설정 필요') as string);
    setBusy(false);
  };

  return (
    <Section>
      <SectionTitle>{t('push.title', '디바이스 알림 (Web Push)')}</SectionTitle>
      <SectionDesc>{t('push.desc', '브라우저·모바일 홈화면 PWA 에서 푸시 알림을 받습니다. 사용자가 PlanQ 를 안 보고 있어도 도착.')}</SectionDesc>
      {permission === 'unsupported' && <FooterNote>{t('push.unsupportedMsg', '이 브라우저는 푸시 알림을 지원하지 않습니다.')}</FooterNote>}
      {permission === 'denied' && <FooterNote>{t('push.deniedMsg', '브라우저 설정에서 알림 권한이 차단되어 있습니다. 사이트 권한 → 알림 허용으로 변경해주세요.')}</FooterNote>}
      {(permission === 'default' || permission === 'granted') && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {!subscribed
            ? <button type="button" onClick={handleSubscribe} disabled={busy} style={{ height: 32, padding: '0 14px', background: '#14B8A6', color: '#FFFFFF', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {busy ? t('push.processing', '처리 중…') : t('push.subscribeBtn', '이 디바이스 알림 켜기')}
              </button>
            : <>
                <button type="button" onClick={handleUnsubscribe} disabled={busy} style={{ height: 32, padding: '0 14px', background: 'transparent', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {t('push.unsubscribeBtn', '이 디바이스 알림 끄기')}
                </button>
                <button type="button" onClick={handleTest} disabled={busy} style={{ height: 32, padding: '0 14px', background: '#F0FDFA', color: '#0D9488', border: '1px solid #99F6E4', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {t('push.testBtn', '테스트 알림 받기')}
                </button>
              </>
          }
        </div>
      )}
      {msg && <FooterNote style={{ marginTop: 12, color: '#0D9488' }}>{msg}</FooterNote>}
    </Section>
  );
};

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
  border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden;
`;
const MatrixHead = styled.div`
  display: grid; grid-template-columns: minmax(180px, 1.5fr) repeat(3, 90px);
  background: #F8FAFC; border-bottom: 1px solid #E2E8F0;
`;
const HeadCell = styled.div`
  padding: 12px 14px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
`;
const ChannelIcon = styled.div`font-size: 16px;`;
const ChannelName = styled.div`font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px;`;
const MatrixRow = styled.div`
  display: grid; grid-template-columns: minmax(180px, 1.5fr) repeat(3, 90px);
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
  padding: 10px 12px; background: #F8FAFC; border-radius: 8px;
`;
