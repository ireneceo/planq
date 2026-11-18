// Q talk 왼쪽 목록 위 — 검색 + 거르기(전체/안 읽음/답할 문의) 한 칸.
//   LeftPanel 에서 뺐다(2026-11-18 — 폰 «보일 칸 고르기» 로 칸마다 가리게 되면서 LeftPanel 이 800줄을 넘었다).
//   폰에서 둘 다 가리면 칸 자체를 그리지 않는다. 값(검색어·거르기)은 부모가 들고 있어 가려도 그대로다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import SearchBoxCommon from '../../components/Common/SearchBox';
import LeftFilter, { type LeftFilterMode } from './LeftFilter';

interface Props {
  showSearch: boolean;
  showFilter: boolean;
  query: string;
  onQuery: (v: string) => void;
  filterMode: LeftFilterMode;
  onFilterMode: (m: LeftFilterMode) => void;
  unreadCount: number;
  mineCount: number | null;
}

const LeftSearchSection: React.FC<Props> = ({ showSearch, showFilter, query, onQuery, filterMode, onFilterMode, unreadCount, mineCount }) => {
  const { t } = useTranslation('qtalk');
  if (!showSearch && !showFilter) return null;
  return (
    <SearchSection>
      {showSearch && (
        <SearchBoxCommon
          value={query}
          onChange={onQuery}
          placeholder={t('left.searchPlaceholder', '대화·프로젝트 검색') as string}
          shortcutHint="Ctrl+K"
          width="100%"
        />
      )}
      {showFilter && <LeftFilter mode={filterMode} onChange={onFilterMode} unreadCount={unreadCount} mineCount={mineCount} />}
    </SearchSection>
  );
};

const SearchSection = styled.div`
  padding: 12px 20px 8px;
  flex-shrink: 0;
  border-bottom: 1px solid #F1F5F9;
`;

export default LeftSearchSection;
