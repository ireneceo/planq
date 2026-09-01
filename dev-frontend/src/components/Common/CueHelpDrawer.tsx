// Q helperer — PlanQ 사용법 안내 + 운영팀 피드백 (우측 floating drawer).
// Cue (워크스페이스 AI 팀원) 와는 별개 페르소나 — PlanQ 제품/플랫폼 안내 전담.
// 진입:
//   1) ⌘? (mac) / Ctrl+/ (win) 단축키 — 어디서든 토글
//   2) HelpDot 의 "Q helper 에 묻기" → window.dispatchEvent('cue:ask', { detail: { prefill } })
//   3) 우측 하단 floating 버튼 (피드백 탭으로 진입)
// 탭:
//   - guide: PlanQ 사용법·기능 안내 (LLM 답변, 마지막 5턴)
//   - feedback: 운영팀에 버그·개선·기능요청 제출 (POST /api/feedback)
import React, { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useChromeLocation, useChromeNav } from '../../hooks/useChromeNav';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import AttachmentField from './AttachmentField';
import { formatDate } from '../../utils/dateFormat';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { mapApiError } from '../../utils/apiError';
import { fetchWikiContext, fetchWikiCategories, fetchWikiArticles, type WikiArticleSummary, type WikiCategory } from '../../services/wiki';
import CueTurnList from './CueTurnList';
import { useCueChat, cueActionDeepLink } from '../../hooks/useCueChat';
import { startQhelperHeartbeat, CUE_ASK_EVENT, type CueAskMsg } from '../../utils/cueAsk';
import { POPOUT_CHANNEL } from './PopoutBridge';
import { isEnterAction } from '../../utils/imeKey';

// 사이클 P7d — 채팅 모드 분리: qhelper(PlanQ 매뉴얼) / workspace(Cue, 워크스페이스 데이터)
// 'feedback' / 'inquiry' 는 별도 view (채팅 아닌 폼)
//   비로그인: qhelper(게스트 prompt) + inquiry(랜딩 문의 와 동일 백엔드)
//   로그인:  qhelper + workspace + feedback
type Mode = 'qhelper' | 'workspace' | 'feedback' | 'inquiry' | 'myhistory';

// 내가 남긴 문의·피드백 (GET /api/feedback/mine) — 운영 #21
interface MyFeedbackItem {
  id: number;
  category: string;
  priority: string;
  title: string;
  body: string;
  status: string;
  admin_response: string | null;
  responded_at: string | null;
  created_at: string;
}
type FeedbackCategory = 'bug' | 'improve' | 'feature' | 'other';

// Turn 타입은 hooks/useCueChat.ts 의 CueTurn 단일 원천을 쓴다(#227).

// N+93 — standalone: /help-popout 분리 창에서 풀윈도우로 마운트 (FAB/백드롭 없음, 항상 open, 닫기=window.close).
// #81 — 실행 완료 요약 (확인 카드가 접힌 뒤)
// #237 — "완료로 추가" 가 완료까지 못 간 경우의 안내 (성공 요약 아래 한 줄)

/**
 * publicSurface — 랜딩/마케팅/Q위키 등 공개 표면에서 마운트됐는가 (utils/publicSurface).
 *   렌더는 게스트 프레젠테이션(Q위키+문의 2탭)으로 고정하되, API 호출은 isGuest 기준을 그대로 둔다.
 *   (로그인 회원이 랜딩에 있어도 인증 호출·문의 prefill 은 본인 권한으로)
 * routerNavigate — 공개 표면 전용 react-router navigate 주입.
 *   여기서 RR 훅을 직접 호출하면 안 된다: 이 컴포넌트는 ChromeOverlays(router-less zone)에서도
 *   마운트되므로 훅 직접 호출 시 크래시한다. 공개 표면에선 TabMirror 가 없어 useChromeNav 가
 *   silent no-op 이 되므로(위키 링크가 죽은 버튼), App.tsx 가 RR navigate 를 내려준다.
 */
