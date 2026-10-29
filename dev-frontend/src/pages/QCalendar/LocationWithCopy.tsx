// 일정 상세의 장소 줄 — 값(입력 칸 또는 글자) 오른쪽에 [복사] (Irene 10-29 «바로 복사하게 상세에 복사버튼»).
//   업무 일정(EventDrawer)·개인 일정(PersonalEventDrawer) 두 곳이 같이 쓴다. 값이 비면 버튼을 숨긴다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useCopy } from '../../components/Knowledge/kbListShell';

interface Props {
  value: string | null | undefined;
  children: React.ReactNode;
}

const LocationWithCopy: React.FC<Props> = ({ value, children }) => {
  const { t } = useTranslation('qcalendar');
  const { copied, copy } = useCopy();
  const text = (value || '').trim();
  return (
    <Row>
      <Grow>{children}</Grow>
      {text && (
        <CopyBtn type="button" data-testid="event-location-copy" onClick={(e) => copy(text, e)}
          aria-label={t('drawer.copyLocation', '복사') as string}>
          {copied ? t('drawer.locationCopied', '복사됨') : t('drawer.copyLocation', '복사')}
        </CopyBtn>
      )}
    </Row>
  );
};

export default LocationWithCopy;

const Row = styled.div` display: flex; align-items: center; gap: 6px; min-width: 0; `;
const Grow = styled.div` flex: 1; min-width: 0; overflow-wrap: anywhere; `;
const CopyBtn = styled.button`
  flex-shrink: 0; display: inline-flex; align-items: center; padding: 6px 10px; border-radius: 6px;
  background: transparent; color: #475569; font-size: 0.75rem; font-weight: 500; font-family: inherit;
  border: 1px solid #CBD5E1; cursor: pointer; white-space: nowrap;
  &:hover { background: #F8FAFC; color: #0F172A; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.3); }
`;
