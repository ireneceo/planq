import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import HelpDot from '../../components/Common/HelpDot';
import styled from 'styled-components';
import StartMeetingModal from './StartMeetingModal';
import type { StartConfig } from './StartMeetingModal';
import { getLanguageByCode } from '../../constants/languages';
import { useAuth, getAccessToken } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import {
  listSessions,
  getSession,
  createSession,
  updateSession,
  uploadDocument,
  addUrl,
  reassignUtteranceSpeaker,
  getCachedAnswer,
  findAnswer,
  translateAnswer,
  createPriorityQA,
  uploadPriorityQACSV,
  listQAPairs,
  acquireRecorderLock,
  heartbeatRecorderLock,
  releaseRecorderLock,
} from '../../services/qnote';
import type { QNoteSession, QNoteUtterance, QNoteSpeaker } from '../../services/qnote';
import { LiveSession } from '../../services/qnoteLive';
import type { LiveEvent } from '../../services/qnoteLive';
import {
  MicIcon,
  StopIcon,
  PlusIcon,
  SettingsIcon,
  PowerIcon,
} from '../../components/Common/Icons';
import SharedEmptyState from '../../components/Common/EmptyState';
import SearchBoxCommon from '../../components/Common/SearchBox';
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav';

/**
 * Q Note 페이지
 *
 * 색상 원칙:
 *   - Primary 딥틸: #14B8A6 #0D9488 #115E59 #F0FDFA #CCFBF1 #99F6E4
 *   - Point 코랄/로즈: #F43F5E #E11D48 #FFF1F2 #FFE4E6 #FECDD3 #9F1239
 *   - Neutral: #FFFFFF #F8FAFC #F1F5F9 #E2E8F0 #CBD5E1 #94A3B8 #64748B #475569 #0F172A
 *
 * 회의 상태 머신:
 *   empty → prepared → recording ⇄ paused → (회의 종료) → review
 *
 * 발화 블록 모델:
 *   일반 발화 → flat transcript 블록 (보더/배경 없음)
 *   질문      → 카드 (코랄 보더 + 수평 레이아웃 + 우측 답변 찾기)
 *
 * 커밋 규칙 (speech_final 기반):
 *   백엔드(live.py)가 Deepgram `speech_final=true` 이벤트에 대해서만 DB insert + `finalized`
 *   이벤트 발행. 그 전 `is_final=true && !speech_final` 은 interim 으로 취급.
 *   프론트는 `finalized` 를 받는 즉시 새 블록으로 승격 — 한 문장이 여러 카드로 쪼개지는
 *   "버벅거림" 을 원천 차단.
 *   2초 이내 같은 화자의 연속 finalized 는 직전 블록과 merge.
 *   질문 감지는 텍스트 끝 `?` 로 낙관 판정, enrichment 도착 후 백엔드 판정으로 덮어씀.
 */

type Phase = 'empty' | 'prepared' | 'recording' | 'paused' | 'review';
type BlockKind = 'speech' | 'question';

interface BlockSegment {
  utteranceId: number;
  original: string;
  translation: string | null;
  start: number | null;
  end: number | null;
  detectedLanguage?: string | null;
  outOfScope?: boolean;
}

interface TranscriptBlock {
  id: string;
  kind: BlockKind;
  speakerRowId: number | null;
  speakerLabel: string;
  timestamp: string;
  segments: BlockSegment[];
  firstStart: number | null;
  lastEnd: number | null;
  lastDgSpeakerId: number | null;
  isManual?: boolean;  // 사용자가 직접 입력한 질문 블록 (hint 뱃지 표시용)
}

interface PendingBuffer {
  segments: BlockSegment[];
  firstStart: number | null;
  lastEnd: number | null;
  dgSpeakerId: number | null;
  speakerRowId: number | null;
  speakerLabel: string;
}

// ─── 질문 판정 (낙관적, 백엔드 enrichment 가 덮어씀) ───

