// Q mail 우측 컨텍스트 패널 (사이클 N+87 Phase A) — Q Talk 우측 패널 패턴 이식.
//   프로젝트·고객 picker (EmailThread.client_id/project_id) + 고객 cross-channel(channel-summary).
//   ★ 요약/업무후보/이슈/노트는 Phase B/C — 여기선 연결 + cross-channel 만 (mock 금지: 실 데이터만).
//   설계: docs/QMAIL_CONTEXT_DESIGN.md §5, §7.1
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import PlanQSelect from '../../components/Common/PlanQSelect';
import AutoSaveField from '../../components/Common/AutoSaveField';
import TaskCandidateCard, { type RegisterOverrides } from '../../components/Common/TaskCandidateCard';
import AiAssistButton from '../../components/Common/AiAssistButton';
import NoteThread from '../../components/Common/NoteThread';
import WorkbenchSection, { WorkbenchEmptyRow, WorkbenchSectionLink } from '../../components/Workbench/WorkbenchSection';
import ContextTaskList from '../../components/Workbench/ContextTaskList';
import CueTaskBar from '../../components/QTask/CueTaskBar';
import CuePanelSection from '../../components/Common/CuePanelSection';
import { useChromeLocation } from '../../hooks/useChromeNav';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { clientOptionLabel } from '../../utils/clientLabel';

interface ThreadLite {
  id: number;
  triage?: string | null;
  ai_summary?: string | null;
  ai_summary_at?: string | null;
  last_message_at?: string | null;
  client?: { id: number; display_name?: string; company_name?: string } | null;
  project?: { id: number; name?: string } | null;
}
interface Issue { id: number; body: string; author_user_id: number; author_name?: string | null; created_at?: string | null }
interface Note { id: number; body: string; visibility: string; author_user_id: number; author_name?: string | null; created_at?: string | null }
interface Member { user_id: number; name: string; role?: string; is_ai?: boolean }
interface Candidate {
  id: number;
  title: string;
  description?: string | null;
  guessed_assignee_user_id?: number | null;
  guessedAssignee?: { id: number; name: string } | null;
  guessed_due_date?: string | null;
}
interface Props {
  businessId: number;
  thread: ThreadLite;
  members: Member[];
  myUserId: number | null;
  onLinked: () => void; // 연결 변경 후 상세 새로고침
  /** 이 메일의 상대 주소(마지막 받은 메일의 보낸 사람 → 없으면 마지막 보낸 메일의 받는 사람). 없으면 «오간 메일» 칸을 안 그린다 */
  counterpartEmail?: string | null;
  onOpenThread?: (id: number) => void;
  onViewAddress?: (email: string) => void;
  /** 고객 칸이 비었을 때 [+ 고객 추가] — 상위(MailPage)가 고객 추가 드로어를 이 메일로 연다 */
  onAddClient?: () => void;
}
// «이 사람과 오간 메일» 한 줄 — 서버 GET /email-addresses/:email/threads 가 목록과 같은 행을 준다(services/mailThreadRows)
interface PeerThread { id: number; subject?: string | null; last_message_at?: string | null; last_message_direction?: 'inbound' | 'outbound' | null; folder?: string | null }
const PEER_SHOWN = 5;
type Channel = 'chat' | 'email' | 'task' | 'invoice';
interface Summary {
  counts: Record<Channel, number>;
  latest: Partial<Record<Channel, { title: string | null; preview?: string; at: string }>>;
}

const CHANNELS: Channel[] = ['chat', 'email', 'task', 'invoice'];

// 운영 #377 — "메일 상세의 업무 추출 버튼이 눌러도 반응이 없다."
//   원인은 AI 도, 권한도 아니었다. **이벤트가 청취자보다 먼저 발사된다.**
//   상세 툴바 버튼은 (a) 패널을 여는 setState 를 부르고 (b) 곧바로 window 이벤트를 쏜다.
//   그런데 이 패널은 접혀 있으면 아예 **마운트되지 않는다**(MailPage 조건부 렌더) —
//   addEventListener 는 다음 렌더에서야 붙으므로 그 사이 발사된 이벤트는 사라진다.
//   패널이 이미 열려 있을 때만 동작해서 "될 때도 있고 안 될 때도 있는" 것으로 보였다.
//   → 정본을 **모듈 스코프 값**으로 옮긴다. window 이벤트는 이미 떠 있는 패널을 깨우는 신호일 뿐이고,
//     늦게 마운트된 패널은 마운트 시점에 이 값을 소비한다.
//     (TaskDetailDrawer 의 pendingResumeFocusTaskId 와 같은 패턴 — 재마운트를 건너뛰는 의도 전달.)
//   ★ 30초 유효기간 — 소비되지 못한 요청이 남아 있다가, 나중에 같은 스레드를 다시 열었을 때
//     사용자가 누르지도 않은 추출이 도는 것을 막는다.
let pendingExtract: { threadId: number; at: number } | null = null;
const PENDING_EXTRACT_TTL_MS = 30_000;

/** 상세 툴바가 부른다 — 패널이 아직 없어도 안전하게 전달된다. */
export function requestExtractTasks(threadId: number) {
  pendingExtract = { threadId, at: Date.now() };
  window.dispatchEvent(new CustomEvent('qmail:extract-tasks', { detail: { threadId } }));
}

