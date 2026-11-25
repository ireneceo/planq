// «메일 첨부도 검색» 체크 — 통합 검색과 Q file 검색이 같이 쓴다(2026-11-25, Irene «메일파일까지 검색하기 체크필터» · Fable 설계 A).
//   기본은 꺼짐: 메일로 들어온 첨부(서명·아이콘·뉴스레터 배너 포함 수천 건)는 검색 결과에서 뺀다.
//   켜도 서명·아이콘(20KB 미만 이미지)은 서버가 뺀다(services/mailAttachmentFiles). 메일을 못 보는 사람에게는 이 칸이 없다 — 부르는 쪽이 가린다.
// autosave-exempt: 저장하지 않는 검색 조건(화면 상태)이다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}

const IncludeMailToggle: React.FC<Props> = ({ checked, onChange, testId }) => {
  const { t } = useTranslation('common');
  return (
    <Label data-testid={testId}>
      <Box type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{t('search.includeMailFiles', '메일 첨부도 검색') as string}</span>
    </Label>
  );
};

export default IncludeMailToggle;

const Label = styled.label`
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 32px; padding: 0 4px;
  font-size: 0.75rem; color: #475569; cursor: pointer; user-select: none; white-space: nowrap;
  @media (max-width: 640px) { min-height: 40px; }
`;
const Box = styled.input`
  width: 16px; height: 16px; margin: 0; accent-color: #14B8A6; cursor: pointer; flex-shrink: 0;
`;
