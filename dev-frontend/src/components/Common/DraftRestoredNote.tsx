// 초안 안내 한 줄 — docs/DRAFT_PERSISTENCE_DESIGN.md D-C2 "복원은 보이게"
//   불러왔다(지우기) · 다른 창의 더 새 글로 바뀌었다 · 원문이 바뀌어 버렸다 — 조용히 바뀌면 사용자는 "사라졌다" 로 신고한다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { DraftText } from '../../hooks/useDraftText';

interface Props {
  draft: Pick<DraftText, 'restored' | 'replaced' | 'baseChanged' | 'text' | 'clear' | 'dismissNotice'>;
}

const DraftRestoredNote: React.FC<Props> = ({ draft }) => {
  const { t } = useTranslation('common');
  const showRestored = draft.restored && draft.text.trim().length > 0;
  if (!showRestored && !draft.replaced && !draft.baseChanged) return null;
  const message = draft.baseChanged
    ? t('draft.baseChanged', '다른 곳에서 원문이 바뀌어 임시저장본을 버렸어요')
    : draft.replaced
      ? t('draft.replaced', '다른 창의 더 새 글로 바뀌었어요')
      : t('draft.restored', '임시저장된 내용을 불러왔어요');
  return (
    <Row role="status" data-testid="draft-note">
      <span>{message as string}</span>
      {showRestored && !draft.baseChanged && (
        <LinkBtn type="button" onClick={draft.clear} data-testid="draft-clear">{t('draft.clear', '지우기') as string}</LinkBtn>
      )}
      <LinkBtn type="button" onClick={draft.dismissNotice} aria-label={t('draft.dismiss', '닫기') as string}>×</LinkBtn>
    </Row>
  );
};

export default DraftRestoredNote;

/** 여러 칸(제목·설명)의 초안을 안내 한 줄로 묶는다 — 지우기·닫기는 모두에 (업무 추가·일정 추가 폼, 2026-11-23) */
export function combineDrafts(...ds: Props['draft'][]): Props['draft'] {
  return {
    restored: ds.some((d) => d.restored),
    replaced: ds.some((d) => d.replaced),
    baseChanged: false,
    text: ds.map((d) => d.text).join(''),
    clear: () => ds.forEach((d) => d.clear()),
    dismissNotice: () => ds.forEach((d) => d.dismissNotice()),
  };
}

const Row = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-top: 4px; font-size: 0.6875rem; color: #64748B;
`;
const LinkBtn = styled.button`
  padding: 2px 4px; border: none; background: none; cursor: pointer;
  font-size: 0.6875rem; color: #0F766E; font-weight: 600;
  &:hover { text-decoration: underline; }
  &:focus-visible { outline: 2px solid #99F6E4; outline-offset: 1px; border-radius: 4px; }
`;
