// Q Mail 화면 스타일 — MailPage.tsx 에서 분리 (god-file 가드: 컴포넌트 파일 800줄 상한).
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
  padding: 4px 8px 0;
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
  margin: 8px 10px; padding: 0 10px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  flex-shrink: 0;
  &:focus-within { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.1); }
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
export const AcctFilterRow = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 0 14px 10px;
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
export const ComposeBody = styled.div`
  padding: 16px 20px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 12px;
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
export const ComposeFoot = styled.div`
  padding: 12px 20px; border-top: 1px solid #E2E8F0;
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
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
`;
export const ThreadRow1 = styled.div`
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 4px;
`;
export const ThreadSender = styled.span`
  font-size: 13px; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 70%;
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
// 리스트 행의 처리 버튼 — 확인 완료 · 스팸 · 답변 완료. 높이·정렬을 하나로 고정한다.
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
export const LabelChip = styled.span<{ $color: string; $clickable?: boolean }>`
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  color: ${p => p.$color};
  background: ${p => p.$color}1A;
  border: 1px solid ${p => p.$color}55;
  cursor: ${p => p.$clickable ? 'pointer' : 'default'};
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
export const MessageHeader = styled.div`
  display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
  padding: 16px 0 8px;
  background: transparent;
`;
export const MsgHeaderRight = styled.div`display: flex; align-items: center; gap: 10px; flex-shrink: 0;`;
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
  display: flex; flex-direction: column; gap: 4px;
`;
export const Attachment = styled.div`
  font-size: 12px; color: #475569;
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
export const ComposerHint = styled.div`
  font-size: 11px; color: #94A3B8;
`;
// AI 답변 제안 — Coral 강조 (AI 감지/액션 컬러)
// 자동·마케팅 메일 — AI 답변 비노출 안내 (게이트)
export const AiGatedHint = styled.span`
  font-size: 12px; color: #94A3B8;
  display: inline-flex; align-items: center;
`;
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
