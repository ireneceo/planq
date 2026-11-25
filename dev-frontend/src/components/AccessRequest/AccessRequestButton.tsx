// «열람 요청» — 통합 검색·Q file 검색의 잠금 줄이 같이 쓴다(2026-11-25 · docs/FILE_SEARCH_DISCOVERY_DESIGN.md §3).
//   ★ 보내기 칸은 **줄 안에서 펼친다**(별도 창이 아니다) — 통합 검색 창은 폰·태블릿에서 메뉴 위(10070)에 떠서
//     가운데 창을 띄우면 그 뒤로 깔려 안 보였다(실측). 줄 안이면 어느 화면에 얹혀도 같은 자리다.
//   이미 대기 중이면 «요청함», 거절됐으면 «거절됨»(7일 뒤 다시) — 서버 잠금 줄의 request 상태를 그대로 그린다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ActionButton from '../Common/ActionButton';
import { requestAccess, type LockedItem } from '../../services/accessRequests';

export type RequestState = 'pending' | 'denied' | null;

/** 오른쪽 단추·상태 칩. 펼침은 부모(LockedResultRow)가 쥔다 — 펼친 칸은 줄 아래 전체 폭을 쓴다. */
export const AccessRequestTrigger: React.FC<{ status: RequestState; open: boolean; onOpen: () => void }> = ({ status, open, onOpen }) => {
  const { t } = useTranslation('common');
  if (status === 'pending') return <StatusChip data-testid="access-request-pending">{t('accessRequest.requested', '요청함') as string}</StatusChip>;
  if (status === 'denied') return <StatusChip $muted data-testid="access-request-denied">{t('accessRequest.denied', '거절됨') as string}</StatusChip>;
  if (open) return null;
  return (
    <ActionButton tone="secondary" size="xs" data-testid="access-request-open"
      onClick={(e) => { e.stopPropagation(); onOpen(); }}>
      {t('accessRequest.request', '열람 요청') as string}
    </ActionButton>
  );
};

/** 펼친 보내기 칸 — 누구에게 가는지 · 남길 말(선택) · [취소][요청 보내기]. */
export const AccessRequestForm: React.FC<{ businessId: number; item: LockedItem; onCancel: () => void; onSent: () => void }> = ({ businessId, item, onCancel, onSent }) => {
  const { t } = useTranslation('common');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ownerName = item.owner?.name;
  const send = async () => {
    if (sending) return;
    setSending(true); setErr(null);
    try { await requestAccess(businessId, item.kind, item.id, msg.trim() || undefined); onSent(); }
    catch (e) {
      const code = (e as Error).message;
      setErr(t(`accessRequest.err.${['recently_denied', 'daily_limit', 'not_found'].includes(code) ? code : 'generic'}`) as string);
    } finally { setSending(false); }
  };
  return (
    <Form data-testid="access-request-form" onClick={(e) => e.stopPropagation()}>
      <Body>
        {ownerName
          ? t('accessRequest.modalBody', { owner: ownerName, item: item.name })
          : t('accessRequest.modalBodyNoOwner', { item: item.name })}
      </Body>
      {/* draft-exempt: 요청에 붙이는 한두 줄(선택) — 접으면 요청을 안 보낸 것이라 남길 글이 아니다 */}
      <Area aria-label={t('accessRequest.messageLabel', '남길 말 (선택)') as string} data-testid="access-request-msg"
        value={msg} maxLength={300} rows={2}
        placeholder={t('accessRequest.messagePlaceholder') as string}
        onChange={(e) => setMsg(e.target.value)} />
      {err && <Err role="alert">{err}</Err>}
      <Actions>
        <ActionButton tone="secondary" size="xs" onClick={onCancel} disabled={sending}>{t('accessRequest.cancel', '취소') as string}</ActionButton>
        <ActionButton tone="primary" size="xs" loading={sending} data-testid="access-request-send" onClick={send}>
          {t('accessRequest.send', '요청 보내기') as string}
        </ActionButton>
      </Actions>
    </Form>
  );
};

const StatusChip = styled.span<{ $muted?: boolean }>`
  display: inline-flex; align-items: center; height: 32px; padding: 0 10px; border-radius: 999px;
  font-size: 0.75rem; font-weight: 600; white-space: nowrap; flex-shrink: 0;
  background: ${(p) => (p.$muted ? '#F1F5F9' : '#F0FDFA')}; color: ${(p) => (p.$muted ? '#64748B' : '#0F766E')};
`;
const Form = styled.div`
  display: flex; flex-direction: column; gap: 8px; margin: 2px 12px 8px 38px; padding: 10px 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  @media (max-width: 640px) { margin-left: 12px; }
`;
const Body = styled.p` margin: 0; font-size: 0.8125rem; color: #334155; line-height: 1.5; word-break: break-word; `;
const Area = styled.textarea`
  width: 100%; box-sizing: border-box; border: 1px solid #CBD5E1; border-radius: 8px; padding: 8px 10px; background: #fff;
  font-size: 0.875rem; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const Err = styled.div` font-size: 0.8125rem; color: #B91C1C; `;
const Actions = styled.div` display: flex; justify-content: flex-end; gap: 8px; `;
