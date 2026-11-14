// 폼 초안 복원 줄 — 여러 칸을 한꺼번에 임시저장하는 폼(메일 계정 등록·새 프로젝트 등)이 다시 열릴 때 «불러왔다» 를 말한다.
//   한 칸짜리 글(댓글·사유)은 DraftRestoredNote(useDraftText) 가 정본이다 — 이것은 useLocalDraft 로 폼 전체를 남기는 곳의 것.
//   모양은 메일 작성창 «임시저장된 메일을 불러왔어요» 줄(MailPage.styles RestoredDraftNote)과 같다. 토스트·팝업 금지.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { formatDayTime } from '../../utils/dateFormat';

interface Props {
  savedAt: number;
  /** 남기지 않은 칸 안내 등 한 줄 더 (예: «비밀번호는 저장하지 않아요») */
  hint?: string;
  onDiscard: () => void;
  testId?: string;
}

const FormDraftNote: React.FC<Props> = ({ savedAt, hint, onDiscard, testId = 'form-draft-restored' }) => {
  const { t } = useTranslation('common');
  return (
    <Row role="status" data-testid={testId}>
      <span>
        {t('draft.formRestoredAt', { time: formatDayTime(new Date(savedAt)), defaultValue: '입력하던 내용을 불러왔어요 · {{time}} 임시저장' }) as string}
        {hint && <Sub>{hint}</Sub>}
      </span>
      <Discard type="button" data-testid={`${testId}-discard`} onClick={onDiscard}>
        {t('draft.formDiscard', '지우고 처음부터') as string}
      </Discard>
    </Row>
  );
};

export default FormDraftNote;

const Row = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  padding: 8px 12px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.75rem; line-height: 1.5; color: #475569;
`;
const Sub = styled.span`display: block; color: #64748B; font-weight: 500;`;
const Discard = styled.button`
  border: none; background: none; padding: 4px 2px; min-height: 32px; cursor: pointer;
  font-size: 0.75rem; font-weight: 600; color: #0F766E; white-space: nowrap;
  &:hover { text-decoration: underline; }
  &:focus-visible { outline: 2px solid #99F6E4; outline-offset: 1px; border-radius: 4px; }
`;
