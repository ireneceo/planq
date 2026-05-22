// 공유 일정 미리보기 — /public/calendar/:token
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch, getAccessToken } from '../../contexts/AuthContext';
import SharePasswordPrompt from './SharePasswordPrompt';
import ExpiredShareLink from '../../components/Common/ExpiredShareLink';

interface CalendarPreview {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  category: string;
  meeting_url: string | null;
  creator?: { id: number; name: string } | null;
  project?: { id: number; name: string } | null;
  workspace?: { id: number; name: string } | null;
  shared_at: string | null;
}

const CATEGORY_TONE: Record<string, { bg: string; fg: string }> = {
  personal: { bg: '#F1F5F9', fg: '#475569' },
  work:     { bg: '#DBEAFE', fg: '#1E40AF' },
  meeting:  { bg: '#F0FDFA', fg: '#0F766E' },
  deadline: { bg: '#FEF2F2', fg: '#DC2626' },
  other:    { bg: '#FAFAFA', fg: '#64748B' },
};
const CATEGORY_LABEL_DEFAULTS: Record<string, string> = {
  personal: '개인', work: '업무', meeting: '회의', deadline: '마감', other: '기타',
};

const formatRange = (startISO: string, endISO: string, allDay: boolean): string => {
  try {
    const s = new Date(startISO);
    const e = new Date(endISO);
    const sameDay = s.toDateString() === e.toDateString();
    const dateOpts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', timeZone: 'Asia/Seoul' };
    const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' };
    if (allDay) {
      if (sameDay) return s.toLocaleDateString(undefined, dateOpts);
      return `${s.toLocaleDateString(undefined, dateOpts)} — ${e.toLocaleDateString(undefined, dateOpts)}`;
    }
    if (sameDay) {
      return `${s.toLocaleDateString(undefined, dateOpts)} ${s.toLocaleTimeString(undefined, timeOpts)} — ${e.toLocaleTimeString(undefined, timeOpts)}`;
    }
    return `${s.toLocaleDateString(undefined, dateOpts)} ${s.toLocaleTimeString(undefined, timeOpts)} — ${e.toLocaleDateString(undefined, dateOpts)} ${e.toLocaleTimeString(undefined, timeOpts)}`;
  } catch {
    return `${startISO} — ${endISO}`;
  }
};

const PublicCalendarEventPage = () => {
  const { t } = useTranslation('common');
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [ev, setEv] = useState<CalendarPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needPw, setNeedPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [expired, setExpired] = useState<{ at: string | null } | null>(null);

  const fetchEv = useCallback(async (pw?: string) => {
    if (!token) return;
    if (pw) setPwBusy(true); else setLoading(true);
    setPwError(null);
    try {
      const r = await fetch(`/api/calendar-events/public/by-token/${token}`,
        pw ? { headers: { 'X-Share-Password': pw } } : undefined);
      const j = await r.json();
      if (j.success) { setEv(j.data); setNeedPw(false); }
      else if (r.status === 410 && j.code === 'share_expired') {
        setExpired({ at: j.expired_at || null });
      } else if (r.status === 401 && j.requires_password) {
        setNeedPw(true);
        if (pw) setPwError(j.message === 'password_wrong' ? 'wrong' : null);
      } else { setError(j.message || 'not_found'); }
    } catch { setError('network'); }
    finally { setLoading(false); setPwBusy(false); }
  }, [token]);

  useEffect(() => { fetchEv(); }, [fetchEv]);

  useEffect(() => {
    if (!token || !ev) return;
    if (!getAccessToken()) return;
    apiFetch(`/api/calendar-events/public/by-token/${token}/auth-check`)
      .then(r => r.json())
      .then(j => {
        if (j.success && j.data?.canAccess && j.data?.appUrl) {
          setTimeout(() => navigate(j.data.appUrl), 300);
        }
      }).catch(() => { /* silent */ });
  }, [token, ev, navigate]);

  if (loading) return <Wrap><Card><Hint>{t('public.loading', { defaultValue: '불러오는 중...' }) as string}</Hint></Card></Wrap>;
  if (expired) return <ExpiredShareLink expiredAt={expired.at} />;
  if (needPw) return <SharePasswordPrompt onSubmit={fetchEv} busy={pwBusy} error={pwError} />;
  if (error || !ev) return (
    <Wrap><Card>
      <ErrorTitle>{t('public.notFound', { defaultValue: '링크가 만료되었거나 없는 항목입니다' }) as string}</ErrorTitle>
      <Hint>{t('public.notFoundHint', { defaultValue: '링크 작성자에게 다시 받으세요.' }) as string}</Hint>
      <CTA href="/" type="button">{t('public.goHome', { defaultValue: 'PlanQ 홈으로' }) as string}</CTA>
    </Card></Wrap>
  );

  const tone = CATEGORY_TONE[ev.category] || { bg: '#F1F5F9', fg: '#475569' };
  const categoryLabel = t(`public.calendar.category.${ev.category}`, { defaultValue: CATEGORY_LABEL_DEFAULTS[ev.category] || ev.category }) as string;
  const isAuthed = !!getAccessToken();

  return (
    <Wrap>
      <Card>
        {ev.workspace && <WorkspaceLabel>{ev.workspace.name}</WorkspaceLabel>}
        <EventTitle>{ev.title}</EventTitle>
        <MetaRow>
          <CategoryPill style={{ background: tone.bg, color: tone.fg }}>{categoryLabel}</CategoryPill>
          {ev.project && <MetaItem>📁 {ev.project.name}</MetaItem>}
        </MetaRow>

        <TimeBox>{formatRange(ev.start_at, ev.end_at, ev.all_day)}</TimeBox>

        <Grid>
          {ev.location && (
            <KV>
              <K>{t('public.calendar.location', { defaultValue: '장소' }) as string}</K>
              <V>{ev.location}</V>
            </KV>
          )}
          {ev.meeting_url && (
            <KV>
              <K>{t('public.calendar.meetingUrl', { defaultValue: '회의 링크' }) as string}</K>
              <V><MeetingLink href={ev.meeting_url} target="_blank" rel="noopener noreferrer">{ev.meeting_url}</MeetingLink></V>
            </KV>
          )}
          {ev.creator && (
            <KV>
              <K>{t('public.calendar.creator', { defaultValue: '작성자' }) as string}</K>
              <V>{ev.creator.name}</V>
            </KV>
          )}
        </Grid>

        {ev.description && (
          <Section>
            <SectionLabel>{t('public.calendar.description', { defaultValue: '설명' }) as string}</SectionLabel>
            <DescBox>{ev.description}</DescBox>
          </Section>
        )}

        <CTAArea>
          {isAuthed ? (
            <CTA href={`/calendar?event=${ev.id}`} type="button">
              {t('public.openInPlanQ', { defaultValue: 'PlanQ 에서 보기 →' }) as string}
            </CTA>
          ) : (
            <>
              <CTA href={`/login?next=${encodeURIComponent(`/public/calendar/${token}`)}`} type="button">
                {t('public.login', { defaultValue: 'PlanQ 로그인' }) as string}
              </CTA>
              <CTASecondary href="/" type="button">
                {t('public.signup', { defaultValue: '무료로 시작하기' }) as string}
              </CTASecondary>
            </>
          )}
        </CTAArea>
        <Footer>{t('public.poweredBy', { defaultValue: 'PlanQ — 일이 일이 되지 않게' }) as string}</Footer>
      </Card>
    </Wrap>
  );
};

