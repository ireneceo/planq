// 공유 task 미리보기 — /public/tasks/:token
//
// Smart Routing (App-First):
//   1. 인증된 사용자 + canAccess → 0.3s 후 /task?task=:id 자동 redirect
//   2. 비-인증 또는 외부 사용자 → 미리보기 그대로 + [PlanQ 로그인] / [무료 시작]
//
// read-only 메타만 노출 (댓글/첨부/시간 X — 개인정보 보호)
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getAccessToken } from '../../contexts/AuthContext';
import SharePasswordPrompt from './SharePasswordPrompt';
import ExpiredShareLink from '../../components/Common/ExpiredShareLink';

interface TaskPreview {
  id: number;
  title: string;
  description: string | null;
  status: string;
  progress_percent: number;
  start_date: string | null;
  due_date: string | null;
  category: string | null;
  assignee?: { id: number; name: string } | null;
  creator?: { id: number; name: string } | null;
  project?: { id: number; name: string } | null;
  workspace?: { id: number; name: string } | null;
  shared_at: string | null;
}

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  not_started:       { bg: '#F1F5F9', fg: '#475569' },
  waiting:           { bg: '#FEF3C7', fg: '#92400E' },
  in_progress:       { bg: '#DBEAFE', fg: '#1E40AF' },
  reviewing:         { bg: '#F0FDFA', fg: '#0F766E' },
  revision_requested:{ bg: '#FEF2F2', fg: '#DC2626' },
  completed:         { bg: '#DCFCE7', fg: '#166534' },
  canceled:          { bg: '#E2E8F0', fg: '#64748B' },
};

const STATUS_LABEL_DEFAULTS: Record<string, string> = {
  not_started: '시작 전', waiting: '대기', in_progress: '진행 중',
  reviewing: '검토', revision_requested: '수정 요청',
  completed: '완료', canceled: '취소',
};

