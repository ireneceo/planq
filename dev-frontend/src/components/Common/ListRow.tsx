// 목록 행 정본 (2026-08-25) — 업무·메일·노트·파일·고객 등 "리스트형" 화면 공통.
//
// 왜: 같은 목록 행인데 페이지마다 제목 13/14px, 여백 6~14px, 구분선 색이 제각각이었다
//   (실측: 리스트 글자 크기 5종이 2,000곳 이상에 흩어져 있음).
//   좁은 화면에서 그 차이가 한눈에 드러나 "메뉴마다 다르다" 로 보인다(Irene).
//
// 규격은 theme/tokens.LIST_ROW 가 단일 원천이다. 값을 여기서 바꾸지 말고 토큰을 바꾼다.
//
// 사용:
//   <ListRow onClick={...} selected={id === activeId}>
//     <ListRow.Main>
//       <ListRow.Title>{title}</ListRow.Title>
//       <ListRow.Meta>{date} · {author}</ListRow.Meta>
//     </ListRow.Main>
//     <ListRow.Side>{badges}</ListRow.Side>
//   </ListRow>
import styled, { css } from 'styled-components';
import { LIST_ROW, CONTROL } from '../../theme/tokens';

const Root = styled.div<{ $selected?: boolean; $muted?: boolean; $accent?: string }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: ${LIST_ROW.padY.desktop}px ${LIST_ROW.padX.desktop}px;
  border-bottom: 1px solid ${LIST_ROW.divider};
  cursor: pointer;
  min-width: 0;
  background: ${(p) => (p.$selected ? LIST_ROW.selectedBg : 'transparent')};
  ${(p) => p.$accent && css`box-shadow: inset 3px 0 0 ${p.$accent};`}
  ${(p) => p.$muted && css`opacity: 0.5;`}
  &:hover { background: ${(p) => (p.$selected ? LIST_ROW.selectedBg : LIST_ROW.hoverBg)}; }
  /* 폰 — 터치 타깃 확보 + 글자 한 단계 크게. 데스크탑 값과 따로 두지 않고 토큰에서 온다. */
  @media (max-width: 640px) {
    padding: ${LIST_ROW.padY.phone}px ${LIST_ROW.padX.phone}px;
    min-height: ${CONTROL.touchMin}px;
  }
`;

const Main = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Title = styled.div`
  font-size: ${LIST_ROW.titleSize.desktop / 16}rem;
  font-weight: ${LIST_ROW.titleWeight};
  color: #0F172A;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  @media (max-width: 640px) { font-size: ${LIST_ROW.titleSize.phone / 16}rem; }
`;

const Meta = styled.div`
  font-size: ${LIST_ROW.metaSize.desktop / 16}rem;
  color: #94A3B8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Side = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
`;

type RootProps = React.ComponentProps<typeof Root>;
interface ListRowType extends React.FC<RootProps> {
  Main: typeof Main;
  Title: typeof Title;
  Meta: typeof Meta;
  Side: typeof Side;
}

const ListRow = ((props: RootProps) => <Root {...props} />) as ListRowType;
ListRow.Main = Main;
ListRow.Title = Title;
ListRow.Meta = Meta;
ListRow.Side = Side;

export default ListRow;
