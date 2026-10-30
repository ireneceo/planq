// 워크스페이스 상세 드로어의 «여정» 칸 (2026-10-30, docs/PLANQ_GUIDE_ROOM_DESIGN.md §7 · 1단계)
// 단계·개인 설정·앱·마지막 접속·시간줄·막힘 신호 — 사용 모양만(서버가 제목·본문을 싣지 않는다).
// AdminBusinessesPage 의 Section/KV 와 같은 모양 — 그 파일이 god-file 상한이라 따로 뺐다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { fetchAdminBusinessJourney, type AdminJourney, type AdminJourneySignal } from '../../services/admin';

const SETUP_KEYS = ['install_app', 'enable_notifications', 'connect_calendar', 'connect_ai_app'] as const;

export default function AdminBusinessJourney({ businessId }: { businessId: number }) {
  const { t } = useTranslation('admin');
  const { formatDate, formatDateTime } = useTimeFormat();
  const [data, setData] = useState<AdminJourney | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try { setData(await fetchAdminBusinessJourney(businessId)); setError(false); }
    catch { setError(true); }
  }, [businessId]);

  useEffect(() => { setData(null); load(); }, [load]);
  // 실시간 사건이 없는 집계(여러 표의 MIN·COUNT)라 소켓 대신 화면 복귀 때 서버 값으로 덮는다.
  useVisibilityRefresh(load);

  const stageText = (cur: number | null, count: number | null) =>
    cur == null ? t('journey.stageDone', '모든 단계 완료') : t('journey.stageOf', { cur, count: count || 5, defaultValue: '{{cur}} / {{count}} 단계' });
  const signalText = (s: AdminJourneySignal) => t(`journey.signal.${s.key}`, { days: s.days, count: s.count, stage: s.stage, defaultValue: s.key });

  return (
    <Section data-testid="admin-biz-journey">
      <SectionHead><SectionTitle>{t('journey.title', '여정')}</SectionTitle></SectionHead>
      {error && <ErrorText>{t('journey.loadFailed', '여정을 불러오지 못했어요')}</ErrorText>}
      {!data && !error && <Dim>Loading…</Dim>}
      {data && (
        <>
          {data.signals.length > 0 && (
            <Signals data-testid="admin-biz-journey-signals">
              {data.signals.map((s) => <SignalBadge key={s.key}>{signalText(s)}</SignalBadge>)}
            </Signals>
          )}
          <KV>
            <KLabel>{t('journey.stage', '지금 단계(대표)')}</KLabel>
            <KValue>{stageText(data.summary.stage, data.summary.stage_count)}</KValue>
          </KV>
          <KV>
            <KLabel>{t('journey.lastSeen', '마지막 접속')}</KLabel>
            <KValue>{data.summary.last_seen_at ? formatDateTime(data.summary.last_seen_at) : <Dim>{t('journey.never', '없음')}</Dim>}</KValue>
          </KV>
          <KV>
            <KLabel>{t('journey.setup', '설정')}</KLabel>
            <KValue>
              <Chips>
                <Chip $on={data.summary.app_installed}>{t('journey.setupKey.install_app', '앱')}</Chip>
                <Chip $on={data.summary.notifications_on}>{t('journey.setupKey.enable_notifications', '알림')}</Chip>
                <Chip $on={data.summary.calendar_connected}>{t('journey.setupKey.connect_calendar', '캘린더')}</Chip>
                <Chip $on={data.summary.ai_app_connected}>{t('journey.setupKey.connect_ai_app', 'AI 앱')}</Chip>
                <Chip $on={data.summary.mail_accounts > 0}>
                  {t('journey.mail', { count: data.summary.mail_accounts, defaultValue: '메일 {{count}}' })}
                </Chip>
              </Chips>
            </KValue>
          </KV>
          {data.summary.trial_days_left != null && (
            <KV>
              <KLabel>{t('journey.trialLeft', '체험 남은 날')}</KLabel>
              <KValue>{t('journey.days', { count: Math.max(0, data.summary.trial_days_left), defaultValue: '{{count}}일' })}</KValue>
            </KV>
          )}

          <SubTitle>{t('journey.members', { count: data.summary.members, defaultValue: '멤버 {{count}}명' })}</SubTitle>
          <Members>
            {data.members.map((m) => (
              <MemberRow key={m.user_id}>
                <MemberMain>
                  <MemberName>{m.name}</MemberName>
                  <Dim>{t(`journey.role.${m.role}`, m.role)} · {m.last_seen_at ? formatDate(m.last_seen_at) : t('journey.never', '없음')}</Dim>
                </MemberMain>
                <MemberSide>
                  <StageText>{stageText(m.stage.current, m.stage.stage_count)}</StageText>
                  <Chips>
                    {SETUP_KEYS.map((k) => {
                      const on = !!m.setup.find((s) => s.key === k)?.done;
                      return <Chip key={k} $on={on}>{t(`journey.setupKey.${k}`, k)}</Chip>;
                    })}
                  </Chips>
                </MemberSide>
              </MemberRow>
            ))}
          </Members>
          {data.summary.members_truncated && <Dim>{t('journey.truncated', '처음 50명만 보여요')}</Dim>}

          <SubTitle>{t('journey.timeline', '시간줄')}</SubTitle>
          <Timeline>
            {data.timeline.map((e) => (
              <TLRow key={e.key}>
                <TLDate>{formatDate(e.at)}</TLDate>
                <TLText>{t(`journey.event.${e.key}`, e.key)}</TLText>
              </TLRow>
            ))}
          </Timeline>
        </>
      )}
    </Section>
  );
}

