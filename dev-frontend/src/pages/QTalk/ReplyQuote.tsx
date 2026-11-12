// 답장(인용) — 말풍선 위 원문 한 줄 · 입력창 위 «…에게 답장» 띠 · 도구줄 아이콘 (2026-11-12, 채널톡 쓰는 고객사 점검)
// 원문은 **지금 화면에 보이는 메시지 목록에서만** 찾는다 — 서버가 원문을 따로 싣지 않으므로
// 고객에게 안 보이는 내부 메시지·지운 메시지가 인용으로 새지 않는다(못 찾으면 «원문을 볼 수 없어요»).
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { MockMessage } from './types';

type Tr = (k: string, o?: Record<string, unknown>) => string;

export function replySnippet(m: MockMessage | undefined, t: Tr): string {
  if (!m) return t('reply.unavailable', { defaultValue: '원문을 볼 수 없어요' });
  if (m.is_deleted) return t('chat.deleted', { defaultValue: '삭제된 메시지입니다' });
  const body = (m.body || '').replace(/\s+/g, ' ').trim();
  if (body) return body.length > 80 ? `${body.slice(0, 80)}…` : body;
  if ((m.attachments || []).length > 0) return t('reply.attachment', { defaultValue: '첨부 파일' });
  return '';
}

const ReplyIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" />
  </svg>
);
export { ReplyIcon };

// 말풍선 위 원문 한 줄 — 누르면 원문으로 이동
export const ReplyQuote: React.FC<{
  target: MockMessage | undefined;
  onJump: (id: number) => void;
}> = ({ target, onJump }) => {
  const { t } = useTranslation('qtalk');
  const tr = t as unknown as Tr;
  const canJump = !!target && !target.is_deleted;
  return (
    <QuoteBox
      type="button"
      data-testid="chat-reply-quote"
      disabled={!canJump}
      onClick={(e) => { e.stopPropagation(); if (canJump) onJump(target!.id); }}
      title={canJump ? t('reply.jump', { defaultValue: '원문으로 이동' }) as string : undefined}
    >
      {target && <QuoteName>{target.sender_name}</QuoteName>}
      <QuoteText>{replySnippet(target, tr)}</QuoteText>
    </QuoteBox>
  );
};

// 입력창 위 «OO 님에게 답장» 띠 — ✕ 로 취소
export const ReplyComposerBand: React.FC<{
  target: MockMessage;
  onCancel: () => void;
}> = ({ target, onCancel }) => {
  const { t } = useTranslation('qtalk');
  const tr = t as unknown as Tr;
  return (
    <Band role="status" data-testid="chat-reply-band">
      <BandIcon><ReplyIcon size={13} /></BandIcon>
      <BandBody>
        <BandTitle>{t('reply.to', { name: target.sender_name, defaultValue: '{{name}} 님에게 답장' })}</BandTitle>
        <BandText>{replySnippet(target, tr)}</BandText>
      </BandBody>
      <BandClose
        type="button"
        data-testid="chat-reply-cancel"
        onClick={onCancel}
        aria-label={t('reply.cancel', { defaultValue: '답장 취소' }) as string}
        title={t('reply.cancel', { defaultValue: '답장 취소' }) as string}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </BandClose>
    </Band>
  );
};

const QuoteBox = styled.button`
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  max-width: 100%; min-width: 0;
  margin: 2px 0 4px; padding: 4px 10px;
  border: none; border-left: 3px solid #CBD5E1; border-radius: 4px;
  background: #F8FAFC; text-align: left; font: inherit; cursor: pointer;
  &:hover:not(:disabled) { background: #F1F5F9; border-left-color: #14B8A6; }
  &:disabled { cursor: default; }
`;
const QuoteName = styled.span`
  font-size: 0.75rem; font-weight: 600; color: #475569;
`;
const QuoteText = styled.span`
  font-size: 0.75rem; color: #64748B; line-height: 1.4;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const Band = styled.div`
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 6px; padding: 6px 6px 6px 10px;
  border-left: 3px solid #14B8A6; border-radius: 6px;
  background: #F0FDFA; min-width: 0;
`;
const BandIcon = styled.span`
  display: inline-flex; color: #0D9488; flex-shrink: 0;
`;
const BandBody = styled.div`
  display: flex; flex-direction: column; min-width: 0; flex: 1;
`;
const BandTitle = styled.span`
  font-size: 0.75rem; font-weight: 600; color: #0F766E;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const BandText = styled.span`
  font-size: 0.75rem; color: #475569;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const BandClose = styled.button`
  flex-shrink: 0; width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: #64748B; border-radius: 6px; cursor: pointer;
  &:hover { background: #CCFBF1; color: #0F766E; }
`;
