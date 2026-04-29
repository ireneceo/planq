import React, { useMemo } from 'react';
import styled, { css } from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { TodoItem, TodoPriority } from '../../services/dashboard';
import { groupByPriority, PRIORITY_LIST } from '../../services/dashboard';
import { useTimeFormat } from '../../hooks/useTimeFormat';

/* ─────────────────────────────────────────────
   우선순위 컬러 토큰
   ──────────────────────────────────────────── */
const PRIORITY_COLOR: Record<TodoPriority, { dot: string; bg: string; label: string; hint: string }> = {
  urgent:  { dot: '#F43F5E', bg: '#FEF2F2', label: '#B91C1C', hint: '#9F1239' },
  today:   { dot: '#F59E0B', bg: '#FFFBEB', label: '#B45309', hint: '#92400E' },
  waiting: { dot: '#64748B', bg: '#F8FAFC', label: '#334155', hint: '#475569' },
  week:    { dot: '#14B8A6', bg: '#F0FDFA', label: '#0F766E', hint: '#115E59' },
};

/* ─────────────────────────────────────────────
   Icon set — feather style
   ──────────────────────────────────────────── */
const IconTask = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>);
const IconEvent = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>);
const IconInvite = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>);
const IconMention = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>);
const IconEmail = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>);
const IconSpark = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2z"/></svg>);
const IconBill = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>);
const IconSign = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>);
const IconCash = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></svg>);
const IconReceipt = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16l3-2 3 2 3-2 3 2 3-2V8z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="15" y2="14"/></svg>);
const IconChevron = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>);

function TypeIcon({ type }: { type: TodoItem['type'] }) {
  if (type === 'task') return <IconTask />;
  if (type === 'event') return <IconEvent />;
  if (type === 'invite') return <IconInvite />;
  if (type === 'email') return <IconEmail />;
  if (type === 'task_candidate') return <IconSpark />;
  if (type === 'invoice') return <IconBill />;
  if (type === 'signature') return <IconSign />;
  if (type === 'payment_notify') return <IconCash />;
  if (type === 'tax_invoice') return <IconReceipt />;
  return <IconMention />;
}

/* ─────────────────────────────────────────────
   Due label (tz-aware)
   ──────────────────────────────────────────── */
function formatDue(
  item: TodoItem,
  t: ReturnType<typeof useTranslation>['t'],
  fmt: ReturnType<typeof useTimeFormat>,
): string {
  if (!item.dueAt) return '';
  const due = new Date(item.dueAt);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffH = Math.round(diffMs / 3600 / 1000);
  const diffD = Math.round(diffMs / 86400 / 1000);

  if (diffMs < 0) {
    const absH = Math.abs(diffH);
    if (absH < 24) return t('todo.dueLabel.overdueHours', { hours: absH });
    return t('todo.dueLabel.overdue', { days: Math.abs(diffD) });
  }
  const hhmm = fmt.formatTime(due);
  if (diffD === 0) return t('todo.dueLabel.today', { time: hhmm });
  if (diffD === 1) return t('todo.dueLabel.tomorrow', { time: hhmm });
  return t('todo.dueLabel.inDays', { days: diffD });
}

/* ─────────────────────────────────────────────
   Component
   ──────────────────────────────────────────── */
interface Props {
  items: TodoItem[];
  loading?: boolean;
  onOpenDrawer?: (item: TodoItem) => void;
  onInviteAction?: (item: TodoItem, action: 'accept' | 'decline') => void;
  onTaskAction?: (item: TodoItem, action: 'ack' | 'approve' | 'complete') => void;
}

