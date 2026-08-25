import type { ReactNode } from 'react';
import styled from 'styled-components';

/**
 * PanelHeader — 멀티 컬럼 레이아웃(Q Talk / Q Note / Q Task 등)에서
 * 각 패널(좌/중/우) 상단에 들어가는 고정 높이 헤더.
 *
 * 표준값 (모든 패널 동일):
 *  - min-height 60px   → 가로 구분선이 y=60 에서 수평 연결
 *  - padding 14px 20px
 *  - border-bottom #e2e8f0
 *
 * 타이틀 크기는 패널 성격에 따라 다름 (앱 타이틀 18px, 메타/섹션 13~16px).
 * → `PanelTitle`(18px) / `PanelSubTitle`(16px) / `PanelMetaTitle`(13px) 중 선택.
 */
type Props = {
  children: ReactNode;
  className?: string;
  /**
   * 뒤로 가기 — 좁은 화면(드릴다운)에서 상세·보조 패널에 표준으로 붙는다.
   * ★ 페이지마다 각자 만든 뒤로 버튼을 여기로 모은다 — 어떤 화면은 있고 어떤 화면은 없어서
   *   "채팅은 돌아가는 게 안 된다" 같은 차이가 났다(Irene, 2026-08-25).
   *   usePanelStack().canGoBack 과 짝으로 쓴다.
   */
  onBack?: () => void;
  backLabel?: string;
};

export default function PanelHeader({ children, className, onBack, backLabel }: Props) {
  return (
    <Bar className={className}>
      {onBack && (
        <BackBtn type="button" onClick={onBack} aria-label={backLabel || '뒤로'} title={backLabel || '뒤로'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </BackBtn>
      )}
      {children}
    </Bar>
  );
}

const Bar = styled.div`
  height: 60px;            /* 좌측메뉴·콘텐츠 헤더와 픽셀 동일 — 헤더 밑줄(회색 라인) 정렬 */
  padding: 14px 20px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  background: #ffffff;
  @media (max-width: 640px) {
    /* ★ 한 줄 유지 (2026-08-25 Irene: "버튼 2개뿐인데 2줄"). 옛 규칙은 column 이라
       제목과 액션이 무조건 위아래로 쌓여 패널 헤더가 두 줄이 됐고, 좌우 패널의
       밑줄(회색 라인)이 서로 어긋났다 — 60px 정렬 계약이 모바일에서만 깨져 있었다.
       좁으면 제목이 말줄임되고 액션은 그대로 오른쪽에 남는다. */
    flex-direction: row;
    align-items: center;
    height: 56px;
    padding: 10px 14px;
    gap: 8px;
    > *:first-child { min-width: 0; flex-shrink: 1; }
    > *:last-child { flex-shrink: 0; }
  }
`;

export const PanelTitle = styled.h1`
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const PanelSubTitle = styled.h2`
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  @media (max-width: 640px) {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    line-height: 1.4;
  }
`;

export const PanelMetaTitle = styled.h2`
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.1px;
`;

/** 표준 뒤로 버튼 — 폰 터치 타깃 44 (theme/tokens CONTROL.touchMin). 데스크탑에서는 숨긴다. */
const BackBtn = styled.button`
  display: none;
  flex-shrink: 0;
  width: 40px; height: 40px;
  margin-left: -8px; margin-right: 2px;
  align-items: center; justify-content: center;
  background: none; border: none; border-radius: 8px;
  color: #334155; cursor: pointer;
  svg { width: 20px; height: 20px; }
  &:hover { background: #F1F5F9; }
  @media (max-width: 1024px) { display: inline-flex; }
  @media (max-width: 640px) { width: 44px; height: 44px; }
`;

/**
 * 자체 헤더를 쓰는 화면(Q Note·Q Talk 등)이 **같은 뒤로가기**를 붙일 수 있게 따로 내보낸다.
 * 헤더 마크업 통일은 점진적으로 하되, 동작(뒤로 가기)은 지금 당장 같아야 한다 —
 * "어떤 화면은 되고 어떤 화면은 안 되는" 것이 사용자에겐 가장 큰 차이다.
 */
export function PanelBackButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <BackBtn type="button" onClick={onClick} aria-label={label || '뒤로'} title={label || '뒤로'}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </BackBtn>
  );
}
