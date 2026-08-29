// 헤더 아이콘에서 열리는 드롭다운(알림 · 새 소식)의 **공용 껍데기**.
//
//   Irene: "전체알림이랑 스피커모양 공지랑 전체보기가 달라. 디자인 맞춰야지."
//   두 파일이 서로를 베껴 만들어져 조금씩 갈라져 있었다(메타 위치·안읽음 표시·아이콘 유무·
//   빈 상태 여백까지 전부 달랐다). 스타일을 여기 한 곳에 두면 한쪽만 손대도 같이 움직인다.
//
//   ★ 새 드롭다운을 만들 때도 여기서 가져다 쓴다. 각자 styled 를 다시 선언하지 않는다.
import styled from 'styled-components';
import ChromeLink from '../Tab/ChromeLink';

// ★ 등장 효과는 index.css 의 `[data-popover]` 계약이 준다. 여기서는 속성만 기본값으로 붙인다 —
//   호출부가 잊어버려도 껍데기를 쓰면 자동으로 따라온다(각자 애니메이션을 다시 쓰지 않게).
export const Popover = styled.div.attrs<{ 'data-popover'?: string }>({ 'data-popover': 'true' })`
  position: fixed; top: 60px; left: 16px;
  width: 360px; max-width: calc(100vw - 32px); max-height: 70vh;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
  z-index: 2000;
  display: flex; flex-direction: column; overflow: hidden;
`;
export const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid #F1F5F9; flex-shrink: 0;
`;
export const HeaderTitle = styled.h3` margin: 0; font-size: 14px; font-weight: 700; color: #0F172A; `;
export const HeaderAction = styled.button`
  background: transparent; border: none; cursor: pointer;
  font-size: 12px; font-weight: 500; color: #14B8A6; padding: 4px 8px; border-radius: 6px;
  &:hover { background: #F0FDFA; }
`;
export const List = styled.div` flex: 1; overflow-y: auto; padding: 4px; `;
export const Loading = styled.div` padding: 40px 16px; text-align: center; color: #94A3B8; font-size: 13px; `;
export const Empty = styled.div`
  padding: 40px 16px; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
`;
export const EmptyIcon = styled.svg` width: 36px; height: 36px; color: #CBD5E1; `;
export const EmptyTitle = styled.div` font-size: 13px; font-weight: 600; color: #334155; `;
export const EmptyHint = styled.div` font-size: 12px; color: #94A3B8; line-height: 1.5; `;

// 항목 — 알림은 <button>, 새 소식은 <a> 라 **모양만** 공유하고 태그는 각자 정한다.
const itemLook = `
  display: flex; gap: 10px; align-items: flex-start;
  width: 100%; padding: 10px 12px; border-radius: 8px;
  border: none; text-align: left; cursor: pointer; text-decoration: none;
  transition: background 0.12s;
`;
export const ItemButton = styled.button<{ $unread: boolean }>`
  ${itemLook}
  background: ${p => (p.$unread ? '#F0FDFA' : 'transparent')};
  &:hover { background: ${p => (p.$unread ? '#CCFBF1' : '#F8FAFC')}; }
`;
export const ItemLink = styled(ChromeLink)<{ $unread: boolean }>`
  ${itemLook}
  background: ${p => (p.$unread ? '#F0FDFA' : 'transparent')};
  &:hover { background: ${p => (p.$unread ? '#CCFBF1' : '#F8FAFC')}; }
`;
// 정사각 아이콘 상자 — 컨트롤이 아니라 장식이라 aspect-ratio 로 둔다(높이 래칫은 컨트롤용).
export const ItemIcon = styled.span`
  width: 24px; aspect-ratio: 1; flex-shrink: 0; margin-top: 1px;
  display: flex; align-items: center; justify-content: center;
  background: #F1F5F9; color: #475569; border-radius: 6px;
`;
export const ItemBody = styled.div` flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; `;
export const ItemTitle = styled.div<{ $unread: boolean }>`
  font-size: 13px; font-weight: ${p => (p.$unread ? 600 : 500)}; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
`;
export const ItemDesc = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.45;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
`;
export const ItemMeta = styled.div` font-size: 11px; color: #94A3B8; margin-top: 2px; `;
// 안읽음 표시는 **오른쪽 점 하나**로 통일한다(새 소식은 제목 위 빨간 점이라 따로 놀았다).
export const UnreadDot = styled.span`
  width: 8px; aspect-ratio: 1; border-radius: 50%; background: #14B8A6;
  flex-shrink: 0; margin-top: 6px;
`;
export const Footer = styled.div` padding: 8px; border-top: 1px solid #F1F5F9; flex-shrink: 0; `;
export const FooterLink = styled(ChromeLink)`
  display: block; width: 100%; padding: 8px; border-radius: 6px;
  text-align: center; text-decoration: none;
  font-size: 12px; font-weight: 600; color: #14B8A6;
  &:hover { background: #F0FDFA; }
`;