// [Cue 의견 듣기] — 업무 추출과 같은 이유(#377)로 요청을 모듈 스코프에 남긴다. 접혀 있던 패널이 늦게 떠도 받는다.
let pendingCueAdvice: { threadId: number; at: number } | null = null;
let cueAdviceSeq = 0;
export function requestCueAdvice(threadId: number) {
  pendingCueAdvice = { threadId, at: Date.now() };
  window.dispatchEvent(new CustomEvent('qmail:cue-advice', { detail: { threadId } }));
}

const MailContextPanel: React.FC<Props> = ({ businessId, thread, members, myUserId, onLinked, counterpartEmail, onOpenThread, onViewAddress, onAddClient }) => {
  const { t } = useTranslation('qmail');
  const { t: tAll } = useTranslation('qsale');
  const { formatTimeAgo } = useTimeFormat();
  const navigate = useNavigate();
  // ★ early return 위. 아래에 두면 훅 개수가 갈려 React #310 이 난다.
  const chromeLoc = useChromeLocation();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  // ★ 2026-10-20 (Irene: *"다시 받은 메일이랑 연결된 우리가 보낸 메일이나 과거 메일을 알 수가 없네."*)
  //   같은 사람과 오간 메일이라도 제목이 바뀌거나 새로 보낸 메일이면 다른 대화(스레드)다. 그 목록은
  //   주소 메뉴 «이 주소의 메일 보기» 안에만 있어서 메일을 열어도 보이지 않았다 → 여기서 최근 것 몇 개를 보여 준다.
  //   보낸/받은은 그 대화의 마지막 메일 방향(목록의 「보낸」 표시와 같은 값).
  const [peer, setPeer] = useState<{ email: string; rows: PeerThread[]; total: number } | null>(null);
  const [peerLoading, setPeerLoading] = useState(false);
  useEffect(() => {
    const email = (counterpartEmail || '').trim().toLowerCase();
    if (!email || !email.includes('@')) { setPeer(null); return; }
    let alive = true;
    setPeerLoading(true);
    (async () => {
      try {
        const r = await apiFetch(`/api/businesses/${businessId}/email-addresses/${encodeURIComponent(email)}/threads?limit=${PEER_SHOWN + 1}`);
        const j = await r.json();
        if (!alive) return;
        if (!j.success) { setPeer(null); return; }
        const rows: PeerThread[] = (j.data || []).filter((x: PeerThread) => x.id !== thread.id).slice(0, PEER_SHOWN);
        const total = Math.max(0, Number(j.pagination?.total ?? (j.data || []).length) - 1);
        setPeer({ email, rows, total });
      } catch { if (alive) setPeer(null); }
      finally { if (alive) setPeerLoading(false); }
    })();
    return () => { alive = false; };
  }, [businessId, counterpartEmail, thread.id, thread.last_message_at]);
  // 자동·마케팅·스팸 메일엔 추출 버튼 숨김 (실 요청만 — 설계 §4)
  const canExtract = !thread.triage || thread.triage === 'human' || thread.triage === 'unknown';
  // 요약 (AI 스레드 요약 — Phase A 의 channel-summary 와 다름)
  const [aiSummary, setAiSummary] = useState<string | null>(thread.ai_summary || null);
  // 요약을 만든 시각보다 **뒤에 온 메일**이 있으면 다시 만들 이유가 있다. 없으면 버튼을 잠근다 —
  //   같은 입력에 같은 답을 주는 버튼은 누를 때마다 사용량만 태운다.
  const [aiSummaryAt, setAiSummaryAt] = useState<string | null>(thread.ai_summary_at || null);
  const summaryStale = useMemo(() => {
    if (!aiSummary || !aiSummaryAt) return true;
    const last = thread.last_message_at;
    if (!last) return false;
    return new Date(last).getTime() > new Date(aiSummaryAt).getTime();
  }, [aiSummary, aiSummaryAt, thread.last_message_at]);
  const [sumBusy, setSumBusy] = useState(false);
  const [sumError, setSumError] = useState<string | null>(null);  // #179 — 요약 실패 표면화
  // 이슈 / 노트
  const [issues, setIssues] = useState<Issue[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [iaBusy, setIaBusy] = useState(false);
  const [clients, setClients] = useState<Array<{ id: number; label: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: number; label: string }>>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sumLoading, setSumLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // 업무 리스트 갱신 신호 — 한 줄 등록·후보 승격 후 즉시 반영
  const [tasksKey, setTasksKey] = useState(0);
  // ★ 2026-09-09 (Irene: “업무후보 탭이 있는 건 업무추출버튼 나오는데 업무 추출도 못하네?
  //   그리고 없으면 없다고 알아야 하는데 버튼 누른 후 상황바뀌는 게 없어.”)
  //   추출은 돌고 있었다 — 결과(후보 또는 “찾지 못했어요”)를 **접힌 몸통 안**에 넣었을 뿐이다.
  //   후보가 0건이면 섹션이 닫힌 채라(defaultOpen={candidates.length > 0}) 헤더의 버튼만 보이고,
  //   눌러도 화면이 그대로였다. → 누른 뒤에는 **반드시 편다**. 결과를 못 보면 안 한 것과 같다
  //   (memory feedback_backend_done_ui_missing).
  const [candOpen, setCandOpen] = useState<boolean | null>(null);   // null = 아직 사용자가 안 건드림
  // 담당자 후보 — Cue(AI) 제외. 이 경로엔 Cue 자동 실행 트리거가 없어서 배정하면 좀비 업무가 된다
  //   (백엔드도 같은 이유로 플래너 풀에서 제외한다 — routes/tasks.js).
  const taskMembers = useMemo(
    () => members.filter((m) => !(m as { is_ai?: boolean; role?: string }).is_ai && (m as { role?: string }).role !== 'ai'),
    [members],
  );
  const lastClientRef = useRef<number | null>(null);

  const clientId = thread.client?.id ?? null;
  const projectId = thread.project?.id ?? null;

  // 고객·프로젝트 목록 (picker)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [rc, rp] = await Promise.all([
          apiFetch(`/api/clients/${businessId}`),
          apiFetch(`/api/projects/?business_id=${businessId}&status=active`),
        ]);
        const jc = await rc.json(); const jp = await rp.json();
        if (!alive) return;
        // 옵션 글자 = «이름 · 추가한 고객/초대 중/참여 중» (utils/clientLabel 한 벌 — 관계 값은 서버 access_kind)
        if (jc.success) setClients((jc.data || []).map((c: { id: number; display_name?: string; company_name?: string; access_kind?: string }) => ({ id: c.id, label: clientOptionLabel(c.display_name || c.company_name || `#${c.id}`, c, tAll) })));
        if (jp.success) setProjects((jp.data || []).map((p: { id: number; name?: string }) => ({ id: p.id, label: p.name || `#${p.id}` })));
      } catch { /* */ }
    })();
    return () => { alive = false; };
  }, [businessId, tAll]);

  // 이 고객 cross-channel 요약
  const loadSummary = useCallback(async (cid: number) => {
    setSumLoading(true);
    try {
      const r = await apiFetch(`/api/clients/${businessId}/${cid}/channel-summary`);
      const j = await r.json();
      setSummary(j.success ? j.data : null);
    } catch { setSummary(null); } finally { setSumLoading(false); }
  }, [businessId]);

  // Q sale 히스토리 요약 — **있는 것만 읽는다**(이 화면은 요약을 만들지 않는다 · LLM 0).
  //   메일 스레드 밖의 통화·미팅 맥락이 답장을 쓰기 전에 먼저 읽히는 자리다(docs/Q_SALE_DESIGN.md §10.7).
  const [clientSummary, setClientSummary] = useState<string | null>(null);
  const loadSaleSummary = useCallback(async (cid: number) => {
    try {
      const r = await apiFetch(`/api/sale/${businessId}/clients/${cid}/summary`);
      if (!r.ok) { setClientSummary(null); return; }   // qsale 권한이 없으면 403 — 조용히 안 그린다
      const j = await r.json();
      setClientSummary(j.success ? (j.data?.summary || null) : null);
    } catch { setClientSummary(null); }
  }, [businessId]);

  useEffect(() => {
    if (clientId && clientId !== lastClientRef.current) {
      lastClientRef.current = clientId;
      loadSummary(clientId);
      loadSaleSummary(clientId);
    }
    if (!clientId) { setSummary(null); setClientSummary(null); lastClientRef.current = null; }
  }, [clientId, loadSummary, loadSaleSummary]);

  // ★ 2026-09-09 — 고르면 즉시 저장되는데 **저장됐다는 표시가 없었다.**
  //   AutoSaveField 계약에 맞춰 가른다 — 래퍼가 onSave 를 부르므로 컨트롤이 저장까지 하면 두 번 나간다.
  //     · stageLink = 보낼 값을 모아 둔다(화면 값은 서버 응답으로 갱신된다 — onLinked)
  //     · persistLink = 래퍼가 부르는 실제 저장. 실패는 던져야 ! 가 뜬다.
  const pendingLinkRef = useRef<{ client_id?: number | null; project_id?: number | null } | null>(null);
  const stageLink = (patch: { client_id?: number | null; project_id?: number | null }) => {
    pendingLinkRef.current = { ...(pendingLinkRef.current || {}), ...patch };
  };
  const persistLink = useCallback(async () => {
    const patch = pendingLinkRef.current;
    pendingLinkRef.current = null;
    if (!patch) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'save_failed');
      onLinked();
    } finally { setBusy(false); }
  }, [businessId, thread.id, onLinked]);

  // 기존 pending 업무 후보 로드 (스레드 전환 시)
  useEffect(() => {
    let alive = true;
    setCandidates([]); setExtractMsg(null); setCandOpen(null);
    (async () => {
      try {
        const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/task-candidates`);
        const j = await r.json();
        if (alive && j.success) setCandidates(j.data || []);
      } catch { /* */ }
    })();
    return () => { alive = false; };
  }, [businessId, thread.id]);

  const extract = useCallback(async () => {
    if (extractBusy) return;
    setExtractBusy(true); setExtractMsg(null);
    setCandOpen(true);      // 결과를 볼 자리를 먼저 연다 — 0건이어도 “없다”가 보여야 한다
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/extract-tasks`, { method: 'POST' });
      const j = await r.json();
      if (r.status === 429) { setExtractMsg(t('context.usageLimit', { defaultValue: '이번 달 AI 사용량을 초과했어요.' }) as string); return; }
      // #179 — AI 미가동(503)을 "업무 없음"과 구분. 무반응처럼 보이던 것 표면화.
      if (r.status === 503) { setExtractMsg(t('context.aiUnavailable', { defaultValue: 'AI 서비스를 잠시 사용할 수 없어요. 잠시 후 다시 시도해 주세요.' }) as string); return; }
      if (j.success) {
        const got = j.data?.candidates || [];
        setCandidates((prev) => [...got, ...prev.filter(p => !got.some((g: Candidate) => g.id === p.id))]);
        if (got.length === 0) setExtractMsg(t('context.noTasksFound', { defaultValue: '추출할 업무를 찾지 못했어요.' }) as string);
      } else setExtractMsg(j.message || 'error');
    } finally { setExtractBusy(false); }
  }, [extractBusy, businessId, thread.id, t]);

  // #263/#377 — 상세 툴바의 "업무 추출" 진입점. 정본은 위 모듈 스코프 pendingExtract 다.
  const consumePendingExtract = useCallback(() => {
    if (!pendingExtract || pendingExtract.threadId !== thread.id) return;
    if (Date.now() - pendingExtract.at > PENDING_EXTRACT_TTL_MS) { pendingExtract = null; return; }
    pendingExtract = null;      // 먼저 비운다 — 두 경로(마운트·이벤트)가 겹쳐도 한 번만 돈다
    extract();
  }, [thread.id, extract]);

  // [Cue 의견 듣기] — 칸을 펴고 정해진 질문을 한 번 보낸다(보내는 것은 CuePanelSection).
  const [cueOpen, setCueOpen] = useState(false);
  const [cueAsk, setCueAsk] = useState<{ key: number; text: string; threadId: number } | null>(null);
  const consumePendingCueAdvice = useCallback(() => {
    if (!pendingCueAdvice || pendingCueAdvice.threadId !== thread.id) return;
    if (Date.now() - pendingCueAdvice.at > PENDING_EXTRACT_TTL_MS) { pendingCueAdvice = null; return; }
    pendingCueAdvice = null;
    cueAdviceSeq += 1;
    setCueOpen(true);
    setCueAsk({ key: cueAdviceSeq, threadId: thread.id, text: t('context.cueAdviceAsk', { defaultValue: '이 메일을 받고 내가 다음에 무엇을 하면 좋을지 의견을 줘. 답장 말고도 챙길 일(업무·일정·고객 기록·확인할 것)을 우선순위대로 3~5줄로 짧게 정리해 줘. 이 메일로 이미 만든 업무가 있으면 먼저 짚고, 바로 만들 만한 것이 있으면 카드로 제안해 줘.' }) as string });
  }, [thread.id, t]);
  useEffect(() => { consumePendingCueAdvice(); }, [consumePendingCueAdvice]);
  useEffect(() => {
    const on = () => consumePendingCueAdvice();
    window.addEventListener('qmail:cue-advice', on);
    return () => window.removeEventListener('qmail:cue-advice', on);
  }, [consumePendingCueAdvice]);

  // ① 늦게 마운트된 경우 — 접혀 있던 패널이 이제서야 뜬 경로 (#377 의 실제 회귀)
  useEffect(() => { consumePendingExtract(); }, [consumePendingExtract]);
  // ② 이미 떠 있던 경우 — window 이벤트로 즉시 깨운다 (같은 탭 안 안전망, CLAUDE.md 16-e)
  useEffect(() => {
    const onExtract = () => consumePendingExtract();
    window.addEventListener('qmail:extract-tasks', onExtract);
    return () => window.removeEventListener('qmail:extract-tasks', onExtract);
  }, [consumePendingExtract]);

  const register = useCallback(async (id: number, overrides: RegisterOverrides) => {
    if (rowBusy) return; setRowBusy(id);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/task-candidates/${id}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: overrides.title, assignee_id: overrides.assignee_id, start_date: overrides.start_date, due_date: overrides.due_date }),
      });
      if ((await r.json()).success) {
        setCandidates((prev) => prev.filter(p => p.id !== id));
        setTasksKey((k) => k + 1);   // 등록된 업무가 바로 아래 리스트에 나타나야 한다
      }
    } finally { setRowBusy(null); }
  }, [rowBusy, businessId, thread.id]);

  const reject = useCallback(async (id: number) => {
    if (rowBusy) return; setRowBusy(id);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/task-candidates/${id}/reject`, { method: 'POST' });
      if ((await r.json()).success) setCandidates((prev) => prev.filter(p => p.id !== id));
    } finally { setRowBusy(null); }
  }, [rowBusy, businessId, thread.id]);

  // 스레드 전환 시 요약 동기 + 이슈·노트 로드
  useEffect(() => {
    let alive = true;
    setAiSummary(thread.ai_summary || null);
    setAiSummaryAt(thread.ai_summary_at || null);
    (async () => {
      try {
        const [ri, rn] = await Promise.all([
          apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/issues`),
          apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/notes`),
        ]);
        const ji = await ri.json(); const jn = await rn.json();
        if (!alive) return;
        if (ji.success) setIssues(ji.data || []);
        if (jn.success) setNotes(jn.data || []);
      } catch { /* */ }
    })();
    return () => { alive = false; };
  }, [businessId, thread.id, thread.ai_summary]);

  const summarize = useCallback(async () => {
    if (sumBusy) return; setSumBusy(true); setSumError(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/summarize`, { method: 'POST' });
      const j = await r.json();
      // #179 — 여태 실패(503/429/네트워크)해도 조용히 죽어 "무반응"으로 보였다. 실패를 표면화한다.
      if (j.success) { setAiSummary(j.data?.ai_summary || null); setAiSummaryAt(j.data?.ai_summary_at || new Date().toISOString()); }
      else setSumError(j.message || 'failed');
    } catch { setSumError('network'); }
    finally { setSumBusy(false); }
  }, [sumBusy, businessId, thread.id]);

  // ★ 성공 여부를 돌려준다 — NoteThread 는 true 일 때만 쓰던 초안을 비운다(실패·처리 중이면 글이 남아야 한다).
  const addIssue = useCallback(async (body: string): Promise<boolean> => {
    if (!body.trim() || iaBusy) return false; setIaBusy(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/issues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      const j = await r.json().catch(() => null);
      if (!j?.success) return false;
      setIssues(p => [...p, j.data]);
      return true;
    } catch { return false; } finally { setIaBusy(false); }
  }, [iaBusy, businessId, thread.id]);

  const deleteIssue = useCallback(async (id: number) => {
    const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/issues/${id}`, { method: 'DELETE' });
    if ((await r.json()).success) setIssues(p => p.filter(x => x.id !== id));
  }, [businessId, thread.id]);

  const addNote = useCallback(async (body: string, visibility: 'internal' | 'personal'): Promise<boolean> => {
    if (!body.trim() || iaBusy) return false; setIaBusy(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, visibility }) });
      const j = await r.json().catch(() => null);
      if (!j?.success) return false;
      setNotes(p => [...p, j.data]);
      return true;
    } catch { return false; } finally { setIaBusy(false); }
  }, [iaBusy, businessId, thread.id]);

  const deleteNote = useCallback(async (id: number) => {
    const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/notes/${id}`, { method: 'DELETE' });
    if ((await r.json()).success) setNotes(p => p.filter(x => x.id !== id));
  }, [businessId, thread.id]);


  const clientOptions = useMemo(() => [{ value: 0, label: t('context.noClient', { defaultValue: '연결 안 함' }) as string }, ...clients.map(c => ({ value: c.id, label: c.label }))], [clients, t]);
  const projectOptions = useMemo(() => [{ value: 0, label: t('context.noProject', { defaultValue: '연결 안 함' }) as string }, ...projects.map(p => ({ value: p.id, label: p.label }))], [projects, t]);

  const channelLabel = (c: Channel) => t(`context.channel.${c}`, { defaultValue: c }) as string;

  return (
    <Wrap>
      {/* ★ 2026-09-09 (Irene: “요약확인이랑 우측 요약생성이랑 차이가 뭘까 … 버튼에서 다르게 할까?
          아니면 주요내용 요약이라고 할까? 그리고 다시요약이 의미가 있어? 계속 누르면 뭘 다르게 해?”)
          두 기능은 **역할이 다르다**. 통일하지 않고 이름으로 가른다:
            · 본문 위 “메일 내용 요약”  = 이 메일을 **판단**한다 (요약 + 스팸점수·발신인증·주고받은 횟수)
            · 여기 “주요 내용”          = 스레드 전체를 **읽는다**
          “다시 요약” 은 없앴다 — 같은 입력에 같은 답이라 누를 이유가 없었다. 스레드에 새 메일이
          들어왔을 때만 뜻이 있으므로 그때만 “새 메일 반영” 으로 바뀐다. */}
      <WorkbenchSection
        title={t('context.summaryTitle', { defaultValue: '주요 내용' }) as string}
        action={(
          <AiAssistButton
            onClick={summarize}
            loading={sumBusy}
            icon={(
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="16" y2="12" /><line x1="4" y1="18" x2="11" y2="18" />
              </svg>
            )}
            label={sumBusy ? t('context.summarizing', { defaultValue: '요약 중…' }) as string
              : !aiSummary ? t('context.summarize', { defaultValue: '주요 내용 만들기' }) as string
              : summaryStale ? t('context.refreshSummary', { defaultValue: '새 메일 반영' }) as string
              : t('context.summaryUpToDate', { defaultValue: '최신 상태' }) as string}
            disabled={!!aiSummary && !summaryStale}
            title={t('context.summaryHint', { defaultValue: '긴 스레드를 AI가 핵심만 요약해요.' }) as string}
          />
        )}
      >
        {sumError
          ? <SummaryError>{t('context.summaryFailed', { defaultValue: '요약을 만들지 못했어요. 잠시 후 다시 시도해 주세요.' }) as string}</SummaryError>
          : aiSummary
            ? <SummaryBox>{aiSummary}</SummaryBox>
            : <WorkbenchEmptyRow>{t('context.summaryHint', { defaultValue: '긴 스레드를 AI가 핵심만 요약해요.' }) as string}</WorkbenchEmptyRow>}
      </WorkbenchSection>

      {counterpartEmail && (
        <WorkbenchSection
          title={t('context.peerTitle', { defaultValue: '이 사람과 오간 메일' }) as string}
          count={peer ? peer.total : undefined}
        >
          {peerLoading && !peer ? (
            <WorkbenchEmptyRow>{t('context.loading', { defaultValue: '불러오는 중…' }) as string}</WorkbenchEmptyRow>
          ) : peer && peer.rows.length > 0 ? (
            <>
              <PeerList data-testid="mail-peer-threads">
                {peer.rows.map((x) => {
                  const out = x.last_message_direction === 'outbound';
                  return (
                    <PeerRow key={x.id} type="button" data-testid="mail-peer-thread" data-direction={out ? 'out' : 'in'}
                      onClick={() => onOpenThread?.(x.id)} title={x.subject || ''}>
                      <PeerDir $out={out}>{t(out ? 'context.peerSent' : 'context.peerReceived', { defaultValue: out ? '보낸' : '받은' }) as string}</PeerDir>
                      <PeerSubject>{x.subject || t('context.peerNoSubject', { defaultValue: '(제목 없음)' }) as string}</PeerSubject>
                      <PeerTime>{formatTimeAgo(x.last_message_at || '')}</PeerTime>
                    </PeerRow>
                  );
                })}
              </PeerList>
              {onViewAddress && (
                <WorkbenchSectionLink type="button" data-testid="mail-peer-all" onClick={() => onViewAddress(peer.email)}>
                  {t('context.peerAll', { count: peer.total, defaultValue: '모두 보기 ({{count}})' }) as string}<span aria-hidden>›</span>
                </WorkbenchSectionLink>
              )}
            </>
          ) : (
            <WorkbenchEmptyRow>{t('context.peerEmpty', { defaultValue: '이 메일 말고는 오간 메일이 없어요.' }) as string}</WorkbenchEmptyRow>
          )}
        </WorkbenchSection>
      )}

      {/* 한 줄 업무 등록 — AI 추출이 못 찾아도 사람이 바로 적는다. 이름을 지목하면 요청 업무가 된다. */}
      <WorkbenchSection title={t('context.quickAddTitle', { defaultValue: '한 줄 업무 등록' }) as string} static>
        <CueTaskBar
          businessId={businessId}
          members={taskMembers}
          projectId={projectId}
          context={{ email_thread_id: thread.id }}
          compact
          onCreated={() => setTasksKey((k) => k + 1)}
        />
      </WorkbenchSection>

      {/* #227 — Cue 에게 묻기. 스레드를 보면서 그대로 물을 수 있다(서버가 `?thread=` 로 읽는다).
          ★ 이 패널은 접으면 **언마운트된다** — 대화 보존은 CuePanelSection 의 캐시가 맡는다.
            (같은 파일 #377 주석이 이미 이 함정을 박제하고 있다.) */}
      <WorkbenchSection title={t('context.cueTitle', { defaultValue: 'Cue 에게 묻기' }) as string} open={cueOpen} onToggle={() => setCueOpen((v) => !v)}>
        <CuePanelSection
          // 그 메일에 건넨 질문만 — 다른 메일로 옮기면 옛 질문이 새 메일로 가지 않는다.
          autoAsk={cueAsk && cueAsk.threadId === thread.id ? cueAsk : null}
          surface="qmail"
          subjectId={thread.id}
          location={{ pathname: chromeLoc.pathname, search: chromeLoc.search }}
          contextParam={{ key: 'thread', id: thread.id }}
          placeholder={t('context.cueEmpty', { defaultValue: '이 메일 내용을 그대로 물어보세요. 업무·일정 추가도 여기서 됩니다.' }) as string}
          testId="qmail-cue-section"
        />
      </WorkbenchSection>

      {/* 업무 후보 (AI 추출) */}
      <WorkbenchSection
        title={t('context.tasksTitle', { defaultValue: '업무 후보' }) as string}
        count={candidates.length}
        open={candOpen ?? (candidates.length > 0 || !!extractMsg)}
        onToggle={() => setCandOpen((v) => !(v ?? (candidates.length > 0 || !!extractMsg)))}
        action={canExtract ? (
          <AiAssistButton
            onClick={extract}
            loading={extractBusy}
            label={extractBusy
              ? (t('context.extracting', { defaultValue: '추출 중…' }) as string)
              : (t('context.extract', { defaultValue: '업무 추출' }) as string)}
            title={t('context.extractHint', { defaultValue: 'AI 가 이 메일에서 할 일 후보를 뽑아냅니다' }) as string}
          />
        ) : null}
      >
        {extractMsg && <WorkbenchEmptyRow>{extractMsg}</WorkbenchEmptyRow>}
        {candidates.length === 0 && !extractMsg ? (
          <WorkbenchEmptyRow>{canExtract
            ? t('context.tasksHint', { defaultValue: '메일 본문에서 할 일을 자동으로 뽑아 Q Task로 등록해요.' }) as string
            : t('context.tasksGated', { defaultValue: '자동·마케팅 메일에서는 업무를 추출하지 않아요.' }) as string}</WorkbenchEmptyRow>
        ) : (
          <CandList>
            {candidates.map((c) => (
              <TaskCandidateCard
                key={c.id}
                candidate={{
                  id: c.id,
                  title: c.title,
                  description: c.description,
                  guessed_assignee: c.guessedAssignee ? { user_id: c.guessedAssignee.id, name: c.guessedAssignee.name } : (c.guessed_assignee_user_id ? { user_id: c.guessed_assignee_user_id, name: members.find(m => m.user_id === c.guessed_assignee_user_id)?.name || '' } : null),
                  guessed_due_date: c.guessed_due_date,
                }}
                members={taskMembers}
                busy={rowBusy === c.id}
                onRegister={register}
                onReject={reject}
              />
            ))}
          </CandList>
        )}
      </WorkbenchSection>

      {/* 업무 — 프로젝트 업무 / 내 할 일 / 요청한 업무 */}
      <ContextTaskList
        businessId={businessId}
        emailThreadId={thread.id}
        reloadKey={tasksKey}
      />

      {/* 이슈 */}
      <WorkbenchSection
        title={t('context.issuesTitle', { defaultValue: '이슈' }) as string}
        count={issues.length}
        defaultOpen={issues.length > 0}
      >
        <NoteThread
          notes={issues.map((it) => ({ ...it, visibility: 'internal' }))}
          myUserId={myUserId}
          canChooseVisibility={false}
          busy={iaBusy}
          formatTime={formatTimeAgo}
          onAdd={addIssue}
          onDelete={deleteIssue}
          draftKind="mail-issue"
          draftEntityId={thread.id}
          draftBizId={businessId}
          draftLegacyKey={`planq:draft:mail-issue:${myUserId || 0}:${thread.id}`}
          emptyText={t('context.issuesEmpty', { defaultValue: '아직 이슈가 없습니다' }) as string}
          placeholder={t('context.issuePh', { defaultValue: '이슈 작성... (Enter 저장 · Shift+Enter 줄바꿈)' }) as string}
        />
      </WorkbenchSection>

      {/* 메모 */}
      <WorkbenchSection
        title={(projectId
          ? t('context.notesTitleProject', { defaultValue: '프로젝트 메모' })
          : t('context.notesTitle', { defaultValue: '메모' })) as string}
        count={notes.length}
        defaultOpen={notes.length > 0}
      >
        <NoteThread
          notes={notes}
          myUserId={myUserId}
          busy={iaBusy}
          formatTime={formatTimeAgo}
          onAdd={addNote}
          onDelete={deleteNote}
          draftKind="mail-note"
          draftEntityId={thread.id}
          draftBizId={businessId}
          draftLegacyKey={`planq:draft:mail-note:${myUserId || 0}:${thread.id}`}
          emptyText={t('context.notesEmpty', { defaultValue: '아직 메모가 없습니다' }) as string}
          placeholder={t('context.notePh', { defaultValue: '메모 작성... (Enter 저장 · Shift+Enter 줄바꿈)' }) as string}
        />
      </WorkbenchSection>

      {/* 프로젝트 */}
      <WorkbenchSection title={t('context.project', { defaultValue: '프로젝트' }) as string} static>
        <AutoSaveField type="select" onSave={persistLink}>
          <PlanQSelect size="sm" isSearchable isDisabled={busy}
            value={projectOptions.find(o => o.value === (projectId || 0))}
            onChange={(opt: unknown) => { const v = (opt as { value?: number } | null)?.value || 0; stageLink({ project_id: v > 0 ? v : null }); }}
            options={projectOptions} menuPlacement="top" />
        </AutoSaveField>
      </WorkbenchSection>

      {/* 고객 — 연결하면 그 고객의 채널 활동 + 통합 타임라인 */}
      <WorkbenchSection title={t('context.client', { defaultValue: '고객' }) as string} static>
        <AutoSaveField type="select" onSave={persistLink}>
          <PlanQSelect size="sm" isSearchable isDisabled={busy}
            value={clientOptions.find(o => o.value === (clientId || 0))}
            onChange={(opt: unknown) => { const v = (opt as { value?: number } | null)?.value || 0; stageLink({ client_id: v > 0 ? v : null }); }}
            options={clientOptions} menuPlacement="top" />
        </AutoSaveField>
        {/* 2026-10-23 — 목록에 없으면 이 자리에서 추가하고 바로 이 메일에 붙인다(셀렉트 안에 넣지 않는다 — PlanQSelect 포털) */}
        {!clientId && onAddClient && (
          <AddClientBtn type="button" onClick={onAddClient} data-testid="mail-context-add-client">
            {t('context.addClient') as string}
          </AddClientBtn>
        )}
        {clientId && (
          sumLoading ? (
            <WorkbenchEmptyRow>{t('context.loading', { defaultValue: '불러오는 중…' }) as string}</WorkbenchEmptyRow>
          ) : summary ? (
            <>
              <CountRow>
                {CHANNELS.map(c => (
                  <CountChip key={c} $type={c}>
                    <CountNum>{summary.counts[c] || 0}</CountNum>
                    <CountLbl>{channelLabel(c)}</CountLbl>
                  </CountChip>
                ))}
              </CountRow>
              <RecentList>
                {CHANNELS.filter(c => summary.latest[c]).map(c => {
                  const it = summary.latest[c]!;
                  return (
                    <RecentRow key={c}>
                      <RecentType $type={c}>{channelLabel(c)}</RecentType>
                      <RecentText title={it.title || ''}>{it.title || it.preview || '—'}</RecentText>
                    </RecentRow>
                  );
                })}
              </RecentList>
              {/* Q sale 히스토리 요약 2줄 — 메일 스레드 밖(통화·미팅)의 맥락을 여기서 먼저 읽는다(§10.7).
                  ★ 요약을 **여기서 만들지 않는다**(LLM 0) — 있는 것만 보여주고 갱신은 Q sale 상세에서 한다. */}
              {clientSummary && (
                <SaleSummaryBox>
                  <SaleSummaryText>{clientSummary}</SaleSummaryText>
                </SaleSummaryBox>
              )}
              <WorkbenchSectionLink type="button" onClick={() => navigate(`/sale/${clientId}`)}>
                {t('context.openInSale', { defaultValue: 'Q sales 에서 보기' }) as string}<span aria-hidden>›</span>
              </WorkbenchSectionLink>
              {/* (2026-10-16) «통합 타임라인 보기» 는 없앴다 — Q sale 상세가 같은 타임라인이다(같은 곳을 가리키는 링크 두 개) */}
            </>
          ) : (
            <WorkbenchEmptyRow>{t('context.noActivity', { defaultValue: '아직 다른 채널 활동이 없어요.' }) as string}</WorkbenchEmptyRow>
          )
        )}
      </WorkbenchSection>
    </Wrap>
  );
};

