// 작업대 업무 리스트 — 프로젝트 업무 / 내 할 일 / 요청한 업무.
//
// "업무를 추가했으면 그 자리에서 리스트도 봐야지" (Irene). 세 그룹은 서로 다른 질문에 답한다:
//   프로젝트 업무 = 이 맥락에서 무슨 일이 돌아가는가
//   내 할 일     = 그중 내가 할 것
//   요청한 업무  = 내가 남에게 맡긴 것 (내가 기다리는 것)
// 겹칠 수 있다 — 같은 업무를 다른 관점으로 본다. 건수 있는 그룹만 펼친다.
//
// 데이터: GET /api/tasks/context (한 번에 3버킷). 실시간은 socket task:new/updated/deleted.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../contexts/AuthContext';
import WorkbenchSection from './WorkbenchSection';

export interface ContextTask {
  id: number;
  title: string;
  status: string;
  due_date: string | null;
  project_id: number | null;
  project_name: string | null;
  assignee_id: number | null;
  assignee: { id: number; name: string } | null;
  progress_percent?: number | null;
}
interface Bucket { items: ContextTask[]; total: number }
export interface ContextTasks {
  scope: string;
  project_tasks: Bucket;
  my_tasks: Bucket;
  requested: Bucket;
}

interface Props {
  businessId: number;
  /** 셋 중 하나 — 우선순위 project > conversation > email_thread */
  projectId?: number | null;
  conversationId?: number | null;
  emailThreadId?: number | null;
  /** 업무를 열 때 (드로어). 없으면 Q Task 로 이동 */
  onOpenTask?: (taskId: number) => void;
  /** 부모가 갱신 신호를 줄 때 쓰는 키 (등록·socket 이벤트 시 증가) */
  reloadKey?: number;
}

const STATUS_TONE: Record<string, string> = {
  not_started: '#94A3B8',
  waiting: '#F59E0B',
  in_progress: '#14B8A6',
  reviewing: '#6366F1',
  revision_requested: '#EF4444',
  completed: '#22C55E',
  canceled: '#CBD5E1',
};

export default function ContextTaskList({
  businessId, projectId = null, conversationId = null, emailThreadId = null, onOpenTask, reloadKey = 0,
}: Props) {
  const { t } = useTranslation('qtask');
  const navigate = useNavigate();
  const [data, setData] = useState<ContextTasks | null>(null);
  const [loading, setLoading] = useState(true);

  const scopeQuery = projectId
    ? `project_id=${projectId}`
    : conversationId
      ? `conversation_id=${conversationId}`
      : emailThreadId
        ? `email_thread_id=${emailThreadId}`
        : null;

  const load = useCallback(async () => {
    if (!businessId || !scopeQuery) { setData(null); setLoading(false); return; }
    try {
      const r = await apiFetch(`/api/tasks/context?business_id=${businessId}&${scopeQuery}&limit=8`);
      const j = await r.json();
      setData(j.success ? j.data : null);
    } catch {
      setData(null);   // 작업대의 다른 섹션은 계속 살아 있어야 한다
    } finally {
      setLoading(false);
    }
  }, [businessId, scopeQuery]);

  useEffect(() => { load(); }, [load, reloadKey]);

  if (!scopeQuery) return null;

  const groups: Array<{ key: keyof ContextTasks; label: string; bucket: Bucket }> = data
    ? [
        { key: 'project_tasks', label: t('workbench.projectTasks', '프로젝트 업무') as string, bucket: data.project_tasks },
        { key: 'my_tasks', label: t('workbench.myTasks', '내 할 일') as string, bucket: data.my_tasks },
        { key: 'requested', label: t('workbench.requested', '요청한 업무') as string, bucket: data.requested },
      ]
    : [];

  const total = data ? data.project_tasks.total : 0;

  const openTask = (id: number) => {
    if (onOpenTask) onOpenTask(id);
    else navigate(`/tasks?task=${id}`);
  };

  const dueLabel = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (days < 0) return { text: t('workbench.overdue', { n: -days, defaultValue: '{{n}}일 지남' }) as string, overdue: true };
    if (days === 0) return { text: t('workbench.today', '오늘') as string, overdue: false };
    if (days <= 7) return { text: t('workbench.inDays', { n: days, defaultValue: 'D-{{n}}' }) as string, overdue: false };
    return { text: String(iso).slice(5, 10).replace('-', '/'), overdue: false };
  };

  return (
    <WorkbenchSection
      title={t('workbench.tasks', '업무') as string}
      count={total}
      defaultOpen={total > 0}
    >
      {loading ? (
        <Skeleton aria-hidden="true">
          <SkelRow /><SkelRow /><SkelRow />
        </Skeleton>
      ) : !data || total === 0 ? (
        <Empty>{t('workbench.emptyTasks', '아직 이 대화에서 만든 업무가 없어요. 위에서 한 줄로 등록해 보세요.') as string}</Empty>
      ) : (
        groups.map(({ key, label, bucket }) => (
          bucket.total === 0 ? null : (
            <Group key={key}>
              <GroupHead>
                <GroupLabel>{label}</GroupLabel>
                <GroupCount>{bucket.total}</GroupCount>
              </GroupHead>
              <Rows>
                {bucket.items.map((task) => {
                  const due = dueLabel(task.due_date);
                  return (
                    <Row key={task.id} type="button" onClick={() => openTask(task.id)}>
                      <Dot $color={STATUS_TONE[task.status] || '#94A3B8'} />
                      <RowMain>
                        <RowTitle>{task.title}</RowTitle>
                        <RowMeta>
                          {task.assignee?.name && <Who>{task.assignee.name}</Who>}
                          {task.project_name && <Proj>{task.project_name}</Proj>}
                          {due && <Due $overdue={due.overdue}>{due.text}</Due>}
                        </RowMeta>
                      </RowMain>
                    </Row>
                  );
                })}
              </Rows>
              {bucket.total > bucket.items.length && (
                <MoreLink type="button" onClick={() => navigate(projectId ? `/tasks?project=${projectId}` : '/tasks')}>
                  {t('workbench.seeAll', { n: bucket.total, defaultValue: 'Q Task 에서 {{n}}건 전체 보기' }) as string}
                  <span aria-hidden>›</span>
                </MoreLink>
              )}
            </Group>
          )
        ))
      )}
    </WorkbenchSection>
  );
}