const PublicTaskPage = () => {
  const { t } = useTranslation('common');
  const { token } = useParams<{ token: string }>();
  const [task, setTask] = useState<TaskPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needPw, setNeedPw] = useState(false);
  // N+44 — 만료된 링크 410 응답 분기
  const [expired, setExpired] = useState<{ at: string | null } | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const fetchTask = useCallback(async (pw?: string) => {
    if (!token) return;
    if (pw) setPwBusy(true); else setLoading(true);
    setPwError(null);
    try {
      const r = await fetch(`/api/tasks/public/by-token/${token}`,
        pw ? { headers: { 'X-Share-Password': pw } } : undefined);
      const j = await r.json();
      if (j.success) {
        setTask(j.data);
        setNeedPw(false);
      } else if (r.status === 410 && j.code === 'share_expired') {
        setExpired({ at: j.expired_at || null });
      } else if (r.status === 401 && j.requires_password) {
        setNeedPw(true);
        if (pw) setPwError(j.message === 'password_wrong' ? 'wrong' : null);
      } else {
        setError(j.message || 'not_found');
      }
    } catch {
      setError('network');
    } finally {
      setLoading(false);
      setPwBusy(false);
    }
  }, [token]);

  useEffect(() => { fetchTask(); }, [fetchTask]);

  // N+95 fix — 옛 자동 redirect 제거 (로그인해도 공유 뷰가 따로 보여야). authed 는 아래 CTA 로 명시 이동.

  if (loading) return <Wrap><Card><Hint>{t('public.loading', { defaultValue: '불러오는 중...' }) as string}</Hint></Card></Wrap>;
  if (expired) return <ExpiredShareLink expiredAt={expired.at} />;
  if (needPw) return <SharePasswordPrompt onSubmit={fetchTask} busy={pwBusy} error={pwError} />;
  if (error || !task) return (
    <Wrap><Card>
      <ErrorTitle>{t('public.notFound', { defaultValue: '링크가 만료되었거나 없는 항목입니다' }) as string}</ErrorTitle>
      <Hint>{t('public.notFoundHint', { defaultValue: '링크 작성자에게 다시 받으세요.' }) as string}</Hint>
      <CTA href="/" type="button">{t('public.goHome', { defaultValue: 'PlanQ 홈으로' }) as string}</CTA>
    </Card></Wrap>
  );

  const tone = STATUS_TONE[task.status] || { bg: '#F1F5F9', fg: '#475569' };
  const statusLabel = t(`public.task.status.${task.status}`, { defaultValue: STATUS_LABEL_DEFAULTS[task.status] || task.status }) as string;
  const isAuthed = !!getAccessToken();

  return (
    <Wrap>
      <Card>
        {task.workspace && <WorkspaceLabel>{task.workspace.name}</WorkspaceLabel>}
        <TaskTitle>{task.title}</TaskTitle>
        <MetaRow>
          <StatusPill style={{ background: tone.bg, color: tone.fg }}>{statusLabel}</StatusPill>
          {task.project && <MetaItem>📁 {task.project.name}</MetaItem>}
          {task.category && <MetaItem># {task.category}</MetaItem>}
        </MetaRow>

        {task.description && (
          <Section>
            <SectionLabel>{t('public.task.description', { defaultValue: '설명' }) as string}</SectionLabel>
            <DescBox>{task.description}</DescBox>
          </Section>
        )}

        <Grid>
          {task.assignee && (
            <KV>
              <K>{t('public.task.assignee', { defaultValue: '담당자' }) as string}</K>
              <V>{task.assignee.name}</V>
            </KV>
          )}
          {task.creator && (
            <KV>
              <K>{t('public.task.creator', { defaultValue: '요청자' }) as string}</K>
              <V>{task.creator.name}</V>
            </KV>
          )}
          {task.start_date && (
            <KV>
              <K>{t('public.task.start', { defaultValue: '시작일' }) as string}</K>
              <V>{task.start_date}</V>
            </KV>
          )}
          {task.due_date && (
            <KV>
              <K>{t('public.task.due', { defaultValue: '마감일' }) as string}</K>
              <V>{task.due_date}</V>
            </KV>
          )}
          <KV>
            <K>{t('public.task.progress', { defaultValue: '진행률' }) as string}</K>
            <V>
              <ProgressBar><ProgressFill style={{ width: `${task.progress_percent}%` }} /></ProgressBar>
              <ProgressText>{task.progress_percent}%</ProgressText>
            </V>
          </KV>
        </Grid>

        <CTAArea>
          {isAuthed ? (
            <CTA href={`/task?task=${task.id}`} type="button">
              {t('public.openInPlanQ', { defaultValue: 'PlanQ 에서 보기 →' }) as string}
            </CTA>
          ) : (
            <>
              <CTA href={`/login?next=${encodeURIComponent(`/public/tasks/${token}`)}`} type="button">
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

export default PublicTaskPage;

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
const TaskTitle = styled.h1`font-size: 22px; font-weight: 700; color: #0F172A; margin: 0 0 12px; line-height: 1.3;`;
const MetaRow = styled.div`display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 20px;`;
const StatusPill = styled.span`display: inline-flex; padding: 3px 10px; font-size: 11px; font-weight: 700; border-radius: 999px;`;
const MetaItem = styled.span`font-size: 12px; color: #64748B;`;
const Section = styled.section`margin: 16px 0;`;
const SectionLabel = styled.div`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;`;
const DescBox = styled.div`font-size: 13px; color: #334155; line-height: 1.6; padding: 12px 14px; background: #F8FAFC; border-radius: 8px; white-space: pre-wrap;`;
const Grid = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0;
  @media (max-width: 480px) { grid-template-columns: 1fr; }`;
const KV = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const K = styled.div`font-size: 11px; font-weight: 600; color: #94A3B8;`;
const V = styled.div`font-size: 13px; color: #0F172A; display: flex; align-items: center; gap: 8px;`;
const ProgressBar = styled.div`flex: 1; height: 6px; background: #E2E8F0; border-radius: 3px; overflow: hidden;`;
const ProgressFill = styled.div`height: 100%; background: #14B8A6; border-radius: 3px;`;
const ProgressText = styled.span`font-size: 11px; font-weight: 600; color: #475569; min-width: 32px; text-align: right;`;
const CTAArea = styled.div`display: flex; gap: 8px; margin: 24px 0 12px; flex-wrap: wrap;`;
const CTA = styled.a`
  display: inline-flex; align-items: center; min-height: 44px; padding: 10px 20px;
  background: #14B8A6; color: #fff; font-size: 13px; font-weight: 700;
  border-radius: 8px; text-decoration: none;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
const CTASecondary = styled.a`
  display: inline-flex; align-items: center; min-height: 44px; padding: 10px 20px;
  background: #fff; color: #334155; font-size: 13px; font-weight: 600;
  border: 1px solid #E2E8F0; border-radius: 8px; text-decoration: none;
  &:hover { border-color: #CBD5E1; background: #F8FAFC; }
`;
const Hint = styled.div`font-size: 12px; color: #94A3B8; padding: 12px 0;`;
const ErrorTitle = styled.div`font-size: 18px; font-weight: 700; color: #0F172A; margin-bottom: 8px;`;
const Footer = styled.div`font-size: 11px; color: #94A3B8; text-align: center; margin-top: 12px;`;
