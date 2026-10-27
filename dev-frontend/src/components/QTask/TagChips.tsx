// TagChips — 업무 태그 칩 (#250 ③청크). 메인 리스트(QTaskPage)와 팝아웃(TaskPopoutView) **공용**.
//
//   두 화면이 각자 칩을 그리면 색·크기·넘침 규칙이 갈리고, 두 파일 모두 래칫 한도
//   (QTaskPage 3,4xx줄 / TaskPopoutView 7xx줄, 컴포넌트 한도 800) 에 가까워 인라인 확장이 위험하다.
//
//   ★ 대표 태그 = **사전순 최소** = 배열 첫 원소. 백엔드 attachTagsTo() 가 이름순으로 정렬해 보낸다
//     — 프론트가 다시 정렬하지 않는다(두 곳에서 정렬하면 규칙이 갈린다).
//   ★ 팝아웃은 폭 520px 라 `max={1}` 로 대표 1칩 + `+k` 만. 행이 한 줄을 넘기면 안 된다.
import React from 'react';
import styled from 'styled-components';

export interface TaskTagLite {
  id: number;
  name: string;
  color?: string | null;
}

interface Props {
  tags?: TaskTagLite[] | null;
  /** 표시할 최대 칩 수. 초과분은 `+k` 하나로 접는다. 팝아웃 1 / 메인 3 */
  max?: number;
  /** 접힌 개수 툴팁용 — 나머지 태그 이름을 title 에 넣는다 */
  className?: string;
}

const DEFAULT_COLOR = '#64748B';

const TagChips: React.FC<Props> = ({ tags, max = 3, className }) => {
  if (!tags || tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const rest = tags.slice(max);
  return (
    <Wrap className={className}>
      {shown.map((tg) => (
        <Chip key={tg.id} $color={tg.color || DEFAULT_COLOR} title={tg.name}>{tg.name}</Chip>
      ))}
      {rest.length > 0 && (
        <More title={rest.map((r) => r.name).join(', ')}>+{rest.length}</More>
      )}
    </Wrap>
  );
};

export default TagChips;

// ★ overflow:hidden — 줄어들 수 있는데(min-width 0) 칩은 안 줄어서(flex-shrink 0), 업무 칸이 좁으면 칩이
//   옆의 지연 배지 **밑으로 겹쳐** 그려졌다(2026-10-14 Q task 실측 «[확인용]» 이 «93일 지연» 뒤에). 넘치면 잘린다.
// ★ flex-shrink 크게 — 칸이 모자라면 **칩이 먼저** 줄고 제목은 남는다(Irene 2026-10-27 «제목이 잘려보이는게 제일 속터져»).
//   기본값 1 이면 긴 제목(기준 폭이 큼)이 줄어드는 몫을 거의 다 떠안아 칩 3개 옆에서 제목이 96px 까지 눌렸다.
//   min-width 48px — 0 이면 긴 제목 옆에서 태그가 통째로 사라진다(실측). 첫 칩 앞부분은 남긴다.
const Wrap = styled.span`
  display: inline-flex; align-items: center; gap: 4px; min-width: 48px; overflow: hidden; flex-shrink: 50;
`;
// 색은 태그 색의 연한 배경 + 진한 글자. 상태 배지와 구분되도록 사각(라운드 4px).
const Chip = styled.span<{ $color: string }>`
  flex-shrink: 0; max-width: 96px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 1px 6px; border-radius: 4px;
  font-size: 0.625rem; font-weight: 700; line-height: 16px;
  color: ${({ $color }) => $color};
  background: ${({ $color }) => `${$color}1A`};   /* 10% alpha — 배경만 연하게 */
  border: 1px solid ${({ $color }) => `${$color}33`};
`;
const More = styled.span`
  flex-shrink: 0;
  padding: 1px 5px; border-radius: 4px;
  font-size: 0.625rem; font-weight: 700; line-height: 16px;
  color: #64748B; background: #F1F5F9;
`;