const Section = styled.section`padding: 16px 20px; border-bottom: 1px solid #E2E8F0;`;
const SectionHead = styled.div`display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;`;
const SectionTitle = styled.h3`margin: 0; font-size: 0.8125rem; font-weight: 700; color: #0F172A; letter-spacing: -0.1px;`;
const SubTitle = styled.div`margin: 14px 0 6px; font-size: 0.75rem; font-weight: 700; color: #334155;`;
const KV = styled.div`display: flex; align-items: center; padding: 6px 0; gap: 8px;`;
const KLabel = styled.div`width: 110px; font-size: 0.75rem; color: #64748B; flex-shrink: 0;`;
const KValue = styled.div`flex: 1; min-width: 0; font-size: 0.8125rem; color: #0F172A; display: flex; align-items: center; gap: 6px;`;
const Dim = styled.span`color: #94A3B8; font-size: 0.75rem;`;
const ErrorText = styled.div`font-size: 0.8125rem; color: #DC2626; padding: 4px 0;`;
const Chips = styled.div`display: flex; flex-wrap: wrap; gap: 4px;`;
const Chip = styled.span<{ $on: boolean }>`
  font-size: 0.6875rem; font-weight: 600; padding: 2px 8px; border-radius: 999px;
  background: ${(p) => (p.$on ? '#F0FDFA' : '#F1F5F9')}; color: ${(p) => (p.$on ? '#0F766E' : '#94A3B8')};
`;
const Signals = styled.div`display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;`;
const SignalBadge = styled.span`
  font-size: 0.75rem; font-weight: 600; padding: 4px 10px; border-radius: 6px; background: #FEF3C7; color: #92400E;
`;
const Members = styled.div`display: flex; flex-direction: column;`;
const MemberRow = styled.div`
  display: flex; gap: 10px; padding: 8px 0; border-top: 1px solid #F1F5F9;
  &:first-child { border-top: none; }
  @media (max-width: 640px) { flex-direction: column; gap: 4px; }
`;
const MemberMain = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const MemberName = styled.div`font-size: 0.8125rem; font-weight: 600; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const MemberSide = styled.div`display: flex; flex-direction: column; align-items: flex-end; gap: 4px; @media (max-width: 640px) { align-items: flex-start; }`;
const StageText = styled.div`font-size: 0.75rem; color: #334155;`;
const Timeline = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const TLRow = styled.div`display: flex; gap: 10px; font-size: 0.75rem;`;
const TLDate = styled.div`width: 90px; flex-shrink: 0; color: #64748B;`;
const TLText = styled.div`flex: 1; color: #0F172A;`;
