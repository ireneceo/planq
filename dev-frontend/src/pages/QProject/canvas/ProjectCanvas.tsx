// 프로젝트 캔버스 (D3 #65) — 전략(Why)→실행(How)→산출물·추적을 한 화면에.
// 컨설팅 논리(SCQA·피라미드·MECE) 구조. /api/projects/:id/canvas 단일 집계 + 실시간(§16).
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../../hooks/useVisibilityRefresh';
import AutoSaveField from '../../../components/Common/AutoSaveField';
import PartnerKindBadge from '../../../components/Common/PartnerKindBadge';
import ScheduleTimeline from '../../../components/Common/ScheduleTimeline';
import { STATUS_COLOR, type StatusCode } from '../../../utils/taskLabel';
import { FileTextIcon, AlertTriangleIcon } from '../../../components/Common/Icons';
import {
  getCanvas, patchStrategy,
  type CanvasData, type StrategyKey, type CanvasTaskBrief,
} from '../../../services/projectCanvas';
import { getTimeline, setTimelineKeyOnly, type TimelineData } from '../../../services/projectTimeline';
import SuccessMetricsEditor from './SuccessMetricsEditor';
import WorkstreamBoard from './WorkstreamBoard';
import RelatedProjects from './RelatedProjects';

interface Props { projectId: number; businessId: number; }

