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
import { supportsPin, pinnedTool, lastPinnedTool, openPinned, closePin } from '../../utils/pinnedWindow';
import VoiceCaptureSheet from './VoiceCaptureSheet';

export type DockTool = 'qtalk' | 'qtask' | 'qnote' | 'qhelper';

/** 모바일 in-app 폴백 — MemoFab / CueHelpDrawer 가 듣는 전역 오픈 이벤트 */
export const openDockTool = (tool: DockTool) => {
  window.dispatchEvent(new CustomEvent('planq:open-tool', { detail: { tool } }));
};

const POPOUT_PATH: Record<DockTool, string> = {
  qtalk: '/talk-popout',
  qtask: '/task-popout',
  qnote: '/note-popout',
  qhelper: '/help-popout',
};
// 도구별 분리 창 크기
const POPOUT_FEATURES: Record<DockTool, string> = {
  qtalk: 'width=520,height=780,menubar=no,toolbar=no,location=no,status=no',
  // qtask — 리스트 + 상세 드로어(오버레이)가 함께 뜨므로 Q Talk 와 같은 폭·높이
  qtask: 'width=520,height=780,menubar=no,toolbar=no,location=no,status=no',
  qnote: 'width=480,height=640,menubar=no,toolbar=no,location=no,status=no',
  qhelper: 'width=440,height=720,menubar=no,toolbar=no,location=no,status=no',
};
// 핀(Document PiP) 창 크기 — PiP 는 features 문자열이 아니라 숫자 크기를 받는다
const PIN_SIZE: Record<DockTool, { width: number; height: number }> = {
  qtalk: { width: 520, height: 780 },
  qtask: { width: 520, height: 780 },
  qnote: { width: 480, height: 640 },
  qhelper: { width: 440, height: 720 },
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
  // 핀(항상 위) — utils/pinnedWindow 가 단일 원천. 여기 state 는 아이콘 표시용 미러다.
  const [pinned, setPinned] = useState<string | null>(() => pinnedTool());
  // 화면공유 시작 등으로 핀 창이 저절로 닫혔는데 팝업 차단으로 자동 승격까지 막힌 경우 —
  // 사용자 제스처가 있어야 창을 열 수 있으므로 "다시 열기" 카드를 띄운다.
  const [pinLost, setPinLost] = useState<DockTool | null>(null);
  const canPin = supportsPin();
  const pinHint = canPin ? lastPinnedTool() : null;

  const isBusinessMember = !!user?.business_id && ['owner', 'admin', 'member'].includes(user.business_role || '');
  const pathHidden = FAB_HIDDEN_PREFIXES.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`))
    || (typeof document !== 'undefined' && document.body.dataset.popout === '1')
    || isPopoutWindow() // #84 — 팝아웃 창 내부 이동에도 FAB 숨김 유지
    || isPublicSurfacePath(location.pathname); // 공개 표면 심층방어
  // Q Talk (메인 채팅) — 모바일에선 채팅 입력바를 가리므로 FAB 숨김 (데스크탑·타 페이지는 유지)
  // Q Talk 에서 FAB 숨김은 "활성 대화방(입력바 있음)" 일 때만 — 대화 리스트(?conv 없음)에선 FAB 유지(#165).
  const onTalk = (location.pathname === '/talk' || location.pathname.startsWith('/talk/'))
    && new URLSearchParams(location.search).has('conv');

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

  if (!isBusinessMember || pathHidden) return null;

  // #80 — 빠른 만들기: 해당 페이지로 이동하며 생성 모달 자동 오픈(URL param). "진짜 퀵".
  const handleCreate = (kind: 'task' | 'mail' | 'event') => {
    setExpanded(false);
    if (kind === 'task') navigate('/tasks?create=1');
    else if (kind === 'mail') navigate('/mail?compose=1');
    else navigate('/calendar?create=1');
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
    // 데스크탑 — 도구를 각각 독립 창으로 팝아웃 (운영 #43/#45, 2026-06-16 결정).
    //   기본은 일반 창이다. 도구별 고유 창 이름(pq-${tool})이라 넷 다 동시에 떠 있고,
    //   화상회의 화면공유 중에도 사라지지 않는다. "항상 위" 는 아래 handlePin 의 명시적 선택.
    window.open(POPOUT_PATH[tool], `pq-${tool}`, POPOUT_FEATURES[tool]);
  };

  // 핀으로 열기 / 핀 해제 — 반드시 이 클릭(사용자 제스처) 안에서 requestWindow 를 호출해야 한다.
  const handlePin = async (tool: DockTool) => {
    setExpanded(false);
    setPinLost(null);
    if (pinnedTool() === tool) {
      // 같은 도구 핀 해제 = 일반 창으로 되돌리기 (도구를 잃지 않는다)
      closePin({ reopenAsWindow: { path: POPOUT_PATH[tool], features: POPOUT_FEATURES[tool] } });
      setPinned(null);
      return;
    }
    const ok = await openPinned({
      tool,
      path: POPOUT_PATH[tool],
      width: PIN_SIZE[tool].width,
      height: PIN_SIZE[tool].height,
      title: t(`dock.${tool}`, tool) as string,
      pathOf: (x) => POPOUT_PATH[x as DockTool],
      featuresOf: (x) => POPOUT_FEATURES[x as DockTool],
      onUnexpectedClose: ({ tool: lost, promoted }) => {
        setPinned(null);
        if (!promoted) setPinLost(lost as DockTool);
      },
      // 핀 전환 시 이전 도구 강등 창이 팝업 차단으로 막힌 경우 — 사용자 제스처로 되살릴 수 있게 안내
      onDemoteBlocked: (demoted) => setPinLost(demoted as DockTool),
    });
    // 미지원·사용자 취소 → 일반 창 폴백 (도구를 못 여는 일은 없게)
    if (!ok) window.open(POPOUT_PATH[tool], `pq-${tool}`, POPOUT_FEATURES[tool]);
    setPinned(ok ? tool : null);
  };

  return (
    <>
    {/* #157 — 퀵메뉴 펼치면 뒷배경을 어둡게(글자 겹쳐 메뉴가 안 보이던 문제). 클릭 시 닫힘. */}
    {expanded && <DockBackdrop aria-hidden="true" onClick={() => setExpanded(false)} />}
    <FabWrap ref={fabRef} $onTalk={onTalk}>
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
          {OPEN_TOOLS.map(({ tool, bg, testid, Icon }) => {
            const isPinned = pinned === tool;
            return (
              <OpenRow key={tool}>
                <MenuItem data-testid={testid} role="menuitem" type="button" onClick={() => handlePick(tool)}>
                  <ItemIcon $bg={bg}><Icon /></ItemIcon>
                  <span>{t(`dock.${tool}`, tool)}</span>
                </MenuItem>
                {canPin && (
                  <PinBtn
                    data-testid={`dock-pin-${tool}`}
                    type="button"
                    $active={isPinned}
                    $hint={!isPinned && pinHint === tool}
                    aria-pressed={isPinned}
                    aria-label={(isPinned ? t('dock.unpin', '핀 해제') : t('dock.pin', '핀으로 열기 — 항상 위')) as string}
                    title={(isPinned ? t('dock.unpin', '핀 해제') : t('dock.pin', '핀으로 열기 — 항상 위')) as string}
                    onClick={() => handlePin(tool)}
                  >
                    <IconPin />
                  </PinBtn>
                )}
              </OpenRow>
            );
          })}
          {canPin && <PinNote>{t('dock.pinOnlyOne', '핀은 한 번에 하나만 — 다른 도구를 핀하면 이전 창은 일반 창으로 바뀝니다')}</PinNote>}
        </Menu>
      )}
      {/* 핀 창이 저절로 닫혔고 자동 승격도 팝업 차단으로 막힌 경우 — 클릭(사용자 제스처)으로 되살린다 */}
      {pinLost && (
        <PinLostCard role="status" data-testid="dock-pin-lost">
          <PinLostText>
            {t('dock.pinClosed', '{{tool}} 핀 창이 닫혔습니다', { tool: t(`dock.${pinLost}`, pinLost) })}
          </PinLostText>
          <PinLostBtn
            type="button"
            data-testid="dock-pin-reopen"
            onClick={() => { const tool = pinLost; setPinLost(null); handlePick(tool); }}
          >
            {t('dock.pinReopen', '다시 열기')}
          </PinLostBtn>
        </PinLostCard>
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
const IconPin = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.7-2.6A2 2 0 0 1 17 13.3V7h1a1 1 0 0 0 0-2H6a1 1 0 0 0 0 2h1v6.3a2 2 0 0 1-.3 1.1z"/></svg>
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
const FabWrap = styled.div<{ $onTalk?: boolean }>`
  position: fixed; right: 20px; bottom: 16px;
  /* 모바일 상단바(z-index 99)·사이드바(100) 위로 떠야 펼친 메뉴가 안 가림 (#86). 모달(1000+)보다는 아래. */
  z-index: 120;
  display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
  /* iPhone 홈 인디케이터 회피 (#86) */
  @media (max-width: 640px) { right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
  body[data-overlay-open="true"] & { opacity: 0; pointer-events: none; visibility: hidden; }
  /* #86 — 키보드 올라온 동안엔 FAB 숨김 (입력 중 키보드 위에 어정쩡하게 떠 가리는 것 방지) */
  body[data-keyboard-up="1"] & { opacity: 0; pointer-events: none; visibility: hidden; }
  /* Q Talk 모바일 — 채팅 입력바/전송버튼 침범 방지 (옛 MemoFab 정책 복원, N+93 통합 시 유실) */
  ${p => p.$onTalk ? '@media (max-width: 640px) { display: none; }' : ''}
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

const MenuItem = styled.button<{ $create?: boolean }>`
  width: 100%;
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

// 열기 항목 1행 = [도구 버튼][핀 버튼]. 중첩 button 금지라 형제로 둔다.
const OpenRow = styled.div`
  display: flex; align-items: stretch; gap: 6px; width: 100%;
  /* 도구 버튼이 남는 폭을 먹고, 핀 버튼은 고정 36px.
     MenuItem 자체에 flex:1 을 주면 세로 column 인 Menu 안의 다른 항목까지 늘어나므로 여기서만 준다. */
  > button:first-child { flex: 1; min-width: 0; width: auto; }
`;
const PinBtn = styled.button<{ $active: boolean; $hint: boolean }>`
  flex-shrink: 0;
  width: 36px; min-height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 12px; cursor: pointer;
  background: ${({ $active }) => ($active ? '#0F766E' : '#FFFFFF')};
  color: ${({ $active, $hint }) => ($active ? '#FFFFFF' : $hint ? '#0F766E' : '#94A3B8')};
  border: 1px solid ${({ $active, $hint }) => ($active ? '#0F766E' : $hint ? '#99F6E4' : '#E2E8F0')};
  box-shadow: 0 4px 14px rgba(15,23,42,0.12);
  transition: transform 0.12s, color 0.12s, background 0.12s;
  &:hover { transform: translateY(-1px); color: ${({ $active }) => ($active ? '#FFFFFF' : '#0F766E')}; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
const PinNote = styled.div`
  font-size: 10.5px; line-height: 1.4; color: #94A3B8;
  padding: 0 6px; text-align: right;
`;
// 핀 창이 저절로 닫혔는데(화면공유 시작 등) 팝업 차단으로 자동 승격까지 막힌 경우.
// window.open 은 사용자 제스처가 필요하므로 클릭을 받는다.
const PinLostCard = styled.div`
  display: flex; align-items: center; gap: 8px;
  width: 188px; box-sizing: border-box;
  padding: 10px 12px;
  background: #FFFFFF; border: 1px solid #FDA4AF; border-radius: 12px;
  box-shadow: 0 6px 18px rgba(15,23,42,0.16);
  font-size: 12px; color: #0F172A;
`;
const PinLostText = styled.span`flex: 1; line-height: 1.35;`;
const PinLostBtn = styled.button`
  flex-shrink: 0; padding: 6px 10px; min-height: 32px;
  border: 1px solid #0F766E; border-radius: 8px; background: #0F766E; color: #FFFFFF;
  font-size: 11.5px; font-weight: 700; cursor: pointer;
  &:hover { filter: brightness(1.05); }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
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
