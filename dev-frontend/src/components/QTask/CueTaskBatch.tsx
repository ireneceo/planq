// Cue 대화의 업무 묶음 — 한 답에 업무가 2개 이상이면 카드를 N장 세우지 않고 **Cue 바와 같은 후보 목록**으로 보인다
//   (2026-10-12 Fable 설계 (다). Irene: «여러 개 업무 추가하면 Q task에 그대로 추가해야 하는데 마음대로 줄이거나
//   팝아웃에서는 하나만 되고»).
//   새 카드를 그리지 않는다 — 후보 한 줄은 AiCandidateCard, 껍데기는 cueBarShell(CueTaskBar 미리보기와 같은 것).
//   확정은 POST /api/tasks/ai-create/confirm mode 'cue_batch' — 행마다 Cue 카드와 같은 실행 문(create_task)을 지난다.
//   부분 실패: 만든 행은 목록에서 빠지고, 못 만든 행은 고칠 수 있는 채 남아 다시 [M개 추가].
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { mapApiError } from '../../utils/apiError';
import ModalActionButton from '../Common/ModalActionButton';
import AiCandidateCard, { type AiCandidate, type AiCardMember } from './AiCandidateCard';
import { CardList, Actions, ErrorMsg, NoticeMsg } from '../Common/cueBarShell';
import type { CueActionResult } from '../Common/CueActionCard';

export interface CueTaskBatchRow extends AiCandidate {
  /** /help 가 검증·미리보기한 create_task 인자 — 서버가 확정 때 다시 검증한다 */
  cue_args?: Record<string, unknown> & { reviewer_user_ids?: number[] };
  reviewer_count?: number;
}
export interface CueTaskBatchProposal {
  tool: 'task_batch';
  base_date: string;
  members: AiCardMember[];
  candidates: CueTaskBatchRow[];
}

export function isTaskBatch(p: unknown): p is CueTaskBatchProposal {
  return !!p && typeof p === 'object' && (p as { tool?: string }).tool === 'task_batch'
    && Array.isArray((p as { candidates?: unknown }).candidates);
}

interface Props {
  proposal: CueTaskBatchProposal;
  businessId: number | null;
  /** 전부 추가됐을 때 — 결과 줄(«업무 N개를 추가했어요» + 열기)로 바뀐다 */
  onDone: (r: CueActionResult) => void;
  onDismiss: () => void;
}

export default function CueTaskBatch({ proposal, businessId, onDone, onDismiss }: Props) {
  const { t } = useTranslation('qtask');
  const { t: tc } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const [rows, setRows] = useState<CueTaskBatchRow[]>(() => proposal.candidates.map((c) => ({ ...c, selected: c.selected !== false })));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedIdx, setFailedIdx] = useState<Set<number>>(new Set());
  const [createdIds, setCreatedIds] = useState<number[]>([]);

  const selected = rows.filter((r) => r.selected);
  // 컨펌자 알림이 나가는 묶음이면 버튼이 받는 사람 수를 말한다(외부 발송은 확인을 받는다 — 무엇이 나가는지 적는다)
  const reviewerCount = useMemo(() => {
    const ids = new Set<number>();
    for (const r of selected) for (const id of (r.cue_args?.reviewer_user_ids || [])) ids.add(Number(id));
    return ids.size;
  }, [selected]);

  const update = (idx: number, patch: Partial<AiCandidate>) => {
    setRows((prev) => prev.map((r) => (r.idx === idx ? { ...r, ...patch } : r)));
  };

  const confirm = async () => {
    if (!businessId || selected.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await apiFetch('/api/tasks/ai-create/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, mode: 'cue_batch', base_date: proposal.base_date, candidates: selected }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.message || 'failed');
      const created = (j.data?.created || []) as Array<{ idx: number; id: number }>;
      const failed = (j.data?.failed || []) as Array<{ index: number; reason: string }>;
      const doneIdx = new Set(created.map((c) => c.idx));
      const allIds = [...createdIds, ...created.map((c) => c.id)];
      setCreatedIds(allIds);
      const left = rows.filter((x) => !doneIdx.has(x.idx));
      setRows(left);
      setFailedIdx(new Set(failed.map((f) => f.index)));
      if (!failed.length && !left.some((x) => x.selected)) {
        onDone({ tool: 'task_batch', entity_type: 'task', entity_id: allIds[0] ?? null, open_url: '/tasks', count: allIds.length });
        return;
      }
      if (failed.length) {
        setError(t('ai.batch.partial', { added: created.length, failed: failed.length, defaultValue: '{{added}}개를 추가했어요. {{failed}}개는 추가하지 못했어요 — 고쳐서 다시 추가해 주세요.' }) as string);
      }
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="cue-task-batch">
      <CardList>
        {rows.map((c) => (
          <div key={c.idx}>
            <AiCandidateCard
              candidate={c}
              members={proposal.members}
              baseDate={proposal.base_date}
              onChange={(patch) => update(c.idx, patch)}
              hideRecurrence
            />
            {failedIdx.has(c.idx) && <ErrorMsg role="alert">{t('ai.batch.rowFailed', '이 업무는 추가하지 못했어요 — 담당자·날짜를 확인해 주세요')}</ErrorMsg>}
          </div>
        ))}
      </CardList>
      {createdIds.length > 0 && rows.length > 0 && (
        <NoticeMsg role="status">{t('ai.batch.addedSoFar', { n: createdIds.length, defaultValue: '{{n}}개는 이미 추가했어요' })}</NoticeMsg>
      )}
      {error && <ErrorMsg role="alert">{error}</ErrorMsg>}
      <Actions>
        <ModalActionButton variant="ai" onClick={confirm} disabled={!businessId || selected.length === 0 || submitting} data-testid="cue-task-batch-add">
          {submitting
            ? t('ai.confirming', '추가 중...')
            : reviewerCount > 0
              ? t('ai.batch.addWithReviewers', { n: selected.length, m: reviewerCount, defaultValue: '{{n}}개 추가 · 컨펌자 {{m}}명에게 알림' })
              : selected.length === 1
                ? t('ai.confirmOne', '추가')
                : t('ai.confirm', { n: selected.length, defaultValue: '{{n}}개 추가' })}
        </ModalActionButton>
        <ModalActionButton variant="secondary" onClick={onDismiss} disabled={submitting}>{tc('qhelper.action.cancel', '취소')}</ModalActionButton>
      </Actions>
    </div>
  );
}
