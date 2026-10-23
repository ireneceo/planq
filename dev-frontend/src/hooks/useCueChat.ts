// hooks/useCueChat.ts — Cue 대화의 **동작 단일 원천** (#227).
//
// 왜 뽑았는가:
//   Q helper 드로어에만 있던 대화 로직을 채팅·메일 우측 패널에서도 써야 한다.
//   복사하면 반드시 갈라진다 — API 계약, 제안 툴 화이트리스트, 레이트리밋 문구가
//   표면마다 달라지는 순간 "저기선 되는데 여기선 안 되는" 상태가 된다
//   (memory: 베낀 컴포넌트는 반드시 갈라진다 — 껍데기를 뽑아라).
//
// 여기 있는 것: turns/input/submitting 상태 · submit · 답변 피드백 · 확인 카드 상태 · 딥링크
// 여기 없는 것(표면의 몫): 헤더·탭·FAB·단축키·백드롭·렌더
import { useCallback, useRef, useState } from 'react';
import { apiFetch } from '../contexts/AuthContext';
import { mapApiError } from '../utils/apiError';
import type { CueProposal, CueActionResult } from '../components/Common/CueActionCard';

export interface CueTurn {
  q: string;
  a: string;
  loading?: boolean;
  error?: string;
  sources?: Array<{ slug: string; title: string }>;  // Q위키 RAG 근거 article
  logId?: number | null;                              // KNOWLEDGE_LOOP 축2 — 피드백 대상 로그
  feedback?: 'helpful' | 'not_helpful';               // 제출된 피드백 (재클릭 차단)
  /** #81 — Cue 실행 제안(확인 카드). 한 답에 최대 3장, 서로 독립 — 카드마다 상태·결과를 따로 든다(2026-10-12 Fable D2). */
  actions?: CueTurnAction[];
  /** 흘려 받는 중 서버가 «워크스페이스에서 찾는 중» 이라 알렸다(docs/CUE_STREAMING_DESIGN.md). 글이 흐르기 시작하면 글이 보인다. */
  phase?: 'searching';
}
export interface CueTurnAction {
  proposal: CueProposal;
  status: 'pending' | 'done' | 'dismissed';
  result?: CueActionResult;                           // 실행 결과 (딥링크용)
}

/** 실행 결과 → 그 엔티티를 여는 경로. 서버가 준 주소(open_url)가 있으면 그것을 쓴다(카탈로그 결과의 url). */
export function cueActionDeepLink(r: CueActionResult): string {
  if (r.open_url) {
    try { const u = new URL(r.open_url, window.location.origin); return `${u.pathname}${u.search}`; } catch { /* 아래 표로 */ }
  }
  const id = r.entity_id;
  switch (r.entity_type) {
    case 'task': return `/tasks?task=${id}`;
    case 'event': return `/calendar?event=${id}`;
    case 'project': return `/projects/p/${id}`;
    case 'document': return `/docs?post=${id}`;
    case 'memo': return `/notes`;
    case 'knowledge': return `/info?doc=${id}`;
    case 'mail_draft': return `/mail?thread=${id}&reply=1`;
    default: return '/dashboard';
  }
}

/** /api/cue/help 성공 응답의 data — JSON 과 흘려 받은 done 이 같은 칸이다. */
interface CueHelpData {
  answer?: string;
  sources?: Array<{ slug: string; title: string }>;
  log_id?: number | null;
  proposed_action?: unknown;
  proposed_actions?: unknown[];
}

/**
 * 흘려 받는 /api/cue/help 본문(SSE) 읽기 — 이벤트: status{kind} · delta{t} · reset · done{…} · error{message}.
 *   글은 한 프레임에 한 번만 화면에 넘긴다. done 없이 끝나면 오류다(조용히 빈 답으로 두지 않는다).
 */
