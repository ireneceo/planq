// Q Mail 우측 컨텍스트 패널 (사이클 N+87 Phase A) — Q Talk 우측 패널 패턴 이식.
//   프로젝트·고객 picker (EmailThread.client_id/project_id) + 고객 cross-channel(channel-summary).
//   ★ 요약/업무후보/이슈/노트는 Phase B/C — 여기선 연결 + cross-channel 만 (mock 금지: 실 데이터만).
//   설계: docs/QMAIL_CONTEXT_DESIGN.md §5, §7.1
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import PlanQSelect from '../../components/Common/PlanQSelect';
import TaskCandidateCard, { type RegisterOverrides } from '../../components/Common/TaskCandidateCard';
import AiAssistButton from '../../components/Common/AiAssistButton';
import NoteThread from '../../components/Common/NoteThread';
import WorkbenchSection, { WorkbenchEmptyRow, WorkbenchSectionLink } from '../../components/Workbench/WorkbenchSection';
import ContextTaskList from '../../components/Workbench/ContextTaskList';
import CueTaskBar from '../../components/QTask/CueTaskBar';
import { useTimeFormat } from '../../hooks/useTimeFormat';

interface ThreadLite {
  id: number;
  triage?: string | null;
  ai_summary?: string | null;
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
}
type Channel = 'chat' | 'email' | 'task' | 'invoice';
interface Summary {
  counts: Record<Channel, number>;
  latest: Partial<Record<Channel, { title: string | null; preview?: string; at: string }>>;
}

const CHANNELS: Channel[] = ['chat', 'email', 'task', 'invoice'];

