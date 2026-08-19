// RightDock — 전역 우하단 통합 런처 (#9, N+93)
//   사용자 호소: "Q Talk 접근성이 쉬워야 한다 — 일하면서 채팅."
//   FAB 하나 → 펼치면 [Q Talk · Q Note · Q helper] → 클릭하면 각 도구를 자기 창으로 팝아웃.
//   - 데스크탑: window.open 으로 별도 창(작업화면을 안 덮고 옆에 두고 사용) — Irene 결정 "모두 팝아웃".
//   - 모바일: 별도 창 개념이 없으므로 in-app 으로 폴백 (Q Talk=페이지 이동, Q Note/Q helper=드로어/모달).
//   흩어진 FAB 2개(메모·헬프) 통합. 비즈니스 멤버에게만 노출 — 게스트/Client 는 기존 Q helper FAB 유지(별도).
//   분리 창(/*-popout, /memo/*) 안에서는 자기 안에 자기 뜨는 혼란 방지 위해 숨김.
//   공개 표면(랜딩·Q위키)에서도 숨김 — 비회원 트래픽 영역에 워크스페이스 런처가 뜨면 안 된다.
//   App.tsx 가 이미 hideAppChrome 로 언마운트하지만, 마운트 경로가 늘어도 새지 않게 여기서도 방어.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useChromeLocation, useChromeNav } from '../../hooks/useChromeNav';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { isPublicSurfacePath } from '../../utils/publicSurface';
import { isPopoutWindow } from '../../utils/popout';
import { POPOUT_PATH, popoutFeatures, supportsPin, type PinTool } from '../../utils/pinHost';
import { pinOwner, usePinOwner } from '../../utils/pinOwner';
import { PIN_CHANNEL } from '../../utils/pinHost';
import VoiceCaptureSheet from './VoiceCaptureSheet';

