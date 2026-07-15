// 공유 업무 후보 카드 (사이클 N+88 통일) — Q Talk · Q mail · Q Note 공통.
//   기존 QTalk/CandidateEditCard 를 일반화: 타입 generic + i18n 'common' ns. 페이지는 API 만 wiring.
//   30년차 원칙: LLM 추출은 hint, 등록 직전 제목·담당·마감 인라인 편집. 담당≠본인 → "요청", 본인/미정 → "등록".
import React, { useState, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect from './PlanQSelect';
import CalendarPicker from './CalendarPicker';

export interface CandidateData {
  id: number;
  title: string;
  description?: string | null;
  guessed_assignee?: { user_id: number; name: string } | null;
  guessed_due_date?: string | null;
  similar_task_id?: number | null;
}
export interface CandidateMember { user_id: number; name: string }
export interface RegisterOverrides {
  title: string;
  assignee_id: number | null;
  start_date: string | null;
  due_date: string | null;
}
interface Props {
  candidate: CandidateData;
  members: CandidateMember[];
  myUserId?: number;
  onRegister: (id: number, overrides: RegisterOverrides) => void;
  onMerge?: (id: number) => void;
  onReject: (id: number) => void;
  busy?: boolean; // 부모가 제출 중 표시
}

const NO_ASSIGNEE = 0;

const TaskCandidateCard: React.FC<Props> = ({ candidate, members, myUserId, onRegister, onMerge, onReject, busy }) => {
  const { t } = useTranslation('common');
  const [title, setTitle] = useState<string>(candidate.title || '');
  const [assigneeId, setAssigneeId] = useState<number | null>(candidate.guessed_assignee?.user_id ?? null);
  const [startDate, setStartDate] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>(candidate.guessed_due_date || '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const dateAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const assigneeOptions = useMemo(() => {
    const opts: { value: number; label: string }[] = [{ value: NO_ASSIGNEE, label: t('candidate.noAssignee', { defaultValue: '담당 미정' }) as string }];
    members.forEach((m) => opts.push({ value: m.user_id, label: m.name }));
    // #90 — standalone 대화는 members 가 비어있어도 자동추출이 담당자를 해석할 수 있음.
    //   guessed_assignee 가 members 에 없으면 옵션에 보강해 화면 표시·등록 가능하게.
    const ga = candidate.guessed_assignee;
    if (ga && ga.user_id && !opts.some((o) => o.value === ga.user_id)) {
      opts.push({ value: ga.user_id, label: ga.name });
    }
    return opts;
  }, [members, t, candidate.guessed_assignee]);
  const selectedAssignee = useMemo(
    () => assigneeOptions.find((o) => o.value === (assigneeId ?? NO_ASSIGNEE)) || assigneeOptions[0],
    [assigneeOptions, assigneeId],
  );

  const buttonMode: 'register' | 'request' = (assigneeId !== null && myUserId != null && assigneeId !== myUserId) ? 'request' : 'register';
  const disabled = submitting || !!busy || !title.trim();

  const handleSubmit = () => {
    if (disabled) return;
    setSubmitting(true);
    try {
      onRegister(candidate.id, { title: title.trim(), assignee_id: assigneeId, start_date: startDate || null, due_date: dueDate || null });
    } finally { setSubmitting(false); }
  };

  const periodLabel = (() => {
    const fmt = (s: string) => s.length >= 10 ? `${s.slice(5, 7)}/${s.slice(8, 10)}` : '';
    if (!startDate && !dueDate) return '';
    if (startDate && dueDate && startDate !== dueDate) return `${fmt(startDate)} ~ ${fmt(dueDate)}`;
    return fmt(dueDate || startDate);
  })();

  return (
    <Card>
      <TitleInput value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder={t('candidate.titlePlaceholder', { defaultValue: '업무 제목' }) as string} spellCheck={false} />
      {candidate.description && <Desc>{candidate.description}</Desc>}

      <MetaRow>
        <MetaCol>
          <MetaLabel>{t('candidate.assignee', { defaultValue: '담당' }) as string}</MetaLabel>
          <PlanQSelect size="sm" value={selectedAssignee}
            onChange={(v) => { const next = (v as { value: number })?.value; setAssigneeId(next === NO_ASSIGNEE || next === undefined ? null : next); }}
            options={assigneeOptions} />
        </MetaCol>
        <MetaCol>
          <MetaLabel>{t('candidate.period', { defaultValue: '기간' }) as string}</MetaLabel>
          <DateTrigger ref={dateAnchorRef} type="button" onClick={() => setPickerOpen(true)} $empty={!periodLabel}>
            {periodLabel || (t('candidate.datePlaceholder', { defaultValue: '날짜 선택' }) as string)}
          </DateTrigger>
          {pickerOpen && (
            <CalendarPicker isOpen anchorRef={dateAnchorRef} startDate={startDate || dueDate} endDate={dueDate || startDate}
              onRangeSelect={(s, e) => { setStartDate(s || ''); setDueDate(e || ''); }} onClose={() => setPickerOpen(false)} />
          )}
        </MetaCol>
      </MetaRow>

      {candidate.similar_task_id && (
        <SimilarWarning>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {t('candidate.similar', { defaultValue: '유사 업무 발견' }) as string}
        </SimilarWarning>
      )}

      <Actions>
        <PrimaryBtn type="button" onClick={handleSubmit} disabled={disabled}>
          {buttonMode === 'request' ? t('candidate.request', { defaultValue: '요청' }) as string : t('candidate.register', { defaultValue: '등록' }) as string}
        </PrimaryBtn>
        {candidate.similar_task_id && onMerge && (
          <SecondaryBtn type="button" onClick={() => onMerge(candidate.id)}>{t('candidate.merge', { defaultValue: '내용 추가' }) as string}</SecondaryBtn>
        )}
        <GhostBtn type="button" onClick={() => onReject(candidate.id)} title={t('candidate.rejectHint', { defaultValue: '이 후보를 모두에게서 제거합니다 (개인 거절 아님)' }) as string}>{t('candidate.reject', { defaultValue: '삭제' }) as string}</GhostBtn>
      </Actions>
    </Card>
  );
};