const MailContextPanel: React.FC<Props> = ({ businessId, thread, members, myUserId, onLinked }) => {
  const { t } = useTranslation('qmail');
  const { formatTimeAgo } = useTimeFormat();
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  // 자동·마케팅·스팸 메일엔 추출 버튼 숨김 (실 요청만 — 설계 §4)
  const canExtract = !thread.triage || thread.triage === 'human' || thread.triage === 'unknown';
  // 요약 (AI 스레드 요약 — Phase A 의 channel-summary 와 다름)
  const [aiSummary, setAiSummary] = useState<string | null>(thread.ai_summary || null);
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
        if (jc.success) setClients((jc.data || []).map((c: { id: number; display_name?: string; company_name?: string }) => ({ id: c.id, label: c.display_name || c.company_name || `#${c.id}` })));
        if (jp.success) setProjects((jp.data || []).map((p: { id: number; name?: string }) => ({ id: p.id, label: p.name || `#${p.id}` })));
      } catch { /* */ }
    })();
    return () => { alive = false; };
  }, [businessId]);

  // 이 고객 cross-channel 요약
  const loadSummary = useCallback(async (cid: number) => {
    setSumLoading(true);
    try {
      const r = await apiFetch(`/api/clients/${businessId}/${cid}/channel-summary`);
      const j = await r.json();
      setSummary(j.success ? j.data : null);
    } catch { setSummary(null); } finally { setSumLoading(false); }
  }, [businessId]);

  useEffect(() => {
    if (clientId && clientId !== lastClientRef.current) { lastClientRef.current = clientId; loadSummary(clientId); }
    if (!clientId) { setSummary(null); lastClientRef.current = null; }
  }, [clientId, loadSummary]);

  const link = useCallback(async (patch: { client_id?: number | null; project_id?: number | null }) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      if ((await r.json()).success) onLinked();
    } finally { setBusy(false); }
  }, [busy, businessId, thread.id, onLinked]);

  // 기존 pending 업무 후보 로드 (스레드 전환 시)
  useEffect(() => {
    let alive = true;
    setCandidates([]); setExtractMsg(null);
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
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/extract-tasks`, { method: 'POST' });
      const j = await r.json();
      if (r.status === 429) { setExtractMsg(t('context.usageLimit', { defaultValue: '이번 달 AI 사용량을 초과했어요.' }) as string); return; }
      if (j.success) {
        const got = j.data?.candidates || [];
        setCandidates((prev) => [...got, ...prev.filter(p => !got.some((g: Candidate) => g.id === p.id))]);
        if (got.length === 0) setExtractMsg(t('context.noTasksFound', { defaultValue: '추출할 업무를 찾지 못했어요.' }) as string);
      } else setExtractMsg(j.message || 'error');
    } finally { setExtractBusy(false); }
  }, [extractBusy, businessId, thread.id, t]);

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
      if (j.success) setAiSummary(j.data?.ai_summary || null);
      else setSumError(j.message || 'failed');
    } catch { setSumError('network'); }
    finally { setSumBusy(false); }
  }, [sumBusy, businessId, thread.id]);

  const addIssue = useCallback(async (body: string) => {
    if (!body.trim() || iaBusy) return; setIaBusy(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/issues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      const j = await r.json(); if (j.success) setIssues(p => [...p, j.data]);
    } finally { setIaBusy(false); }
  }, [iaBusy, businessId, thread.id]);

  const deleteIssue = useCallback(async (id: number) => {
    const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/issues/${id}`, { method: 'DELETE' });
    if ((await r.json()).success) setIssues(p => p.filter(x => x.id !== id));
  }, [businessId, thread.id]);

  const addNote = useCallback(async (body: string, visibility: 'internal' | 'personal') => {
    if (!body.trim() || iaBusy) return; setIaBusy(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, visibility }) });
      const j = await r.json(); if (j.success) setNotes(p => [...p, j.data]);
    } finally { setIaBusy(false); }
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
      {/* 요약 — 긴 스레드를 먼저 파악 (읽기 보조) */}
      <WorkbenchSection
        title={t('context.summaryTitle', { defaultValue: '요약' }) as string}
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
              : aiSummary ? t('context.resummarize', { defaultValue: '다시 요약' }) as string
              : t('context.summarize', { defaultValue: '요약 생성' }) as string}
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

      {/* 업무 후보 (AI 추출) */}
      <WorkbenchSection
        title={t('context.tasksTitle', { defaultValue: '업무 후보' }) as string}
        count={candidates.length}
        defaultOpen={candidates.length > 0}
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
          emptyText={t('context.issuesEmpty', { defaultValue: '아직 이슈가 없습니다' }) as string}
          placeholder={t('context.issuePh', { defaultValue: '이슈 작성... (⌘/Ctrl+Enter 저장)' }) as string}
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
          emptyText={t('context.notesEmpty', { defaultValue: '아직 메모가 없습니다' }) as string}
          placeholder={t('context.notePh', { defaultValue: '메모 작성... (⌘/Ctrl+Enter 저장)' }) as string}
        />
      </WorkbenchSection>

      {/* 프로젝트 */}
      <WorkbenchSection title={t('context.project', { defaultValue: '프로젝트' }) as string} static>
        <PlanQSelect size="sm" isSearchable isDisabled={busy}
          value={projectOptions.find(o => o.value === (projectId || 0))}
          onChange={(opt: unknown) => { const v = (opt as { value?: number } | null)?.value || 0; link({ project_id: v > 0 ? v : null }); }}
          options={projectOptions} menuPlacement="top" />
      </WorkbenchSection>

      {/* 고객 — 연결하면 그 고객의 채널 활동 + 통합 타임라인 */}
      <WorkbenchSection title={t('context.client', { defaultValue: '고객' }) as string} static>
        <PlanQSelect size="sm" isSearchable isDisabled={busy}
          value={clientOptions.find(o => o.value === (clientId || 0))}
          onChange={(opt: unknown) => { const v = (opt as { value?: number } | null)?.value || 0; link({ client_id: v > 0 ? v : null }); }}
          options={clientOptions} menuPlacement="top" />
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
              <WorkbenchSectionLink type="button" onClick={() => navigate(`/business/clients/${clientId}/timeline`)}>
                {t('context.openTimeline', { defaultValue: '통합 타임라인 보기' }) as string}<span aria-hidden>›</span>
              </WorkbenchSectionLink>
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
// Q Talk ChatPanel:3430 과 동일 — 같은 기능은 어느 화면에서든 같은 모양 (teal + 체크박스 아이콘)
const CandList = styled.div`display:flex; flex-direction:column; gap:8px;`;
const SummaryBox = styled.div`font-size:12px; color:#334155; line-height:1.6; white-space:pre-wrap; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px 12px;`;
const SummaryError = styled.div`font-size:12px; color:#B91C1C; line-height:1.5; background:#FEF2F2; border:1px solid #FECACA; border-radius:10px; padding:10px 12px;`;
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
const CountNum = styled.span<{}>`font-size:16px; font-weight:700; color:#0F172A;`;
const CountLbl = styled.span`font-size:10px; font-weight:600; color:#64748B;`;
const RecentList = styled.div`display:flex; flex-direction:column; gap:6px;`;
const RecentRow = styled.div`display:flex; align-items:center; gap:6px; min-width:0;`;
const RecentType = styled.span<{ $type: Channel }>`
  flex-shrink:0; font-size:10px; font-weight:700; padding:1px 6px; border-radius:999px;
  background:${p => typeColor[p.$type].bg}; color:${p => typeColor[p.$type].fg};
`;
const RecentText = styled.span`font-size:12px; color:#475569; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`;
