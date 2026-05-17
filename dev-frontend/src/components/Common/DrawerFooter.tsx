// DrawerFooter — PlanQ 우측 패널/모달 공용 푸터 (사이클 N+19)
//
// 30년차 UI/UX 디자이너 표준:
//   위치  : sticky bottom (스크롤 시 액션 항상 보임)
//   배경  : #FFFFFF (#F8FAFC body 와 대비)
//   상단선: 1px solid #E2E8F0
//   패딩  : 14px 20px (모바일 12px 16px)
//   safe-area: env(safe-area-inset-bottom) 보정
//   레이아웃: 좌측(보조/상태) · 우측(취소/Primary) — 의도된 손→눈 동선
//   간격  : gap 8px (sm) 또는 12px (md)
//
// 사용처:
//   <DrawerFooter>
//     <ActionButton tone="secondary" onClick={close}>취소</ActionButton>
//     <ActionButton tone="primary" onClick={save}>저장</ActionButton>
//   </DrawerFooter>
//
//   좌측 영역 활용:
//   <DrawerFooter left={<ActionButton tone="danger">삭제</ActionButton>}>
//     <ActionButton tone="secondary">취소</ActionButton>
//     <ActionButton tone="primary">저장</ActionButton>
//   </DrawerFooter>

import React from 'react';
import styled from 'styled-components';

export interface DrawerFooterProps {
  left?: React.ReactNode;     // 좌측 슬롯 (보조 액션 — 삭제, helper text 등)
  children?: React.ReactNode; // 우측 슬롯 (취소·Primary 액션)
  align?: 'right' | 'space-between';  // 기본 'space-between'
  size?: 'sm' | 'md';         // 패딩 변형. 기본 'md'.
  className?: string;
  sticky?: boolean;           // 기본 true. false 면 normal flow.
}

const DrawerFooter: React.FC<DrawerFooterProps> = ({ left, children, align = 'space-between', size = 'md', className, sticky = true }) => {
  return (
    <Wrap className={className} $sticky={sticky} $size={size}>
      <Inner $align={align}>
        <LeftSlot>{left}</LeftSlot>
        <RightSlot>{children}</RightSlot>
      </Inner>
    </Wrap>
  );
};

export default DrawerFooter;

// ────────────────────────────────────────────────
// styled
// ────────────────────────────────────────────────
const Wrap = styled.div<{ $sticky: boolean; $size: 'sm' | 'md' }>`
  ${(p) => p.$sticky && 'position: sticky; bottom: 0;'}
  background: #FFFFFF;
  border-top: 1px solid #E2E8F0;
  padding: ${(p) => p.$size === 'sm' ? '12px 16px' : '14px 20px'};
  padding-bottom: calc(${(p) => p.$size === 'sm' ? '12px' : '14px'} + env(safe-area-inset-bottom, 0px));
  flex-shrink: 0;
  z-index: 2;
  @media (max-width: 640px) {
    padding: 12px 16px;
    padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  }
`;
const Inner = styled.div<{ $align: 'right' | 'space-between' }>`
  display: flex;
  align-items: center;
  justify-content: ${(p) => p.$align === 'right' ? 'flex-end' : 'space-between'};
  gap: 8px;
  min-height: 36px;
`;
const LeftSlot = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  &:empty { display: none; }
`;
const RightSlot = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  &:empty { display: none; }
`;
