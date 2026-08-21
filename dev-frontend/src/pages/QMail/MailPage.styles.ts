// Q mail 화면 스타일 — MailPage.tsx 에서 분리 (god-file 가드: 컴포넌트 파일 800줄 상한).
// 동작 코드와 표현을 나눠 두면 화면 로직을 읽을 때 스타일 400줄을 스크롤하지 않아도 된다.
import styled from 'styled-components';

// ─────────────────────────────────────────────
// styles
// ─────────────────────────────────────────────
// Q Talk 의 Layout 과 동일 — flex row, full-bleed (PageShell·카드 X)
// 컨테이너·패널은 공통 components/Layout/PanelLayout 의 PanelLayout/Panel 사용 (통일)
// M4 — FAQ 자동 클러스터링 제안 (좌측 패널, 폴더 아래)
export const FaqSuggestBox = styled.div`
  border-bottom: 1px solid #E2E8F0; background: rgba(244, 63, 94, 0.04);
  padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px;
`;
export const FaqSuggestHead = styled.div`
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 700; color: #F43F5E;
`;
export const FaqCount = styled.span`
  margin-left: auto; min-width: 18px; height: 18px; padding: 0 6px;
  border-radius: 8px; background: rgba(244, 63, 94, 0.15); color: #F43F5E;
  font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;
`;
export const FaqItem = styled.div`
  background: #FFFFFF; border: 1px solid rgba(244, 63, 94, 0.22); border-radius: 10px;
  padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;
`;
export const FaqQ = styled.button`
  all: unset; cursor: pointer; display: flex; align-items: flex-start; gap: 6px;
`;
export const FaqQText = styled.span`
  flex: 1; min-width: 0; font-size: 12px; font-weight: 600; color: #0F172A;
  line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
`;
export const FaqOcc = styled.span`flex-shrink: 0; font-size: 11px; font-weight: 700; color: #F43F5E;`;
export const FaqAnswer = styled.div`
  font-size: 12px; color: #475569; line-height: 1.5; white-space: pre-wrap;
  overflow-wrap: anywhere; background: #F8FAFC; border-radius: 6px; padding: 8px 10px;
  max-height: 160px; overflow-y: auto;
`;
export const FaqActions = styled.div`display: flex; gap: 6px;`;
export const FaqRegisterBtn = styled.button`
  flex: 1; height: 30px; border-radius: 6px; border: none; cursor: pointer;
  background: #0D9488; color: #FFFFFF; font-size: 12px; font-weight: 600;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
export const FaqDismissBtn = styled.button`
  flex: 1; height: 30px; border-radius: 6px; cursor: pointer;
  background: #FFFFFF; color: #64748B; border: 1px solid #E2E8F0; font-size: 12px; font-weight: 600;
  &:hover:not(:disabled) { background: #F1F5F9; color: #0F172A; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
// M4 — AI 답변이 등록 FAQ 를 활용했을 때 배지 (컴포저)
export const FaqUsedBadge = styled.div`
  display: inline-flex; align-items: center; gap: 4px; align-self: flex-start;
  margin: 0 0 8px; padding: 4px 10px; border-radius: 999px;
  background: rgba(244, 63, 94, 0.08); color: #F43F5E;
  font-size: 11px; font-weight: 700; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
// 폴더 탭 (답변필요/인박스/내담당/팔로우/스팸/보관) — 좌측 상단 가로 탭
export const FolderTabs = styled.div`
  display: flex; gap: 2px;
  padding: 4px 6px 0;
  border-bottom: 1px solid #E2E8F0;
  overflow-x: auto;
  flex-shrink: 0;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;
export const FolderTab = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 5px;
  flex-shrink: 0;
  padding: 8px 10px 9px;
  border: none; background: transparent;
  font-size: 13px; font-weight: ${p => p.$active ? 700 : 500};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border-bottom: 2px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  cursor: pointer; white-space: nowrap;
  transition: color 0.12s;
  &:hover { color: #0F766E; }
`;
export const TabCount = styled.span<{ $active: boolean }>`
  min-width: 16px; padding: 0 5px;
  background: ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  color: ${p => p.$active ? '#FFFFFF' : '#64748B'};
  font-size: 10px; font-weight: 700;
  border-radius: 999px; text-align: center;
`;
// 계정 필터 칩 (회사/개인) — 탭 아래
// 메일 검색창
export const SearchRow = styled.div`
  display: flex; align-items: center; gap: 6px;
  margin: 8px 16px; padding: 0 10px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  flex-shrink: 0;
  &:focus-within { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.1); }
`;
// 리스트 헤더 우측 액션 묶음 — ⚙계정관리 + 새메일(+). 제목 옆 우측 정렬.
export const HeaderActions = styled.div`
  display: flex; align-items: center; gap: 6px; margin-left: auto;
`;
// 계정관리 — 톱니 아이콘 (헤더 + 앞). 기존 dashed "계정 관리" 텍스트 칩 대체.
export const AcctManageIcon = styled.button`
  flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFFFFF;
  color: #64748B; cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  &:hover { color: #0F766E; border-color: #14B8A6; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
export const SearchIcon = styled.svg`width: 15px; height: 15px; color: #94A3B8; flex-shrink: 0;`;
export const SearchInput = styled.input`
  flex: 1; min-width: 0; border: none; background: transparent; outline: none;
  height: 34px; font-size: 13px; color: #0F172A; font-family: inherit;
  &::placeholder { color: #94A3B8; }
`;
export const SearchClear = styled.button`
  flex-shrink: 0; border: none; background: transparent; cursor: pointer;
  color: #94A3B8; font-size: 18px; line-height: 1; padding: 0 2px;
  &:hover { color: #0F172A; }
`;
// 운영 #213 — 필터 접기 토글 줄. 일괄 액션은 필터가 아니므로 접힘 밖인 이 줄에 함께 둔다.
export const FilterToggleRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 4px 12px 6px;
`;
export const FilterToggleBtn = styled.button`
  display: inline-flex; align-items: center; gap: 5px;
  min-height: 28px; padding: 4px 9px;
  background: transparent; border: 1px solid #E2E8F0; border-radius: 7px;
  font-size: 12px; font-weight: 600; color: #64748B; cursor: pointer;
  &:hover { border-color: #CBD5E1; color: #475569; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
export const FilterChevron = styled.svg<{ $open: boolean }>`
  width: 13px; height: 13px;
  transition: transform 0.15s;
  transform: rotate(${p => (p.$open ? 90 : 0)}deg);
`;
export const FilterCount = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 16px; height: 16px; padding: 0 4px;
  background: #0D9488; color: #fff; border-radius: 8px;
  font-size: 10px; font-weight: 700;
`;
export const AcctFilterRow = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 0 16px 10px;
`;
export const AcctSelectWrap = styled.div`flex: 1; min-width: 0;`;
// 회사 공용 / 개인 구분 배지 — 한 인박스에 두 성격이 섞이므로 칩에서 바로 구분되어야 한다
// 운영 #55 — 계정 관리(설정) 진입 칩 (dashed, 보조 액션)
export const AcctManageChip = styled.button`
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 600; cursor: pointer;
  border: 1px dashed #CBD5E1; background: transparent; color: #64748B;
  margin-left: auto;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
// 운영 #55 — 계정 미연결 빈 상태
export const NoAcctHint = styled.div`
  font-size: 12px; color: #64748B; line-height: 1.6;
  max-width: 320px; text-align: center; margin-top: 6px;
`;
export const NoAcctBtn = styled.button`
  margin-top: 16px; padding: 0 18px; height: 40px;
  background: #14B8A6; color: #FFFFFF; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 700; cursor: pointer;
  &:hover { background: #0D9488; }
`;
// 새 메일 작성 버튼 — Q Talk NewChatBtn 과 동일값
export const ExpandBtn = styled.button`
  position: absolute; top: 16px; left: 12px; z-index: 5;
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border-radius: 8px;
  border: 1px solid #E2E8F0; background: #fff; color: #64748B; cursor: pointer;
  box-shadow: 0 1px 2px rgba(15,23,42,.05);
  &:hover { background: #F8FAFC; color: #0F172A; }
  @media (min-width: 1025px) { display: none; }
`;
export const ComposeBtn = styled.button`
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #14B8A6; border: none; border-radius: 8px;
  color: #FFFFFF; cursor: pointer;
  transition: background 0.15s; flex-shrink: 0;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid rgba(20, 184, 166, 0.3); outline-offset: 2px; }
`;
// 새 메일 작성 모달
export const ComposeOverlay = styled.div`
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  @media (max-width: 640px) { padding: 0; align-items: stretch; }
`;
export const ComposeModal = styled.div`
  width: min(680px, 100%); max-height: 90vh;
  background: #FFFFFF; border-radius: 14px;
  box-shadow: 0 4px 12px rgba(15,23,42,0.06), 0 12px 40px rgba(15,23,42,0.18);
  display: flex; flex-direction: column; overflow: hidden;
  @media (max-width: 640px) { border-radius: 0; max-height: 100vh; height: 100vh; }
`;
export const ComposeHead = styled.div`
  min-height: 60px; padding: 14px 20px;
  border-bottom: 1px solid #E2E8F0;
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
`;
export const ComposeTitle = styled.h2`
  margin: 0; font-size: 18px; font-weight: 700; color: #0F172A; letter-spacing: -0.2px;
`;
export const CloseBtn = styled.button`
  width: 30px; height: 30px; border: none; background: transparent;
  color: #94A3B8; font-size: 16px; cursor: pointer; border-radius: 8px;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
export const FwdAttachHint = styled.div`font-size: 12px; color: #0F766E; background: #F0FDFA; border: 1px solid #CCFBF1; border-radius: 8px; padding: 8px 12px;`;
/* 메일 작성 — 센터모달 폐기, 중앙 패널을 채우는 풀페이지 저작(Q docs 예외군과 동일, Fable 승인).
   좌측 리스트 유지 · 우측 맥락패널 숨김 · 헤더/본문/푸터 세로 스택. */
export const ComposeFull = styled.div`
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  background: #fff;
`;
export const ComposeBody = styled.div`
  padding: 16px 20px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 12px;
  flex: 1; min-height: 0;
`;
export const ComposeField = styled.div`
  display: flex; flex-direction: column; gap: 4px;
`;
export const ComposeLabel = styled.label`
  font-size: 12px; font-weight: 600; color: #64748B;
`;
export const ComposeInput = styled.input`
  height: 40px; padding: 0 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 14px; color: #0F172A;
  &::placeholder { color: #94A3B8; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
// 버튼 자리는 **좌측 고정** — 답장 컴포저(ComposerActions)와 같은 규칙이다.
//   우측 끝에 두면 전역 채팅(Cue) 플로팅 버튼이 그 위에 깔려 보내기 버튼을 가린다(Irene 신고).
//   FAB 을 숨기거나 z-index 를 만지는 건 전역 도구를 훼손하는 임시방편이라 하지 않는다.
export const ComposeFoot = styled.div`
  padding: 12px 20px; border-top: 1px solid #E2E8F0;
  display: flex; align-items: center; justify-content: flex-start; gap: 8px;
  flex-shrink: 0;
`;
// Q Talk ChatList 와 동일 — 둥근 행이 측면 여백 갖도록 padding
export const ListMoreRow = styled.div`
  display: flex; justify-content: center; align-items: center; padding: 12px 0;
`;
export const ThreadList = styled.div`
  flex: 1; overflow-y: auto;
  padding: 6px 6px 12px;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 3px; }
`;
// Q Talk ChatRow 정확값 — 둥근 행, active=#F0FDFA + inset 3px 0 0 #0D9488, hover #F8FAFC
export const ThreadItem = styled.button<{ $active: boolean; $unread: boolean; $handled?: boolean }>`
  display: block; width: 100%;
  opacity: ${(p) => (p.$handled ? 0.5 : 1)};   /* 처리됨 — 자리는 지키고 조용히 물러난다 */
  transition: opacity 0.15s ease;
  padding: 10px 10px;
  margin: 2px 0;
  border-radius: 10px;
  border: none;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  ${p => p.$active && 'box-shadow: inset 3px 0 0 #0D9488;'}
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
  &:hover { ${p => !p.$active && 'background: #F8FAFC;'} }
  /* 운영 #283 — "메일은 모바일 리스트가 문서랑 다르게 스타일 안맞고".
     Q docs 의 RowItem(components/Docs/PostsPage.tsx)이 정본이다: padding 10px **12px**.
     메일만 좌우 10px 이라 폰에서 두 리스트를 오가면 들여쓰기가 어긋나 보였다.
     ★ ≤640px 에서만 맞춘다 — 데스크탑 값은 건드리지 않아 회귀 표면을 만들지 않는다. */
  @media (max-width: 640px) { padding: 10px 12px; }
`;
export const ThreadRow1 = styled.div`
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 4px;
`;
export const ThreadSender = styled.span`
  font-size: 13px; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 70%;
  /* #283 — 폰에서는 발신자를 **메타 톤**으로 내린다. Q docs 행은 "제목(진한 검정) → 미리보기" 라
     한 눈에 제목이 먼저 읽히는데, 메일만 발신자가 제일 진하고 제목이 흐려 위계가 반대로 보였다.
     정보는 그대로 두고 **강조만** 문서 쪽 규칙에 맞춘다. */
  @media (max-width: 640px) { font-size: 12px; font-weight: 600; color: #64748B; }
`;
export const ThreadTime = styled.span`
  font-size: 11px; color: #94A3B8; flex-shrink: 0;
`;
export const ThreadSubject = styled.div<{ $unread: boolean }>`
  display: flex; align-items: center; gap: 6px;
  font-size: 13px;
  font-weight: ${p => p.$unread ? 600 : 500};
  color: #334155;
  margin-bottom: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  /* #283 — Q docs RowTitle 정본값(13px / 700 / #0F172A). 폰에서 제목이 행의 주인공이 된다. */
  @media (max-width: 640px) {
    font-weight: ${p => p.$unread ? 700 : 600};
    color: #0F172A;
  }
`;
export const UnreadDot = styled.span`
  display: inline-block; flex-shrink: 0;
  width: 8px; height: 8px; border-radius: 50%;
  background: #14B8A6;
`;
export const ThreadPreview = styled.div`
  font-size: 12px; color: #64748B;
  line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  /* #283 — Q docs RowPreview 정본값(margin-top 4px / line-height 1.5 / 2줄 clamp). */
  @media (max-width: 640px) { margin-top: 4px; line-height: 1.5; }
`;
// M3-B — 행 별표 + 라벨 칩
export const ThreadRow1Right = styled.span`
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
`;
export const StarSpan = styled.span<{ $on: boolean }>`
  font-size: 14px; line-height: 1; cursor: pointer;
  color: ${p => p.$on ? '#F59E0B' : '#CBD5E1'};
  &:hover { color: ${p => p.$on ? '#D97706' : '#94A3B8'}; }
`;
export const RowLabels = styled.div`
  display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;
`;
// M5 — Uncertain(확인 권장) 사유 배지 (Warning amber)
export const ReplyRow = styled.div`
  display: flex; align-items: center; gap: 6px; margin-top: 6px; min-height: 24px;
`;
export const OverdueChip = styled.span`
  font-size: 10px; font-weight: 700; color: #B91C1C; background: #FEF2F2;
  border: 1px solid #FECACA; border-radius: 999px; padding: 1px 7px;
`;
// 리스트 행의 처리 버튼 — 확인 완료 · 스팸 · 답변 불필요. 높이·정렬을 하나로 고정한다.
export const RowBtn = styled.button<{ $danger?: boolean }>`
  height: 24px; padding: 0 8px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; line-height: 1;
  color: ${(p) => (p.$danger ? '#94A3B8' : '#64748B')};
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px;
  cursor: pointer;
  &:first-of-type { margin-left: auto; }   /* 뱃지가 없으면 버튼 묶음이 우측으로 */
  &:hover:not(:disabled) {
    ${(p) => (p.$danger
      ? 'border-color: #FECACA; color: #B91C1C; background: #FEF2F2;'
      : 'border-color: #14B8A6; color: #0F766E; background: #F0FDFA;')}
  }
  &:disabled { opacity: 0.5; cursor: wait; }
`;
// 검토 권장 — 처리 버튼과 같은 줄 (높이 24px 로 버튼과 시각 정렬)
export const UncertainInline = styled.span`
  height: 24px; padding: 0 8px; margin-right: auto;
  display: inline-flex; align-items: center; gap: 3px;
  border-radius: 999px; background: rgba(245, 158, 11, 0.13); color: #92400E;
  font-size: 11px; font-weight: 700; line-height: 1;
`;
export const RuleBadge = styled.span`
  display: inline-flex; align-items: center; align-self: flex-start;
  margin-top: 4px; padding: 2px 8px; border-radius: 999px;
  background: #F1F5F9; color: #64748B; font-size: 11px; font-weight: 600;
`;
export const UncertainBadge = styled.span`
  display: inline-flex; align-items: center; gap: 3px; align-self: flex-start;
  margin-top: 4px; padding: 2px 8px; border-radius: 999px;
  background: rgba(245, 158, 11, 0.13); color: #92400E;
  font-size: 11px; font-weight: 700;
`;
// #221 — 확인 권장 뱃지의 대칭. 여태 리스트에는 '확인 권장' 만 있고 '답변 필요' 표시가 없어서,
//   다른 탭(전체·내 담당 등)에서 보면 그 메일이 답변 대기 중인지 알 수 없었다.
//   Irene: "그리고 답변필요도 표시해줘야지." 톤만 다르고 자리·형태는 UncertainBadge 와 동일하다.
export const ReplyNeededBadge = styled.span`
  display: inline-flex; align-items: center; gap: 3px; align-self: flex-start;
  margin-top: 4px; padding: 2px 8px; border-radius: 999px;
  background: rgba(244, 63, 94, 0.12); color: #9F1239;
  font-size: 11px; font-weight: 700;
`;
// #186 — '보낸' 태그 (제목 앞 인라인). 받은 메일과 즉시 구분.
export const SentTag = styled.span`
  display: inline-flex; align-items: center; flex-shrink: 0;
  margin-right: 5px; padding: 1px 6px; border-radius: 4px;
  background: rgba(20, 184, 166, 0.14); color: #0F766E;
  font-size: 10px; font-weight: 700; vertical-align: middle;
`;
// #184 — 번역 컨트롤 바 + 번역 본문
export const TransBar = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-top: 8px;
`;
export const TransSelect = styled.select`
  height: 28px; padding: 0 6px; border: 1px solid #E2E8F0; border-radius: 6px;
  background: #FFF; color: #334155; font-size: 12px; cursor: pointer;
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -1px; }
`;
export const TransBtn = styled.button`
  height: 28px; padding: 0 12px; border: 1px solid #14B8A6; border-radius: 6px;
  background: rgba(20, 184, 166, 0.08); color: #0F766E;
  font-size: 12px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: rgba(20, 184, 166, 0.16); }
  &:disabled { opacity: 0.6; cursor: default; }
`;
export const TransErr = styled.span`
  color: #DC2626; font-size: 12px;
`;
// #202 — 번역 중 표시. 버튼은 "취소" 로 바뀌므로 진행 상태를 별도 텍스트로 남긴다.
export const TransLoading = styled.span`
  color: #0F766E; font-size: 12px;
`;
export const TransBody = styled.div`
  margin-top: 8px; padding: 10px 12px; border-radius: 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0;
  color: #1E293B; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
`;
export const LabelChip = styled.span<{ $color: string; $clickable?: boolean }>`
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  color: ${p => p.$color};
  background: ${p => p.$color}1A;
  border: 1px solid ${p => p.$color}55;
  cursor: ${p => p.$clickable ? 'pointer' : 'default'};
`;
// 상세 헤더 좌측 (목록 열기 + 제목) — PanelHeader 안 왼쪽 슬롯.
//   운영 #283 — 목록 열기 버튼이 absolute 로 제목 위에 겹쳐 "상단이 잘린" 것처럼 보였다.
//   ★ PanelHeader 는 ≤640px 에서 flex-direction:column 이라, 버튼과 제목을 이 Row 로 묶지 않으면
//     폰에서 버튼이 제목 **위에 한 줄**로 쌓인다.
export const DetailHeaderLeft = styled.div`
  display: flex; align-items: center; gap: 8px;
  min-width: 0;   /* 제목 ellipsis 가 살아나려면 필요 */
  flex: 1 1 auto;
`;
// 인라인 목록 열기 — 겹치지 않고 자리를 차지한다.
//   ★ 시각 크기는 32px 이다. PanelHeader 는 641~1024px 에서 height:60px 고정 + padding:14px 라
//     콘텐츠 박스가 32px 뿐이어서 40px 버튼은 헤더를 넘친다. 터치 타겟은 pseudo-element 로
//     40×40 까지 넓혀 반응형 원칙(최소 터치 40)을 시각 정렬을 깨지 않고 만족시킨다.
export const ExpandBtnInline = styled.button`
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0; border-radius: 8px; flex-shrink: 0;
  border: 1px solid #E2E8F0; background: #fff; color: #64748B; cursor: pointer;
  &::after { content: ''; position: absolute; top: 50%; left: 50%;
    width: 40px; height: 40px; transform: translate(-50%, -50%); }
  &:hover { background: #F8FAFC; color: #0F172A; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
  @media (min-width: 1025px) { display: none; }
`;
// 상세 헤더 우측 (메시지 수·고객 칩 + 스팸) — PanelHeader 안 오른쪽 슬롯
export const DetailHeaderRight = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  flex-shrink: 0;
`;
// 맥락 패널 좌측 리사이즈 핸들 (Q Task 패턴 통일)
export const CtxResizeHandle = styled.div`
  position: absolute; top: 0; left: -3px; width: 6px; height: 100%;
  cursor: col-resize; z-index: 5;
  &:hover { background: rgba(20,184,166,0.2); }
  &:active { background: rgba(20,184,166,0.4); }
  @media (max-width: 1024px) { display: none; }
`;
// 상세 부가 툴바 (컨트롤·라벨) — PanelHeader 아래 별도 줄
export const DetailToolbar = styled.div`
  padding: 12px 20px;
  border-bottom: 1px solid #F1F5F9;
  background: #FFFFFF;
`;
export const MetaChip = styled.span`
  padding: 2px 8px;
  background: #F1F5F9; color: #475569;
  font-size: 11px; font-weight: 500;
  border-radius: 999px;
`;
// M3-B — 상세 헤더 컨트롤 (별표/팔로우/담당) + 라벨
export const DetailControls = styled.div`
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: 0;
`;
export const CtrlBtn = styled.button<{ $on: boolean }>`
  height: 28px; padding: 0 12px;
  border-radius: 999px;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  border: 1px solid ${p => p.$on ? '#5EEAD4' : '#E2E8F0'};
  background: ${p => p.$on ? '#F0FDFA' : '#FFFFFF'};
  color: ${p => p.$on ? '#0F766E' : '#64748B'};
  transition: background 0.12s, border-color 0.12s;
  &:hover { border-color: #5EEAD4; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
export const DetailLabels = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;
`;
export const AddLabelChip = styled.button<{ $color: string }>`
  padding: 2px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  cursor: pointer;
  color: ${p => p.$color};
  background: #FFFFFF;
  border: 1px dashed ${p => p.$color}88;
  &:hover { background: ${p => p.$color}12; }
`;
export const NewLabelInput = styled.input`
  height: 24px; padding: 0 10px;
  border: 1px dashed #CBD5E1; border-radius: 999px;
  font-size: 11px; color: #334155;
  width: 96px;
  &::placeholder { color: #94A3B8; }
  &:focus { outline: none; border-color: #14B8A6; border-style: solid; }
  &:disabled { opacity: 0.5; }
`;
export const AssignWrap = styled.div`
  min-width: 150px;
`;
export const DangerBtn = styled.button`
  margin-left: auto;
  height: 28px; padding: 0 12px;
  background: transparent; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 6px;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  &:hover { background: #FEF2F2; border-color: #FCA5A5; color: #991B1B; }
`;
// 메일 본문은 상세 패널(이미 카드) 안에서 또 카드로 감싸지 않는다 — 읽는 화면은 넓고 평평해야 한다.
// 메시지끼리는 구분선으로만 나누고, 내가 보낸 메일은 좌측 민트 라인 + 옅은 배경으로만 구분한다.
// 본문 iframe 은 내용 높이만큼 늘어나고, 길어지면 이 스크롤러가 끝까지 스크롤한다.
export const MessagesScroll = styled.div`
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 0 24px 24px;
  background: #FFFFFF;
  @media (max-width: 640px) { padding: 0 16px 16px; }
`;
export const MessageCard = styled.div<{ $outbound: boolean }>`
  background: ${p => p.$outbound ? '#F8FDFC' : 'transparent'};
  border-left: ${p => p.$outbound ? '3px solid #5EEAD4' : 'none'};
  padding-left: ${p => p.$outbound ? '13px' : '0'};
  border-bottom: 1px solid #E2E8F0;
  padding-bottom: 12px;
  &:last-child { border-bottom: none; padding-bottom: 0; }
`;
export const MessageHeader = styled.div<{ $clickable?: boolean }>`
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  padding: 16px 0 8px;
  background: transparent;
  ${p => p.$clickable && `
    cursor: pointer;
    &:hover { background: #F8FAFC; }
    &:focus-visible { outline: 2px solid #F43F5E; outline-offset: -2px; border-radius: 6px; }
  `}
`;
export const MsgHeaderRight = styled.div`display: flex; align-items: center; gap: 10px; flex-shrink: 0;`;

// 접힌 메시지의 한 줄 미리보기 (#262 M2) — 스레드를 열면 최신만 펼쳐지고 과거는 이 줄로 남는다.
export const MsgCollapsedPreview = styled.div`
  /* #272 — 옛 스타일은 회색 한 줄뿐이라 "본문이 잘린 것"처럼 보였다.
     옅은 카드로 감싸 "이건 접힌 요약" 이라고 형태로 말한다. */
  margin: 0 0 12px;
  padding: 7px 10px;
  background: #F8FAFC;
  border: 1px solid #EEF2F6;
  border-radius: 8px;
  font-size: 13px; line-height: 1.5;
  color: #94A3B8;
  cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &:hover { color: #64748B; background: #F1F5F9; }
`;

// 접힘/펼침 표시 — 헤더 우측. 펼치면 180도 회전.
export const MsgChevron = styled.span<{ $open: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  color: #94A3B8; flex-shrink: 0;
  transform: rotate(${p => (p.$open ? '180deg' : '0deg')});
  transition: transform 0.18s ease;
  @media (prefers-reduced-motion: reduce) { transition: none; }
`;

// 후속 조치 칩 — 스레드 목록에서 "답이 안 왔다 / 애초에 안 나갔다" 를 알린다.
export const FollowUpChip = styled.span<{ $tone: 'warn' | 'err' }>`
  display: inline-flex; align-items: center; align-self: flex-start;
  margin-top: 4px; padding: 2px 8px; border-radius: 10px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
  background: ${p => (p.$tone === 'warn' ? '#FFFBEB' : '#FEF2F2')};
  color: ${p => (p.$tone === 'warn' ? '#D97706' : '#DC2626')};
  border: 1px solid ${p => (p.$tone === 'warn' ? '#FDE68A' : '#FECACA')};
`;

// 발송 상태 칩 — 읽기 전용 상태 표시(버튼 아님)라 상태 색을 쓴다. UI_DESIGN_GUIDE §1.7 3톤 규칙은 액션 버튼 한정.
// 2R-2 — 'info' 는 낙관 반영 중인 "발송 중…" 카드용. 아직 실패가 아니므로 빨강/노랑을 쓰지 않는다.
const CHIP_TONE = {
  warn: { bg: '#FFFBEB', fg: '#D97706', bd: '#FDE68A' },
  err: { bg: '#FEF2F2', fg: '#DC2626', bd: '#FECACA' },
  info: { bg: '#F1F5F9', fg: '#475569', bd: '#CBD5E1' },
} as const;
export const DeliveryChip = styled.span<{ $tone: 'warn' | 'err' | 'info' }>`
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: 10px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
  background: ${p => CHIP_TONE[p.$tone].bg};
  color: ${p => CHIP_TONE[p.$tone].fg};
  border: 1px solid ${p => CHIP_TONE[p.$tone].bd};
`;
export const MsgForwardBtn = styled.button`
  background: transparent; border: 1px solid #E2E8F0; color: #475569;
  padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #F0FDFA; border-color: #99F6E4; color: #0F766E; }
`;
export const MessageFrom = styled.div`
  font-size: 13px; font-weight: 600; color: #0F172A;
`;
export const MessageTime = styled.div`
  font-size: 11px; color: #94A3B8;
`;
export const MessageBodyFrame = styled.iframe`
  width: 100%;
  min-height: 40px;   /* 짧은 답장은 짧게 — 아래가 비어 늘어지지 않는다 */
  border: none;
  display: block;
  background: transparent;
`;
export const MessageBodyText = styled.div`
  padding: 4px 0 8px;
  font-size: 14px; color: #334155;
  white-space: pre-wrap;
  font-family: -apple-system, sans-serif;
  line-height: 1.6;
`;
export const Attachments = styled.div`
  padding: 10px 0 2px;
  border-top: 1px solid #F1F5F9;
  display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px;
`;
export const Attachment = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: #475569; font-family: inherit;
  padding: 5px 10px; border: 1px solid #E2E8F0; border-radius: 8px; background: #F8FAFC;
  cursor: pointer; transition: border-color 0.12s, color 0.12s, background 0.12s;
  & > svg { width: 13px; height: 13px; flex-shrink: 0; }
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; background: #F0FDFA; }
  &:disabled { cursor: default; opacity: 0.7; }
`;
// #215-I — 스레드 리스트 1행 우측 메타의 첨부 클립. 정보성 아이콘이라 ThreadTime 과 같은 slate 톤,
//   강조 칩(하단 위계)과 섞지 않는다. flex-shrink:0 이라 좁은 폭에서도 제목 줄을 먹지 않는다.
export const ListClip = styled.span`
  display: inline-flex; align-items: center; flex-shrink: 0;
  color: #94A3B8;
  & > svg { width: 13px; height: 13px; }
`;
// #215 — 첨부 칩 + 내려받기 아이콘을 한 덩어리로 묶는다 (칩 본체 = 미리보기, 아이콘 = 내려받기).
export const AttachmentGroup = styled.div`
  display: inline-flex; align-items: center; gap: 4px;
`;
export const AttachDownloadBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #F8FAFC;
  color: #64748B; cursor: pointer; transition: border-color 0.12s, color 0.12s, background 0.12s;
  & > svg { width: 13px; height: 13px; }
  &:hover { border-color: #14B8A6; color: #0F766E; background: #F0FDFA; }
  /* 터치 환경에서 타겟 확보 — 반응형 원칙 2 (아이콘 버튼 최소 36) */
  @media (hover: none), (max-width: 640px) { width: 36px; height: 36px; }
`;
export const AttachErr = styled.span`
  font-size: 11px; font-weight: 500; color: #B91C1C;
`;
// 하단 액션 영역 — 본문과 같은 흰 바탕. 회색/흰 박스를 겹쳐 띄우지 않는다(박스 속 박스 금지).
export const DetailFooter = styled.div`
  padding: 14px 24px;
  border-top: 1px solid #E2E8F0;
  background: #FFFFFF;
  max-height: 55vh;
  overflow-y: auto;
`;
export const ReplyBar = styled.div`
  display: flex; align-items: center; justify-content: flex-start; gap: 8px;
  padding: 0; border: none; background: transparent;
`;
export const Composer = styled.div`
  display: flex; flex-direction: column; gap: 10px;
`;
export const ComposerTo = styled.div`
  font-size: 12px; color: #64748B;
  strong { color: #0F172A; font-weight: 600; }
`;
export const ComposerError = styled.div`
  padding: 8px 10px;
  background: #FEF2F2; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 8px;
  font-size: 12px;
`;
// 좌측 정렬 고정 — [보내기] [AI] [취소]. 버튼이 좌우로 튀지 않게 space-between 을 쓰지 않는다.
export const ComposerActions = styled.div`
  display: flex; align-items: center; justify-content: flex-start; gap: 8px;
  flex-wrap: wrap;
`;
// #192 — AI 초안 수정 요청 입력. 초안이 있을 때만 노출. 지시를 넣고 "다시 생성" 하면 refine.
export const AiInstructionRow = styled.div`
  display: flex; align-items: center; gap: 8px;
  margin: 2px 0 2px;
`;
export const AiInstructionInput = styled.input`
  flex: 1; min-width: 0; height: 34px; padding: 0 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #334155; background: #fff;
  &::placeholder { color: #94A3B8; }
  &:focus { outline: none; border-color: #F43F5E; box-shadow: 0 0 0 3px rgba(244,63,94,0.12); }
  &:disabled { opacity: 0.5; }
`;
export const AiInstructionHint = styled.span`
  font-size: 11px; color: #94A3B8; white-space: nowrap;
  @media (max-width: 640px) { display: none; }
`;
export const ComposerHint = styled.div`
  font-size: 11px; color: #94A3B8;
`;
// AI 답변 제안 — Coral 강조 (AI 감지/액션 컬러)
// 자동·마케팅 메일 — AI 답변 비노출 안내 (게이트)
export const Loading = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 60px 24px;
  font-size: 13px; color: #94A3B8;
  gap: 12px;
`;
export const Spinner = styled.div`
  width: 24px; height: 24px;
  border: 2px solid #E2E8F0;
  border-top-color: #14B8A6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
export const ErrorBar = styled.div`
  margin: 12px 16px;
  padding: 10px 12px;
  background: #FEF2F2; color: #B91C1C;
  border: 1px solid #FECACA; border-radius: 8px;
  font-size: 12px;
`;
export const EmptyList = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; padding: 48px 24px; gap: 12px;
`;
export const EmptyIcon = styled.svg`
  width: 48px; height: 48px;
  color: #CBD5E1;
`;
export const EmptyText = styled.div`
  font-size: 13px; color: #64748B;
`;
export const Empty = styled.div`
  padding: 60px 24px; text-align: center;
  font-size: 13px; color: #64748B;
`;
// 첨부 아이콘 — 이모지(📎) 대신 SVG (플랫폼 아이콘 통일, 폰트 의존 제거)
export const ClipIcon = styled.svg`
  width: 13px; height: 13px; flex-shrink: 0; vertical-align: -2px; color: #64748B;
`;
// 작업대 오버레이 뒤 dim (태블릿·폰)
export const CtxBackdrop = styled.div`
  position: fixed; inset: 0; z-index: 40;
  background: rgba(15, 23, 42, 0.35);
  @media (min-width: 1025px) { display: none; }
`;
// 보내는 사람(Send-as) — 주소가 2개 이상일 때만 뜬다
export const ComposerFrom = styled.div`display: flex; align-items: center; gap: 8px;`;
export const FromLbl = styled.span`font-size: 12px; color: #64748B; flex-shrink: 0;`;
export const FromSelect = styled.div`flex: 1; min-width: 0; max-width: 320px;`;
// 처리됨 — 그 자리에 남되 조용히 물러난다 (행을 지우면 아래가 위로 밀려 읽던 자리가 흔들린다)
export const HandledBadge = styled.span`
  height: 24px; padding: 0 8px; margin-left: auto;
  display: inline-flex; align-items: center;
  border-radius: 999px; background: #F1F5F9; color: #94A3B8;
  font-size: 11px; font-weight: 700; line-height: 1;
`;
// 받은 주소 — 메시지 헤더 보조 줄
export const MessageTo = styled.div`
  margin-top: 2px; font-size: 11px; color: #94A3B8; font-weight: 500;
`;
// 보내는 주소가 하나뿐일 때 — 설정으로 가는 길
export const FromManage = styled.button`
  flex-shrink: 0; border: none; background: none; padding: 0 2px; cursor: pointer;
  font-size: 11px; font-weight: 600; color: #0F766E;
  &:hover { text-decoration: underline; }
`;

// 폴더 맥락 일괄 액션 버튼 — Secondary(ghost). $confirm 이면 2단계 확인(Coral 강조).
// 운영 #308 — "모두 읽음 버튼이 혼자 큰데... 회색 버튼으로 하거나 뭔가 조치를 취해서 버튼 역할이라고
//   알 수 있게만 하고 사이즈는 필터랑 같게." 같은 줄에 선 FilterToggleBtn 은 28px/7px/투명인데
//   이것만 36px/8px/흰배경이라 줄이 어그러져 보였다. 치수는 필터와 **같은 값**을 쓰고
//   (min-height 28 · padding 4px 9px · radius 7 · font 12/600), 대신 배경을 회색으로 채워
//   "누를 수 있는 것" 임을 형태로 알린다(필터 토글은 투명 — 둘이 구분된다).
export const BulkAction = styled.button<{ $confirm?: boolean }>`
  flex-shrink: 0; align-self: center;
  display: inline-flex; align-items: center; gap: 5px;
  min-height: 28px; padding: 4px 9px; margin-left: auto;
  border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer;
  white-space: nowrap;
  & > svg { flex-shrink: 0; }
  background: ${(p) => (p.$confirm ? '#FFF1F2' : '#F1F5F9')};
  color: ${(p) => (p.$confirm ? '#E11D48' : '#475569')};
  border: 1px solid ${(p) => (p.$confirm ? '#FDA4AF' : '#E2E8F0')};
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  &:hover:not(:disabled) {
    background: ${(p) => (p.$confirm ? '#FFE4E6' : '#E2E8F0')};
    border-color: ${(p) => (p.$confirm ? '#FB7185' : '#CBD5E1')};
    color: ${(p) => (p.$confirm ? '#BE123C' : '#0F172A')};
  }
  &:disabled { opacity: 0.55; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;

// 2R-1 — 스레드 전환 스켈레톤. 옛 스레드 내용을 즉시 지우고 이 고스트를 띄운다
//   (Irene: "리스트 클릭해도 상세내용이 너무 늦게 나와"). 스피너 하나보다 "무엇이 올지"가 보여
//   체감 대기가 짧다. 실제 카드와 같은 여백을 써서 도착 시 레이아웃이 튀지 않는다.
export const DetailSkeleton = styled.div`
  padding: 16px 20px;
  display: flex; flex-direction: column; gap: 14px;
`;
export const SkelLine = styled.div<{ $w?: string; $h?: number }>`
  width: ${(p) => p.$w || '100%'};
  height: ${(p) => p.$h || 12}px;
  border-radius: 6px;
  background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 37%, #F1F5F9 63%);
  background-size: 400% 100%;
  animation: pqShimmer 1.2s ease-in-out infinite;
  @keyframes pqShimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
`;
export const SkelCard = styled.div`
  border: 1px solid #E2E8F0; border-radius: 10px; background: #fff;
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px;
`;