function formatTime(sec: number | string | null | undefined): string {
  if (sec == null) return '';
  if (typeof sec === 'number') {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return '';
}

interface SpeakerLabelContext {
  speakers: QNoteSpeaker[];
  participants?: { name: string; role?: string | null }[] | null;
  labels: { self: string; other: string; numbered: (n: number) => string };
}

function speakerLabelFor(
  speakerRowId: number | null,
  dgSpeakerId: number | null,
  ctx: SpeakerLabelContext,
): string {
  const { speakers, participants, labels } = ctx;
  const pCount = participants?.length ?? 0;
  if (speakerRowId != null) {
    const match = speakers.find((s) => s.id === speakerRowId);
    if (match) {
      if (match.is_self) return labels.self;
      if (match.participant_name) return match.participant_name;
      // 참여자 1명만 등록 → 그 이름으로.
      // 그 외(미등록 or 다수 등록)는 그냥 "상대/화자" — Deepgram 화자 ID 신뢰도 낮아 번호 안 붙임.
      if (pCount === 1 && participants![0].name) return participants![0].name;
      return labels.other;
    }
  }
  if (dgSpeakerId != null) {
    if (pCount === 1 && participants![0].name) return participants![0].name;
    return labels.other;
  }
  return labels.other;
}

function joinText(segments: BlockSegment[]): string {
  return segments.map((s) => s.original).join(' ').replace(/\s+/g, ' ').trim();
}

function joinTranslation(segments: BlockSegment[]): { text: string; hasAny: boolean; allTranslated: boolean } {
  const translated = segments.filter((s) => s.translation != null && s.translation !== '');
  const text = translated.map((s) => s.translation).join(' ').replace(/\s+/g, ' ').trim();
  return {
    text,
    hasAny: translated.length > 0,
    allTranslated: translated.length === segments.length,
  };
}

const QNotePage = () => {
  const { t } = useTranslation('qnote');
  const { user } = useAuth();
  const { formatDate: fmtWsDate } = useTimeFormat();
  const businessId = user?.business_id ?? null;

  const speakerLabels = useMemo(() => ({
    self: t('page.speaker.self'),
    other: t('page.speaker.other'),
    numbered: (n: number) => t('page.speaker.numbered', { n }),
  }), [t]);

  const { sessionId: urlSessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();

  // ── Refresh 성능 계측기 (일회성 진단용) ──
  // 브라우저 DevTools Console 에 [QNOTE-TIMING] 로 찍어 어디가 느린지 사용자가 공유 가능하게.
  useEffect(() => {
    const t0 = performance.now();
    const mark = (label: string) => {
      const ms = Math.round(performance.now() - t0);
      // eslint-disable-next-line no-console
      console.log(`[QNOTE-TIMING] ${ms}ms  ${label}`);
    };
    mark('QNotePage mounted');
    const onLoad = () => mark('window.load fired');
    if (document.readyState === 'complete') mark('already complete');
    else window.addEventListener('load', onLoad, { once: true });
    return () => { window.removeEventListener('load', onLoad); };
  }, []);

  const [showStartModal, setShowStartModal] = useState(false);
  const [editingSession, setEditingSession] = useState<boolean>(false);
  const [phase, setPhase] = useState<Phase>('empty');
  const [sessions, setSessions] = useState<QNoteSession[]>([]);
  const [sessionQuery, setSessionQuery] = useState('');
  const [activeSession, setActiveSession] = useState<QNoteSession | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') return window.innerWidth < 900;
    return false;
  });
  const [viewportNarrow, setViewportNarrow] = useState<boolean>(() => {
    if (typeof window !== 'undefined') return window.innerWidth < 900;
    return false;
  });

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 900px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      const narrow = 'matches' in e ? e.matches : false;
      setViewportNarrow(narrow);
      if (narrow) setSidebarCollapsed(true);
      else setSidebarCollapsed(false);
    };
    if (mql.addEventListener) mql.addEventListener('change', handler as (e: MediaQueryListEvent) => void);
    else mql.addListener(handler as (e: MediaQueryListEvent) => void);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler as (e: MediaQueryListEvent) => void);
      else mql.removeListener(handler as (e: MediaQueryListEvent) => void);
    };
  }, []);

  // ── 준비 상태 (phase='prepared' 일 때 폴링) ──
  type Readiness = {
    docsIndexed: number;
    docsTotal: number;
    docsFailed: number;
    pqTotal: number;
    pqEmbedded: number;
    keywordsCount: number;
    allReady: boolean;
  };
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  // 준비 패널 수동 expand 여부 (allReady=true 면 기본 collapsed, 사용자가 확장하면 열림)
  const [readinessExpanded, setReadinessExpanded] = useState(false);

  // 준비 상태 폴링 — prepared / paused 에서만, "모두 준비 완료" 되면 자동 중단.
  // 핵심 최적화: getSession 중복 호출 제거. 이미 activeSession 에 문서/키워드가 있음.
  // 오직 qa-pairs (has_embedding 갱신) + documents (status 변화) 만 필요 → 두 개만 폴링.
  // documents 는 인덱싱 중일 때만 바뀌므로 activeSession 상태로 초기값 잡고, 변경 감지 시만 getSession.
  const activeSessionId = activeSession?.id;
  useEffect(() => {
    if ((phase !== 'prepared' && phase !== 'paused') || !activeSessionId) {
      setReadiness(null);
      return;
    }
    let cancelled = false;
    let stopped = false;
    let timer: number | undefined;

    const fetchReadiness = async () => {
      if (stopped || cancelled) return;
      try {
        // activeSession 의 docs 가 전부 indexed 면 priority 만 확인 (getSession 생략 가능)
        const currentDocs = activeSessionRef.current?.documents || [];
        const docsAllDone = currentDocs.every(
          (d) => d.status === 'indexed' || d.status === 'failed'
        );
        // 인덱싱 중이면 getSession 도 함께, 아니면 qa-pairs 만.
        const [detail, pqsResult] = await Promise.all([
          docsAllDone ? Promise.resolve(null) : getSession(activeSessionId),
          listQAPairs(activeSessionId, 'priority').catch(() => [] as Array<{ has_embedding?: boolean }>),
        ]);
        if (cancelled) return;
        const pqs = pqsResult || [];
        const docs = detail?.documents || currentDocs;
        const docsIndexed = docs.filter((d) => d.status === 'indexed').length;
        const docsFailed = docs.filter((d) => d.status === 'failed').length;
        const pqTotal = pqs.length;
        const pqEmbedded = pqs.filter((p) => p.has_embedding).length;
        const keywordsCount = (detail?.keywords ?? activeSessionRef.current?.keywords ?? []).length;
        const allReady =
          docs.length === docsIndexed + docsFailed &&
          pqTotal === pqEmbedded;
        // equality 체크: 값이 달라질 때만 setState → 불필요한 re-render 제거
        setReadiness((prev) => {
          if (
            prev &&
            prev.docsIndexed === docsIndexed &&
            prev.docsTotal === docs.length &&
            prev.docsFailed === docsFailed &&
            prev.pqTotal === pqTotal &&
            prev.pqEmbedded === pqEmbedded &&
            prev.keywordsCount === keywordsCount &&
            prev.allReady === allReady
          ) {
            return prev;
          }
          return { docsIndexed, docsTotal: docs.length, docsFailed, pqTotal, pqEmbedded, keywordsCount, allReady };
        });
        if (allReady) {
          stopped = true;
          if (timer) window.clearInterval(timer);
        }
      } catch {
        /* ignore — 다음 폴링에서 재시도 */
      }
    };
    fetchReadiness();
    timer = window.setInterval(fetchReadiness, 5000);
    return () => {
      cancelled = true;
      stopped = true;
      if (timer) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, activeSessionId]);

  // 내 발화 처리 모드: 'skip' (기본 — 아예 블록 생성 안 함) | 'hide' (생성 후 숨김) | 'show' (다 보임)
  type SelfMode = 'skip' | 'hide' | 'show';
  const [selfMode, setSelfMode] = useState<SelfMode>(() => {
    try {
      const v = localStorage.getItem('qnote_self_mode');
      if (v === 'skip' || v === 'hide' || v === 'show') return v;
    } catch { /* ignore */ }
    return 'skip';
  });
  useEffect(() => {
    try { localStorage.setItem('qnote_self_mode', selfMode); } catch { /* ignore */ }
  }, [selfMode]);
  const selfModeRef = useRef<SelfMode>(selfMode);
  useEffect(() => { selfModeRef.current = selfMode; }, [selfMode]);
  const [pendingConfig, setPendingConfig] = useState<StartConfig | null>(null);

  const [blocks, setBlocks] = useState<TranscriptBlock[]>([]);
  const [pending, setPending] = useState<PendingBuffer | null>(null);

  // ── 수동 질문 입력 (사용자가 직접 질문 입력 → 답변 생성) ──
  // 제출 시점에 synthetic TranscriptBlock 을 `blocks` state 에 직접 push —
  // 그래야 이후 들어오는 live 이벤트가 자연스럽게 뒤에 붙어 시간 순서 보존.
  // 별도 manualQuestions state 금지. blocks 가 유일한 source of truth.
  // review 모드에서는 setBlocks 가 비어있으므로 reviewBlocks 뒤에 수동 블록만 표시.
  const [manualInput, setManualInput] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const manualIdRef = useRef(-1);
  const [interimText, setInterimText] = useState<string>('');
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);

  // 회의 제목 인라인 수정 + 자동저장
  const handleTitleSave = useCallback(async (newTitle: string) => {
    const trimmed = newTitle.trim();
    setEditingTitle(false);
    const sess = activeSessionRef.current;
    if (!sess || !trimmed || trimmed === sess.title) return;
    try {
      await updateSession(sess.id, { title: trimmed });
      setActiveSession((prev) => prev ? { ...prev, title: trimmed } : prev);
      setSessions((prev) => prev.map((s) => s.id === sess.id ? { ...s, title: trimmed } : s));
    } catch {
      // 실패 시 무시 (원본 유지)
    }
  }, []);

  useEffect(() => {
    if (!liveNotice) return;
    const t = window.setTimeout(() => setLiveNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [liveNotice]);

  const liveRef = useRef<LiveSession | null>(null);
  // ── Recorder lock (동시 녹음 방지) ──
  // 이 탭이 녹음을 "쥐고 있을 때만" 토큰이 존재. heartbeat 5초, 서버는 30초 stale 로 판정.
  const recorderTokenRef = useRef<string | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const [lockedByOther, setLockedByOther] = useState(false);
  const speakersRef = useRef<QNoteSpeaker[]>([]);
  const activeSessionRef = useRef<QNoteSession | null>(null);
  const pendingRef = useRef<PendingBuffer | null>(null);  // 즉시 읽기용
  const blockCounterRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [headerCollapsed, setHeaderCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('qnote_header_collapsed') === '1'; } catch { return false; }
  });
  const toggleHeaderCollapsed = useCallback(() => {
    setHeaderCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('qnote_header_collapsed', next ? '1' : '0'); } catch { /* quota */ }
      return next;
    });
  }, []);

  const handleTranscriptScroll = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 80;
  }, []);

  // activeSession 변경 시 ref 동기화 (useCallback 내부에서 stale closure 방지)
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

  const meetingLangLabels = useMemo(() => {
    const langs = activeSession?.meeting_languages || [];
    return langs.map((c) => getLanguageByCode(c)?.label || c).join(' + ');
  }, [activeSession]);

  // ── 세션 목록 로드 ────────────────────────────────────
  const loadSessions = useCallback(async () => {
    if (!businessId) return;
    const _t0 = performance.now();
    try {
      const data = await listSessions(businessId);
      // eslint-disable-next-line no-console
      console.log(`[QNOTE-TIMING] ${Math.round(performance.now() - _t0)}ms loadSessions done (${data.length} sessions)`);
      // 최신 우선 정렬 (created_at DESC)
      const sorted = [...data].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
      setSessions(sorted);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  }, [businessId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // URL 파라미터로 세션 자동 열기 (/notes/:sessionId)
  // handleStartMeeting 이 직접 navigate 했을 때는 openReview 를 다시 부르면 안 됨
  // → urlSessionIdHandled 를 navigate 전에 세팅 + activeSessionRef 가 이미 해당 id 이면 스킵
  const urlSessionIdHandled = useRef(false);
  useEffect(() => {
    if (!urlSessionId || urlSessionIdHandled.current) return;
    const id = parseInt(urlSessionId, 10);
    if (isNaN(id)) return;
    // 이미 같은 세션이 active 상태라면 URL 핸들러 스킵
    if (activeSessionRef.current?.id === id) {
      urlSessionIdHandled.current = true;
      return;
    }
    // phase 가 empty 가 아니어도 진행 — 사용자가 다른 세션을 URL 로 열었을 수 있음
    if (phase === 'empty') {
      urlSessionIdHandled.current = true;
      openReview(id);
    }
  }, [urlSessionId, phase]);

  useEffect(() => {
    // 탭 닫기/새로고침/네비게이션 시 fetch keepalive 로 락 해제.
    // sendBeacon 은 Authorization 헤더를 못 보내므로 JWT 기반 인증에서는 사용 불가.
    // fetch(..., { keepalive: true }) 는 탭 종료 후에도 최대 64KB 요청 보장 + 헤더 허용.
    const handleUnload = () => {
      const tok = recorderTokenRef.current;
      const sess = activeSessionRef.current;
      if (!tok || !sess) return;
      try {
        const accessToken = getAccessToken();
        fetch(`/qnote/api/sessions/${sess.id}/recorder/release`, {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ token: tok }),
        }).catch(() => { /* noop */ });
      } catch { /* noop */ }
    };
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
      liveRef.current?.stop();
      liveRef.current = null;
      if (heartbeatTimerRef.current) { window.clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; }
      // React 언마운트(SPA 라우팅)에서는 fetch 로 정상 release
      const tok = recorderTokenRef.current;
      const sess = activeSessionRef.current;
      if (tok && sess) {
        releaseRecorderLock(sess.id, tok);
        recorderTokenRef.current = null;
      }
    };
  }, []);

  // 다른 탭에서 이 세션을 녹음 중인지 주기 폴링 (내가 녹음 중이 아닐 때만)
  useEffect(() => {
    if (!activeSession) return;
    if (phase !== 'prepared' && phase !== 'paused') return;
    if (recorderTokenRef.current) return; // 내가 락을 쥐고 있으면 스킵
    let cancelled = false;
    const check = async () => {
      try {
        const detail = await getSession(activeSession.id);
        if (cancelled) return;
        const locked = !!detail.recorder_lock?.active;
        setLockedByOther(locked);
      } catch { /* noop */ }
    };
    check();
    const iv = window.setInterval(check, 4000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [activeSession?.id, phase]);

  // ── pending 을 블록으로 커밋 — 각 문장을 독립 블록으로 생성 (merge 없음) ──
  const commitPendingAsBlock = useCallback((p: PendingBuffer, kind: BlockKind) => {
    const dedup = (segs: BlockSegment[]) => {
      const seen = new Set<number>();
      return segs.filter((s) => {
        if (seen.has(s.utteranceId)) return false;
        seen.add(s.utteranceId);
        return true;
      });
    };
    const newBlock: TranscriptBlock = {
      id: `b${++blockCounterRef.current}`,
      kind,
      speakerRowId: p.speakerRowId,
      speakerLabel: p.speakerLabel,
      timestamp: formatTime(p.firstStart),
      segments: dedup(p.segments),
      firstStart: p.firstStart,
      lastEnd: p.lastEnd,
      lastDgSpeakerId: p.dgSpeakerId,
    };
    setBlocks((prev) => [...prev, newBlock]);
  }, []);

  // pending 강제 flush (pause/end/speaker-change/silence 시)
  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    commitPendingAsBlock(p, 'speech');
    pendingRef.current = null;
    setPending(null);
  }, [commitPendingAsBlock]);

  // ── 세션 클릭 → status 기반 phase 결정 ─────────────────
  //   completed → review (리뷰 모드)
  //   그 외     → paused (이어서 녹음 가능)
  // 리스트 재클릭 → 선택 해제 (토글). 통일된 UX 원칙.
  const handleSessionClick = (sessionId: number) => {
    if (activeSession?.id === sessionId) {
      setActiveSession(null);
      setPhase('empty');
      navigate('/notes', { replace: true });
      return;
    }
    openReview(sessionId);
  };

  const filteredSessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => (s.title || '').toLowerCase().includes(q));
  }, [sessions, sessionQuery]);
  const sessionItemIds = useMemo(() => filteredSessions.map((s) => s.id), [filteredSessions]);
  useListKeyboardNav<number>({
    itemIds: sessionItemIds,
    activeId: activeSession?.id ?? null,
    onChange: (id) => openReview(id),
    enabled: !sidebarCollapsed,
    itemSelector: (id) => `[data-qnote-session="${id}"]`,
  });

  const openReview = async (sessionId: number) => {
    const _t0 = performance.now();
    // eslint-disable-next-line no-console
    console.log(`[QNOTE-TIMING] openReview(${sessionId}) start`);
    if (liveRef.current) {
      liveRef.current.stop();
      liveRef.current = null;
    }
    flushPending();
    try {
      const detail = await getSession(sessionId);
      // eslint-disable-next-line no-console
      console.log(`[QNOTE-TIMING] ${Math.round(performance.now() - _t0)}ms getSession done (${detail.utterances?.length || 0} utt)`);
      setActiveSession(detail);
      speakersRef.current = detail.speakers || [];
      navigate(`/notes/${sessionId}`, { replace: true });

      // 저장된 답변 있는 질문들 → 초기 상태 세팅 (답변 보기 버튼으로 시작)
      if (detail.detected_questions && detail.detected_questions.length > 0) {
        const readySet = new Set<number>();
        const dataInit: Record<number, { tier: string; answer: string; collapsed: boolean }> = {};
        detail.detected_questions.forEach((dq) => {
          if (dq.utterance_id && dq.answer_text) {
            readySet.add(dq.utterance_id);
            dataInit[dq.utterance_id] = {
              tier: dq.answer_tier || 'cached',
              answer: dq.answer_text,
              collapsed: true,  // 새로고침 시 기본 접힘 → "답변 보기" 표시
            };
          }
        });
        setAnswerReadySet(readySet);
        setAnswerData((prev) => {
          const next = { ...prev };
          Object.entries(dataInit).forEach(([k, v]) => {
            next[Number(k)] = { ...next[Number(k)], ...v };
          });
          return next;
        });
      }

      // Phase 결정 정책 (데이터 우선):
      //   1. status='completed' → review 모드
      //   2. utterances 가 이미 있다 → paused (status 가 'prepared' 이어도 실제로 녹음된 데이터가 있으면 보여줌)
      //   3. status='prepared' + utterances 없음 → prepared
      //   4. status='recording'/'paused' → paused
      //
      // 이는 백엔드 status 생명주기 버그 또는 비정상 종료(탭닫힘 등) 상황에서도
      // 녹음된 텍스트가 화면에서 사라지지 않도록 하는 데이터 보존 장치.
      const hasUtterances = (detail.utterances?.length ?? 0) > 0;
      const nextPhase: Phase =
        detail.status === 'completed' ? 'review' :
        hasUtterances ? 'paused' :
        detail.status === 'prepared' ? 'prepared' : 'paused';
      setPhase(nextPhase);
      // 다른 탭/기기가 이 세션을 이미 녹음 중이면 lockedByOther = true
      setLockedByOther(!!detail.recorder_lock?.active);
      // paused 로 진입 시 서버 utterances 에서 blocks 재구성 → 화면에 바로 노출.
      // review 는 useMemo(reviewBlocks) 사용하므로 blocks 는 비움.
      if (nextPhase === 'paused') {
        setBlocks(buildBlocksFromSession(detail));
      } else {
        setBlocks([]);
      }
      setInterimText('');
      setLiveError(null);
      // paused 진입 시, 재개를 위해 기본 pendingConfig 구성 (참여자/언어/캡처모드 원본 유지).
      // capture_mode 는 DB 에 영속화 되어 있음 — web_conference 면 재개 시 탭 공유 다이얼로그가
      // 다시 떠서 사용자가 재선택해야 함 (새로고침 시 브라우저 권한 소실되는 것과 동일).
      if (nextPhase === 'paused') {
        setPendingConfig({
          title: detail.title,
          brief: detail.brief || '',
          participants: (detail.participants || []).map((p) => ({ name: p.name, role: p.role || '' })),
          meetingLanguages: detail.meeting_languages || ['ko'],
          translationLanguage: detail.translation_language || 'ko',
          answerLanguage: detail.answer_language || '',
          pastedContext: detail.pasted_context || '',
          documents: [],
          urls: [],
          captureMode: detail.capture_mode || 'microphone',
          priorityQAs: [],
          priorityQACsv: null,
          meetingAnswerStyle: '',
          meetingAnswerLength: 'medium',
        });
      } else {
        setPendingConfig(null);
      }
      pendingRef.current = null;
      setPending(null);
      // eslint-disable-next-line no-console
      console.log(`[QNOTE-TIMING] ${Math.round(performance.now() - _t0)}ms openReview done`);
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  };

  // ── WebSocket 이벤트 핸들러 ───────────────────────────
  const handleLiveEvent = useCallback((ev: LiveEvent) => {
    if (ev.type === 'transcript') {
      if (!ev.is_final) setInterimText(ev.transcript);
      return;
    }

    if (ev.type === 'finalized') {
      // speech_final 기반 — 한 utterance = 한 문장. 즉시 블록으로 승격.
      setInterimText('');
      pendingRef.current = null;
      setPending(null);

      // "내 발화 처리 안 함" 모드 — is_self 발화는 블록 자체를 만들지 않음
      if (selfModeRef.current === 'skip' && ev.is_self) {
        return;
      }

      const text = ev.transcript;
      const segStart = typeof ev.start === 'number' ? ev.start : null;
      const segEnd = typeof ev.end === 'number' ? ev.end : segStart;
      const dgSpeakerId = ev.deepgram_speaker_id ?? null;
      const speakerRowId = ev.speaker_id ?? null;

      // 서버가 보낸 is_self 로 speakersRef 즉시 갱신 (세션 새로고침 없이 "나" 라벨 반영)
      if (speakerRowId != null) {
        const existing = speakersRef.current.find((s) => s.id === speakerRowId);
        if (!existing) {
          const newSpeaker = {
            id: speakerRowId,
            deepgram_speaker_id: dgSpeakerId ?? 0,
            participant_name: null as string | null,
            is_self: ev.is_self ? 1 : 0,
          };
          speakersRef.current = [...speakersRef.current, newSpeaker];
          setActiveSession((prev) => prev ? { ...prev, speakers: speakersRef.current } : prev);
        } else if (ev.is_self && !existing.is_self) {
          speakersRef.current = speakersRef.current.map((s) =>
            s.id === speakerRowId ? { ...s, is_self: 1 } : s
          );
          setActiveSession((prev) => prev ? { ...prev, speakers: speakersRef.current } : prev);
        }
      }

      const newSegment: BlockSegment = {
        utteranceId: ev.utterance_id,
        original: text,
        translation: null,
        start: segStart,
        end: segEnd,
      };

      const buffer: PendingBuffer = {
        segments: [newSegment],
        firstStart: segStart,
        lastEnd: segEnd,
        dgSpeakerId,
        speakerRowId,
        speakerLabel: speakerLabelFor(speakerRowId, dgSpeakerId, { speakers: speakersRef.current, participants: activeSessionRef.current?.participants, labels: speakerLabels }),
      };
      // 질문 판정은 서버 enrichment 결과로만 (낙관 판정 제거 — 오판 방지)
      commitPendingAsBlock(buffer, 'speech');
      return;
    }

    if (ev.type === 'enrichment') {
      // 블록과 pending 모두에서 해당 utterance_id 를 찾아 번역/언어/정제 원문 주입
      const patch = (seg: BlockSegment): BlockSegment => ({
        ...seg,
        // GPT 가 정제한 원문(한국어 띄어쓰기 등)이 있으면 교체
        original: ev.formatted_original || seg.original,
        translation: ev.translation,
        detectedLanguage: ev.detected_language ?? seg.detectedLanguage ?? null,
        outOfScope: ev.out_of_scope ?? seg.outOfScope ?? false,
      });
      // enrichment의 is_question으로 block.kind 교정 (낙관 판정 덮어씀)
      const enrichedKind: BlockKind = ev.is_question ? 'question' : 'speech';
      setBlocks((prev) =>
        prev.map((block) => {
          let changed = false;
          const newSegs = block.segments.map((seg) => {
            if (seg.utteranceId !== ev.utterance_id) return seg;
            changed = true;
            return patch(seg);
          });
          if (!changed) return block;
          return { ...block, segments: newSegs, kind: enrichedKind };
        })
      );
      setPending((prev) => {
        if (!prev) return prev;
        let changed = false;
        const newSegs = prev.segments.map((seg) => {
          if (seg.utteranceId !== ev.utterance_id) return seg;
          changed = true;
          return patch(seg);
        });
        if (!changed) return prev;
        const updated = { ...prev, segments: newSegs };
        pendingRef.current = updated;
        return updated;
      });
      return;
    }

    if ((ev as any).type === 'quick_question') {
      // Fast-path 질문 판정 — 즉시 해당 블록을 question 카드로 승격
      const uttId = (ev as any).utterance_id as number;
      setBlocks((prev) =>
        prev.map((block) => {
          const has = block.segments.some((seg) => seg.utteranceId === uttId);
          return has ? { ...block, kind: 'question' as BlockKind } : block;
        })
      );
      return;
    }

    if ((ev as any).type === 'answer_ready') {
      const uttId = (ev as any).utterance_id as number;
      setAnswerReadySet((prev) => new Set(prev).add(uttId));
      return;
    }

    if (ev.type === 'error') {
      setLiveError(ev.message);
      return;
    }

    if (ev.type === 'closed') {
      setPhase((p) => (p === 'recording' ? 'paused' : p));
      return;
    }
  }, [commitPendingAsBlock]);

  // ── 녹음 시작 ──────────────────────────────────────────
  const startRecording = async () => {
    if (!activeSession) {
      setLiveError(t('page.errors.noActiveSession'));
      return;
    }
    if (!pendingConfig) {
      const fallback: StartConfig = {
        title: activeSession.title,
        brief: activeSession.brief || '',
        participants: (activeSession.participants || []).map((p) => ({ name: p.name, role: p.role || '' })),
        meetingLanguages: activeSession.meeting_languages || ['ko'],
        translationLanguage: activeSession.translation_language || 'ko',
        answerLanguage: activeSession.answer_language || '',
        pastedContext: activeSession.pasted_context || '',
        documents: [],
        urls: [],
        captureMode: activeSession.capture_mode || 'microphone',
        priorityQAs: [],
        priorityQACsv: null,
        meetingAnswerStyle: '',
        meetingAnswerLength: 'medium',
      };
      setPendingConfig(fallback);
    }
    setLiveError(null);

    const captureMode = pendingConfig?.captureMode || activeSession.capture_mode || 'microphone';
    if (captureMode === 'web_conference' && phase === 'paused') {
      setLiveNotice(t('page.errors.reshareTab'));
    }

    // ── 1. 녹음 락 획득 — 다른 탭/기기가 이미 녹음 중이면 409 → 차단
    const token = (crypto as any).randomUUID ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await acquireRecorderLock(activeSession.id, token);
      recorderTokenRef.current = token;
      setLockedByOther(false);
    } catch (err: any) {
      if (err?.status === 409) {
        setLockedByOther(true);
        setLiveError(t('page.errors.recorderLocked', '이 회의는 다른 탭/기기에서 이미 녹음 중입니다. 그쪽에서 먼저 일시 정지하거나 종료해주세요.'));
        return;
      }
      setLiveError(t('page.errors.startPrefix', { hint: err?.message || 'lock failed' }));
      return;
    }

    const live = new LiveSession({
      sessionId: activeSession.id,
      captureMode,
      onEvent: handleLiveEvent,
    });
    try {
      await live.start();
      liveRef.current = live;
      setPhase('recording');
      // ── 2. heartbeat 시작 (5초) — 실패(409) 시 녹음 즉시 중단
      if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = window.setInterval(async () => {
        const tok = recorderTokenRef.current;
        if (!tok || !activeSessionRef.current) return;
        try {
          await heartbeatRecorderLock(activeSessionRef.current.id, tok);
        } catch (e: any) {
          if (e?.status === 409) {
            // 다른 탭이 가로챘거나 서버가 stale 판정 → 현재 녹음 중단
            if (heartbeatTimerRef.current) { window.clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; }
            recorderTokenRef.current = null;
            liveRef.current?.stop();
            liveRef.current = null;
            setInterimText('');
            flushPending();
            setPhase('paused');
            setLockedByOther(true);
            setLiveError(t('page.errors.recorderLost', '다른 탭에서 녹음을 이어받아 현재 탭의 녹음이 중단되었습니다.'));
          }
        }
      }, 5000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[QNote] live.start failed:', err);
      let hint = msg;
      if (/Permission denied|NotAllowedError/i.test(msg)) {
        hint = t('page.errors.permissionDenied');
      } else if (/tab|display/i.test(msg)) {
        hint = t('page.errors.shareCancelled');
      } else if (/WebSocket/i.test(msg)) {
        hint = t('page.errors.serverConnection');
      }
      setLiveError(t('page.errors.startPrefix', { hint }));
      live.stop();
      // live.start 실패 → 방금 획득한 락 해제
      if (heartbeatTimerRef.current) { window.clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; }
      if (recorderTokenRef.current && activeSession) {
        await releaseRecorderLock(activeSession.id, recorderTokenRef.current);
        recorderTokenRef.current = null;
      }
    }
  };

  // 락 정리 공통 유틸
  const releaseLockIfHeld = useCallback(async () => {
    if (heartbeatTimerRef.current) { window.clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null; }
    const tok = recorderTokenRef.current;
    const sess = activeSessionRef.current;
    if (tok && sess) {
      await releaseRecorderLock(sess.id, tok);
    }
    recorderTokenRef.current = null;
  }, []);

  // ── 녹음 일시 중지 ────────────────────────────────────
  const pauseRecording = async () => {
    liveRef.current?.stop();
    liveRef.current = null;
    setInterimText('');
    flushPending();
    setPhase('paused');
    await releaseLockIfHeld();
  };

  // ── 회의 종료 ─────────────────────────────────────────
  const endMeeting = async () => {
    liveRef.current?.stop();
    liveRef.current = null;
    setInterimText('');
    flushPending();
    await releaseLockIfHeld();
    if (activeSession) {
      try {
        await updateSession(activeSession.id, { status: 'completed' });
        const refreshed = await getSession(activeSession.id);
        setActiveSession(refreshed);
        speakersRef.current = refreshed.speakers || [];
      } catch (err) {
        console.error('End meeting failed:', err);
      }
    }
    setPhase('review');
    setPendingConfig(null);
    loadSessions();
  };

  // ── 설정 편집 저장 ───────────────────────────────────
  const handleSaveSessionEdit = async (cfg: StartConfig) => {
    if (!activeSession) return;
    setShowStartModal(false);
    setEditingSession(false);
    try {
      // 세션 본문 PUT
      await updateSession(activeSession.id, {
        title: cfg.title || activeSession.title,
        brief: cfg.brief || undefined,
        participants: cfg.participants.length > 0
          ? cfg.participants.map((p) => ({ name: p.name, role: p.role || null }))
          : undefined,
        meeting_languages: cfg.meetingLanguages,
        translation_language: cfg.translationLanguage,
        answer_language: cfg.answerLanguage,
        pasted_context: cfg.pastedContext || undefined,
        meeting_answer_style: cfg.meetingAnswerStyle || undefined,
        meeting_answer_length: cfg.meetingAnswerLength || undefined,
      });
      // 새로 추가된 Priority Q&A
      for (const pq of cfg.priorityQAs) {
        try {
          await createPriorityQA(activeSession.id, {
            question_text: pq.question, answer_text: pq.answer,
            short_answer: pq.shortAnswer, keywords: pq.keywords,
          });
        } catch (err) { console.error('Priority Q&A add failed:', err); }
      }
      if (cfg.priorityQACsv) {
        try { await uploadPriorityQACSV(activeSession.id, cfg.priorityQACsv); }
        catch (err) { console.error('Priority Q&A CSV upload failed:', err); }
      }
      // 새 문서/URL
      for (const file of cfg.documents) {
        try { await uploadDocument(activeSession.id, file); }
        catch (err) { console.error(`Upload failed: ${file.name}`, err); }
      }
      for (const url of cfg.urls) {
        try { await addUrl(activeSession.id, url); }
        catch (err) { console.error(`URL add failed: ${url}`, err); }
      }
      // 세션 상세 재조회 → 화면 동기화
      const detail = await getSession(activeSession.id);
      setActiveSession(detail);
      setSessions((prev) => prev.map((s) => s.id === detail.id ? detail : s));
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : t('page.errors.sessionCreate'));
    }
  };

  // ── 새 회의 생성 ──────────────────────────────────────
  const handleStartMeeting = async (cfg: StartConfig) => {
    if (!businessId) {
      setLiveError(t('page.errors.noBusiness'));
      return;
    }
    setShowStartModal(false);
    setLiveError(null);
    setBlocks([]);
    setInterimText('');
    pendingRef.current = null;
    setPending(null);
    try {
      if (liveRef.current) {
        liveRef.current.stop();
        liveRef.current = null;
      }

      const created = await createSession({
        business_id: businessId,
        title: cfg.title || t('startModal.defaultTitle'),
        brief: cfg.brief || undefined,
        participants: cfg.participants.length > 0
          ? cfg.participants.map((p) => ({ name: p.name, role: p.role || null }))
          : undefined,
        meeting_languages: cfg.meetingLanguages,
        translation_language: cfg.translationLanguage,
        answer_language: cfg.answerLanguage,
        pasted_context: cfg.pastedContext || undefined,
        capture_mode: cfg.captureMode,
        // 사용자 프로필 스냅샷 — 답변을 "나"로서 생성하기 위한 배경
        user_name: user?.name || undefined,
        user_bio: user?.bio || undefined,
        user_expertise: user?.expertise || undefined,
        user_organization: user?.organization || undefined,
        user_job_title: user?.job_title || undefined,
        user_language_levels: user?.language_levels || undefined,
        user_expertise_level: user?.expertise_level || undefined,
        meeting_answer_style: cfg.meetingAnswerStyle || user?.answer_style_default || undefined,
        meeting_answer_length: cfg.meetingAnswerLength || user?.answer_length_default || 'medium',
        // keywords 는 서버가 자동 추출 — 프론트에서 전달하지 않음
      });

      // Priority Q&A — 다른 자료보다 먼저 업로드해 prefetch 에 즉시 반영
      for (const pq of cfg.priorityQAs) {
        try {
          await createPriorityQA(created.id, {
            question_text: pq.question,
            answer_text: pq.answer,
            short_answer: pq.shortAnswer,
            keywords: pq.keywords,
          });
        } catch (err) { console.error('Priority Q&A add failed:', err); }
      }
      if (cfg.priorityQACsv) {
        try { await uploadPriorityQACSV(created.id, cfg.priorityQACsv); }
        catch (err) { console.error('Priority Q&A CSV upload failed:', err); }
      }

      for (const file of cfg.documents) {
        try { await uploadDocument(created.id, file); }
        catch (err) { console.error(`Upload failed: ${file.name}`, err); }
      }
      for (const url of cfg.urls) {
        try { await addUrl(created.id, url); }
        catch (err) { console.error(`URL add failed: ${url}`, err); }
      }

      const detail = await getSession(created.id);
      // URL 핸들러가 이 새 세션을 openReview 하는 경합 방지 — navigate 전에 플래그 set
      urlSessionIdHandled.current = true;
      activeSessionRef.current = detail;
      setActiveSession(detail);
      speakersRef.current = detail.speakers || [];
      setSessions((prev) => [detail, ...prev]);
      setPendingConfig(cfg);
      setPhase('prepared');
      navigate(`/notes/${created.id}`, { replace: true });
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : t('page.errors.sessionCreate'));
    }
  };

  // ── 서버 utterances 를 블록으로 재구성 (리뷰/paused 공용) ──
  const buildBlocksFromSession = useCallback(
    (sess: QNoteSession | null): TranscriptBlock[] => {
      if (!sess?.utterances) return [];
      const speakers = sess.speakers || [];
      const speakerById = new Map(speakers.map((s) => [s.id, s]));
      const out: TranscriptBlock[] = [];
      let counter = 0;

    // 각 utterance를 독립 블록으로 생성 (merge 없음 — 문장별 분리)
    for (const u of sess.utterances as QNoteUtterance[]) {
      const start = typeof u.start_time === 'number' ? u.start_time : null;
      const end = typeof u.end_time === 'number' ? u.end_time : start;
      const dgSp = u.speaker_id != null
        ? (speakerById.get(u.speaker_id)?.deepgram_speaker_id ?? null)
        : null;
      const text = u.original_text || '';
      const seg: BlockSegment = {
        utteranceId: u.id,
        original: text,
        translation: u.translated_text,
        start,
        end,
      };
      const single: PendingBuffer = {
        segments: [seg],
        firstStart: start,
        lastEnd: end,
        dgSpeakerId: dgSp,
        speakerRowId: u.speaker_id,
        speakerLabel: speakerLabelFor(u.speaker_id, dgSp, { speakers, participants: sess.participants, labels: speakerLabels }),
      };
      const kind: BlockKind = u.is_question ? 'question' : 'speech';
      out.push({
        id: `r${++counter}`,
        kind,
        speakerRowId: single.speakerRowId,
        speakerLabel: single.speakerLabel,
        timestamp: formatTime(single.firstStart),
        segments: single.segments.slice(),
        firstStart: single.firstStart,
        lastEnd: single.lastEnd,
        lastDgSpeakerId: single.dgSpeakerId,
      });
    }

    return out;
  }, []);

  // 리뷰 모드용: activeSession 변경 시 자동 재계산
  const reviewBlocks = useMemo<TranscriptBlock[]>(
    () => buildBlocksFromSession(activeSession),
    [activeSession, buildBlocksFromSession]
  );

  // review 는 reviewBlocks (from DB) + blocks (추가된 수동 질문).
  // 그 외 (recording/paused/prepared) 는 blocks — live + 수동 질문이 시간 순 자동 정렬.
  const renderBlocks = useMemo<TranscriptBlock[]>(() => {
    if (phase === 'review') {
      return blocks.length > 0 ? [...reviewBlocks, ...blocks] : reviewBlocks;
    }
    return blocks;
  }, [phase, reviewBlocks, blocks]);
  const showRecordingUI = phase === 'prepared' || phase === 'recording' || phase === 'paused';

  // ── 수동 질문 submit — 사용자가 직접 입력한 질문을 회의언어로 자동 번역 후 답변 생성 ──
  // 정책: 입력 언어 감지 없이 LLM auto-detect + translate to meeting_language.
  // synthetic TranscriptBlock 을 `blocks` 에 직접 push → live 이벤트와 시간 순서로 자연스럽게 혼재.
  const submitManualQuestion = useCallback(async () => {
    const raw = manualInput.trim();
    if (!raw || manualSubmitting) return;
    const sess = activeSessionRef.current;
    if (!sess) return;
    const sessId = sess.id;

    // 회의 언어 두 슬롯 — 메인(굵게) + 서브(번역). 자동 감지 질문과 동일 형태.
    const langs = sess.meeting_languages || [];
    const mainLang = langs[0] || null;
    const subLang = langs[1] || null;

    // 입력 언어 휴리스틱 — 같은 언어로 LLM 호출하면 변덕 응답 (raw 그대로/살짝 변형/빈 응답) 발생.
    // 입력 언어 슬롯은 raw 그대로 두고, 다른 슬롯만 LLM 번역.
    const detectLang = (s: string): string | null => {
      if (/[가-힣]/.test(s)) return 'ko';
      if (/[ぁ-んァ-ン]/.test(s)) return 'ja';
      if (/[一-龥]/.test(s)) return 'zh';
      if (/[a-zA-Z]/.test(s)) return 'en';
      return null;
    };
    const inputLang = detectLang(raw);

    // 응답 언어 검증 — gpt-4.1-nano 가 가끔 영어→한국어 요청에 영어 paraphrase 반환.
    // 휴리스틱으로 검증: target lang 의 글자체가 응답에 있으면 OK, 아니면 실패로 간주.
    const verifyLang = (s: string, target: string): boolean => {
      const v = (s || '').trim();
      if (!v) return false;
      if (target === 'ko') return /[가-힣]/.test(v);
      if (target === 'ja') return /[ぁ-んァ-ン]/.test(v);
      if (target === 'zh') return /[一-龥]/.test(v) && !/[ぁ-んァ-ン]/.test(v);
      if (target === 'en') return !/[가-힣ぁ-んァ-ン一-龥]/.test(v) && /[a-zA-Z]/.test(v);
      return true;
    };
    // verify + 1회 재시도. 둘 다 실패 시 빈 문자열 반환.
    const translateVerified = async (target: string): Promise<string> => {
      for (let i = 0; i < 2; i++) {
        try {
          const res = await translateAnswer(sessId, raw, target);
          const out = (res.translation || '').trim();
          if (out && verifyLang(out, target)) return out;
        } catch { /* retry */ }
      }
      return '';
    };

    setManualSubmitting(true);
    const virtualId = manualIdRef.current--;

    // 슬롯별 채우기 전략:
    // - 입력 언어 == 슬롯 언어 → raw 그대로
    // - 입력 언어 != 슬롯 언어 → LLM 번역 (응답 언어 검증, 실패 시 빈 문자열)
    const needMain = !!mainLang && inputLang !== mainLang;
    const needSub = !!subLang && subLang !== mainLang && inputLang !== subLang;
    const [mainTransOk, subTransOk] = await Promise.all([
      needMain ? translateVerified(mainLang!) : Promise.resolve(''),
      needSub ? translateVerified(subLang!) : Promise.resolve(''),
    ]);
    // 메인은 비면 raw fallback (메인 슬롯은 항상 채워야 함)
    const mainText = needMain ? (mainTransOk || raw) : raw;
    // 서브는 비면 빈 문자열 → translation: null 처리
    let subText = '';
    if (subLang && subLang !== mainLang) {
      subText = needSub ? subTransOk : raw;
    }

    // 메인/서브 텍스트가 동일하면 translation null (자동 감지 카드와 동일 정책)
    const normalize = (s: string) => s.trim().toLowerCase().replace(/['']/g, "'").replace(/\s+/g, ' ');
    const translation = (subText && normalize(subText) !== normalize(mainText)) ? subText : null;

    // synthetic question block 을 blocks 끝에 push (isManual 로 좌측 라벨/뱃지 분기)
    const syntheticBlock: TranscriptBlock = {
      id: `manual-${virtualId}`,
      kind: 'question',
      speakerRowId: null,
      speakerLabel: '',
      timestamp: '',
      segments: [{
        utteranceId: virtualId,
        original: mainText,
        translation,
        start: null,
        end: null,
      }],
      firstStart: null,
      lastEnd: null,
      lastDgSpeakerId: null,
      isManual: true,
    };
    setBlocks((prev) => [...prev, syntheticBlock]);
    setAnswerData((prev) => ({ ...prev, [virtualId]: { loading: true, collapsed: false } }));
    setManualInput('');

    // 3) 답변 생성 (utterance_id 없이 — detected_questions 에 저장 안 됨)
    try {
      const result = await findAnswer(sessId, mainText);
      setAnswerData((prev) => ({
        ...prev,
        [virtualId]: {
          ...prev[virtualId],
          tier: result.tier,
          answer: result.answer || '',
          answer_translation: result.answer_translation || undefined,
          loading: false,
          collapsed: false,
        },
      }));
      // 답변 번역이 없으면 백그라운드로 가져옴
      if (result.answer && !result.answer_translation) {
        try {
          const tres = await translateAnswer(sessId, result.answer);
          setAnswerData((prev) => ({
            ...prev,
            [virtualId]: { ...prev[virtualId], answer_translation: tres.translation || '' },
          }));
        } catch { /* ignore */ }
      }
    } catch (err) {
      setAnswerData((prev) => ({
        ...prev,
        [virtualId]: {
          ...prev[virtualId],
          loading: false,
          error: err instanceof Error ? err.message : t('page.question.manualGenerateError', '답변 생성 실패'),
        },
      }));
    } finally {
      setManualSubmitting(false);
    }
  }, [manualInput, manualSubmitting]);

  // ─── 화자 인라인 할당 팝오버 상태 ───────────────────
  // 자동 인식 실패 시 수동 지정이 필요하므로 recording 중에도 허용.
  // (사용자 요청: "화자 선택이 안 됨" — 녹음 중에도 열려야 함)
  const speakerAssignAllowed = phase !== 'empty' && phase !== 'prepared';
  // 팝오버는 클릭한 **그 블록**에만 떠야 함. 같은 speakerRowId 여러 블록에 동시 렌더 금지.
  const [speakerPopoverFor, setSpeakerPopoverFor] = useState<string | null>(null); // block.id
  const [assignSaving, setAssignSaving] = useState(false);

  // ── 답변 찾기 상태 ──
  const [answerData, setAnswerData] = useState<Record<number, {
    loading?: boolean;
    tier?: string;
    answer?: string;
    answer_translation?: string;
    error?: string;
    collapsed?: boolean;
    editedQuestion?: string;          // 수정된 질문 (undefined면 원본)
    editedTranslation?: string;       // 수정된 질문의 번역 (editedQuestion 변경 시 재계산)
    mergedBlockIds?: string[];        // 합친 블록 ID 목록 (순서 유지)
  }>>({});
  const [answerReadySet, setAnswerReadySet] = useState<Set<number>>(new Set());
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);

  // 현재 합쳐진(숨겨진) 블록 ID set — 렌더링 시 스킵
  const hiddenBlockIds = useMemo(() => {
    const set = new Set<string>();
    Object.values(answerData).forEach((ad) => {
      ad.mergedBlockIds?.forEach((id) => set.add(id));
    });
    return set;
  }, [answerData]);

  // 내 스크립트 숨기기 — 본인 speech 블록 필터 (질문 카드는 예외로 노출)
  const isSelfBlock = useCallback((block: TranscriptBlock): boolean => {
    if (block.speakerRowId == null) return false;
    return speakersRef.current.some((s) => s.id === block.speakerRowId && !!s.is_self);
  }, []);

  // ── Merge 상태 localStorage persistence ──
  // 세션별로 merge 정보만 저장/복원 (답변/로딩 상태는 저장 안 함)
  const mergeStorageKey = activeSession ? `qnote-merge-${activeSession.id}` : null;

  // 세션 변경 시 저장된 merge 상태 복원
  useEffect(() => {
    if (!mergeStorageKey) return;
    try {
      const raw = localStorage.getItem(mergeStorageKey);
      if (!raw) return;
      const saved: Record<number, { editedQuestion?: string; mergedBlockIds?: string[] }> = JSON.parse(raw);
      setAnswerData((prev) => {
        const next = { ...prev };
        Object.entries(saved).forEach(([uttId, data]) => {
          const id = Number(uttId);
          next[id] = { ...next[id], editedQuestion: data.editedQuestion, mergedBlockIds: data.mergedBlockIds };
        });
        return next;
      });
    } catch { /* ignore parse errors */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeStorageKey]);

  // answerData 의 merge 관련 필드가 변경되면 localStorage 저장
  useEffect(() => {
    if (!mergeStorageKey) return;
    const toSave: Record<number, { editedQuestion?: string; mergedBlockIds?: string[] }> = {};
    Object.entries(answerData).forEach(([uttId, data]) => {
      if (data.editedQuestion !== undefined || (data.mergedBlockIds && data.mergedBlockIds.length > 0)) {
        toSave[Number(uttId)] = {
          editedQuestion: data.editedQuestion,
          mergedBlockIds: data.mergedBlockIds,
        };
      }
    });
    try {
      if (Object.keys(toSave).length > 0) {
        localStorage.setItem(mergeStorageKey, JSON.stringify(toSave));
      } else {
        localStorage.removeItem(mergeStorageKey);
      }
    } catch { /* storage full or unavailable */ }
  }, [answerData, mergeStorageKey]);

  const refreshActiveSession = useCallback(async () => {
    const sess = activeSessionRef.current;
    if (!sess) return;
    const refreshed = await getSession(sess.id);
    setActiveSession(refreshed);
    speakersRef.current = refreshed.speakers || [];
    // blocks 의 speakerRowId 를 서버 utterances 기준으로 즉시 갱신
    if (refreshed.utterances) {
      const uttMap = new Map(
        (refreshed.utterances as QNoteUtterance[]).map((u) => [u.id, u])
      );
      setBlocks((prev) =>
        prev.map((block) => {
          const uttId = block.segments[0]?.utteranceId;
          if (!uttId) return block;
          const u = uttMap.get(uttId);
          if (!u) return block;
          const newKind: BlockKind = u.is_question ? 'question' : 'speech';
          if (block.speakerRowId === u.speaker_id && block.kind === newKind) return block;
          return { ...block, speakerRowId: u.speaker_id, kind: newKind };
        })
      );
    }
  }, []);

  // 라이브 자동 하단 스크롤 (sticky-to-bottom: 사용자가 위로 스크롤했으면 멈춤)
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const el = transcriptRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [blocks, pending, interimText, phase]);

  // phase 전환 시 sticky 초기화
  useEffect(() => {
    if (phase === 'recording' || phase === 'paused') {
      stickToBottomRef.current = true;
    }
  }, [phase]);

  // ─── 블록 렌더 ─────────────────────────────────────
  const currentCaptureMode = pendingConfig?.captureMode || activeSession?.capture_mode || 'microphone';
  const isMicMode = currentCaptureMode === 'microphone';

  const renderBlock = (block: TranscriptBlock, _prevBlock: TranscriptBlock | null, blockIndex: number, visibleBlocks: TranscriptBlock[]) => {
    const originalText = joinText(block.segments);
    const { text: translatedText, hasAny, allTranslated } = joinTranslation(block.segments);

    const allOutOfScope = block.segments.length > 0 && block.segments.every((s) => s.outOfScope);

    const speakerCtx = { speakers: activeSession?.speakers || [], participants: activeSession?.participants, labels: speakerLabels };

    // 마이크 모드: 수동 지정된 이름(participant_name / is_self)만 표시. 자동 라벨 안 붙음.
    let liveLabel = '';
    if (block.isManual) {
      // 사용자가 직접 입력한 질문 — "직접 입력" 라벨로 자동 감지(상대) 발화와 구분
      liveLabel = t('page.speaker.manual');
    } else if (isMicMode) {
      if (block.speakerRowId != null) {
        const match = speakerCtx.speakers.find((s) => s.id === block.speakerRowId);
        if (match?.is_self) liveLabel = speakerLabels.self;
        else if (match?.participant_name) liveLabel = match.participant_name;
      }
    } else {
      liveLabel = speakerLabelFor(block.speakerRowId, block.lastDgSpeakerId, speakerCtx);
    }

    const isSelfSpeaker = block.speakerRowId != null &&
      speakerCtx.speakers.some((s) => s.id === block.speakerRowId && s.is_self);

    // 문장 단위 화자 변경 (utterance 기반)
    const uttId = block.segments[0]?.utteranceId;
    const renderAssignBtn = () => {
      if (!speakerAssignAllowed || !uttId) return null;
      // 현재 블록에 이미 지정된 화자 이름 (팝오버에서 제외하기 위해)
      const currentSpeaker = speakerCtx.speakers.find((s) => s.id === block.speakerRowId);
      const currentSpeakerName = currentSpeaker?.participant_name || null;
      const currentIsSelf = currentSpeaker?.is_self ?? false;
      return (
        <SpeakerAssignWrap>
          <SpeakerAssignBtn
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              setSpeakerPopoverFor((prev) => (prev === block.id ? null : block.id));
            }}
          >
            ▾
          </SpeakerAssignBtn>
          {speakerPopoverFor === block.id && (
            <SpeakerPopover
              currentSpeakerName={currentSpeakerName}
              currentIsSelf={currentIsSelf}
              participants={activeSession?.participants || []}
              onClose={() => setSpeakerPopoverFor(null)}
              onAssignName={async (name) => {
                const sess = activeSessionRef.current;
                if (!sess) return;
                setAssignSaving(true);
                try {
                  await reassignUtteranceSpeaker(sess.id, uttId, { participant_name: name });
                  await refreshActiveSession();
                  setSpeakerPopoverFor(null);
                } finally {
                  setAssignSaving(false);
                }
              }}
              onAssignSelf={async () => {
                const sess = activeSessionRef.current;
                if (!sess) return;
                setAssignSaving(true);
                try {
                  await reassignUtteranceSpeaker(sess.id, uttId, { is_self: true });
                  await refreshActiveSession();
                  setSpeakerPopoverFor(null);
                } finally {
                  setAssignSaving(false);
                }
              }}
              disabled={assignSaving}
            />
          )}
        </SpeakerAssignWrap>
      );
    };

    // 마이크 모드: 화자를 모르므로 모든 질문이 카드
    // 웹 화상회의: 내 질문은 카드 아님 (기존 규칙)
    const showAsQuestion = isMicMode
      ? block.kind === 'question'
      : block.kind === 'question' && !isSelfSpeaker;

    if (showAsQuestion) {
      const questionUttId = block.segments[0]?.utteranceId;
      const ad = questionUttId ? answerData[questionUttId] : undefined;
      const hasReadyAnswer = questionUttId ? answerReadySet.has(questionUttId) : false;
      const hasAnswer = ad && !ad.loading && ad.answer && !ad.error;
      const isCollapsed = ad?.collapsed ?? false;
      const isEditing = editingQuestionId === questionUttId;

      const fetchTranslation = (sessId: number, uttId: number, answerText: string) => {
        translateAnswer(sessId, answerText)
          .then((res) => {
            if (res.translation) {
              setAnswerData((prev) => {
                const cur = prev[uttId];
                if (!cur) return prev;
                return { ...prev, [uttId]: { ...cur, answer_translation: res.translation } };
              });
            }
          })
          .catch(() => {});
      };

      const doSearch = async (searchText: string) => {
        if (!questionUttId || !activeSessionRef.current) return;
        const sessId = activeSessionRef.current.id;

        setAnswerData((prev) => ({ ...prev, [questionUttId]: { ...prev[questionUttId], loading: true, error: undefined, collapsed: false } }));

        // 수정 안 한 원본이면 캐시 시도
        if (searchText === originalText) {
          try {
            const cached = await getCachedAnswer(sessId, questionUttId);
            setAnswerData((prev) => ({
              ...prev,
              [questionUttId]: {
                ...prev[questionUttId],
                tier: cached.answer_tier || 'cached',
                answer: cached.answer,
                loading: false,
                collapsed: false,
              },
            }));
            fetchTranslation(sessId, questionUttId, cached.answer);
            return;
          } catch { /* 캐시 없음 */ }
        }

        try {
          const result = await findAnswer(sessId, searchText, questionUttId);
          if (result.tier === 'none') {
            setAnswerData((prev) => ({
              ...prev,
              [questionUttId]: { ...prev[questionUttId], answer: t('page.question.notFound'), tier: 'none', loading: false, collapsed: false },
            }));
          } else {
            setAnswerData((prev) => ({
              ...prev,
              [questionUttId]: {
                ...prev[questionUttId],
                tier: result.tier,
                answer: result.answer || '',
                answer_translation: result.answer_translation || undefined,
                loading: false,
                collapsed: false,
              },
            }));
            if (result.answer && !result.answer_translation) {
              fetchTranslation(sessId, questionUttId, result.answer);
            }
          }
        } catch (err) {
          setAnswerData((prev) => ({
            ...prev,
            [questionUttId]: { ...prev[questionUttId], error: err instanceof Error ? err.message : t('page.question.findError'), loading: false },
          }));
        }
      };

      const handleBtnClick = () => {
        if (!questionUttId) return;
        if (ad?.loading) return;
        if (hasAnswer) {
          // 답변 있음 → 접기/펼치기 토글
          setAnswerData((prev) => ({
            ...prev,
            [questionUttId]: { ...prev[questionUttId], collapsed: !isCollapsed },
          }));
        } else {
          // 답변 없음 → 검색
          const searchText = ad?.editedQuestion ?? originalText;
          doSearch(searchText);
        }
      };

      // 질문 텍스트 수정 시작
      const startEdit = () => {
        if (!questionUttId) return;
        setEditingQuestionId(questionUttId);
      };

      // 질문 텍스트 번역 (편집/합침 시 재계산) — 기존 translate-answer 엔드포인트 재사용
      const retranslateQuestion = async (sessId: number, uttId: number, text: string) => {
        try {
          const res = await translateAnswer(sessId, text);
          setAnswerData((prev) => ({
            ...prev,
            [uttId]: { ...prev[uttId], editedTranslation: res.translation || '' },
          }));
        } catch { /* 실패 시 기존 segment 번역이 폴백으로 표시됨 */ }
      };

      const commitEdit = (newText: string) => {
        if (!questionUttId) return;
        setEditingQuestionId(null);
        const trimmed = newText.trim();
        if (!trimmed || trimmed === originalText) {
          // 원본과 같거나 빈 값 → 수정 취소, editedQuestion/editedTranslation 제거
          setAnswerData((prev) => {
            const cur = { ...prev[questionUttId] };
            delete cur.editedQuestion;
            delete cur.editedTranslation;
            return { ...prev, [questionUttId]: cur };
          });
          return;
        }
        // 수정됨 → 기존 답변+번역 클리어 + 새 질문으로 자동 번역 + 자동 검색
        setAnswerData((prev) => ({
          ...prev,
          [questionUttId]: { editedQuestion: trimmed },
        }));
        if (activeSession) {
          retranslateQuestion(activeSession.id, questionUttId, trimmed);
        }
        doSearch(trimmed);
      };

      // 다음 블록 텍스트 합치기 (다음 블록은 숨김 처리)
      const handleMergeNext = () => {
        if (!questionUttId) return;
        const nextBlock = visibleBlocks[blockIndex + 1];
        if (!nextBlock) return;
        const nextText = joinText(nextBlock.segments);
        if (!nextText) return;
        const currentText = ad?.editedQuestion || originalText;
        const merged = currentText + ' ' + nextText;
        const prevMergedIds = ad?.mergedBlockIds || [];
        setAnswerData((prev) => ({
          ...prev,
          [questionUttId]: {
            ...prev[questionUttId],
            editedQuestion: merged,
            editedTranslation: undefined,  // 다시 계산하도록 초기화
            answer: undefined,
            answer_translation: undefined,
            tier: undefined,
            mergedBlockIds: [...prevMergedIds, nextBlock.id],
          },
        }));
        if (activeSession) {
          retranslateQuestion(activeSession.id, questionUttId, merged);
        }
        doSearch(merged);
      };

      // 합친 블록 분리 — 숨김 해제 + 질문 원본 복귀
      const handleUnmerge = () => {
        if (!questionUttId) return;
        setAnswerData((prev) => {
          const cur = { ...prev[questionUttId] };
          delete cur.editedQuestion;
          delete cur.editedTranslation;
          delete cur.mergedBlockIds;
          delete cur.answer;
          delete cur.answer_translation;
          delete cur.tier;
          delete cur.collapsed;
          return { ...prev, [questionUttId]: cur };
        });
      };

      const hasNextBlock = blockIndex + 1 < visibleBlocks.length;
      const mergedCount = ad?.mergedBlockIds?.length || 0;

      return (
        <QuestionCard key={block.id}>
          <QuestionLeadCol>
            {liveLabel && <SpeakerInline $self={isSelfSpeaker}>{liveLabel}</SpeakerInline>}
            {renderAssignBtn()}
          </QuestionLeadCol>
          <QuestionBodyCol>
            <QuestionTopRow>
              {block.isManual && <ManualBadge>{t('page.question.manualBadge', '입력한 질문')}</ManualBadge>}
              {isEditing ? (
                <QuestionEditInput
                  defaultValue={ad?.editedQuestion ?? originalText}
                  autoFocus
                  onBlur={(e) => commitEdit(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.currentTarget.value); }
                    if (e.key === 'Escape') {
                      setEditingQuestionId(null);
                    }
                  }}
                />
              ) : (
                <QuestionOriginal onClick={startEdit} title={t('page.header.editTitleHint')} style={{ cursor: 'text' }}>
                  {ad?.editedQuestion || originalText}
                  {ad?.editedQuestion && <EditedMark>{t('page.question.editedMark')}</EditedMark>}
                  {mergedCount > 0 && <MergedBadge>{t('page.question.mergedBadge', { count: mergedCount })}</MergedBadge>}
                </QuestionOriginal>
              )}
              <QuestionTopActions>
                {hasNextBlock && !isEditing && (
                  <MergeNextBtn onClick={handleMergeNext} title={t('page.question.mergeNextTitle')}>+</MergeNextBtn>
                )}
                {mergedCount > 0 && !isEditing && (
                  <UnmergeBtn onClick={handleUnmerge} title={t('page.question.unmergeTitle')}>{t('page.question.unmergeLabel')}</UnmergeBtn>
                )}
                <InlineTime>{block.timestamp}</InlineTime>
                {hasAnswer ? (
                  <CollapseBtn onClick={handleBtnClick}>
                    {isCollapsed ? t('page.question.showAnswer') : t('page.question.hideAnswer')}
                  </CollapseBtn>
                ) : (
                  <FindAnswerBtn
                    onClick={handleBtnClick}
                    disabled={ad?.loading}
                    $ready={hasReadyAnswer}
                  >
                    {t('page.question.findAnswer')}
                  </FindAnswerBtn>
                )}
              </QuestionTopActions>
            </QuestionTopRow>
            {!isEditing && (ad?.editedQuestion ? (
              ad?.editedTranslation !== undefined ? (
                ad.editedTranslation ? (
                  <QuestionTranslation>{ad.editedTranslation}</QuestionTranslation>
                ) : null
              ) : (
                <QuestionTranslation style={{ fontStyle: 'italic', color: '#94a3b8' }}>
                  {t('page.question.translating')}
                </QuestionTranslation>
              )
            ) : (hasAny && (
              <QuestionTranslation>
                {translatedText}
                {!allTranslated && <PendingHint> ...</PendingHint>}
              </QuestionTranslation>
            )))}
            {hasAnswer && !isCollapsed && (
              <AnswerPanel>
                <AnswerTierBadge $tier={ad.tier || 'general'}>
                  {ad.tier === 'priority' ? t('page.question.tier.priority') : ad.tier === 'custom' ? t('page.question.tier.custom') : ad.tier === 'session_reuse' ? t('page.question.tier.sessionReuse') : ad.tier === 'generated' ? t('page.question.tier.generated') : ad.tier === 'rag' ? t('page.question.tier.rag') : ad.tier === 'none' ? t('page.question.tier.none') : t('page.question.tier.general')}
                </AnswerTierBadge>
                <AnswerText>{ad.answer}</AnswerText>
                {ad.answer_translation ? (
                  <AnswerTranslation>{ad.answer_translation}</AnswerTranslation>
                ) : ad.tier !== 'none' ? (
                  <AnswerTranslation style={{ fontStyle: 'italic', color: '#94a3b8' }}>{t('page.question.translating')}</AnswerTranslation>
                ) : null}
              </AnswerPanel>
            )}
            {ad?.loading && <AnswerLoading>{t('page.question.searching')}</AnswerLoading>}
            {ad?.error && <AnswerError>{ad.error}</AnswerError>}
          </QuestionBodyCol>
        </QuestionCard>
      );
    }

    return (
      <SpeechBlockWrap key={block.id} $dimmed={allOutOfScope}>
        {liveLabel && <SpeakerInline $self={isSelfSpeaker}>{liveLabel}</SpeakerInline>}
        {renderAssignBtn()}
        <SpeechTextCol>
          <SpeechRow>
            <SpeechOriginal>{originalText}</SpeechOriginal>
            <InlineTime>{block.timestamp}</InlineTime>
          </SpeechRow>
          {!allOutOfScope && hasAny && (
            <SpeechTranslation>
              {translatedText}
              {!allTranslated && <PendingHint> ...</PendingHint>}
            </SpeechTranslation>
          )}
        </SpeechTextCol>
      </SpeechBlockWrap>
    );
  };

  // ─── Pending (미완성 문장) 렌더 — 유령 블록 ─────────
  const renderPending = () => {
    if (!pending) return null;
    const originalText = joinText(pending.segments);
    if (!originalText) return null;
    return (
      <PendingBlockWrap>
        <BlockHeader>
          <BlockSpeaker>{pending.speakerLabel}</BlockSpeaker>
          <BlockTime>{formatTime(pending.firstStart)}</BlockTime>
        </BlockHeader>
        <PendingOriginal>{originalText}</PendingOriginal>
      </PendingBlockWrap>
    );
  };

  return (
    <Layout $collapsed={sidebarCollapsed}>
      <Sidebar $collapsed={sidebarCollapsed}>
        <SidebarHeader>
          <SidebarTitle>Q note</SidebarTitle>
          <HelpDot askCue={t('page.help.cuePrefill','Q note 의 회의 시작·녹음 모드·답변 찾기·화자 인식이 어떻게 작동하는지 알려줘') as string} topic="qnote">
            {t('page.help.body','회의 시작 시 참여자·자료·언어를 등록하면 STT 가 더 정확합니다. 마이크 모드는 본인만, 웹회의 모드는 채널 분리(나/상대). 질문 카드에서 "답변 찾기" → 회의 자료 우선 RAG. 입력창에 직접 질문 입력도 가능.')}
          </HelpDot>
          <NewSessionBtn
            onClick={() => setShowStartModal(true)}
            title={t('page.newMeeting')}
            aria-label={t('page.newMeeting')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </NewSessionBtn>
        </SidebarHeader>

        <SearchWrap>
          <SearchBoxCommon
            value={sessionQuery}
            onChange={setSessionQuery}
            placeholder={t('page.sessionSearchPlaceholder') as string}
            width="100%"
          />
        </SearchWrap>

        <SessionList>
          {sessions.length === 0 && <EmptySessionMsg>{t('page.emptySessionList')}</EmptySessionMsg>}
          {filteredSessions.map((session) => {
            const isActive = activeSession?.id === session.id;
            const statusLabel =
              session.status === 'recording' ? t('page.sessionStatus.recording') :
              session.status === 'paused' ? t('page.sessionStatus.paused') :
              session.status === 'completed' ? t('page.sessionStatus.completed') :
              session.status === 'prepared' ? t('page.sessionStatus.prepared') : t('page.sessionStatus.pending');
            // Q Task 파스텔 pill 팔레트와 통일 (bg / fg 2톤)
            const statusStyle: { bg: string; fg: string } =
              session.status === 'recording' ? { bg: '#FEE2E2', fg: '#B91C1C' } :
              session.status === 'paused' ? { bg: '#FEF3C7', fg: '#92400E' } :
              session.status === 'completed' ? { bg: '#E2E8F0', fg: '#475569' } :
              session.status === 'prepared' ? { bg: '#CCFBF1', fg: '#0F766E' } :
              { bg: '#F1F5F9', fg: '#64748B' };
            const participants = session.participants || [];
            const participantNames = participants.map((p) => p.name).join(', ');
            return (
              <SessionItem
                key={session.id}
                data-qnote-session={session.id}
                $active={isActive}
                onClick={() => handleSessionClick(session.id)}
              >
                <SessionItemRow>
                  <SessionItemTitle>{session.title}</SessionItemTitle>
                  <SessionStatusBadge style={{ background: statusStyle.bg, color: statusStyle.fg }}>{statusLabel}</SessionStatusBadge>
                </SessionItemRow>
                <SessionItemMeta>
                  <span>{fmtWsDate(session.created_at)}</span>
                  {session.utterance_count > 0 && (
                    <>
                      <Dot>·</Dot>
                      <span>{t('page.sessionUtteranceCount', { count: session.utterance_count })}</span>
                    </>
                  )}
                  {participantNames && (
                    <>
                      <Dot>·</Dot>
                      <SessionParticipants>{participantNames}</SessionParticipants>
                    </>
                  )}
                </SessionItemMeta>
              </SessionItem>
            );
          })}
        </SessionList>
      </Sidebar>

      {viewportNarrow && !sidebarCollapsed && (
        <SidebarBackdrop onClick={() => setSidebarCollapsed(true)} />
      )}

      <Main>
        <CollapseToggle
          onClick={() => setSidebarCollapsed((v) => !v)}
          aria-label={sidebarCollapsed ? t('page.sidebarOpen') : t('page.sidebarCollapse')}
          title={sidebarCollapsed ? t('page.sidebarOpen') : t('page.sidebarCollapse')}
        >
          <SidebarToggleChevron>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              {sidebarCollapsed
                ? <polyline points="9 18 15 12 9 6" />
                : <polyline points="15 18 9 12 15 6" />
              }
            </svg>
          </SidebarToggleChevron>
        </CollapseToggle>

        {phase === 'empty' && (
          <SharedEmptyState
            icon={<MicIcon size={36} />}
            title={t('page.empty.title')}
            description={<>{t('page.empty.line1')}<br />{t('page.empty.line2')}</>}
            ctaLabel={t('page.newMeetingStart')}
            ctaIcon={<PlusIcon size={16} />}
            onCta={() => setShowStartModal(true)}
          />
        )}

        {showRecordingUI && activeSession && (
          <>
            {headerCollapsed ? (
              <CollapsedHeader>
                <CollapsedTitle onClick={() => setEditingTitle(true)} title={t('page.header.editTitleHint')}>
                  {activeSession.title}
                </CollapsedTitle>
                {phase === 'recording' && <Badge>{t('page.phase.recording')}</Badge>}
                {phase === 'paused' && <Badge>{t('page.phase.paused')}</Badge>}
                {phase === 'prepared' && <Badge>{t('page.phase.prepared')}</Badge>}
                <CollapsedSpacer />
                {phase === 'recording' && (
                  <>
                    <IconBtn onClick={pauseRecording} title={t('page.controls.pause')} aria-label={t('page.controls.pause')}>
                      <StopIcon size={14} />
                    </IconBtn>
                    <IconBtn $danger onClick={endMeeting} title={t('page.controls.endMeeting')} aria-label={t('page.controls.endMeeting')}>
                      <PowerIcon size={14} />
                    </IconBtn>
                  </>
                )}
                {phase === 'paused' && (
                  <>
                    <IconBtn $primary onClick={startRecording} disabled={lockedByOther} title={lockedByOther ? t('page.errors.recorderLockedBanner') : t('page.controls.resume')} aria-label={t('page.controls.resume')}>
                      <MicIcon size={14} />
                    </IconBtn>
                    <IconBtn $danger onClick={endMeeting} title={t('page.controls.endMeeting')} aria-label={t('page.controls.endMeeting')}>
                      <PowerIcon size={14} />
                    </IconBtn>
                  </>
                )}
                {phase === 'prepared' && (
                  <IconBtn $primary onClick={startRecording} disabled={lockedByOther} title={lockedByOther ? t('page.errors.recorderLockedBanner') : t('page.controls.startRecording')} aria-label={t('page.controls.startRecording')}>
                    <MicIcon size={14} />
                  </IconBtn>
                )}
                <HeaderEdgeHandle
                  type="button"
                  onClick={toggleHeaderCollapsed}
                  aria-label={t('page.header.expand')}
                  title={t('page.header.expand')}
                >
                  <HeaderEdgeChevron><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></HeaderEdgeChevron>
                </HeaderEdgeHandle>
              </CollapsedHeader>
            ) : (
              <MainHeader>
                <HeaderLeft>
                  {editingTitle ? (
                    <SessionTitleInput
                      defaultValue={activeSession.title}
                      autoFocus
                      onBlur={(e) => handleTitleSave(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleTitleSave(e.currentTarget.value); }
                        if (e.key === 'Escape') setEditingTitle(false);
                      }}
                    />
                  ) : (
                    <SessionTitle onClick={() => setEditingTitle(true)} title={t('page.header.editTitleHint')}>
                      {activeSession.title}
                    </SessionTitle>
                  )}
                  <SessionMeta>
                    {meetingLangLabels && <Badge>{meetingLangLabels}</Badge>}
                    {phase === 'prepared' && <Badge>{t('page.phase.prepared')}</Badge>}
                    {phase === 'recording' && <Badge>{t('page.phase.recording')}</Badge>}
                    {phase === 'paused' && <Badge>{t('page.phase.paused')}</Badge>}
                  </SessionMeta>
                </HeaderLeft>
                <HeaderRight>
                  <SecondaryBtn $compact onClick={() => { setEditingSession(true); setShowStartModal(true); }} title={t('page.controls.settings')} aria-label={t('page.controls.settings')}>
                    <SettingsIcon size={14} />
                    <BtnLabel>{t('page.controls.settings')}</BtnLabel>
                  </SecondaryBtn>
                  {phase === 'prepared' && (
                    <PrimaryBtn $compact onClick={startRecording} disabled={lockedByOther} title={lockedByOther ? t('page.errors.recorderLockedBanner') : t('page.controls.startRecording')} aria-label={t('page.controls.startRecording')}>
                      <MicIcon size={14} />
                      <BtnLabel>{t('page.controls.startRecording')}</BtnLabel>
                    </PrimaryBtn>
                  )}
                  {phase === 'recording' && (
                    <>
                      <RecordingIndicator>
                        <RecordDot />
                        <BtnLabel>{t('page.controls.recordingNow')}</BtnLabel>
                      </RecordingIndicator>
                      <SecondaryBtn $compact onClick={pauseRecording} title={t('page.controls.pause')} aria-label={t('page.controls.pause')}>
                        <StopIcon size={14} />
                        <BtnLabel>{t('page.controls.pause')}</BtnLabel>
                      </SecondaryBtn>
                      <DangerBtn $compact onClick={endMeeting} title={t('page.controls.endMeeting')} aria-label={t('page.controls.endMeeting')}>
                        <PowerIcon size={14} />
                        <BtnLabel>{t('page.controls.endMeeting')}</BtnLabel>
                      </DangerBtn>
                    </>
                  )}
                  {phase === 'paused' && (
                    <>
                      <PrimaryBtn $compact onClick={startRecording} disabled={lockedByOther} title={lockedByOther ? t('page.errors.recorderLockedBanner') : t('page.controls.resume')} aria-label={t('page.controls.resume')}>
                        <MicIcon size={14} />
                        <BtnLabel>{t('page.controls.resume')}</BtnLabel>
                      </PrimaryBtn>
                      <DangerBtn $compact onClick={endMeeting} title={t('page.controls.endMeeting')} aria-label={t('page.controls.endMeeting')}>
                        <PowerIcon size={14} />
                        <BtnLabel>{t('page.controls.endMeeting')}</BtnLabel>
                      </DangerBtn>
                    </>
                  )}
                </HeaderRight>
                <HeaderEdgeHandle
                  type="button"
                  onClick={toggleHeaderCollapsed}
                  aria-label={t('page.header.collapse')}
                  title={t('page.header.collapse')}
                >
                  <HeaderEdgeChevron><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg></HeaderEdgeChevron>
                </HeaderEdgeHandle>
              </MainHeader>
            )}

            {!headerCollapsed && (
              <ParticipantBar>
                <ParticipantBarLabel>{t('page.participantBar.label', { count: (activeSession.participants?.length ?? 0) + 1 })}</ParticipantBarLabel>
                <ParticipantPill key="self">{t('page.participantBar.self')}</ParticipantPill>
                {(activeSession.participants || []).map((p, i) => (
                  <ParticipantPill key={i}>
                    {p.name}
                    {p.role && <ParticipantPillRole>{p.role}</ParticipantPillRole>}
                  </ParticipantPill>
                ))}
                <SelfModeGroup>
                  <SelfModeLabel>{t('page.selfMode.label', '내 발화')}</SelfModeLabel>
                  <SelfModeBtn $active={selfMode === 'skip'} onClick={() => setSelfMode('skip')} title={t('page.selfMode.skipTitle', '내 발화는 아예 처리 안 함 (가장 빠름)')}>{t('page.selfMode.skip', '처리 안 함')}</SelfModeBtn>
                  <SelfModeBtn $active={selfMode === 'hide'} onClick={() => setSelfMode('hide')} title={t('page.selfMode.hideTitle', '내 발화는 녹음·저장하되 화면에서 숨김')}>{t('page.selfMode.hide', '숨김')}</SelfModeBtn>
                  <SelfModeBtn $active={selfMode === 'show'} onClick={() => setSelfMode('show')} title={t('page.selfMode.showTitle', '내 발화도 다 보여줌')}>{t('page.selfMode.show', '보기')}</SelfModeBtn>
                </SelfModeGroup>
              </ParticipantBar>
            )}

            {liveError && <ErrorBar>{liveError}</ErrorBar>}
            {liveNotice && <NoticeBar>{liveNotice}</NoticeBar>}
            {lockedByOther && phase !== 'recording' && (
              <LockBar>{t('page.errors.recorderLockedBanner', '다른 탭/기기에서 이 회의를 녹음 중입니다. 중복 녹음은 되지 않습니다.')}</LockBar>
            )}

            {(phase === 'prepared' || phase === 'paused') && readiness && (() => {
              // allReady 면 기본 collapsed (한 줄 요약만). 클릭/토글로 펼침.
              // 준비 중이면 항상 펼쳐서 진행 상황 표시.
              const collapsed = readiness.allReady && !readinessExpanded;
              const summary = readiness.allReady
                ? t('page.readiness.summaryReady', {
                    docs: `${readiness.docsIndexed}/${readiness.docsTotal || 0}`,
                    qa: `${readiness.pqEmbedded}/${readiness.pqTotal}`,
                    voc: readiness.keywordsCount,
                  })
                : t('page.readiness.summaryPending', '⏳ 자료 준비 중...');
              return (
                <ReadinessPanel
                  $ready={readiness.allReady}
                  $collapsed={collapsed}
                  onClick={() => readiness.allReady && setReadinessExpanded((v) => !v)}
                  title={readiness.allReady ? t('page.readiness.toggleTitle', '클릭하여 펼치기/접기') : ''}
                >
                  <ReadinessHeader $collapsed={collapsed}>
                    <ReadinessDot $ready={readiness.allReady} />
                    {collapsed ? summary : (readiness.allReady ? t('page.readiness.allReady', '✓ 모든 자료 준비 완료 — 녹음 시작 가능') : t('page.readiness.pending', '⏳ 자료 준비 중...'))}
                    {readiness.allReady && (
                      <ReadinessToggleHint>{collapsed ? t('page.readiness.expand', '자세히 ▾') : t('page.readiness.collapse', '접기 ▴')}</ReadinessToggleHint>
                    )}
                  </ReadinessHeader>
                  {!collapsed && (
                    <>
                      <ReadinessGrid>
                        <ReadinessItem>
                          <ReadinessLabel>{t('page.readiness.docsLabel', '참고 문서')}</ReadinessLabel>
                          <ReadinessValue $ok={readiness.docsTotal === 0 || readiness.docsIndexed === readiness.docsTotal}>
                            {readiness.docsTotal === 0
                              ? t('page.readiness.docsNone', '없음')
                              : t('page.readiness.docsIndexed', { indexed: readiness.docsIndexed, total: readiness.docsTotal })}
                            {readiness.docsFailed > 0 && <FailedBadge>{t('page.readiness.docsFailed', { count: readiness.docsFailed })}</FailedBadge>}
                          </ReadinessValue>
                        </ReadinessItem>
                        <ReadinessItem>
                          <ReadinessLabel>{t('page.readiness.priorityLabel', '최우선 Q&A')}</ReadinessLabel>
                          <ReadinessValue $ok={readiness.pqTotal === readiness.pqEmbedded}>
                            {readiness.pqTotal === 0 ? t('page.readiness.priorityNone', '없음') : t('page.readiness.priorityEmbedded', { embedded: readiness.pqEmbedded, total: readiness.pqTotal })}
                          </ReadinessValue>
                        </ReadinessItem>
                        <ReadinessItem>
                          <ReadinessLabel>{t('page.readiness.vocabLabel', '어휘사전 (STT 교정)')}</ReadinessLabel>
                          <ReadinessValue $ok={readiness.keywordsCount > 0}>
                            {readiness.keywordsCount > 0 ? t('page.readiness.vocabCount', { count: readiness.keywordsCount }) : t('page.readiness.vocabNone', '미생성')}
                          </ReadinessValue>
                        </ReadinessItem>
                      </ReadinessGrid>
                      <ReadinessHint>
                        {t('page.readiness.hintLine1', '"설정" 버튼에서 자료·Q&A·어휘사전을 확인·편집할 수 있습니다.')}
                        {' '}
                        {t('page.readiness.hintLine2', '인덱싱은 파일 크기에 따라 10초~1분 걸릴 수 있어요.')}
                      </ReadinessHint>
                    </>
                  )}
                </ReadinessPanel>
              );
            })()}

            <Transcript ref={transcriptRef} onScroll={handleTranscriptScroll}>
              {renderBlocks.length === 0 && !pending && phase === 'prepared' && (
                <EmptyTranscript>
                  {t('page.prepared.ready')}
                  <br />
                  {t('page.prepared.hint')}
                </EmptyTranscript>
              )}

              {renderBlocks
                .filter((b) => !hiddenBlockIds.has(b.id))
                .filter((b) => selfMode === 'show' || b.kind === 'question' || !isSelfBlock(b))
                .map((block, idx, arr) => renderBlock(block, idx > 0 ? arr[idx - 1] : null, idx, arr))}
              {renderPending()}

              {phase === 'recording' && (
                <InterimLine>
                  <InterimDot />
                  {interimText || t('page.interim.listening')}
                </InterimLine>
              )}
            </Transcript>

            {phase !== 'prepared' && (
              <ManualQuestionBar>
                <ManualQuestionInput
                  placeholder={t('page.manualQuestion.placeholder', '직접 질문을 입력하세요 (어떤 언어든 OK — 회의언어로 자동 번역됩니다)') as string}
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyDown={(e) => {
                    // nativeEvent.isComposing 으로 IME 조합 중 Enter 무시 (한글/일본어 입력)
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submitManualQuestion();
                    }
                  }}
                  disabled={manualSubmitting}
                />
                <ManualSubmitBtn
                  onClick={submitManualQuestion}
                  disabled={!manualInput.trim() || manualSubmitting}
                >
                  {manualSubmitting ? t('page.manualQuestion.submitting', '처리 중...') : t('page.manualQuestion.submit', '답변 생성')}
                </ManualSubmitBtn>
              </ManualQuestionBar>
            )}
          </>
        )}

        {phase === 'review' && activeSession && (
          <>
            <MainHeader>
              <HeaderLeft>
                {editingTitle ? (
                  <SessionTitleInput
                    defaultValue={activeSession.title}
                    autoFocus
                    onBlur={(e) => handleTitleSave(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleTitleSave(e.currentTarget.value); }
                      if (e.key === 'Escape') setEditingTitle(false);
                    }}
                  />
                ) : (
                  <SessionTitle onClick={() => setEditingTitle(true)} title={t('page.header.editTitleHint')}>
                    {activeSession.title}
                  </SessionTitle>
                )}
                <SessionMeta>
                  <Badge>{t('page.phase.review')}</Badge>
                  <Badge>{t('page.sessionUtteranceCount', { count: activeSession.utterance_count })}</Badge>
                </SessionMeta>
              </HeaderLeft>
              <HeaderRight>
                <SecondaryBtn>{t('page.reviewBar.summary')}</SecondaryBtn>
                <SecondaryBtn>{t('page.reviewBar.questions')}</SecondaryBtn>
              </HeaderRight>
            </MainHeader>

            <ParticipantBar>
              <ParticipantBarLabel>{t('page.participantBar.label', { count: (activeSession.participants?.length ?? 0) + 1 })}</ParticipantBarLabel>
              <ParticipantPill key="self">{t('page.participantBar.self')}</ParticipantPill>
              {(activeSession.participants || []).map((p, i) => (
                <ParticipantPill key={i}>
                  {p.name}
                  {p.role && <ParticipantPillRole>{p.role}</ParticipantPillRole>}
                </ParticipantPill>
              ))}
              <SelfModeGroup>
                <SelfModeLabel>{t('page.selfMode.label', '내 발화')}</SelfModeLabel>
                <SelfModeBtn $active={selfMode === 'skip'} onClick={() => setSelfMode('skip')} title={t('page.selfMode.skipTitle', '내 발화는 아예 처리 안 함 (가장 빠름)')}>{t('page.selfMode.skip', '처리 안 함')}</SelfModeBtn>
                <SelfModeBtn $active={selfMode === 'hide'} onClick={() => setSelfMode('hide')} title={t('page.selfMode.hideTitle', '내 발화는 녹음·저장하되 화면에서 숨김')}>{t('page.selfMode.hide', '숨김')}</SelfModeBtn>
                <SelfModeBtn $active={selfMode === 'show'} onClick={() => setSelfMode('show')} title={t('page.selfMode.showTitle', '내 발화도 다 보여줌')}>{t('page.selfMode.show', '보기')}</SelfModeBtn>
              </SelfModeGroup>
            </ParticipantBar>

            <Transcript>
              {renderBlocks.length === 0 && <EmptyTranscript>{t('page.reviewEmpty')}</EmptyTranscript>}
              {renderBlocks
                .filter((b) => !hiddenBlockIds.has(b.id))
                .filter((b) => selfMode === 'show' || b.kind === 'question' || !isSelfBlock(b))
                .map((block, idx, arr) => renderBlock(block, idx > 0 ? arr[idx - 1] : null, idx, arr))}
            </Transcript>

            <ManualQuestionBar>
              <ManualQuestionInput
                placeholder={t('page.manualQuestion.placeholder', '직접 질문을 입력하세요 (어떤 언어든 OK — 회의언어로 자동 번역됩니다)') as string}
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submitManualQuestion();
                  }
                }}
                disabled={manualSubmitting}
              />
              <ManualSubmitBtn
                onClick={submitManualQuestion}
                disabled={!manualInput.trim() || manualSubmitting}
              >
                {manualSubmitting ? t('page.manualQuestion.submitting', '처리 중...') : t('page.manualQuestion.submit', '답변 생성')}
              </ManualSubmitBtn>
            </ManualQuestionBar>
          </>
        )}
      </Main>

      <StartMeetingModal
        open={showStartModal && !editingSession}
        onClose={() => setShowStartModal(false)}
        onStart={handleStartMeeting}
      />

      <StartMeetingModal
        open={showStartModal && editingSession}
        editMode
        editingSessionId={activeSession?.id}
        initialConfig={activeSession ? {
          title: activeSession.title,
          brief: activeSession.brief || '',
          participants: (activeSession.participants || []).map((p) => ({ name: p.name, role: p.role || '' })),
          meetingLanguages: activeSession.meeting_languages || [],
          translationLanguage: activeSession.translation_language || '',
          answerLanguage: activeSession.answer_language || '',
          captureMode: activeSession.capture_mode || 'web_conference',
          pastedContext: activeSession.pasted_context || '',
          urls: [],
          priorityQAs: [],
          priorityQACsv: null,
          meetingAnswerStyle: activeSession.meeting_answer_style || '',
          meetingAnswerLength: (activeSession.meeting_answer_length as 'short'|'medium'|'long') || 'medium',
        } : undefined}
        onClose={() => { setShowStartModal(false); setEditingSession(false); }}
        onStart={handleSaveSessionEdit}
      />
    </Layout>
  );
};

