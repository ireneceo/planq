// 업무 댓글 앞 «어떤 상황에 남긴 글인가» 꼬리표 — 확인 요청 · 승인 · 수정 요청.
// Irene 2026-10-21: "확인요청이나 승인, 수정요청하면서 남겨지는 댓글에는 그 앞에 아이콘 표시 … 어떤 상황에 입력한 건지 알면"
// 판정은 서버 한 곳(dev-backend/services/taskCommentContext.js)이 `context` 로 싣는다 — 화면은 그리기만.
// 색은 같은 단계의 업무 상태 색(STATUS_COLOR)을 그대로 쓴다: 확인 요청=컨펌중 · 수정 요청=수정요청 · 승인=승인완료.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { STATUS_COLOR } from '../../utils/taskLabel';

export type CommentContext = 'submit' | 'approve' | 'revision';

const TONE: Record<CommentContext, { bg: string; fg: string }> = {
  submit: STATUS_COLOR.reviewing,
  revision: STATUS_COLOR.revision_requested,
  approve: STATUS_COLOR.done_feedback,
};

const Icon: React.FC<{ ctx: CommentContext }> = ({ ctx }) => {
  const common = { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (ctx === 'submit') return <svg {...common}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></svg>;
  if (ctx === 'approve') return <svg {...common}><path d="M20 6 9 17l-5-5" /></svg>;
  return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>;
};

const CommentContextTag: React.FC<{ context?: string | null }> = ({ context }) => {
  const { t } = useTranslation('qtask');
  if (context !== 'submit' && context !== 'approve' && context !== 'revision') return null;
  return (
    <Tag $bg={TONE[context].bg} $fg={TONE[context].fg} data-testid={`task-comment-context-${context}`}>
      <Icon ctx={context} />
      {t(`commentContext.${context}`, { defaultValue: context === 'submit' ? '확인 요청' : context === 'approve' ? '승인' : '수정 요청' }) as string}
    </Tag>
  );
};

export default CommentContextTag;

const Tag = styled.span<{ $bg: string; $fg: string }>`
  display:inline-flex;align-items:center;gap:3px;vertical-align:1px;
  margin-right:6px;padding:1px 6px;border-radius:999px;
  font-size:0.6875rem;font-weight:600;line-height:1.4;white-space:nowrap;
  background:${(p) => p.$bg};color:${(p) => p.$fg};
`;