export default function ProjectCanvas({ projectId, businessId }: Props) {
  const { t } = useTranslation('qproject');
  const navigate = useNavigate();
  const { user } = useAuth();
  const myId = user?.id;
  const [data, setData] = useState<CanvasData | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [keyOnly, setKeyOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);  // 관련 프로젝트 동기화 신호
  const keyOnlyRef = useRef(false);
  const keyOnlyInit = useRef(false);

  const silentLoad = useCallback(async () => {
    try {
      const [d, tl] = await Promise.all([
        getCanvas(projectId),
        getTimeline(projectId, keyOnlyRef.current).catch(() => null),
      ]);
      setData(d);
      if (tl) {
        setTimeline(tl);
        // 최초 1회만 프로젝트 기본값(timeline_key_only)으로 초기화 — 이후엔 사용자 토글 유지
        if (!keyOnlyInit.current) { keyOnlyInit.current = true; keyOnlyRef.current = tl.key_only_default; setKeyOnly(tl.key_only_default); }
      }
      setError(false);
      setRefreshSignal((s) => s + 1);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [projectId]);

  // "주요만 보기" 토글 — 프로젝트 기본값 저장 + 타임라인 재조회(서버가 마일스톤만 반환)
  const toggleKeyOnly = useCallback(async (next: boolean) => {
    keyOnlyRef.current = next; setKeyOnly(next);
    try {
      const tl = await getTimeline(projectId, next);
      setTimeline(tl);
      setTimelineKeyOnly(projectId, next).catch(() => { /* 기본값 저장 실패는 무시 */ });
    } catch { /* keep */ }
  }, [projectId]);

  useEffect(() => { setLoading(true); silentLoad(); }, [silentLoad]);
  useVisibilityRefresh(silentLoad);

  // 실시간 §16 — 자기 액션(actor=나)이 아닐 때만 reload (편집 중 필드 보호)
  const reloadRef = useRef(silentLoad);
  reloadRef.current = silentLoad;
  useEffect(() => {
    let socket: { disconnect: () => void } | null = null;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const debounced = (meta?: { actor_user_id?: number }) => {
      if (meta && myId != null && Number(meta.actor_user_id) === Number(myId)) return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => reloadRef.current(), 250);
    };
    import('socket.io-client').then(({ io }) => {
      import('../../../contexts/AuthContext').then(({ getAccessToken }) => {
        if (!getAccessToken()) return;
        const s = io({ auth: (cb: (d: { token: string | null }) => void) => cb({ token: getAccessToken() }), transports: ['websocket', 'polling'], reconnection: true });
        socket = s;
        s.on('connect', () => { s.emit('join:business', Number(businessId)); s.emit('join:project', Number(projectId)); });
        s.on('project:updated', debounced);
        s.on('task:new', debounced); s.on('task:updated', debounced); s.on('task:deleted', () => debounced());
      });
    });
    return () => { if (pending) clearTimeout(pending); if (socket) socket.disconnect(); };
  }, [businessId, projectId, myId]);

  const saveStrategy = useCallback((key: StrategyKey, value: string) => async () => {
    await patchStrategy(projectId, { [key]: value });
  }, [projectId]);

  if (loading) return <Skeleton><SkelBar style={{ width: '40%' }} /><SkelBlock /><SkelBlock /></Skeleton>;
  if (error || !data) return <ErrorBox><AlertTriangleIcon size={20} /><div>{t('canvas.loadError')}</div><Retry type="button" onClick={silentLoad}>{t('canvas.retry')}</Retry></ErrorBox>;

  const { strategy } = data;

  return (
    <Wrap>
      {/* ───── 일정 진행 타임라인 ★ (시그니처) ───── */}
      <SectionTitle>{t('canvas.tl.title')}</SectionTitle>
      {timeline && (
        <ScheduleTimeline
          data={timeline}
          keyOnly={keyOnly}
          onToggleKeyOnly={toggleKeyOnly}
          onTaskClick={(id) => navigate(`/projects/p/${projectId}?tab=tasks&task=${id}`)}
        />
      )}

      {/* ───── Layer 1 프레이밍 ───── */}
      <LayerLabel $tone="blue">{t('canvas.layer1')}</LayerLabel>
      <TwoCol>
        <StrategyField fieldKey="context" value={strategy.context}
          label={t('canvas.context.label')} hint={t('canvas.context.hint')} ph={t('canvas.context.ph')} save={saveStrategy} />
        <StrategyField fieldKey="key_question" value={strategy.key_question}
          label={t('canvas.keyQuestion.label')} hint={t('canvas.keyQuestion.hint')} ph={t('canvas.keyQuestion.ph')} save={saveStrategy} />
      </TwoCol>
      <StrategyField fieldKey="goal" value={strategy.goal}
        label={t('canvas.goal.label')} hint={t('canvas.goal.hint')} ph={t('canvas.goal.ph')} save={saveStrategy} />
      <Card><SuccessMetricsEditor projectId={projectId} initial={data.success_metrics} onSaved={() => { /* canvas reloads via socket */ }} /></Card>

      {/* ───── Layer 2 전략 ───── */}
      <LayerLabel $tone="green">{t('canvas.layer2')}</LayerLabel>
      <GoverningWrap>
        <GoverningLabel>{t('canvas.governing.label')}<Hint>{t('canvas.governing.hint')}</Hint></GoverningLabel>
        <GoverningField value={strategy.governing_thought} ph={t('canvas.governing.ph')} save={saveStrategy} />
      </GoverningWrap>
      <StrategyField fieldKey="approach" value={strategy.approach}
        label={t('canvas.approach.label')} hint={t('canvas.approach.hint')} ph={t('canvas.approach.ph')} save={saveStrategy} />
      <SectionTitle>{t('canvas.workstreams.title')}<Hint>{t('canvas.workstreams.hint')}</Hint></SectionTitle>
      <WorkstreamBoard projectId={projectId} workstreams={data.workstreams} onChanged={silentLoad} />

      {/* ───── Layer 3 실행 ───── */}
      <LayerLabel $tone="orange">{t('canvas.layer3')}</LayerLabel>

      <SectionTitle>{t('canvas.weekFocus.title')}</SectionTitle>
      <TwoCol>
        <WeekCol title={t('canvas.weekFocus.thisWeek')} tasks={data.week_focus.this_week} emptyText={t('canvas.weekFocus.empty')} onOpen={(id) => navigate(`/projects/p/${projectId}?tab=tasks&task=${id}`)} />
        <WeekCol title={t('canvas.weekFocus.nextWeek')} tasks={data.week_focus.next_week} emptyText={t('canvas.weekFocus.emptyNext')} onOpen={(id) => navigate(`/projects/p/${projectId}?tab=tasks&task=${id}`)} />
      </TwoCol>

      <GridTwo>
        <Card>
          <SectionTitle>{t('canvas.deliverables.title')}</SectionTitle>
          {data.deliverables.length === 0 ? <Empty>{t('canvas.deliverables.empty')}</Empty> : (
            <DelivList>
              {data.deliverables.map((d) => (
                <DelivRow key={`${d.kind}-${d.id}`} onClick={() => navigate(d.link)}>
                  <FileTextIcon size={15} />
                  <DelivTitle>{d.title}</DelivTitle>
                  <DelivTag>{d.kind === 'post' ? t('canvas.deliverables.post') : t('canvas.deliverables.document')}</DelivTag>
                </DelivRow>
              ))}
            </DelivList>
          )}
        </Card>
        <Card>
          <SectionTitle>{t('canvas.stakeholders.title')}</SectionTitle>
          {(data.stakeholders.members.length + data.stakeholders.clients.length) === 0 ? <Empty>{t('canvas.stakeholders.empty')}</Empty> : (
            <>
              {data.stakeholders.members.length > 0 && <GroupLabel>{t('canvas.stakeholders.members')}</GroupLabel>}
              <People>
                {data.stakeholders.members.map((m) => (
                  <Person key={`m-${m.user_id}`}>
                    <PName>{m.name}</PName>
                    {m.dept && <DeptBadge>{m.dept}{m.team ? ` · ${m.team}` : ''}</DeptBadge>}
                  </Person>
                ))}
              </People>
              {data.stakeholders.clients.length > 0 && <GroupLabel>{t('canvas.stakeholders.clients')}</GroupLabel>}
              <People>
                {data.stakeholders.clients.map((c) => (
                  <Person key={`c-${c.id}`}><PName>{c.name}</PName><PartnerKindBadge kind={c.kind} size="xs" /></Person>
                ))}
              </People>
            </>
          )}
        </Card>
      </GridTwo>

      <Card>
        <SectionTitle>{t('canvas.risks.title')}</SectionTitle>
        {data.risks.length === 0 ? <Empty>{t('canvas.risks.empty')}</Empty> : (
          <RiskList>{data.risks.map((r) => <RiskRow key={r.id}><AlertTriangleIcon size={14} /><span>{r.body}</span></RiskRow>)}</RiskList>
        )}
      </Card>

      {/* ───── 관련 프로젝트 (§3.5) ───── */}
      <RelatedProjects projectId={projectId} businessId={businessId} refreshSignal={refreshSignal} />
    </Wrap>
  );
}

// 전략 텍스트 필드 (AutoSave) — uncontrolled + ref 로 최신 값 저장
function StrategyField({ fieldKey, value, label, hint, ph, save }: {
  fieldKey: StrategyKey; value: string | null;
  label: string; hint: string; ph: string;
  save: (k: StrategyKey, v: string) => () => Promise<void>;
}) {
  const valRef = useRef(value ?? '');
  return (
    <Field>
      <FieldLabel>{label}<Hint>{hint}</Hint></FieldLabel>
      <AutoSaveField onSave={() => save(fieldKey, valRef.current)()} type="input">
        <Textarea defaultValue={value ?? ''} placeholder={ph} onChange={(e) => { valRef.current = e.target.value; }} />
      </AutoSaveField>
    </Field>
  );
}

// 핵심 메시지(governing thought) 필드 — 큰 단일 입력, uncontrolled + ref
function GoverningField({ value, ph, save }: { value: string | null; ph: string; save: (k: StrategyKey, v: string) => () => Promise<void> }) {
  const valRef = useRef(value ?? '');
  return (
    <AutoSaveField onSave={() => save('governing_thought', valRef.current)()} type="input">
      <GoverningInput defaultValue={value ?? ''} placeholder={ph} onChange={(e) => { valRef.current = e.target.value; }} />
    </AutoSaveField>
  );
}

function WeekCol({ title, tasks, emptyText, onOpen }: { title: string; tasks: CanvasTaskBrief[]; emptyText: string; onOpen: (id: number) => void }) {
  return (
    <Card>
      <WeekHead>{title}<WeekCount>{tasks.length}</WeekCount></WeekHead>
      {tasks.length === 0 ? <Empty>{emptyText}</Empty> : (
        <TaskChips>
          {tasks.map((tk) => {
            const sc = STATUS_COLOR[tk.status as StatusCode] || { bg: '#F1F5F9', fg: '#64748B' };
            return (
              <Chip key={tk.id} onClick={() => onOpen(tk.id)}>
                <ChipDot style={{ background: sc.fg }} />
                <ChipTitle>{tk.title}</ChipTitle>
                {tk.assignee_name && <ChipMeta>{tk.assignee_name}</ChipMeta>}
                {tk.due_date && <ChipMeta>{String(tk.due_date).slice(5, 10)}</ChipMeta>}
              </Chip>
            );
          })}
        </TaskChips>
      )}
    </Card>
  );
}

// ───────── styles ─────────
const Wrap = styled.div`display:flex;flex-direction:column;gap:14px;max-width:1100px;`;
const LayerLabel = styled.div<{ $tone: 'blue' | 'green' | 'orange' }>`
  display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;letter-spacing:.02em;
  margin-top:14px;padding:4px 12px;border-radius:999px;align-self:flex-start;
  color:${(p) => (p.$tone === 'blue' ? '#1E40AF' : p.$tone === 'green' ? '#0F766E' : '#9A3412')};
  background:${(p) => (p.$tone === 'blue' ? '#DBEAFE' : p.$tone === 'green' ? '#CCFBF1' : '#FFEDD5')};
  &::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor;}
`;
const TwoCol = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:14px;@media (max-width:768px){grid-template-columns:1fr;}`;
const GridTwo = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:14px;@media (max-width:768px){grid-template-columns:1fr;}`;
const Field = styled.div``;
const FieldLabel = styled.div`font-size:13px;font-weight:700;color:#0F172A;margin-bottom:6px;`;
const Hint = styled.span`font-size:11px;font-weight:500;color:#94A3B8;margin-left:8px;`;
const Textarea = styled.textarea`width:100%;min-height:72px;resize:vertical;border:1px solid #E2E8F0;border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.6;color:#334155;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,.15);}&::placeholder{color:#94A3B8;}`;
const Card = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:16px 18px;`;
const SectionTitle = styled.div`font-size:14px;font-weight:700;color:#0F172A;margin-top:6px;`;
const GroupLabel = styled.div`font-size:11px;font-weight:600;color:#94A3B8;margin:10px 0 6px;`;
const GoverningWrap = styled.div`background:linear-gradient(135deg,#F0FDFA,#fff);border:1px solid #99F6E4;border-radius:12px;padding:16px 18px;`;
const GoverningLabel = styled.div`font-size:12px;font-weight:700;color:#0F766E;margin-bottom:8px;`;
const GoverningInput = styled.input`width:100%;border:none;background:transparent;font-size:18px;font-weight:700;color:#0F172A;line-height:1.5;&:focus{outline:none;}&::placeholder{color:#5EEAD4;font-weight:600;}`;
const Empty = styled.div`font-size:13px;color:#94A3B8;padding:10px 0;`;
const WeekHead = styled.div`display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#0F172A;margin-bottom:10px;`;
const WeekCount = styled.span`display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;background:#CCFBF1;color:#0F766E;border-radius:999px;font-size:11px;font-weight:700;`;
const TaskChips = styled.div`display:flex;flex-direction:column;gap:6px;`;
const Chip = styled.div`display:flex;align-items:center;gap:8px;padding:8px 10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;cursor:pointer;&:hover{background:#F0FDFA;border-color:#99F6E4;}`;
const ChipDot = styled.span`width:7px;height:7px;border-radius:50%;flex-shrink:0;`;
const ChipTitle = styled.span`flex:1;font-size:13px;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const ChipMeta = styled.span`font-size:11px;color:#94A3B8;flex-shrink:0;`;
const DelivList = styled.div`display:flex;flex-direction:column;gap:4px;`;
const DelivRow = styled.div`display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;color:#475569;&:hover{background:#F8FAFC;}`;
const DelivTitle = styled.span`flex:1;font-size:13px;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const DelivTag = styled.span`font-size:10px;font-weight:700;color:#64748B;background:#F1F5F9;border-radius:999px;padding:2px 8px;flex-shrink:0;`;
const People = styled.div`display:flex;flex-wrap:wrap;gap:8px;`;
const Person = styled.div`display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:999px;`;
const PName = styled.span`font-size:12px;font-weight:600;color:#334155;`;
const DeptBadge = styled.span`font-size:10px;font-weight:700;color:#475569;background:#E2E8F0;border-radius:999px;padding:1px 7px;`;
const RiskList = styled.div`display:flex;flex-direction:column;gap:6px;`;
const RiskRow = styled.div`display:flex;align-items:flex-start;gap:8px;font-size:13px;color:#334155;line-height:1.5;color:#92400E;`;
const Skeleton = styled.div`display:flex;flex-direction:column;gap:14px;`;
const SkelBar = styled.div`height:20px;background:#F1F5F9;border-radius:8px;`;
const SkelBlock = styled.div`height:90px;background:#F1F5F9;border-radius:12px;`;
const ErrorBox = styled.div`display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px;color:#92400E;`;
const Retry = styled.button`height:34px;padding:0 16px;border:1px solid #E2E8F0;background:#fff;border-radius:8px;font-size:13px;font-weight:600;color:#0F766E;cursor:pointer;&:hover{background:#F0FDFA;}`;
