// 오늘의 업무 리뷰 (Context Center) — Irene 2026-08-24.
//
//   확인 필요(Action Center)는 "내가 지금 행동해야 하는 것" 이고,
//   이건 "오늘 일을 시작하기 위해 알아야 하는 것" 이다. 섞으면 둘 다 어정쩡해진다.
//
// ★ 접힌 상태로 시작한다. 매일 아침 한 번 펼쳐 보는 브리핑이라, 펼친 채로 두면
//   정작 아래 행동 목록(확인 필요)을 밀어낸다. 접혀 있을 때도 **요약 숫자는 한 줄로 보인다** —
//   펼치지 않아도 "오늘 뭐가 있나" 는 알 수 있어야 열어볼 마음이 생긴다.
// ★ 탭으로 나누지 않는다(Irene). 한 흐름으로 읽는 브리핑이다.
// ★ 저장하지 않는다. 날짜별 이력도 없다 — 열 때마다 지금 상태로 계산한다.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

const OPEN_KEY = 'planq.todayReview.open';

interface ReviewCounts {
  projects_active: number; today_tasks: number; approvals: number; due_soon: number; changes: number;
}
interface ReviewChange {
  kind: 'task' | 'email' | 'chat' | 'event';
  id: number; title: string; detail_key: string;
  subject_label?: string | null;   // 고객·프로젝트 — 문장의 주어
  preview?: string | null;         // 실제 내용 한 줄 (메일 본문·마지막 발언·전이 사유)
  speaker?: string | null;         // 말한 사람 / 상태를 바꾼 사람
  from?: string | null; to?: string | null; count?: number;
  at: string; start_at?: string; link: string;
}
interface ReviewFocus { id: number; title: string; why: string; due_date?: string | null; link: string; overdue_days?: number; }
interface ReviewBlocks { inbound: ReviewChange[]; urgent: ReviewFocus[]; blocking: ReviewFocus[]; moved: ReviewChange[]; }
interface ReviewData { counts: ReviewCounts; blocks: ReviewBlocks; today?: string; }

interface Props { businessId: number | null; refreshKey?: number; }

