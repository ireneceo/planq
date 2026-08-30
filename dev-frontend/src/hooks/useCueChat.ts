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
import { useCallback, useState } from 'react';
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
  proposedAction?: CueProposal;                       // #81 — Cue 실행 제안 (확인 카드)
  actionStatus?: 'pending' | 'done' | 'dismissed';    // 카드 상태
  actionResult?: CueActionResult;                     // 실행 결과 (딥링크용)
}

/** 확인 카드로 띄울 수 있는 툴 — 서버 화이트리스트와 **같은 목록**이어야 한다. */
const PROPOSABLE_TOOLS = [
  'create_task', 'create_event', 'create_document_draft',
  'submit_review', 'complete_task', 'add_task_comment',
];

/** 실행 결과 → 그 엔티티를 여는 경로. 표면이 새 탭으로 열지 같은 탭으로 갈지 정한다. */
export function cueActionDeepLink(r: CueActionResult): string {
  return r.entity_type === 'task' ? `/tasks?task=${r.entity_id}`
    : r.entity_type === 'event' ? `/calendar?event=${r.entity_id}`
      : `/info?doc=${r.entity_id}`;
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

  // 표면이 캐시할 수 있게 모든 갱신을 한 곳으로 모은다.
  const setTurns = useCallback((updater: CueTurn[] | ((prev: CueTurn[]) => CueTurn[])) => {
    setTurnsRaw((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: CueTurn[]) => CueTurn[])(prev) : updater;
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
            // ★ search 를 반드시 같이 보낸다. 서버는 path+search 를 이어 붙여
            //   `?conv=` `?thread=` `?project=` 를 읽는다 — 빼면 컨텍스트가 통째로 죽는다.
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
        throw new Error((translateError?.(j.message) || j.message || 'Q helper error') as string);
      }
      const srcs = Array.isArray(j.data?.sources) ? j.data.sources : [];
      const pa = j.data?.proposed_action;
      const proposed = pa && PROPOSABLE_TOOLS.includes(pa.tool) ? (pa as CueProposal) : undefined;
      setTurns((prev) => prev.map((tn, i) => i === prev.length - 1
        ? {
            ...tn, a: j.data.answer || '', loading: false, sources: srcs, logId: j.data.log_id ?? null,
            proposedAction: proposed, actionStatus: proposed ? 'pending' as const : undefined,
          }
        : tn));
    } catch (e) {
      setTurns((prev) => prev.map((tn, i) => i === prev.length - 1
        ? { ...tn, error: mapApiError(e, tErr as never), loading: false }
        : tn));
    } finally {
      setSubmitting(false);
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

  const onActionExecuted = useCallback((turnIdx: number, r: CueActionResult) => {
    setTurns((prev) => prev.map((tn, i) => i === turnIdx ? { ...tn, actionStatus: 'done' as const, actionResult: r } : tn));
  }, [setTurns]);

  const onActionDismiss = useCallback((turnIdx: number) => {
    setTurns((prev) => prev.map((tn, i) => i === turnIdx ? { ...tn, actionStatus: 'dismissed' as const } : tn));
  }, [setTurns]);

  return {
    input, setInput, turns, setTurns, submitting,
    // ★ setSubmitting 을 내주는 이유: Q helper 드로어의 **문의·피드백 탭**이 같은 플래그로
    //   버튼을 잠근다. 별도 상태로 쪼개면 이번 추출이 "동작 무변경" 이 아니게 된다.
    //   새 표면(우측 패널)은 이걸 쓸 일이 없다.
    setSubmitting,
    submit, sendAnswerFeedback, onActionExecuted, onActionDismiss,
  };
}
