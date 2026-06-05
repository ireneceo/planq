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
  opts: { enabled: boolean; getText: () => string; title?: string; emptyMsg?: string; failMsg?: string },
) {
  const [candidates, setCandidates] = useState<NoteTaskCandidate[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [members, setMembers] = useState<CandidateMember[]>([]);
  const membersLoaded = useRef(false);
  // getText 는 매 렌더 새 클로저 → ref 로 보관 (effect deps 오염 방지)
  const getTextRef = useRef(opts.getText);
  getTextRef.current = opts.getText;

  useEffect(() => {
    if (!opts.enabled || !businessId || !sessionId) { setCandidates([]); return; }
    listNoteCandidates(businessId, sessionId).then(setCandidates).catch(() => { /* skip */ });
    if (!membersLoaded.current) {
      membersLoaded.current = true;
      listBusinessMembers(businessId)
        .then((ms) => setMembers(ms.map((m) => ({ user_id: m.user_id, name: m.name || m.user?.name || 'unknown' }))))
        .catch(() => { membersLoaded.current = false; });
    }
  }, [opts.enabled, businessId, sessionId]);

  const extract = useCallback(async () => {
    if (!businessId || !sessionId) return;
    setError(null);
    setExtracting(true);
    try {
      const text = getTextRef.current().trim();
      if (!text) { setError(opts.emptyMsg || 'no_text'); return; }
      await extractNoteTasks(businessId, sessionId, { text, title: opts.title || '' });
      setCandidates(await listNoteCandidates(businessId, sessionId));
    } catch (e) {
      setError((e as Error).message || opts.failMsg || 'extract_failed');
    } finally {
      setExtracting(false);
    }
  }, [businessId, sessionId, opts.title, opts.emptyMsg, opts.failMsg]);

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

  return { candidates, extracting, error, busy, members, extract, register, reject };
}