const TodayReview: React.FC<Props> = ({ businessId, refreshKey }) => {
  const { t } = useTranslation('dashboard');
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
  });
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const r = await apiFetch(`/api/dashboard/today-review?business_id=${businessId}`);
      // apiFetch 는 throw 하지 않는다 — res.ok 를 본다. 실패하면 조용히 접힌 채 둔다(브리핑이 화면을 막지 않게).
      if (!r.ok) return;
      const j = await r.json().catch(() => null);
      if (j?.success) setData(j.data as ReviewData);
    } finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* 프라이빗 모드 */ }
      return next;
    });
  };

  const c = data?.counts;
  const b = data?.blocks;
  const summary: Array<{ key: string; label: string; n: number }> = c ? [
    { key: 'projects', label: t('review.projects', '진행 프로젝트') as string, n: c.projects_active },
    { key: 'today', label: t('review.todayTasks', '오늘 처리 필요') as string, n: c.today_tasks },
    { key: 'approvals', label: t('review.approvals', '승인 필요') as string, n: c.approvals },
    { key: 'due', label: t('review.dueSoon', '기한 임박') as string, n: c.due_soon },
    { key: 'changes', label: t('review.changes', '주요 변경') as string, n: c.changes },
  ] : [];

  const changeText = (ch: ReviewChange) => {
    if (ch.kind === 'task') return t('review.ch.task', { defaultValue: '상태가 바뀌었어요' });
    if (ch.kind === 'email') return ch.detail_key === 'reply_needed'
      ? t('review.ch.mailReply', { defaultValue: '답장이 필요해요' })
      : t('review.ch.mailCheck', { defaultValue: '확인이 필요해요' });
    if (ch.kind === 'chat') return t('review.ch.chat', { count: ch.count || 0, defaultValue: '새 메시지 {{count}}건' });
    return ch.detail_key === 'event_new'
      ? t('review.ch.eventNew', { defaultValue: '일정이 잡혔어요' })
      : t('review.ch.eventChanged', { defaultValue: '일정이 바뀌었어요' });
  };
  const whyText = (w: string) => (
    w === 'approval' ? t('review.why.approval', { defaultValue: '승인 대기' })
      : w === 'overdue' ? t('review.why.overdue', { defaultValue: '지연' })
        : t('review.why.dueToday', { defaultValue: '오늘 마감' })
  );

  return (
    <Wrap>
      <Head type="button" onClick={toggle} aria-expanded={open} data-testid="today-review-toggle">
        <Chevron $open={open} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </Chevron>
        <HeadTitle>{t('review.title', '오늘의 업무 리뷰')}</HeadTitle>
        {/* 접혀 있어도 숫자는 보인다 — 열어볼 이유가 여기서 생긴다 */}
        <SummaryRow>
          {summary.filter((s) => s.n > 0).map((s) => (
            <Pill key={s.key}>{s.label} <b>{s.n}</b></Pill>
          ))}
          {!loading && c && summary.every((s) => s.n === 0) && (
            <Quiet>{t('review.allClear', '오늘 새로 볼 것은 없어요')}</Quiet>
          )}
        </SummaryRow>
      </Head>

      {open && (
        <Body>
          {/* ★ 2026-08-24 교정 (Irene: "아래 전체 나오는 알림이랑 뭐가 달라?")
              엔티티 종류별 목록이 아니라 **맥락 블록**이다. 각 줄은 "무엇이 있었고 그래서 뭘 봐야 하나" 를
              한 줄로 말한다. 비어 있는 블록은 아예 그리지 않는다 — 빈 제목만 늘어놓으면 목록이 된다. */}
          {b && b.inbound.length > 0 && (
            <Section>
              <SecTitle>{t('review.blk.inbound', '고객·외부에서 온 것')}</SecTitle>
              <List>
                {b.inbound.map((ch) => <ContextRow key={`in-${ch.kind}-${ch.id}`} ch={ch} label={t(`review.kind.${ch.kind}`, ch.kind) as string} why={changeText(ch)} />)}
              </List>
            </Section>
          )}

          {b && b.urgent.length > 0 && (
            <Section>
              <SecTitle>{t('review.blk.urgent', '지금 움직여야 하는 것')}</SecTitle>
              <List>
                {b.urgent.map((f) => (
                  <Row key={`u-${f.id}`}>
                    <WhyTag $why={f.why}>{whyText(f.why)}</WhyTag>
                    <RowLink to={f.link}>{f.title}</RowLink>
                    <RowWhy>
                      {(f.overdue_days || 0) > 0
                        ? t('review.overdueDays', { n: f.overdue_days, defaultValue: '{{n}}일 지났어요' })
                        : t('review.dueTodayShort', { defaultValue: '오늘까지' })}
                    </RowWhy>
                  </Row>
                ))}
              </List>
            </Section>
          )}

          {b && b.blocking.length > 0 && (
            <Section>
              <SecTitle>{t('review.blk.blocking', '나를 기다리는 것')}</SecTitle>
              <List>
                {b.blocking.map((f) => (
                  <Row key={`b-${f.id}`}>
                    <WhyTag $why="approval">{whyText('approval')}</WhyTag>
                    <RowLink to={f.link}>{f.title}</RowLink>
                    <RowWhy>{t('review.blockingWhy', { defaultValue: '내가 컨펌해야 진행돼요' })}</RowWhy>
                  </Row>
                ))}
              </List>
            </Section>
          )}

          {b && b.moved.length > 0 && (
            <Section>
              <SecTitle>{t('review.blk.moved', '그 사이 움직인 것')}</SecTitle>
              <List>
                {b.moved.map((ch) => <ContextRow key={`m-${ch.kind}-${ch.id}`} ch={ch} label={t(`review.kind.${ch.kind}`, ch.kind) as string} why={changeText(ch)} />)}
              </List>
            </Section>
          )}

          {b && !b.inbound.length && !b.urgent.length && !b.blocking.length && !b.moved.length && (
            <Section><Quiet>{t('review.nothing', '어제 이후 새로 볼 맥락이 없어요')}</Quiet></Section>
          )}
        </Body>
      )}
    </Wrap>
  );
};

