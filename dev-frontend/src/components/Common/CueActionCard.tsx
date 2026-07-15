// #81 Cue 대화형 실행 — 확인 카드 (인라인, 팝업 아님).
//   Cue 가 제안한 tool call 을 사람이 확인/수정 후 [추가] 를 눌러야 실행된다.
//   실행은 POST /api/cue/execute-action → 행동 계층(메뉴 권한·assertAssignable·감사·broadcast).
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { listMembers, type WorkspaceMember } from '../../services/workspace';
import ActionButton from './ActionButton';
import SingleDateField from './SingleDateField';
import PlanQSelect, { type PlanQSelectOption } from './PlanQSelect';

const DOC_KIND_KEYS = ['quote', 'contract', 'nda', 'proposal', 'sow', 'meeting_note', 'sop', 'custom'] as const;

export interface CueProposal {
  tool: 'create_task' | 'create_event' | 'create_document_draft';
  params: Record<string, unknown>;
}
export interface CueActionResult {
  tool: string;
  entity_type: string;
  entity_id: number;
}

interface Props {
  proposal: CueProposal;
  businessId: number | null;
  onExecuted: (r: CueActionResult) => void;   // 성공 → 부모가 카드를 ✓ 요약으로 교체
  onDismiss: () => void;                       // 취소 → 카드 제거(요약 없음)
}

const memberLabel = (m: WorkspaceMember): string =>
  m.user?.display_name || m.user?.name || (m.user_id ? `#${m.user_id}` : '');

const CueActionCard: React.FC<Props> = ({ proposal, businessId, onExecuted, onDismiss }) => {
  const { t } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const [params, setParams] = useState<Record<string, unknown>>({ ...proposal.params });
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [descOpen, setDescOpen] = useState(false);

  const set = (k: string, v: unknown) => setParams((p) => ({ ...p, [k]: v }));

  // 담당자 피커용 멤버 (create_task) — 비-AI 만
  useEffect(() => {
    if (proposal.tool !== 'create_task' || !businessId) return;
    let alive = true;
    listMembers(businessId)
      .then((rows) => { if (alive) setMembers(rows.filter((m) => m.role !== 'ai' && m.user_id)); })
      .catch(() => { /* 피커 없이도 본인 기본 실행 가능 */ });
    return () => { alive = false; };
  }, [proposal.tool, businessId]);

  const mapError = (code?: string, message?: string): string => {
    const c = code || message || '';
    if (/^menu_forbidden/.test(c)) return t('qhelper.action.errMenu', '이 작업에 필요한 메뉴 권한이 없어요.');
    if (/^cannot_assign/.test(c)) return t('qhelper.action.errAssign', '그 담당자에게는 배정할 수 없어요.');
    if (c === 'invalid_kind') return t('qhelper.action.errKind', '지원하지 않는 문서 종류예요.');
    if (c === 'title_required' || c === 'invalid_payload') return t('qhelper.action.errTitle', '제목이 필요해요.');
    if (c === 'invalid_dates') return t('qhelper.action.errDates', '일정 시각이 올바르지 않아요.');
    return tErr(c, { defaultValue: t('qhelper.action.errGeneric', '실행하지 못했어요. 잠시 후 다시 시도해주세요.') }) as string;
  };

  const execute = async () => {
    if (submitting) return;               // 중복 제출 가드
    setSubmitting(true); setError(null);
    try {
      const res = await apiFetch('/api/cue/execute-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: proposal.tool, params }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        if (res.status === 422) { setError(t('qhelper.action.errQuota', 'Cue 사용 한도를 초과했어요.')); return; }
        setError(mapError(j.code, j.message)); return;
      }
      onExecuted({ tool: j.data.tool, entity_type: j.data.entity_type, entity_id: j.data.entity_id });
    } catch {
      setError(t('qhelper.action.errGeneric', '실행하지 못했어요. 잠시 후 다시 시도해주세요.'));
    } finally {
      setSubmitting(false);
    }
  };

  const title = String(params.title || '');
  const header =
    proposal.tool === 'create_task' ? t('qhelper.action.hdrTask', '업무 추가')
    : proposal.tool === 'create_event' ? t('qhelper.action.hdrEvent', '일정 추가')
    : t('qhelper.action.hdrDoc', '문서 초안');
  const addLabel =
    proposal.tool === 'create_task' ? t('qhelper.action.addTask', '＋ 업무 추가')
    : proposal.tool === 'create_event' ? t('qhelper.action.addEvent', '＋ 일정 추가')
    : t('qhelper.action.addDoc', '＋ 초안 만들기');

  return (
    <Card role="group" aria-label={header}>
      <Hdr>✦ {t('qhelper.action.proposeBy', 'Cue 제안')} · {header}</Hdr>

      <Field>
        <Lbl>{t('qhelper.action.title', '제목')}</Lbl>
        <Input value={title} onChange={(e) => set('title', e.target.value)} maxLength={300} />
      </Field>

      {proposal.tool === 'create_task' && (
        <>
          <Field as="div">
            <Lbl>{t('qhelper.action.assignee', '담당자')}</Lbl>
            {(() => {
              const opts: PlanQSelectOption[] = [
                { value: '', label: t('qhelper.action.assigneeSelf', '본인') },
                ...members.map((m) => ({ value: m.user_id as number, label: memberLabel(m) })),
              ];
              const cur = opts.find((o) => String(o.value) === String(params.assignee_id ?? '')) || opts[0];
              return (
                <PlanQSelect
                  size="sm"
                  options={opts}
                  value={cur}
                  onChange={(opt) => {
                    const v = (opt as PlanQSelectOption | null)?.value;
                    set('assignee_id', v ? Number(v) : undefined);
                  }}
                />
              );
            })()}
          </Field>
          {!params.assignee_id && params.assignee_name ? (
            <Warn>{t('qhelper.action.assigneeUnresolved', { name: String(params.assignee_name), defaultValue: `"${String(params.assignee_name)}" 을(를) 못 찾아 본인으로 지정했어요` })}</Warn>
          ) : null}
          <Field>
            <Lbl>{t('qhelper.action.due', '마감')}</Lbl>
            <SingleDateField value={String(params.due_date || '')} onChange={(d) => set('due_date', d || undefined)} size="sm" />
          </Field>
          <ToggleRow onClick={() => setDescOpen((v) => !v)} type="button">
            {descOpen ? '▾' : '▸'} {t('qhelper.action.description', '설명')}
          </ToggleRow>
          {descOpen && (
            <Textarea value={String(params.description || '')} onChange={(e) => set('description', e.target.value)} rows={3} maxLength={5000} />
          )}
        </>
      )}

      {proposal.tool === 'create_event' && (
        <>
          <Field>
            <Lbl>{t('qhelper.action.when', '일시')}</Lbl>
            <ReadVal>{fmtRange(String(params.start_at || ''), String(params.end_at || ''))}</ReadVal>
          </Field>
          <Field>
            <Lbl>{t('qhelper.action.location', '장소')}</Lbl>
            <Input value={String(params.location || '')} onChange={(e) => set('location', e.target.value)} maxLength={300} />
          </Field>
        </>
      )}

      {proposal.tool === 'create_document_draft' && (
        <Field as="div">
          <Lbl>{t('qhelper.action.docKind', '종류')}</Lbl>
          {(() => {
            const opts: PlanQSelectOption[] = DOC_KIND_KEYS.map((k) => ({ value: k, label: t(`qhelper.action.docKind_${k}`, k) }));
            const cur = opts.find((o) => o.value === (params.kind || 'custom')) || null;
            return (
              <PlanQSelect
                size="sm"
                options={opts}
                value={cur}
                onChange={(opt) => set('kind', (opt as PlanQSelectOption | null)?.value || 'custom')}
              />
            );
          })()}
        </Field>
      )}

      {error && <ErrLine>! {error}</ErrLine>}

      <Actions>
        <ActionButton tone="secondary" size="sm" onClick={onDismiss} disabled={submitting}>
          {t('qhelper.action.cancel', '취소')}
        </ActionButton>
        <ActionButton tone="primary" size="sm" onClick={execute} loading={submitting} disabled={!title.trim()}>
          {addLabel}
        </ActionButton>
      </Actions>
    </Card>
  );
};

