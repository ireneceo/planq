// Q note 질문 카드 — AI 가 정리한 질문 표시 조각 (2026-11-11 · Fable 설계 DESIGN-FIX ⑤)
//   녹취(들린 그대로)는 그대로 두고, 질문 카드에는 «AI가 정리한 질문» 을 보인다. 답은 그 문장으로 찾았다.
//   - status ok      : 카드 본문 = 정리문 · 아래 작은 줄 «들린 그대로: …»
//   - status unclear : 카드 본문 = 들린 그대로 · 아래 «질문이 또렷하지 않아요 — 눌러 고쳐서 다시 찾기»
//   - status same / 없음 : 지금처럼(라벨 없음)
//   카드의 질문 글자를 누르면 고칠 수 있고(기존 편집), 고친 문장으로 다시 찾는다(edited).
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { QNoteQuestionInterpretation } from '../../services/qnote';

export type QuestionInterp = Pick<QNoteQuestionInterpretation, 'interpret_status' | 'incomplete'> & {
  interpreted: string | null;
};

/** 카드에 보일 질문 문장 — 정리문(ok) 아니면 들린 그대로. */
export function displayQuestion(original: string, qi?: QuestionInterp): string {
  if (qi?.interpret_status === 'ok' && qi.interpreted) return qi.interpreted;
  return original;
}

export function interpFromDetail(list?: QNoteQuestionInterpretation[]): Record<number, QuestionInterp> {
  const out: Record<number, QuestionInterp> = {};
  (list || []).forEach((q) => {
    if (!q.utterance_id) return;   // 고친 질문(question_edited)은 화면의 편집 상태가 따로 갖는다 — 정리문은 되돌리기용으로 남긴다
    out[q.utterance_id] = { interpreted: q.question_interpreted, interpret_status: q.interpret_status, incomplete: !!q.incomplete };
  });
  return out;
}

export const QuestionInterpLine: React.FC<{ original: string; qi?: QuestionInterp }> = ({ original, qi }) => {
  const { t } = useTranslation('qnote');
  if (!qi) return null;
  if (qi.interpret_status === 'ok' && qi.interpreted && qi.interpreted !== original) {
    return (
      <Line data-testid="qnote-question-heard">
        <Tag>{t('page.question.aiRefined', 'AI가 정리한 질문')}</Tag>
        <Heard title={original}>{t('page.question.heardAs', '들린 그대로')}: {original}</Heard>
      </Line>
    );
  }
  if (qi.interpret_status === 'unclear') {
    return (
      <Line data-testid="qnote-question-unclear">
        <Unclear>{qi.incomplete
          ? t('page.question.incomplete', '질문이 불완전해요 — 눌러서 고치면 답을 찾아요')
          : t('page.question.unclear', '질문이 또렷하지 않아요 — 눌러서 고쳐 다시 찾기')}</Unclear>
      </Line>
    );
  }
  return null;
};

const Line = styled.div`
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  margin-top: 2px;
`;

const Tag = styled.span`
  flex-shrink: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  color: #0d9488;
`;

const Heard = styled.span`
  min-width: 0;
  font-size: 0.75rem;
  color: #94a3b8;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
`;

const Unclear = styled.span`
  font-size: 0.75rem;
  color: #b45309;
  line-height: 1.45;
`;