export default TaskCandidateCard;

const Card = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px;
  padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;
  & + & { margin-top: 10px; }
`;
const TitleInput = styled.input`
  font-size: 14px; font-weight: 600; color: #0F172A;
  border: 1px solid transparent; border-radius: 6px; padding: 6px 0; margin: 0;
  background: transparent; width: 100%;
  &:hover { background: #F8FAFC; padding: 6px 8px; margin: 0 -8px; }
  &:focus { outline: none; border-color: #14B8A6; background: #FFF; padding: 6px 8px; margin: 0 -8px; }
`;
const Desc = styled.div`font-size: 12px; color: #64748B; line-height: 1.5; white-space: pre-wrap; word-break: break-word; padding: 0; margin: -4px 0 0;`;
const MetaRow = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 8px;`;
const MetaCol = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const MetaLabel = styled.label`font-size: 10px; font-weight: 600; color: #94A3B8;`;
const DateTrigger = styled.button<{ $empty?: boolean }>`
  height: 36px; padding: 0 12px; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; font-family: inherit; font-weight: 500;
  color: ${(p) => (p.$empty ? '#94A3B8' : '#0F172A')}; background: #FFF; cursor: pointer;
  text-align: left; display: flex; align-items: center; transition: border-color 0.15s;
  &:hover { border-color: #CBD5E1; } &:focus { outline: none; border-color: #14B8A6; }
`;
const SimilarWarning = styled.div`
  display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600;
  color: #92400E; background: #FEF3C7; border-radius: 6px; padding: 3px 8px; width: fit-content;
`;
const Actions = styled.div`display: flex; gap: 6px; flex-wrap: wrap;`;
const PrimaryBtn = styled.button`
  padding: 6px 14px; background: #14B8A6; color: #FFFFFF; border: none; border-radius: 6px;
  font-size: 12px; font-weight: 700; cursor: pointer; transition: background 0.15s;
  &:hover:not(:disabled) { background: #0D9488; } &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 6px 14px; background: #FFFFFF; color: #475569; border: 1px solid #CBD5E1; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer; &:hover { background: #F8FAFC; }
`;
const GhostBtn = styled.button`
  padding: 6px 14px; background: transparent; color: #94A3B8; border: none; border-radius: 6px;
  font-size: 12px; font-weight: 500; cursor: pointer; &:hover { color: #EF4444; }
`;