/** 도크가 여는 도구 = 핀 가능한 도구. 두 곳에 따로 적으면 갈라진다(경로·크기 원천은 pinHost). */
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
  // ★ 팝아웃이 보낸 "핀 누를 준비" 신호 (#258·#280·#286).
  //   팝아웃 창은 스스로 고정할 수 없다 — Document PiP 는 **그 창 자신의 사용자 조작**을 요구하고
  //   조작은 창을 건너 전달되지 않는다(실측). 그래서 마지막 한 번의 클릭만 여기서 받는다:
  //   도크를 펼치고 그 도구의 핀을 깜빡여 **바로 누를 수 있는 자리**로 만든다.
  const [armedTool, setArmedTool] = useState<DockTool | null>(null);
  useEffect(() => {
    if (isPopoutWindow()) return;              // 팝아웃 자신은 수신자가 아니다
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(PIN_CHANNEL); } catch { return; }
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data as { type?: string; tool?: DockTool } | null;
      if (!m || m.type !== 'pin-arm' || !m.tool) return;
      setArmedTool(m.tool);
      setExpanded(true);                        // 핀이 보이는 상태로 열어 준다
      window.setTimeout(() => setArmedTool((cur) => (cur === m.tool ? null : cur)), 30000);
    };
    ch.addEventListener('message', onMsg);
    return () => { try { ch?.removeEventListener('message', onMsg); ch?.close(); } catch { /* noop */ } };
  }, []);
  const fabRef = useRef<HTMLDivElement>(null);
  // 핀(항상 위) — #258 재구조화(2026-08-14). 진입은 **여기 버튼 하나뿐**이고, 소유 상태와 프로토콜은
  //   utils/pinOwner.ts(모듈 싱글턴)에 있다. 도크는 공개 표면·/memo 에서 언마운트되므로
  //   상태를 여기 두면 그 순간 PiP 가 고아가 된다(설계 C-1). 이 컴포넌트는 구독만 한다.
  const { pinned, restore } = usePinOwner();
  const canPin = useMemo(() => supportsPin(), []);
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
    //   일반 창이다. 도구별 고유 창 이름(pq-${tool})이라 넷 다 동시에 떠 있고,
    //   화상회의 화면공유 중에도 사라지지 않는다. "항상 위"는 이 옆의 고정 버튼(handlePin)이 담당한다 —
    //   그쪽은 창을 새로 열지 않고 이 탭이 PiP 를 소유한다(#258).
    // #286 역방향 — 이미 고정(PiP)된 도구를 "열기" 로 또 열면 역시 창이 2개가 된다.
    //   고정을 먼저 놓고 일반 창으로 옮긴다(도구당 창 1개 불변식은 양방향이어야 성립한다).
    if (pinned === tool) pinOwner.unpin();
    window.open(POPOUT_PATH[tool], `pq-${tool}`, popoutFeatures(tool));
  };

  // 핀 = 이 탭이 PiP 를 열고 그 안에 도구를 싣는다. 창은 늘지 않는다.
  //   ★ 반드시 이 클릭 핸들러 안에서 동기적으로 시작해야 한다 — requestWindow 는 transient activation 을 요구한다.
  //     (내부의 축출 선공지 250ms 대기는 activation 수명 약 5초 안이라 그대로 성립한다.)
  const handlePin = (tool: DockTool) => {
    setArmedTool(null);                                  // 눌렀으면 깜빡임은 끝난다
    if (pinned === tool) { pinOwner.unpin(); return; }   // 같은 도구 재클릭 = 해제(리스트 재클릭 토글 규칙)
    void pinOwner.pin(tool, t(`dock.${tool}`, tool) as string);
    setExpanded(false);
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
          {/* 새로고침으로 핀을 잃었을 때 — 어느 도구였는지 알려주고 1클릭으로 되돌린다.
              ★ 자동 재열기는 물리적으로 불가능하다(requestWindow 는 사용자 제스처를 요구한다).
                "자동으로 복원됩니다" 같은 문구를 쓰지 말 것. */}
          {canPin && restore && !pinned && (
            <RestoreChip type="button" role="menuitem" data-testid="dock-pin-restore" onClick={() => handlePin(restore)}>
              <IconPin />
              <span>{t('popoutPin.restore', '고정 다시 켜기')} · {t(`dock.${restore}`, restore)}</span>
            </RestoreChip>
          )}
          {OPEN_TOOLS.map(({ tool, bg, testid, Icon }) => (
            // ★ 행은 div 다. 열기 버튼과 핀 버튼은 **형제** — 중첩하면 button-in-button 이 되어
            //   HTML 상 무효이고 브라우저가 클릭 타깃을 임의로 접는다.
            <ToolRow key={tool}>
              <MenuItem $grow data-testid={testid} role="menuitem" type="button" onClick={() => handlePick(tool)}>
                <ItemIcon $bg={bg}><Icon /></ItemIcon>
                <span>{t(`dock.${tool}`, tool)}</span>
              </MenuItem>
              {canPin && (
                <PinBtn
                  type="button"
                  role="menuitem"
                  data-testid={`dock-pin-${tool}`}
                  $active={pinned === tool}
                  $armed={armedTool === tool && pinned !== tool}
                  aria-pressed={pinned === tool}
                  aria-label={(pinned === tool
                    ? t('popoutPin.unpin', '고정 해제')
                    : t('popoutPin.pin', '항상 위로 고정')) as string}
                  title={(pinned === tool
                    ? t('popoutPin.unpinHint', '고정을 해제하면 이 창이 닫힙니다. 도크에서 다시 열 수 있습니다.')
                    : t('popoutPin.pinHint', '다른 창 위에 작게 띄웁니다. 새 창은 열리지 않습니다.')) as string}
                  onClick={() => handlePin(tool)}
                >
                  <IconPin />
                </PinBtn>
              )}
            </ToolRow>
          ))}
          {/* C-4 정직한 문구 — F5 만 적으면 거짓말이다. 탭을 닫거나 로그아웃해도 같이 사라진다. */}
          {canPin && pinned && (
            <PinHint data-testid="dock-pin-hint">
              {t('popoutPin.lifetimeHint', '이 탭을 새로고침하거나 닫으면 고정이 풀립니다.')}
            </PinHint>
          )}
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

const IconPin = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M5 17h14l-1.7-2.6A2 2 0 0 1 17 13.3V7h1a1 1 0 0 0 0-2H6a1 1 0 0 0 0 2h1v6.3a2 2 0 0 1-.3 1.1z" />
  </svg>
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

// 핀 — "열기"(새 창)와 "고정"(PiP)은 서로 다른 결과라 한 행에 두 버튼으로 나란히 둔다.
const ToolRow = styled.div`
  display: flex; align-items: stretch; gap: 6px; width: 100%;
`;
const PinBtn = styled.button<{ $active: boolean; $armed?: boolean }>`
  flex-shrink: 0; width: 40px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 12px; cursor: pointer;
  background: ${({ $active }) => ($active ? '#0F766E' : '#FFFFFF')};
  color: ${({ $active }) => ($active ? '#FFFFFF' : '#94A3B8')};
  border: 1px solid ${({ $active }) => ($active ? '#0F766E' : '#E2E8F0')};
  box-shadow: 0 4px 14px rgba(15,23,42,0.12);
  transition: transform 0.12s, color 0.12s, border-color 0.12s;
  &:hover { transform: translateY(-1px); ${({ $active }) => ($active ? '' : 'color: #0F766E; border-color: #99F6E4;')} }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
  /* 팝아웃에서 "여기로 고정" 을 부탁받은 상태 — 사용자가 다음에 누를 자리를 가리킨다. */
  ${({ $armed }) => ($armed ? `
    border-color: #F43F5E; color: #F43F5E;
    animation: pqPinArm 1.1s ease-in-out infinite;
  ` : '')}
  @keyframes pqPinArm {
    0%, 100% { box-shadow: 0 4px 14px rgba(15,23,42,0.12); }
    50% { box-shadow: 0 0 0 5px rgba(244,63,94,0.28), 0 4px 14px rgba(15,23,42,0.12); }
  }
`;
const RestoreChip = styled.button`
  width: 100%;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 12px;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 12px;
  color: #0F766E; font-size: 12px; font-weight: 700; font-family: inherit;
  cursor: pointer; text-align: left;
  &:hover { background: #CCFBF1; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
  span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;
const PinHint = styled.p`
  margin: 0; padding: 0 6px;
  font-size: 11px; line-height: 1.4; color: #94A3B8; text-align: right;
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
