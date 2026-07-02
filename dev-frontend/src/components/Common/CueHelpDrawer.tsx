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
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { formatDate } from '../../utils/dateFormat';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { mapApiError } from '../../utils/apiError';
import { fetchWikiContext, fetchWikiCategories, type WikiArticleSummary, type WikiCategory } from '../../services/wiki';

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

interface Turn {
  q: string;
  a: string;
  loading?: boolean;
  error?: string;
  sources?: Array<{ slug: string; title: string }>;  // Q위키 RAG 근거 article
  logId?: number | null;                              // KNOWLEDGE_LOOP 축2 — 피드백 대상 로그
  feedback?: 'helpful' | 'not_helpful';               // 제출된 피드백 (재클릭 차단)
}

// N+93 — standalone: /help-popout 분리 창에서 풀윈도우로 마운트 (FAB/백드롭 없음, 항상 open, 닫기=window.close).
const CueHelpDrawer: React.FC<{ standalone?: boolean }> = ({ standalone = false }) => {
  const { t } = useTranslation('common');
  const { t: tErr } = useTranslation('errors');
  const { t: tw } = useTranslation('wiki');
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();
  const isGuest = !user;
  const tz = (user as { workspace_timezone?: string } | null)?.workspace_timezone || 'Asia/Seoul';
  // N+93 — 비즈니스 멤버는 RightDock 통합 런처가 Q helper 진입을 제공 → 자체 floating FAB 숨김.
  // 게스트/Client 는 런처가 없으므로 기존 floating FAB 유지.
  const dockManaged = !!user?.business_id && ['owner', 'admin', 'member'].includes(user.business_role || '');
  const [open, setOpen] = useState(standalone); // standalone(/help-popout)은 항상 열림으로 시작
  const [mode, setMode] = useState<Mode>('workspace'); // N+93 — 첫 탭(워크스페이스 안내)이 디폴트 (Irene)
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [submitting, setSubmitting] = useState(false);
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
  const [fbAttachments, setFbAttachments] = useState<Array<{ name: string; type: string; dataUrl: string }>>([]);
  const [fbAttachError, setFbAttachError] = useState<string | null>(null);

  // 문의 모드 폼 상태 (게스트 전용 — 랜딩 /contact 와 동일 백엔드)
  const [inqName, setInqName] = useState('');
  const [inqEmail, setInqEmail] = useState('');
  const [inqMessage, setInqMessage] = useState('');
  const [inqResultMsg, setInqResultMsg] = useState<string | null>(null);

  // Q위키 탭 — 현재 화면 맥락 article + 카테고리 칩
  const [wikiContext, setWikiContext] = useState<WikiArticleSummary[]>([]);
  const [wikiCats, setWikiCats] = useState<WikiCategory[]>([]);

  // Q위키 article / 전체 위키로 이동 (드로어 닫고 라우팅, standalone 은 그대로)
  const openWikiPath = useCallback((path: string) => {
    navigate(path);
    if (!standalone) setOpen(false);
  }, [navigate, standalone]);

  // 게스트가 잘못된 모드로 떨어지지 않게 보정
  useEffect(() => {
    if (isGuest && (mode === 'workspace' || mode === 'feedback')) {
      setMode('qhelper');
    }
  }, [isGuest, mode]);

  // N+93 — 통합 런처(RightDock)에서 Q helper 선택 시 오픈 (qhelper 모드로 진입)
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent).detail?.tool === 'qhelper') { setMode('workspace'); setOpen(true); }
    };
    window.addEventListener('planq:open-tool', onOpen as EventListener);
    return () => window.removeEventListener('planq:open-tool', onOpen as EventListener);
  }, []);

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
    fetchWikiCategories().then((c) => { if (!cancelled) setWikiCats(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [mode, wikiCats.length]);

  // Q위키 탭 — 현재 화면 맥락 article (로그인 사용자만, path 바뀌면 갱신)
  useEffect(() => {
    if (mode !== 'qhelper' || isGuest || !open) { return; }
    let cancelled = false;
    fetchWikiContext(location.pathname)
      .then((arts) => { if (!cancelled) setWikiContext(arts); })
      .catch(() => { if (!cancelled) setWikiContext([]); });
    return () => { cancelled = true; };
  }, [mode, isGuest, open, location.pathname]);

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

  // cue:ask 이벤트 listen — detail.tab 으로 진입 탭 결정 ('wiki' → Q위키, 'cue' → Cue)
  useEffect(() => {
    const onAsk = (e: Event) => {
      const ce = e as CustomEvent<{ prefill?: string; tab?: 'wiki' | 'cue' }>;
      const prefill = ce.detail?.prefill || '';
      const tab = ce.detail?.tab;
      if (tab === 'wiki') setMode('qhelper');
      else if (tab === 'cue' && !isGuest) setMode('workspace');
      setOpen(true);
      if (prefill) setInput(prefill);
    };
    window.addEventListener('cue:ask', onAsk as EventListener);
    return () => window.removeEventListener('cue:ask', onAsk as EventListener);
  }, [isGuest]);

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

  const submit = useCallback(async () => {
    const q = input.trim();
    if (!q || submitting) return;
    setSubmitting(true);
    const turn: Turn = { q, a: '', loading: true };
    setTurns(prev => [...prev.slice(-4), turn]); // 최근 5턴 유지
    setInput('');
    try {
      // 게스트는 auth 없는 public 라우트 (마케팅 비용 — 워크스페이스 사용량 미차감)
      // 로그인 사용자는 apiFetch (토큰 자동 추가 + 401 시 refresh)
      const url = isGuest ? '/api/cue/help-public' : '/api/cue/help';
      const body = isGuest
        ? { question: q }
        : {
            question: q,
            mode,
            page_context: { path: location.pathname, search: location.search || undefined },
          };
      const fetcher = isGuest ? fetch : apiFetch;
      const res = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        const msg = j.message === 'rate_limit_minute' ? t('qhelper.rateLimitMinute', '잠깐만요 — 너무 빠르게 묻고 있어요. 1분 후 다시 시도해주세요.')
          : j.message === 'rate_limit_day' ? t('qhelper.rateLimitDay', '오늘 안내 횟수를 초과했습니다. 자세한 내용은 문의 남기기 탭으로 알려주세요.')
          : (j.message || 'Q helper error');
        throw new Error(msg as string);
      }
      const srcs = Array.isArray(j.data?.sources) ? j.data.sources : [];
      setTurns(prev => prev.map((tn, i) => i === prev.length - 1 ? { ...tn, a: j.data.answer || '', loading: false, sources: srcs, logId: j.data.log_id ?? null } : tn));
    } catch (e) {
      setTurns(prev => prev.map((tn, i) => i === prev.length - 1
        ? { ...tn, error: mapApiError(e, tErr), loading: false }
        : tn));
    } finally {
      setSubmitting(false);
    }
  }, [input, submitting, location, isGuest, mode, t]);

  // KNOWLEDGE_LOOP 축2 — 답변 피드백 (낙관적 표시, 실패 무해)
  const sendAnswerFeedback = useCallback(async (turnIdx: number, feedback: 'helpful' | 'not_helpful') => {
    const turn = turns[turnIdx];
    if (!turn || turn.logId == null || turn.feedback) return;
    setTurns(prev => prev.map((tn, i) => i === turnIdx ? { ...tn, feedback } : tn));
    try {
      const fetcher = isGuest ? fetch : apiFetch;
      await fetcher('/api/cue/help-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log_id: turn.logId, feedback }),
      });
    } catch { /* 피드백 실패는 조용히 무시 */ }
  }, [turns, isGuest]);

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
    try {
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: fbCategory,
          priority: fbPriority,
          title: (fbBody.trim().split('\n')[0] || '').slice(0, 60) || '(제목 없음)',
          body: fbBody.trim(),
          page_url: location.pathname + (location.search || ''),
          attachments: fbAttachments.length > 0 ? fbAttachments : null,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.message || 'feedback error');
      setFbResultMsg(t('qhelper.fbThanks', '접수됐습니다 #{{id}} — 빠르게 검토할게요', { id: j.data?.id }) as string);
      setFbBody('');
      setFbCategory('improve');
      setFbPriority('normal');
      setFbAttachments([]);
      setFbAttachError(null);
      window.setTimeout(() => setFbResultMsg(null), 6000);
    } catch (e) {
      setFbResultMsg(t('qhelper.fbErr', '제출 실패: {{msg}}', { msg: mapApiError(e, tErr) }) as string);
    } finally {
      setSubmitting(false);
    }
  }, [fbCategory, fbPriority, fbBody, fbAttachments, submitting, location, t]);

  // N+63 — 피드백 이미지 첨부 (1MB cap, 최대 3개, image only). base64 dataUrl.
  const onFbFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';  // 같은 파일 재선택 가능
    setFbAttachError(null);
    if (fbAttachments.length + files.length > 3) {
      setFbAttachError(t('qhelper.fbAttachMax', '최대 3개까지 첨부 가능') as string);
      return;
    }
    for (const f of files) {
      if (!f.type.startsWith('image/')) {
        setFbAttachError(t('qhelper.fbAttachImageOnly', '이미지만 첨부 가능') as string);
        return;
      }
      if (f.size > 1024 * 1024) {
        setFbAttachError(t('qhelper.fbAttachTooBig', '파일당 1MB 이하', { name: f.name }) as string);
        return;
      }
    }
    try {
      const reads = await Promise.all(files.map(f => new Promise<{ name: string; type: string; dataUrl: string }>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res({ name: f.name, type: f.type, dataUrl: String(reader.result) });
        reader.onerror = rej;
        reader.readAsDataURL(f);
      })));
      setFbAttachments(prev => [...prev, ...reads]);
    } catch {
      setFbAttachError(t('qhelper.fbAttachReadFail', '파일 읽기 실패') as string);
    }
  }, [fbAttachments, t]);
  const removeFbAttachment = useCallback((idx: number) => {
    setFbAttachments(prev => prev.filter((_, i) => i !== idx));
  }, []);

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
      {!standalone && !open && !fabHidden && !dockManaged && !isLoading && (
        <FloatingTrigger
          type="button"
          onClick={() => { setMode(isGuest ? 'qhelper' : 'workspace'); setOpen(true); }}
          aria-label={t('qhelper.openFloating', 'Q helper — 사용 안내 + 피드백') as string}
          title={t('qhelper.openFloating', 'Q helper — 사용 안내 + 피드백') as string}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </FloatingTrigger>
      )}
      {open && <>
      {!standalone && <Backdrop onClick={() => setOpen(false)} />}
      <Drawer ref={drawerRef} $standalone={standalone} role="dialog" aria-label={t('qhelper.title', 'Q helper') as string}>
        <Header>
          <HeaderTitle>
            {/* N+93 — 타이틀은 탭과 무관하게 항상 'Q helper' 고정 (Irene). Sparkle 도 항상 민트. */}
            <Sparkle aria-hidden $cue={false}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
            </Sparkle>
            <span>
              {isGuest ? t('qhelper.guestTitle', 'PlanQ 안내') : t('qhelper.title', 'Q helper')}
            </span>
          </HeaderTitle>
          <HeaderActions>
            {/* N+93 — 피드백 보내기는 상단 빨간 버튼으로 유지 (Irene). 탭은 3개(워크스페이스/PlanQ안내/문의). */}
            {!isGuest && mode !== 'feedback' && (
              <FeedbackEnter type="button" onClick={() => setMode('feedback')}>
                {t('qhelper.openFeedbackBtn', '피드백 보내기')}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </FeedbackEnter>
            )}
            {!isGuest && mode === 'feedback' && (
              <BackToGuide type="button" onClick={() => setMode('qhelper')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                {t('qhelper.backToGuide', '안내로 돌아가기')}
              </BackToGuide>
            )}
            <CloseBtn type="button" onClick={closeDrawer} aria-label={t('close', '닫기') as string}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </CloseBtn>
          </HeaderActions>
        </Header>
        {mode !== 'feedback' && !isGuest && (
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
        {isGuest && (
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
        {mode === 'qhelper' && turns.length === 0 && (
          <WikiPanel>
            {!isGuest && wikiContext.length > 0 && (
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
                    : isGuest ? t('qhelper.guestEmptyTitle', 'PlanQ, 무엇이든 물어보세요')
                    : t('qhelper.emptyTitle', '무엇이 궁금한가요?')}
                </EmptyTitle>
                <EmptyHint>
                  {mode === 'workspace'
                    ? t('qhelper.cueEmptyHint', '현재 워크스페이스의 고객·업무·일정·회의를 기반으로 답변합니다. 다른 워크스페이스 데이터는 보지 않습니다.')
                    : isGuest
                      ? t('qhelper.guestEmptyHint', 'PlanQ 의 기능·가격·도입 효과를 편하게 물어보세요. 사람에게 직접 묻고 싶으면 "문의 남기기" 탭으로 이동하세요.')
                      : t('qhelper.emptyHint', 'PlanQ 의 사용법·기능을 자연어로 물어보세요. 현재 화면 컨텍스트를 읽고 답변합니다.')}
                </EmptyHint>
                {!isGuest && (
                  <EmptyShortcut>
                    <kbd>⌘</kbd> <kbd>?</kbd> {t('qhelper.toggleHint', '로 언제든 열고 닫기')}
                  </EmptyShortcut>
                )}
              </Empty>
            ) : (
              turns.map((tn, i) => (
                <TurnRow key={i}>
                  <Q>
                    <QuLabel>{t('qhelper.you', '나')}</QuLabel>
                    <QText>{tn.q}</QText>
                  </Q>
                  <A $variant="qhelper">
                    <ALabel $variant="qhelper">
                      {mode === 'workspace' ? t('qhelper.cueLabel', 'Cue') : t('qhelper.guideLabel', 'Q helper')}
                    </ALabel>
                    {tn.loading
                      ? <Loading>{t('qhelper.thinking', '생각 중…')}</Loading>
                      : tn.error
                        ? <ErrorText>{tn.error}</ErrorText>
                        : <Answer>{tn.a}</Answer>}
                    {mode === 'qhelper' && !tn.loading && !tn.error && tn.sources && tn.sources.length > 0 && (
                      <Sources>
                        <SourcesLabel>{tw('drawer.sources')}</SourcesLabel>
                        {tn.sources.map((s) => (
                          <SourceLink key={s.slug} type="button" onClick={() => openWikiPath(`/wiki/a/${s.slug}`)}>
                            {s.title}
                          </SourceLink>
                        ))}
                      </Sources>
                    )}
                    {/* KNOWLEDGE_LOOP 축2 — 답변 피드백. 미답변·불만족이 위키 초안 제안으로 되먹임 */}
                    {!tn.loading && !tn.error && tn.a && tn.logId != null && (
                      <FeedbackRow>
                        {tn.feedback ? (
                          <FeedbackDone>{t('qhelper.feedbackThanks', '피드백 감사합니다')}</FeedbackDone>
                        ) : (
                          <>
                            <FeedbackBtn type="button" onClick={() => sendAnswerFeedback(i, 'helpful')}>
                              {t('qhelper.feedbackHelpful', '도움됐어요')}
                            </FeedbackBtn>
                            <FeedbackBtn type="button" onClick={() => sendAnswerFeedback(i, 'not_helpful')}>
                              {t('qhelper.feedbackNotHelpful', '아니요')}
                            </FeedbackBtn>
                          </>
                        )}
                      </FeedbackRow>
                    )}
                  </A>
                </TurnRow>
              ))
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
                <FbAttachRow>
                  <FbAttachBtn type="button" onClick={() => document.getElementById('fb-attach-input')?.click()} disabled={fbAttachments.length >= 3}>
                    + {t('qhelper.fbAttachAdd', '이미지 추가')}
                  </FbAttachBtn>
                  <FbAttachHint>{t('qhelper.fbAttachHint', '최대 3개, 파일당 1MB 이하 (스크린샷 권장)')}</FbAttachHint>
                  <input
                    id="fb-attach-input" type="file" hidden multiple accept="image/*"
                    onChange={onFbFileChange}
                  />
                </FbAttachRow>
                {fbAttachments.length > 0 && (
                  <FbAttachList>
                    {fbAttachments.map((a, i) => (
                      <FbAttachChip key={i}>
                        <FbAttachThumb src={a.dataUrl} alt={a.name} />
                        <FbAttachName title={a.name}>{a.name}</FbAttachName>
                        <FbAttachRemove type="button" onClick={() => removeFbAttachment(i)} aria-label={t('qhelper.fbAttachRemove', '삭제') as string}>×</FbAttachRemove>
                      </FbAttachChip>
                    ))}
                  </FbAttachList>
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
              {!isGuest && (
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
          {mode === 'myhistory' && !isGuest && (
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
                placeholder={mode === 'workspace'
                  ? t('qhelper.cueInputPh', { ws: user?.business_name || (t('qhelper.workspaceFallback', '워크스페이스') as string), defaultValue: '{{ws}} 에 대해 묻기 (Enter 로 보내기, Shift+Enter 줄바꿈)' }) as string
                  : isGuest
                    ? t('qhelper.guestInputPh', 'PlanQ 에 대해 무엇이든 물어보세요 (Enter 로 보내기)') as string
                    : t('qhelper.inputPh', '질문을 입력하세요 (Enter 로 보내기, Shift+Enter 줄바꿈)') as string}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  // Q Talk 과 동일한 입력 동작: Enter 전송 / Shift+Enter 줄바꿈.
                  // IME 한글 조합 중 Enter 는 조합 확정이므로 전송 안 함 (isComposing / keyCode 229 가드).
                  if (e.nativeEvent.isComposing || (e.nativeEvent as KeyboardEvent).keyCode === 229) return;
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={2}
              />
              <SendBtn type="button" onClick={submit} disabled={submitting || !input.trim()}
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
const Drawer = styled.div<{ $standalone?: boolean }>`
  position: fixed; top: 0; right: 0; bottom: 0;
  width: ${(p) => (p.$standalone ? '100vw' : '440px')};
  ${(p) => p.$standalone && 'left: 0;'}
  background: #FFFFFF;
  border-left: ${(p) => (p.$standalone ? 'none' : '1px solid #E2E8F0')};
  box-shadow: ${(p) => (p.$standalone ? 'none' : '-8px 0 32px rgba(15, 23, 42, 0.10)')};
  z-index: 1001;
  display: flex; flex-direction: column;
  animation: ${(p) => (p.$standalone ? 'none' : 'cueSlideIn 0.2s ease-out')};
  @keyframes cueSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
  @media (max-width: 1024px) { width: ${(p) => (p.$standalone ? '100vw' : 'min(440px, 90vw)')}; }
  @media (max-width: 640px) {
    width: 100vw;
    border-left: none;
    box-shadow: none;
    padding-bottom: env(safe-area-inset-bottom);
  }
`;
const Header = styled.div`
  flex-shrink: 0;
  height: 56px;
  padding: 0 16px;
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid #E2E8F0;
`;
const HeaderTitle = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700; color: #0F172A;
`;
const Sparkle = styled.span<{ $cue?: boolean }>`
  display: inline-flex;
  color: ${p => p.$cue ? '#F43F5E' : '#0D9488'};
`;
const CloseBtn = styled.button`
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 8px;
  color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  flex: 1; overflow-y: auto;
  padding: 16px;
`;
const Empty = styled.div`
  text-align: center; padding: 40px 20px;
`;
const EmptyTitle = styled.h4`
  font-size: 14px; font-weight: 700; color: #0F172A;
  margin: 0 0 6px;
`;
const EmptyHint = styled.p`
  font-size: 13px; color: #64748B;
  margin: 0 0 16px; line-height: 1.55;
`;
const EmptyShortcut = styled.div`
  font-size: 12px; color: #94A3B8;
  display: inline-flex; align-items: center; gap: 4px;
  kbd {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 22px; height: 22px; padding: 0 6px;
    background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 4px;
    font-family: inherit; font-size: 11px; font-weight: 600; color: #334155;
  }
`;
const TurnRow = styled.div`
  margin-bottom: 16px;
  display: flex; flex-direction: column; gap: 6px;
`;
const Q = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px;
  background: #F8FAFC;
  border-radius: 8px;
`;
const QuLabel = styled.span`
  font-size: 10px; font-weight: 700; color: #94A3B8;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const QText = styled.span`
  font-size: 13px; color: #0F172A; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word;
`;
const A = styled.div<{ $variant?: 'qhelper' | 'workspace' }>`
  display: flex; flex-direction: column; gap: 4px;
  background: ${p => p.$variant === 'workspace' ? '#FFF1F2' : '#F0FDFA'};
  border-left: 3px solid ${p => p.$variant === 'workspace' ? '#F43F5E' : '#14B8A6'};
  border-radius: 0 8px 8px 0;
  padding: 10px 12px;
`;
const ALabel = styled.span<{ $variant?: 'qhelper' | 'workspace' }>`
  font-size: 10px; font-weight: 700;
  color: ${p => p.$variant === 'workspace' ? '#9F1239' : '#0D9488'};
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const Answer = styled.div`
  font-size: 13px; color: #0F172A; line-height: 1.55;
  white-space: pre-wrap;
  flex: 1;
`;
const Loading = styled.span`
  font-size: 13px; color: #64748B; font-style: italic;
`;
const ErrorText = styled.span`
  font-size: 13px; color: #DC2626;
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
  font-size: 13px; font-family: inherit;
  line-height: 1.45; color: #0F172A;
  padding: 4px 0;
  min-height: 40px; max-height: 120px;
  &:focus { outline: none; }
  &::placeholder { color: #94A3B8; }
  @media (max-width: 1024px) { font-size: 16px; }
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
  font-size: 12px; font-weight: 600;
  transition: all 0.15s;
  &:hover { background: #FECDD3; }
`;
const BackToGuide = styled.button`
  all: unset; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px;
  background: #F1F5F9; color: #475569;
  border-radius: 999px;
  font-size: 12px; font-weight: 600;
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
  font-size: 12px; font-weight: 600;
  border: 1px solid transparent;  /* active/inactive 동일 box-size 유지 — 탭 전환 시 높이 흔들림 방지 */
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  ${p => p.$active && p.$variant === 'qhelper' && 'background: #FFFFFF; color: #0F766E; border-color: #14B8A6;'}
  ${p => p.$active && p.$variant === 'workspace' && 'background: #FFFFFF; color: #9F1239; border-color: #F43F5E;'}
  ${p => !p.$active && 'background: transparent; color: #64748B;'}
  &:hover { background: ${p => p.$active ? '#FFFFFF' : '#FFFFFF99'}; }
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
  font-size: 12px; font-weight: 500; color: #475569;
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
const WikiSectionLabel = styled.div`
  font-size: 11px; font-weight: 700; color: #94A3B8;
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
  font-size: 13px; font-weight: 700; color: #0F766E; line-height: 1.4;
`;
const WikiCardSummary = styled.span`
  font-size: 12px; color: #64748B; line-height: 1.45;
`;
const WikiFullLink = styled.button`
  all: unset; cursor: pointer;
  align-self: flex-start;
  font-size: 12px; font-weight: 700; color: #0D9488;
  &:hover { color: #0F766E; text-decoration: underline; }
`;
// ─── Q위키 답변 근거(sources) ───
const Sources = styled.div`
  margin-top: 8px; padding-top: 8px; border-top: 1px dashed #CCFBF1;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
`;
const SourcesLabel = styled.span`
  font-size: 10px; font-weight: 700; color: #0D9488;
  text-transform: uppercase; letter-spacing: 0.4px;
`;
const SourceLink = styled.button`
  all: unset; cursor: pointer;
  padding: 3px 8px; border-radius: 999px;
  background: #FFFFFF; border: 1px solid #5EEAD4;
  font-size: 11px; font-weight: 600; color: #0F766E;
  &:hover { background: #F0FDFA; }
`;
// KNOWLEDGE_LOOP 축2 — 답변 피드백 2버튼
const FeedbackRow = styled.div`
  margin-top: 8px; display: flex; align-items: center; gap: 6px;
`;
const FeedbackBtn = styled.button`
  all: unset; cursor: pointer;
  padding: 3px 10px; border-radius: 999px;
  background: #FFFFFF; border: 1px solid #E2E8F0;
  font-size: 11px; font-weight: 600; color: #64748B;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
`;
const FeedbackDone = styled.span`
  font-size: 11px; color: #94A3B8;
`;
const FeedbackPitch = styled.div`
  flex-shrink: 0;
  padding: 12px 16px;
  background: #FFF1F2;
  border-bottom: 1px solid #FECDD3;
  font-size: 12.5px; color: #9F1239;
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
  font-size: 12px; font-weight: 700; color: #475569;
`;
const FbCatRow = styled.div`
  display: flex; gap: 6px; flex-wrap: wrap;
`;
const FbCatBtn = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer;
  padding: 6px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 600;
  background: ${p => p.$active ? '#F43F5E' : '#F1F5F9'};
  color: ${p => p.$active ? '#FFFFFF' : '#475569'};
  transition: all 0.15s;
  &:hover { background: ${p => p.$active ? '#E11D48' : '#E2E8F0'}; }
`;
const FbTextArea = styled.textarea`
  padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #0F172A;
  font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #F43F5E; box-shadow: 0 0 0 3px rgba(244,63,94,0.15); }
`;
const FbInput = styled.input`
  padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #0F172A;
  font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const FbCheck = styled.div`
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: #475569;
  input { width: 16px; height: 16px; accent-color: #F43F5E; cursor: pointer; }
  label { cursor: pointer; }
`;
const FbMeta = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 11px;
`;
const FbMetaLabel = styled.span`color: #64748B; font-weight: 600; flex-shrink: 0;`;
const FbMetaValue = styled.span`
  color: #334155; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all; min-width: 0;
`;
const FbResult = styled.div`
  padding: 10px 12px;
  background: #F0FDFA; border: 1px solid #5EEAD4; border-radius: 8px;
  font-size: 13px; color: #0F766E;
`;
// 내 문의·피드백 내역 (운영 #21)
const MyHistoryLink = styled.button`
  align-self: flex-start; padding: 6px 0; background: none; border: none; cursor: pointer;
  font-size: 13px; font-weight: 600; color: #0D9488;
  &:hover { color: #0F766E; text-decoration: underline; }
`;
const MyHistoryWrap = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const MyHistoryBack = styled.button`
  align-self: flex-start; padding: 4px 0; background: none; border: none; cursor: pointer;
  font-size: 13px; font-weight: 600; color: #64748B;
  &:hover { color: #0F172A; }
`;
const MyHistoryEmpty = styled.div`
  padding: 28px 16px; text-align: center; font-size: 13px; color: #94A3B8;
`;
const MyHistoryCard = styled.div`
  padding: 14px; border: 1px solid #E2E8F0; border-radius: 12px; background: #FFFFFF;
  display: flex; flex-direction: column; gap: 8px;
`;
const MyHistoryTop = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const MyHistCat = styled.span`
  font-size: 11px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border-radius: 999px; padding: 2px 10px;
`;
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#FEF3C7', fg: '#92400E' },
  reviewing: { bg: '#DBEAFE', fg: '#1E40AF' },
  done: { bg: '#DCFCE7', fg: '#166534' },
  wontfix: { bg: '#F1F5F9', fg: '#64748B' },
};
const MyHistStatus = styled.span<{ $s: string }>`
  font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 10px;
  background: ${p => (STATUS_TONE[p.$s] || STATUS_TONE.pending).bg};
  color: ${p => (STATUS_TONE[p.$s] || STATUS_TONE.pending).fg};
`;
const MyHistDate = styled.span`margin-left: auto; font-size: 11px; color: #94A3B8;`;
const MyHistBody = styled.div`font-size: 13px; color: #334155; white-space: pre-wrap; word-break: break-word;`;
const MyHistReply = styled.div`
  margin-top: 4px; padding: 10px 12px; background: #F8FAFC; border-radius: 8px;
  border-left: 3px solid #14B8A6;
`;
const MyHistReplyLabel = styled.div`font-size: 11px; font-weight: 700; color: #0F766E; margin-bottom: 4px;`;
const MyHistReplyText = styled.div`font-size: 13px; color: #334155; white-space: pre-wrap; word-break: break-word;`;
// N+63 — 피드백 이미지 첨부 (사용자 호소 #3c)
const FbAttachRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
`;
const FbAttachBtn = styled.button`
  padding: 6px 12px; border-radius: 6px;
  background: #FFFFFF; border: 1px solid #CBD5E1;
  font-size: 12px; font-weight: 500; color: #475569; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  &:hover:not(:disabled) { background: #F0FDFA; border-color: #5EEAD4; color: #0F766E; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const FbAttachHint = styled.span`
  font-size: 11px; color: #94A3B8;
`;
const FbAttachList = styled.div`
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;
`;
const FbAttachChip = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 8px 4px 4px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 11px; color: #475569;
  max-width: 200px;
`;
const FbAttachThumb = styled.img`
  width: 36px; height: 36px; object-fit: cover; border-radius: 4px;
  background: #F1F5F9;
`;
const FbAttachName = styled.span`
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;
`;
const FbAttachRemove = styled.button`
  width: 18px; height: 18px; padding: 0;
  background: transparent; border: none; color: #94A3B8;
  font-size: 14px; line-height: 1; cursor: pointer; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  &:hover { background: #FEE2E2; color: #B91C1C; }
`;
const FbAttachErr = styled.div`
  margin-top: 6px; font-size: 11px; color: #B91C1C;
`;
const FbSendBtn = styled.button`
  width: 100%;
  padding: 10px 14px;
  background: #F43F5E;
  color: #FFFFFF;
  border: none; border-radius: 8px;
  font-size: 13px; font-weight: 700;
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