const Group = styled.div`display: flex; flex-direction: column; gap: 5px;`;
const GroupHead = styled.div`display: flex; align-items: center; gap: 6px; padding-top: 2px;`;
const GroupLabel = styled.span`font-size: 11px; font-weight: 700; color: #64748B; letter-spacing: -0.1px;`;
const GroupCount = styled.span`font-size: 11px; font-weight: 600; color: #94A3B8;`;
const Rows = styled.div`display: flex; flex-direction: column; gap: 2px;`;
const Row = styled.button`
  display: flex; align-items: flex-start; gap: 8px; width: 100%;
  padding: 7px 8px; border: none; border-radius: 8px; background: transparent;
  cursor: pointer; text-align: left;
  transition: background 0.12s ease;
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
const Dot = styled.span<{ $color: string }>`
  width: 7px; height: 7px; margin-top: 5px; border-radius: 50%; flex-shrink: 0;
  background: ${(p) => p.$color};
`;
const RowMain = styled.span`display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;`;
const RowTitle = styled.span`
  font-size: 12px; font-weight: 600; color: #334155; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
`;
const RowMeta = styled.span`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const Who = styled.span`font-size: 11px; color: #94A3B8;`;
const Proj = styled.span`
  font-size: 10px; font-weight: 600; color: #0F766E; background: #F0FDFA;
  padding: 0 6px; border-radius: 999px;
  max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const Due = styled.span<{ $overdue: boolean }>`
  font-size: 10px; font-weight: 700;
  color: ${(p) => (p.$overdue ? '#B91C1C' : '#94A3B8')};
  background: ${(p) => (p.$overdue ? '#FEF2F2' : 'transparent')};
  padding: ${(p) => (p.$overdue ? '0 6px' : '0')};
  border-radius: 999px;
`;
const MoreLink = styled.button`
  align-self: flex-start; border: none; background: none; padding: 2px 8px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; font-weight: 600; color: #0F766E;
  &:hover { color: #0D9488; text-decoration: underline; }
  span { font-size: 13px; line-height: 1; }
`;
const Empty = styled.div`font-size: 12px; color: #94A3B8; line-height: 1.5;`;
const Skeleton = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const SkelRow = styled.div`
  height: 32px; border-radius: 8px;
  background: linear-gradient(90deg, #F1F5F9 25%, #F8FAFC 50%, #F1F5F9 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;