// 한 줄이 아니라 **두 줄**이다 — 윗줄은 "누가/무엇에 대해", 아랫줄은 **실제 내용**.
//   제목만 있으면 결국 할 일 목록이 된다(Irene 2026-08-24: "실제 내용이나 현상을 파악해서 리뷰해달라는 것").
const ContextRow: React.FC<{ ch: ReviewChange; label: string; why: string }> = ({ ch, label, why }) => (
  <CtxRow>
    <CtxTop>
      <KindTag $kind={ch.kind}>{label}</KindTag>
      {ch.subject_label && <Subject>{ch.subject_label}</Subject>}
      <RowLink to={ch.link}>{ch.title}</RowLink>
      <RowWhy>{why}</RowWhy>
    </CtxTop>
    {ch.preview && (
      <CtxBody>
        {ch.speaker && <Speaker>{ch.speaker}</Speaker>}
        {ch.preview}
      </CtxBody>
    )}
  </CtxRow>
);

export default TodayReview;

const Wrap = styled.section`
  background:#FFFFFF; border:1px solid #E2E8F0; border-radius:12px;
  margin-bottom:14px; overflow:hidden;
`;
const Head = styled.button`
  display:flex; align-items:center; gap:8px; width:100%;
  padding:12px 14px; background:transparent; border:none; cursor:pointer;
  font-family:inherit; text-align:left;
  &:hover { background:#F8FAFC; }
  &:focus-visible { outline:2px solid #14B8A6; outline-offset:-2px; }
`;
const Chevron = styled.svg<{ $open: boolean }>`
  width:14px; height:14px; flex-shrink:0; color:#94A3B8;
  transform: rotate(${(p) => (p.$open ? '90deg' : '0deg')}); transition: transform 0.18s ease;
`;
const HeadTitle = styled.span`font-size:14px; font-weight:700; color:#0F172A; flex-shrink:0;`;
const SummaryRow = styled.span`display:flex; align-items:center; gap:6px; flex-wrap:wrap; min-width:0;`;
const Pill = styled.span`
  padding:2px 8px; border-radius:999px; background:#F1F5F9;
  font-size:11px; font-weight:600; color:#475569; white-space:nowrap;
  b { color:#0F766E; margin-left:2px; }
`;
const Quiet = styled.span`font-size:12px; color:#94A3B8;`;
const Body = styled.div`padding:0 14px 14px; border-top:1px solid #F1F5F9;`;
const Section = styled.div`margin-top:12px;`;
const SecTitle = styled.div`font-size:12px; font-weight:700; color:#64748B; margin-bottom:6px;`;
const List = styled.div`display:flex; flex-direction:column; gap:4px;`;
const CtxRow = styled.div`
  display:flex; flex-direction:column; gap:2px;
  padding:6px 0; border-bottom:1px solid #F8FAFC;
  &:last-child { border-bottom:none; }
`;
const CtxTop = styled.div`display:flex; align-items:center; gap:8px; min-width:0;`;
const CtxBody = styled.div`
  padding-left:2px; font-size:12px; color:#64748B; line-height:1.5;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
`;
const Subject = styled.span`
  flex-shrink:0; font-size:12px; font-weight:700; color:#0F766E;
  max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
`;
const Speaker = styled.span`font-weight:600; color:#334155; margin-right:5px;`;
const Row = styled.div`
  display:flex; align-items:center; gap:8px; min-width:0;
  padding:5px 0; border-bottom:1px solid #F8FAFC;
  &:last-child { border-bottom:none; }
`;
const KindTag = styled.span<{ $kind: string }>`
  flex-shrink:0; padding:1px 7px; border-radius:6px; font-size:10px; font-weight:700;
  ${(p) => (p.$kind === 'task' ? 'background:#CCFBF1;color:#0F766E;'
    : p.$kind === 'email' ? 'background:#E0E7FF;color:#3730A3;'
      : p.$kind === 'chat' ? 'background:#FEF3C7;color:#92400E;'
        : 'background:#F1F5F9;color:#475569;')}
`;
const WhyTag = styled.span<{ $why: string }>`
  flex-shrink:0; padding:1px 7px; border-radius:6px; font-size:10px; font-weight:700;
  ${(p) => (p.$why === 'overdue' ? 'background:#FEE2E2;color:#B91C1C;'
    : p.$why === 'approval' ? 'background:#FEF3C7;color:#92400E;'
      : 'background:#CCFBF1;color:#0F766E;')}
`;
const RowLink = styled(Link)`
  flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:13px; color:#0F172A; text-decoration:none;
  &:hover { color:#0F766E; text-decoration:underline; }
`;
const RowWhy = styled.span`flex-shrink:0; font-size:11px; color:#94A3B8; white-space:nowrap;`;