async function readCueStream(body: ReadableStream<Uint8Array>, h: {
  onText: (a: string) => void; onSearching: () => void; onDone: (d: CueHelpData) => void; onError: (code: string) => void;
}) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = ''; let text = ''; let raf = 0; let finished = false;
  const flushText = () => { raf = 0; h.onText(text); };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(flushText); };
  const cancelRaf = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  const handle = (block: string) => {
    let ev = 'message'; let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    let j: Record<string, unknown> = {};
    try { j = data ? JSON.parse(data) : {}; } catch { return; }
    if (ev === 'delta') { text += String(j.t ?? ''); schedule(); }
    else if (ev === 'reset') { text = ''; cancelRaf(); h.onText(''); }
    else if (ev === 'status') { if (j.kind === 'searching') { text = ''; cancelRaf(); h.onSearching(); } }
    else if (ev === 'done') { finished = true; cancelRaf(); h.onDone(j as CueHelpData); }
    else if (ev === 'error') { finished = true; cancelRaf(); if (text) h.onText(text); h.onError(String(j.message || 'llm_error')); }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
  }
  if (buf.trim()) handle(buf);
  if (!finished) { cancelRaf(); if (text) h.onText(text); h.onError('stream_interrupted'); }
}

interface Options {
  /** 게스트는 auth 없는 public 라우트 (마케팅 비용 — 워크스페이스 사용량 미차감) */
  isGuest: boolean;
  /** 'workspace'(Cue) | 'qhelper'(Q위키) — 서버가 답변 성격을 가른다 */
  mode: string;
  /** 지금 보고 있는 화면. Cue 가 "이 대화방/이 메일" 을 알아듣는 근거다. */
  location: { pathname: string; search?: string };
  /** 레이트리밋 등 서버 코드 → 사용자 문구 (표면의 i18n 을 그대로 쓴다) */
  translateError?: (code: string) => string | null;
  /** mapApiError 용 errors 네임스페이스 t */
  tErr: (k: string, d?: string) => string;
  /** 전송 직후 표면이 할 일 (입력창 높이 초기화 등) */
  onAfterSend?: () => void;
  /** 대화가 갱신될 때마다 호출 — 표면이 캐시에 담아 언마운트 후에도 살릴 수 있다 */
  onTurnsChange?: (turns: CueTurn[]) => void;
}