const CueHelpDrawer: React.FC<{
  standalone?: boolean;
  publicSurface?: boolean;
  routerNavigate?: (path: string) => void;
  /** 팝아웃 창의 핀(항상 위) 토글 — 헤더 우측 액션에 그대로 놓는다. 인앱 드로어는 undefined. */
  pinSlot?: React.ReactNode;
}> = ({ standalone = false, publicSurface = false, routerNavigate, pinSlot }) => {
  const { t } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const { t: tw } = useTranslation('wiki');
  const chromeLocation = useChromeLocation();
  const navigate = useChromeNav();
  const { user, isLoading } = useAuth();
  const isGuest = !user;
  // 공개 표면에선 sessionStorage 복원 탭의 stale path 가 올 수 있어 실제 브라우저 경로를 쓴다.
  const location: { pathname: string; search: string } = publicSurface
    ? {
        pathname: typeof window !== 'undefined' ? window.location.pathname : '/',
        search: typeof window !== 'undefined' ? window.location.search : '',
      }
    : chromeLocation;
  // 렌더(탭 구성·버튼) 기준. API 분기는 isGuest 를 그대로 쓴다 — 회원은 공개 표면에서도 본인 권한.
  const guestView = isGuest || publicSurface;
  const tz = (user as { workspace_timezone?: string } | null)?.workspace_timezone || 'Asia/Seoul';
  // N+93 — 비즈니스 멤버는 RightDock 통합 런처가 Q helper 진입을 제공 → 자체 floating FAB 숨김.
  // 게스트/Client 는 런처가 없으므로 기존 floating FAB 유지.
  const dockManaged = !!user?.business_id && ['owner', 'admin', 'member'].includes(user.business_role || '');
  const [open, setOpen] = useState(standalone); // standalone(/help-popout)은 항상 열림으로 시작
  const [mode, setMode] = useState<Mode>('workspace'); // N+93 — 첫 탭(워크스페이스 안내)이 디폴트 (Irene)
  // #293 — 피드백에서 "안내로 돌아가기" 는 **왔던 탭**으로 돌아가야 한다.
  //   여태 무조건 qhelper(Q위키) 로 보내서, Cue 에서 들어간 사용자는 "Q위키로 갔는데
  //   화면엔 아까 Cue 에게 물어본 대화가 남아있는" 상태를 봤다(대화는 정상, 탭이 틀렸던 것).
  const [preFeedbackMode, setPreFeedbackMode] = useState<Mode>('workspace');
  // #227 — 대화 동작은 훅(단일 원천)으로. 채팅·메일 우측 패널이 같은 것을 쓴다.
  const {
    input, setInput, turns, setTurns, submitting, setSubmitting,
    submit, sendAnswerFeedback, onActionExecuted, onActionDismiss,
  } = useCueChat({
    isGuest,
    mode,
    location,
    tErr: tErr as unknown as (k: string, d?: string) => string,
    translateError: (code: string) => (
      code === 'rate_limit_minute' ? (t('qhelper.rateLimitMinute', '잠깐만요 — 너무 빠르게 묻고 있어요. 1분 후 다시 시도해주세요.') as string)
        : code === 'rate_limit_day' ? (t('qhelper.rateLimitDay', '오늘 안내 횟수를 초과했습니다. 자세한 내용은 문의 남기기 탭으로 알려주세요.') as string)
          : null
    ),
    // #296 — 전송 후 auto-grow 로 늘어난 높이를 1줄로 되돌린다(안 하면 빈 입력창이 두껍게 남는다).
    onAfterSend: () => { if (inputRef.current) inputRef.current.style.height = ''; },
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 피드백 모드 폼 상태 (로그인 사용자 전용)
  const [fbCategory, setFbCategory] = useState<FeedbackCategory>('improve');
  const [fbPriority, setFbPriority] = useState<'normal' | 'high'>('normal');
  const [fbBody, setFbBody] = useState('');
  // 내 문의·피드백 내역 (운영 #21)
  const [myItems, setMyItems] = useState<MyFeedbackItem[]>([]);
  const [myLoading, setMyLoading] = useState(false);
  const [fbResultMsg, setFbResultMsg] = useState<string | null>(null);
  // N+63 — 피드백 이미지 첨부 (사용자 호소 #3c). base64 dataUrl 로 backend attachments JSON 에 직접 저장.
  // 1MB cap per file, 최대 3개. backend 의 attachments.slice(0, 5) 도 5건 cap 있음.
  // #232 — 첨부는 공용 AttachmentField(드래그드롭 회색 라운드박스) 로 통일했다.
  //   그 컴포넌트는 File[] 을 다루고 업로드는 호출부 책임이라, base64 변환은 제출 시점에 한다
  //   (피드백 첨부는 워크스페이스 파일이 아니라 feedback_items.attachments JSON 에 직접 저장).
  const [fbFiles, setFbFiles] = useState<File[]>([]);
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const [fbAttachError, setFbAttachError] = useState<string | null>(null);

  // 문의 모드 폼 상태 (게스트 전용 — 랜딩 /contact 와 동일 백엔드)
  const [inqName, setInqName] = useState('');
  const [inqEmail, setInqEmail] = useState('');
  const [inqMessage, setInqMessage] = useState('');
  const [inqResultMsg, setInqResultMsg] = useState<string | null>(null);

  // Q위키 탭 — 현재 화면 맥락 article + 카테고리 칩
  const [wikiContext, setWikiContext] = useState<WikiArticleSummary[]>([]);
  const [wikiCats, setWikiCats] = useState<WikiCategory[]>([]);
  // #146 — Q helper 도움말 검색 (help_articles FULLTEXT 한글검색 재사용).
  const [wikiSearch, setWikiSearch] = useState('');
  const [wikiSearchResults, setWikiSearchResults] = useState<WikiArticleSummary[]>([]);
  const [wikiSearching, setWikiSearching] = useState(false);

  // Q위키 article / 전체 위키로 이동.
  //   워크스페이스 안(앱 경로의 로그인 사용자) 또는 팝아웃 창 → 새 탭.
  //     작업 중이던 화면이 위키로 전환돼 사라지면 안 된다 (Irene: "전환되어 버리면 안 됨").
  //     Client 역할도 동일 — 워크스페이스에서 위키는 항상 새 탭.
  //   공개 표면(랜딩·위키) → 같은 탭 이동. 단 useChromeNav 는 TabMirror 부재로 no-op 이므로
  //     App.tsx 가 주입한 RR navigate 를 쓴다 (없으면 전체 로드로 폴백).
  const openWikiPath = useCallback((path: string) => {
    const inWorkspaceCtx = !publicSurface && !isGuest;
    if (standalone || inWorkspaceCtx) {
      window.open(path, '_blank', 'noopener');
      return; // 원래 보던 화면 유지 — 드로어도 닫지 않는다
    }
    if (publicSurface) {
      if (routerNavigate) routerNavigate(path);
      else window.location.assign(path);
    } else {
      navigate(path);
    }
    setOpen(false);
  }, [navigate, routerNavigate, standalone, publicSurface, isGuest]);

  // 게스트(또는 공개 표면)가 워크스페이스 전용 모드로 떨어지지 않게 보정
  useEffect(() => {
    if (guestView && (mode === 'workspace' || mode === 'feedback' || mode === 'myhistory')) {
      setMode('qhelper');
    }
  }, [guestView, mode]);

  // N+93 — 통합 런처(RightDock)에서 Q helper 선택 시 오픈 (qhelper 모드로 진입)
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent).detail?.tool === 'qhelper') {
        setMode(guestView ? 'qhelper' : 'workspace');
        setOpen(true);
      }
    };
    window.addEventListener('planq:open-tool', onOpen as EventListener);
    return () => window.removeEventListener('planq:open-tool', onOpen as EventListener);
  }, [guestView]);

  // N+93 — standalone(/help-popout): 닫기는 창 닫기
  const closeDrawer = () => { if (standalone) window.close(); else setOpen(false); };

  // 로그인 사용자가 inquiry 모드 진입 시 이름·이메일 자동 prefill (한 번만)
  useEffect(() => {
    if (mode === 'inquiry' && !isGuest && user) {
      if (!inqName && user.name) setInqName(user.name);
      if (!inqEmail && user.email) setInqEmail(user.email);
    }
  }, [mode, isGuest, user, inqName, inqEmail]);

  // 내 문의·피드백 내역 — myhistory 모드 진입 시 조회 (운영 #21)
  useEffect(() => {
    if (mode !== 'myhistory' || isGuest) return;
    let cancelled = false;
    setMyLoading(true);
    apiFetch('/api/feedback/mine')
      .then(r => r.json())
      .then(j => { if (!cancelled && j?.success) setMyItems(Array.isArray(j.data) ? j.data : []); })
      .catch(() => { if (!cancelled) setMyItems([]); })
      .finally(() => { if (!cancelled) setMyLoading(false); });
    return () => { cancelled = true; };
  }, [mode, isGuest]);

  // Q위키 탭 — 카테고리(공개) 1회 로드
  useEffect(() => {
    if (mode !== 'qhelper' || wikiCats.length) return;
    let cancelled = false;
    fetchWikiCategories().then((c) => { if (!cancelled) setWikiCats(Array.isArray(c) ? c : []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [mode, wikiCats.length]);

  // #146 — 도움말 검색: 입력 300ms 디바운스 → fetchWikiArticles({ q }). 빈 검색어면 결과 비움.
  useEffect(() => {
    const q = wikiSearch.trim();
    if (!q) { setWikiSearchResults([]); setWikiSearching(false); return; }
    setWikiSearching(true);
    let cancelled = false;
    const id = window.setTimeout(() => {
      fetchWikiArticles({ q, limit: 12 })
        .then((r) => { if (!cancelled) setWikiSearchResults(Array.isArray(r?.data) ? r.data : []); })
        .catch(() => { if (!cancelled) setWikiSearchResults([]); })
        .finally(() => { if (!cancelled) setWikiSearching(false); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [wikiSearch]);

  // Q위키 탭 — 현재 화면 맥락 article (로그인 사용자만, path 바뀌면 갱신)
  useEffect(() => {
    if (mode !== 'qhelper' || guestView || !open) { return; }
    let cancelled = false;
    fetchWikiContext(location.pathname)
      .then((arts) => { if (!cancelled) setWikiContext(arts); })
      .catch(() => { if (!cancelled) setWikiContext([]); });
    return () => { cancelled = true; };
  }, [mode, guestView, open, location.pathname]);

  useBodyScrollLock(open);

  // 단축키 ⌘? / Ctrl+/
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const wantOpen = (isMac && e.metaKey && e.key === '?') || (!isMac && e.ctrlKey && e.key === '/');
      if (wantOpen) {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // cue:ask — detail.tab 으로 진입 탭 결정 ('wiki' → Q위키, 'cue' → Cue)
  const applyAsk = useCallback((prefill: string, tab?: 'wiki' | 'cue') => {
    if (tab === 'wiki') setMode('qhelper');
    else if (tab === 'cue' && !guestView) setMode('workspace');
    setOpen(true);
    if (prefill) setInput(prefill);
    // 팝아웃 창이면 사용자가 그 창을 보고 있어야 질문이 전달된 것이다.
    if (standalone) { try { window.focus(); } catch { /* 제스처 밖이면 브라우저가 무시 */ } }
  }, [guestView, standalone]);

  useEffect(() => {
    const onAsk = (e: Event) => {
      const ce = e as CustomEvent<{ prefill?: string; tab?: 'wiki' | 'cue' }>;
      applyAsk(ce.detail?.prefill || '', ce.detail?.tab);
    };
    window.addEventListener(CUE_ASK_EVENT, onAsk as EventListener);
    return () => window.removeEventListener(CUE_ASK_EVENT, onAsk as EventListener);
  }, [applyAsk]);

  // ★ 창 경계 넘기 (Irene 2026-08-30) — Q helper 를 **별도 창**으로 띄워 둔 사용자에게는
  //   window 이벤트가 닿지 않는다. 검색어를 들고 오는 채널 수신은 **팝아웃 인스턴스만** 한다
  //   (본 창까지 받으면 같은 질문이 두 곳에 열려 어느 쪽이 내 질문인지 알 수 없다).
  //   같은 이유로 심박도 팝아웃만 찍는다 — 이 심박이 "본 창 드로어를 열지 말라"는 신호다.
  useEffect(() => {
    if (!standalone) return;
    const stopBeat = startQhelperHeartbeat();
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(POPOUT_CHANNEL); } catch { return stopBeat; }
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data as CueAskMsg | null;
      if (!m || typeof m !== 'object' || m.type !== 'cue-ask') return;
      applyAsk(String(m.prefill || ''), m.tab);
    };
    ch.addEventListener('message', onMsg);
    return () => {
      stopBeat();
      try { ch?.removeEventListener('message', onMsg); ch?.close(); } catch { /* noop */ }
    };
  }, [standalone, applyAsk]);

  // 열린 후 input focus
  useEffect(() => {
    if (open) {
      const tm = window.setTimeout(() => inputRef.current?.focus(), 100);
      return () => window.clearTimeout(tm);
    }
  }, [open]);

  // 답변 도착 시 자동 스크롤
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [turns]);

  // submit · 답변 피드백 · 확인 카드 핸들러 · 딥링크는 모두 useCueChat 로 옮겼다(#227).

  // 게스트 문의 제출 — 랜딩 /contact 와 동일 백엔드 (POST /api/inquiries)
  const submitInquiry = useCallback(async () => {
    if (submitting) return;
    if (!inqName.trim() || !inqEmail.trim() || !inqMessage.trim()) {
      setInqResultMsg(t('qhelper.inqRequired', '이름·이메일·내용을 모두 입력해주세요.') as string);
      return;
    }
    setSubmitting(true);
    setInqResultMsg(null);
    try {
      // 로그인 사용자는 apiFetch (토큰 자동) 로 호출 → 백엔드가 user 식별 + timezone 저장
      const fetcher = isGuest ? fetch : apiFetch;
      const res = await fetcher('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'general',
          source: isGuest ? 'guest_cue_widget' : 'user_cue_widget',
          from_name: inqName.trim(),
          from_email: inqEmail.trim(),
          message: inqMessage.trim(),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message || 'inquiry error');
      setInqResultMsg(t('qhelper.inqThanks', '문의가 접수됐습니다. 영업일 기준 24시간 내 회신드릴게요.') as string);
      setInqName(''); setInqEmail(''); setInqMessage('');
      window.setTimeout(() => setInqResultMsg(null), 8000);
    } catch (e) {
      setInqResultMsg(t('qhelper.inqErr', '제출 실패: {{msg}}', { msg: mapApiError(e, tErr) }) as string);
    } finally {
      setSubmitting(false);
    }
  }, [inqName, inqEmail, inqMessage, submitting, t]);

  // 피드백 제출 (자동 메타: page_url, user_agent)
  const submitFeedback = useCallback(async () => {
    if (!fbBody.trim() || submitting) return;
    setSubmitting(true);
    setFbResultMsg(null);
    // #162 — 도움말 팝아웃(/help-popout) 안에서 제출하면 여태 팝아웃 자신의 URL 이 page_url 로 찍혀
    //   실제 사용 화면 대신 전부 /help-popout 으로 오기록됐다(트리아지 왜곡). 팝아웃이면 부모(opener) 화면 URL 을 잡는다.
    let pageUrl = location.pathname + (location.search || '');
    try {
      if (typeof window !== 'undefined' && window.opener && !window.opener.closed
          && location.pathname.startsWith('/help')) {
        const o = window.opener.location;
        pageUrl = o.pathname + (o.search || '');
      }
    } catch { /* cross-origin 등 — 자기 URL 유지 */ }
    // #162 — 디바이스·앱 환경 + 팝아웃 여부 수집(트리아지 정확도). page_url 팝아웃 보정과 세트.
    const isPopout = location.pathname.startsWith('/help') && typeof window !== 'undefined' && !!window.opener;
    let clientEnv: Record<string, unknown> | null = null;
    try {
      clientEnv = {
        vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio,
        lang: navigator.language, platform: navigator.platform,
        standalone: window.matchMedia('(display-mode: standalone)').matches,
      };
    } catch { clientEnv = null; }
    // 저장 형식은 종전과 동일하다 — { name, type, dataUrl } 배열 (feedback_items.attachments JSON).
    //   UI 만 드롭존으로 바뀌었고 서버 계약은 그대로다.
    let fbAttachmentPayload: Array<{ name: string; type: string; dataUrl: string }> = [];
    try {
      fbAttachmentPayload = await Promise.all(fbFiles.map(f => new Promise<{ name: string; type: string; dataUrl: string }>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res({ name: f.name, type: f.type, dataUrl: String(reader.result) });
        reader.onerror = rej;
        reader.readAsDataURL(f);
      })));
    } catch {
      setFbAttachError(t('qhelper.fbAttachReadFail', '파일 읽기 실패') as string);
      setSubmitting(false);
      return;
    }
    try {
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: fbCategory,
          priority: fbPriority,
          title: (fbBody.trim().split('\n')[0] || '').slice(0, 60) || '(제목 없음)',
          body: fbBody.trim(),
          page_url: pageUrl,
          is_popout: isPopout,
          client_env: clientEnv,
          attachments: fbAttachmentPayload.length > 0 ? fbAttachmentPayload : null,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message || 'feedback error');
      setFbResultMsg(t('qhelper.fbThanks', '접수됐습니다 #{{id}} — 빠르게 검토할게요', { id: j.data?.id }) as string);
      setFbBody('');
      setFbCategory('improve');
      setFbPriority('normal');
      setFbFiles([]);
      setFbAttachError(null);
      window.setTimeout(() => setFbResultMsg(null), 6000);
    } catch (e) {
      setFbResultMsg(t('qhelper.fbErr', '제출 실패: {{msg}}', { msg: mapApiError(e, tErr) }) as string);
    } finally {
      setSubmitting(false);
    }
  }, [fbCategory, fbPriority, fbBody, fbFiles, submitting, location, t]);

  // 피드백 이미지 첨부 규칙 — 이미지만 / 파일당 1MB / 최대 3개.
  //   AttachmentField 가 고른 File[] 을 받아 여기서 검증한다(통과분만 상태에 남긴다).
  const onFbFilesChange = useCallback((next: File[]) => {
    setFbAttachError(null);
    const ok: File[] = [];
    for (const f of next) {
      if (!f.type.startsWith('image/')) { setFbAttachError(t('qhelper.fbAttachImageOnly', '이미지만 첨부 가능') as string); continue; }
      if (f.size > 1024 * 1024) { setFbAttachError(t('qhelper.fbAttachTooBig', '파일당 1MB 이하', { name: f.name }) as string); continue; }
      ok.push(f);
    }
    if (ok.length > 3) {
      setFbAttachError(t('qhelper.fbAttachMax', '최대 3개까지 첨부 가능') as string);
      setFbFiles(ok.slice(0, 3));
      return;
    }
    setFbFiles(ok);
  }, [t]);

  // 컨텍스트 기반 자동 숨김 — Q Talk 같이 우하단 입력 영역(전송버튼/IME 도구)을 점유하는 화면에서는
  // FAB 가 충돌하므로 숨긴다. 도움말은 헤더의 ⓘ 아이콘 또는 단축키 (⌘? / Ctrl+/) 로 접근.
  // 새 페이지 추가 시 이 목록만 갱신.
  // 사이클 N+24: /talk 차단 해제 — 사용자 요청 "Q Talk 에서도 헬프 FAB 노출".
  // 옛 정책은 Q Talk 채팅 InputBar 위 입력 도구 충돌 우려였으나, FAB 가 우하단 (메모: bottom 16px, 헬프: bottom 80px)
  // 이라 채팅 입력란과 분리. 표시 유지.
  const FAB_HIDDEN_PATHS: string[] = [];
  const fabHidden = FAB_HIDDEN_PATHS.some(p => location.pathname === p || location.pathname.startsWith(`${p}/`));

  return (
    <>
      {/* 공개 표면에는 RightDock 런처가 없으므로 회원이어도 자체 FAB 를 띄운다(dockManaged 무시). */}
      {!standalone && !open && !fabHidden && (!dockManaged || publicSurface) && !isLoading && (
        <FloatingTrigger
          type="button"
          onClick={() => { setMode(guestView ? 'qhelper' : 'workspace'); setOpen(true); }}
          aria-label={t('qhelper.openFloating', 'Q helper — 사용 안내 + 피드백') as string}
          title={t('qhelper.openFloating', 'Q helper — 사용 안내 + 피드백') as string}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </FloatingTrigger>
      )}
      {open && <>
      {/* 공개 표면(랜딩·위키)에선 우측 전체 드로어 대신 FAB 위 팝오버(챗봇 위젯 스타일).
          배경 딤은 두지 않는다 — 랜딩을 가리지 않고 옆에 뜨는 느낌(#188). 바깥 클릭은 닫기. */}
      {!standalone && !publicSurface && <Backdrop onClick={() => setOpen(false)} />}
      {!standalone && publicSurface && <PopoverBackdrop onClick={() => setOpen(false)} />}
      <Drawer ref={drawerRef} $standalone={standalone} $popover={!standalone && publicSurface} role="dialog" aria-label={t('qhelper.title', 'Q helper') as string}>
        <Header>
          <HeaderTitle>
            {/* N+93 — 타이틀은 탭과 무관하게 항상 'Q helper' 고정 (Irene). Sparkle 도 항상 민트. */}
            <Sparkle aria-hidden $cue={false}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
            </Sparkle>
            <span>
              {guestView ? t('qhelper.guestTitle', 'PlanQ 안내') : t('qhelper.title', 'Q helper')}
            </span>
          </HeaderTitle>
          <HeaderActions>
            {/* N+93 — 피드백 보내기는 상단 빨간 버튼으로 유지 (Irene). 탭은 3개(워크스페이스/PlanQ안내/문의). */}
            {!guestView && mode !== 'feedback' && (
              <FeedbackEnter type="button" onClick={() => { setPreFeedbackMode(mode); setMode('feedback'); }}>
                {t('qhelper.openFeedbackBtn', '피드백 보내기')}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </FeedbackEnter>
            )}
            {!guestView && mode === 'feedback' && (
              <BackToGuide type="button" onClick={() => setMode(preFeedbackMode === 'feedback' ? 'qhelper' : preFeedbackMode)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                {t('qhelper.backToGuide', '안내로 돌아가기')}
              </BackToGuide>
            )}
            {pinSlot}
            <CloseBtn type="button" onClick={closeDrawer} aria-label={t('close', '닫기') as string}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </CloseBtn>
          </HeaderActions>
        </Header>
        {mode !== 'feedback' && !guestView && (
          // N+93 — 3탭: {워크스페이스명} 안내 → PlanQ 안내 → 문의 남기기 (피드백은 상단 빨간 버튼)
          <ModeSwitch role="tablist">
            <ModeBtn type="button" $active={mode === 'workspace'} $variant="workspace"
              onClick={() => { setMode('workspace'); setTurns([]); }} role="tab" aria-selected={mode === 'workspace'}>
              <ModeDot $variant="cue" />
              {tw('drawer.tabCue')}
            </ModeBtn>
            <ModeBtn type="button" $active={mode === 'qhelper'} $variant="qhelper"
              onClick={() => { setMode('qhelper'); setTurns([]); }} role="tab" aria-selected={mode === 'qhelper'}>
              <ModeDot $variant="wiki" />
              {tw('drawer.tabWiki')}
            </ModeBtn>
            <ModeBtn type="button" $active={mode === 'inquiry'} $variant="qhelper"
              onClick={() => setMode('inquiry')} role="tab" aria-selected={mode === 'inquiry'}>
              <ModeDot $variant="inquiry" />
              {tw('drawer.tabInquiry')}
            </ModeBtn>
          </ModeSwitch>
        )}
        {guestView && (
          <ModeSwitch role="tablist">
            <ModeBtn type="button" $active={mode === 'qhelper'} $variant="qhelper"
              onClick={() => { setMode('qhelper'); setTurns([]); }} role="tab" aria-selected={mode === 'qhelper'}>
              <ModeDot $variant="wiki" />
              {tw('drawer.tabWiki')}
            </ModeBtn>
            <ModeBtn type="button" $active={mode === 'inquiry'} $variant="qhelper"
              onClick={() => setMode('inquiry')} role="tab" aria-selected={mode === 'inquiry'}>
              <ModeDot $variant="inquiry" />
              {tw('drawer.tabInquiry')}
            </ModeBtn>
          </ModeSwitch>
        )}
        {/* #295 — 탭 이름만으로는 Cue(내 워크스페이스) 와 Q위키(PlanQ 사용법) 를 구분하기 어렵다.
            지금 선택된 탭이 **무엇을 다루는지** 한 줄로 상시 표시한다.
            (tabCueSub/tabWikiSub 는 ko/en 양쪽에 이미 있었는데 어디서도 안 쓰이고 있었다) */}
        {mode !== 'feedback' && (
          <ModeHint>
            <ModeDot $variant={mode === 'workspace' ? 'cue' : mode === 'inquiry' ? 'inquiry' : 'wiki'} />
            <span>
              {mode === 'workspace'
                ? tw('drawer.tabCueSub')
                : mode === 'inquiry'
                  ? tw('drawer.tabInquirySub')
                  : tw('drawer.tabWikiSub')}
            </span>
          </ModeHint>
        )}
        {mode === 'qhelper' && turns.length === 0 && (
          <WikiPanel>
            {/* #146 — 도움말 검색. 검색어가 있으면 결과를, 없으면 이 화면 맥락·카테고리를 보여준다. */}
            <WikiSearchInput
              value={wikiSearch}
              onChange={(e) => setWikiSearch(e.target.value)}
              placeholder={tw('drawer.searchPlaceholder', { defaultValue: '도움말 검색' }) as string}
              aria-label={tw('drawer.searchPlaceholder', { defaultValue: '도움말 검색' }) as string}
            />
            {wikiSearch.trim() ? (
              <WikiSection>
                <WikiSectionLabel>{tw('drawer.searchResults', { defaultValue: '검색 결과' }) as string}</WikiSectionLabel>
                {wikiSearchResults.length > 0 ? (
                  wikiSearchResults.map((a) => (
                    <WikiContextCard key={a.id} type="button" onClick={() => openWikiPath(`/wiki/a/${a.slug}`)}>
                      <WikiCardTitle>{a.title}</WikiCardTitle>
                      {a.summary && <WikiCardSummary>{a.summary}</WikiCardSummary>}
                    </WikiContextCard>
                  ))
                ) : (
                  <WikiEmptyHint>
                    {wikiSearching
                      ? (tw('drawer.searching', { defaultValue: '검색 중…' }) as string)
                      : (tw('drawer.searchNoResults', { defaultValue: '검색 결과가 없어요' }) as string)}
                  </WikiEmptyHint>
                )}
              </WikiSection>
            ) : (
              <>
                {!guestView && wikiContext.length > 0 && (
                  <WikiSection>
                    <WikiSectionLabel>{tw('drawer.thisScreen')}</WikiSectionLabel>
                    {wikiContext.slice(0, 3).map((a) => (
                      <WikiContextCard key={a.id} type="button" onClick={() => openWikiPath(`/wiki/a/${a.slug}`)}>
                        <WikiCardTitle>{a.title}</WikiCardTitle>
                        {a.summary && <WikiCardSummary>{a.summary}</WikiCardSummary>}
                      </WikiContextCard>
                    ))}
                  </WikiSection>
                )}
                {wikiCats.length > 0 && (
                  <QuickChips>
                    {wikiCats.map((c) => (
                      <QuickChip key={c.id} type="button" onClick={() => openWikiPath(`/wiki?category=${c.slug}`)}>
                        {c.title}
                      </QuickChip>
                    ))}
                  </QuickChips>
                )}
              </>
            )}
            <WikiFullLink type="button" onClick={() => openWikiPath('/wiki')}>
              {tw('drawer.openFullWiki')} →
            </WikiFullLink>
          </WikiPanel>
        )}
        {mode === 'workspace' && turns.length === 0 && (
          <QuickChips>
            {[
              { v: 'tasks', label: t('qhelper.cueQuickTasks', '내 업무') },
              { v: 'clients', label: t('qhelper.cueQuickClients', '고객') },
              { v: 'schedule', label: t('qhelper.cueQuickSchedule', '일정') },
              { v: 'docs', label: t('qhelper.cueQuickDocs', '문서') },
            ].map(c => (
              <QuickChip key={c.v} type="button" onClick={() => setInput(`[${c.label}] `)}>
                {c.label}
              </QuickChip>
            ))}
          </QuickChips>
        )}
        {mode === 'feedback' && (
          <FeedbackPitch>
            {t('qhelper.fbPitch', 'PlanQ 가 더 좋아지도록 의견을 남겨주세요. 모든 제안을 검토합니다.')}
          </FeedbackPitch>
        )}
        <Body ref={bodyRef}>
          {(mode === 'qhelper' || mode === 'workspace') && (
            turns.length === 0 ? (
              <Empty>
                <EmptyTitle>
                  {mode === 'workspace' ? t('qhelper.cueEmptyTitle', { ws: user?.business_name || (t('qhelper.workspaceFallback', '워크스페이스') as string), defaultValue: '{{ws}} 에 대해 무엇이든' })
                    : guestView ? t('qhelper.guestEmptyTitle', 'PlanQ, 무엇이든 물어보세요')
                    : t('qhelper.emptyTitle', '무엇이 궁금한가요?')}
                </EmptyTitle>
                <EmptyHint>
                  {mode === 'workspace'
                    ? t('qhelper.cueEmptyHint', '현재 워크스페이스의 고객·업무·일정·회의를 기반으로 답변합니다. 다른 워크스페이스 데이터는 보지 않습니다.')
                    : guestView
                      ? t('qhelper.guestEmptyHint', 'PlanQ 의 기능·가격·도입 효과를 편하게 물어보세요. 사람에게 직접 묻고 싶으면 "문의 남기기" 탭으로 이동하세요.')
                      : t('qhelper.emptyHint', 'PlanQ 의 사용법·기능을 자연어로 물어보세요. 현재 화면 컨텍스트를 읽고 답변합니다.')}
                </EmptyHint>
                {!guestView && (
                  <EmptyShortcut>
                    <kbd>⌘</kbd> <kbd>?</kbd> {t('qhelper.toggleHint', '로 언제든 열고 닫기')}
                  </EmptyShortcut>
                )}
              </Empty>
            ) : (
              <CueTurnList
                turns={turns}
                mode={mode}
                businessId={user?.business_id ?? null}
                onFeedback={sendAnswerFeedback}
                onActionExecuted={onActionExecuted}
                onActionDismiss={onActionDismiss}
                onOpenResult={(r) => { navigate(cueActionDeepLink(r)); closeDrawer(); }}
                onOpenSource={(slug) => openWikiPath(`/wiki/a/${slug}`)}
              />
            )
          )}
          {mode === 'feedback' && (
            <FbForm>
              <FbField>
                <FbLabel>{t('qhelper.fbCategory', '분류')}</FbLabel>
                <FbCatRow>
                  {(['bug', 'improve', 'feature', 'other'] as FeedbackCategory[]).map(c => (
                    <FbCatBtn
                      key={c} type="button"
                      $active={fbCategory === c}
                      onClick={() => setFbCategory(c)}
                    >
                      {t(`qhelper.fbCat.${c}`)}
                    </FbCatBtn>
                  ))}
                </FbCatRow>
              </FbField>
              <FbField>
                <FbLabel>{t('qhelper.fbBody', '내용')}</FbLabel>
                <FbTextArea
                  value={fbBody}
                  onChange={e => setFbBody(e.target.value)}
                  placeholder={t('qhelper.fbBodyPh', '구체적으로 적어주시면 빠르게 반영할 수 있습니다.\n예) 어디서 / 무엇이 / 어떻게 되었으면') as string}
                  rows={6}
                />
              </FbField>
              <FbField>
                <FbLabel>{t('qhelper.fbAttach', '이미지 첨부 (선택)')}</FbLabel>
                {/* #232 — 버튼 대신 드래그드롭 드롭존으로 통일 (Irene: "전체 통일되게 드래그드롭 회색 라운드박스").
                    워크스페이스 파일 연결 검색은 여기서 의미가 없어 숨긴다(목록 fetch 도 안 한다). */}
                {businessId ? (
                  <AttachmentField
                    businessId={businessId}
                    uploads={fbFiles}
                    onUploadsChange={onFbFilesChange}
                    existingFileIds={[]}
                    onExistingFileIdsChange={() => { /* 피드백은 기존 파일 연결 없음 */ }}
                    hideExistingSearch
                    accept="image/*"
                    uploadAcceptHint={t('qhelper.fbAttachHint', '최대 3개, 파일당 1MB 이하 (스크린샷 권장)') as string}
                  />
                ) : (
                  <FbAttachHint>{t('qhelper.fbAttachNoWorkspace', '워크스페이스에 들어가면 이미지를 첨부할 수 있어요')}</FbAttachHint>
                )}
                {fbAttachError && <FbAttachErr>{fbAttachError}</FbAttachErr>}
              </FbField>
              <FbCheck>
                <input
                  type="checkbox"
                  id="fb-urgent"
                  checked={fbPriority === 'high'}
                  onChange={e => setFbPriority(e.target.checked ? 'high' : 'normal')}
                />
                <label htmlFor="fb-urgent">{t('qhelper.fbUrgent', '긴급 (서비스 사용 불가 등)')}</label>
              </FbCheck>
              <FbMeta>
                <FbMetaLabel>{t('qhelper.fbMeta', '자동으로 함께 전송')}:</FbMetaLabel>
                <FbMetaValue>{location.pathname}{location.search}</FbMetaValue>
              </FbMeta>
              {fbResultMsg && <FbResult>{fbResultMsg}</FbResult>}
            </FbForm>
          )}
          {mode === 'inquiry' && (
            <FbForm>
              {!guestView && (
                <MyHistoryLink type="button" onClick={() => setMode('myhistory')}>
                  {t('qhelper.myHistoryEnter', { defaultValue: '내가 남긴 문의·피드백 보기' }) as string} →
                </MyHistoryLink>
              )}
              <FbField>
                <FbLabel>{t('qhelper.inqName', '이름')}</FbLabel>
                <FbInput
                  type="text" value={inqName}
                  onChange={e => setInqName(e.target.value)}
                  placeholder={t('qhelper.inqNamePh', '예: 홍길동') as string}
                  maxLength={100}
                />
              </FbField>
              <FbField>
                <FbLabel>{t('qhelper.inqEmail', '이메일')}</FbLabel>
                <FbInput
                  type="email" value={inqEmail}
                  onChange={e => setInqEmail(e.target.value)}
                  placeholder="name@company.com"
                  maxLength={200}
                />
              </FbField>
              <FbField>
                <FbLabel>{t('qhelper.inqMessage', '문의 내용')}</FbLabel>
                <FbTextArea
                  value={inqMessage}
                  onChange={e => setInqMessage(e.target.value)}
                  placeholder={t('qhelper.inqMessagePh', '궁금한 점 또는 도입 검토 중인 내용을 알려주세요. 영업일 기준 24시간 내 회신드립니다.') as string}
                  rows={6}
                  maxLength={5000}
                />
              </FbField>
              {inqResultMsg && <FbResult>{inqResultMsg}</FbResult>}
            </FbForm>
          )}
          {mode === 'myhistory' && !guestView && (
            <MyHistoryWrap>
              <MyHistoryBack type="button" onClick={() => setMode('inquiry')}>
                ← {t('qhelper.myHistoryBack', { defaultValue: '문의 남기기로' }) as string}
              </MyHistoryBack>
              {myLoading ? (
                <MyHistoryEmpty>{t('qhelper.myHistoryLoading', { defaultValue: '불러오는 중…' }) as string}</MyHistoryEmpty>
              ) : myItems.length === 0 ? (
                <MyHistoryEmpty>{t('qhelper.myHistoryEmpty', { defaultValue: '아직 남긴 문의·피드백이 없어요.' }) as string}</MyHistoryEmpty>
              ) : (
                myItems.map(it => (
                  <MyHistoryCard key={it.id}>
                    <MyHistoryTop>
                      <MyHistCat>{t(`qhelper.fbCat.${it.category}`, { defaultValue: it.category }) as string}</MyHistCat>
                      <MyHistStatus $s={it.status}>
                        {t(`qhelper.fbStatus.${it.status}`, { defaultValue: it.status }) as string}
                      </MyHistStatus>
                      <MyHistDate>{formatDate(it.created_at, tz)}</MyHistDate>
                    </MyHistoryTop>
                    <MyHistBody>{it.body}</MyHistBody>
                    {it.admin_response && (
                      <MyHistReply>
                        <MyHistReplyLabel>{t('qhelper.myHistoryReply', { defaultValue: '운영팀 답변' }) as string}</MyHistReplyLabel>
                        <MyHistReplyText>{it.admin_response}</MyHistReplyText>
                      </MyHistReply>
                    )}
                  </MyHistoryCard>
                ))
              )}
            </MyHistoryWrap>
          )}
        </Body>
        <Footer>
          {(mode === 'qhelper' || mode === 'workspace') && (
            // N+93 — Q Talk 컴포저와 동일: 전송 아이콘이 입력란 안. Enter 전송 / Shift+Enter 줄바꿈 (IME 가드).
            <InputWrap>
              <InputTextarea
                ref={inputRef}
                value={input}
                /* ★ 입력창은 **조작법만** 말한다 (Irene 2026-08-31).
                   바로 위에 "○○ 에 대해 무엇이든" 과 안내문이 이미 있어서, 입력창까지 같은 말을
                   반복하면 군더더기다. 괄호도 뺀다 — 괄호 안이 곧 내용이었다. */
                placeholder={t('qhelper.inputPh') as string}
                onChange={e => {
                  setInput(e.target.value);
                  // #296 — 1줄로 시작해 내용만큼만 늘어난다. 고정 2줄이면 Q위키 팝업처럼
                  //   세로가 빠듯한 화면에서 입력창이 아래에 두껍게 붙어 답답해 보인다.
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                }}
                onKeyDown={e => {
                  // Q Talk 과 동일한 입력 동작: Enter 전송 / Shift+Enter 줄바꿈.
                  // IME 한글 조합 중 Enter 는 조합 확정이므로 전송 안 함 (isComposing / keyCode 229 가드).
                  if (e.nativeEvent.isComposing || (e.nativeEvent as KeyboardEvent).keyCode === 229) return;
                  if (isEnterAction(e) && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
              />
              <SendBtn type="button" onClick={() => submit()} disabled={submitting || !input.trim()}
                title={t('qhelper.send', '보내기') as string} aria-label={t('qhelper.send', '보내기') as string}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </SendBtn>
            </InputWrap>
          )}
          {mode === 'feedback' && (
            <FbSendBtn type="button" onClick={submitFeedback} disabled={submitting || !fbBody.trim()}>
              {submitting ? t('qhelper.fbSending', '제출 중…') : t('qhelper.fbSend', '제출')}
            </FbSendBtn>
          )}
          {mode === 'inquiry' && (
            <FbSendBtn type="button" onClick={submitInquiry}
              disabled={submitting || !inqName.trim() || !inqEmail.trim() || !inqMessage.trim()}
              style={{ background: '#0D9488' }}>
              {submitting ? t('qhelper.inqSending', '제출 중…') : t('qhelper.inqSend', '문의 보내기')}
            </FbSendBtn>
          )}
        </Footer>
      </Drawer>
      </>}
    </>
  );
};

export default CueHelpDrawer;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.30);
  z-index: 1000;
`;
// ★ 모바일 키보드 (Irene 2026-08-29: "큐헬프가 키보드나오고 채팅창 딱 올라가야 하는데 안그래")
//   position:fixed 는 **레이아웃 뷰포트**에 붙는다. iOS 는 키보드를 올릴 때 레이아웃 뷰포트를
//   그대로 두고 visual viewport 만 줄이므로, `bottom: 0` 으로 잡아 둔 이 드로어는 바닥이
//   키보드 뒤로 들어가고 그 바닥에 있는 입력줄이 통째로 가려진다.
//   해법은 이미 이 저장소에 있다 — DetailDrawer.Panel 의 계약(top: --vv-top / height: --vvh)이
//   그것이다. 베껴 만든 이 드로어만 그 계약에서 빠져 있었다.
//     --vvh    : visual viewport 높이 (키보드가 먹은 만큼 줄어든다)
//     --vv-top : iOS 가 visual viewport 를 아래로 민 양 (안 더하면 헤더가 화면 위로 잘려 나간다)
//   둘 다 main.tsx 가 실시간 sync 하고, 키보드 없음·데스크탑에서는 각각 전체 높이·0 이라
//   기존 동작과 완전히 같다(회귀 0).
const Drawer = styled.div<{ $standalone?: boolean; $popover?: boolean }>`
  position: fixed;
  z-index: 1001;
  background: #FFFFFF;
  display: flex; flex-direction: column;
  ${(p) => (p.$popover ? `
    /* 공개 표면 — FAB(우하단 20/80px) 바로 위에 뜨는 챗봇 위젯 팝오버 (#188) */
    right: 20px; bottom: 88px; top: auto; left: auto;
    width: min(400px, calc(100vw - 40px));
    height: min(620px, calc(100vh - 120px));
    border: 1px solid #E2E8F0; border-radius: 16px;
    box-shadow: 0 12px 48px rgba(15, 23, 42, 0.18);
    overflow: hidden;
    transform-origin: bottom right;
    animation: cuePopIn 0.16s ease-out;
    @keyframes cuePopIn { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @media (max-width: 640px) {
      right: 0; left: 0; top: auto;
      /* 바닥 시트도 같은 이유로 키보드 위에 올라와야 한다. 바닥을 키보드 높이만큼 띄우고
         높이는 보이는 영역(--vvh) 안으로 가둔다. 키보드 없음 = 0 이라 종전과 동일. */
      bottom: var(--keyboard-height, 0px);
      width: 100vw; height: min(88vh, var(--vvh, 100vh)); border-radius: 16px 16px 0 0;
      padding-bottom: var(--pq-safe-bottom, 0px);
    }
  ` : `
    /* 워크스페이스 — 우측 전체 드로어 */
    top: var(--vv-top, 0px); right: 0; bottom: auto;
    height: var(--vvh, 100dvh);
    width: ${p.$standalone ? '100vw' : '440px'};
    ${p.$standalone ? 'left: 0;' : ''}
    border-left: ${p.$standalone ? 'none' : '1px solid #E2E8F0'};
    box-shadow: ${p.$standalone ? 'none' : '-8px 0 32px rgba(15, 23, 42, 0.10)'};
    animation: ${p.$standalone ? 'none' : 'cueSlideIn 0.2s ease-out'};
    @keyframes cueSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
    @media (max-width: 1024px) { width: ${p.$standalone ? '100vw' : 'min(440px, 90vw)'}; }
    @media (max-width: 640px) {
      width: 100vw; border-left: none; box-shadow: none;
      padding-bottom: var(--pq-safe-bottom, 0px);
    }
  `)}
`;
// 팝오버 배경 — 딤 없이 투명. 바깥 클릭만 닫기(랜딩을 가리지 않는다, #188).
const PopoverBackdrop = styled.div`
  position: fixed; inset: 0; z-index: 1000; background: transparent;
`;
const Header = styled.div`
  flex-shrink: 0;
  min-height: 56px; box-sizing: border-box;
  padding: 0 16px;
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid #E2E8F0;
  /* #84 — 모바일(풀스크린) 노치/상태바 대응 (전 팝아웃 헤더 통일). */
  @media (max-width: 640px) { padding-top: var(--pq-safe-top, 0px); }
`;
const HeaderTitle = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 0.875rem; font-weight: 700; color: #0F172A;
`;
const Sparkle = styled.span<{ $cue?: boolean }>`
  display: inline-flex;
  color: ${p => p.$cue ? '#F43F5E' : '#0D9488'};
`;
const CloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }

  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 8px;
  color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  /* min-height: 0 — flex 자식은 기본 min-height:auto 라 내용이 길면 줄지 않고 밀어낸다.
     그러면 아래 Footer(입력줄)가 드로어 밖으로 밀려나 키보드 보정이 무의미해진다. */
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 16px;
`;
const Empty = styled.div`
  text-align: center; padding: 40px 20px;
`;
const EmptyTitle = styled.h4`
  font-size: 0.875rem; font-weight: 700; color: #0F172A;
  margin: 0 0 6px;
`;
const EmptyHint = styled.p`
  font-size: 0.8125rem; color: #64748B;
  margin: 0 0 16px; line-height: 1.55;
`;
const EmptyShortcut = styled.div`
  font-size: 0.75rem; color: #94A3B8;
  display: inline-flex; align-items: center; gap: 4px;
  kbd {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 22px; height: 22px; padding: 0 6px;
    background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 4px;
    font-family: inherit; font-size: 0.6875rem; font-weight: 600; color: #334155;
  }
`;
const Footer = styled.div`
  flex-shrink: 0;
  padding: 12px 16px;
  border-top: 1px solid #E2E8F0;
  display: flex; gap: 8px; align-items: flex-end;
`;
// N+93 — Q Talk 컴포저(InputWrap)와 동일: 입력란 테두리 안에 아이콘 전송 버튼. focus-within 하이라이트.
const InputWrap = styled.div`
  flex: 1;
  display: flex; align-items: flex-end; gap: 8px;
  padding: 8px 10px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  &:focus-within {
    border-color: #14B8A6;
    background: #FFFFFF;
    box-shadow: 0 0 0 3px rgba(20,184,166,0.1);
  }
`;
const InputTextarea = styled.textarea`
  flex: 1;
  border: none; background: transparent; resize: none;
  font-size: 0.8125rem; font-family: inherit;
  line-height: 1.45; color: #0F172A;
  padding: 4px 0;
  min-height: 40px; max-height: 120px;
  &:focus { outline: none; }
  &::placeholder { color: #94A3B8; }
  @media (max-width: 1024px) { font-size: 1rem; }
`;
const SendBtn = styled.button`
  flex-shrink: 0;
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: #0D9488; color: #FFFFFF;
  border: none; border-radius: 8px;
  cursor: pointer;
  touch-action: manipulation;
  transition: background 0.15s;
  @media (max-width: 1024px) { width: 44px; height: 44px; }
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #E2E8F0; color: #94A3B8; cursor: not-allowed; }
`;
// ─── 헤더 액션 (피드백 진입 / 안내로 돌아가기) ───
const HeaderActions = styled.div`
  display: inline-flex; align-items: center; gap: 4px;
`;
const FeedbackEnter = styled.button`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px;
  background: #FFF1F2; color: #9F1239;
  border-radius: 999px;
  font-size: 0.75rem; font-weight: 600;
  transition: all 0.15s;
  &:hover { background: #FECDD3; }
`;
const BackToGuide = styled.button`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px;
  background: #F1F5F9; color: #475569;
  border-radius: 999px;
  font-size: 0.75rem; font-weight: 600;
  transition: all 0.15s;
  &:hover { background: #E2E8F0; }
`;
// ─── 모드 토글 (qhelper / workspace) ───
const ModeSwitch = styled.div`
  flex-shrink: 0;
  display: flex; flex-wrap: wrap; gap: 4px 6px;   /* N+93 — 4탭: 좁은 폭에서 줄바꿈(클리핑 방지) */
  padding: 8px 12px;
  background: #F8FAFC;
  border-bottom: 1px solid #E2E8F0;
`;
const ModeBtn = styled.button<{ $active: boolean; $variant: 'qhelper' | 'workspace' }>`
  all: unset; cursor: pointer; box-sizing: border-box;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 999px;
  font-size: 0.75rem; font-weight: 600;
  border: 1px solid transparent;  /* active/inactive 동일 box-size 유지 — 탭 전환 시 높이 흔들림 방지 */
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  ${p => p.$active && p.$variant === 'qhelper' && 'background: #FFFFFF; color: #0F766E; border-color: #14B8A6;'}
  ${p => p.$active && p.$variant === 'workspace' && 'background: #FFFFFF; color: #9F1239; border-color: #F43F5E;'}
  ${p => !p.$active && 'background: transparent; color: #64748B;'}
  &:hover { background: ${p => p.$active ? '#FFFFFF' : '#FFFFFF99'}; }
`;
// #295 — 선택된 탭이 무엇을 다루는지 알려주는 한 줄. 탭 바로 아래, 본문 위.
const ModeHint = styled.div`
  flex-shrink: 0;
  display: flex; align-items: center; gap: 6px;
  padding: 0 14px 8px;
  font-size: 0.71875rem; font-weight: 500; color: #64748B;
  line-height: 1.3;
`;
const DOT_COLOR: Record<string, string> = { cue: '#F43F5E', wiki: '#14B8A6', inquiry: '#94A3B8' };
const ModeDot = styled.span<{ $variant: 'cue' | 'wiki' | 'inquiry' }>`
  width: 6px; height: 6px; border-radius: 50%;
  background: ${p => DOT_COLOR[p.$variant] || '#14B8A6'};
  flex-shrink: 0;
`;
// ─── 빠른 분류 칩 (채팅 시작 전 의도 빠른 지정) ───
const QuickChips = styled.div`
  flex-shrink: 0;
  padding: 12px 16px;
  display: flex; flex-wrap: wrap; gap: 6px;
  border-bottom: 1px solid #F1F5F9;
`;
const QuickChip = styled.button`
  all: unset; cursor: pointer;
  padding: 4px 10px; border-radius: 999px;
  background: #F8FAFC; border: 1px solid #E2E8F0;
  font-size: 0.75rem; font-weight: 500; color: #475569;
  transition: all 0.15s;
  &:hover { background: #F0FDFA; border-color: #14B8A6; color: #0F766E; }
`;
// ─── Q위키 탭 패널 (맥락 카드 + 카테고리 칩 + 전체 위키 링크) ───
const WikiPanel = styled.div`
  flex-shrink: 0;
  padding: 12px 16px;
  display: flex; flex-direction: column; gap: 12px;
  border-bottom: 1px solid #F1F5F9;
`;
const WikiSection = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
// #146 — 도움말 검색 입력
const WikiSearchInput = styled.input`
  box-sizing: border-box; width: 100%; height: 36px; padding: 0 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #334155; background: #fff;
  &::placeholder { color: #94A3B8; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const WikiEmptyHint = styled.div`
  font-size: 0.75rem; color: #94A3B8; padding: 6px 2px;
`;
const WikiSectionLabel = styled.div`
  font-size: 0.6875rem; font-weight: 700; color: #94A3B8;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const WikiContextCard = styled.button`
  all: unset; cursor: pointer; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 3px;
  padding: 10px 12px; border-radius: 8px;
  background: #F0FDFA; border: 1px solid #CCFBF1;
  transition: border-color 0.15s, background 0.15s;
  &:hover { border-color: #14B8A6; background: #ECFDF5; }
`;
const WikiCardTitle = styled.span`
  font-size: 0.8125rem; font-weight: 700; color: #0F766E; line-height: 1.4;
`;
const WikiCardSummary = styled.span`
  font-size: 0.75rem; color: #64748B; line-height: 1.45;
`;
const WikiFullLink = styled.button`
  all: unset; cursor: pointer;
  align-self: flex-start;
  font-size: 0.75rem; font-weight: 700; color: #0D9488;
  &:hover { color: #0F766E; text-decoration: underline; }
`;
// ─── Q위키 답변 근거(sources) ───
// KNOWLEDGE_LOOP 축2 — 답변 피드백 2버튼
const FeedbackPitch = styled.div`
  flex-shrink: 0;
  padding: 12px 16px;
  background: #FFF1F2;
  border-bottom: 1px solid #FECDD3;
  font-size: 0.78125rem; color: #9F1239;
  line-height: 1.55;
`;
// ─── 피드백 폼 ───
const FbForm = styled.div`
  display: flex; flex-direction: column; gap: 14px;
`;
const FbField = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const FbLabel = styled.label`
  font-size: 0.75rem; font-weight: 700; color: #475569;
`;
const FbCatRow = styled.div`
  display: flex; gap: 6px; flex-wrap: wrap;
`;
const FbCatBtn = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer;
  padding: 6px 12px; border-radius: 999px;
  font-size: 0.75rem; font-weight: 600;
  background: ${p => p.$active ? '#F43F5E' : '#F1F5F9'};
  color: ${p => p.$active ? '#FFFFFF' : '#475569'};
  transition: all 0.15s;
  &:hover { background: ${p => p.$active ? '#E11D48' : '#E2E8F0'}; }
`;
const FbTextArea = styled.textarea`
  padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A;
  font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #F43F5E; box-shadow: 0 0 0 3px rgba(244,63,94,0.15); }
`;
const FbInput = styled.input`
  padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A;
  font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const FbCheck = styled.div`
  display: flex; align-items: center; gap: 8px;
  font-size: 0.8125rem; color: #475569;
  input { width: 16px; height: 16px; accent-color: #F43F5E; cursor: pointer; }
  label { cursor: pointer; }
`;
const FbMeta = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 0.6875rem;
`;
const FbMetaLabel = styled.span`color: #64748B; font-weight: 600; flex-shrink: 0;`;
const FbMetaValue = styled.span`
  color: #334155; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all; min-width: 0;
`;
const FbResult = styled.div`
  padding: 10px 12px;
  background: #F0FDFA; border: 1px solid #5EEAD4; border-radius: 8px;
  font-size: 0.8125rem; color: #0F766E;
`;
// 내 문의·피드백 내역 (운영 #21)
const MyHistoryLink = styled.button`
  align-self: flex-start; padding: 6px 0; background: none; border: none; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600; color: #0D9488;
  &:hover { color: #0F766E; text-decoration: underline; }
`;
const MyHistoryWrap = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const MyHistoryBack = styled.button`
  align-self: flex-start; padding: 4px 0; background: none; border: none; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600; color: #64748B;
  &:hover { color: #0F172A; }
`;
const MyHistoryEmpty = styled.div`
  padding: 28px 16px; text-align: center; font-size: 0.8125rem; color: #94A3B8;
`;
const MyHistoryCard = styled.div`
  padding: 14px; border: 1px solid #E2E8F0; border-radius: 12px; background: #FFFFFF;
  display: flex; flex-direction: column; gap: 8px;
`;
const MyHistoryTop = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const MyHistCat = styled.span`
  font-size: 0.6875rem; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border-radius: 999px; padding: 2px 10px;
`;
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#FEF3C7', fg: '#92400E' },
  reviewing: { bg: '#DBEAFE', fg: '#1E40AF' },
  done: { bg: '#DCFCE7', fg: '#166534' },
  wontfix: { bg: '#F1F5F9', fg: '#64748B' },
};
const MyHistStatus = styled.span<{ $s: string }>`
  font-size: 0.6875rem; font-weight: 700; border-radius: 999px; padding: 2px 10px;
  background: ${p => (STATUS_TONE[p.$s] || STATUS_TONE.pending).bg};
  color: ${p => (STATUS_TONE[p.$s] || STATUS_TONE.pending).fg};
`;
const MyHistDate = styled.span`margin-left: auto; font-size: 0.6875rem; color: #94A3B8;`;
const MyHistBody = styled.div`font-size: 0.8125rem; color: #334155; white-space: pre-wrap; word-break: break-word;`;
const MyHistReply = styled.div`
  margin-top: 4px; padding: 10px 12px; background: #F8FAFC; border-radius: 8px;
  border-left: 3px solid #14B8A6;
`;
const MyHistReplyLabel = styled.div`font-size: 0.6875rem; font-weight: 700; color: #0F766E; margin-bottom: 4px;`;
const MyHistReplyText = styled.div`font-size: 0.8125rem; color: #334155; white-space: pre-wrap; word-break: break-word;`;
// N+63 — 피드백 이미지 첨부. #232 로 드롭존(AttachmentField) 통일 — 전용 칩/버튼 스타일은 제거됨.
const FbAttachHint = styled.span`
  font-size: 0.6875rem; color: #94A3B8;
`;
const FbAttachErr = styled.div`
  margin-top: 6px; font-size: 0.6875rem; color: #B91C1C;
`;
const FbSendBtn = styled.button`
  width: 100%;
  padding: 10px 14px;
  background: #F43F5E;
  color: #FFFFFF;
  border: none; border-radius: 8px;
  font-size: 0.8125rem; font-weight: 700;
  cursor: pointer;
  height: 40px;
  transition: background 0.15s;
  &:hover:not(:disabled) { background: #E11D48; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
// ─── 우측 하단 floating 진입 버튼 (전역) ───
// 어떤 모달/드로어도 열려있지 않을 때만 보임 — useBodyScrollLock 가 body[data-overlay-open] 토글.
const FloatingTrigger = styled.button`
  /* 이 FAB 는 게스트/Client(!dockManaged) 에게만 노출. MemoFab 는 business member 전용이라
     이 FAB 와 절대 공존하지 않음 → 우측 하단 코너에 배치 (80px 올릴 이유 없음). */
  position: fixed; right: 20px; bottom: 20px;
  width: 52px; height: 52px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #F43F5E;
  color: #FFFFFF;
  border: none; border-radius: 50%;
  box-shadow: 0 4px 16px rgba(244,63,94,0.30);
  cursor: pointer;
  z-index: 40;
  transition: transform 0.15s, background 0.15s, opacity 0.15s;
  &:hover { background: #E11D48; transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid rgba(244,63,94,0.5); outline-offset: 4px; }
  /* 모달이 떠 있으면 숨김 — RightDock FabWrap 과 같은 술어(2026-08-27). ≤1024px 한정(탭 모드 오탐 방지). */
  @media (max-width: 1024px) {
    body:has([aria-modal="true"]) &,
    body:has([data-memo-popup="1"]) & { opacity: 0; pointer-events: none; visibility: hidden; }
  }
  @media (max-width: 640px) {
    right: 16px; bottom: 16px;
    width: 48px; height: 48px;
  }
  /* 모달/드로어가 열려있는 동안에는 안 보이게 (Footer 버튼 가림 방지) */
  body[data-overlay-open="true"] & {
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
  }
`;
