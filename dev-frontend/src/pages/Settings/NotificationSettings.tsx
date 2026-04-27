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
    </Wrap>
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
