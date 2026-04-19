// 프로젝트 업무 탭용 리스트 — Q Task 테이블 디자인 그대로
// (프로젝트 컬럼·예측·실제 컬럼 제외)
import React, { useRef, useState } from 'react';
import styled from 'styled-components';
import CalendarPicker from '../../components/Common/CalendarPicker';
import { apiFetch } from '../../contexts/AuthContext';

export interface TaskRow {
  id: number; project_id: number | null; business_id: number;
  title: string; status: string; due_date: string | null; start_date: string | null;
  progress_percent: number; priority_order?: number | null;
  assignee_id: number | null; assignee?: { id: number; name: string } | null;
  requester?: { id: number; name: string } | null;
  source?: string; request_by_user_id?: number | null; created_by?: number;
}

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  not_started: { bg: '#F1F5F9', fg: '#475569' },
  waiting: { bg: '#FEF3C7', fg: '#92400E' },
  task_requested: { bg: '#FFF1F2', fg: '#9F1239' },
  in_progress: { bg: '#CCFBF1', fg: '#0F766E' },
  reviewing: { bg: '#DBEAFE', fg: '#1E40AF' },
  revision_requested: { bg: '#FED7AA', fg: '#9A3412' },
  done_feedback: { bg: '#DCFCE7', fg: '#166534' },
  completed: { bg: '#E2E8F0', fg: '#475569' },
  canceled: { bg: '#F1F5F9', fg: '#94A3B8' },
};
const STATUS_LABEL: Record<string, string> = {
  not_started: '미시작', waiting: '대기', in_progress: '진행중',
  reviewing: '컨펌중', revision_requested: '수정요청', done_feedback: '마무리',
  completed: '완료', canceled: '취소',
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


  // 타임라인 범위
  let tlMin: number | null = null, tlMax: number | null = null;
  const datesAll: string[] = [];
  if (projectStart) datesAll.push(projectStart.slice(0, 10));
  if (projectEnd) datesAll.push(projectEnd.slice(0, 10));
  tasks.forEach(t => { if (t.start_date) datesAll.push(t.start_date.slice(0, 10)); if (t.due_date) datesAll.push(t.due_date.slice(0, 10)); });
  if (datesAll.length) {
    const s = datesAll.reduce((a, b) => a < b ? a : b);
    const e = datesAll.reduce((a, b) => a > b ? a : b);
    tlMin = new Date(s).getTime();
    tlMax = new Date(e).getTime();
  }
  const tlRange = tlMax && tlMin ? Math.max(1, (tlMax - tlMin) / 86400000 + 1) : 1;
  const pctOf = (d: string) => tlMin == null ? 0 : ((new Date(d.slice(0, 10)).getTime() - tlMin) / 86400000 / tlRange) * 100;

  return (
    <>
      <ColRow>
        <Col $flex onClick={() => handleSort('title')}>업무 {sortIcon('title')}</Col>
        <Col $w="110px" $hideBelow={900}>담당자</Col>
        <Col $w="68px" $center onClick={() => handleSort('status')}>상태 {sortIcon('status')}</Col>
        <Col $w="130px" $hideBelow={1024} $center onClick={() => handleSort('progress_percent')}>진행률 {sortIcon('progress_percent')}</Col>
        <Col $w="140px" $center $hideBelow={768} onClick={() => handleSort('due_date')}>시작 ~ 마감 {sortIcon('due_date')}</Col>
        {showTimeline && (
          <Col $flex $center style={{ position: 'relative', overflow: 'visible' }}>
            <TLScrollable>
              <TLHeadInner $minWidth={Math.max(300, tlRange * 30)}>
                {(() => {
                  if (tlMin == null || tlMax == null) return null;
                  const ticks: { date: string; label: string }[] = [];
                  const step = Math.max(1, Math.ceil(tlRange / 10));
                  for (let i = 0; i <= tlRange; i += step) {
                    const d = new Date(tlMin + i * 86400000);
                    ticks.push({ date: d.toISOString().slice(0, 10), label: `${d.getMonth() + 1}/${d.getDate()}` });
                  }
                  return ticks.map((tk, i) => (
                    <TLTick key={i} style={{ left: `${((new Date(tk.date).getTime() - tlMin) / 86400000 / tlRange) * 100}%` }}>{tk.label}</TLTick>
                  ));
                })()}
              </TLHeadInner>
            </TLScrollable>
          </Col>
        )}
      </ColRow>

      {sorted.map(task => {
        const isDelayed = !!(task.due_date && task.due_date.slice(0, 10) < today && task.status !== 'completed' && task.status !== 'canceled');
        const sc = STATUS_COLOR[task.status] || STATUS_COLOR.not_started;
        const label = STATUS_LABEL[task.status] || task.status;
        const isEditing = editingTitle === task.id;
        const prog = task.progress_percent || 0;
        const sliderColor = task.status === 'completed' ? '#94A3B8' : isDelayed ? '#DC2626' : '#14B8A6';

        const barLeft = (task.start_date || task.due_date) ? pctOf(task.start_date || task.due_date!) : 0;
        const barRight = (task.due_date || task.start_date) ? pctOf(task.due_date || task.start_date!) : 0;
        const barWidth = Math.max(2, barRight - barLeft + (1 / tlRange) * 100);

        return (
          <TRow key={task.id} $done={task.status === 'completed'} $delayed={isDelayed} $selected={selectedId === task.id}>
            <TCell $flex>
              <TaskCheck type="checkbox" checked={task.status === 'completed'}
                onChange={() => saveField(task.id, 'status', task.status === 'completed' ? 'in_progress' : 'completed')} />
              {isEditing ? (
                <TitleInput autoFocus value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={() => { if (titleDraft.trim() && titleDraft !== task.title) saveField(task.id, 'title', titleDraft.trim()); setEditingTitle(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingTitle(null); }} />
              ) : (<>
                <TaskTitle $done={task.status === 'completed'} onClick={() => { setEditingTitle(task.id); setTitleDraft(task.title); }}>
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
                {isDelayed && <DelayBadge>지연</DelayBadge>}
                <DetailBtn $active={selectedId === task.id} onClick={e => { e.stopPropagation(); onOpen(task.id); }} title="상세 보기">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                </DetailBtn>
              </>)}
            </TCell>
            <TCell $w="110px" $hideBelow={900} style={{ position: 'relative', overflow: 'visible' }}>
              <AssigneeLabel onClick={e => { e.stopPropagation(); setAssigneeOpenId(assigneeOpenId === task.id ? null : task.id); }}>
                {task.assignee?.name || <span style={{ color: '#CBD5E1' }}>담당자</span>}
              </AssigneeLabel>
              {assigneeOpenId === task.id && (
                <AssigneeDropdown onClick={e => e.stopPropagation()}>
                  {members.length === 0 && <AssigneeOpt>멤버 없음</AssigneeOpt>}
                  <AssigneeOpt $active={!task.assignee_id} onClick={() => { saveField(task.id, 'assignee_id', null); onLocalUpdate(task.id, { assignee: null }); setAssigneeOpenId(null); }}>— 없음 —</AssigneeOpt>
                  {members.map(m => (
                    <AssigneeOpt key={m.user_id} $active={task.assignee_id === m.user_id}
                      onClick={() => { saveField(task.id, 'assignee_id', m.user_id); onLocalUpdate(task.id, { assignee: { id: m.user_id, name: m.name } }); setAssigneeOpenId(null); }}>
                      {m.name}{m.user_id === myId ? ' (나)' : ''}
                    </AssigneeOpt>
                  ))}
                </AssigneeDropdown>
              )}
            </TCell>
            <TCell $w="68px" $center style={{ position: 'relative', overflow: 'visible' }}>
              <StatusPill $bg={sc.bg} $fg={sc.fg} $clickable
                onClick={e => { e.stopPropagation(); setStatusOpenId(statusOpenId === task.id ? null : task.id); }}>
                {label}
              </StatusPill>
              {statusOpenId === task.id && (
                <StatusDropdown>
                  {Object.keys(STATUS_LABEL).map(s => {
                    const c = STATUS_COLOR[s] || STATUS_COLOR.not_started;
                    return (
                      <StatusOption key={s} $bg={c.bg} $fg={c.fg} $active={task.status === s}
                        onClick={e => { e.stopPropagation(); saveField(task.id, 'status', s); setStatusOpenId(null); }}>
                        {STATUS_LABEL[s]}
                      </StatusOption>
                    );
                  })}
                </StatusDropdown>
              )}
            </TCell>
            <TCell $w="130px" $hideBelow={1024}>
              <SliderWrap>
                <SliderTrack><SliderFill $w={prog} $color={sliderColor} /></SliderTrack>
                <SliderRange type="range" min="0" max="100" step="5" value={prog}
                  onClick={e => e.stopPropagation()}
                  onChange={e => onLocalUpdate(task.id, { progress_percent: Number(e.target.value) })}
                  onMouseUp={e => saveField(task.id, 'progress_percent', Number((e.target as HTMLInputElement).value))} />
                <SliderPct>{prog}%</SliderPct>
              </SliderWrap>
            </TCell>
            <TCell $w="140px" $center $hideBelow={768}>
              <DateTrigger ref={el => { dateRefs.current[task.id] = el; }}
                $color={isDelayed ? 'overdue' : (task.due_date?.slice(0, 10) === today ? 'today' : 'default')}
                $empty={!(task.start_date || task.due_date)}
                onClick={e => { e.stopPropagation(); setDateOpenId(dateOpenId === task.id ? null : task.id); }}>
                {(task.start_date || task.due_date) ?
                  `${task.start_date?.slice(5, 10).replace('-', '/') || '—'} ~ ${task.due_date?.slice(5, 10).replace('-', '/') || '—'}`
                  : '—'}
              </DateTrigger>
              {dateOpenId === task.id && (
                <CalendarPicker isOpen anchorRef={{ current: dateRefs.current[task.id] }}
                  startDate={task.start_date?.slice(0, 10) || ''} endDate={task.due_date?.slice(0, 10) || task.start_date?.slice(0, 10) || ''}
                  onRangeSelect={(s, e) => { saveField(task.id, 'start_date', s || null); saveField(task.id, 'due_date', e || null); }}
                  onClose={() => setDateOpenId(null)} />
              )}
            </TCell>
            {showTimeline && (
              <TCell $flex style={{ overflow: 'visible' }}>
                <TLScrollable>
                  <TLTrack $minWidth={Math.max(300, tlRange * 30)}>
                    {(task.start_date || task.due_date) && (
                      <TLBar style={{ left: `${barLeft}%`, width: `${barWidth}%`, background: sc.fg }}>
                        <TLBarText>{task.assignee?.name || ''}</TLBarText>
                      </TLBar>
                    )}
                  </TLTrack>
                </TLScrollable>
              </TCell>
            )}
          </TRow>
        );
      })}
      {sorted.length === 0 && <EmptyMsg>업무가 없습니다</EmptyMsg>}
    </>
  );
};

export default ProjectTaskList;

// ═══ Styled (Q Task 와 완전 동일) ═══
const ColRow = styled.div`display:flex;align-items:center;gap:6px;padding:6px 14px;border-bottom:1px solid #E2E8F0;background:#F8FAFC;position:sticky;top:0;z-index:1;`;
const Col = styled.span<{$w?:string;$flex?:boolean;$center?:boolean;$hideBelow?:number}>`
  box-sizing:border-box;
  ${p=>p.$flex ? 'flex:1 1 0;min-width:120px;' : `flex:0 0 ${p.$w||'auto'};width:${p.$w||'auto'};`}
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
const TCell = styled.div<{$w?:string;$flex?:boolean;$center?:boolean;$hideBelow?:number}>`
  box-sizing:border-box;
  ${p=>p.$flex ? 'flex:1 1 0;min-width:120px;display:flex;align-items:center;gap:6px;overflow:hidden;' : `flex:0 0 ${p.$w||'auto'};width:${p.$w||'auto'};overflow:hidden;`}
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
  padding:2px 8px;background:${p=>p.$bg};color:${p=>p.$fg};font-size:10px;font-weight:700;
  border-radius:8px;white-space:nowrap;${p=>p.$clickable?'cursor:pointer;user-select:none;&:hover{opacity:0.8;}':''}
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
  width:100%;padding:4px 6px;font-size:12px;font-weight:600;background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer;white-space:nowrap;font-family:inherit;text-align:left;
  color:${p=>p.$empty?'#CBD5E1':p.$color==='overdue'?'#DC2626':p.$color==='today'?'#EA580C':'#64748B'};
  ${p=>p.$color==='overdue'&&!p.$empty?'background:#FEF2F2;':p.$color==='today'&&!p.$empty?'background:#FFF7ED;':''}
  &:hover{border-color:#14B8A6;color:#0F766E;}
`;
const AssigneeLabel = styled.span`display:inline-block;font-size:12px;color:#0F172A;cursor:pointer;padding:2px 6px;border-radius:4px;&:hover{background:#F1F5F9;}`;
const AssigneeDropdown = styled.div`position:absolute;top:100%;left:0;z-index:100;min-width:140px;max-height:220px;overflow-y:auto;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:4px;margin-top:4px;`;
const AssigneeOpt = styled.button<{$active?:boolean}>`display:block;width:100%;padding:5px 10px;font-size:12px;text-align:left;border:none;border-radius:6px;cursor:pointer;background:${p=>p.$active?'#F0FDFA':'transparent'};color:${p=>p.$active?'#0F766E':'#0F172A'};font-weight:${p=>p.$active?600:500};&:hover{background:#F0FDFA;color:#0F766E;}`;
const EmptyMsg = styled.div`padding:32px;text-align:center;color:#94A3B8;font-size:13px;`;
// 타임라인 셀 가로 스크롤 — 헤더와 행 모두 적용
const TLScrollable = styled.div`width:100%;overflow-x:auto;overflow-y:hidden;&::-webkit-scrollbar{height:6px;}&::-webkit-scrollbar-thumb{background:#E2E8F0;border-radius:3px;}`;
const TLHeadInner = styled.div<{$minWidth:number}>`position:relative;min-width:${p=>p.$minWidth}px;width:100%;height:24px;`;
const TLTrack = styled.div<{$minWidth:number}>`position:relative;min-width:${p=>p.$minWidth}px;width:100%;height:20px;background:#F8FAFC;border-radius:3px;`;
const TLBar = styled.div`position:absolute;top:2px;bottom:2px;border-radius:3px;display:flex;align-items:center;padding:0 6px;min-width:4px;overflow:hidden;`;
const TLBarText = styled.span`font-size:10px;color:#FFF;font-weight:600;white-space:nowrap;`;
const TLTick = styled.span`position:absolute;top:4px;font-size:10px;color:#94A3B8;font-weight:600;transform:translateX(-50%);`;