export function useCueChat(opts: Options) {
  const { isGuest, mode, location, translateError, tErr, onAfterSend, onTurnsChange } = opts;
  const [input, setInput] = useState('');
  const [turns, setTurnsRaw] = useState<CueTurn[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // 앞선 대화를 서버에 싣기 위한 최신 사본 — submit 클로저가 옛 turns 를 읽지 않게 ref 로 든다.
  const turnsRef = useRef<CueTurn[]>([]);

  // 표면이 캐시할 수 있게 모든 갱신을 한 곳으로 모은다.
  const setTurns = useCallback((updater: CueTurn[] | ((prev: CueTurn[]) => CueTurn[])) => {
    setTurnsRaw((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: CueTurn[]) => CueTurn[])(prev) : updater;
      turnsRef.current = next;
      onTurnsChange?.(next);
      return next;
    });
  }, [onTurnsChange]);

  /**
   * 질문을 보낸다.
   * @param qOverride 명시 질문. **입력창을 거치지 않고 바로 물을 때 반드시 이걸 쓴다.**
   *
   * ★ 왜 인자가 필요한가 (Fable 적발):
   *   `submit()` 은 클로저의 `input` 을 읽는데, 제출 직후 `setInput('')` 으로 비운다.
   *   그래서 "입력값을 setInput 으로 넣고 곧바로 submit()" 하는 호출부는 React 배칭 탓에
   *   **여전히 빈 문자열 클로저를 읽어 조용히 빠져나간다**(`if (!q) return`).
   *   실제로 검색창에서 [지우고 검색으로] 뒤 같은 검색어로 다시 누르면 아무 일도 안 일어났고,
   *   두 번 눌러야 발화했다 — 오류도 안 나서 "그냥 안 눌렸나" 로 보인다.
   *   setInput 재동기화로 때우지 않는다. 질문은 부르는 쪽이 알고 있으니 그대로 받는다.
   *
   * ★ 함정: `onClick={submit}` 처럼 **직접 넘기지 말 것** — 클릭 이벤트 객체가 qOverride 자리에
   *   들어간다. `onClick={() => submit()}` 로 감싼다. (타입이 잡아주지만 any 경유면 샌다.)
   */
  const submit = useCallback(async (qOverride?: string) => {
    const q = (qOverride ?? input).trim();
    if (!q || submitting) return;
    setSubmitting(true);
    // ★ 앞선 대화(답이 온 턴만)를 같이 보낸다. 여태 질문 한 줄만 보내 Cue 가 매번 처음 듣는 사람처럼
    //   굴었다 — 자기가 단 "2) …" 를 사용자가 "2번" 이라 해도 못 알아들었다(2026-10-06 신고).
    // ★ 실행한 카드의 결과(무엇을 만들었고 #번호)도 싣는다 — «그 업무에 연결해» 를 다음 턴에 실제 id 로 알아듣게(Fable D3).
    const history = turnsRef.current
      .filter((tn) => !tn.loading && !tn.error)
      .map((tn) => ({
        q: tn.q, a: tn.a,
        actions: (tn.actions || []).filter((x) => x.status === 'done' && x.result && !x.result.replayed).map((x) => ({
          tool: x.result!.tool, entity_type: x.result!.entity_type, entity_id: x.result!.entity_id,
          title: String(x.proposal.params?.title ?? x.proposal.params?.name ?? ''),
        })),
      }))
      .filter((h) => h.a || h.actions.length)
      .slice(-4);
    setTurns((prev) => [...prev.slice(-4), { q, a: '', loading: true }]);   // 최근 5턴 유지
    setInput('');
    onAfterSend?.();
    try {
      const url = isGuest ? '/api/cue/help-public' : '/api/cue/help';
      const body = isGuest
        ? { question: q }
        : {
            question: q,
            mode,
            history,
            // ★ search 를 반드시 같이 보낸다. 서버는 path+search 를 이어 붙여
            //   `?conv=` `?thread=` `?project=` 를 읽는다 — 빼면 컨텍스트가 통째로 죽는다.
            page_context: { path: location.pathname, search: location.search || undefined },
          };
      const fetcher = isGuest ? fetch : apiFetch;
      const res = await fetcher(url, {
        method: 'POST',
        // 로그인 사용자는 답을 흘려 받는다 — 서버가 거절(400·409·422·429)하거나 옛 서버면 JSON 이 온다(아래에서 Content-Type 으로 가른다).
        headers: { 'Content-Type': 'application/json', ...(isGuest ? {} : { Accept: 'text/event-stream, application/json' }) },
        body: JSON.stringify(body),
      });
      if (!isGuest && res.ok && /text\/event-stream/i.test(res.headers.get('content-type') || '') && res.body) {
        await readCueStream(res.body, {
          // 조각은 한 프레임에 한 번 모아 그린다(초당 수십 조각 — setState 폭주 방지)
          onText: (a) => setTurns((prev) => prev.map((tn, i) => i === prev.length - 1 ? { ...tn, a, phase: a ? undefined : tn.phase } : tn)),
          onSearching: () => setTurns((prev) => prev.map((tn, i) => i === prev.length - 1 ? { ...tn, a: '', phase: 'searching' } : tn)),
          onDone: (data) => finishTurn(data),
          onError: (code) => {
            const msg = (translateError?.(code) || code) as string;   // JSON 경로(throw new Error(...))와 같은 해석
            // 이미 흘린 글은 버리지 않는다 — 부분 글 + 오류 한 줄(Fable 2026-10-23)
            setTurns((prev) => prev.map((tn, i) => i === prev.length - 1 ? { ...tn, error: mapApiError(new Error(msg), tErr as never), loading: false, phase: undefined } : tn));
          },
        });
        return;
      }
      const j = await res.json();
      if (!res.ok || !j.success) {
        throw new Error((translateError?.(j.message) || j.message || 'Q helper error') as string);
      }
      finishTurn(j.data);
    } catch (e) {
      setTurns((prev) => prev.map((tn, i) => i === prev.length - 1
        ? { ...tn, error: mapApiError(e, tErr as never), loading: false, phase: undefined }
        : tn));
    } finally {
      setSubmitting(false);
    }

    // 답 한 건 마무리 — JSON 응답과 흘려 받은 done 이 **같은 함수**를 지난다(흘린 글은 여기서 정본 answer 로 덮인다).
    function finishTurn(data: CueHelpData) {
      const srcs = Array.isArray(data?.sources) ? data.sources : [];
      // 서버가 카탈로그로 검증·미리보기를 마친 제안만 온다(card 가 그 표시) — 화면이 도구 목록을 따로 들지 않는다
      //   proposed_actions(여러 장)가 정본, 없으면 옛 서버의 proposed_action 한 장.
      const raw: unknown[] = Array.isArray(data?.proposed_actions) ? data.proposed_actions : (data?.proposed_action ? [data.proposed_action] : []);
      const actions: CueTurnAction[] = raw
        .filter((pa): pa is CueProposal => !!pa && typeof pa === 'object' && !!(pa as CueProposal).tool && !!(pa as CueProposal).card)
        .map((proposal) => ({ proposal, status: 'pending' as const }));
      setTurns((prev) => prev.map((tn, i) => i === prev.length - 1
        ? {
            ...tn, a: data?.answer || '', loading: false, phase: undefined, sources: srcs, logId: data?.log_id ?? null,
            actions: actions.length ? actions : undefined,
          }
        : tn));
    }
  }, [input, submitting, location, isGuest, mode, translateError, tErr, onAfterSend, setTurns]);

  // KNOWLEDGE_LOOP 축2 — 답변 피드백 (낙관적 표시, 실패 무해)
  const sendAnswerFeedback = useCallback(async (turnIdx: number, feedback: 'helpful' | 'not_helpful') => {
    let target: CueTurn | undefined;
    setTurns((prev) => {
      target = prev[turnIdx];
      if (!target || target.logId == null || target.feedback) return prev;
      return prev.map((tn, i) => i === turnIdx ? { ...tn, feedback } : tn);
    });
    if (!target || target.logId == null || target.feedback) return;
    try {
      const fetcher = isGuest ? fetch : apiFetch;
      await fetcher('/api/cue/help-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log_id: target.logId, feedback }),
      });
    } catch { /* 피드백 실패는 조용히 무시 */ }
  }, [isGuest, setTurns]);

  const setAction = useCallback((turnIdx: number, cardIdx: number, patch: Partial<CueTurnAction>) => {
    setTurns((prev) => prev.map((tn, i) => i === turnIdx
      ? { ...tn, actions: (tn.actions || []).map((x, k) => k === cardIdx ? { ...x, ...patch } : x) }
      : tn));
  }, [setTurns]);
  const onActionExecuted = useCallback((turnIdx: number, cardIdx: number, r: CueActionResult) => {
    setAction(turnIdx, cardIdx, { status: 'done', result: r });
  }, [setAction]);

  const onActionDismiss = useCallback((turnIdx: number, cardIdx: number) => {
    setAction(turnIdx, cardIdx, { status: 'dismissed' });
  }, [setAction]);

  return {
    input, setInput, turns, setTurns, submitting,
    // ★ setSubmitting 을 내주는 이유: Q helper 드로어의 **문의·피드백 탭**이 같은 플래그로
    //   버튼을 잠근다. 별도 상태로 쪼개면 이번 추출이 "동작 무변경" 이 아니게 된다.
    //   새 표면(우측 패널)은 이걸 쓸 일이 없다.
    setSubmitting,
    submit, sendAnswerFeedback, onActionExecuted, onActionDismiss,
  };
}
