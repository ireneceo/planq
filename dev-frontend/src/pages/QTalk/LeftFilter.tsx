// Q talk 좌측 목록 거르기 — [전체 | 안 읽음 N | 답할 문의 N] (2026-11-12 LeftPanel 에서 뺐다 · docs/QTALK_CARE_DESIGN.md).
//   «답할 문의» 는 직원에게만(고객 화면엔 응대 상태가 안 온다). 라벨 숫자 = 걸렀을 때 행 수 — LeftPanel 이 같은 술어로 센다.
//   폰에서 세 칸이 한 줄에 안 들어가면 줄바꿈하지 않고 가로로 흘린다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';

export type LeftFilterMode = 'all' | 'unread' | 'mine';

interface Props {
  mode: LeftFilterMode;
  onChange: (m: LeftFilterMode) => void;
  unreadCount: number;
  /** null = 이 칸을 그리지 않는다(고객 화면) */
  mineCount: number | null;
}

const LeftFilter: React.FC<Props> = ({ mode, onChange, unreadCount, mineCount }) => {
  const { t } = useTranslation('qtalk');
  return (
    <FilterToggle role="tablist" aria-label={t('left.filterAria', '대화 거르기') as string} data-testid="qtalk-filter">
      <SegmentedBtn type="button" role="tab" aria-selected={mode === 'all'} $active={mode === 'all'} data-testid="qtalk-filter-all" onClick={() => onChange('all')}>
        {t('left.filterAll', '전체')}
      </SegmentedBtn>
      <SegmentedBtn type="button" role="tab" aria-selected={mode === 'unread'} $active={mode === 'unread'} data-testid="qtalk-filter-unread" onClick={() => onChange('unread')}>
        {unreadCount > 0 ? t('left.filterUnreadN', { count: unreadCount, defaultValue: '안 읽음 {{count}}' }) : t('left.filterUnread', '안 읽음')}
      </SegmentedBtn>
      {mineCount !== null && (
        <SegmentedBtn type="button" role="tab" aria-selected={mode === 'mine'} $active={mode === 'mine'} data-testid="qtalk-filter-mine" onClick={() => onChange('mine')}>
          {mineCount > 0 ? t('left.filterMineN', { count: mineCount, defaultValue: '답할 문의 {{count}}' }) : t('left.filterMine', '답할 문의')}
        </SegmentedBtn>
      )}
    </FilterToggle>
  );
};

export default LeftFilter;

const FilterToggle = styled(SegmentedToggle)`
  margin-top: 8px;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;