const TodoList: React.FC<Props> = ({ items, loading, onOpenDrawer, onInviteAction, onTaskAction }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const fmt = useTimeFormat();

  const groups = useMemo(() => groupByPriority(items), [items]);

  if (loading) {
    return (
      <Shell>
        <Header>
          <Title>{t('todo.title')}</Title>
        </Header>
        <Skeleton />
      </Shell>
    );
  }

  if (items.length === 0) {
    return (
      <Shell>
        <Header>
          <Title>{t('todo.title')}</Title>
        </Header>
        <Empty>
          <EmptyTitle>{t('todo.emptyTitle')}</EmptyTitle>
          <EmptySub>{t('todo.emptySub')}</EmptySub>
        </Empty>
      </Shell>
    );
  }

  const handleClick = (it: TodoItem) => {
    if (it.drawer && onOpenDrawer) {
      onOpenDrawer(it);
      return;
    }
    if (it.link) {
      // 서명 페이지는 새 탭 (인증 없이 별도 진입)
      if (it.type === 'signature' && it.link.startsWith('/sign/')) {
        window.open(it.link, '_blank', 'noopener,noreferrer');
        return;
      }
      navigate(it.link);
    }
  };

  return (
    <Shell>
      <Header>
        <Title>{t('todo.title')}</Title>
        <Count>{t('todo.count', { count: items.length })}</Count>
      </Header>

      {PRIORITY_LIST.map(pri => {
        const list = groups[pri];
        if (list.length === 0) return null;
        const color = PRIORITY_COLOR[pri];
        return (
          <Section key={pri}>
            <SectionHead>
              <Dot style={{ background: color.dot }} />
              <SectionLabel style={{ color: color.label }}>
                {t(`todo.priority.${pri}`)}
              </SectionLabel>
              <SectionCount>{list.length}</SectionCount>
              <SectionHint>{t(`todo.priorityHint.${pri}`)}</SectionHint>
            </SectionHead>

            <Cards>
              {list.map(it => (
                <Card
                  key={it.id}
                  $urgent={pri === 'urgent'}
                  onClick={() => handleClick(it)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(it); }}
                >
                  <CardIcon $color={color.dot}>
                    <TypeIcon type={it.type} />
                  </CardIcon>
                  <CardBody>
                    <CardLine1>
                      <Verb>{t(`todo.verb.${it.verb}`)}</Verb>
                      <Subject>{it.subject}</Subject>
                    </CardLine1>
                    <CardLine2>
                      {it.dueAt && <DueBadge $priority={pri}>{formatDue(it, t, fmt)}</DueBadge>}
                      {it.context && <CtxText>{it.context}</CtxText>}
                      {it.workspace && <WsChip $role={it.workspace.role}>{it.workspace.brand_name}</WsChip>}
                    </CardLine2>
                  </CardBody>
                  <CardRight>
                    {it.inline === 'invite' ? (
                      <>
                        <InlineBtn type="button" $variant="primary"
                          onClick={(e) => { e.stopPropagation(); onInviteAction?.(it, 'accept'); }}>
                          {t('todo.action.accept')}
                        </InlineBtn>
                        <InlineBtn type="button" $variant="ghost"
                          onClick={(e) => { e.stopPropagation(); onInviteAction?.(it, 'decline'); }}>
                          {t('todo.action.decline')}
                        </InlineBtn>
                      </>
                    ) : it.type === 'task' && it.verb === 'ack' ? (
                      <>
                        <InlineBtn type="button" $variant="primary"
                          onClick={(e) => { e.stopPropagation(); onTaskAction?.(it, 'ack'); }}>
                          {t('todo.action.ack')}
                        </InlineBtn>
                        <Chevron aria-hidden="true"><IconChevron /></Chevron>
                      </>
                    ) : it.type === 'task' && it.verb === 'confirm' ? (
                      <>
                        <InlineBtn type="button" $variant="primary"
                          onClick={(e) => { e.stopPropagation(); onTaskAction?.(it, 'approve'); }}>
                          {t('todo.action.confirm')}
                        </InlineBtn>
                        <Chevron aria-hidden="true"><IconChevron /></Chevron>
                      </>
                    ) : (
                      <Chevron aria-hidden="true"><IconChevron /></Chevron>
                    )}
                  </CardRight>
                </Card>
              ))}
            </Cards>
          </Section>
        );
      })}
    </Shell>
  );
};

export default TodoList;

/* ─────────────────────────────────────────────
   Styles
   ──────────────────────────────────────────── */
