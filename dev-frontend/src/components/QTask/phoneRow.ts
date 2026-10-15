// 폰(≤640) 업무 행 조각 — Q task 목록 · 프로젝트 > 업무 탭이 같이 쓴다(베끼면 갈라진다).
//   데스크탑·태블릿 표에서는 칸이 따로 있어 숨고, 폰에서만 그린다.
//   모양은 «오늘 내 업무» 팝아웃 행(Badge · MetaDue)과 같다 — Irene 2026-10-15 «팝아웃 참고해서 모바일에서 목적에 맞게».
import styled from 'styled-components';

/** 폰에서 접는 것(행 ⋮ · 태그 + · 끌기 손잡이). 데스크탑은 display:contents 라 배치가 그대로다. */
export const DesktopOnly = styled.span`display:contents;@media (max-width: 640px){display:none;}`;

/** 폰 전용 상태 배지 — 상태 칸이 폰에서 숨으므로 행 안에 둔다. */
export const PhoneStatus = styled.span<{ $bg: string; $fg: string }>`
  display:none;
  @media (max-width: 640px){
    display:inline-flex;align-items:center;flex-shrink:0;padding:2px 7px;border-radius:999px;
    font-size:0.6875rem;font-weight:700;line-height:1.4;white-space:nowrap;
    background:${(p) => p.$bg};color:${(p) => p.$fg};
  }
`;

/** 폰 전용 메타 글자 — 프로젝트·마감·담당자. */
export const PhoneMeta = styled.span<{ $tone?: 'today' | 'person' }>`
  display:none;
  @media (max-width: 640px){
    display:inline-block;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    font-size:0.6875rem;font-weight:${(p) => (p.$tone ? 600 : 500)};
    color:${(p) => (p.$tone === 'today' ? '#B45309' : p.$tone === 'person' ? '#0F766E' : '#64748B')};
  }
`;

/** 마감 표시 MM/DD — 팝아웃 fmtDue 와 같은 모양. */
export const fmtDueShort = (due?: string | null) => (due ? due.slice(5, 10).replace('-', '/') : '');
