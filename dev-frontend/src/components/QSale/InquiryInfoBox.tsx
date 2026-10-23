// InquiryInfoBox — 우측 패널 «상담 내용» 탭 맨 위의 **그 문의** 상자 + (메일이면) 메일 이력 전부
//   ClientPanel 이 800줄을 넘어 떼어 냈다(god-file 가드). 모양·문구는 옮기기 전 그대로다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { tabStore } from '../../stores/tabStore';
import InquiryMailHistory from './InquiryMailHistory';
import type { InquiryView } from './ClientPanel';

const InquiryInfoBox: React.FC<{ businessId: number; inquiry: InquiryView }> = ({ businessId, inquiry }) => {
  const { t } = useTranslation('qsale');
  const { formatDateTime } = useTimeFormat();
  return (
    <>
      {/* ── 문의 정보 박스 — 상담/확인 필요에서 열었을 때 **그 건** ──────────
          Irene: *"상담탭에서 열면 해당 내용을 문의정보로 상단에 다른 박스로 표시를 해줘.
          아래 히스토리 중 내용이 위에 클릭한 내용을 보여주는 거지."* */}
      <InquiryBox data-testid="client-panel-inquiry-box">
        <InquiryHead>
          <SectionTitle>{t('panel.inquiry') as string}</SectionTitle>
          <InquiryTags>
            <SourceTag>{t(`inbox.source.${inquiry.source}`, { defaultValue: inquiry.source }) as string}</SourceTag>
            {inquiry.needsReply && <ReplyTag>{t('inbox.needsReply') as string}</ReplyTag>}
          </InquiryTags>
        </InquiryHead>
        {inquiry.title && <InquiryTitle>{inquiry.title}</InquiryTitle>}
        {inquiry.preview && inquiry.ref.kind !== 'email_thread' && <PreviewBox>{inquiry.preview}</PreviewBox>}
        <InquiryMeta>
          {inquiry.email && (
            <span>
              {inquiry.email}
              {inquiry.emailVerified && ` (${t('panel.emailVerified') as string})`}
            </span>
          )}
          {inquiry.at && <span>{formatDateTime(inquiry.at)}</span>}
        </InquiryMeta>
        {/* 9/13 뜻 없는 [보기] 낱말은 뺐고(Irene), #448(10/2) 로 «어디로 들어왔는지» 줄 자체가
            원본(서버 open_path)으로 가는 링크다 — 원본으로 가는 길까지 없애면 결손이다. 새 탭. */}
        {inquiry.openPath ? (
          <InquiryViaLink type="button" data-testid="client-panel-inquiry-via"
            onClick={() => tabStore.openInNewTab(inquiry.openPath)}>
            {t('panel.cameVia', { via: t(`inbox.source.${inquiry.source}`, { defaultValue: inquiry.source }) as string }) as string}
            <span aria-hidden> · </span>
            {(inquiry.source === 'email'
              ? t('panel.openOriginalMail', { defaultValue: '메일에서 보기' })
              : t('panel.openOriginal', { defaultValue: '원본 보기' })) as string}
            <span aria-hidden> →</span>
          </InquiryViaLink>
        ) : (
          <InquiryVia data-testid="client-panel-inquiry-via">
            {t('panel.cameVia', { via: t(`inbox.source.${inquiry.source}`, { defaultValue: inquiry.source }) as string }) as string}
          </InquiryVia>
        )}
      </InquiryBox>
      {inquiry.ref.kind === 'email_thread' && (
        <InquiryMailHistory key={`mail-${inquiry.ref.id}`} businessId={businessId} threadId={inquiry.ref.id} />
      )}
    </>
  );
};

export default InquiryInfoBox;

const SectionTitle = styled.h3`margin: 0; font-size: 0.8125rem; font-weight: 700; color: #475569;`;
/** 문의 정보 — 고객 정보와 **성격이 다른 박스**다. 배경으로 구분해 "이건 지금 누른 그 건" 임을 말한다. */
const InquiryBox = styled.section`
  margin: 0 0 4px; padding: 12px; border-radius: 10px;
  background: #F8FAFC; border: 1px solid #E2E8F0;
  display: flex; flex-direction: column; gap: 8px; align-items: flex-start;
  ${SectionTitle} { margin: 0; }
`;
const InquiryHead = styled.div`display: flex; align-items: center; gap: 8px; width: 100%; flex-wrap: wrap;`;
const InquiryTags = styled.div`display: flex; align-items: center; gap: 6px; margin-left: auto;`;
const SourceTag = styled.span`
  padding: 2px 8px; border-radius: 999px; background: #EEF2FF; color: #4338CA;
  font-size: 0.6875rem; font-weight: 700;
`;
const ReplyTag = styled.span`
  padding: 2px 8px; border-radius: 999px; background: #FFF1F2; color: #BE123C;
  font-size: 0.6875rem; font-weight: 700;
`;
const InquiryTitle = styled.div`font-size: 0.8125rem; font-weight: 600; color: #0F172A; word-break: break-word;`;
const InquiryMeta = styled.div`
  display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 0.75rem; color: #64748B; word-break: break-all;
`;
const PreviewBox = styled.div`
  width: 100%; padding: 10px 12px; background: #FFFFFF; border: 1px solid #F1F5F9;
  border-radius: 8px; font-size: 0.8125rem; color: #334155; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word; max-height: 180px; overflow-y: auto;
`;
/** 문의가 **어디로 들어왔는지** — [보기] 를 뺀 자리를 이것이 대신한다(2026-09-13 Irene) */
const InquiryVia = styled.div`
  font-size: 0.75rem; font-weight: 600; color: #4338CA;
  background: #EEF2FF; border-radius: 999px; padding: 3px 10px; align-self: flex-start;
`;
const InquiryViaLink = styled(InquiryVia).attrs({ as: 'button' })`
  border: none; cursor: pointer; font-family: inherit; text-align: left;
  &:hover { background: #E0E7FF; } &:focus-visible { outline: 2px solid rgba(67,56,202,0.5); outline-offset: 2px; }
`;
