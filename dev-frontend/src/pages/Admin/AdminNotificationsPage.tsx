// platform_admin 본인 알림 설정 — 워크스페이스 무관 (business_id NULL row).
// 이벤트: 'inquiry' (고객 문의 새로 접수). 채널: inbox / email / push.
//
// 워크스페이스용 NotificationSettings 와 분리된 이유:
//   - business_id NULL 로 저장 (cross-workspace 영향 X)
//   - platform_admin 만 의미 있는 이벤트 (inquiry) 만 노출 — 워크스페이스 이벤트 섞이면 혼란
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import { apiFetch } from '../../contexts/AuthContext';
import { InboxIcon, MailIcon } from '../../components/Common/Icons';

type EventKind = 'inquiry' | 'signup' | 'payment' | 'subscription' | 'trial' | 'feedback';
type Channel = 'inbox' | 'email' | 'push';
type Matrix = Record<EventKind, Record<Channel, boolean>>;

const EVENTS: EventKind[] = ['inquiry', 'signup', 'payment', 'subscription', 'trial', 'feedback'];
const CHANNELS: Channel[] = ['inbox', 'email', 'push'];

const EVENT_FALLBACKS: Record<EventKind, { label: string; desc: string }> = {
  inquiry: { label: '새 문의 접수', desc: '랜딩 폼·게스트 챗·로그인 사용자가 문의를 남겼을 때' },
  signup: { label: '신규 가입', desc: '새 사용자 또는 워크스페이스 등록 완료' },
  payment: { label: '결제 발생', desc: '입금 확인(mark-paid), 결제 실패 등' },
  subscription: { label: '구독 변경', desc: '플랜 변경 / 해지 / 강등' },
  trial: { label: '체험 종료', desc: '14일 체험 만료 또는 D-7 임박 알림' },
  feedback: { label: '사용자 피드백', desc: '사용 중 사용자가 제출한 버그·개선·기능 요청' },
};

const AdminNotificationsPage: React.FC = () => {
  const { t } = useTranslation('common');
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // business_id 안 보냄 → 백엔드가 NULL row 만 가져옴 (platform-wide)
    apiFetch('/api/notifications/prefs')
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (!j.success) throw new Error(j.message || 'load_failed');
        // matrix 에서 platform_admin 6 종만 추출 (워크스페이스 이벤트는 별도 페이지)
        const all = j.data.matrix as Record<string, Record<string, boolean>>;
        const out = {} as Matrix;
        for (const ev of EVENTS) {
          const row = all[ev] || {};
          out[ev] = {
            inbox: row.inbox === undefined ? true : !!row.inbox,
            email: row.email === undefined ? true : !!row.email,
            push: row.push === undefined ? true : !!row.push,
          };
        }
        setMatrix(out);
        setError(null);
      })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const toggle = async (event: EventKind, channel: Channel) => {
    if (!matrix) return;
    const current = matrix[event][channel];
    const next = !current;
    const key = `${event}-${channel}`;
    setSavingKey(key);
    setMatrix({ ...matrix, [event]: { ...matrix[event], [channel]: next } });
    try {
      const r = await apiFetch('/api/notifications/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // business_id 안 보냄 → NULL row (platform-wide)
        body: JSON.stringify({ event_kind: event, channel, enabled: next }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'save_failed');
    } catch (e) {
      setMatrix({ ...matrix, [event]: { ...matrix[event], [channel]: current } });
      setError((e as Error).message);
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) return <PageShell title={t('adminNotif.title', '플랫폼 관리자 알림') as string}><Loading>{t('common.loading', '불러오는 중...')}</Loading></PageShell>;

  return (
    <PageShell title={t('adminNotif.title', '플랫폼 관리자 알림') as string}>
      <Hint>
        {t('adminNotif.hint', '워크스페이스와 무관한 플랫폼 운영 알림입니다. 새 문의가 접수되면 어디로 받을지 정합니다.')}
      </Hint>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {matrix && (
        <Matrix>
          <MatrixHead>
            <HeadCell />
            {CHANNELS.map(ch => (
              <HeadCell key={ch}>
                <ChannelIcon>
                  {ch === 'inbox' && <InboxIcon size={18} />}
                  {ch === 'email' && <MailIcon size={18} />}
                  {ch === 'push' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
                    </svg>
                  )}
                </ChannelIcon>
                <ChannelName>
                  {ch === 'inbox' ? t('adminNotif.ch.inbox', '인박스')
                    : ch === 'email' ? t('adminNotif.ch.email', '이메일')
                    : t('adminNotif.ch.push', '디바이스')}
                </ChannelName>
              </HeadCell>
            ))}
          </MatrixHead>
          {EVENTS.map(ev => (
            <MatrixRow key={ev}>
              <EventCell>
                <EventLabel>{t(`adminNotif.eventLabel.${ev}`, EVENT_FALLBACKS[ev].label)}</EventLabel>
                <EventDesc>{t(`adminNotif.eventDesc.${ev}`, EVENT_FALLBACKS[ev].desc)}</EventDesc>
              </EventCell>
              {CHANNELS.map(ch => {
                const enabled = matrix[ev][ch];
                const saving = savingKey === `${ev}-${ch}`;
                return (
                  <ToggleCell key={ch}>
                    <Switch
                      type="button" role="switch" aria-checked={enabled}
                      $on={enabled} $saving={saving}
                      onClick={() => toggle(ev, ch)}
                      title={enabled ? 'ON' : 'OFF'}
                    >
                      <SwitchKnob $on={enabled} />
                    </Switch>
                  </ToggleCell>
                );
              })}
            </MatrixRow>
          ))}
        </Matrix>
      )}
    </PageShell>
  );
};

