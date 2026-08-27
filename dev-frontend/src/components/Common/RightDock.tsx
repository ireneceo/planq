// RightDock — 전역 우하단 통합 런처 (#9, N+93)
//   사용자 호소: "Q Talk 접근성이 쉬워야 한다 — 일하면서 채팅."
//   FAB 하나 → 펼치면 [Q Talk · Q Note · Q helper] → 클릭하면 각 도구를 자기 창으로 팝아웃.
//   - 데스크탑: window.open 으로 별도 창(작업화면을 안 덮고 옆에 두고 사용) — Irene 결정 "모두 팝아웃".
//   - 모바일: 별도 창 개념이 없으므로 in-app 으로 폴백 (Q Talk=페이지 이동, Q Note/Q helper=드로어/모달).
//   흩어진 FAB 2개(메모·헬프) 통합. 비즈니스 멤버에게만 노출 — 게스트/Client 는 기존 Q helper FAB 유지(별도).
//   분리 창(/*-popout, /memo/*) 안에서는 자기 안에 자기 뜨는 혼란 방지 위해 숨김.
//   공개 표면(랜딩·Q위키)에서도 숨김 — 비회원 트래픽 영역에 워크스페이스 런처가 뜨면 안 된다.
//   App.tsx 가 이미 hideAppChrome 로 언마운트하지만, 마운트 경로가 늘어도 새지 않게 여기서도 방어.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useChromeLocation, useChromeNav } from '../../hooks/useChromeNav';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { isPublicSurfacePath } from '../../utils/publicSurface';
import { isPopoutWindow } from '../../utils/popout';
import { openPopout, type PinTool } from '../../utils/pinHost';
import { tabStore } from '../../stores/tabStore';
import VoiceCaptureSheet from './VoiceCaptureSheet';

/** 여기서 여는 도구 = 핀 가능한 도구. 두 곳에 따로 적으면 갈라진다(경로·크기 원천은 pinHost). */
export type DockTool = PinTool;

/** 모바일 in-app 폴백 — MemoFab / CueHelpDrawer 가 듣는 전역 오픈 이벤트 */
export const openDockTool = (tool: DockTool) => {
  window.dispatchEvent(new CustomEvent('planq:open-tool', { detail: { tool } }));
};

const FAB_HIDDEN_PREFIXES = ['/memo', '/talk-popout', '/task-popout', '/note-popout', '/help-popout'];

