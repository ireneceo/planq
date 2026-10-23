// InquiryThreadList — 묶인 상담 줄(같은 사람의 메일 여러 건)의 **스레드 목록** + 고른 스레드의 메일 이력 (2026-10-23)
//
// Irene: *"같은 고객인데 메일이 여러 개 있다고 각각 다 리스트업되는게 맞아? … 그룹핑이 되어야 상담 건건이 고객별로 관리가"*
//   목록은 사람 한 줄이 됐다(services/saleMailBundle). 여기서는 그 사람의 스레드를 최신순으로 보이고,
//   하나를 고르면 기존 InquiryMailHistory 가 그 스레드 이력을 그린다(새 라우트 없음 — 스레드별 기존 문).
// ★ 메일을 한 번에 다 펴지 않는다 — 한 주소에 스레드가 수백 건인 워크스페이스가 있다(Fable 실측). 고른 하나만 읽는다.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import InquiryMailHistory from './InquiryMailHistory';
import type { InboxThreadSummary } from '../../services/sale';
import { listRowTitleCss } from '../../theme/tokens';

interface Props { businessId: number; threads: InboxThreadSummary[] }

const InquiryThreadList: React.FC<Props> = ({ businessId, threads }) => {
  const { t } = useTranslation('qsale');
  const { formatTimeAgo, formatDateTime } = useTimeFormat();
  const first = threads[0]?.id ?? null;
  const [sel, setSel] = useState<number | null>(first);
  // 다른 사람으로 넘어가면 그 사람의 최신 스레드로(앞 사람 스레드를 붙들고 있지 않게)
  useEffect(() => { setSel(first); }, [first]);

  return (
    <Wrap data-testid="client-panel-thread-list">
      <Title>{t('panel.mailThreads', { n: threads.length }) as string}</Title>
      <List role="listbox">
        {threads.map((th) => (
          <Item key={th.id} type="button" role="option" aria-selected={sel === th.id} $on={sel === th.id}
            data-testid={`client-panel-thread-${th.id}`} onClick={() => setSel(th.id)}>
            <ItemTitle>{th.title || (t('inbox.noSubject') as string)}</ItemTitle>
            <ItemMeta>
              {th.direction && <Dir $out={th.direction === 'outbound'}>{t(th.direction === 'outbound' ? 'inbox.dirOut' : 'inbox.dirIn') as string}</Dir>}
              {th.needs_reply && <Reply>{t('inbox.needsReply') as string}</Reply>}
              {th.handled && <Done>{t('inbox.handled') as string}</Done>}
              <At title={th.at ? formatDateTime(th.at) : ''}>{th.at ? formatTimeAgo(th.at) : '—'}</At>
            </ItemMeta>
          </Item>
        ))}
      </List>
      {sel != null && <InquiryMailHistory key={`mail-${sel}`} businessId={businessId} threadId={sel} />}
    </Wrap>
  );
};

export default InquiryThreadList;

const Wrap = styled.div`margin-top: 14px; display: flex; flex-direction: column; gap: 8px;`;
const Title = styled.div`font-size: 0.8125rem; font-weight: 700; color: #334155;`;
const List = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const Item = styled.button<{ $on: boolean }>`
  display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; font-family: inherit;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid ${(p) => (p.$on ? '#5EEAD4' : '#E2E8F0')};
  background: ${(p) => (p.$on ? '#F0FDFA' : '#FFFFFF')};
  &:hover { background: ${(p) => (p.$on ? '#F0FDFA' : '#F8FAFC')}; }
`;
const ItemTitle = styled.span`
  ${listRowTitleCss}
  font-weight: 600; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const ItemMeta = styled.span`display: flex; align-items: center; gap: 6px; font-size: 0.6875rem; color: #64748B;`;
const Dir = styled.span<{ $out: boolean }>`
  padding: 1px 6px; border-radius: 4px; font-weight: 600;
  background: ${(p) => (p.$out ? '#EFF6FF' : '#F1F5F9')}; color: ${(p) => (p.$out ? '#1D4ED8' : '#475569')};
`;
const Reply = styled.span`padding: 1px 6px; border-radius: 4px; font-weight: 600; background: #FFF1F2; color: #BE123C;`;
const Done = styled.span`padding: 1px 6px; border-radius: 4px; font-weight: 600; background: #F1F5F9; color: #64748B;`;
const At = styled.span`margin-left: auto;`;