const Shell = styled.section`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  padding: 20px 20px 8px;
`;

const Header = styled.header`
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #F1F5F9;
  margin-bottom: 12px;
`;

const Title = styled.h2`
  font-size: 16px;
  font-weight: 700;
  color: #0F172A;
  margin: 0;
  letter-spacing: -0.2px;
`;

const Count = styled.span`
  font-size: 12px;
  color: #64748B;
  font-weight: 500;
`;

const Empty = styled.div`
  padding: 32px 8px;
  text-align: center;
`;
const EmptyTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #334155;
`;
const EmptySub = styled.div`
  font-size: 12px;
  color: #94A3B8;
  margin-top: 4px;
`;

const Skeleton = styled.div`
  height: 80px;
  background: linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%);
  background-size: 200% 100%;
  animation: sh 1.6s linear infinite;
  border-radius: 8px;
  @keyframes sh { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;

const Section = styled.div`
  margin-bottom: 12px;
`;

const SectionHead = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
`;

const Dot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
`;

const SectionLabel = styled.span`
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2px;
`;

const SectionCount = styled.span`
  font-size: 11px;
  color: #64748B;
  background: #F1F5F9;
  border-radius: 999px;
  padding: 1px 7px;
  font-weight: 600;
`;

const SectionHint = styled.span`
  font-size: 11px;
  color: #94A3B8;
  margin-left: auto;
`;

const Cards = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Card = styled.li<{ $urgent?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, transform 0.12s;

  &:hover {
    border-color: #CBD5E1;
    background: #F8FAFC;
  }
  &:focus-visible {
    outline: 2px solid #14B8A6;
    outline-offset: 2px;
  }

  ${props => props.$urgent && css`
    border-left: 3px solid #F43F5E;
  `}
`;

const CardIcon = styled.div<{ $color: string }>`
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: ${p => `${p.$color}14`};
  color: ${p => p.$color};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const CardBody = styled.div`
  flex: 1;
  min-width: 0;
`;

const CardLine1 = styled.div`
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 3px;
`;

const Verb = styled.span`
  font-size: 12px;
  font-weight: 700;
  color: #0F766E;
  background: #F0FDFA;
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
`;

const Subject = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: #0F172A;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
`;

const CardLine2 = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #64748B;
`;

const DueBadge = styled.span<{ $priority: TodoPriority }>`
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: ${p => PRIORITY_COLOR[p.$priority].bg};
  color: ${p => PRIORITY_COLOR[p.$priority].label};
  flex-shrink: 0;
`;

const CtxText = styled.span`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

// 워크스페이스 라벨 chip — cross-workspace 알림에서 어느 워크스페이스인지 표시
const WsChip = styled.span<{ $role: 'owner' | 'member' | 'client' | 'admin' }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  background: ${p =>
    p.$role === 'client' ? '#FEF3C7' :
    p.$role === 'owner' ? '#FFE4E6' :
    p.$role === 'admin' ? '#FFE4E6' :
    '#CCFBF1'};
  color: ${p =>
    p.$role === 'client' ? '#92400E' :
    p.$role === 'owner' ? '#9F1239' :
    p.$role === 'admin' ? '#9F1239' :
    '#0F766E'};
  white-space: nowrap;
`;

const CardRight = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
`;

const Chevron = styled.span`
  color: #CBD5E1;
  display: flex;
`;

const InlineBtn = styled.button<{ $variant: 'primary' | 'ghost' | 'danger' }>`
  font-size: 12px;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.12s;

  ${props => props.$variant === 'primary' && css`
    background: #14B8A6;
    color: #FFFFFF;
    &:hover { background: #0D9488; }
  `}
  ${props => props.$variant === 'ghost' && css`
    background: #FFFFFF;
    color: #334155;
    border-color: #CBD5E1;
    &:hover { background: #F8FAFC; }
  `}
  ${props => props.$variant === 'danger' && css`
    background: #FFFFFF;
    color: #DC2626;
    border-color: #FECACA;
    &:hover { background: #FEF2F2; }
  `}
`;
