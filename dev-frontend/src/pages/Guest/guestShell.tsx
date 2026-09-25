// 게스트(무로그인 링크) 화면의 **껍데기 한 벌** — docs/GUEST_PROJECT_VIEW_DECISIONS.md §C.
//
// 왜: 개요·업무는 880px 기둥 가운데, 문서·파일은 전폭이었다 — 탭을 옮길 때마다 글의 왼쪽 x 가 바뀌었다
//   (Irene: *"고객용 프로젝트 링크가 계속 탭마다 레이아웃이 달라"*). 그리고 같은 styled 가 탭 파일마다
//   복사돼 있었다(Empty·RetryInline·HiddenNote·Lock·시트 4종). 한 곳에 둔다 — 베끼면 갈라진다.
// ★ 숫자를 바꾸지 않는다 — READ_W 880 은 2026-09-10 Irene «허접» 지적으로 정해진 읽기 폭이다.
// ★ 앱의 ProjectTabPane 을 가져오지 않는다 — 그 계약은 PageShell 여백·탭 막대 높이에 묶여 있고
//   게스트 화면에는 그 크롬이 없다.
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';

export const READ_W = '880px';

/** 탭 본문 — 다섯 탭 전부 이 안에 그린다. 스크롤 주체가 이것이다(바깥은 100dvh 고정). */
export const GuestTabPane = styled.div`
  flex:1;min-height:0;overflow-y:auto;padding:16px 20px;
  @media (max-width:640px){ padding:14px 16px; }
  display:flex;flex-direction:column;gap:14px;
  > * { width:100%; max-width:${READ_W}; margin-left:auto; margin-right:auto; flex-shrink:0; }
`;

// ── 페이지 껍데기 (밴드1 + 탭 막대) ────────────────────────────────────────
//
// ★ 2026-09-25 — 이 열 개는 `GuestProjectPage.tsx` 안에 **private** 으로 있었다. 워크스페이스 창구
//   화면(scope='workspace')이 같은 모양을 써야 하는데, 베끼면 갈라진다 —
//   이 파일 머리말이 바로 그 이유로 존재한다(Empty·Lock·시트가 탭 파일마다 복사돼 있었다).
//   **값은 한 글자도 바꾸지 않고** 옮겼다(색·높이·여백·미디어쿼리 그대로).

/** 화면 루트 — 바깥은 100dvh 고정이고 스크롤 주체는 GuestTabPane 이다. */
export const Wrap = styled.div`display:flex;flex-direction:column;height:100dvh;background:#f8fafc;`;

/** 밴드1 — 로고·워크스페이스·제목. 직계 div 가 READ_W 기둥이라 본문과 왼쪽이 맞는다. */
export const Head = styled.div`
  min-height:60px;background:#fff;border-bottom:1px solid #e2e8f0;flex-shrink:0;
  padding:14px 20px;
  @media (max-width:640px){ padding:12px 16px; }
  > div { width:100%; max-width:${READ_W}; margin:0 auto; }
`;
// 로고 + 제목 칸. Head 의 직계 div 규칙(READ_W 기둥)이 이 줄에 걸리므로 본문과 같은 기둥에 선다.
export const HeadRow = styled.div`display:flex;align-items:center;gap:8px;`;
export const HeadText = styled.div`min-width:0;flex:1;`;
export const Title = styled.div`font-size:1.125rem;font-weight:700;letter-spacing:-0.2px;color:#0f172a;`;
// 헤더 오른쪽 문 — Secondary 톤(3톤 규칙). 폰에서도 40 이상.
export const HeadBtn = styled.button`
  flex-shrink:0;min-height:36px;padding:0 12px;border-radius:8px;cursor:pointer;
  border:1px solid #cbd5e1;background:#fff;color:#334155;font-size:0.8125rem;font-weight:600;white-space:nowrap;
  &:hover{border-color:#14B8A6;color:#0F766E;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
  @media (max-width:640px){ min-height:40px; }
`;
export const TabBar = styled.div`
  display:flex;gap:2px;background:#fff;border-bottom:1px solid #e2e8f0;flex-shrink:0;
  overflow-x:auto;-webkit-overflow-scrolling:touch;
  /* 탭도 본문과 같은 기둥에 세운다 — 안 그러면 탭은 화면 끝, 글은 가운데가 된다. */
  padding:0 12px;
  > * { flex-shrink:0; }
  justify-content:flex-start;
  &::after { content:''; }
  @media (min-width:${READ_W}) { padding-left:calc((100% - ${READ_W}) / 2 + 12px); padding-right:calc((100% - ${READ_W}) / 2 + 12px); }
`;
export const Tab = styled.button<{ $on: boolean }>`
  display:inline-flex;align-items:center;gap:6px;flex-shrink:0;
  height:44px;padding:0 14px;border:none;background:none;cursor:pointer;
  /* 폰에서는 다섯 탭이 **한 줄에 다 보이게** — 영어 375 에서 마지막 탭(Chat)이 잘려 가로로 밀어야 한다는 걸 알 수 없었다. */
  @media (max-width:640px){ padding:0 9px; }
  font-size:0.875rem;font-weight:${p => (p.$on ? 700 : 500)};
  color:${p => (p.$on ? '#0F766E' : '#64748B')};
  box-shadow:${p => (p.$on ? 'inset 0 -2px 0 #14B8A6' : 'none')};
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:-2px;}
`;
// 배지 — 컨트롤이 아니라 표시다. 높이를 px 로 박지 않고 padding·line-height 로 잡는다.
export const Count = styled.span`
  display:inline-flex;align-items:center;justify-content:center;min-width:18px;padding:1px 6px;line-height:1.45;
  border-radius:999px;background:#F1F5F9;color:#475569;font-size:0.6875rem;font-weight:700;
`;
// 알림 신청 띠도 같은 기둥 — 안 그러면 대화 탭에서만 띠가 화면 끝까지 늘어난다.
export const NotifyColumn = styled.div`
  flex-shrink:0;padding:0 20px;
  @media (max-width:640px){ padding:0 16px; }
  > * { width:100%; max-width:${READ_W}; margin-left:auto; margin-right:auto; }
`;

