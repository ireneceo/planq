// DailyStartModal — 로그인 후 첫 진입 시 "오늘 시작" 안내 모달 (사이클 N+26 Phase 2)
//
// 트리거 조건 (TodoPage 또는 Dashboard 에서 mount):
//   focus_enabled=true AND focus_daily_prompt=true
//   AND focus_prompt_last_dismissed_date != 오늘
//   AND 활성 focus_session 없음
//
// 본문: 오늘 마감 + 확인요청 + 지연된 업무 (담당자=me) 카테고리 3종
// 행 클릭 = POST /api/focus/start { task_id } + 모달 닫기 + drawer 자동 열기 (옵션)
// "오늘 다시 보지 않기" = focus_prompt_last_dismissed_date = 오늘

import React, { useEffect, useState, useRef, useCallback } from 'react';
import styled from 'styled-components';
import { createPortal } from 'react-dom';
import { useChromeNav } from '../../hooks/useChromeNav';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface TaskItem {
  id: number;
  title: string;
  status: string;
  due_date: string | null;
  progress_percent: number | null;
  business_id: number;
  project_id: number | null;
  kind: 'today' | 'review' | 'overdue';
}

interface Buckets {
  today: TaskItem[];
  review: TaskItem[];
  overdue: TaskItem[];
}

const todayDateStr = () => new Date().toISOString().slice(0, 10);

const DailyStartModal: React.FC = () => {
  const { t } = useTranslation('focus');
  const navigate = useChromeNav();
  const dialogRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [buckets, setBuckets] = useState<Buckets | null>(null);
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [dontShowToday, setDontShowToday] = useState(false);
  const checkedOnceRef = useRef(false);

  useBodyScrollLock(open);
  useEscapeStack(open, () => setOpen(false));
  useFocusTrap(dialogRef, open);

  // mount 시 한 번만 — 모달 표시 여부 결정
  useEffect(() => {
    if (checkedOnceRef.current) return;
    checkedOnceRef.current = true;

    (async () => {
      try {
        // 1) settings — focus_enabled=true && daily_prompt=true && last_dismissed != 오늘
        const sR = await apiFetch('/api/focus/settings');
        const sJ = await sR.json();
        if (!sJ.success) return;
        const s = sJ.data;
        if (!s.focus_enabled || !s.focus_daily_prompt) return;
        const last = s.focus_prompt_last_dismissed_date ? String(s.focus_prompt_last_dismissed_date).slice(0, 10) : null;
        if (last === todayDateStr()) return;

        // 2) 활성 session 없을 때만
        const cR = await apiFetch('/api/focus/current');
        const cJ = await cR.json();
        if (cJ.data) return;

        // 3) daily-prompt-items
        const dR = await apiFetch('/api/focus/daily-prompt-items');
        const dJ = await dR.json();
        if (!dJ.success) return;
        const total = (dJ.data.today?.length || 0) + (dJ.data.review?.length || 0) + (dJ.data.overdue?.length || 0);
        if (total === 0) return;  // 보여줄 게 없으면 모달 X
        setBuckets(dJ.data);
        setOpen(true);
      } catch { /* noop */ }
    })();
  }, []);

  const startWith = useCallback(async (item: TaskItem) => {
    if (submitting) return;
    setSubmitting(item.id);
    try {
      const r = await apiFetch('/api/focus/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: item.business_id, task_id: item.id }),
      });
      if (r.ok) {
        setOpen(false);
        // /tasks?task=:id — TaskDetailDrawer URL sync 의 표준 (project_id 무관)
        // 옛: project_id 있으면 /projects/:pid?task=:id 였는데 QProjectPage 가 ?task= 처리 안 함 → 프로젝트만 열림 회귀
        navigate(`/tasks?task=${item.id}`);
      }
    } finally { setSubmitting(null); }
  }, [submitting, navigate]);

  const handleClose = useCallback(async () => {
    if (dontShowToday) {
      // last_dismissed = 오늘
      await apiFetch('/api/focus/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ focus_prompt_last_dismissed_date: todayDateStr() }),
      });
    }
    setOpen(false);
  }, [dontShowToday]);

  if (!open || !buckets) return null;

  const renderCategory = (title: string, emoji: string, items: TaskItem[]) => {
    if (items.length === 0) return null;
    return (
      <Category>
        <CategoryTitle>{emoji} {title} <CategoryCount>({items.length})</CategoryCount></CategoryTitle>
        <List>
          {items.map((it) => (
            <Row
              key={it.id}
              type="button"
              onClick={() => startWith(it)}
              disabled={submitting === it.id}
            >
              <PlayIcon><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg></PlayIcon>
              <RowBody>
                <RowTitle>{it.title}</RowTitle>
                <RowMeta>
                  {it.due_date && <DueText>{formatDue(it.due_date, t)}</DueText>}
                  {it.progress_percent != null && it.progress_percent > 0 && <ProgressText>{it.progress_percent}%</ProgressText>}
                </RowMeta>
              </RowBody>
            </Row>
          ))}
        </List>
      </Category>
    );
  };

  const node = (
    <Backdrop onClick={handleClose}>
      <Dialog
        ref={dialogRef}
        role="dialog" aria-modal="true" aria-label={t('dailyStart.title', '오늘 시작하기') as string}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader>
          <Title>{t('dailyStart.title', '오늘 시작하기')}</Title>
          <CloseBtn type="button" onClick={handleClose} aria-label={t('common.close', '닫기') as string}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </CloseBtn>
        </ModalHeader>
        <Intro>{t('dailyStart.intro', '오늘 마감·확인요청·지연된 업무를 모았어요. 골라서 시작하거나, 비워두고 닫아도 OK.')}</Intro>

        <Body>
          {renderCategory(t('dailyStart.todayTitle', '오늘 마감') as string, '🔥', buckets.today)}
          {renderCategory(t('dailyStart.reviewTitle', '확인 요청 받음') as string, '👀', buckets.review)}
          {renderCategory(t('dailyStart.overdueTitle', '지연된 업무') as string, '⏰', buckets.overdue)}
        </Body>

        <Footer>
          <DontShow>
            <input
              type="checkbox" id="dont-show-today"
              checked={dontShowToday}
              onChange={(e) => setDontShowToday(e.target.checked)}
            />
            <label htmlFor="dont-show-today">{t('dailyStart.dontShowToday', '오늘 다시 보지 않기')}</label>
          </DontShow>
          <CloseBtnText type="button" onClick={handleClose}>
            {t('common.close', '닫기')}
          </CloseBtnText>
        </Footer>
      </Dialog>
    </Backdrop>
  );

  return createPortal(node, document.body);
};