function fmtRange(startIso: string, endIso: string): string {
  try {
    const s = new Date(startIso), e = new Date(endIso);
    if (isNaN(s.getTime())) return startIso;
    const d = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(s);
    const et = isNaN(e.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(e);
    return et ? `${d} – ${et}` : d;
  } catch { return startIso; }
}

const Card = styled.div`
  margin-top: 8px; border: 1px solid #e2e8f0; border-radius: 12px;
  background: #f8fafc; padding: 12px; max-width: 100%;
  display: flex; flex-direction: column; gap: 8px;
`;
const Hdr = styled.div`font-size: 12px; font-weight: 700; color: #0f766e; letter-spacing: -0.2px;`;
const Field = styled.label`display: flex; flex-direction: column; gap: 3px;`;
const Lbl = styled.span`font-size: 11px; color: #64748b; font-weight: 600;`;
const Input = styled.input`
  border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 9px; font-size: 13px;
  background: #fff; width: 100%; &:focus { outline: none; border-color: #0f766e; }
`;
const Textarea = styled.textarea`
  border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 9px; font-size: 13px;
  background: #fff; width: 100%; resize: vertical; &:focus { outline: none; border-color: #0f766e; }
`;
const ReadVal = styled.div`font-size: 13px; color: #1e293b; padding: 6px 2px;`;
const Warn = styled.div`font-size: 11px; color: #b45309; background: #fffbeb; border-radius: 6px; padding: 5px 8px;`;
const ToggleRow = styled.button`
  border: none; background: none; text-align: left; cursor: pointer; padding: 2px 0;
  font-size: 12px; color: #64748b; font-weight: 600;
`;
const ErrLine = styled.div`font-size: 12px; color: #dc2626; font-weight: 600;`;
const Actions = styled.div`display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px;`;

export default CueActionCard;