export default AdminNotificationsPage;

// ─── styled (NotificationSettings 패턴 카피) ───
const Loading = styled.div`padding: 40px; text-align: center; color: #64748B; font-size: 14px;`;
const Hint = styled.div`font-size: 13px; color: #475569; line-height: 1.6; margin-bottom: 20px;`;
const ErrorBanner = styled.div`padding: 10px 14px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; color: #B91C1C; font-size: 13px; margin-bottom: 16px;`;
const Matrix = styled.div`background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;`;
const MatrixHead = styled.div`display: grid; grid-template-columns: 2fr repeat(3, 1fr); background: #F8FAFC; border-bottom: 1px solid #E2E8F0;`;
const HeadCell = styled.div`padding: 14px 16px; display: flex; flex-direction: column; align-items: center; gap: 4px;`;
const ChannelIcon = styled.div`color: #475569;`;
const ChannelName = styled.div`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;`;
const MatrixRow = styled.div`display: grid; grid-template-columns: 2fr repeat(3, 1fr); border-top: 1px solid #F1F5F9; align-items: center; &:first-child { border-top: none; }`;
const EventCell = styled.div`padding: 14px 16px;`;
const EventLabel = styled.div`font-size: 14px; font-weight: 600; color: #0F172A;`;
const EventDesc = styled.div`font-size: 12px; color: #64748B; margin-top: 4px;`;
const ToggleCell = styled.div`padding: 14px 16px; display: flex; justify-content: center;`;
const Switch = styled.button<{ $on: boolean; $saving: boolean }>`
  width: 40px; height: 22px; border-radius: 11px;
  background: ${p => p.$on ? '#14B8A6' : '#CBD5E1'};
  border: none; cursor: pointer; position: relative; padding: 0;
  opacity: ${p => p.$saving ? 0.5 : 1};
  transition: background 0.15s;
`;
const SwitchKnob = styled.div<{ $on: boolean }>`
  position: absolute; top: 2px; left: ${p => p.$on ? '20px' : '2px'};
  width: 18px; height: 18px; border-radius: 50%;
  background: #FFFFFF; transition: left 0.15s;
`;
