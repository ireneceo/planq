// 잠금 줄 한 줄 — 자물쇠 · 이름 · «○○ 님이 올림 · 열람 권한 없음» · [열람 요청]. 통합 검색·Q file 검색이 같이 쓴다.
//   누를 곳은 단추뿐이다(줄을 눌러도 아무 데도 가지 않는다 — 열 수 없는 자료다). 보내기 칸은 줄 아래로 펼친다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { AccessRequestTrigger, AccessRequestForm, type RequestState } from './AccessRequestButton';
import HighlightText from '../Common/HighlightText';
import type { LockedItem } from '../../services/accessRequests';

const LockedResultRow: React.FC<{ businessId: number; item: LockedItem; query?: string }> = ({ businessId, item, query = '' }) => {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState<RequestState>(item.request?.status ?? null);
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="locked-row">
      <Row>
        <Lock aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </Lock>
        <Main>
          <Name><Kind>{t(`accessRequest.kind.${item.kind}`) as string}</Kind><HighlightText text={item.name} query={query} /></Name>
          <Sub>{item.owner?.name ? t('accessRequest.lockedSub', { name: item.owner.name }) : t('accessRequest.lockedSubNoName')}</Sub>
        </Main>
        <AccessRequestTrigger status={status} open={open} onOpen={() => setOpen(true)} />
      </Row>
      {open && status == null && (
        <AccessRequestForm businessId={businessId} item={item} onCancel={() => setOpen(false)}
          onSent={() => { setStatus('pending'); setOpen(false); }} />
      )}
    </div>
  );
};

export default LockedResultRow;

const Row = styled.div`
  display: flex; align-items: center; gap: 10px; padding: 8px 12px; min-height: 44px; box-sizing: border-box;
  border-radius: 8px; color: #64748B;
`;
const Lock = styled.svg` flex-shrink: 0; color: #94A3B8; `;
const Main = styled.div` flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; `;
const Name = styled.div`
  font-size: 0.8125rem; color: #475569; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const Kind = styled.span` font-size: 0.6875rem; font-weight: 600; color: #94A3B8; margin-right: 6px; `;
const Sub = styled.div` font-size: 0.75rem; color: #94A3B8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; `;
