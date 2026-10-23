// PostsPage 의 모양 정의(styled) — 동작 불변으로 옮겼다(2026-10-22, god-file 래칫: 3318줄 동결을 넘어 배포 게이트가 막았다).
//   값은 한 글자도 바꾸지 않았다. 새 모양은 여기에 더한다.
import { listRowTitleCss } from '../../theme/tokens';
import styled from 'styled-components';
import PanelHeader, { DetailMetaBar, DetailMetaLeft, DetailMetaRight, backButtonLook } from '../Layout/PanelHeader';
import { FolderRow as AtRow } from './assetTabLayout';
import { phoneIconOnly } from '../Common/headerCta';

// ─── styled ─── (Q Note 패턴 — Sidebar + Content 2컬럼 + PanelHeader)
export const PrintOnlyTitle = styled.h1`
  display: none;
  @media print {
    display: block;
    font-size: 1.5rem; font-weight: 700; color: #0F172A; margin: 0 0 16px 0;
  }
`;
export const Layout = styled.div<{ $collapsed?: boolean; $projectFull?: boolean; $hasDetail?: boolean; $listW?: number }>`
  display: grid;
  /* 좌측 리스트 폭 — Q note 와 동일 (300px). 좌측 리스트 패턴 통일 */
  /* 프로젝트 스코프: 단일 컬럼. browse 시 ProjBrowse(파일 탭과 동일한 Toolbar+Split) 가 셀을 채우고,
     문서를 열면(상세/편집) 같은 셀에 상세를 풀폭으로 렌더. */
  /* ★ 운영 (Irene 2026-08-28): "문서에서 좌측메뉴 닫으면 편집하던 화면이 하얗게 돼."
     접으면 위의 Sidebar 가 조건부 렌더(!sidebarCollapsed &&)로 **DOM 에서 사라진다.** 그런데 여기서
     첫 칸을 0 으로 남겨두면, 남은 본문(section)이 그 **0px 칸**에 들어가 화면이 통째로 없어진다.
     ★ 이 주석에 백틱을 쓰지 말 것 — styled 템플릿이 그 자리에서 끊긴다(memory 박제된 함정).
     실측(1440px·1000px 둘 다): cols "0px 1376px" · 자식 [section:0] · 에디터 폭 0 · painted 0/111.
     칸 수는 **실제로 렌더되는 자식 수와 맞아야 한다** → 접힘은 단일 칸.
     (0 폭 칸을 남기려면 Sidebar 를 계속 마운트해야 하는데, 그건 Q Mail/Q Note 의
      CollapsibleSidebar(visibility:hidden) 방식이다. 여기는 조건부 렌더라 칸을 없애는 쪽이 맞다.) */
  grid-template-columns: ${p => (p.$projectFull || p.$collapsed) ? '1fr' : `${p.$listW || 300}px 1fr`};
  height: 100%; min-height: 0;
  /* 경계선 핸들(PanelEdgeHandle)이 이 컨테이너 기준으로 absolute 배치된다 */
  position: relative;
  background: #F8FAFC;
  overflow: hidden;
  transition: grid-template-columns 0.18s ease;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;

// 좌측 사이드바 (리스트)
export const Sidebar = styled.aside<{ $hasDetail?: boolean; $projectFull?: boolean }>`
  display: flex; flex-direction: column; position: relative;
  background: #fff; border-right: 1px solid #E2E8F0;
  min-height: 0;
  /* 프로젝트: 카테고리 패널(좌). 단 문서를 열면(상세/편집) 숨겨 상세를 풀폭으로. */
  ${p => (p.$projectFull && p.$hasDetail) ? 'display: none;' : ''}
  @media (max-width: 900px) {
    border-right: none; border-bottom: 1px solid #E2E8F0;
    /* 모바일에서 문서 선택 시 리스트 숨기고 상세만 표시 */
    display: ${p => p.$hasDetail ? 'none' : 'flex'};
  }
`;
// 우측 컨텐츠 — background 를 Content 에 직접 부여
// 제목 + 헬프 아이콘 묶음 — Q note 와 동일 (제목 끝나면 바로 helpDot 붙임)
export const TitleGroup = styled.div`
  /* ★ flex-basis 가 auto 면 "내용이 길다" 는 이유만으로 제목 칸이 버튼에 밀린다.
     0 으로 못 박아야 좁은 패널에서도 제목이 먼저 자리를 갖는다. */
  display: flex; align-items: center; gap: 4px; min-width: 0; flex: 1 1 0;
`;
export const HeaderBtnRow = styled.div`display:flex;align-items:center;gap:6px;flex-shrink:0;`;
/* ★ 2026-09-15 — 툴바 한 줄 안의 컨트롤은 **같은 높이 36px** 이다(검색 36 · 정렬 셀렉트 36).
     실측에서 버튼만 32/30 이라 줄이 들쭉날쭉했다. components/Common/filterBar 의 같은 계약. */
export const NewBtn = styled.button`
  height: 36px; padding: 0 14px; gap: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #14B8A6; color: #fff; border: none; border-radius: 8px; cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
  ${phoneIconOnly(36)}
`;
// 사이클 N+22 — + 드롭다운 (빈 문서 / 표)
export const NewBtnWrap = styled.div`position: relative;`;
export const NewDropdown = styled.div`
  position: absolute; top: calc(100% + 6px); right: 0;
  min-width: 220px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px;
  box-shadow: 0 8px 24px -6px rgba(15,23,42,0.18);
  z-index: 100; overflow: hidden;
  animation: pqDocsNewDdFade 0.12s ease-out;
  @keyframes pqDocsNewDdFade { from { opacity: 0; } to { opacity: 1; } }
  /* 모바일 — 헤더 아래 우측 정렬 */
  @media (max-width: 640px) {
    position: fixed;
    top: calc(var(--pq-chrome-bottom, 56px) + 12px);
    right: 16px;
    left: auto;
    min-width: auto;
    width: 200px;
  }
