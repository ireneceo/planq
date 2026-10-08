// SaleInboxBits — Q sales 상담 목록의 **이유 칩**과 **수동 모드 안내 줄** (#449·#450)
//   SaleInboxList 가 800줄을 넘지 않게 뺐다(god-file 래칫). 목록 한 곳에서만 쓴다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { SaleInboxItem, SaleInboxCounts, LostReason } from '../../services/sale';
import LostReasonModal from './LostReasonModal';

/** #450 — 이 행이 **왜** 상담에 있는가. 서버가 실은 판정(verdict)과 메일 폴더(mail_folder)만 읽는다
 *  (화면이 status·방향으로 다시 계산하지 않는다 — 같은 값의 공식 두 벌 금지). */
export function whyKey(it: SaleInboxItem): string | null {
  if (it.ref.kind !== 'email_thread') return it.meta?.promoted ? 'promoted' : null;
  const v = it.meta?.verdict as string | undefined;
  if (v === 'webform') return 'webform';
  if (v === 'promoted') return 'promoted';
  if (v === 'personal') return 'personal';
  if (v === 'replied') return it.meta?.mail_folder === 'reply_needed' ? 'replied_needs' : 'replied_theirs';
  return null;
}

const WhyTag = styled.span`
  flex-shrink: 0; padding: 1px 6px; border-radius: 4px;
  background: #F1F5F9; color: #475569; font-size: 0.6875rem; font-weight: 600; cursor: default;
`;
const IntakeNote = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 0 0 10px; padding: 8px 10px; border-radius: 8px;
  background: #F0FDFA; border: 1px solid #CCFBF1; color: #115E59; font-size: 0.8125rem; line-height: 1.4;
  & > span { flex: 1 1 220px; min-width: 0; }
`;
const IntakeNoteLink = styled.button`
  border: none; background: none; padding: 4px 0; color: #0F766E; font-weight: 600; font-size: 0.8125rem; cursor: pointer;
  &:hover { text-decoration: underline; }
`;
const IntakeNoteX = styled.button`
  width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; border-radius: 6px; color: #64748B; cursor: pointer;
  &:hover { background: #CCFBF1; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;

/** 행 칩 — 이 행이 **왜** 상담에 있는가(메일함 «내 차례» 축과 상담 «관계» 축의 차이를 말한다). */
export const InboxWhyTag: React.FC<{ it: SaleInboxItem }> = ({ it }) => {
  const { t } = useTranslation('qsale');
  const k = whyKey(it);
  if (!k) return null;
  return (
    <WhyTag data-testid={`sale-inbox-why-${it.id}`} title={t(`inbox.whyHint.${k}`, { defaultValue: '' }) as string}>
      {t(`inbox.why.${k}`) as string}
    </WhyTag>
  );
};

/** 수동 모드인데 자동 기준에 드는 메일이 있으면 «어디서 보는지» 를 한 줄로(닫으면 이 기기에서 안 띄운다).
 *  이 줄이 없으면 모드가 바뀐 순간 목록이 줄어든 것이 «사라졌다» 로 읽힌다. 브라우저 저장은 편의일 뿐이다. */
export const IntakeNoteLine: React.FC<{ businessId: number; counts: SaleInboxCounts; onOpenMail: () => void }> = ({ businessId, counts, onOpenMail }) => {
  const { t } = useTranslation('qsale');
  const key = `pq:sale-intake-note:${businessId}`;
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return window.localStorage.getItem(key) === '1'; } catch { return false; }
  });
  if (hidden || counts.intake_mode !== 'manual' || !(counts.auto_candidates && counts.auto_candidates > 0)) return null;
  const hide = () => {
    setHidden(true);
    try { window.localStorage.setItem(key, '1'); } catch { /* 저장 못 해도 이번 화면에서는 닫힌다 */ }
  };
  return (
    <IntakeNote data-testid="sale-inbox-intake-note" role="status">
      <span>{t('inbox.switchedManual', { n: counts.auto_candidates }) as string}</span>
      <IntakeNoteLink type="button" onClick={onOpenMail}>{t('inbox.openInMail') as string}</IntakeNoteLink>
      <IntakeNoteX type="button" aria-label={t('inbox.dismissNote') as string} title={t('inbox.dismissNote') as string} onClick={hide}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
      </IntakeNoteX>
    </IntakeNote>
  );
};

/** 목록에서 «불발» 을 고르면 사유를 받는다 — 상세·우측 패널과 **같은** LostReasonModal(2026-10-08 0-J).
 *  서버는 사유 없는 불발을 400(lost_reason_required)으로 막으므로, 옛 목록 칩은 언제나 «저장 실패» 였다. */
export function LostAskModal({ item, businessId, onClose, onConfirm }: {
  item: SaleInboxItem | null; businessId: number; onClose: () => void;
  onConfirm: (it: SaleInboxItem, extra: { lost_reason: LostReason; lost_note: string }) => Promise<void>;
}) {
  return (
    <LostReasonModal open={!!item} businessId={businessId}
      clientId={item?.client_id || (item?.ref.kind === 'client' ? item.ref.id : 0)}
      onClose={onClose}
      onConfirm={async (reason, note) => { const it = item; onClose(); if (it) await onConfirm(it, { lost_reason: reason, lost_note: note }); }} />
  );
}