export default MailContextPanel;

const Wrap = styled.div`flex:1; min-height:0; overflow-y:auto;`;
const AddClientBtn = styled.button`
  align-self:flex-start; margin-top:6px; min-height:32px; padding:0 10px; border-radius:8px;
  border:1px dashed #CBD5E1; background:#FFF; color:#0F766E; font-size:0.75rem; font-weight:600; cursor:pointer;
  &:hover{ border-color:#14B8A6; background:#F0FDFA; }
  &:focus-visible{ outline:none; box-shadow:0 0 0 3px rgba(20,184,166,0.2); }
`;
// Q Talk ChatPanel:3430 과 동일 — 같은 기능은 어느 화면에서든 같은 모양 (teal + 체크박스 아이콘)
const CandList = styled.div`display:flex; flex-direction:column; gap:8px;`;
const SummaryBox = styled.div`font-size:0.75rem; color:#334155; line-height:1.6; white-space:pre-wrap; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px 12px;`;
const SummaryError = styled.div`font-size:0.75rem; color:#B91C1C; line-height:1.5; background:#FEF2F2; border:1px solid #FECACA; border-radius:10px; padding:10px 12px;`;
const typeColor: Record<Channel, { bg: string; fg: string }> = {
  chat: { bg: '#F0FDFA', fg: '#0F766E' },
  email: { bg: '#EFF6FF', fg: '#1D4ED8' },
  task: { bg: '#FEF3C7', fg: '#92400E' },
  invoice: { bg: '#F0FDFA', fg: '#0F766E' },
};
const CountRow = styled.div`display:grid; grid-template-columns:repeat(4,1fr); gap:6px;`;
const CountChip = styled.div<{ $type: Channel }>`
  display:flex; flex-direction:column; align-items:center; gap:1px; padding:8px 4px; border-radius:10px;
  background:${p => typeColor[p.$type].bg};
`;
const CountNum = styled.span<{}>`font-size:1rem; font-weight:700; color:#0F172A;`;
const CountLbl = styled.span`font-size:0.625rem; font-weight:600; color:#64748B;`;
const RecentList = styled.div`display:flex; flex-direction:column; gap:6px;`;
const RecentRow = styled.div`display:flex; align-items:center; gap:6px; min-width:0;`;
const RecentType = styled.span<{ $type: Channel }>`
  flex-shrink:0; font-size:0.625rem; font-weight:700; padding:1px 6px; border-radius:999px;
  background:${p => typeColor[p.$type].bg}; color:${p => typeColor[p.$type].fg};
`;
const PeerList = styled.div`display:flex; flex-direction:column; gap:2px;`;
const PeerRow = styled.button`
  display:flex; align-items:center; gap:6px; min-width:0; width:100%;
  border:none; background:none; padding:6px 4px; border-radius:8px; cursor:pointer; text-align:left;
  &:hover { background:#F8FAFC; }
  &:focus-visible { outline:2px solid #14B8A6; outline-offset:1px; }
`;
// 보낸(우리 → 상대) / 받은(상대 → 우리) — 고객 히스토리 배지와 같은 색(ClientTimeline: 받은 파랑 · 보낸 청록)
const PeerDir = styled.span<{ $out: boolean }>`
  flex-shrink:0; font-size:0.625rem; font-weight:700; padding:1px 6px; border-radius:999px;
  background:${p => (p.$out ? '#F0FDFA' : '#EFF6FF')}; color:${p => (p.$out ? '#0F766E' : '#1D4ED8')};
`;
const PeerSubject = styled.span`flex:1; min-width:0; font-size:0.75rem; color:#334155; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`;
const PeerTime = styled.span`flex-shrink:0; font-size:0.6875rem; color:#94A3B8;`;
const RecentText = styled.span`font-size:0.75rem; color:#475569; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`;
/* Q sale 히스토리 요약 2줄 — 길면 자른다(패널은 좁고, 전문은 Q sale 상세에 있다) */
const SaleSummaryBox = styled.div`background:#F0FDFA; border:1px solid #CCFBF1; border-radius:10px; padding:8px 10px;`;
const SaleSummaryText = styled.div`
  font-size:0.75rem; color:#0F766E; line-height:1.5;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
`;
