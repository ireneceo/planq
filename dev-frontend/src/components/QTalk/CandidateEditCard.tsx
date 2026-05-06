// 업무 후보 카드 — 우측 패널.
//
// 30년차 시각:
//   - LLM 추출 결과는 hint 일 뿐. 사용자가 등록 직전에 제목·담당자·마감을 인라인 편집.
//   - 담당자 ≠ 본인 → "요청" 버튼 (요청자=본인, 담당자=그 사람). 담당자 = 본인 또는 미정 → "등록".
//   - 담당자 변경 즉시 button 라벨 갱신.
//   - 마감일 비워두기 허용 (LLM 자동 추측 금지 정책과 일관).
//   - 제목에 "[   ]" placeholder 가 있으면 사용자가 채울 수 있게 input 으로 노출.
import React, { useState, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../Common/PlanQSelect';
import type { MockTaskCandidate, MockMember } from '../../pages/QTalk/types';
import type { RegisterCandidateOverrides } from '../../services/qtalk';

interface Props {
  candidate: MockTaskCandidate;
  members: MockMember[];      // 프로젝트 멤버 목록 (담당자 선택용). standalone 이면 빈 배열.
  myUserId: number;
  onRegister: (id: number, overrides: RegisterCandidateOverrides) => void;
  onMerge?: (id: number) => void;
  onReject: (id: number) => void;
}

const CandidateEditCard: React.FC<Props> = ({
  candidate, members, myUserId, onRegister, onMerge, onReject,
}) => {
  const { t } = useTranslation('qtalk');

  // 인라인 편집 state — LLM 추측값으로 초기화
  const [title, setTitle] = useState<string>(candidate.title || '');
  const [description] = useState<string>(candidate.description || '');
  const [assigneeId, setAssigneeId] = useState<number | null>(
    candidate.guessed_assignee?.user_id ?? null
  );
  const [dueDate, setDueDate] = useState<string>(candidate.guessed_due_date || '');
  const [submitting, setSubmitting] = useState(false);

  // 담당자 옵션 — sentinel value 0 = "담당 미정" (PlanQSelectOption 이 null 미허용)
  const NO_ASSIGNEE = 0;
  const assigneeOptions = useMemo(() => {
    const opts: { value: number; label: string }[] = [
      { value: NO_ASSIGNEE, label: t('right.candidates.noAssignee', '담당 미정') as string },
    ];
    members.forEach((m) => {
      opts.push({ value: m.user_id, label: m.name });
    });
    return opts;
  }, [members, t]);

  const selectedAssignee = useMemo(
    () => assigneeOptions.find((o) => o.value === (assigneeId ?? NO_ASSIGNEE)) || assigneeOptions[0],
    [assigneeOptions, assigneeId]
  );

  // 버튼 라벨 분기:
  //   본인 담당 OR 담당 미정 → "등록" (본인 업무로, 모호하면 등록자 본인 default)
  //   타인 담당 → "요청" (담당자에게 task notify 자동 발송)
  const buttonMode: 'register' | 'request' =
    assigneeId !== null && assigneeId !== myUserId ? 'request' : 'register';

  const handleSubmit = async () => {
    if (submitting) return;
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      onRegister(candidate.id, {
        title: title.trim(),
        assignee_id: assigneeId,
        due_date: dueDate || null,
      });
    } finally {
      // 부모가 후보를 제거하므로 재set 불필요. 안전핀.
      setSubmitting(false);
    }
  };

  return (
    <Card>
      {/* 제목 — input 으로 인라인 편집. "[   ]" placeholder 자연스럽게 채움 */}
      <TitleInput
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('right.candidates.titlePlaceholder', '업무 제목') as string}
        spellCheck={false}
      />
      {description && <Desc>{description}</Desc>}

      <MetaRow>
        <MetaCol>
          <MetaLabel>{t('right.candidates.metaAssignee', '담당')}</MetaLabel>
          <PlanQSelect
            size="sm"
            value={selectedAssignee}
            onChange={(v) => {
              const next = (v as { value: number })?.value;
              setAssigneeId(next === NO_ASSIGNEE || next === undefined ? null : next);
            }}
            options={assigneeOptions}
          />
        </MetaCol>
        <MetaCol>
          <MetaLabel>{t('right.candidates.metaDue', '마감')}</MetaLabel>
          <DateInput
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </MetaCol>
      </MetaRow>

      {candidate.similar_task_id && (
        <SimilarWarning>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {t('right.candidates.similar', '유사 업무 발견')}
        </SimilarWarning>
      )}

      <Actions>
        <PrimaryBtn type="button" onClick={handleSubmit} disabled={submitting || !title.trim()}>
          {buttonMode === 'request'
            ? t('right.candidates.request', '요청')
            : t('right.candidates.register', '등록')}
        </PrimaryBtn>
        {candidate.similar_task_id && onMerge && (
          <SecondaryBtn type="button" onClick={() => onMerge(candidate.id)}>
            {t('right.candidates.merge', '내용 추가')}
          </SecondaryBtn>
        )}
        <GhostBtn type="button" onClick={() => onReject(candidate.id)}>
          {t('right.candidates.reject', '거절')}
        </GhostBtn>
      </Actions>
    </Card>
  );
};

export default CandidateEditCard;

// ─── styled ───
const Card = styled.div`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;
const TitleInput = styled.input`
  font-size: 13px;
  font-weight: 600;
  color: #0F172A;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 6px 8px;
  background: transparent;
  &:hover { background: #F8FAFC; }
  &:focus { outline: none; border-color: #14B8A6; background: #FFF; }
`;
const Desc = styled.div`
  font-size: 12px;
  color: #475569;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 0 8px;
`;
const MetaRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
`;
const MetaCol = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;
const MetaLabel = styled.label`
  font-size: 10px;
  font-weight: 600;
  color: #94A3B8;
`;
const DateInput = styled.input`
  padding: 6px 8px;
  border: 1px solid #E2E8F0;
  border-radius: 6px;
  font-size: 12px;
  color: #0F172A;
  background: #FFF;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const SimilarWarning = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #92400E;
  background: #FEF3C7;
  border-radius: 6px;
  padding: 3px 8px;
  width: fit-content;
`;
const Actions = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`;
const PrimaryBtn = styled.button`
  padding: 6px 14px;
  background: #14B8A6;
  color: #FFFFFF;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 6px 14px;
  background: #FFFFFF;
  color: #475569;
  border: 1px solid #CBD5E1;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
const GhostBtn = styled.button`
  padding: 6px 14px;
  background: transparent;
  color: #94A3B8;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  &:hover { color: #EF4444; }
`;
