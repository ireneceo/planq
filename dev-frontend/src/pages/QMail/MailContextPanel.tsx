// Q Mail 우측 컨텍스트 패널 (사이클 N+87 Phase A) — Q Talk 우측 패널 패턴 이식.
//   연결: 프로젝트·고객 picker (EmailThread.client_id/project_id) + "이 고객" cross-channel(channel-summary).
//   ★ 요약/업무후보/이슈/노트는 Phase B/C — 여기선 연결 + cross-channel 만 (mock 금지: 실 데이터만).
//   설계: docs/QMAIL_CONTEXT_DESIGN.md §5, §7.1
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import PlanQSelect from '../../components/Common/PlanQSelect';
import TaskCandidateCard, { type RegisterOverrides } from '../../components/Common/TaskCandidateCard';

interface ThreadLite {
  id: number;
  triage?: string | null;
  ai_summary?: string | null;
  client?: { id: number; display_name?: string; company_name?: string } | null;
  project?: { id: number; name?: string } | null;
}
interface Issue { id: number; body: string; author_user_id: number }
interface Note { id: number; body: string; visibility: string; author_user_id: number }
interface Member { user_id: number; name: string }
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
  onLinked: () => void; // 연결 변경 후 상세 새로고침
}
type Channel = 'chat' | 'email' | 'task' | 'invoice';
interface Summary {
  counts: Record<Channel, number>;
  latest: Partial<Record<Channel, { title: string | null; preview?: string; at: string }>>;
}

const CHANNELS: Channel[] = ['chat', 'email', 'task', 'invoice'];