const RightDock: React.FC = () => {
  const { t } = useTranslation('common');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const { user } = useAuth();
  const location = useChromeLocation();
  const navigate = useChromeNav();
  const [expanded, setExpanded] = useState(false);
  const fabRef = useRef<HTMLDivElement>(null);
  // ★ 여기서 여는 것은 **언제나 그냥 일반 창**이다 (Irene 지시 2026-08-20:
  //   "그냥 열리는 건 그냥 열리는 거야"). 자동 고정도, 확인 팝업도 없다.
  //   고정은 팝아웃 창 위의 핀 아이콘이 한다(utils/pinHost.usePinHost).
  const isBusinessMember = !!user?.business_id && ['owner', 'admin', 'member'].includes(user.business_role || '');
  const pathHidden = FAB_HIDDEN_PREFIXES.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`))
    || (typeof document !== 'undefined' && document.body.dataset.popout === '1')
    || isPopoutWindow() // #84 — 팝아웃 창 내부 이동에도 FAB 숨김 유지
    || isPublicSurfacePath(location.pathname); // 공개 표면 심층방어
  // Q Talk (메인 채팅) — 모바일에선 채팅 입력바를 가리므로 FAB 숨김 (데스크탑·타 페이지는 유지)
  // Q Talk 에서 FAB 숨김은 "활성 대화방(입력바 있음)" 일 때만 — 대화 리스트(?conv 없음)에선 FAB 유지(#165).
  //   ★ 2026-08-27 — 같은 이유가 Q Note 세션에도 그대로 있다(Irene: "Q note 음성메모는 아래
  //   채팅창이 있는데 이 아이콘이 가리잖아"). 화면마다 따로 두지 않고 **"하단 입력줄이 있는 상세 화면"**
  //   하나의 술어로 일반화한다. 리스트(/talk, /notes)에선 FAB 유지.
  const onBottomBarScreen = ((location.pathname === '/talk' || location.pathname.startsWith('/talk/'))
    && new URLSearchParams(location.search).has('conv'))
    || /^\/notes\/[^/]+/.test(location.pathname);

  // 펼침 메뉴 — 외부 클릭/Esc 닫기
  useEffect(() => {
    if (!expanded) return;
    const onDoc = (e: MouseEvent) => {
      if (fabRef.current?.contains(e.target as Node)) return;
      setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  // 펼침 상태를 body 에 알린다 — 우하단 배너(PwaInstallBanner)가 이 자리를 비우는 계약.
  //   ★ 조기 return 위에 둔다(훅 순서 고정). 언마운트 시 반드시 지운다 — 안 지우면 도크가 사라진
  //     경로에서 배너가 영영 숨는다.
  //   ★ hidden 을 조건·deps 에 같이 둔다. 도크는 숨을 때 **언마운트가 아니라 `return null`** 이라
  //     cleanup 이 안 돈다 — 메뉴를 펼친 채 /memo·공개 표면으로 이동하면 플래그만 남아
  //     그 화면에서 배너가 이유 없이 숨는다(외부 클릭 1회로 자가 회복되지만 그때까지 거짓 상태).
  const hidden = !isBusinessMember || pathHidden;
  useEffect(() => {
    try {
      if (expanded && !hidden) document.body.dataset.dockOpen = '1';
      else delete document.body.dataset.dockOpen;
    } catch { /* noop */ }
    return () => { try { delete document.body.dataset.dockOpen; } catch { /* noop */ } };
  }, [expanded, hidden]);

  if (hidden) return null;

  // #80 — 빠른 만들기: 해당 페이지로 이동하며 생성 모달 자동 오픈(URL param). "진짜 퀵".
  // ★ Irene 2026-08-24 — "+업무 / +메일 / +일정 은 클릭하면 새 탭으로 열려야 하지 않을까?"
  //   옛 동작은 `navigate()` = **활성 탭의 경로를 갈아치움**. 채팅을 보다가 +업무를 누르면
  //   보고 있던 채팅 탭이 /tasks 로 바뀌어 사라졌다. 브라우저 탭 모델에서 "빠른 만들기" 가
  //   지금 보던 것을 없애는 것은 맞지 않다 → 새 탭으로 연다(tabStore.newTab).
  //   모바일은 탭 모델이 아니므로 기존처럼 인앱 이동(아래 handlePick 의 모바일 분기와 같은 기준).
  const handleCreate = (kind: 'task' | 'mail' | 'event') => {
    setExpanded(false);
    const path = kind === 'task' ? '/tasks?create=1'
      : kind === 'mail' ? '/mail?compose=1'
        : '/calendar?create=1';
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) { navigate(path); return; }
    tabStore.newTab(path);
  };

  const openPlain = (tool: DockTool) => {
    // 자리 규칙은 utils/pinHost.openPopout 단일 진입점에 있다(고정창이 뜨는 자리 기준 + 계단).
    openPopout(tool);
  };

  const handlePick = (tool: DockTool) => {
    setExpanded(false);
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
      // 모바일 — 별도 창 대신 in-app.
      //   qtask 의 정식 모바일 표면은 /tasks (같은 파일 handleCreate('task') 와 동일 착지).
      if (tool === 'qtalk') navigate('/talk');
      else if (tool === 'qtask') navigate('/tasks');
      else openDockTool(tool);
      return;
    }
    // 데스크탑 — 일반 창. 도구별 고유 창 이름이라 넷 다 동시에 떠 있을 수 있다(#43).
    //   고정하고 싶으면 그 창 위의 핀 아이콘을 누른다. 여기서는 아무것도 묻지 않는다.
    openPlain(tool);
  };

  return (
    <>
    {/* #157 — 퀵메뉴 펼치면 뒷배경을 어둡게(글자 겹쳐 메뉴가 안 보이던 문제). 클릭 시 닫힘. */}
    {expanded && <DockBackdrop aria-hidden="true" onClick={() => setExpanded(false)} />}
    <FabWrap ref={fabRef} $onBottomBar={onBottomBarScreen}>
      {expanded && (
        <Menu role="menu" aria-label={t('dock.menuLabel', '바로 열기') as string}>
          {/* 말로 추가 — 이동 중·손이 바쁠 때. 모바일에서 제일 많이 쓴다(그래서 퀵버튼 최상단).
              말하면 업무·일정·메모·메일 중 무엇인지 AI 가 판단하고, 사람이 확인해야 저장된다. */}
          <VoiceItem data-testid="dock-voice" role="menuitem" type="button" onClick={() => { setExpanded(false); setVoiceOpen(true); }}>
            <MicSvg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </MicSvg>
            <span>{t('dock.voice', '말로 추가')}</span>
          </VoiceItem>
          <MenuDivider />
          {/* #80 — 빠른 만들기 그룹 (열기 도구와 구분) */}
          <GroupLabel>{t('dock.createLabel', '빠른 만들기') as string}</GroupLabel>
          <MenuItem data-testid="dock-create-task" $create role="menuitem" type="button" onClick={() => handleCreate('task')}>
            <PlusIcon /><span>{t('dock.newTask', '업무')}</span>
          </MenuItem>
          <MenuItem data-testid="dock-create-mail" $create role="menuitem" type="button" onClick={() => handleCreate('mail')}>
            <PlusIcon /><span>{t('dock.newMail', '메일')}</span>
          </MenuItem>
          <MenuItem data-testid="dock-create-event" $create role="menuitem" type="button" onClick={() => handleCreate('event')}>
            <PlusIcon /><span>{t('dock.newEvent', '일정')}</span>
          </MenuItem>
          <MenuDivider />
          <GroupLabel>{t('dock.openLabel', '열기') as string}</GroupLabel>
          {OPEN_TOOLS.map(({ tool, bg, testid, Icon }) => (
            // ★ 행 옆 핀 아이콘은 없다 (Irene: "채팅 누르면 나오는 버튼들 옆에 핀아이콘 안쓸거라고").
            //   고정은 열린 팝아웃 창 위의 핀 아이콘이 한다 — 여는 것과 고정하는 것은 별개다.
            <MenuItem
              key={tool}
              data-testid={testid}
              role="menuitem"
              type="button"
              title={t('dock.opensWindow', '새 창으로 엽니다') as string}
              onClick={() => handlePick(tool)}
            >
              <ItemIcon $bg={bg}><Icon /></ItemIcon>
              <span>{t(`dock.${tool}`, tool)}</span>
            </MenuItem>
          ))}
        </Menu>
      )}
      <Fab
        data-testid="right-dock-fab"
        type="button"
        $expanded={expanded}
        aria-expanded={expanded}
        aria-label={t('dock.toggle', '바로 열기 — Q Talk · Q Task · Q Note · Q helper') as string}
        title={t('dock.toggle', '바로 열기 — Q Talk · Q Task · Q Note · Q helper') as string}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <IconClose /> : <IconDock />}
      </Fab>
    </FabWrap>
      {voiceOpen && <VoiceCaptureSheet onClose={() => setVoiceOpen(false)} />}
    </>
  );
};

export default RightDock;

// ===== icons =====
const IconDock = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);
const IconClose = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
);
const IconTalk = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
);
const IconNote = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
);
// 사이드바 Q Task 아이콘과 동일 형태 (MainLayout IconTask)
const IconTask = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
);
const IconHelp = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
);


// "열기" 그룹 — 순서 = 사이드바 순서(Q Talk → Q Task → Q Note → Q helper).
//   아이콘 상수보다 뒤에 선언해야 한다 (모듈 평가 시 TDZ).
const OPEN_TOOLS: Array<{ tool: DockTool; bg: string; testid: string; Icon: React.FC }> = [
  { tool: 'qtalk', bg: '#0F766E', testid: 'dock-open-talk', Icon: IconTalk },
  { tool: 'qtask', bg: '#0E7490', testid: 'dock-open-task', Icon: IconTask },
  { tool: 'qnote', bg: '#14B8A6', testid: 'dock-open-note', Icon: IconNote },
  { tool: 'qhelper', bg: '#F43F5E', testid: 'dock-open-helper', Icon: IconHelp },
];

// ===== styled =====
// #157 — 퀵메뉴 뒤 딤 배경 (FabWrap z-index 120 바로 아래). 메뉴·FAB 는 위에 떠 선명하게 보인다.
const DockBackdrop = styled.div`
  position: fixed; inset: 0; z-index: 119;
  background: rgba(15, 23, 42, 0.45);
  animation: dockBackdropIn 0.12s ease-out;
  @keyframes dockBackdropIn { from { opacity: 0; } to { opacity: 1; } }
`;
const FabWrap = styled.div<{ $onBottomBar?: boolean }>`
  position: fixed; right: 20px; bottom: 16px;
  /* 모바일 상단바(z-index 99)·사이드바(100) 위로 떠야 펼친 메뉴가 안 가림 (#86). 모달(1000+)보다는 아래. */
  z-index: 120;
  display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
  /* iPhone 홈 인디케이터 회피 (#86) */
  /* 우측 여백과 아래 여백을 같은 값으로 본다 — 시각적으로 코너에 균등하게 앉는다.
     ★ env() 를 직접 쓰지 않고 --pq-safe-bottom 을 쓴다: 구버전 앱(WebView 가 이미 인셋됨)에서는
     main.tsx 가 이 변수를 0 으로 눌러, 아이콘이 화면 바닥에서 붕 뜨는 것을 막는다
     (Irene: "말풍선이 너무 위에 있다", 2026-08-25). */
  @media (max-width: 640px) { right: 16px; bottom: calc(16px + var(--pq-safe-bottom, 0px)); }
  body[data-overlay-open="true"] & { opacity: 0; pointer-events: none; visibility: hidden; }
  /* ★ 2026-08-27 — 모달이 떠 있으면 FAB 은 안 보여야 한다(Irene: "팝업 나올 땐 액션버튼들 때문에
     안 나와야 하는데 나오는 것 같은데 다 체크해").
     여태 술어가 data-overlay-open(=useBodyScrollLock) 뿐이라 그 훅을 안 쓰는 모달 25곳에서 FAB 이 남았다.
     화면 25곳을 고치는 대신 **모달의 표준 표식**을 술어로 쓴다 — aria-modal="true"
     (CLAUDE.md 운영안정성 17번, e2e 하니스와 같은 렌즈). 메모 팝업은 모달이 아니므로 자기 표식을 쓴다.
     ≤1024px 한정: 데스크탑 멀티탭은 백그라운드 탭 pane 의 모달이 DOM 에 남아 오탐이 된다. */
  @media (max-width: 1024px) {
    body:has([aria-modal="true"]) &,
    body:has([data-memo-popup="1"]) & { opacity: 0; pointer-events: none; visibility: hidden; }
  }
  /* #86 — 키보드 올라온 동안엔 FAB 숨김 (입력 중 키보드 위에 어정쩡하게 떠 가리는 것 방지) */
  body[data-keyboard-up="1"] & { opacity: 0; pointer-events: none; visibility: hidden; }
  /* Q Talk 모바일 — 채팅 입력바/전송버튼 침범 방지 (옛 MemoFab 정책 복원, N+93 통합 시 유실) */
  ${p => p.$onBottomBar ? '@media (max-width: 640px) { display: none; }' : ''}
`;

const Fab = styled.button<{ $expanded: boolean }>`
  width: 52px; height: 52px;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${({ $expanded }) => ($expanded ? '#0F172A' : '#0F766E')};
  color: #FFFFFF;
  border: none; border-radius: 50%;
  box-shadow: 0 4px 16px rgba(15,118,110,0.30);
  cursor: pointer;
  transition: transform 0.15s, background 0.15s;
  &:hover { transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 4px; }
  @media (max-width: 640px) { width: 48px; height: 48px; }
`;

const Menu = styled.div`
  /* N+93 — 버튼 가로폭 동일 + 아이콘 좌측 정렬: 고정폭 컬럼에 stretch */
  display: flex; flex-direction: column; align-items: stretch; gap: 8px;
  width: 188px;
  /* #86 — 짧은 화면(키보드/가로모드)에서 위로 넘쳐 상단바 뒤로 잘리지 않게: visual viewport 안에 가두고 스크롤 */
  max-height: calc(var(--vvh, 100dvh) - 96px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 2px;            /* 스크롤 시 버튼 그림자 잘림 방지 */
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
  animation: dockIn 0.14s ease-out;
  @keyframes dockIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
`;

const MenuItem = styled.button<{ $create?: boolean; $grow?: boolean }>`
  ${({ $grow }) => ($grow ? 'flex: 1; min-width: 0;' : 'width: 100%;')}
  display: inline-flex; align-items: center; justify-content: flex-start; gap: 10px;
  padding: ${({ $create }) => ($create ? '8px 14px' : '8px 14px 8px 8px')};
  background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 12px;
  box-shadow: 0 4px 14px rgba(15,23,42,0.12);
  cursor: pointer;
  font-size: 14px; font-weight: 600; color: #0F172A;
  text-align: left;
  transition: transform 0.12s, box-shadow 0.12s;
  &:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(15,23,42,0.16); ${({ $create }) => $create && 'border-color: #14B8A6; color: #0F766E;'} }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
  span { white-space: nowrap; }
`;


const ItemIcon = styled.span<{ $bg: string }>`
  width: 32px; height: 32px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${({ $bg }) => $bg}; color: #FFFFFF; flex-shrink: 0;
`;
// #80 — 빠른 만들기 그룹 라벨 · 구분선 · + 아이콘
const GroupLabel = styled.div`
  font-size: 10px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.5px;
  padding: 2px 6px 0; align-self: flex-end; text-align: right; width: 100%;
`;
const MenuDivider = styled.div`height: 1px; background: #E2E8F0; margin: 2px 4px;`;
const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#14B8A6" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
);

// 말로 추가 — 퀵버튼 최상단. AI 액션이라 Coral 톤(별 대신 마이크)
const VoiceItem = styled.button`
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 9px 12px; border: none; border-radius: 10px; cursor: pointer;
  font-size: 13px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #F43F5E 0%, #BE185D 100%);
  &:hover { filter: brightness(1.05); }
  &:focus-visible { outline: 2px solid #F43F5E; outline-offset: 2px; }
`;
const MicSvg = styled.svg`width: 15px; height: 15px; flex-shrink: 0;`;