export default QNotePage;

// ─────────────────────────────────────────────────────────
// SpeakerPopover — 발화 블록의 [화자 N ▾] 클릭 시 인라인 팝오버
//   참여자/나 선택 시 즉시 적용. 같은 이름/나가 이미 있으면 자동 병합.
// ─────────────────────────────────────────────────────────
interface ParticipantLite {
  name: string;
  role?: string | null;
}

interface SpeakerPopoverProps {
  currentSpeakerName: string | null;
  currentIsSelf: boolean | number;
  participants: ParticipantLite[];
  onClose: () => void;
  onAssignName: (name: string) => Promise<void>;
  onAssignSelf: () => Promise<void>;
  disabled: boolean;
}

const SpeakerPopover = ({ currentSpeakerName, currentIsSelf, participants, onClose, onAssignName, onAssignSelf, disabled }: SpeakerPopoverProps) => {
  const { t } = useTranslation('qnote');
  const [customName, setCustomName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = window.setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('click', onDocClick);
    };
  }, [onClose]);

  // 이미 지정된 화자 제외: 현재 블록의 화자 이름과 같은 참여자는 숨김
  const filteredParticipants = participants.filter(
    (p) => p.name !== currentSpeakerName
  );

  // "나" 버튼: 이미 "나"로 지정된 블록이면 숨김
  const showSelfBtn = !currentIsSelf;

  return (
    <PopoverWrap ref={ref} onClick={(e) => e.stopPropagation()}>
      <PopoverTitle>{t('page.popover.title')}</PopoverTitle>
      {showSelfBtn && (
        <PopoverBtn onClick={onAssignSelf} disabled={disabled} $primary>
          {t('page.popover.self')}
        </PopoverBtn>
      )}
      {filteredParticipants.length > 0 && (
        <>
          <PopoverDivider />
          <PopoverLabel>{t('page.popover.registered')}</PopoverLabel>
          {filteredParticipants.map((p) => (
            <PopoverBtn
              key={p.name}
              onClick={() => onAssignName(p.name)}
              disabled={disabled}
            >
              {p.name}
              {p.role && <PopoverRole>{p.role}</PopoverRole>}
            </PopoverBtn>
          ))}
        </>
      )}
      {!showSelfBtn && filteredParticipants.length === 0 && (
        <PopoverHint>{t('page.popover.hintRegister')}</PopoverHint>
      )}
      <PopoverDivider />
      <PopoverLabel>{t('page.popover.custom')}</PopoverLabel>
      <PopoverInputRow>
        <PopoverInput
          type="text"
          placeholder={t('page.popover.namePlaceholder')}
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customName.trim()) {
              onAssignName(customName.trim());
            }
          }}
          disabled={disabled}
          autoFocus
        />
        <PopoverInputBtn
          onClick={() => customName.trim() && onAssignName(customName.trim())}
          disabled={disabled || !customName.trim()}
        >
          {t('page.popover.save')}
        </PopoverInputBtn>
      </PopoverInputRow>
    </PopoverWrap>
  );
};

