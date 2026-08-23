// 팝아웃 보기 기준 칩 — #258 "태그별 보기를 디폴트로, 프로젝트별 보기, 마감일별 보기 필터를 클릭하면 바뀌게".
//
// ★ 이건 **보기(나열) 기준**일 뿐 정본 집합을 바꾸지 않는다. 칩을 바꿔도 행 개수는 불변이다
//   (탭 소속 판정은 inTodaySet/week 술어가 단독으로 한다 — memory feedback_display_input_must_not_be_filtered).
// ★ 죽은 컨트롤을 두지 않는다: 태그가 하나도 없는 워크스페이스에는 '태그별' 칩을 내지 않고,
//   프로젝트가 하나도 없으면 '프로젝트별' 칩을 내지 않는다(기존 SortToggle 의 hasAnyTag 원칙 계승).
//
// TaskPopoutView 가 650줄이라 여기로 절출했다(god-file 래칫).
import React from 'react';
import styled from 'styled-components';

export type PopoutView = 'tag' | 'project' | 'due';

const Row = styled.div`
  /* ★ 아래 여백 8px — 이 줄은 목록 스크롤 밖에 고정돼 있다(sticky 처럼). 여백이 0 이면
     목록을 조금만 올려도 첫 행이 칩에 딱 붙어 "고정된 줄" 로 안 읽힌다(Irene 2026-08-23).
     아래 Body(목록)의 padding-top 은 **스크롤과 함께 밀려 올라가므로** 그 몫을 대신하지 못한다. */
  display: flex; gap: 6px; padding: 8px 12px;
  flex-shrink: 0;
  border-bottom: 1px solid #F1F5F9;
`;
const Chip = styled.button<{ $active: boolean }>`
  height: 28px; padding: 0 10px;
  font-size: 12px; font-weight: ${p => (p.$active ? 700 : 600)};
  color: ${p => (p.$active ? '#0F766E' : '#64748B')};
  background: ${p => (p.$active ? '#F0FDFA' : 'transparent')};
  border: 1px solid ${p => (p.$active ? '#99F6E4' : '#E2E8F0')};
  border-radius: 999px; cursor: pointer; font-family: inherit;
  white-space: nowrap;
  &:hover { background: ${p => (p.$active ? '#CCFBF1' : '#F8FAFC')}; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;

export interface PopoutViewChipsProps {
  value: PopoutView;
  onChange: (v: PopoutView) => void;
  /** 이 워크스페이스 응답에 태그가 하나라도 있는가 */
  hasAnyTag: boolean;
  /** 이 워크스페이스 응답에 프로젝트가 하나라도 있는가 */
  hasAnyProject: boolean;
  labels: Record<PopoutView, string>;
  groupLabel: string;
}

const PopoutViewChips: React.FC<PopoutViewChipsProps> = ({
  value, onChange, hasAnyTag, hasAnyProject, labels, groupLabel,
}) => {
  const opts: PopoutView[] = [
    ...(hasAnyTag ? ['tag' as const] : []),
    ...(hasAnyProject ? ['project' as const] : []),
    'due',
  ];
  // 선택지가 'due' 하나뿐이면 고를 것이 없다 — 죽은 컨트롤을 내지 않는다.
  if (opts.length < 2) return null;
  return (
    <Row role="group" aria-label={groupLabel}>
      {opts.map((o) => (
        <Chip
          key={o}
          type="button"
          $active={value === o}
          aria-pressed={value === o}
          data-testid={`task-popout-view-${o}`}
          onClick={() => onChange(o)}
        >{labels[o]}</Chip>
      ))}
    </Row>
  );
};

export default PopoutViewChips;
