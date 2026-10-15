// N+88 — Q Note 업무 추출 공유 훅 (음성 review · 메모 공통).
// 같은 로직 2벌 방지 (통일 원칙). 브릿지: extract/list/register/reject + 멤버 로드.
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  extractNoteTasks, listNoteCandidates, registerNoteCandidate, rejectNoteCandidate,
  type NoteTaskCandidate,
} from '../services/qnote';
import { listBusinessMembers } from '../services/qtalk';
import type { CandidateMember, RegisterOverrides } from '../components/Common/TaskCandidateCard';

export function useNoteTaskExtraction(
  businessId: number | null,
  sessionId: number | null,
  opts: {
    enabled: boolean; getText: () => string; title?: string; emptyMsg?: string; failMsg?: string;
    /** 뽑았는데 0건일 때 안내 — 실패와 «업무 없음» 은 사용자에게 다른 뜻이다 */
    noneMsg?: string;
    /** AI 미가동(503) 안내 */
    unavailableMsg?: string;
    /** Cue 사용 한도 초과(429 cue_usage_limit_exceeded) 안내 — «실패» 로만 말하면 왜 안 되는지 모른다 */
    limitMsg?: string;
  },
) {
  const [candidates, setCandidates] = useState<NoteTaskCandidate[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 오류가 아닌 안내(«찾지 못했어요») — 오류와 톤이 달라 따로 둔다
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [members, setMembers] = useState<CandidateMember[]>([]);
  const membersLoaded = useRef(false);
  // getText 는 매 렌더 새 클로저 → ref 로 보관 (effect deps 오염 방지)
  const getTextRef = useRef(opts.getText);
  getTextRef.current = opts.getText;

  useEffect(() => {
    setNotice(null); setError(null);
    if (!opts.enabled || !businessId || !sessionId) { setCandidates([]); return; }
    listNoteCandidates(businessId, sessionId).then(setCandidates).catch(() => { /* skip */ });
    if (!membersLoaded.current) {
      membersLoaded.current = true;
      listBusinessMembers(businessId)
        // Cue(AI) 는 담당자 후보에서 뺀다 — 이 경로엔 Cue 자동 실행 트리거가 없어 배정하면 좀비 업무가 된다(메일 작업대와 같은 규칙)
        .then((ms) => setMembers(ms.filter((m) => m.role !== 'ai').map((m) => ({ user_id: m.user_id, name: m.name || m.user?.name || 'unknown' }))))
        .catch(() => { membersLoaded.current = false; });
    }
  }, [opts.enabled, businessId, sessionId]);

  const extract = useCallback(async () => {
    if (!businessId || !sessionId) return;
    setError(null); setNotice(null);
    setExtracting(true);
    try {
      const text = getTextRef.current().trim();
      if (!text) { setError(opts.emptyMsg || 'no_text'); return; }
      const got = await extractNoteTasks(businessId, sessionId, { text, title: opts.title || '' });
      setCandidates(await listNoteCandidates(businessId, sessionId));
      if (got.length === 0 && opts.noneMsg) setNotice(opts.noneMsg);
    } catch (e) {
      // 서버 원문(영문 코드)을 그대로 띄우지 않는다 — AI 미가동과 그 밖의 실패만 가른다
      const m = (e as Error).message || '';
      setError(/usage_limit/i.test(m) && opts.limitMsg ? opts.limitMsg
        : /503|unavailable/i.test(m) && opts.unavailableMsg ? opts.unavailableMsg
          : (opts.failMsg || m || 'extract_failed'));
    } finally {
      setExtracting(false);
    }
  }, [businessId, sessionId, opts.title, opts.emptyMsg, opts.failMsg, opts.noneMsg, opts.unavailableMsg, opts.limitMsg]);

  const register = useCallback(async (id: number, overrides: RegisterOverrides) => {
    if (!businessId || !sessionId) return;
    setBusy(id);
    try {
      await registerNoteCandidate(businessId, sessionId, id, overrides);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
    } catch (e) { setError((e as Error).message || 'register_failed'); }
    finally { setBusy(null); }
  }, [businessId, sessionId]);

  const reject = useCallback(async (id: number) => {
    if (!businessId || !sessionId) return;
    setBusy(id);
    try {
      await rejectNoteCandidate(businessId, sessionId, id);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
    } catch (e) { setError((e as Error).message || 'reject_failed'); }
    finally { setBusy(null); }
  }, [businessId, sessionId]);

  return { candidates, extracting, error, notice, busy, members, extract, register, reject };
}
