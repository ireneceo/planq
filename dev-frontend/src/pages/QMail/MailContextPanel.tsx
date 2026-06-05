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
import SingleDateField from '../../components/Common/SingleDateField';
import ActionButton from '../../components/Common/ActionButton';

interface ThreadLite {
  id: number;
  triage?: string | null;
  client?: { id: number; display_name?: string; company_name?: string } | null;
  project?: { id: number; name?: string } | null;
}
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
  const [edits, setEdits] = useState<Record<number, { title?: string; assignee_id?: number | null; due_date?: string }>>({});
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  // 자동·마케팅·스팸 메일엔 추출 버튼 숨김 (실 요청만 — 설계 §4)
  const canExtract = !thread.triage || thread.triage === 'human' || thread.triage === 'unknown';
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
    setCandidates([]); setEdits({}); setExtractMsg(null);
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

  const register = useCallback(async (c: Candidate) => {
    if (rowBusy) return; setRowBusy(c.id);
    try {
      const e = edits[c.id] || {};
      const body: Record<string, unknown> = {
        title: (e.title ?? c.title),
        assignee_id: e.assignee_id !== undefined ? e.assignee_id : (c.guessed_assignee_user_id ?? null),
      };
      if (e.due_date !== undefined) body.due_date = e.due_date || null;
      else if (c.guessed_due_date) body.due_date = c.guessed_due_date;
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/task-candidates/${c.id}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if ((await r.json()).success) setCandidates((prev) => prev.filter(p => p.id !== c.id));
    } finally { setRowBusy(null); }
  }, [rowBusy, edits, businessId, thread.id]);

  const reject = useCallback(async (id: number) => {
    if (rowBusy) return; setRowBusy(id);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/email-threads/${thread.id}/task-candidates/${id}/reject`, { method: 'POST' });
      if ((await r.json()).success) setCandidates((prev) => prev.filter(p => p.id !== id));
    } finally { setRowBusy(null); }
  }, [rowBusy, businessId, thread.id]);

  const memberOptions = useMemo(() => [{ value: 0, label: t('context.unassigned', { defaultValue: '담당 미지정' }) as string }, ...members.map(m => ({ value: m.user_id, label: m.name }))], [members, t]);

  const clientOptions = useMemo(() => [{ value: 0, label: t('context.noClient', { defaultValue: '연결 안 함' }) as string }, ...clients.map(c => ({ value: c.id, label: c.label }))], [clients, t]);
  const projectOptions = useMemo(() => [{ value: 0, label: t('context.noProject', { defaultValue: '연결 안 함' }) as string }, ...projects.map(p => ({ value: p.id, label: p.label }))], [projects, t]);

  const channelLabel = (c: Channel) => t(`context.channel.${c}`, { defaultValue: c }) as string;

  return (
    <Wrap>
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
            <ExtractBtn type="button" onClick={extract} disabled={extractBusy}>
              {extractBusy ? t('context.extracting', { defaultValue: '추출 중…' }) as string : t('context.extract', { defaultValue: '✨ 업무 추출' }) as string}
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
            {candidates.map((c) => {
              const e = edits[c.id] || {};
              const aid = e.assignee_id !== undefined ? (e.assignee_id || 0) : (c.guessed_assignee_user_id || 0);
              return (
                <CandCard key={c.id}>
                  <CandTitle value={e.title ?? c.title} disabled={rowBusy === c.id}
                    onChange={(ev) => setEdits(p => ({ ...p, [c.id]: { ...p[c.id], title: ev.target.value } }))} />
                  <CandRow>
                    <PlanQSelect size="sm" isSearchable menuPlacement="bottom"
                      value={memberOptions.find(o => o.value === aid)}
                      onChange={(opt: unknown) => { const v = (opt as { value?: number } | null)?.value || 0; setEdits(p => ({ ...p, [c.id]: { ...p[c.id], assignee_id: v > 0 ? v : null } })); }}
                      options={memberOptions} />
                    <SingleDateField value={e.due_date ?? (c.guessed_due_date || '')}
                      onChange={(v) => setEdits(p => ({ ...p, [c.id]: { ...p[c.id], due_date: v } }))} />
                  </CandRow>
                  <CandActions>
                    <MiniGhost type="button" onClick={() => reject(c.id)} disabled={rowBusy === c.id}>{t('context.reject', { defaultValue: '무시' }) as string}</MiniGhost>
                    <ActionButton tone="primary" size="sm" loading={rowBusy === c.id} onClick={() => register(c)}>{t('context.register', { defaultValue: '업무 등록' }) as string}</ActionButton>
                  </CandActions>
                </CandCard>
              );
            })}
          </CandList>
        )}
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
const ExtractBtn = styled.button`
  height:28px; padding:0 10px; border-radius:8px; cursor:pointer; flex-shrink:0;
  font-size:12px; font-weight:600; color:#F43F5E; background:#FFF1F2; border:1px solid #FECDD3;
  &:hover:not(:disabled){ background:#FFE4E6; } &:disabled{ opacity:0.6; cursor:wait; }
`;
const CandList = styled.div`display:flex; flex-direction:column; gap:8px;`;
const CandCard = styled.div`display:flex; flex-direction:column; gap:8px; padding:10px; border:1px solid #E2E8F0; border-radius:10px; background:#fff;`;
const CandTitle = styled.input`
  height:32px; padding:0 8px; border:1px solid #CBD5E1; border-radius:6px; font-size:13px; font-weight:600; color:#0F172A;
  &:focus{ outline:none; border-color:#14B8A6; box-shadow:0 0 0 3px rgba(20,184,166,0.15); }
`;
const CandRow = styled.div`display:grid; grid-template-columns:1fr 1fr; gap:6px;`;
const CandActions = styled.div`display:flex; align-items:center; justify-content:flex-end; gap:6px;`;
const MiniGhost = styled.button`
  height:32px; padding:0 10px; border-radius:7px; cursor:pointer; font-size:12px; font-weight:600;
  color:#64748B; background:#fff; border:1px solid #CBD5E1;
  &:hover:not(:disabled){ background:#F1F5F9; } &:disabled{ opacity:0.5; }
`;
const typeColor: Record<Channel, { bg: string; fg: string }> = {
  chat: { bg: '#F0FDFA', fg: '#0F766E' },
  email: { bg: '#EFF6FF', fg: '#1D4ED8' },
  task: { bg: '#FEF3C7', fg: '#92400E' },
  invoice: { bg: '#F5F3FF', fg: '#6D28D9' },
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