const MailContextPanel: React.FC<Props> = ({ businessId, thread, members, onLinked }) => {
  const { t } = useTranslation('qmail');
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
  // 이슈 / 노트
  const [issues, setIssues] = useState<Issue[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newIssue, setNewIssue] = useState('');
  const [newNote, setNewNote] = useState('');
  const [notePersonal, setNotePersonal] = useState(false);
  const [iaBusy, setIaBusy] = useState(false);
  const [clients, setClients] = useState<Array<{ id: number; label: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: number; label: string }>>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sumLoading, setSumLoading] = useState(false);
  const [busy, setBusy] = useState(false);
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
      if ((await r.json()).success) setCandidates((prev) => prev.filter(p => p.id !== id));
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
    setAiSummary(thread.ai_summary || null); setNewIssue(''); setNewNote('');
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
    if (sumBusy) return; setSumBusy(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/summarize`, { method: 'POST' });
      const j = await r.json();
      if (j.success) setAiSummary(j.data?.ai_summary || null);
    } finally { setSumBusy(false); }
  }, [sumBusy, businessId, thread.id]);

  const addIssue = useCallback(async () => {
    const body = newIssue.trim(); if (!body || iaBusy) return; setIaBusy(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/issues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      const j = await r.json(); if (j.success) { setIssues(p => [j.data, ...p]); setNewIssue(''); }
    } finally { setIaBusy(false); }
  }, [newIssue, iaBusy, businessId, thread.id]);

  const deleteIssue = useCallback(async (id: number) => {
    const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/issues/${id}`, { method: 'DELETE' });
    if ((await r.json()).success) setIssues(p => p.filter(x => x.id !== id));
  }, [businessId, thread.id]);

  const addNote = useCallback(async () => {
    const body = newNote.trim(); if (!body || iaBusy) return; setIaBusy(true);
    try {
      const visibility = notePersonal ? 'personal' : 'internal';
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, visibility }) });
      const j = await r.json(); if (j.success) { setNotes(p => [...p, j.data]); setNewNote(''); }
    } finally { setIaBusy(false); }
  }, [newNote, notePersonal, iaBusy, businessId, thread.id]);

  const deleteNote = useCallback(async (id: number) => {
    const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/notes/${id}`, { method: 'DELETE' });
    if ((await r.json()).success) setNotes(p => p.filter(x => x.id !== id));
  }, [businessId, thread.id]);


  const clientOptions = useMemo(() => [{ value: 0, label: t('context.noClient', { defaultValue: '연결 안 함' }) as string }, ...clients.map(c => ({ value: c.id, label: c.label }))], [clients, t]);
  const projectOptions = useMemo(() => [{ value: 0, label: t('context.noProject', { defaultValue: '연결 안 함' }) as string }, ...projects.map(p => ({ value: p.id, label: p.label }))], [projects, t]);

  const channelLabel = (c: Channel) => t(`context.channel.${c}`, { defaultValue: c }) as string;

  return (
    <Wrap>
      <Section>
        <SecHead>
          <SecTitle>{t('context.summaryTitle', { defaultValue: '요약' }) as string}</SecTitle>
          <ExtractBtn type="button" onClick={summarize} disabled={sumBusy}>
            {sumBusy ? t('context.summarizing', { defaultValue: '요약 중…' }) as string
              : aiSummary ? t('context.resummarize', { defaultValue: '다시 요약' }) as string
              : t('context.summarize', { defaultValue: '요약 생성' }) as string}
          </ExtractBtn>
        </SecHead>
        {aiSummary ? <SummaryBox>{aiSummary}</SummaryBox>
          : <Dim>{t('context.summaryHint', { defaultValue: '긴 스레드를 AI가 핵심만 요약해요.' }) as string}</Dim>}
      </Section>

      <Section>
        <SecTitle>{t('context.linkTitle', { defaultValue: '연결' }) as string}</SecTitle>
        <Field>
          <Lbl>{t('context.client', { defaultValue: '고객' }) as string}</Lbl>
          <PlanQSelect size="sm" isSearchable isDisabled={busy}
            value={clientOptions.find(o => o.value === (clientId || 0))}
            onChange={(opt: unknown) => { const v = (opt as { value?: number } | null)?.value || 0; link({ client_id: v > 0 ? v : null }); }}
            options={clientOptions} menuPlacement="bottom" />
        </Field>
        <Field>
          <Lbl>{t('context.project', { defaultValue: '프로젝트' }) as string}</Lbl>
          <PlanQSelect size="sm" isSearchable isDisabled={busy}
            value={projectOptions.find(o => o.value === (projectId || 0))}
            onChange={(opt: unknown) => { const v = (opt as { value?: number } | null)?.value || 0; link({ project_id: v > 0 ? v : null }); }}
            options={projectOptions} menuPlacement="bottom" />
        </Field>
      </Section>

      <Section>
        <SecHead>
          <SecTitle>{t('context.tasksTitle', { defaultValue: '업무 후보' }) as string}{candidates.length > 0 && <CountBadge>{candidates.length}</CountBadge>}</SecTitle>
          {canExtract && (
            /* Q Talk ChatPanel 의 업무 추출 버튼과 동일 (teal 계열 + 체크박스 아이콘).
               Q Mail 만 rose 계열 + ✨ 이모지라 같은 기능이 화면마다 달라 보였다. */
            <ExtractBtn type="button" onClick={extract} disabled={extractBusy}>
              {extractBusy ? (
                <ExtractSpinner />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              )}
              {extractBusy
                ? (t('context.extracting', { defaultValue: '추출 중…' }) as string)
                : (t('context.extract', { defaultValue: '업무 추출' }) as string)}
            </ExtractBtn>
          )}
        </SecHead>
        {extractMsg && <Dim>{extractMsg}</Dim>}
        {candidates.length === 0 && !extractMsg ? (
          <Dim>{canExtract
            ? t('context.tasksHint', { defaultValue: '메일 본문에서 할 일을 자동으로 뽑아 Q Task로 등록해요.' }) as string
            : t('context.tasksGated', { defaultValue: '자동·마케팅 메일에서는 업무를 추출하지 않아요.' }) as string}</Dim>
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
                members={members.map(m => ({ user_id: m.user_id, name: m.name }))}
                busy={rowBusy === c.id}
                onRegister={register}
                onReject={reject}
              />
            ))}
          </CandList>
        )}
      </Section>

      <Section>
        <SecTitle>{t('context.issuesTitle', { defaultValue: '이슈' }) as string}{issues.length > 0 && <CountBadge>{issues.length}</CountBadge>}</SecTitle>
        {issues.map((it) => (
          <NoteRow key={it.id}>
            <NoteBody>{it.body}</NoteBody>
            <DelBtn type="button" aria-label={t('context.delete', { defaultValue: '삭제' }) as string} onClick={() => deleteIssue(it.id)}>✕</DelBtn>
          </NoteRow>
        ))}
        <AddRow>
          <AddInput value={newIssue} placeholder={t('context.issuePh', { defaultValue: '이슈 추가…' }) as string}
            onChange={(e) => setNewIssue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addIssue(); } }} />
          <AddBtn type="button" onClick={addIssue} disabled={iaBusy || !newIssue.trim()}>{t('context.add', { defaultValue: '추가' }) as string}</AddBtn>
        </AddRow>
      </Section>

      <Section>
        <SecTitle>{t('context.notesTitle', { defaultValue: '노트' }) as string}{notes.length > 0 && <CountBadge>{notes.length}</CountBadge>}</SecTitle>
        {notes.map((n) => (
          <NoteRow key={n.id}>
            <NoteBody>{n.body}{n.visibility === 'personal' && <VisTag>{t('context.visPersonal', { defaultValue: '나만' }) as string}</VisTag>}</NoteBody>
            <DelBtn type="button" aria-label={t('context.delete', { defaultValue: '삭제' }) as string} onClick={() => deleteNote(n.id)}>✕</DelBtn>
          </NoteRow>
        ))}
        <AddRow>
          <AddInput value={newNote} placeholder={t('context.notePh', { defaultValue: '노트 추가…' }) as string}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); } }} />
          <AddBtn type="button" onClick={addNote} disabled={iaBusy || !newNote.trim()}>{t('context.add', { defaultValue: '추가' }) as string}</AddBtn>
        </AddRow>
        <VisToggle type="button" $on={notePersonal} role="switch" aria-checked={notePersonal} onClick={() => setNotePersonal(v => !v)}>
          <VisDot $on={notePersonal} />
          {notePersonal ? t('context.noteVisMe', { defaultValue: '🔒 나만 보임' }) as string : t('context.noteVisTeam', { defaultValue: '👥 팀 공유' }) as string}
        </VisToggle>
      </Section>

      {clientId ? (
        <Section>
          <SecTitle>{t('context.customerTitle', { defaultValue: '이 고객' }) as string}</SecTitle>
          {sumLoading ? (
            <Dim>{t('context.loading', { defaultValue: '불러오는 중…' }) as string}</Dim>
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
              <TimelineLink type="button" onClick={() => navigate(`/business/clients/${clientId}/timeline`)}>
                {t('context.openTimeline', { defaultValue: '통합 타임라인 보기' }) as string}<span aria-hidden>›</span>
              </TimelineLink>
            </>
          ) : (
            <Dim>{t('context.noActivity', { defaultValue: '아직 다른 채널 활동이 없어요.' }) as string}</Dim>
          )}
        </Section>
      ) : (
        <Section>
          <SecTitle>{t('context.customerTitle', { defaultValue: '이 고객' }) as string}</SecTitle>
          <Dim>{t('context.linkClientHint', { defaultValue: '고객을 연결하면 그 고객의 채팅·업무·청구를 여기서 함께 봅니다.' }) as string}</Dim>
        </Section>
      )}
    </Wrap>
  );
};

export default MailContextPanel;

const Wrap = styled.div`display:flex; flex-direction:column; gap:16px; padding:16px 14px; overflow-y:auto;`;
const Section = styled.section`display:flex; flex-direction:column; gap:10px;`;
const SecTitle = styled.div`font-size:12px; font-weight:700; color:#0F172A; letter-spacing:-0.2px;`;
const Field = styled.div`display:flex; flex-direction:column; gap:5px;`;
const Lbl = styled.label`font-size:12px; font-weight:600; color:#64748B;`;
const Dim = styled.div`font-size:12px; color:#94A3B8; line-height:1.5;`;
const SecHead = styled.div`display:flex; align-items:center; justify-content:space-between; gap:8px;`;
const CountBadge = styled.span`margin-left:6px; font-size:11px; font-weight:700; color:#0F766E; background:#F0FDFA; border-radius:999px; padding:1px 7px;`;
// Q Talk ChatPanel:3430 과 동일 — 같은 기능은 어느 화면에서든 같은 모양 (teal + 체크박스 아이콘)
const ExtractBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  background: #F0FDFA;
  color: #0F766E;
  border: 1px solid #99F6E4;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  &:hover:not(:disabled) { background: #CCFBF1; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const ExtractSpinner = styled.span`
  width: 12px;
  height: 12px;
  border: 2px solid #99F6E4;
  border-top-color: #0F766E;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
const CandList = styled.div`display:flex; flex-direction:column; gap:8px;`;
const SummaryBox = styled.div`font-size:12px; color:#334155; line-height:1.6; white-space:pre-wrap; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px 12px;`;
const NoteRow = styled.div`display:flex; align-items:flex-start; gap:6px; padding:6px 0; border-bottom:1px solid #F1F5F9; &:last-of-type{ border-bottom:none; }`;
const NoteBody = styled.div`flex:1; min-width:0; font-size:12px; color:#334155; line-height:1.5; word-break:break-word;`;
const VisTag = styled.span`margin-left:6px; font-size:10px; font-weight:600; color:#92400E; background:#FEF3C7; border-radius:999px; padding:0 6px;`;
const DelBtn = styled.button`flex-shrink:0; width:20px; height:20px; border:none; background:none; cursor:pointer; color:#94A3B8; font-size:12px; border-radius:4px; &:hover{ background:#FEF2F2; color:#DC2626; }`;
const AddRow = styled.div`display:flex; gap:6px; margin-top:4px;`;
const AddInput = styled.input`
  flex:1; min-width:0; height:32px; padding:0 8px; border:1px solid #CBD5E1; border-radius:8px; font-size:12px; color:#0F172A;
  &:focus{ outline:none; border-color:#14B8A6; box-shadow:0 0 0 3px rgba(20,184,166,0.15); }
`;
const AddBtn = styled.button`
  flex-shrink:0; height:32px; padding:0 12px; border-radius:8px; cursor:pointer; font-size:12px; font-weight:600;
  color:#0F766E; background:#F0FDFA; border:1px solid #99F6E4;
  &:hover:not(:disabled){ background:#CCFBF1; } &:disabled{ opacity:0.5; cursor:default; }
`;
const VisToggle = styled.button<{ $on?: boolean }>`
  display:inline-flex; align-items:center; gap:6px; align-self:flex-start; margin-top:2px;
  padding:3px 8px; border-radius:999px; cursor:pointer; font-size:11px; font-weight:600;
  color:${p => p.$on ? '#92400E' : '#0F766E'}; background:${p => p.$on ? '#FEF3C7' : '#F0FDFA'};
  border:1px solid ${p => p.$on ? '#FDE68A' : '#99F6E4'};
`;
const VisDot = styled.span<{ $on?: boolean }>`width:7px; height:7px; border-radius:50%; background:${p => p.$on ? '#D97706' : '#14B8A6'};`;
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
const TimelineLink = styled.button`
  display:flex; align-items:center; justify-content:space-between; gap:6px; width:100%;
  padding:9px 12px; border-radius:8px; cursor:pointer; margin-top:2px;
  font-size:12px; font-weight:600; color:#0F766E; background:#F0FDFA; border:1px solid #99F6E4;
  &:hover{ background:#CCFBF1; }
  span{ font-size:16px; line-height:1; }
`;