export default PublicCalendarEventPage;

const Wrap = styled.div`
  min-height: 100vh; background: #F8FAFC;
  display: flex; align-items: flex-start; justify-content: center; padding: 40px 20px;
  @media (max-width: 640px) { padding: 16px; }
`;
const Card = styled.div`
  width: 100%; max-width: 640px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 14px;
  padding: 28px 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  @media (max-width: 640px) { padding: 20px 16px; }
`;
const WorkspaceLabel = styled.div`font-size: 11px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;`;
const EventTitle = styled.h1`font-size: 22px; font-weight: 700; color: #0F172A; margin: 0 0 12px; line-height: 1.3;`;
const MetaRow = styled.div`display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px;`;
const CategoryPill = styled.span`display: inline-flex; padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 999px;`;
const MetaItem = styled.span`font-size: 12px; color: #64748B;`;
const TimeBox = styled.div`font-size: 15px; font-weight: 600; color: #0F172A; padding: 12px 16px; background: #F0FDFA; border-radius: 10px; margin-bottom: 20px;`;
const Section = styled.section`margin: 16px 0;`;
const SectionLabel = styled.div`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;`;
const DescBox = styled.div`font-size: 13px; color: #334155; line-height: 1.6; padding: 12px 14px; background: #F8FAFC; border-radius: 8px; white-space: pre-wrap;`;
const Grid = styled.div`display: grid; grid-template-columns: 1fr; gap: 12px; margin: 16px 0;`;
const KV = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const K = styled.div`font-size: 11px; font-weight: 600; color: #94A3B8;`;
const V = styled.div`font-size: 13px; color: #0F172A; word-break: break-all;`;
const MeetingLink = styled.a`color: #14B8A6; text-decoration: none; &:hover { text-decoration: underline; }`;
const CTAArea = styled.div`display: flex; gap: 8px; margin: 24px 0 12px; flex-wrap: wrap;`;
const CTA = styled.a`
  display: inline-flex; align-items: center; padding: 10px 20px;
  background: #14B8A6; color: #fff; font-size: 13px; font-weight: 700;
  border-radius: 8px; text-decoration: none;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
const CTASecondary = styled.a`
  display: inline-flex; align-items: center; padding: 10px 20px;
  background: #fff; color: #334155; font-size: 13px; font-weight: 600;
  border: 1px solid #E2E8F0; border-radius: 8px; text-decoration: none;
  &:hover { border-color: #CBD5E1; background: #F8FAFC; }
`;
const Hint = styled.div`font-size: 12px; color: #94A3B8; padding: 12px 0;`;
const ErrorTitle = styled.div`font-size: 18px; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const Footer = styled.div`font-size: 11px; color: #94A3B8; text-align: center; margin-top: 12px;`;