`;
export const NewItem = styled.button`
  display: block; width: 100%; text-align: left;
  padding: 10px 14px;
  background: transparent; border: none; cursor: pointer;
  &:hover { background: #F8FAFC; }
  &:focus-visible { background: #F0FDFA; outline: none; }
  & + & { border-top: 1px solid #F1F5F9; }
`;
export const NewItemTitle = styled.div`font-size: 0.8125rem; font-weight: 600; color: #0F172A;`;
export const NewItemDesc = styled.div`font-size: 0.6875rem; color: #94A3B8; margin-top: 2px;`;
/* ★ 2026-08-31 (Irene): "템플릿으로 저장 누르면 좌측 메뉴 세로 화살표가 팝업 위로 나와.
     모든 팝업은 최상단 위치 통일한 거 아니야?" — 맞다. 그런데 **이 페이지는 공용 모달을 안 쓰고
     자기 모달을 따로 만들어** 60/70 을 썼다. 페이지 층 핸들(FloatingPanelToggle, z-index 90)보다
     낮아 화살표가 팝업 위로 올라왔다.
     오버레이는 공용 모달과 같은 층(1100/1110)에 둔다 — 베낀 컴포넌트는 반드시 갈라진다
     (memory: copied_component_drifts_extract_shell). */
export const ModalBackdrop = styled.div`
  position: fixed; inset: var(--pq-popup-top, 0px) 0 0; background: rgba(15,23,42,0.08);
  z-index: 1100;
`;
export const ModalDialog = styled.div`
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 1110; width: 540px; max-width: calc(100vw - 40px); max-height: calc(100vh - 48px);
  background: #FFF; border-radius: 14px;
  box-shadow: 0 30px 60px -20px rgba(15,23,42,0.25);
  display: flex; flex-direction: column; overflow: hidden;
  /* 모바일 — Q Calendar 패턴: 헤더(70px) 아래로 배치 */
  @media (max-width: 640px) {
    top: calc(var(--pq-chrome-bottom, 56px) + 14px); bottom: 20px; left: 16px; right: 16px;
    transform: none; width: auto; max-width: none; max-height: none;
  }
`;
export const ModalHead = styled.div`
  display:flex;justify-content:space-between;align-items:center;
  padding: 14px 18px; border-bottom: 1px solid #E2E8F0; flex-shrink: 0;
`;
export const ModalTitle = styled.h2`font-size:0.9375rem;font-weight:700;color:#0F172A;margin:0;letter-spacing:-0.1px;`;
export const ModalClose = styled.button`
  width:30px;height:30px;border:none;background:transparent;color:#64748B;cursor:pointer;border-radius:6px;
  display:flex;align-items:center;justify-content:center;
  &:hover{background:#F1F5F9;color:#0F172A;}
`;
export const ModalBody = styled.div`
  padding: 16px 18px; overflow-y: auto; flex: 1; min-height: 0;
  display: flex; flex-direction: column; gap: 14px;
`;
export const ModalSub = styled.p`font-size:0.75rem;color:#64748B;margin:0;line-height:1.5;`;
export const TplGrid = styled.div`display:grid;grid-template-columns:repeat(2,1fr);gap:8px;flex:1;overflow-y:auto;@media(max-width:520px){grid-template-columns:1fr;}`;
export const TplCard = styled.button`
  display:flex;gap:10px;padding:12px;font-family:inherit;text-align:left;
  background:#FFF;border:1px solid #E2E8F0;border-radius:10px;cursor:pointer;
  transition:border-color 0.15s,background 0.15s;
  &:hover{border-color:#14B8A6;background:#F0FDFA;}
`;
export const TplCardIcon = styled.div`flex:0 0 auto;color:#0F766E;display:inline-flex;align-items:flex-start;`;
export const TplBadgeSys = styled.span`flex:0 0 auto;font-size:0.625rem;font-weight:700;color:#0F766E;background:#F0FDFA;border:1px solid #14B8A6;border-radius:999px;padding:1px 8px;align-self:flex-start;`;
export const TplSearchInput = styled.input`
  width:100%;padding:8px 12px;font-size:0.8125rem;color:#0F172A;
  border:1px solid #E2E8F0;border-radius:8px;background:#FFF;margin-bottom:12px;
  &:focus{outline:none;border-color:#14B8A6;}
  &::placeholder{color:#94A3B8;}
`;
export const PinDot = styled.span`
  display:inline-block;width:6px;height:6px;border-radius:50%;background:#F43F5E;margin-right:6px;flex:0 0 auto;
`;
export const ParentLink = styled.a`
  display: inline-flex; align-items: center;
  margin-left: 12px;
  padding: 2px 10px;
  font-size: 0.6875rem; font-weight: 600;
  color: #0F766E;
  background: #F0FDFA;
  border: 1px solid #CCFBF1;
  border-radius: 999px;
  text-decoration: none;
  transition: background 0.15s;
  &:hover { background: #CCFBF1; }
`;
export const SaveTplField = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:10px;`;
export const SaveTplLabel = styled.label`font-size:0.75rem;font-weight:600;color:#0F172A;`;
export const SaveTplError = styled.div`font-size:0.75rem;color:#DC2626;background:#FEF2F2;padding:8px 10px;border-radius:6px;margin-bottom:8px;`;
export const ModalFooter = styled.div`
  padding: 12px 18px; border-top: 1px solid #E2E8F0;
  display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0;
`;
export const TplCardBody = styled.div`flex:1;min-width:0;`;
export const TplCardName = styled.div`font-size:0.8125rem;font-weight:600;color:#0F172A;margin-bottom:2px;`;
export const TplCardDesc = styled.div`font-size:0.6875rem;color:#64748B;line-height:1.4;`;
export const Empty = styled.div`grid-column:1/-1;padding:32px;text-align:center;color:#94A3B8;font-size:0.8125rem;`;
export const SearchWrap = styled.div`
  padding: 12px 16px 8px; border-bottom: 1px solid #F1F5F9;
  display: flex; align-items: center; gap: 8px;
  & > :first-child { flex: 1; min-width: 0; }
`;
export const FilterSection = styled.div`
  padding: 10px 16px; border-bottom: 1px solid #F1F5F9;
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  max-height: 160px; overflow-y: auto;
`;
export const FilterGroupLabel = styled.div`
  width: 100%; font-size: 0.625rem; font-weight: 700; color: #94A3B8;
  text-transform: uppercase; letter-spacing: 0.3px;
  margin-top: 4px;
  &:first-child { margin-top: 0; }
`;
export const Chip = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 999px;
  background: ${p => p.$active ? '#14B8A6' : '#F1F5F9'};
  color: ${p => p.$active ? '#fff' : '#475569'};
  border: 1px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  font-size: 0.6875rem; font-weight: 600;
  transition: all 0.15s;
  &:hover { background: ${p => p.$active ? '#0D9488' : '#E2E8F0'}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
export const Count = styled.span`
  background: rgba(15, 23, 42, 0.08); color: #64748B;
  padding: 0 6px; border-radius: 999px; font-size: 0.625rem; font-weight: 700;
  ${Chip}[data-active="true"] & { background: rgba(255, 255, 255, 0.25); color: #fff; }
`;
export const ColorDot = styled.span<{ $color: string }>`
  width: 6px; height: 6px; border-radius: 50%; background: ${p => p.$color};
`;
export const AddCatBtn = styled.button`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center;
  padding: 4px 10px; border-radius: 999px;
  background: transparent; color: #0F766E;
  border: 1px dashed #99F6E4;
  font-size: 0.6875rem; font-weight: 600;
  transition: all 0.15s;
  &:hover { background: #F0FDFA; border-color: #14B8A6; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
export const NewCatInput = styled.input`
  height: 24px; padding: 0 10px; border: 1px solid #14B8A6; border-radius: 999px;
  background: #fff; font-size: 0.6875rem; color: #0F172A; min-width: 140px;
  &:focus { outline: none; box-shadow: 0 0 0 2px rgba(20,184,166,0.2); }
`;

// 리스트 (세로 무제한 스크롤)
export const RowList = styled.div`
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  overflow-y: auto;
  /* Q Talk/Mail/Note 리스트와 통일 — 둥근 행이 측면 여백 갖도록 (Irene: Q docs만 선 스타일이라 달랐음) */
  padding: 6px 6px 12px;
`;
// 프로젝트 문서 탭 browse 컨테이너 — 파일 탭(DocsTab) Body 흐름과 동일: 배경 #F8FAFC + padding 20 +
//   세로 flex(gap 12: Toolbar + Split). 내부는 공용 assetTabLayout(AtToolbar/AtSplit/AtPanel/AtArea/AtGrid/AtCard)
//   을 그대로 써서 파일 탭과 좌측 패널·카드·간격·툴바가 픽셀 동일. Layout 이 고정 높이라 자체 스크롤.
// Q Talk ChatRow / Mail ThreadItem 정확값 — 둥근 행, active=#F0FDFA + inset 3px 0 0 #0D9488, hover #F8FAFC.
// 가로 구분선 제거(Q docs만 선 스타일이라 달랐다 — Irene 통일 지시).
export const RowItem = styled.button<{ $active: boolean; $project?: boolean }>`
  all: unset; cursor: pointer; position: relative; display: block; width: 100%; box-sizing: border-box;
  padding: 10px 12px;
  padding-right: ${p => p.$project ? '40px' : '12px'};
  margin: 2px 0;
  border-radius: 10px;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  ${p => p.$active && 'box-shadow: inset 3px 0 0 #0D9488;'}
  transition: background 0.1s;
  &:hover { ${p => !p.$active && 'background: #F8FAFC;'} }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
// 행에서 '상단 메뉴에 추가(고정)' 토글 — 우측 상단 코너. 켜짐=teal, 꺼짐=흐린 회색(hover 시 진해짐).
export const RowPinBtn = styled.button<{ $on: boolean }>`
  position: absolute; top: 8px; right: 8px;
  width: 28px; height: 28px; padding: 0; border: none; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 0.8125rem; line-height: 1;
  background: ${p => p.$on ? '#F0FDFA' : 'transparent'};
  filter: ${p => p.$on ? 'none' : 'grayscale(1) opacity(0.4)'};
  transition: filter 0.15s ease, background 0.15s ease;
  &:hover { background: #F0FDFA; filter: none; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
// 운영 #257 — 제목이 길어도 1줄로 잘려 읽기 어려웠다(특히 프로젝트 > 문서).
//   2줄까지 보여주고 그 다음부터 말줄임. 뱃지(고정·임시저장)는 제목과 같은 흐름에 놓아
//   짧은 제목일 때 빈 줄이 생기지 않게 한다(높이는 내용만큼만).
//   ★ 이 컴포넌트는 Q docs 와 프로젝트 > 문서 탭이 함께 쓴다 — 한 번 고치면 두 화면에 같이 적용된다.
export const RowTitle = styled.div`
  /* ★ 규격을 **가져다 쓴다** (2026-09-17). 숫자를 적어 두면 폰 분기가 빠진다 —
     2026-09-08 에 Q talk·Q note 가 같은 이유로 13px 에 남아 있었고, 그때 토큰을 만들었는데
     이 화면은 받아 가지 않았다. 실측(390px): 문서 13 · 채팅 15 · 업무 15 · 노트 15 · 파일 15.
     Irene: *"문서랑 메일리스트 제목이 모바일에서만 작아. 채팅이랑 테스크 등은 사이즈 큰데 여기에 맞춰."* */
  ${listRowTitleCss}
  font-weight: 700;   /* 문서 목록은 제목을 더 굵게 (규격은 600, 여기만 덮어쓴다) */
  color: #0F172A;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; overflow-wrap: anywhere; line-height: 1.45;
  > * { vertical-align: middle; margin-right: 4px; }
`;
export const RowPreview = styled.div`
  margin-top: 4px; font-size: 0.75rem; color: #64748B; line-height: 1.5;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
`;
// 프로젝트 문서 카드의 본문 미리보기 — 워크스페이스 목록의 RowPreview 와 같은 규격.
export const CardPreview = styled.div`
  padding: 0 10px; margin-top: 2px; font-size: 0.75rem; color: #64748B; line-height: 1.45;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  word-break: break-word;
`;
export const CardAuthor = styled.span`
  color: #94A3B8;
  &::before { content: '·'; margin-right: 4px; }
`;
// N+72 — 리스트 row vlevel chip + share mini
export const RowVisChip = styled.span<{ $level: string }>`
  display: inline-flex; align-items: center;
  padding: 1px 7px; border-radius: 8px;
  font-size: 0.625rem; font-weight: 600;
  /* 알 수 없는 값(빈 값·새 등급)은 워크스페이스 색으로 칠하지 않는다 — 넓은 쪽으로 오해된다. */
  background: ${p => p.$level === 'L1' ? '#F1F5F9' : p.$level === 'L2' ? '#FEF3C7' : p.$level === 'L4' ? '#FCE7F3' : p.$level === 'L3' ? '#CCFBF1' : '#FEE2E2'};
  color: ${p => p.$level === 'L1' ? '#475569' : p.$level === 'L2' ? '#92400E' : p.$level === 'L4' ? '#9F1239' : p.$level === 'L3' ? '#0F766E' : '#B91C1C'};
`;
// N+72-7 — 본문↔표 사이 시각 간격 (사용자 호소 "들러붙어 보기 안좋아")
export const SectionGap = styled.div`
  height: 24px;
  @media (max-width: 640px) { height: 0; margin-top: -8px; }
`;
// 운영 — AI 재생성 바 행 (에디터 상단)
export const AiRegenRow = styled.div`
  display: flex; margin-bottom: 10px;
`;
// N+72-7 — 문서/표 kind toggle (편집 모드 MetaRow)
export const KindToggle = styled.div`
  display: inline-flex;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  overflow: hidden;
  background: #F8FAFC;
`;
export const KindBtn = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 5px;
  height: 32px; padding: 0 12px;
  background: ${p => p.$active ? '#FFFFFF' : 'transparent'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  border: none;
  font-size: 0.75rem; font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  box-shadow: ${p => p.$active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'};
  &:hover { color: ${p => p.$active ? '#0F766E' : '#334155'}; }
  & + & { border-left: 1px solid #E2E8F0; }
`;
// N+72-7 — 헤더 공개범위 chip (RowVisChip 보다 크고 button 형태, 클릭=변경)
export const ShareMini = styled.span`font-size: 0.6875rem; cursor: help;`;
export const RowMeta = styled.div`
  margin-top: 6px;
  display: flex; align-items: center; gap: 4px;
  font-size: 0.6875rem; color: #94A3B8; flex-wrap: wrap;
`;
export const Dim = styled.div`padding: 24px 16px; color: #94A3B8; font-size: 0.75rem; text-align: center;`;

export const Content = styled.section<{ $hasDetail?: boolean; $projectFull?: boolean; $editing?: boolean }>`
  display: flex; flex-direction: column;
  min-height: 0; overflow: hidden;
  background: #fff;
  /* 프로젝트: 우측 영역 — 문서 미선택 시 카드 그리드(browse), 선택 시 상세/편집 */
  /* 모바일에서 문서 미선택 시 Content 숨기고 리스트만 표시 */
  @media (max-width: 900px) {
    display: ${p => p.$hasDetail ? 'flex' : 'none'};
    /* 모바일: 헤더+본문 함께 스크롤 (세로 공간을 본문에 돌려주려는 의도) */
    /* 편집은 본문(EditBody)이 스크롤한다 — 아래 EditBody 설명 */
    overflow-y: ${p => p.$editing ? 'hidden' : 'auto'};
  }
`;
// ★ 2026-09-08 (Irene: "문서 상세로 가면 스크롤이 서브헤더에도 적용돼.
//   서브헤더 제목 나오는 곳 까지는 스티키되어 있어야 해.")
//   위 규칙 때문에 좁은 폭에서는 **Content 자체**가 스크롤 컨테이너가 되어, 제목 밴드까지
//   같이 올라갔다. 스크롤을 내리면 지금 보고 있는 문서가 무엇인지 화면에서 사라진다.
//   ★ 스크롤 구조는 바꾸지 않는다(본문에 세로 공간을 주려던 의도는 그대로다) —
//     **제목 밴드만** 그 컨테이너 안에서 붙여 둔다. 메타/액션 줄은 종전대로 같이 흐른다
//     ("제목 나오는 곳 **까지**" — 그 이상을 붙이면 좁은 화면에서 본문 자리를 또 뺏는다).
//   ★ 2026-09-13 (Irene: "헤더가 q docs에서 위로 자꾸 올라가. 서브헤더까지 고정이 되어야지.")
//     2026-09-08 에는 제목 밴드만 붙이고 메타 밴드는 흐르게 뒀다(본문 세로 공간을 아끼려고).
//     그런데 스크롤을 내리면 분류·공유·[서명 받기] 가 사라져 **지금 문서로 뭘 할 수 있는지**가
//     화면에서 없어진다. 이제 **두 밴드를 함께** 붙인다.
//   ★ 밴드2 에 `top: 60px` 같은 숫자를 주지 않는다 — 폰(≤640)에서 제목이 길면 밴드1 이
//     `height:auto` 로 자라기 때문에(PanelHeaderBar) 그 숫자가 곧 거짓이 되어 겹친다.
//     **두 밴드를 한 묶음으로 감싸** 묶음 하나만 붙인다(높이 계산이 아예 없다).
export const StickyBands = styled.div`
  flex-shrink: 0;
  @media (max-width: 900px) {
    position: sticky;
    top: 0;
    z-index: 3;
    background: #fff;
  }
`;
export const StickyPanelHeader = styled(PanelHeader)``;
export const Body = styled.div`
  flex: 1; min-height: 0;
  /* 좌우 0 — 에디터 툴바·구분선이 좌우 끝까지 풀폭. 글자 안쪽 여백은 아래 규칙으로 통일(Irene).
     에디터(.pq-fullbleed)만 풀폭 유지(자체 본문 여백), 그 외 모든 섹션은 좌우 24px. */
  /* 위 여백과 sticky 기준을 **한 변수에서** 파생시킨다 — 따로 적으면 언젠가 갈라져 툴바가 다시 뜬다 */
  --pq-body-pad-top: 20px;
  --pq-sticky-top: calc(var(--pq-body-pad-top) * -1);
  padding: var(--pq-body-pad-top) 0 20px;
  overflow-y: auto;
  background: #fff;
  display: flex; flex-direction: column; gap: 16px;
  & > *:not(.pq-fullbleed) { padding-left: 24px; padding-right: 24px; }
  @media (max-width: 900px) {
    /* 모바일: Content가 스크롤하므로 Body는 스크롤 안 함 */
    overflow-y: visible;
    padding: 16px 0;
  }
`;
// 편집 본문 — 좁은 폭에서도 **본문이** 스크롤한다(데스크탑과 같은 구조).
//   ★ 2026-10-20 (Irene «에디터가 뒤로 숨고 에디터기능들만 위로 올라와서 에러 같아») — 좁은 폭은 Content 가 스크롤하고
//     밴드 묶음(z 3)과 서식 툴바(z 5)가 **같은 스크롤 상자 맨 위**에 붙었다. 툴바가 제목·분류 밴드를 덮고
//     본문은 밴드 뒤로 지나갔다. 본문이 스크롤하면 밴드는 위에 서 있고 툴바는 본문 맨 위에 붙는다.
export const EditBody = styled(Body)`
  @media (max-width: 900px) {
    overflow-y: auto;
    --pq-body-pad-top: 16px;
    overscroll-behavior: contain;
  }
`;
export const TitleInput = styled.input`
  flex: 1; min-width: 0; height: 32px; padding: 0 10px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.9375rem; font-weight: 700; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
// #252 임시저장 상태 표시 — AutoSaveField 의 뱃지 톤과 동일 (성공 회색 ✓ / 실패 붉은 !).
export const AutoSaveMark = styled.span<{ $tone: 'ok' | 'err' }>`
  font-size: 0.75rem; white-space: nowrap;
  color: ${p => (p.$tone === 'err' ? '#DC2626' : '#94A3B8')};
  /* ★ 모바일에서 숨기지 않는다 — 실패·충돌이 안 보이면 저장된 줄 알고 창을 닫는다(조용한 실패 금지).
     좁은 화면에서는 글자만 줄인다. */
  @media (max-width: 640px) { font-size: 0.6875rem; }
`;
export const WideOnly = styled.span`
  @media (max-width: 640px) { display: none; }
`;
export const PhoneOnly = styled.span`
  display: none;
  @media (max-width: 640px) { display: inline; }
`;
export const AutoSaveText = styled.span`
  @media (max-width: 640px) { display: none; }
`;
// #252 — 목록의 임시저장(draft) 행 표시. 이 행은 작성자에게만 보인다(백엔드 필터).
export const DraftTag = styled.span`
  display: inline-flex; align-items: center; flex-shrink: 0;
  margin-right: 6px; padding: 1px 6px;
  background: #FFF7ED; color: #C2410C; border: 1px solid #FED7AA;
  border-radius: 999px; font-size: 0.625rem; font-weight: 700; line-height: 16px;
`;
// 상세 메타 — 헤더 아래 한 줄 MetaBar. 좌(작성자·날짜·분류·프로젝트) ↔ 우(공개·공유·보안). (Irene)
// 구분선은 좌우 끝까지(풀폭), 글자만 좌우 24px 안쪽.
// 상세 밴드2 — 좌(작성자·날짜·분류·프로젝트) / 우(공개·공유·보안 + 액션 3).
//   ★ 규격은 공용 DetailMetaBar 에서 온다. 여기서 padding·높이를 다시 쓰지 않는다 —
//     각자 만들면 좌우 패널의 옅은 밑줄이 같은 y 에서 어긋난다(Q Note 가 그렇게 갈라졌다).
//   2026-09-06: 옛 ViewMeta 는 **본문(Body) 안**에 있어 스크롤과 함께 사라졌고, 그 위에
//     액션 전용 밴드가 따로 있어 상세가 3밴드였다. 메타를 밴드로 올리고 액션을 그 오른쪽에
//     붙여 **두 밴드**로 끝낸다.
export const ViewMeta = styled(DetailMetaBar)`
  font-size: 0.75rem; color: #94A3B8;
`;
export const MetaLeft = styled(DetailMetaLeft)``;
export const MetaRight = styled(DetailMetaRight)``;
export const AiEditDoneBar = styled.div`
  display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
  padding: 8px 8px 8px 14px; border-radius: 8px; background: #F0FDFA; border: 1px solid #99F6E4;
  font-size: 0.8125rem; color: #0F766E; font-weight: 600;
  & > span { flex: 1; min-width: 0; }
`;
export const AiEditUndoBtn = styled.button`
  flex-shrink: 0; height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid #14B8A6;
  background: #FFFFFF; color: #0F766E; font-size: 0.8125rem; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #CCFBF1; }
  &:disabled { opacity: 0.6; cursor: default; }
  @media (max-width: 640px) { height: 40px; }
`;
export const AiEditCloseBtn = styled.button`
  flex-shrink: 0; width: 32px; height: 32px; border: none; background: none; color: #0F766E; cursor: pointer; border-radius: 8px;
  &:hover { background: #CCFBF1; }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
// ★ 액션 버튼 묶음 — 36px (좌측 리스트의 검색 박스와 같은 리듬). 버튼 자체는 32px 이라 여기서 올린다.
//   옛 액션 줄(ActionsMain)이 하던 일인데, 그 컴포넌트를 없애면서 규칙까지 사라져 32px 로 내려앉았다.
//   ★ 규칙을 MetaRight 에 직접 걸면 안 된다 — **VisibilityChip 도 styled.button 이라**(아래 3013 부근)
//     같이 잡혀 보기 36px / 편집 22px 로 갈라졌다 (2026-09-06 Fable 3차 P3).
//     "칩은 span" 이라고 적었던 내 주석이 **거짓**이었다. 넓은 선택자 대신 **묶음으로 범위를 좁힌다.**
export const MetaActions = styled.span`
  display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0;
  > button { height: 36px; }
`;
// 밴드1 우측 — ⋯ 하나만 선다.
export const HeaderActions = styled(DetailMetaRight)``;
// D4 #62 — 보안등급 선택 행 (DocsTab files 패턴 정합)
// 태그
// 이모지 금지(UI_DESIGN_GUIDE §1.5) — feather 계열 stroke 아이콘으로 교체.
export const PinTag = styled.span`display: inline-flex; align-items: center; color: #0D9488;`;
export const ProjectTag = styled.span<{ $color: string }>`
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
  background: #F1F5F9; color: #475569; border-radius: 999px; font-size: 0.625rem; font-weight: 600;
  &::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: ${p => p.$color}; }
`;
// ★ 'all: unset' 이 밴드2 의 'flex-shrink: 0 · nowrap' 까지 지워(같은 우선순위, 뒤에 선언됨) 좁아지면
//   «#아이린» 이 한 글자씩 세로로 꺾였다(2026-10-07). 지운 것을 여기서 다시 박는다.
export const CategoryTag = styled.button`
  all: unset; cursor: pointer;
  flex-shrink: 0; white-space: nowrap; word-break: keep-all;
  display: inline-flex; align-items: center; padding: 2px 8px;
  background: #F0FDFA; color: #0F766E;
  border-radius: 999px; font-size: 0.6875rem; font-weight: 600;
  &:hover { background: #CCFBF1; }
`;
// 편집 메타 — 한 줄(카테고리·프로젝트·형태·공개·보안). 좁으면 wrap. (Irene: 한 줄로)
// 한 줄에 서는 입력/셀렉트 칸 — 폭을 묶어 카테고리가 행을 독점하지 않게. 좁아지면 함께 줄고 접힌다.
//   ★ MetaRow 보다 **먼저** 선언해야 한다 — 아래에서 컴포넌트 선택자(`${MetaField}`)로 참조한다.
export const MetaField = styled.div<{ $basis: number }>`
  flex: 1 1 ${(p) => p.$basis}px;
  min-width: 150px;
  max-width: ${(p) => p.$basis + 80}px;
  /* 입력의 기본 최소 폭(약 20자)이 칸을 넘어 옆 칸 밑으로 겹친다 — 모든 폭에서 */
  & input { min-width: 0; }
  /* 폰은 두 칸씩 — 한 줄에 하나씩 쌓이면 세 칸이 200px 를 먹었다(2026-10-20) */
  @media (max-width: 640px) {
    flex: 1 1 calc(50% - 5px); min-width: 0; max-width: none;
  }
`;
// 구분선 풀폭, 글자만 좌우 24px 안쪽.
// 편집 모드 밴드2 — 분류·프로젝트·형태·공개·보안. 보기 모드의 ViewMeta 와 **같은 자리**라
//   보기↔편집을 오갈 때 가로 실선이 위아래로 튀지 않는다.
//   ★ 여기만 wrap 을 허용한다 — 폼 필드라 좁아지면 접혀야 입력이 가능하다. 그래서
//     DetailMetaBar 를 상속하지 않고 밴드 크롬(padding·밑줄)만 같은 값으로 맞춘다.
export const MetaRow = styled.div<{ $phoneOpen?: boolean }>`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 0;
  box-sizing: border-box; min-height: 57px; padding: 12px 20px 8px; background: #FFFFFF;
  border-bottom: 1px solid #F1F5F9; flex-shrink: 0;
  /* 폰: 요약 줄(MetaSummaryBtn)을 눌렀을 때만 편다. ★ 접어도 **언마운트하지 않는다** — 업무 연결 칸이
     아직 못 건 업무를 들고 있다(새 문서). 숨기기만 한다. */
  @media (max-width: 640px) {
    padding: 8px 14px; min-height: 0; gap: 8px;
    ${(p) => (p.$phoneOpen ? '' : 'display: none;')}
    & > [data-testid="post-task-link-field"] { flex: 1 1 100%; min-width: 0; }
  }
  /* 입력 중(키보드)에는 본문 자리를 위해 접는다 — 이 칸 안에서 입력 중이면 그대로 */
  @media (max-width: 768px) {
    body[data-keyboard-up='1'] &:not(:focus-within) { display: none; }
  }
  /* ★ 칩·토글은 줄어들면 글자가 잘리므로 고정. 입력·셀렉트는 MetaField 가 스스로 줄어든다. */
  & > *:not(${MetaField}) { flex-shrink: 0; }
`;
// 폰 편집 — 분류·연결 요약 한 줄(누르면 MetaRow 가 펴진다). 넓은 화면엔 없다.
export const MetaSummaryBtn = styled.button`
  display: none;
  @media (max-width: 640px) {
    display: flex; align-items: center; gap: 8px; width: 100%;
    min-height: 40px; padding: 0 14px; box-sizing: border-box;
    border: none; border-bottom: 1px solid #F1F5F9; background: #FFFFFF;
    font: inherit; text-align: left; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    &:active { background: #F8FAFC; }
  }
  @media (max-width: 768px) {
    body[data-keyboard-up='1'] & { display: none; }
  }
`;
export const MetaSummaryLabel = styled.span`
  flex-shrink: 0; font-size: 0.75rem; font-weight: 700; color: #475569;
`;
export const MetaSummaryValue = styled.span`
  flex: 1; min-width: 0; font-size: 0.75rem; color: #94A3B8;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
export const MetaSummaryChevron = styled.span<{ $open: boolean }>`
  flex-shrink: 0; display: inline-flex; color: #64748B;
  transition: transform 0.15s; transform: rotate(${(p) => (p.$open ? '180deg' : '0deg')});
`;
// N+67 — visibility chip (PostsPage detail meta row)
export const VisibilityChip = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  background: #F1F5F9; color: #475569;
  border: 1px solid #CBD5E1;
  border-radius: 12px;
  padding: 2px 10px;
  font-size: 0.6875rem; font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #E2E8F0; border-color: #94A3B8; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
export const ShareTag = styled.span`
  display: inline-flex; align-items: center; padding: 2px 8px;
  background: #FFF7ED; color: #C2410C; border-radius: 999px; font-size: 0.625rem; font-weight: 700;
  border: 1px solid #FED7AA;
`;
export const CategoryMini = styled.span`
  display: inline-flex; padding: 1px 6px; background: #F0FDFA; color: #0F766E;
  border-radius: 999px; font-size: 0.625rem; font-weight: 600;
`;

// 첨부 섹션 — 외곽 박스 없음, 상단 구분선으로 영역만 분리
export const AttachSection = styled.section`
  margin-top: 12px;
  padding-top: 16px;
  border-top: 1px solid #E2E8F0;
  display: flex; flex-direction: column; gap: 12px;
`;
export const AttachTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #334155;`;
// 운영 기준 한 줄 안내 — 제목 바로 아래. 길어지면 아무도 안 읽는다.
export const AttachScopeHint = styled.div`
  font-size: 0.75rem; color: #64748b; line-height: 1.45; margin: -2px 0 6px;
`;
export const AttachList = styled.div`
  display: flex; flex-direction: column;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden;
`;
export const AttachRow = styled.div`
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
  &:hover { background: #F8FAFC; }
`;
/* `as="button"` 으로도 쓰인다 — 인증이 필요한 다운로드는 링크로는 401 이라 버튼이어야 한다.
   버튼 기본 스타일(테두리·배경·폰트)을 지워 링크와 똑같이 보이게 맞춘다. */
export const AttachName = styled.a`
  flex: 1; min-width: 0; font-size: 0.8125rem; color: #0F172A; text-decoration: none;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
  background: none; border: none; padding: 0; font-family: inherit; cursor: pointer;
  &:hover { color: #0F766E; text-decoration: underline; }
  &:disabled { cursor: default; opacity: 0.7; }
`;
export const RemoveBtn = styled.button`
  all: unset; cursor: pointer; width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  color: #94A3B8; border-radius: 4px; font-size: 1rem;
  &:hover { background: #FEE2E2; color: #DC2626; }
`;

/* 분류 행의 이름변경·삭제 — 마우스를 올렸을 때만 보인다(목록이 시끄러워지지 않게) */
export const CatActions = styled.span`
  display: inline-flex; align-items: center; gap: 2px;
  /* 목록(AtRow) 안에서는 hover 시에만, 칩 옆(선택된 분류)에서는 항상 보인다.
     선택했다는 것 자체가 "이걸 다루겠다" 는 신호라 숨길 이유가 없다. */
  opacity: 1;
  ${AtRow} & { opacity: 0; transition: opacity 0.12s; }
  ${AtRow}:hover & { opacity: 1; }
  /* 터치 기기는 hover 가 없다 — 항상 보인다 */
  @media (hover: none) { ${AtRow} & { opacity: 1; } }
`;
export const CatIconBtn = styled.button<{ $danger?: boolean }>`
  all: unset; cursor: pointer;
  width: 20px; height: 20px; border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.75rem; color: ${p => (p.$danger ? '#DC2626' : '#64748B')};
  &:hover { background: ${p => (p.$danger ? '#FEE2E2' : '#F1F5F9')}; }
`;

export const ErrorBar = styled.div`font-size: 0.75rem; color: #DC2626; background: #FEF2F2; padding: 8px 12px; border-radius: 6px;`;
// 표 설명 — 열기/닫기 통합 full-width 헤더 바(라운드·이질감 제거, flat 통일). (Irene)
export const DescAddBtn = styled.button`
  align-self: flex-start; height: 32px; padding: 0 10px; margin: -8px 0 0;
  background: transparent; border: none; border-radius: 6px; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600; color: #64748B;
  &:hover { background: #F1F5F9; color: #0F766E; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
export const DescToggleHeader = styled.button`
  display: flex; align-items: center; justify-content: space-between; width: 100%;
  padding: 10px 24px; text-align: left;
  background: #F8FAFC; border: none;
  border-bottom: 1px solid #F1F5F9;
  cursor: pointer; transition: background 0.15s;
  &:hover { background: #F1F5F9; }
`;
export const DescBoxLabel = styled.span`
  font-size: 0.6875rem; font-weight: 700; color: #64748B;
  text-transform: uppercase; letter-spacing: 0.05em;
`;
export const DescChevron = styled.span<{ $open?: boolean }>`
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 0.6875rem; font-weight: 600; color: #64748B;
  svg { transition: transform 0.18s ease; transform: rotate(${p => p.$open ? '180deg' : '0deg'}); }
`;

// 버튼 — PanelHeader 60px (padding 14*2=28 + 32 content) 와 일치하도록 32px
export const PrimaryBtn = styled.button`
  height: 32px; padding: 0 14px; background: #14B8A6; color: #fff; border: none; border-radius: 8px;
  font-size: 0.8125rem; font-weight: 600; cursor: pointer; white-space: nowrap;
  display: inline-flex; align-items: center;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
// 편집 — 문서 화면에서 가장 자주 쓰는 액션이라 글자 버튼(중립 톤). 공유(Primary teal)와 색으로 구분한다.
export const EditBtn = styled.button`
  height: 32px; padding: 0 14px;
  display: inline-flex; align-items: center; white-space: nowrap;
  font-size: 0.8125rem; font-weight: 600; color: #334155;
  background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #94A3B8; color: #0F172A; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
// 아이콘 전용 액션 — 규격은 `EditBtn` 과 같다(높이 32 · 같은 테두리·hover).
//   밴드2 의 액션 3개 계약을 지키려고 글자를 뺐다. 뜻은 title·aria-label 이 말한다.
export const IconActionBtn = styled(EditBtn)`
  width: 32px; padding: 0; justify-content: center;
  &:disabled { opacity: 0.5; cursor: default; }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
export const SignBtn = styled.button`
  height: 32px; padding: 0 14px;
  display: inline-flex; align-items: center; white-space: nowrap;
  font-size: 0.8125rem; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border: 1px solid #14B8A6; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.15s;
  &:hover:not(:disabled) { background: #14B8A6; color: #fff; transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
export const LeaveBlockedNote = styled.span`
  display:inline-flex; align-items:center; max-width:340px;
  padding:4px 10px; border-radius:8px;
  font-size:0.75rem; font-weight:600; line-height:1.4;
  color:#B91C1C; background:#FEE2E2; border:1px solid #FCA5A5;
`;
export const SecondaryBtn = styled.button`
  height: 32px; padding: 0 14px; background: #fff; color: #0F172A; white-space: nowrap;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
// 모바일 제목 행 — 뒤로가기 + 제목을 한 줄에
export const TitleRow = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
`;
// 모바일 뒤로가기 버튼 — 데스크톱에서는 숨김, 제목과 인라인
export const MobileBackBtn = styled.button<{ $always?: boolean }>`
  /* 모양은 공용 뒤로 버튼(backButtonLook) — 28px·옅은 색이라 다른 상세와 달랐다(2026-10-19). */
  ${backButtonLook}
  display: ${p => p.$always ? 'inline-flex' : 'none'};
  @media (max-width: 900px) {
    display: inline-flex;
  }
`;
export const KnowledgeToast = styled.div`
  position: fixed; bottom: 24px; right: 24px;
  padding: 10px 16px;
  background: #0F172A; color: #FFFFFF;
  border-radius: 8px; font-size: 0.8125rem; font-weight: 500;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  /* 알림 토스트는 모달 위에도 보여야 한다(모달 안 동작의 결과를 알리는 경우가 있다).
     그리고 페이지 층 핸들(90)보다 위여야 한다 — 같은 이유로 여기도 올린다. */
  z-index: 1200;
  animation: fadeInUp 0.2s ease-out;
  @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
`;

// 서명본 본문 — 서버가 조립한 HTML 을 그대로 그린다. 서명 칸 규격은 서버
// services/signedDocument.js `SIGNED_CSS` 가 정본이고, 여기서는 **본문 타이포만** 맞춘다.
export const SignedBody = styled.div`
  /* 편집기 보기(PostEditor borderless Body)와 **같은 여백** — 서명 요청이 생겨 서명본으로 바뀌는 순간
     좌우 여백이 사라져 글이 선에 붙었다(2026-10-05 K-DINE 계약서, Irene). 값은 PostEditor 의 12px 24px. */
  padding: 12px 24px;
  font-size: 0.9375rem; line-height: 1.75; color: #1E293B;
  h1, h2, h3 { margin: 1.2em 0 0.5em; line-height: 1.35; }
  p { margin: 0 0 0.75em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #E2E8F0; padding: 6px 8px; }
  img { max-width: 100%; }
  .pq-sig { border: 1px solid #CBD5E1; border-radius: 8px; padding: 10px 12px; margin: 12px 0; min-height: 64px; }
  .pq-sig-cap { font-size: 0.6875rem; font-weight: 700; color: #64748B; margin-bottom: 4px; }
  .pq-sig-empty { color: #94A3B8; font-size: 0.75rem; border-bottom: 1px dashed #CBD5E1; padding-bottom: 14px; }
  .pq-sig-done { border-color: #14B8A6; background: #F0FDFA; }
  .pq-sig-img { display: block; max-height: 96px; max-width: min(300px, 100%); }
  .pq-sig-meta { font-size: 0.75rem; color: #334155; margin-top: 4px; }
  .pq-sig-badge { font-size: 0.625rem; color: #0F766E; margin-top: 2px; }
  .pq-sig-rejected { border-color: #FCA5A5; background: #FEF2F2; }
  /* 2026-10-05 서명 항목 — 서명일·이름 칸(services/signedDocument dateItemHtml·nameItemHtml) */
  .pq-sig-item { display: inline-block; min-width: 120px; padding: 2px 6px; border-bottom: 1px dashed #CBD5E1; color: #94A3B8; font-size: 0.8125rem; }
  .pq-sig-item.pq-sig-filled { color: #0F172A; border-bottom-color: #14B8A6; }
  .pq-sig-no { color: #B91C1C; font-size: 0.75rem; font-weight: 700; padding: 6px 0; }
  .pq-sig-zone { margin-top: 20px; display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
`;
