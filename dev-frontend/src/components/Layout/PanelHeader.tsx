import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import styled, { css } from 'styled-components';

/**
 * PanelHeader — 멀티 컬럼 레이아웃(Q Talk / Q Note / Q Task 등)에서
 * 각 패널(좌/중/우) 상단에 들어가는 헤더.
 *
 * 표준값 (모든 패널 동일):
 *  - 데스크탑 height 60px → 가로 구분선이 y=60 에서 수평 연결 (좌우 패널 밑줄이 이어진다)
 *  - 폰(≤640) min-height 56px → **하한만** 두고 제목이 길면 헤더가 같이 자란다
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
       좁으면 제목이 두 줄까지 접히고(PanelSubTitle) 액션은 그대로 오른쪽에 남는다. */
    flex-direction: row;
    align-items: center;
    /* ★ 높이는 **하한**이지 상한이 아니다 (2026-08-30).
       옛 height:56px 은 제목이 두 줄 이상이 되면 헤더 밖으로 흘러 아래 액션 줄을
       덮었다 — 120자 메일 제목 실측: 제목 112px / 헤더 56px → 27px 겹침, 제목의
       앞부분은 헤더 위로 잘리고 끝부분은 아래로 잘려 **가운데 세 줄만** 보였다.
       (Irene 2026-08-30: "모바일에서 메일 제목이 길면 다 안나와")
       60px 고정의 원래 목적은 좌우 패널 밑줄을 수평으로 잇는 것인데, 폰은
       PANEL_BP.drilldown(1024) 아래라 패널이 한 번에 하나만 보여 **이을 옆 패널이 없다**.
       2026-08-25 결정("버튼 2개뿐인데 2줄")의 본질은 아래 flex-direction: row 이지
       56 이라는 숫자가 아니다 — 한 줄 배치는 그대로 유지된다. */
    height: auto;
    min-height: 56px;
    padding: 10px 14px;
    gap: 8px;
    /* ★ 액션이 한 줄에 안 들어가면 **접어 내린다** (2026-08-30).
       Q docs 상세는 액션이 8개라 그 줄만으로 375px 를 다 먹고 flex-shrink:0 이라
       양보하지 않는다. 그 결과 제목 칸이 **0px** 로 짜부라져 제목이 한 글자씩
       세로로 쌓였다 (실측: 제목 폭 15px / 높이 202px — 11자짜리 제목이 9줄).
       wrap 은 **기준 크기 합이 넘칠 때만** 발동한다 — 제목의 flex-basis 는 0 이라
       액션이 작으면(예: 메일 상세의 스팸 버튼) 종전대로 한 줄에 같이 남는다.
       2026-08-25 "버튼 2개뿐인데 2줄" 은 flex-direction: column 이 원인이었고,
       그것은 위에서 row 로 되돌린 채 유지된다. */
    flex-wrap: wrap;
    > *:first-child { min-width: 0; flex-shrink: 1; }
    /* ★ 제목 칸의 **기준 크기를 0 으로** 고정한다 (버튼이면 제외 — 뒤로가기가 늘어나면 안 된다).
       wrap 은 기준 크기의 합으로 발동하는데, 메일 상세의 제목 칸은 flex: 1 1 auto 라
       기준 크기가 **제목 길이만큼** 커서 제 혼자 줄을 넘겨 버렸다 — 스팸 버튼이 세 번째
       줄로 밀려 헤더가 66px → 154px 이 됐다(실측·캡처 확인). 기준 0 으로 두면 제목은
       남는 자리를 채울 뿐 줄을 넘기지 않고, **액션이 실제로 안 들어갈 때만** 접힌다.
       ★ :first-child 로 잡으면 안 된다 — 메일 상세는 onBack 을 써서 **첫 자식이 뒤로가기
       버튼**이다. 버튼을 빼고, 마지막(액션 칸)도 빼고 남는 것이 제목 칸이다. */
    > *:not(button):not(:last-child) { flex: 1 1 0; }
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

const SubTitleH2 = styled.h2<{ $expanded: boolean; $clamp: boolean }>`
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* 폰: 한 줄 말줄임 대신 **두 줄까지** 보여주고, 그래도 넘치면 탭해서 전체를 편다.
     무제한 줄바꿈은 오답이다 — 120자 제목이면 헤더가 화면 1/3 을 잠식한다.
     펼침/접힘 어느 쪽이든 헤더(min-height)가 같이 자라므로 아래 줄과 겹치지 않는다. */
  @media (max-width: 640px) {
    white-space: normal;
    text-overflow: clip;
    line-height: 1.4;
    ${p => (p.$clamp && !p.$expanded)
      ? css`
          cursor: pointer;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        `
      : css`
          cursor: ${p.$clamp ? 'pointer' : 'default'};
          display: block;
          overflow: visible;
        `}
  }
`;

/**
 * 패널 상세 제목 — 선택된 항목명(16px).
 * 폰에서는 두 줄까지 보이고, 잘렸으면 **탭해서 전체를 편다**. 데스크탑은 종전대로 한 줄 말줄임
 * (패널 폭이 넓어 잘리는 일이 드물고, 헤더 60px 정렬 계약을 지켜야 한다).
 */
export function PanelSubTitle({ children, className, ...rest }: {
  children: ReactNode; className?: string; [key: string]: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  /* ★ 제목이 **순수 문자열일 때만** 접는다.
     Q docs 상세는 제목 안에 고정 표시와 "자료정리에서 파생" **링크**를 같이 넣는다
     (PostsPage.tsx). 두 줄로 자르면 제목이 긴 문서에서 그 링크가 잘려 나가 모바일에서
     영영 누를 수 없게 된다 — 접기가 기능을 죽이는 셈이다.
     문자열이 아니면 전부 펼쳐 두고, 대신 위 Bar 의 min-height 가 헤더를 같이 늘려
     아래 줄과 겹치지 않게 한다(겹침이 원래 문제였다). */
  const clampable = typeof children === 'string';
  const toggle = useCallback(() => {
    if (!clampable) return;
    // 데스크탑은 한 줄 말줄임이라 펼칠 것이 없다 — 죽은 클릭을 만들지 않는다.
    if (typeof window !== 'undefined' && !window.matchMedia('(max-width: 640px)').matches) return;
    setExpanded(v => !v);
  }, [clampable]);
  return (
    <SubTitleH2
      {...rest}
      className={className}
      $expanded={expanded}
      $clamp={clampable}
      onClick={toggle}
      aria-expanded={clampable ? expanded : undefined}
      title={clampable ? (children as string) : undefined}
    >
      {children}
    </SubTitleH2>
  );
}

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