export default DailyStartModal;

function formatDue(iso: string, t: (k: string, opts?: Record<string, unknown>) => unknown): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(d); due.setHours(0, 0, 0, 0);
  const diffDay = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDay < 0) return t('dailyStart.overdueDays', { n: Math.abs(diffDay), defaultValue: '{{n}}일 지연' }) as string;
  if (diffDay === 0) return t('dailyStart.dueToday', { defaultValue: '오늘 마감' }) as string;
  if (diffDay === 1) return t('dailyStart.dueTomorrow', { defaultValue: '내일 마감' }) as string;
  return t('dailyStart.dueDays', { n: diffDay, defaultValue: '{{n}}일 남음' }) as string;
}

// ─── styled ─────────────────────────────────────────────────────
const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: dsm-in 0.18s ease-out;
  @keyframes dsm-in { from { opacity: 0; } to { opacity: 1; } }
  @media (max-width: 640px) {
    padding: 0;
    align-items: flex-end;
  }
`;
const Dialog = styled.div`
  background: #FFFFFF;
  border-radius: 16px;
  width: 100%;
  max-width: 560px;
  max-height: 84vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
  animation: dsm-pop 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  @keyframes dsm-pop { from { transform: scale(0.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  @media (max-width: 640px) {
    border-radius: 16px 16px 0 0;
    max-width: 100%;
    max-height: 92vh;
  }
`;
const ModalHeader = styled.header`
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 24px 12px;
`;
const Title = styled.h2`
  font-size: 18px; font-weight: 700; color: #0F172A;
  margin: 0; letter-spacing: -0.3px;
`;
const CloseBtn = styled.button`
  width: 32px; height: 32px; padding: 0;
  background: transparent; border: none; border-radius: 6px;
  color: #64748B; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Intro = styled.p`
  margin: 0 24px 16px;
  font-size: 13px; color: #475569; line-height: 1.55;
`;
const Body = styled.div`
  flex: 1; overflow-y: auto;
  padding: 0 24px 8px;
`;
const Category = styled.section`
  margin-bottom: 16px;
  &:last-child { margin-bottom: 8px; }
`;
const CategoryTitle = styled.h3`
  margin: 0 0 8px;
  font-size: 13px; font-weight: 700; color: #0F172A;
  display: flex; align-items: center; gap: 6px;
`;
const CategoryCount = styled.span`
  font-size: 11px; font-weight: 500; color: #94A3B8;
`;
const List = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const Row = styled.button`
  all: unset; cursor: pointer; box-sizing: border-box;
  display: flex; align-items: center; gap: 10px;
  width: 100%; min-height: 48px;
  padding: 10px 12px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  transition: background 0.12s, border-color 0.12s;
  &:hover:not(:disabled) {
    background: #F0FDFA;
    border-color: #14B8A6;
  }
  &:focus-visible {
    outline: 2px solid #14B8A6;
    outline-offset: 2px;
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 640px) {
    min-height: 56px;
    padding: 12px 14px;
  }
`;
const PlayIcon = styled.span`
  width: 24px; height: 24px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #14B8A6; color: #FFFFFF;
  border-radius: 50%;
`;
const RowBody = styled.div`flex: 1; min-width: 0;`;
const RowTitle = styled.div`
  font-size: 14px; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  letter-spacing: -0.1px;
`;
const RowMeta = styled.div`
  display: flex; align-items: center; gap: 8px;
  margin-top: 2px;
`;
const DueText = styled.span`
  font-size: 11px; color: #64748B;
`;
const ProgressText = styled.span`
  font-size: 11px; color: #0F766E; font-weight: 600;
`;
const Footer = styled.footer`
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 24px 20px;
  border-top: 1px solid #F1F5F9;
  margin-top: 8px;
`;
const DontShow = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12px; color: #475569;
  & input { cursor: pointer; }
  & label { cursor: pointer; }
`;
const CloseBtnText = styled.button`
  height: 36px; padding: 0 16px;
  background: #FFFFFF; color: #334155;
  border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
