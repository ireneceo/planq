// #92 — 정기/구독 청구서의 "정기 발송 기준" 표시.
//   청구서 상세 드로어 + 공개 결제 페이지 공용 (subtle info 톤).
//   "매월 4일 발행 · 다음 발송 2026/7/4" 식으로, 라이브 구독 상태(active/paused/canceled) 반영.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { InvoiceRecurring } from '../../services/invoices';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const ymd = String(iso).slice(0, 10).split('-');
  if (ymd.length === 3 && ymd[0].length === 4) return `${ymd[0]}/${Number(ymd[1])}/${Number(ymd[2])}`;
  return iso;
}

interface Props { recurring?: InvoiceRecurring | null; }

const RecurringBillingNote: React.FC<Props> = ({ recurring }) => {
  const { t } = useTranslation('qbill');
  if (!recurring || !recurring.source) return null;

  const intervalLabel = t(`recurring.interval.${recurring.interval}`, {
    defaultValue: recurring.interval,
  }) as string;

  // 발행 기준 — monthly + 발행일이면 "매월 N일 발행", 아니면 주기 라벨만
  const basis = (recurring.interval === 'monthly' && recurring.billing_day)
    ? t('recurring.basisMonthlyDay', {
        day: recurring.billing_day,
        defaultValue: `매월 ${recurring.billing_day}일 발행`,
      })
    : t('recurring.basis', { interval: intervalLabel, defaultValue: `${intervalLabel} 발행` });

  // 상태별 우측 텍스트
  let statusLine: string;
  if (recurring.active && recurring.next_billing_at) {
    statusLine = t('recurring.next', {
      date: fmtDate(recurring.next_billing_at),
      defaultValue: `다음 발송 ${fmtDate(recurring.next_billing_at)}`,
    });
  } else if (recurring.status === 'paused') {
    statusLine = t('recurring.paused', { defaultValue: '정기 발송 일시중지' });
  } else if (recurring.status === 'canceled' || recurring.status === 'completed') {
    statusLine = t('recurring.ended', { defaultValue: '정기 발송 종료' });
  } else {
    statusLine = '';
  }

  return (
    <Wrap role="note">
      <IconWrap aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </IconWrap>
      <Text>
        <Label>{t('recurring.tag', { defaultValue: '정기 구독 청구' })}</Label>
        <Detail>
          {basis}
          {statusLine && <Sep>·</Sep>}
          {statusLine && <Strong>{statusLine}</Strong>}
        </Detail>
      </Text>
    </Wrap>
  );
};

export default RecurringBillingNote;

const Wrap = styled.div`
  display: flex; align-items: flex-start; gap: 10px;
  margin-top: 12px; padding: 12px 14px;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 12px;
`;
const IconWrap = styled.span`
  color: #0F766E; flex-shrink: 0; margin-top: 1px;
  display: inline-flex;
`;
const Text = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const Label = styled.span`font-size: 12px; font-weight: 700; color: #0F766E;`;
const Detail = styled.span`
  font-size: 13px; font-weight: 500; color: #334155;
  display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px;
`;
const Sep = styled.span`color: #94A3B8;`;
const Strong = styled.span`font-weight: 700; color: #0F172A;`;

export {};