export const Empty = styled.div`font-size:0.8125rem;color:#64748b;padding:12px 0;`;
export const RetryInline = styled.button`
  border:none;background:none;padding:0;font-size:0.8125rem;font-weight:700;
  color:#0d9488;cursor:pointer;text-decoration:underline;
`;
export const HiddenNote = styled.div`
  padding:10px 12px;background:#f1f5f9;border-radius:8px;
  font-size:0.75rem;line-height:1.5;color:#64748b;
`;
/** 잠김 표시 — **그림(SVG)** 으로 그린다. 🔒 이모지는 기기 글꼴에 따라 ☒(두부)로 깨졌다(2026-09-24 실측) —
 *  잠겼다는 사실이 기기마다 다르게 전달되면 안 된다. `size` 로 카드 제목(12)·썸네일(20)을 가른다. */
export const Lock = ({ size = 12 }: { size?: number }) => (
  <LockSvg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </LockSvg>
);
const LockSvg = styled.svg`flex-shrink:0;color:#94A3B8;vertical-align:-1px;`;

// 시트 — 폰은 바닥에서 올라오고, 넓으면 가운데. 모달이라 쓰는 곳은 3훅을 건다(CLAUDE.md 드로어 접근성).
// ★ 반드시 **SheetPortal 안에** 그린다 — 탭 본문(overflow 스크롤 상자) 안에 두면 조상이 층을 만들 때
//   전면 모달이 그 층에 갇힌다(가드 `modalportal`). body 로 빼면 층 문제가 원천적으로 없다.
export const SheetPortal = ({ children }: { children: ReactNode }) => createPortal(children, document.body);

export const Sheet = styled.div`
  position:fixed;inset:0;z-index:60;display:flex;align-items:flex-end;justify-content:center;
  background:rgba(15,23,42,0.45);
  @media (min-width:641px){align-items:center;}
`;
export const SheetBox = styled.div`
  position:relative;width:100%;max-width:420px;margin:0;padding:20px;
  background:#fff;border-radius:16px 16px 0 0;
  padding-bottom:calc(20px + env(safe-area-inset-bottom));
  @media (min-width:641px){border-radius:16px;margin:0 16px;padding-bottom:20px;}
`;
export const SheetTitle = styled.div`font-size:1rem;font-weight:700;color:#0f172a;padding-right:36px;`;
/** 시트 닫기 — **눈에 보이는 문**. 바깥 누르기·Esc 만 있으면 폰 사용자는 닫는 법을 모른다(2026-09-24 UX 점검). */
export const SheetClose = styled.button`
  position:absolute;top:10px;right:10px;width:40px;height:40px;border:none;background:none;border-radius:8px;
  font-size:1.375rem;line-height:1;color:#64748b;cursor:pointer;
  &:hover{background:#f1f5f9;}
  &:focus-visible{outline:2px solid #0d9488;outline-offset:2px;}
`;
export const SheetBody = styled.div`margin-top:8px;font-size:0.8125rem;line-height:1.6;color:#475569;`;
export const SheetBtn = styled.button<{ $primary?: boolean }>`
  margin-top:10px;width:100%;height:2.75rem;
  background:${p => (p.$primary ? '#14B8A6' : '#0f172a')};color:#fff;border:none;border-radius:10px;
  font-size:0.875rem;font-weight:600;cursor:pointer;
  &:disabled{opacity:.6;cursor:default;}
  &:first-of-type{margin-top:16px;}
`;
export const SheetGhostBtn = styled.button`
  margin-top:10px;width:100%;height:2.75rem;background:#fff;color:#334155;
  border:1px solid #e2e8f0;border-radius:10px;font-size:0.875rem;font-weight:600;cursor:pointer;
`;