const PopoverWrap = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  min-width: 200px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const PopoverTitle = styled.div`
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  padding: 4px 8px 2px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const PopoverLabel = styled.div`
  font-size: 10px;
  font-weight: 600;
  color: #94a3b8;
  padding: 2px 8px;
`;

const PopoverHint = styled.div`
  font-size: 11px;
  color: #94a3b8;
  padding: 6px 8px;
  line-height: 1.4;
`;

const PopoverDivider = styled.div`
  height: 1px;
  background: #f1f5f9;
  margin: 4px 0;
`;

const PopoverBtn = styled.button<{ $primary?: boolean }>`
  text-align: left;
  font-size: 13px;
  font-weight: ${(p) => (p.$primary ? 700 : 500)};
  color: ${(p) => (p.$primary ? '#0d9488' : '#0f172a')};
  background: ${(p) => (p.$primary ? '#f0fdfa' : 'transparent')};
  border: 1px solid ${(p) => (p.$primary ? '#99f6e4' : 'transparent')};
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  &:hover:not(:disabled) { background: ${(p) => (p.$primary ? '#ccfbf1' : '#f8fafc')}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const PopoverRole = styled.span`
  font-size: 10px;
  font-weight: 500;
  color: #94a3b8;
`;

const PopoverInputRow = styled.div`
  display: flex;
  gap: 4px;
  padding: 0 4px 4px;
`;

const PopoverInput = styled.input`
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  outline: none;
  color: #0f172a;
  &:focus { border-color: #14b8a6; }
  &:disabled { background: #f1f5f9; }
`;

const PopoverInputBtn = styled.button`
  font-size: 11px;
  font-weight: 600;
  padding: 6px 10px;
  background: #0d9488;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  &:hover:not(:disabled) { background: #0f766e; }
  &:disabled { background: #cbd5e1; cursor: not-allowed; }
`;

// ─────────────────────────────────────────────────────────
// PRIMARY: #14B8A6 #0D9488 #115E59 #F0FDFA #CCFBF1 #99F6E4
// POINT:   #F43F5E #E11D48 #FFF1F2 #FFE4E6 #FECDD3 #9F1239
// NEUTRAL: #FFFFFF #F8FAFC #F1F5F9 #E2E8F0 #CBD5E1 #94A3B8 #64748B #334155 #0F172A
// ─────────────────────────────────────────────────────────

const Layout = styled.div<{ $collapsed: boolean }>`
  display: grid;
  grid-template-columns: ${(p) => (p.$collapsed ? '0px 1fr' : '300px 1fr')};
  /* 모바일/태블릿은 상단 56px 헤더, 데스크탑은 헤더 없음 */
  height: 100vh;
  @media (max-width: 1024px) { height: calc(100vh - 56px); }
  background: #FFFFFF;
  transition: grid-template-columns 200ms ease;
  position: relative;
  @media (max-width: 1024px) {
    display: block;
  }
`;

const Sidebar = styled.aside<{ $collapsed: boolean }>`
  background: #ffffff;
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateX(${(p) => (p.$collapsed ? '-100%' : '0')});
  transition: transform 200ms ease;
  visibility: ${(p) => (p.$collapsed ? 'hidden' : 'visible')};
  @media (max-width: 1024px) {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 300px;
    max-width: 85vw;
    z-index: 30;
    box-shadow: 4px 0 16px rgba(15, 23, 42, 0.12);
  }
`;

const SidebarBackdrop = styled.div`
  display: none;
  @media (max-width: 1024px) {
    display: block;
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.35);
    z-index: 25;
  }
`;

const SidebarHeader = styled.div`
  padding: 14px 20px;
  min-height: 60px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #F1F5F9;
`;

const SidebarTitle = styled.h1`
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.2px;
`;

const NewSessionBtn = styled.button`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: #64748B;
  cursor: pointer;
  transition: all 0.1s;
  padding: 0;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;

const SearchWrap = styled.div`
  padding: 12px 20px 12px;
  border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
`;

const SessionList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 6px 10px 12px;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 3px; }
`;

const EmptySessionMsg = styled.div`
  padding: 32px 20px;
  text-align: center;
  color: #94A3B8;
  font-size: 12px;
`;

const SessionItem = styled.div<{ $active: boolean }>`
  padding: 10px 12px;
  margin: 2px 0;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.1s;
  background: ${(p) => (p.$active ? '#F0FDFA' : 'transparent')};
  ${(p) => p.$active && 'box-shadow: inset 3px 0 0 #0D9488;'}
  &:hover {
    ${(p) => !p.$active && 'background: #F8FAFC;'}
  }
`;

const SessionItemRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
`;

const SessionItemTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #0F172A;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
`;

const SessionStatusBadge = styled.span`
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  padding: 2px 8px;
  white-space: nowrap;
`;

const SessionParticipants = styled.span`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
`;

const SessionItemMeta = styled.div`
  font-size: 11px;
  color: #94A3B8;
  display: flex;
  gap: 6px;
  align-items: center;
`;

const Dot = styled.span`
  color: #cbd5e1;
`;

const Main = styled.section`
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #FFFFFF;
  @media (max-width: 900px) {
    height: 100%;
  }
`;

/* Q Note 사이드바(세션 리스트) 접기 — Q Talk/Secondary 와 동일한 엣지 바 디자인 */
const CollapseToggle = styled.button`
  position: absolute;
  top: 50%;
  left: 0;
  transform: translate(-50%, -50%);
  width: 8px; height: 60px;
  padding: 0; border: none;
  background: #CBD5E1;
  border-radius: 4px;
  cursor: pointer;
  z-index: 10;
  box-shadow: 0 1px 3px rgba(15,23,42,0.08);
  transition: width 0.15s ease, height 0.15s ease, background 0.15s ease;
  display: flex; align-items: center; justify-content: center;
  &::before { content: ''; position: absolute; top: -10px; bottom: -10px; left: -8px; right: -8px; }
  &:hover { width: 14px; height: 72px; background: #14B8A6; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const SidebarToggleChevron = styled.span`
  display: flex; align-items: center; justify-content: center;
  color: #64748B;
  svg { width: 10px; height: 10px; }
  ${CollapseToggle}:hover & { color: #FFFFFF; }
`;

const MainHeader = styled.div`
  padding: 14px 20px;
  min-height: 60px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  position: relative;
  @media (max-width: 768px) {
    padding: 10px 16px;
    min-height: 48px;
    gap: 8px;
  }
`;

/* 수평 엣지 바 — Q Note 헤더 높이 접기 (Q Talk 세로 엣지 바와 같은 디자인, 방향만 가로) */
const HeaderEdgeHandle = styled.button`
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translate(-50%, 50%);
  width: 60px; height: 8px;
  padding: 0; border: none;
  background: #CBD5E1;
  border-radius: 4px;
  cursor: pointer;
  z-index: 10;
  box-shadow: 0 1px 3px rgba(15,23,42,0.08);
  transition: width 0.15s ease, height 0.15s ease, background 0.15s ease;
  display: flex; align-items: center; justify-content: center;
  &::before { content: ''; position: absolute; top: -8px; bottom: -8px; left: -10px; right: -10px; }
  &:hover { width: 72px; height: 14px; background: #14B8A6; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const HeaderEdgeChevron = styled.span`
  display: flex; align-items: center; justify-content: center;
  color: #64748B;
  svg { width: 10px; height: 10px; }
  ${HeaderEdgeHandle}:hover & { color: #FFFFFF; }
`;

const CollapsedHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  padding: 4px 16px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  min-height: 36px;
`;

const CollapsedTitle = styled.h2`
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  margin: 0;
  cursor: text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
  &:hover { color: #475569; }
`;

const CollapsedSpacer = styled.div`
  flex: 1;
`;

const BtnLabel = styled.span`
  @media (max-width: 768px) {
    display: none;
  }
`;

const IconBtn = styled.button<{ $primary?: boolean; $danger?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: ${(p) => p.$primary ? '#14b8a6' : '#ffffff'};
  color: ${(p) => p.$primary ? '#ffffff' : p.$danger ? '#9f1239' : '#475569'};
  border: 1px solid ${(p) => p.$primary ? 'transparent' : p.$danger ? '#fecdd3' : '#e2e8f0'};
  border-radius: 8px;
  cursor: pointer;
  &:hover {
    background: ${(p) => p.$primary ? '#0d9488' : p.$danger ? '#fff1f2' : '#f0fdfa'};
    border-color: ${(p) => p.$primary ? 'transparent' : p.$danger ? '#f43f5e' : '#14b8a6'};
    color: ${(p) => p.$primary ? '#ffffff' : p.$danger ? '#9f1239' : '#0d9488'};
  }
`;

const HeaderLeft = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  flex-wrap: nowrap;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
`;

const HeaderRight = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
`;

const SessionTitle = styled.h2`
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  cursor: text;
  &:hover { color: #475569; }
`;

const SessionTitleInput = styled.input`
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  border: 1px solid #14b8a6;
  border-radius: 4px;
  padding: 0 4px;
  outline: none;
  background: #f0fdfa;
  min-width: 200px;
  &:focus { border-color: #0d9488; }
`;

const SessionMeta = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  background: #f1f5f9;
  color: #475569;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
`;

const RecordingIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px;
  background: #f0fdfa;
  color: #0f766e;
  border: 1px solid #99f6e4;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  @media (max-width: 768px) {
    width: 36px;
    padding: 0;
    justify-content: center;
    gap: 0;
  }
`;

const RecordDot = styled.span`
  width: 8px;
  height: 8px;
  background: #0d9488;
  border-radius: 50%;
  animation: pulse 1.6s ease-in-out infinite;
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.85); }
  }
`;

const compactResponsive = `
  @media (max-width: 768px) {
    width: 36px;
    padding: 0;
    gap: 0;
  }
`;

const PrimaryBtn = styled.button<{ $compact?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 18px;
  background: #14b8a6;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  &:hover { background: #0d9488; }
  ${(p) => p.$compact ? compactResponsive : ''}
`;

const SecondaryBtn = styled.button<{ $compact?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  background: #ffffff;
  color: #0d9488;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  &:hover {
    background: #f0fdfa;
    border-color: #14b8a6;
  }
  ${(p) => p.$compact ? compactResponsive : ''}
`;

const DangerBtn = styled.button<{ $compact?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  background: #ffffff;
  color: #9f1239;
  border: 1px solid #fecdd3;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  &:hover {
    background: #fff1f2;
    border-color: #f43f5e;
  }
  ${(p) => p.$compact ? compactResponsive : ''}
`;

const ParticipantBar = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 4px 32px 0;
  padding: 4px 10px;
  background: #f8fafc;
  border-radius: 6px;
  font-size: 12px;
`;

const ReadinessPanel = styled.div<{ $ready: boolean; $collapsed: boolean }>`
  margin: ${(p) => (p.$collapsed ? '6px 32px 0' : '12px 32px 0')};
  padding: ${(p) => (p.$collapsed ? '6px 12px' : '14px 18px')};
  background: ${(p) => (p.$ready ? '#f0fdfa' : '#fffbeb')};
  border: 1px solid ${(p) => (p.$ready ? '#99f6e4' : '#fde68a')};
  border-left: 3px solid ${(p) => (p.$ready ? '#0d9488' : '#f59e0b')};
  border-radius: ${(p) => (p.$collapsed ? '6px' : '10px')};
  cursor: ${(p) => (p.$ready ? 'pointer' : 'default')};
  transition: all 0.15s ease;
  &:hover {
    ${(p) => p.$ready && 'background: #ccfbf1;'}
  }
`;

const ReadinessHeader = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: ${(p) => (p.$collapsed ? '12px' : '13px')};
  font-weight: 700;
  color: #0f172a;
  margin-bottom: ${(p) => (p.$collapsed ? '0' : '10px')};
`;

const ReadinessToggleHint = styled.span`
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
`;

const ReadinessDot = styled.span<{ $ready: boolean }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(p) => (p.$ready ? '#0d9488' : '#f59e0b')};
  ${(p) => !p.$ready && 'animation: pulse 1.2s ease-in-out infinite;'}
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
`;

const ReadinessGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
`;

const ReadinessItem = styled.div`
  padding: 8px 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
`;

const ReadinessLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  margin-bottom: 3px;
`;

const ReadinessValue = styled.div<{ $ok: boolean }>`
  font-size: 13px;
  font-weight: 600;
  color: ${(p) => (p.$ok ? '#0d9488' : '#d97706')};
  display: flex;
  align-items: center;
  gap: 6px;
`;

const FailedBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 700;
  color: #ffffff;
  background: #dc2626;
  border-radius: 3px;
`;

const ReadinessHint = styled.div`
  margin-top: 10px;
  font-size: 11px;
  color: #64748b;
  line-height: 1.5;
`;

const ParticipantBarLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  letter-spacing: 0.03em;
`;

const SelfModeGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding-left: 8px;
  border-left: 1px solid #e2e8f0;
`;

const SelfModeLabel = styled.span`
  font-size: 11px;
  color: #64748b;
  margin-right: 4px;
`;

const SelfModeBtn = styled.button<{ $active?: boolean }>`
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid ${(p) => (p.$active ? '#0d9488' : '#e2e8f0')};
  background: ${(p) => (p.$active ? '#0d9488' : '#ffffff')};
  color: ${(p) => (p.$active ? '#ffffff' : '#64748b')};
  cursor: pointer;
  white-space: nowrap;
  transition: all 120ms;
  &:hover {
    border-color: ${(p) => (p.$active ? '#0f766e' : '#cbd5e1')};
  }
`;

const ParticipantPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: #115e59;
  background: #f0fdfa;
  border: 1px solid #ccfbf1;
  border-radius: 12px;
  padding: 3px 10px;
`;

const ParticipantPillRole = styled.span`
  font-size: 10px;
  font-weight: 400;
  color: #64748b;
`;

const ErrorBar = styled.div`
  margin: 12px 32px 0;
  padding: 10px 14px;
  background: #fff1f2;
  color: #9f1239;
  border: 1px solid #fecdd3;
  border-radius: 8px;
  font-size: 13px;
`;

const LockBar = styled.div`
  margin: 12px 32px 0;
  padding: 10px 14px;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
  border-radius: 8px;
  font-size: 13px;
`;

const NoticeBar = styled.div`
  margin: 12px 32px 0;
  padding: 10px 14px;
  background: #f0fdfa;
  color: #0f766e;
  border: 1px solid #99f6e4;
  border-radius: 8px;
  font-size: 13px;
  animation: fadeOut 4s forwards;
  @keyframes fadeOut {
    0%, 70% { opacity: 1; }
    100% { opacity: 0; visibility: hidden; }
  }
`;

const Transcript = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px 120px;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const EmptyTranscript = styled.div`
  padding: 48px 24px;
  text-align: center;
  color: #94a3b8;
  font-size: 14px;
  line-height: 1.6;
`;

// ─── 직접 질문 입력 바 ─────────────────────────────
const ManualQuestionBar = styled.div`
  display: flex;
  gap: 8px;
  align-items: stretch;
  margin: 0 32px 16px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
`;

const ManualQuestionInput = styled.input`
  flex: 1;
  border: none;
  outline: none;
  font-size: 13px;
  padding: 8px 10px;
  color: #0f172a;
  background: transparent;
  &::placeholder { color: #94a3b8; }
  &:disabled { opacity: 0.6; }
`;

const ManualSubmitBtn = styled.button`
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  background: #F43F5E;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease;
  &:hover:not(:disabled) { background: #E11D48; }
  &:disabled {
    background: #cbd5e1;
    cursor: not-allowed;
  }
`;

// ─── Speech 블록 (평문 transcript) ────────────────
const SpeechBlockWrap = styled.div<{ $dimmed?: boolean }>`
  display: flex;
  align-items: baseline;
  gap: 0;
  opacity: ${(p) => (p.$dimmed ? 0.45 : 1)};
`;

const SpeechTextCol = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const SpeakerInline = styled.span<{ $self: boolean }>`
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 700;
  color: ${(p) => (p.$self ? '#0d9488' : '#6366f1')};
  margin-right: 6px;
`;

const SpeechRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
`;

const InlineTime = styled.span`
  font-size: 11px;
  color: #cbd5e1;
  white-space: nowrap;
  flex-shrink: 0;
`;

const SpeakerAssignWrap = styled.span`
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  margin-right: 8px;
`;

const SpeakerAssignBtn = styled.button`
  font-size: 11px;
  color: #94a3b8;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
  padding: 2px 6px;
  white-space: nowrap;
  &:hover { color: #0d9488; border-color: #99f6e4; background: #f0fdfa; }
`;

const BlockHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 2px;
`;

const BlockSpeaker = styled.span<{ $clickable?: boolean }>`
  font-size: 12px;
  font-weight: 700;
  color: #0d9488;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: ${(p) => (p.$clickable ? '3px 7px' : '0')};
  border-radius: 6px;
  background: ${(p) => (p.$clickable ? '#f0fdfa' : 'transparent')};
  border: ${(p) => (p.$clickable ? '1px solid #99f6e4' : 'none')};
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  transition: background 120ms, border-color 120ms;

  &:hover {
    ${(p) => p.$clickable && 'background: #ccfbf1; border-color: #5eead4;'}
  }
`;

const BlockTime = styled.span`
  font-size: 11px;
  color: #94a3b8;
`;

const SpeechOriginal = styled.div`
  font-size: 15px;
  color: #0f172a;
  line-height: 1.65;
  word-break: break-word;
`;

const SpeechTranslation = styled.div`
  font-size: 13px;
  color: #64748b;
  line-height: 1.55;
  word-break: break-word;
`;

// ─── 질문 카드 — 좌측 화자열 + 우측 본문열 (원문·번역·답변 동일 좌측정렬) ─
const QuestionCard = styled.div`
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 10px;
  background: #ffffff;
  border: 1px solid #fecdd3;
  border-left: 4px solid #f43f5e;
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: 0 1px 3px rgba(244, 63, 94, 0.06);
`;

const QuestionLeadCol = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding-top: 2px;
`;

const QuestionBodyCol = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const QuestionTopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const QuestionTopActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
`;

const CollapseBtn = styled.button`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  background: #ffffff;
  color: #64748b;
  border: 1px solid #e2e8f0;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 120ms;
  &:hover { background: #f8fafc; color: #475569; border-color: #cbd5e1; }
`;

const QuestionOriginal = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.55;
  word-break: break-word;
  flex: 1;
`;

const QuestionEditInput = styled.input`
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.55;
  flex: 1;
  border: 1px solid #f43f5e;
  border-radius: 4px;
  padding: 2px 6px;
  outline: none;
  background: #fff1f2;
  &:focus { border-color: #e11d48; }
`;

const EditedMark = styled.span`
  font-size: 11px;
  font-weight: 400;
  color: #f43f5e;
  margin-left: 6px;
`;

const ManualBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  color: #ffffff;
  background: #F43F5E;
  border-radius: 10px;
  letter-spacing: 0.03em;
  margin-right: 6px;
  flex-shrink: 0;
`;

const MergeNextBtn = styled.button`
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid #fecdd3;
  background: #fff1f2;
  color: #f43f5e;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  &:hover { background: #fecdd3; }
`;

const UnmergeBtn = styled.button`
  flex-shrink: 0;
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  line-height: 1;
  &:hover { background: #f8fafc; color: #475569; border-color: #cbd5e1; }
`;

const MergedBadge = styled.span`
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 700;
  color: #9f1239;
  background: #ffe4e6;
  border-radius: 4px;
  vertical-align: middle;
`;

const QuestionTranslation = styled.div`
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
  word-break: break-word;
`;

// TranslationPending 제거 — 번역이 없으면 영역 자체를 숨김 (placeholder 대신)

const PendingHint = styled.span`
  color: #cbd5e1;
  font-style: italic;
`;

const FindAnswerBtn = styled.button<{ $ready?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  background: ${(p) => (p.$ready ? '#e11d48' : '#f43f5e')};
  color: #ffffff;
  border: none;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms;
  ${(p) => p.$ready && 'animation: pulse-ready 1.5s ease-in-out 2;'}
  &:hover:not(:disabled) { background: #e11d48; }
  &:disabled {
    background: #fecdd3;
    cursor: not-allowed;
  }
  @keyframes pulse-ready {
    0%, 100% { box-shadow: none; }
    50% { box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.3); }
  }
`;

// ─── 답변 표시 패널 ─────
const AnswerPanel = styled.div`
  margin-top: 8px;
  padding: 10px 12px;
  background: #fefce8;
  border: 1px solid #fef08a;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const AnswerTierBadge = styled.span<{ $tier: string }>`
  font-size: 10px;
  font-weight: 700;
  color: ${(p) =>
    p.$tier === 'priority' ? '#f43f5e' :
    p.$tier === 'custom' ? '#15803d' :
    p.$tier === 'session_reuse' ? '#0891b2' :
    p.$tier === 'generated' ? '#1d4ed8' :
    p.$tier === 'rag' ? '#9333ea' :
    p.$tier === 'none' ? '#94a3b8' : '#64748b'};
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const AnswerText = styled.div`
  font-size: 14px;
  color: #0f172a;
  line-height: 1.6;
  white-space: pre-wrap;
`;

const AnswerTranslation = styled.div`
  font-size: 13px;
  color: #64748b;
  line-height: 1.55;
  border-top: 1px solid #fef08a;
  padding-top: 6px;
  margin-top: 2px;
`;

const AnswerLoading = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: #94a3b8;
  font-style: italic;
`;

const AnswerError = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: #dc2626;
`;


// ─── Pending (미완성 문장) 렌더 — 유령 블록 ─────
const PendingBlockWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  opacity: 0.55;
`;

const PendingOriginal = styled.div`
  font-size: 15px;
  color: #475569;
  line-height: 1.65;
  font-style: italic;
  word-break: break-word;
  &::after {
    content: ' …';
    color: #cbd5e1;
  }
`;

// ─── 라이브 interim 라인 ──────────────────────────
const InterimLine = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: #94a3b8;
  font-style: italic;
  padding: 4px 0;
`;

const InterimDot = styled.span`
  width: 6px;
  height: 6px;
  background: #cbd5e1;
  border-radius: 50%;
  animation: blink 1.2s ease-in-out infinite;
  @keyframes blink {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
`;

