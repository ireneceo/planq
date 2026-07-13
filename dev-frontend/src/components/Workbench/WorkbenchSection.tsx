// 작업대 섹션 — Q Talk 우측 패널 · Q Mail 맥락 패널 **유일한** 섹션 골격.
//
// 값은 Q Talk 우측 패널(운영에서 검증된 것)을 그대로 박제한다. 여태 골격이 3벌 공존해서
// (Q Talk 레거시 styled / 이 컴포넌트 / Q Mail Wrap) 같은 패널 안에서도 리듬이 어긋났다:
//   섹션 간 공백 Q Mail 40px vs Q Talk 22px, 콘텐츠 좌 인셋 0 vs 14px, chevron·카운트 배지도 제각각.
// 지금부터 두 패널은 이 파일만 쓴다. 여기 값을 바꾸면 두 화면이 함께 바뀐다.
//
// 접힘은 비제어(defaultOpen) / 제어(open + onToggle) 둘 다 지원한다 — Q Talk 은 스코프가 바뀔 때
// "내용이 있는 섹션만 펼침" 을 외부 state 로 계산하므로 제어 모드가 필요하다.
import { useState, type ReactNode } from 'react';
import styled from 'styled-components';

interface Props {
  title: string;
  /** 카운트 — 0 이어도 표시한다 (Q Talk 규칙: 비어 있다는 사실도 정보다) */
  count?: number;
  /** 헤더 우측 액션 (AI 버튼 등) */
  action?: ReactNode;
  /** 접기 없이 항상 열린 섹션 (예: 한 줄 등록) */
  static?: boolean;
  /** 비제어 초기값 */
  defaultOpen?: boolean;
  /** 제어 모드 — 주면 open/onToggle 로 외부가 관리 */
  open?: boolean;
  onToggle?: () => void;
  /** 본문 최대 높이(px) — 넘으면 섹션 안에서 스크롤. 팝업(달력·셀렉트)이 있는 섹션엔 쓰지 말 것(잘린다) */
  maxBodyHeight?: number;
  children: ReactNode;
}

export default function WorkbenchSection({
  title, count, action, static: isStatic, defaultOpen = true, open, onToggle, maxBodyHeight, children,
}: Props) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const controlled = open !== undefined;
  const expanded = isStatic ? true : (controlled ? !!open : innerOpen);
  const toggle = () => {
    if (isStatic) return;
    if (controlled) onToggle?.();
    else setInnerOpen((v) => !v);
  };

  return (
    <Section>
      <Head $static={!!isStatic} onClick={toggle} role={isStatic ? undefined : 'button'} aria-expanded={isStatic ? undefined : expanded}>
        <Title>
          {!isStatic && <Chevron $open={expanded} aria-hidden="true" />}
          {title}
          {typeof count === 'number' && <Count>{count}</Count>}
        </Title>
        {action && <Action onClick={(e) => e.stopPropagation()}>{action}</Action>}
      </Head>
      {expanded && <Body $max={maxBodyHeight}>{children}</Body>}
    </Section>
  );
}

/** 섹션 안 빈 상태 — 두 패널 공통 */
export const WorkbenchEmptyRow = styled.div`
  padding: 10px 0;
  font-size: 12px;
  color: #94A3B8;
  line-height: 1.5;
`;

/** "전체 보기" 같은 섹션 링크 — 채운 버튼이 아니라 텍스트 링크 (Q Talk 규칙) */
export const WorkbenchSectionLink = styled.button`
  align-self: flex-start;
  border: none; background: none; padding: 2px 0; cursor: pointer;
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; font-weight: 600; color: #0D9488;
  &:hover { text-decoration: underline; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; border-radius: 4px; }
`;

const Section = styled.section`
  display: flex; flex-direction: column;
  border-bottom: 1px solid #F1F5F9;
  &:last-of-type { border-bottom: none; }
`;
const Head = styled.div<{ $static: boolean }>`
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 14px;
  cursor: ${(p) => (p.$static ? 'default' : 'pointer')};
  ${(p) => (p.$static ? '' : '&:hover { background: #F8FAFC; }')}
  user-select: none;
`;
const Title = styled.div`
  display: flex; align-items: center; gap: 6px; min-width: 0;
  font-size: 12px; font-weight: 700; color: #0F172A; letter-spacing: -0.1px;
`;
// chevron — Q Talk 의 작은 삼각형 (SVG 아이콘 세트와 크기가 안 맞아 프리미티브로 박제)
const Chevron = styled.span<{ $open: boolean }>`
  width: 0; height: 0; flex-shrink: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid #94A3B8;
  transform: rotate(${(p) => (p.$open ? 0 : -90)}deg);
  transition: transform 0.15s ease;
  @media (prefers-reduced-motion: reduce) { transition: none; }
`;
const Count = styled.span`
  min-width: 16px; height: 16px; padding: 0 4px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; background: rgba(15, 23, 42, 0.08); color: #475569;
  font-size: 10px; font-weight: 700; line-height: 1;
`;
const Action = styled.div`display: flex; align-items: center; gap: 6px; flex-shrink: 0;`;
const Body = styled.div<{ $max?: number }>`
  display: flex; flex-direction: column; gap: 8px;
  padding: 0 14px 12px;
  ${(p) => (p.$max ? `max-height: ${p.$max}px; overflow-y: auto;` : '')}
`;
