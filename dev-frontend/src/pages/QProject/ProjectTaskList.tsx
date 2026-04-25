// 프로젝트 업무 탭용 리스트 — Q Task 테이블 디자인 그대로
// (프로젝트 컬럼·예측·실제 컬럼 제외)
import React, { useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import CalendarPicker from '../../components/Common/CalendarPicker';
import { apiFetch } from '../../contexts/AuthContext';
import { GanttHeader, GanttRowTrack, GanttBar, useGanttScrollSync, type GanttRange } from '../../components/Common/GanttTrack';
import { STATUS_COLOR, displayStatus, getStatusLabel, type StatusCode } from '../../utils/taskLabel';
import { getRoles, primaryPerspective } from '../../utils/taskRoles';

export interface TaskRow {
  id: number; project_id: number | null; business_id: number;
  title: string; description?: string | null;
  status: string; due_date: string | null; start_date: string | null;
  progress_percent: number; priority_order?: number | null;
  assignee_id: number | null; assignee?: { id: number; name: string } | null;
  requester?: { id: number; name: string } | null;
  source?: string; request_by_user_id?: number | null; created_by?: number;
  request_ack_at?: string | null; review_round?: number | null;
  reviewers?: Array<{ id: number; user_id: number; state: 'pending'|'approved'|'revision'; is_client?: boolean }>;
}

// 업무 종류별 드롭다운 옵션 (Q Task 와 동일)
const statusOptionsFor = (task: { source?: string }): string[] => {
  const isReq = task.source === 'internal_request' || task.source === 'qtalk_extract';
  if (isReq) return ['not_started', 'waiting', 'in_progress', 'reviewing', 'revision_requested', 'completed', 'canceled'];
  return ['not_started', 'in_progress', 'reviewing', 'revision_requested', 'completed', 'canceled'];
};

type SortKey = 'priority_order' | 'title' | 'status' | 'progress_percent' | 'due_date';
type SortDir = 'asc' | 'desc';

type Props = {
  tasks: TaskRow[];
  members: { user_id: number; name: string }[];
  businessId: number;
  myId: number;
  selectedId?: number | null;
  onOpen: (id: number) => void;
  onLocalUpdate: (taskId: number, patch: Partial<TaskRow>) => void;
  showTimeline?: boolean; // split view
  projectStart?: string | null;
  projectEnd?: string | null;
};

const ProjectTaskList: React.FC<Props> = ({
  tasks, members, businessId, myId, selectedId, onOpen, onLocalUpdate,
  showTimeline, projectStart, projectEnd,
}) => {
  const [sortKey, setSortKey] = useState<SortKey>('priority_order');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editingTitle, setEditingTitle] = useState<number | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [statusOpenId, setStatusOpenId] = useState<number | null>(null);
  const [dateOpenId, setDateOpenId] = useState<number | null>(null);
  const [assigneeOpenId, setAssigneeOpenId] = useState<number | null>(null);
  const dateRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  // 타임라인 가로 스크롤 동기화 — 공용 훅
  const gantt = useGanttScrollSync();
  const { t } = useTranslation('qtask');

  // 상태 드롭다운 옵션 라벨 — not_started + 요청업무 + 미ack 면 task_requested 로 표시
  const optionLabel = (task: TaskRow, status: string, role: string): string => {
    const isReq = task.source === 'internal_request' || task.source === 'qtalk_extract';
    if (status === 'not_started' && isReq && !task.request_ack_at) {
      return t(`status.task_requested.${role}`, t('status.task_requested.observer', '업무요청')) as string;
    }
    return t(`status.${status}.${role}`, t(`status.${status}.observer`, status)) as string;
  };

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };
  const sortIcon = (k: SortKey) => sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '';

  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...tasks].sort((a, b) => {
    const va = a[sortKey] as unknown;
    const vb = b[sortKey] as unknown;
    const aNull = va == null || va === '';
    const bNull = vb == null || vb === '';
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof va === 'string' && typeof vb === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === 'asc' ? Number(va) - Number(vb) : Number(vb) - Number(va);
  });

  const saveField = async (taskId: number, field: string, value: unknown) => {
    onLocalUpdate(taskId, { [field]: value } as Partial<TaskRow>);
    await apiFetch(`/api/tasks/by-business/${businessId}/${taskId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
  };


  // 타임라인 범위 — GanttRange. 업무/프로젝트 일자 합쳐서 최소·최대.
  const range: GanttRange | null = useMemo(() => {
    const datesAll: string[] = [];
    if (projectStart) datesAll.push(projectStart.slice(0, 10));
    if (projectEnd) datesAll.push(projectEnd.slice(0, 10));
    tasks.forEach(t => { if (t.start_date) datesAll.push(t.start_date.slice(0, 10)); if (t.due_date) datesAll.push(t.due_date.slice(0, 10)); });
    if (datesAll.length === 0) return null;
    const s = datesAll.reduce((a, b) => a < b ? a : b);
    const e = datesAll.reduce((a, b) => a > b ? a : b);
    return { from: s, to: e };
  }, [tasks, projectStart, projectEnd]);

  return (
    <>
      <ColRow>
        <Col $flex onClick={() => handleSort('title')}>{t('col.task', '업무')} {sortIcon('title')}</Col>
        <Col $w={showTimeline ? '90px' : '150px'} $center $hideBelow={900}>{t('col.assignee', '담당자')}</Col>
        <Col $w={showTimeline ? '60px' : '100px'} $center onClick={() => handleSort('status')}>{t('col.status', '상태')} {sortIcon('status')}</Col>
        <Col $w={showTimeline ? '110px' : '180px'} $hideBelow={1024} $center onClick={() => handleSort('progress_percent')}>{t('col.progressPercent', '진행률')} {sortIcon('progress_percent')}</Col>
        <Col $w={showTimeline ? '120px' : '170px'} $center $hideBelow={768} onClick={() => handleSort('due_date')}>{t('col.dates', '시작 ~ 마감')} {sortIcon('due_date')}</Col>
        {showTimeline && range && (
          <Col $flex2 $center style={{ position: 'relative', overflow: 'visible' }}>
            <GanttHeader registry={gantt} range={range} tickMode="auto" />
          </Col>
        )}
        {!showTimeline && <Col $flex $hideBelow={768}>{t('col.desc', '설명')}</Col>}
      </ColRow>

      {sorted.map(task => {
        const isDelayed = !!(task.due_date && task.due_date.slice(0, 10) < today && task.status !== 'completed' && task.status !== 'canceled');
        const dispStatus = displayStatus(task, today);
        const sc = STATUS_COLOR[dispStatus as StatusCode] || STATUS_COLOR.not_started;
        const role = primaryPerspective(getRoles(task, myId));
        const statusLabel = getStatusLabel(task, role, today, (k, f) => t(k, f || k));
        const isEditing = editingTitle === task.id;
        const prog = task.progress_percent || 0;
        const sliderColor = task.status === 'completed' ? '#94A3B8' : isDelayed ? '#DC2626' : '#14B8A6';


        return (
          <TRow key={task.id} $done={task.status === 'completed'} $delayed={isDelayed} $selected={selectedId === task.id}
            onClick={(e) => {
              const tgt = e.target as HTMLElement;
              if (tgt.closest('button,a,input,select,textarea,[role="button"],[data-dropdown]')) return;
              onOpen(task.id);
            }}
            style={{ cursor: 'pointer' }}>

            <TCell $flex>
              <TaskCheck type="checkbox" checked={task.status === 'completed'}
                onChange={() => saveField(task.id, 'status', task.status === 'completed' ? 'in_progress' : 'completed')} />
              {isEditing ? (
                <TitleInput autoFocus value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onMouseDown={e => e.stopPropagation()}
                  onBlur={() => { if (titleDraft.trim() && titleDraft !== task.title) saveField(task.id, 'title', titleDraft.trim()); setEditingTitle(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingTitle(null); }} />
              ) : (<>
                <TaskTitle role="button" $done={task.status === 'completed'}
                  onClick={(e) => { e.stopPropagation(); setEditingTitle(task.id); setTitleDraft(task.title); }}
                  title={t('list.titleClickEdit', '클릭하여 업무명 수정') as string}>
                  {task.title}
                </TaskTitle>
                {(() => {
                  if (task.assignee_id === myId && (task.source === 'internal_request' || task.source === 'qtalk_extract') && task.requester?.name)
                    return <NameChip $type="from">{task.requester.name}</NameChip>;
                  if ((task.request_by_user_id === myId || task.created_by === myId) && task.assignee?.name && task.assignee_id !== myId)
                    return <NameChip $type="to">{task.assignee.name}</NameChip>;
                  if (task.assignee?.name && task.assignee_id !== myId)
                    return <NameChip $type="observer">{task.assignee.name}</NameChip>;
                  return null;
                })()}
                {isDelayed && <DelayBadge>{t('status.delayed', '지연')}</DelayBadge>}
                <DetailBtn $active={selectedId === task.id} onClick={e => { e.stopPropagation(); onOpen(task.id); }} title={t('listRow.detailTitle', '상세 보기') as string}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                </DetailBtn>
              </>)}
            </TCell>
            <TCell $w={showTimeline ? '90px' : '150px'} $center $hideBelow={900} style={{ position: 'relative', overflow: 'visible' }}>
              <AssigneeLabel onClick={e => { e.stopPropagation(); setAssigneeOpenId(assigneeOpenId === task.id ? null : task.id); }}>
                {task.assignee?.name || <span style={{ color: '#CBD5E1' }}>{t('listRow.assigneePlaceholder', '담당자')}</span>}
              </AssigneeLabel>
              {assigneeOpenId === task.id && (
                <AssigneeDropdown onClick={e => e.stopPropagation()}>
                  {members.length === 0 && <AssigneeOpt>{t('listRow.noMembers', '멤버 없음')}</AssigneeOpt>}
                  <AssigneeOpt $active={!task.assignee_id} onClick={() => { saveField(task.id, 'assignee_id', null); onLocalUpdate(task.id, { assignee: null }); setAssigneeOpenId(null); }}>{t('listRow.noAssignee', '— 없음 —')}</AssigneeOpt>
                  {members.map(m => (
                    <AssigneeOpt key={m.user_id} $active={task.assignee_id === m.user_id}
                      onClick={() => { saveField(task.id, 'assignee_id', m.user_id); onLocalUpdate(task.id, { assignee: { id: m.user_id, name: m.name } }); setAssigneeOpenId(null); }}>
                      {m.name}{m.user_id === myId ? t('listRow.meSuffix', ' (나)') : ''}
                    </AssigneeOpt>
                  ))}
                </AssigneeDropdown>
              )}
            </TCell>
            <TCell $w={showTimeline ? '60px' : '100px'} $center style={{ position: 'relative', overflow: 'visible' }}>
              <StatusPill $bg={sc.bg} $fg={sc.fg} $clickable
                onClick={e => { e.stopPropagation(); setStatusOpenId(statusOpenId === task.id ? null : task.id); }}>
                {statusLabel}
              </StatusPill>
              {statusOpenId === task.id && (
                <StatusDropdown>
                  {statusOptionsFor(task).map(s => {
                    const c = STATUS_COLOR[s as StatusCode] || STATUS_COLOR.not_started;
                    return (
                      <StatusOption key={s} $bg={c.bg} $fg={c.fg} $active={task.status === s}
                        onClick={e => { e.stopPropagation(); saveField(task.id, 'status', s); setStatusOpenId(null); }}>
                        {optionLabel(task, s, role)}
                      </StatusOption>
                    );
                  })}
                </StatusDropdown>
              )}
            </TCell>
            <TCell $w={showTimeline ? '110px' : '180px'} $center $hideBelow={1024}>
              <SliderWrap>
                <SliderTrack><SliderFill $w={prog} $color={sliderColor} /></SliderTrack>
                <SliderRange type="range" min="0" max="100" step="5" value={prog}
                  onClick={e => e.stopPropagation()}
                  onChange={e => onLocalUpdate(task.id, { progress_percent: Number(e.target.value) })}
                  onMouseUp={e => saveField(task.id, 'progress_percent', Number((e.target as HTMLInputElement).value))} />
                <SliderPct>{prog}%</SliderPct>
              </SliderWrap>
            </TCell>
            <TCell $w={showTimeline ? '120px' : '170px'} $center $hideBelow={768}>
              <DateTrigger ref={el => { dateRefs.current[task.id] = el; }}
                $color={isDelayed ? 'overdue' : (task.due_date?.slice(0, 10) === today ? 'today' : 'default')}
                $empty={!(task.start_date || task.due_date)}
                onClick={e => { e.stopPropagation(); setDateOpenId(dateOpenId === task.id ? null : task.id); }}>
                {(() => {
                  const s = task.start_date?.slice(0, 10);
                  const d = task.due_date?.slice(0, 10);
                  const fmt = (v?: string) => v ? v.slice(5).replace('-', '/') : '';
                  if (!s && !d) return t('listRow.emptyDash', '—');
                  if (s && d && s !== d) return `${fmt(s)} ~ ${fmt(d)}`;
                  return fmt(d || s);
                })()}
              </DateTrigger>
              {dateOpenId === task.id && (
                <CalendarPicker isOpen anchorRef={{ current: dateRefs.current[task.id] }}
                  startDate={task.start_date?.slice(0, 10) || ''} endDate={task.due_date?.slice(0, 10) || task.start_date?.slice(0, 10) || ''}
                  onRangeSelect={(s, e) => { saveField(task.id, 'start_date', s || null); saveField(task.id, 'due_date', e || null); }}
                  onClose={() => setDateOpenId(null)} />
              )}
            </TCell>
            {!showTimeline && (
              <TCell $flex $hideBelow={768} style={{ padding: '0 8px' }}>
                <DescText>{task.description || <DescEmpty>{t('listRow.emptyDash', '—')}</DescEmpty>}</DescText>
              </TCell>
            )}
            {showTimeline && range && (
              <TCell $flex2 style={{ overflow: 'visible' }}>
                <GanttRowTrack registry={gantt} range={range} todayStr={today} showGrid>
                  <GanttBar range={range} start={task.start_date} end={task.due_date}
                    bg={sc.bg} fg={sc.fg} label={task.assignee?.name || ''}
                    onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}
                    title={`${task.start_date?.slice(0,10) || ''} ~ ${task.due_date?.slice(0,10) || ''}`} />
                </GanttRowTrack>
              </TCell>
            )}
          </TRow>
        );
      })}
      {sorted.length === 0 && <EmptyMsg>{t('list.empty', '업무가 없습니다')}</EmptyMsg>}
    </>
  );
};

export default ProjectTaskList;

// ═══ Styled (Q Task 와 완전 동일) ═══
const ColRow = styled.div`display:flex;align-items:center;gap:6px;padding:6px 14px;border-bottom:1px solid #E2E8F0;background:#F8FAFC;position:sticky;top:0;z-index:1;`;
const Col = styled.span<{$w?:string;$flex?:boolean;$flex2?:boolean;$center?:boolean;$hideBelow?:number}>`
  box-sizing:border-box;
  ${p=>p.$flex2 ? 'flex:2 1 0;min-width:240px;' : p.$flex ? 'flex:1 1 0;min-width:120px;' : `flex:0 0 ${p.$w||'auto'};width:${p.$w||'auto'};`}
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11px;font-weight:700;color:#94A3B8;cursor:pointer;user-select:none;
  ${p=>p.$center&&'text-align:center;'}
  &:hover{color:#475569;}
  ${p=>p.$hideBelow?`@media (max-width: ${p.$hideBelow}px){display:none;}`:''}
`;
const TRow = styled.div<{$done?:boolean;$delayed?:boolean;$selected?:boolean}>`
  display:flex;align-items:center;gap:6px;padding:7px 14px;border-bottom:1px solid #F8FAFC;
  opacity:${p=>p.$done?0.45:1};
  ${p=>p.$selected?'background:#FFF1F2;box-shadow:inset 3px 0 0 #F43F5E;':p.$delayed&&!p.$done?'box-shadow:inset 3px 0 0 #DC2626;':''}
  &:hover{background:${p=>p.$selected?'#FFE4E6':p.$delayed&&!p.$done?'#FEF2F2':'#FAFBFC'};}
`;
const TCell = styled.div<{$w?:string;$flex?:boolean;$flex2?:boolean;$center?:boolean;$hideBelow?:number}>`
  box-sizing:border-box;
  ${p=>p.$flex2 ? 'flex:2 1 0;min-width:240px;display:flex;align-items:center;gap:6px;overflow:hidden;' : p.$flex ? 'flex:1 1 0;min-width:120px;display:flex;align-items:center;gap:6px;overflow:hidden;' : `flex:0 0 ${p.$w||'auto'};width:${p.$w||'auto'};overflow:hidden;`}
  ${p=>p.$center&&'display:flex;justify-content:center;align-items:center;'}
  ${p=>p.$hideBelow?`@media (max-width: ${p.$hideBelow}px){display:none;}`:''}
`;
const TaskCheck = styled.input`accent-color:#0D9488;cursor:pointer;width:15px;height:15px;flex-shrink:0;`;
const TaskTitle = styled.span<{$done?:boolean}>`font-size:14px;font-weight:500;color:#0F172A;cursor:text;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${p=>p.$done&&'text-decoration:line-through;color:#94A3B8;'}&:hover{color:#0F766E;}`;
const TitleInput = styled.input`flex:1;font-size:14px;font-weight:500;color:#0F172A;border:1px solid #14B8A6;background:#F0FDFA;padding:2px 8px;border-radius:6px;font-family:inherit;height:24px;box-sizing:border-box;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}`;
const DelayBadge = styled.span`padding:1px 6px;font-size:9px;font-weight:700;color:#DC2626;background:#FEF2F2;border:1px solid #FECACA;border-radius:4px;flex-shrink:0;white-space:nowrap;`;
const DetailBtn = styled.button<{$active?:boolean}>`display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:${p=>p.$active?'#F43F5E':'transparent'};border:1px solid ${p=>p.$active?'#F43F5E':'transparent'};border-radius:6px;color:${p=>p.$active?'#FFF':'#94A3B8'};cursor:pointer;flex-shrink:0;transition:all 0.15s;&:hover{background:${p=>p.$active?'#E11D48':'#F1F5F9'};color:${p=>p.$active?'#FFF':'#0F766E'};border-color:${p=>p.$active?'#E11D48':'#E2E8F0'};}`;
const NameChip = styled.span<{$type:'from'|'to'|'observer'}>`
  display:inline-flex;align-items:center;padding:1px 8px;font-size:10px;font-weight:700;border-radius:8px;white-space:nowrap;flex-shrink:0;
  ${p=>p.$type==='from'?'background:#FFF1F2;color:#9F1239;'
    :p.$type==='to'?'background:#F0FDFA;color:#0F766E;'
    :'background:#F1F5F9;color:#64748B;'}
`;
const StatusPill = styled.span<{$bg:string;$fg:string;$clickable?:boolean}>`
  padding:2px 8px;background:${p=>p.$bg};color:${p=>p.$fg};font-size:10px;font-weight:600;
  border-radius:8px;white-space:nowrap;${p=>p.$clickable?'cursor:pointer;user-select:none;&:hover{filter:brightness(0.96);}':''}
`;
const StatusDropdown = styled.div`position:absolute;top:100%;left:50%;transform:translateX(-50%);z-index:100;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:4px;min-width:100px;margin-top:4px;`;
const StatusOption = styled.button<{$bg:string;$fg:string;$active?:boolean}>`
  display:block;width:100%;padding:5px 10px;font-size:11px;font-weight:600;text-align:left;border:none;border-radius:6px;cursor:pointer;
  background:${p=>p.$active?p.$bg:'transparent'};color:${p=>p.$fg};&:hover{background:${p=>p.$bg};}
`;
const SliderWrap = styled.div`display:flex;align-items:center;gap:6px;width:100%;position:relative;`;
const SliderTrack = styled.div`flex:1;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden;`;
const SliderFill = styled.div<{$w:number;$color:string}>`height:100%;width:${p=>p.$w}%;background:${p=>p.$color};border-radius:3px;`;
const SliderRange = styled.input`position:absolute;left:0;top:-4px;width:calc(100% - 40px);height:18px;opacity:0;cursor:pointer;`;
const SliderPct = styled.span`font-size:12px;font-weight:700;color:#475569;min-width:32px;text-align:right;`;
const DateTrigger = styled.button<{$color?:string;$empty?:boolean}>`
  width:100%;padding:4px 6px;font-size:12px;font-weight:600;background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer;white-space:nowrap;font-family:inherit;text-align:center;
  color:${p=>p.$empty?'#CBD5E1':p.$color==='overdue'?'#DC2626':p.$color==='today'?'#EA580C':'#64748B'};
  ${p=>p.$color==='overdue'&&!p.$empty?'background:#FEF2F2;':p.$color==='today'&&!p.$empty?'background:#FFF7ED;':''}
  &:hover{border-color:#14B8A6;color:#0F766E;}
`;
const AssigneeLabel = styled.span`display:inline-block;font-size:12px;color:#0F172A;cursor:pointer;padding:2px 6px;border-radius:4px;&:hover{background:#F1F5F9;}`;
const AssigneeDropdown = styled.div`position:absolute;top:100%;left:0;z-index:100;min-width:140px;max-height:220px;overflow-y:auto;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:4px;margin-top:4px;`;
const AssigneeOpt = styled.button<{$active?:boolean}>`display:block;width:100%;padding:5px 10px;font-size:12px;text-align:left;border:none;border-radius:6px;cursor:pointer;background:${p=>p.$active?'#F0FDFA':'transparent'};color:${p=>p.$active?'#0F766E':'#0F172A'};font-weight:${p=>p.$active?600:500};&:hover{background:#F0FDFA;color:#0F766E;}`;
const EmptyMsg = styled.div`padding:32px;text-align:center;color:#94A3B8;font-size:13px;`;
const DescText = styled.span`font-size:12px;color:#64748B;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;`;
const DescEmpty = styled.span`color:#CBD5E1;`;
