// 프로젝트 캔버스 (D3 #65) — 전략(Why)→실행(How)→산출물·추적을 한 화면에.
// 컨설팅 논리(SCQA·피라미드·MECE) 구조. /api/projects/:id/canvas 단일 집계 + 실시간(§16).
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth, apiFetch } from '../../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../../hooks/useVisibilityRefresh';
import AutoSaveField from '../../../components/Common/AutoSaveField';
import PartnerKindBadge from '../../../components/Common/PartnerKindBadge';
import { STATUS_COLOR, type StatusCode } from '../../../utils/taskLabel';
import { FileTextIcon, AlertTriangleIcon } from '../../../components/Common/Icons';
import {
  getCanvas, patchStrategy, wsColor,
  type CanvasData, type StrategyKey, type CanvasTaskBrief,
} from '../../../services/projectCanvas';
import SuccessMetricsEditor from './SuccessMetricsEditor';
import WorkstreamBoard from './WorkstreamBoard';

interface Props { projectId: number; businessId: number; }

export default function ProjectCanvas({ projectId, businessId }: Props) {
  const { t } = useTranslation('qproject');
  const navigate = useNavigate();
  const { user } = useAuth();
  const myId = user?.id;
  const [data, setData] = useState<CanvasData | null>(null);
  const [stages, setStages] = useState<{ id: number; kind: string; label: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const silentLoad = useCallback(async () => {
    try {
      const [d, txRes] = await Promise.all([
        getCanvas(projectId),
        apiFetch(`/api/projects/${projectId}/transactions`).then((r) => r.json()).catch(() => null),
      ]);
      setData(d);
      setStages(txRes?.success && Array.isArray(txRes.data?.stages) ? txRes.data.stages : []);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
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
  if (error || !data) return <ErrorBox><AlertTriangleIcon size={20} /><div>{t('canvas.loadError')}</div><Retry onClick={silentLoad}>{t('canvas.retry')}</Retry></ErrorBox>;

  const { strategy } = data;

  return (
    <Wrap>
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

      <SectionTitle>{t('canvas.roadmap.title')}</SectionTitle>
      {stages.length === 0 ? (
        <Card><EmptyRow><span>{t('canvas.roadmap.empty')}</span><LinkBtn onClick={() => navigate(`/projects/p/${projectId}?tab=transactions`)}>{t('canvas.roadmap.openTx')}</LinkBtn></EmptyRow></Card>
      ) : (
        <RoadStrip>
          {stages.map((s, i) => (
            <RoadStep key={s.id} onClick={() => navigate(`/projects/p/${projectId}?tab=transactions`)} $status={s.status}>
              <RoadDot $status={s.status}>{s.status === 'completed' ? '✓' : i + 1}</RoadDot>
              <RoadLabel>{s.label}</RoadLabel>
            </RoadStep>
          ))}
        </RoadStrip>
      )}

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

      {/* ───── 업무 연계도 ───── */}
      <SectionTitle>{t('canvas.graph.title')}<Hint>{t('canvas.graph.hint')}</Hint></SectionTitle>
      <TaskGraph data={data} t={t} onOpen={(id) => navigate(`/projects/p/${projectId}?tab=tasks&task=${id}`)} />
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

// 업무 연계도 — 추진과제 레인별 업무 + 연계(task_links) 표시
function TaskGraph({ data, t, onOpen }: { data: CanvasData; t: (k: string) => string; onOpen: (id: number) => void }) {
  const linkCount: Record<number, number> = {};
  data.task_links.forEach((l) => { linkCount[l.a] = (linkCount[l.a] || 0) + 1; linkCount[l.b] = (linkCount[l.b] || 0) + 1; });
  const lanes = [
    ...data.workstreams.map((ws, idx) => ({ id: ws.id, title: ws.title, color: wsColor(ws, idx) })),
    { id: null as number | null, title: t('canvas.graph.unassigned'), color: '#CBD5E1' },
  ];
  const tasksByWs = (wsId: number | null) => data.tasks.filter((tk) => (tk.workstream_id ?? null) === wsId);
  if (data.tasks.length === 0) return <Empty>{t('canvas.graph.empty')}</Empty>;
  return (
    <GraphScroll>
      {lanes.map((lane) => {
        const ts = tasksByWs(lane.id);
        if (ts.length === 0) return null;
        return (
          <Lane key={String(lane.id)}>
            <LaneHead><LaneDot style={{ background: lane.color }} />{lane.title}<LaneCount>{ts.length}</LaneCount></LaneHead>
            <LaneBody>
              {ts.map((tk) => {
                const sc = STATUS_COLOR[tk.status as StatusCode] || { bg: '#F1F5F9', fg: '#64748B' };
                return (
                  <Node key={tk.id} onClick={() => onOpen(tk.id)} style={{ borderLeftColor: lane.color }}>
                    <NodeDot style={{ background: sc.fg }} />
                    <NodeTitle>{tk.title}</NodeTitle>
                    {linkCount[tk.id] > 0 && <LinkBadge>{linkCount[tk.id]} {t('canvas.graph.links')}</LinkBadge>}
                  </Node>
                );
              })}
            </LaneBody>
          </Lane>
        );
      })}
    </GraphScroll>
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
const EmptyRow = styled.div`display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;color:#94A3B8;`;
const LinkBtn = styled.button`border:none;background:transparent;color:#0F766E;font-size:13px;font-weight:600;cursor:pointer;&:hover{text-decoration:underline;}`;
const RoadStrip = styled.div`display:flex;align-items:center;gap:6px;overflow-x:auto;padding:4px 0;`;
const RoadStep = styled.div<{ $status: string }>`display:flex;align-items:center;gap:8px;flex-shrink:0;padding:8px 14px 8px 8px;background:#fff;border:1px solid ${(p) => (p.$status === 'active' ? '#99F6E4' : '#E2E8F0')};border-radius:999px;cursor:pointer;&:hover{border-color:#14B8A6;}&:not(:last-child)::after{content:'→';margin-left:2px;color:#CBD5E1;}`;
const RoadDot = styled.span<{ $status: string }>`display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:700;flex-shrink:0;color:#fff;background:${(p) => (p.$status === 'completed' ? '#22C55E' : p.$status === 'active' ? '#14B8A6' : '#CBD5E1')};`;
const RoadLabel = styled.span`font-size:12px;font-weight:600;color:#334155;white-space:nowrap;`;
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
const GraphScroll = styled.div`display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;`;
const Lane = styled.div`flex:0 0 240px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:12px;`;
const LaneHead = styled.div`display:flex;align-items:center;gap:7px;font-size:13px;font-weight:700;color:#0F172A;margin-bottom:10px;`;
const LaneDot = styled.span`width:9px;height:9px;border-radius:50%;flex-shrink:0;`;
const LaneCount = styled.span`margin-left:auto;font-size:11px;color:#94A3B8;font-weight:600;`;
const LaneBody = styled.div`display:flex;flex-direction:column;gap:6px;`;
const Node = styled.div`display:flex;align-items:center;gap:7px;padding:8px 10px;background:#fff;border:1px solid #E2E8F0;border-left:3px solid #CBD5E1;border-radius:8px;cursor:pointer;&:hover{box-shadow:0 2px 8px rgba(15,23,42,.06);}`;
const NodeDot = styled.span`width:7px;height:7px;border-radius:50%;flex-shrink:0;`;
const NodeTitle = styled.span`flex:1;font-size:12px;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const LinkBadge = styled.span`font-size:10px;font-weight:700;color:#0F766E;background:#CCFBF1;border-radius:999px;padding:1px 7px;flex-shrink:0;`;
const Skeleton = styled.div`display:flex;flex-direction:column;gap:14px;`;
const SkelBar = styled.div`height:20px;background:#F1F5F9;border-radius:8px;`;
const SkelBlock = styled.div`height:90px;background:#F1F5F9;border-radius:12px;`;
const ErrorBox = styled.div`display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px;color:#92400E;`;
const Retry = styled.button`height:34px;padding:0 16px;border:1px solid #E2E8F0;background:#fff;border-radius:8px;font-size:13px;font-weight:600;color:#0F766E;cursor:pointer;&:hover{background:#F0FDFA;}`;
