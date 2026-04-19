import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { io, type Socket } from 'socket.io-client';
import { useAuth, getAccessToken } from '../../contexts/AuthContext';
import { apiFetch } from '../../contexts/AuthContext';
import CalendarPicker from '../../components/Common/CalendarPicker';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { todayInTz, mondayOfDateStr, addDaysStr, detectBrowserTz } from '../../utils/timezones';
import { STATUS_CODES, STATUS_COLOR, displayStatus, getStatusLabel, type StatusCode } from '../../utils/taskLabel';
import { getRoles, primaryPerspective } from '../../utils/taskRoles';

// ─── Types ───
type Scope = 'mine' | 'workspace';
type ListTab = 'week' | 'all' | 'requested';
type ViewMode = 'list' | 'kanban';
interface MemberOption { user_id: number; name: string; }
type SortKey = 'priority_order' | 'title' | 'status' | 'estimated_hours' | 'actual_hours' | 'progress_percent' | 'due_date';
type SortDir = 'asc' | 'desc';

interface TaskRow {
  id: number; title: string; description: string | null; status: string;
  priority_order: number | null; start_date: string | null; due_date: string | null;
  estimated_hours: number | null; actual_hours: number; progress_percent: number;
  planned_week_start: string | null; category: string | null;
  assignee_id: number | null; project_id: number | null; created_by: number;
  // Phase 1 워크플로우 필드
  source?: 'manual' | 'internal_request' | 'qtalk_extract';
  request_by_user_id?: number | null;
  request_ack_at?: string | null;
  Project?: { id: number; name: string } | null;
  assignee?: { id: number; name: string } | null;
  requester?: { id: number; name: string } | null;
  createdAt: string;
}
interface BurndownPoint { label: string; estimated_cumulative: number; actual_cumulative: number; }
interface IssueRow { id: number; body: string; author?: { name: string }; projectName?: string; }
interface NoteRow { id: number; body: string; author?: { name: string }; visibility?: string; projectName?: string; }
interface CommentRow { id: number; content: string; createdAt: string; author?: { name: string }; Task?: { id: number; title: string }; }
interface CandidateRow { id: number; title: string; description: string | null; project_name?: string; guessedAssignee?: { id: number; name: string }; guessed_due_date: string | null; }

// 라벨·displayStatus·STATUS_COLOR 는 utils 로 이동 — 관점별 라벨 반영
// (utils/taskLabel.ts + utils/taskRoles.ts)

function sliderColor(){return '#14B8A6';} // 단일 색상 — 깔끔하게

// 날짜 범위 셀 — 시작+마감 통합. 클릭 시 캘린더 피커 열림
const DateRangeCell:React.FC<{
  start:string|null|undefined; due:string|null|undefined;
  onSave:(start:string|null,due:string|null)=>void;
  dueColor?:string;
}>=({start,due,onSave,dueColor})=>{
  const[open,setOpen]=React.useState(false);
  const anchorRef=React.useRef<HTMLButtonElement>(null);
  const s=start?.slice(0,10)||''; const d=due?.slice(0,10)||'';
  const fmt=(v:string)=>v?v.slice(5).replace('-','/'):'';
  const label=s&&d?(s===d?fmt(d):`${fmt(s)} ~ ${fmt(d)}`):d?fmt(d):s?fmt(s):'-';
  const hasValue=!!(s||d);
  return(<>
    <DateTrigger ref={anchorRef} $color={dueColor} $empty={!hasValue}
      onClick={e=>{e.stopPropagation();setOpen(v=>!v);}}>
      {label}
    </DateTrigger>
    {open&&<CalendarPicker isOpen={open} startDate={s||d} endDate={d||s} anchorRef={anchorRef}
      onRangeSelect={(a,b)=>{onSave(a||null,b||null);}} onClose={()=>setOpen(false)} />}
  </>);
};
// fmtDate removed — using native date inputs now

const QTaskPage:React.FC=()=>{
  const{t}=useTranslation('qtask');
  const{user}=useAuth();
  const bizId=user?.business_id||null;
  const myId=user?Number(user.id):-1;

  const location=useLocation();
  const navigate=useNavigate();
  // pathname 기반 판정 (새로고침 시에도 안정적). useParams 는 라우트 매칭 변형에 취약해서 회피
  const scope:Scope=location.pathname.endsWith('/tasks/workspace')?'workspace':'mine';
  const setScope=(s:Scope)=>navigate(s==='workspace'?'/tasks/workspace':'/tasks');
  const[tab,setTab]=useState<ListTab>('week');
  const[viewMode,setViewMode]=useState<ViewMode>(()=>{
    try{ return (localStorage.getItem('qtask_view_mode') as ViewMode)||'list'; }catch{ return 'list'; }
  });
  const changeView=(v:ViewMode)=>{ setViewMode(v); try{localStorage.setItem('qtask_view_mode',v);}catch{} };
  const[allTasks,setAllTasks]=useState<TaskRow[]>([]);
  const[members,setMembers]=useState<MemberOption[]>([]);
  const[assigneeFilter,setAssigneeFilter]=useState<number|null>(null); // workspace mode 담당자 필터
  const[backlog,setBacklog]=useState<TaskRow[]>([]);
  const[capacity,setCapacity]=useState<{daily:number;days:number;rate:number;weekly:number}>({daily:8,days:5,rate:1,weekly:40});
  const[burndown,_setBurndown]=useState<BurndownPoint[]>([]);
  void burndown;
  const[issues,setIssues]=useState<IssueRow[]>([]);
  const[notes,setNotes]=useState<NoteRow[]>([]);
  const[loading,setLoading]=useState(true);
  const[rightCollapsed,setRightCollapsed]=useState(false);
  const[holidayDays,setHolidayDays]=useState(0);

  // 워크스페이스 tz 기준 오늘/월요일 — 모든 업무 경계 계산의 기준
  const wsTz=user?.workspace_timezone||detectBrowserTz();
  const todayStr=todayInTz(wsTz);
  const thisMondayStr=mondayOfDateStr(todayStr);

  // Period range (기본: 이번 주 월~금)
  const[periodFrom,setPeriodFrom]=useState(()=>thisMondayStr);
  const[periodTo,setPeriodTo]=useState(()=>addDaysStr(thisMondayStr,6));

  // Filters
  const[search,setSearch]=useState('');
  const[statusFilter,setStatusFilter]=useState('');
  const[hideCompleted,setHideCompleted]=useState(false);
  const[sortKey,setSortKey]=useState<SortKey>('due_date');
  const[sortDir,setSortDir]=useState<SortDir>('asc');

  // Inline edit
  const[editingTitle,setEditingTitle]=useState<number|null>(null);
  const[titleDraft,setTitleDraft]=useState('');
  const[addingTask,setAddingTask]=useState(false);
  const[newTitle,setNewTitle]=useState('');
  const[newAssignee,setNewAssignee]=useState<number|null>(null);
  const[statusDropdownId,setStatusDropdownId]=useState<number|null>(null);
  const[detailTaskId,setDetailTaskId]=useState<number|null>(null);
  const[detailTask,setDetailTask]=useState<(TaskRow&{comments?:CommentRow[];description?:string|null;daily_progress?:{snapshot_date:string;progress_percent:number;actual_hours:number;estimated_hours:number|null}[]})|null>(null);
  const[newComment,setNewComment]=useState('');
  const[requestedComments,setRequestedComments]=useState<CommentRow[]>([]);
  const[candidates,setCandidates]=useState<CandidateRow[]>([]);
  const[periodPickerOpen,setPeriodPickerOpen]=useState(false);
  const periodAnchorRef=React.useRef<HTMLButtonElement>(null);
  const[dailyProgress,setDailyProgress]=useState<{date:string;est_used:number;act_used:number}[]>([]);

  const thisMonday=thisMondayStr;

  // ── Load ALL data once ──
  const load=useCallback(async()=>{
    if(!bizId)return;
    setLoading(true);
    try{
      // All my tasks (전체 — workspace 모드에서도 재사용)
      const r=await(await apiFetch(`/api/projects/workspace/${bizId}/all-tasks`)).json();
      if(r.success)setAllTasks(r.data||[]);

      // 멤버 목록 (업무 추가 시 담당자 선택용)
      try{
        const mr=await(await apiFetch(`/api/businesses/${bizId}/members`)).json();
        if(mr.success){
          const opts=(mr.data||[])
            .filter((m:{user?:{is_ai?:boolean}})=>!m.user?.is_ai)
            .map((m:{user_id:number;user?:{name:string}})=>({user_id:m.user_id,name:m.user?.name||`user ${m.user_id}`}));
          setMembers(opts);
        }
      }catch{}

      // Backlog
      const bl=await(await apiFetch(`/api/tasks/backlog?business_id=${bizId}`)).json();
      if(bl.success)setBacklog(bl.data||[]);

      // Week capacity + burndown
      const wr=await(await apiFetch(`/api/tasks/my-week?business_id=${bizId}`)).json();
      if(wr.success){
        setCapacity(wr.data.capacity);
        _setBurndown((wr.data.burndown||[]).map((b:Record<string,unknown>)=>({label:b.label as string,estimated_cumulative:b.estimated_cumulative as number,actual_cumulative:b.actual_cumulative as number})));
      }

      // Issues + Notes (프로젝트명 포함)
      const projMap=new Map<number,string>();
      for(const t of (r.data||[]) as TaskRow[]){if(t.project_id&&t.Project?.name)projMap.set(t.project_id,t.Project.name);}
      const projIds=[...projMap.keys()];
      const ai:IssueRow[]=[];const an:NoteRow[]=[];
      for(const pid of projIds.slice(0,5)){
        const pName=projMap.get(pid)||'';
        try{
          const ir=await(await apiFetch(`/api/projects/${pid}/issues`)).json();
          if(ir.success)ai.push(...(ir.data||[]).slice(0,2).map((i:IssueRow)=>({...i,projectName:pName})));
          const nr=await(await apiFetch(`/api/projects/${pid}/notes`)).json();
          if(nr.success)an.push(...(nr.data||[]).slice(0,2).map((n:NoteRow)=>({...n,projectName:pName})));
        }catch{}
      }
      setIssues(ai.slice(0,5));setNotes(an.slice(0,5));

      // 요청한 업무 댓글
      try{
        const rc=await(await apiFetch(`/api/tasks/requested-comments?business_id=${bizId}`)).json();
        if(rc.success)setRequestedComments(rc.data||[]);
      }catch{}

      // Q Talk 추출 후보 (전체업무 탭용)
      try{
        const ec=await(await apiFetch(`/api/tasks/extracted-candidates?business_id=${bizId}`)).json();
        if(ec.success)setCandidates(ec.data||[]);
      }catch{}
    }catch{}
    setLoading(false);
  },[bizId]);

  useEffect(()=>{load();},[load]);

  // Socket.IO — 워크스페이스 room 에서 task:new 수신 (Q Talk 에서 후보 등록 시 즉시 반영)
  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    if (!bizId) return;
    const token = getAccessToken();
    if (!token) return;
    const s = io({ auth: { token }, transports: ['websocket'] });
    socketRef.current = s;
    s.on('connect', () => { s.emit('join:business', bizId); });
    s.on('task:new', (task: TaskRow) => {
      setAllTasks((prev) => {
        if (prev.some((t) => t.id === task.id)) return prev;
        return [task, ...prev];
      });
    });
    s.on('task:updated', (task: TaskRow) => {
      setAllTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...task } : t)));
    });
    s.on('task:deleted', (meta: { id: number }) => {
      setAllTasks((prev) => prev.filter((t) => t.id !== meta.id));
    });
    return () => {
      s.emit('leave:business', bizId);
      s.disconnect();
      socketRef.current = null;
    };
  }, [bizId]);

  // Period 변경 시 일별 스냅샷 로드
  useEffect(()=>{
    if(!bizId)return;
    (async()=>{
      try{
        const r=await(await apiFetch(`/api/tasks/daily-progress?business_id=${bizId}&from=${periodFrom}&to=${periodTo}`)).json();
        if(r.success)setDailyProgress(r.data?.days||[]);
      }catch{}
    })();
  },[bizId,periodFrom,periodTo]);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(()=>{
    if(!statusDropdownId)return;
    // 바깥 클릭(또는 Escape) 시에만 닫기. 드롭다운 자체 클릭은 data-dropdown 내부면 무시.
    const close=(e:MouseEvent|KeyboardEvent)=>{
      if(e instanceof KeyboardEvent){
        if(e.key==='Escape')setStatusDropdownId(null);
        return;
      }
      const target=e.target as HTMLElement|null;
      if(target&&target.closest('[data-dropdown="status"]'))return;
      setStatusDropdownId(null);
    };
    // 여는 트리거 이벤트가 window.click 으로 버블되기 전에 리스너 등록되면 즉시 닫힘.
    // 다음 틱에 등록하여 같은 이벤트에 반응 안 하도록.
    const id=window.setTimeout(()=>{
      window.addEventListener('click',close as EventListener);
      window.addEventListener('keydown',close as EventListener);
    },0);
    return()=>{
      window.clearTimeout(id);
      window.removeEventListener('click',close as EventListener);
      window.removeEventListener('keydown',close as EventListener);
    };
  },[statusDropdownId]);

  // ── Save helpers ──
  const saveField=async(taskId:number,field:string,value:unknown)=>{
    try{
      await apiFetch(`/api/tasks/${taskId}/time`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({[field]:value})});
      setAllTasks(prev=>prev.map(t=>{
        if(t.id!==taskId)return t;
        const u={...t,[field]:value};
        if(field==='progress_percent'){
          const pct=Number(value);
          if(pct===100&&t.status!=='completed'){
            u.status='completed';
          } else if(pct>0&&pct<100&&(t.status==='not_started'||t.status==='task_requested'||t.status==='task_re_requested'||t.status==='waiting')){
            // 진행율 입력 → 자동으로 진행중
            u.status='in_progress';
            apiFetch(`/api/tasks/by-business/${bizId}/${taskId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'in_progress'})}).catch(()=>{});
          } else if(pct===0&&t.status==='in_progress'){
            // 0%로 되돌림 → 대기 상태로 복귀
            u.status='not_started';
            apiFetch(`/api/tasks/by-business/${bizId}/${taskId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'not_started'})}).catch(()=>{});
          } else if(pct<100&&t.status==='completed'){
            u.status='in_progress';
            apiFetch(`/api/tasks/by-business/${bizId}/${taskId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'in_progress'})}).catch(()=>{});
          }
        }
        return u;
      }));
    }catch{}
  };

  const saveTitle=async(taskId:number,title:string)=>{
    const task=allTasks.find(t=>t.id===taskId);
    if(!task)return;
    try{
      await apiFetch(`/api/tasks/by-business/${bizId}/${taskId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});
      setAllTasks(prev=>prev.map(t=>t.id===taskId?{...t,title}:t));
    }catch{}
  };

  const assignToWeek=async(taskId:number)=>{
    await saveField(taskId,'planned_week_start',thisMonday);
    setBacklog(prev=>prev.filter(t=>t.id!==taskId));
    // reload to refresh
    const r=await(await apiFetch(`/api/projects/workspace/${bizId}/all-tasks`)).json();
    if(r.success)setAllTasks(r.data||[]);
  };

  const addTask=async()=>{
    if(!newTitle.trim()||!bizId)return;
    // 담당자 결정
    // - 내 업무 week/all : 무조건 나 (담당자 선택 UI 없음)
    // - requested : 선택 필수
    // - workspace : 선택 가능, 미선택이면 나
    let targetAssignee:number|null;
    if(scope==='mine'&&(tab==='week'||tab==='all')){
      targetAssignee=myId;
    }else if(tab==='requested'){
      if(!newAssignee)return; // 필수
      targetAssignee=newAssignee;
    }else{
      targetAssignee=newAssignee??myId;
    }
    // 이번 주 탭에서는 마감일 기본값 = 오늘 (이번주 범위 안에 들어오도록)
    const defaultDue=(scope==='mine'&&tab==='week')?todayStr:null;
    try{
      const r=await(await apiFetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          business_id:Number(bizId),
          title:newTitle.trim(),
          assignee_id:targetAssignee,
          planned_week_start:(scope==='mine'&&tab==='week')?thisMonday:null,
          due_date:defaultDue,
        })
      })).json();
      if(r.success){
        // Socket task:new 가 먼저 도착했을 가능성 — 중복 방지
        setAllTasks(prev=>prev.some(x=>x.id===r.data.id)?prev:[r.data,...prev]);
        setNewTitle('');
        setNewAssignee(null);
        setAddingTask(false);
      }
    }catch(e){console.error('[addTask]',e);}
  };

  // 우선순위: 클릭 순서대로 1,2,3... / 다시 클릭하면 해제 + 번호 재정렬
  const togglePriority=(taskId:number)=>{
    setAllTasks(prev=>{
      const task=prev.find(t=>t.id===taskId);
      if(!task)return prev;

      if(task.priority_order){
        // 해제: 이 번호보다 큰 것들 1씩 당기기
        const removed=task.priority_order;
        const updated=prev.map(t=>{
          if(t.id===taskId)return{...t,priority_order:null};
          if(t.priority_order&&t.priority_order>removed)return{...t,priority_order:t.priority_order-1};
          return t;
        });
        saveField(taskId,'priority_order',null);
        // 재정렬된 다른 것들도 저장
        updated.filter(t=>t.priority_order&&t.id!==taskId).forEach(t=>saveField(t.id,'priority_order',t.priority_order));
        return updated;
      } else {
        // 부여: 현재 최대 번호 + 1
        const maxP=prev.reduce((m,t)=>Math.max(m,t.priority_order||0),0);
        const newP=maxP+1;
        saveField(taskId,'priority_order',newP);
        return prev.map(t=>t.id===taskId?{...t,priority_order:newP}:t);
      }
    });
  };

  // 업무 상세 로드
  const openDetail=async(taskId:number)=>{
    setDetailTaskId(taskId);
    try{
      const r=await(await apiFetch(`/api/tasks/${taskId}/detail`)).json();
      if(r.success)setDetailTask(r.data);
    }catch{}
  };
  const closeDetail=()=>{setDetailTaskId(null);setDetailTask(null);setNewComment('');};

  const addComment=async()=>{
    if(!newComment.trim()||!detailTaskId)return;
    try{
      const r=await(await apiFetch(`/api/tasks/${detailTaskId}/comments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:newComment.trim()})})).json();
      if(r.success&&detailTask){
        setDetailTask({...detailTask,comments:[...(detailTask.comments||[]),r.data]});
        setNewComment('');
      }
    }catch{}
  };

  const registerCandidate=async(candId:number)=>{
    try{
      await apiFetch(`/api/projects/task-candidates/${candId}/register`,{method:'POST'});
      setCandidates(prev=>prev.filter(c=>c.id!==candId));
      load(); // refresh
    }catch{}
  };

  const saveTaskField=async(taskId:number,field:string,value:unknown)=>{
    try{
      await apiFetch(`/api/tasks/by-business/${bizId}/${taskId}`,{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({[field]:value})});
      setAllTasks(prev=>prev.map(t=>t.id===taskId?{...t,[field]:value}:t));
    }catch{}
  };

  const ALL_STATUSES:string[]=STATUS_CODES.filter(s=>s!=='task_requested');

  const changeStatus=async(taskId:number,newStatus:string)=>{
    try{
      await apiFetch(`/api/tasks/${taskId}/time`,{method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({progress_percent:newStatus==='completed'?100:undefined})});
      // Use the existing PUT route for status
      await apiFetch(`/api/tasks/by-business/${bizId}/${taskId}`,{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({status:newStatus})});
      setAllTasks(prev=>prev.map(t=>{
        if(t.id!==taskId)return t;
        const u={...t,status:newStatus};
        if(newStatus==='completed'){u.progress_percent=100;}
        return u;
      }));
      // 완료 시 우선순위 해제
      if(newStatus==='completed'){
        const task=allTasks.find(t=>t.id===taskId);
        if(task?.priority_order)togglePriority(taskId);
      }
    }catch{}
    setStatusDropdownId(null);
  };

  const toggleComplete=(task:TaskRow)=>{
    if(task.status==='completed')changeStatus(task.id,'in_progress');
    else changeStatus(task.id,'completed');
  };

  const handleSort=(key:SortKey)=>{
    if(sortKey===key)setSortDir(d=>d==='asc'?'desc':'asc');
    else{setSortKey(key);setSortDir('asc');}
  };

  const today=todayStr;

  // ── Client-side filtering (no reload) ──
  const filtered=useMemo(()=>{
    let list=allTasks;
    if(scope==='workspace'){
      if(assigneeFilter!=null)list=list.filter(t=>t.assignee_id===assigneeFilter);
    }else{
      if(tab==='week'){
        // 이번 주 내 업무 = "지금 행동 필요" 인 것만 (역할별)
        //   담당자 : task_requested / waiting / in_progress / revision_requested / done_feedback
        //   컨펌자 : reviewing 상태 + 내 reviewer state=pending (실시간 데이터 없으면 단순히 reviewing 포함)
        list=list.filter(t=>{
          const ds=displayStatus(t,todayStr);
          // 담당자 행동 필요
          if(t.assignee_id===myId){
            if(['task_requested','waiting','in_progress','revision_requested','done_feedback'].includes(ds))return true;
          }
          // 컨펌자 행동 필요 — reviewers 정보가 목록에 없을 수 있음 (별도 fetch 필요)
          // 우선은 reviewing 상태의 업무 중 내가 컨펌자 후보일 때 포함
          // TODO: task.reviewers include 필요 — 백엔드 list API 확장
          return false;
        });
      }
      if(tab==='all')list=list.filter(t=>t.assignee_id===myId);  // 향후 reviewer=me 도 합칠 예정
      if(tab==='requested')list=list.filter(t=>(t.request_by_user_id===myId)||(t.created_by===myId&&t.assignee_id!=null&&t.assignee_id!==myId));
    }
    if(search){const q=search.toLowerCase();list=list.filter(t=>t.title.toLowerCase().includes(q)||(t.Project?.name||'').toLowerCase().includes(q));}
    if(statusFilter)list=list.filter(t=>t.status===statusFilter);
    if(hideCompleted)list=list.filter(t=>t.status!=='completed'&&t.status!=='canceled');

    // Sort
    list=[...list].sort((a,b)=>{
      let va:unknown=a[sortKey],vb:unknown=b[sortKey];
      if(va==null)va=sortDir==='asc'?Infinity:-Infinity;
      if(vb==null)vb=sortDir==='asc'?Infinity:-Infinity;
      if(typeof va==='string'&&typeof vb==='string')return sortDir==='asc'?va.localeCompare(vb):vb.localeCompare(va);
      return sortDir==='asc'?(Number(va)-Number(vb)):(Number(vb)-Number(va));
    });
    return list;
  },[allTasks,scope,tab,assigneeFilter,todayStr,myId,search,statusFilter,hideCompleted,sortKey,sortDir]);

  // (grouped removed — flat list with project column)

  // Summary (탭 기준 — 좌측 칩에 표시)
  const summary=useMemo(()=>{
    const est=filtered.reduce((s,t)=>s+(Number(t.estimated_hours)||0),0);
    const act=filtered.reduce((s,t)=>s+(Number(t.actual_hours)||0),0);
    return{count:filtered.length,est:Math.round(est*10)/10,act:Math.round(act*10)/10};
  },[filtered]);

  // 전체 내 업무 집계 (우측 가용시간 — 탭 무관, 항상 동일)
  const totalMyEst=useMemo(()=>{
    return Math.round(allTasks.filter(t=>t.assignee_id===myId).reduce((s,t)=>s+(Number(t.estimated_hours)||0),0)*10)/10;
  },[allTasks,myId]);
  const _totalMyAct=useMemo(()=>{
    return Math.round(allTasks.filter(t=>t.assignee_id===myId).reduce((s,t)=>s+(Number(t.actual_hours)||0),0)*10)/10;
  },[allTasks,myId]);
  void _totalMyAct; // 향후 사용 예정

  // Project progress
  const projProg=useMemo(()=>{
    const m=new Map<string,{total:number;sum:number}>();
    for(const t of allTasks.filter(x=>x.assignee_id===myId)){
      const n=t.Project?.name;if(!n)continue;
      if(!m.has(n))m.set(n,{total:0,sum:0});const p=m.get(n)!;p.total++;p.sum+=t.progress_percent||0;
    }
    return m;
  },[allTasks,myId]);

  const effectiveCapacity=Math.round(capacity.daily*(capacity.days-holidayDays)*capacity.rate*10)/10;

  const saveCapacity=async(field:string,value:number)=>{
    if(!bizId)return;
    try{
      // Find my member id
      const mr=await(await apiFetch(`/api/businesses/${bizId}/members`)).json();
      const me=mr.data?.find((m:{user_id:number})=>m.user_id===myId);
      if(!me)return;
      await apiFetch(`/api/businesses/${bizId}/members/${me.id}/work-hours`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({[field]:value}),
      });
      // Update local state
      if(field==='daily_work_hours')setCapacity(prev=>({...prev,daily:value,weekly:Math.round(value*(prev.days)*prev.rate*10)/10}));
      if(field==='weekly_work_days')setCapacity(prev=>({...prev,days:value,weekly:Math.round(prev.daily*value*prev.rate*10)/10}));
    }catch{}
  };

  // 번다운 — 일별 스냅샷 API 우선 사용, fallback: 진행율 기반 선형 분배
  // 예측시간: 진행율 % x 예측시간을 작업기간(start~due)에 선형 분배 → 날짜별 누적
  // 실제시간: 실제시간 x 진행율% 을 작업기간에 선형 분배 → 날짜별 누적
  const computedBurndown=useMemo(()=>{
    const days:{label:string;date:string;est:number;act:number}[]=[];
    const dayNames=['일','월','화','수','목','금','토'];
    let cursor=periodFrom;
    while(cursor<=periodTo){
      const [y,m,d]=cursor.split('-').map(Number);
      const dt=new Date(Date.UTC(y,m-1,d));
      days.push({label:dayNames[dt.getUTCDay()],date:cursor,est:0,act:0});
      cursor=addDaysStr(cursor,1);
    }
    const myTasks=allTasks.filter(t=>t.assignee_id===myId);

    for(const task of myTasks){
      const est=Number(task.estimated_hours)||0;
      const act=Number(task.actual_hours)||0;
      const prog=(task.progress_percent||0)/100;
      if(est===0&&act===0)continue;
      const taskStart=(task.start_date||task.due_date||task.planned_week_start||periodFrom).slice(0,10);
      const taskEnd=(task.due_date||task.start_date||periodTo).slice(0,10);
      // Period와 겹치지 않으면 skip
      if(taskEnd<periodFrom||taskStart>periodTo)continue;
      // 진행된 부분 시간 계산 — 둘 다 진행율 비례
      const estUsed=est*prog; // 예측시간 × 진행율
      const actUsed=act*prog; // 실제시간 × 진행율
      // 작업기간 총 일수
      const startDt=new Date(taskStart);
      const endDt=new Date(taskEnd);
      const durDays=Math.max(1,Math.round((endDt.getTime()-startDt.getTime())/86400000)+1);
      // 오늘까지의 일수 (진행된 기간)
      for(let i=0;i<days.length;i++){
        const curr=days[i].date;
        if(curr<taskStart)continue;
        if(curr>taskEnd&&curr>todayStr)break;
        // 오늘까지만 actual 누적
        const isPast=curr<=todayStr;
        const daysSoFar=Math.min(
          Math.round((new Date(curr).getTime()-startDt.getTime())/86400000)+1,
          durDays
        );
        const ratio=daysSoFar/durDays;
        days[i].est+=estUsed*ratio; // 진행된 예측시간 누적
        if(isPast)days[i].act+=actUsed*ratio;
      }
    }
    // 오늘 날짜는 라이브 데이터 (현재 업무 상태 실시간 반영)
    const liveEstToday=myTasks.reduce((s,t)=>s+(Number(t.estimated_hours)||0)*((t.progress_percent||0)/100),0);
    const liveActToday=myTasks.reduce((s,t)=>s+(Number(t.actual_hours)||0)*((t.progress_percent||0)/100),0);

    // 과거: 스냅샷 우선, 오늘: 라이브, 미래: 예측 누적만 (선형 분배)
    const snapMap=new Map(dailyProgress.map(d=>[d.date.slice(0,10),d]));
    const raw=days.map(d=>{
      if(d.date===todayStr){
        return{label:d.label,estimated_cumulative:Math.round(liveEstToday*10)/10,actual_cumulative:Math.round(liveActToday*10)/10};
      }
      if(d.date<todayStr){
        const s=snapMap.get(d.date);
        if(s){
          return{label:d.label,estimated_cumulative:Math.round(Number(s.est_used)*10)/10,actual_cumulative:Math.round(Number(s.act_used)*10)/10};
        }
      }
      return{label:d.label,estimated_cumulative:Math.round(d.est*10)/10,actual_cumulative:d.date<=todayStr?Math.round(d.act*10)/10:0};
    });
    // 단조증가 강제 — 누적은 절대 감소하지 않음
    let maxEst=0,maxAct=0;
    return raw.map(p=>{
      maxEst=Math.max(maxEst,p.estimated_cumulative);
      // 실제는 오늘 이후(미래)는 0 유지, 과거+오늘만 누적
      if(p.actual_cumulative>0)maxAct=Math.max(maxAct,p.actual_cumulative);
      return{label:p.label,estimated_cumulative:maxEst,actual_cumulative:p.actual_cumulative>0?maxAct:0};
    });
  },[allTasks,myId,periodFrom,periodTo,dailyProgress]);

  const maxY=Math.max(...computedBurndown.map(p=>Math.max(p.estimated_cumulative,p.actual_cumulative)),effectiveCapacity||1,1);

  if(!bizId)return<EmptyFull>No workspace</EmptyFull>;
  if(loading)return<EmptyFull>Loading...</EmptyFull>;

  const sortIcon=(key:SortKey)=>sortKey===key?(sortDir==='asc'?'↑':'↓'):'';

  return(
    <Layout>
      <LeftPanel>
        {/* Header — 제목 + 스코프 세그먼트 토글 */}
        <Header>
          <PageTitle>Q task</PageTitle>
          <ViewToggle>
            <ViewBtn $active={viewMode==='list'} onClick={()=>changeView('list')} type="button" title={t('view.list','리스트')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </ViewBtn>
            <ViewBtn $active={viewMode==='kanban'} onClick={()=>changeView('kanban')} type="button" title={t('view.kanban','카드')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="6" height="18" rx="1"/><rect x="11" y="3" width="6" height="12" rx="1"/><rect x="19" y="3" width="2" height="7" rx="1"/></svg>
            </ViewBtn>
          </ViewToggle>
          <ScopeToggle>
            <ScopeBtn $active={scope==='mine'} onClick={()=>setScope('mine')} type="button">
              {t('scope.mine','내 업무')}
            </ScopeBtn>
            <ScopeBtn $active={scope==='workspace'} onClick={()=>setScope('workspace')} type="button">
              {t('scope.workspace','전체 업무')}
            </ScopeBtn>
          </ScopeToggle>
        </Header>

        {/* Tabs — 내 업무 모드에서만 (요구 순서: 이번 주 내 / 나의 전체 / 내가 요청한) */}
        {scope==='mine'&&(
          <TabBar>
            <TabBtn $active={tab==='week'} onClick={()=>setTab('week')}>{t('tab.week','이번 주 내 업무')}</TabBtn>
            <TabBtn $active={tab==='all'} onClick={()=>setTab('all')}>{t('tab.all','내 전체업무')}</TabBtn>
            <TabBtn $active={tab==='requested'} onClick={()=>setTab('requested')}>{t('tab.requested','요청하기')}</TabBtn>
          </TabBar>
        )}

        <ListScroll>
          {/* Filter bar (탭 아래) */}
          <FilterBar>
            <SearchBox type="text" placeholder={t('search','Search tasks...')} value={search} onChange={e=>setSearch(e.target.value)} />
            <div style={{minWidth:140}}>
              <PlanQSelect size="sm" isClearable
                placeholder={t('filter.allStatus','All status')}
                value={statusFilter?{value:statusFilter,label:t(`status.${statusFilter}.observer`,statusFilter)}:null}
                onChange={(v)=>setStatusFilter((v as {value?:string})?.value||'')}
                options={STATUS_CODES.filter(k=>k!=='task_requested').map(k=>({value:k,label:t(`status.${k}.observer`,k)}))} />
            </div>
            {scope==='workspace'&&(
              <div style={{minWidth:160}}>
                <PlanQSelect size="sm" isClearable
                  placeholder={t('workspace.allMembers','전체 멤버')}
                  value={assigneeFilter==null?null:{value:String(assigneeFilter),label:members.find(m=>m.user_id===assigneeFilter)?.name||'-'}}
                  onChange={(v)=>setAssigneeFilter((v as {value?:string})?.value?Number((v as {value:string}).value):null)}
                  options={members.map(m=>({value:String(m.user_id),label:m.name}))} />
              </div>
            )}
            <HideCheck><input type="checkbox" checked={hideCompleted} onChange={e=>setHideCompleted(e.target.checked)} />{t('filter.hideCompleted','Hide completed')}</HideCheck>
            <ChipRow>
              <Chip>{summary.count}{t('summary.unit','tasks')}</Chip>
              <Chip $teal>Est {summary.est}h</Chip>
              <Chip $coral>Act {summary.act}h</Chip>
            </ChipRow>
          </FilterBar>

          {/* Column headers (sortable) */}
          {viewMode==='list'&&(
          <>
          <ColRow>
            <Col $w="30px" $center onClick={()=>handleSort('priority_order')}>#{sortIcon('priority_order')}</Col>
            <Col $w="80px" $hideBelow={640} onClick={()=>handleSort('title')}>{t('col.project','Project')}</Col>
            {(scope==='workspace'||tab==='requested')&&(
              <Col $w="90px" $hideBelow={540}>{t('col.assignee','담당자')}</Col>
            )}
            {scope==='mine'&&(tab==='week'||tab==='all')&&filtered.some(t2=>t2.source==='internal_request'||t2.source==='qtalk_extract')&&(
              <Col $w="90px" $hideBelow={540}>{t('col.requester','요청자')}</Col>
            )}
            <Col $flex onClick={()=>handleSort('title')}>{t('col.task','Task')} {sortIcon('title')}</Col>
            <Col $w="68px" $center onClick={()=>handleSort('status')}>{t('col.status','Status')} {sortIcon('status')}</Col>
            <Col $w="48px" $center $hideBelow={900} onClick={()=>handleSort('estimated_hours')}>{t('col.est','Est(h)')} {sortIcon('estimated_hours')}</Col>
            <Col $w="48px" $center $hideBelow={900} onClick={()=>handleSort('actual_hours')}>{t('col.act','Act(h)')} {sortIcon('actual_hours')}</Col>
            <Col $w="130px" $center $hideBelow={1024} onClick={()=>handleSort('progress_percent')}>{t('col.progress','Progress')} {sortIcon('progress_percent')}</Col>
            <Col $w="140px" $center $hideBelow={768} onClick={()=>handleSort('due_date')}>{t('col.period','Start ~ Due')} {sortIcon('due_date')}</Col>
          </ColRow>

          {/* Flat task list (no grouping) */}
          {filtered.map((task)=>{
                const _dispStatus=displayStatus(task,todayStr);
                const sc=STATUS_COLOR[_dispStatus as StatusCode]||STATUS_COLOR.not_started;
                const _role=primaryPerspective(getRoles(task,myId));
                const _statusLabel=getStatusLabel(task,_role,todayStr,(k,f)=>t(k,f||k));
                const prog=task.progress_percent||0;
                const _due=task.due_date?task.due_date.slice(0,10):'';
                const dColor=(!_due||task.status==='completed'||task.status==='canceled')?'default':(_due<todayStr?'overdue':(_due===todayStr?'today':'default'));
                const isEditing=editingTitle===task.id;
                const isDelayed=task.due_date&&task.due_date.slice(0,10)<today&&task.status!=='completed'&&task.status!=='canceled';

                return(
                  <TRow key={task.id} $done={task.status==='completed'} $delayed={!!isDelayed}>
                    <TCell $w="30px" $center>
                      <PrioNum $active={!!task.priority_order} $disabled={task.status==='completed'||task.status==='canceled'}
                        onClick={e=>{e.stopPropagation();if(task.status!=='completed'&&task.status!=='canceled')togglePriority(task.id);}}>
                        {task.priority_order||<PrioEmpty />}
                      </PrioNum>
                    </TCell>
                    <TCell $w="80px" $hideBelow={640}>
                      <ProjLabel>{task.Project?.name||'-'}</ProjLabel>
                    </TCell>
                    {(scope==='workspace'||tab==='requested')&&(
                      <TCell $w="90px" $hideBelow={540}>
                        <AssigneeChip title={task.assignee?.name||''}>
                          {task.assignee?.name||'-'}
                        </AssigneeChip>
                      </TCell>
                    )}
                    {scope==='mine'&&(tab==='week'||tab==='all')&&filtered.some(t2=>t2.source==='internal_request'||t2.source==='qtalk_extract')&&(
                      <TCell $w="90px" $hideBelow={540}>
                        {(task.source==='internal_request'||task.source==='qtalk_extract')?(
                          <RequesterChip $client={task.source==='qtalk_extract'} title={task.requester?.name||''}>
                            {task.requester?.name||'-'}
                          </RequesterChip>
                        ):(
                          <span style={{color:'#CBD5E1',fontSize:11}}>—</span>
                        )}
                      </TCell>
                    )}
                    <TCell $flex>
                      <TaskCheck type="checkbox" checked={task.status==='completed'} onChange={()=>toggleComplete(task)} />
                      {isEditing?(
                        <TitleInput autoFocus value={titleDraft} onChange={e=>setTitleDraft(e.target.value)}
                          onBlur={()=>{if(titleDraft.trim())saveTitle(task.id,titleDraft.trim());setEditingTitle(null);}}
                          onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();if(e.key==='Escape')setEditingTitle(null);}} />
                      ):(<>
                        <TaskTitle $done={task.status==='completed'} onClick={()=>{setEditingTitle(task.id);setTitleDraft(task.title);}}>{task.title}</TaskTitle>
                        {isDelayed&&<DelayBadge>{t('status.delayed','Delayed')}</DelayBadge>}
                        <DetailBtn onClick={e=>{e.stopPropagation();openDetail(task.id);}} title={t('detail.open','Open detail')}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                        </DetailBtn>
                      </>)}
                    </TCell>
                    <TCell $w="68px" $center style={{position:'relative'}}>
                      <StatusPill $bg={sc.bg} $fg={sc.fg} $clickable
                        onClick={e=>{e.stopPropagation();setStatusDropdownId(statusDropdownId===task.id?null:task.id);}}
                        title={t('list.statusHint','클릭하면 단계 선택')}
                      >{_statusLabel}</StatusPill>
                      {statusDropdownId===task.id&&(
                        <StatusDropdown data-dropdown="status">
                          {ALL_STATUSES.map(s=>{const c=STATUS_COLOR[s as StatusCode]||STATUS_COLOR.not_started;return(
                            <StatusOption key={s} $bg={c.bg} $fg={c.fg} $active={task.status===s}
                              onClick={e=>{e.stopPropagation();changeStatus(task.id,s);setStatusDropdownId(null);}}
                            >{t(`status.${s}.observer`,s)}</StatusOption>
                          );})}
                        </StatusDropdown>
                      )}
                    </TCell>
                    <TCell $w="48px" $center $hideBelow={900}>
                      <NumInput key={`e${task.id}`} defaultValue={task.estimated_hours??''} placeholder="-"
                        onClick={e=>e.stopPropagation()}
                        onBlur={e=>{const v=Number(e.target.value);if(!isNaN(v))saveField(task.id,'estimated_hours',v);}}
                        onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}} />
                    </TCell>
                    <TCell $w="48px" $center $hideBelow={900}>
                      <NumInput key={`a${task.id}`} defaultValue={task.actual_hours||''} placeholder="-"
                        onClick={e=>e.stopPropagation()}
                        onBlur={e=>{const v=Number(e.target.value);if(!isNaN(v))saveField(task.id,'actual_hours',v);}}
                        onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}} />
                    </TCell>
                    <TCell $w="130px" $hideBelow={1024}>
                      <SliderWrap>
                        <SliderTrack><SliderFill $w={prog} $color={sliderColor()} /></SliderTrack>
                        <SliderRange type="range" min="0" max="100" step="5" value={prog}
                          onClick={e=>e.stopPropagation()}
                          onChange={e=>setAllTasks(prev=>prev.map(x=>x.id===task.id?{...x,progress_percent:Number(e.target.value)}:x))}
                          onMouseUp={e=>saveField(task.id,'progress_percent',Number((e.target as HTMLInputElement).value))}
                          onTouchEnd={e=>saveField(task.id,'progress_percent',Number((e.target as HTMLInputElement).value))} />
                        <SliderPct>{prog}%</SliderPct>
                      </SliderWrap>
                    </TCell>
                    <TCell $w="140px" $center $hideBelow={768}>
                      <DateRangeCell start={task.start_date} due={task.due_date}
                        dueColor={dColor}
                        onSave={(s,d)=>{
                          saveTaskField(task.id,'start_date',s);
                          saveTaskField(task.id,'due_date',d);
                        }} />
                    </TCell>
                  </TRow>
                );
          })}
          {filtered.length===0&&<EmptyMsg>{t('list.empty','No tasks')}</EmptyMsg>}
          </>
          )}
          {viewMode==='kanban'&&(
            <KanbanBoard>
              {(function(){
                // 탭별 카드 분류 — 각 컬럼이 고유 필터·헤더 색·제목을 가짐
                type KCol = { key: string; title: string; color: {bg:string;fg:string}; match: (x: TaskRow) => boolean };
                let cols: KCol[] = [];
                if (scope === 'mine' && tab === 'week') {
                  cols = [
                    { key:'requestReceived', title:t('columnGroup.requestReceived','업무요청 받음'), color:STATUS_COLOR.task_requested,
                      match:(x)=>x.assignee_id===myId&&displayStatus(x,todayStr)==='task_requested' },
                    { key:'waiting', title:t('columnGroup.waiting','진행대기'), color:STATUS_COLOR.waiting,
                      match:(x)=>x.assignee_id===myId&&displayStatus(x,todayStr)==='waiting' },
                    { key:'in_progress', title:t('columnGroup.in_progress','진행중'), color:STATUS_COLOR.in_progress,
                      match:(x)=>x.assignee_id===myId&&displayStatus(x,todayStr)==='in_progress' },
                    { key:'revision', title:t('columnGroup.revision_requested','수정필요'), color:STATUS_COLOR.revision_requested,
                      match:(x)=>x.assignee_id===myId&&displayStatus(x,todayStr)==='revision_requested' },
                    { key:'wrapup', title:t('columnGroup.done_feedback','마무리 대기'), color:STATUS_COLOR.done_feedback,
                      match:(x)=>x.assignee_id===myId&&displayStatus(x,todayStr)==='done_feedback' },
                  ];
                } else if (scope === 'mine' && tab === 'requested') {
                  // 요청자 관점
                  cols = [
                    { key:'requestSent', title:t('columnGroup.requestSent','요청 보냄'), color:STATUS_COLOR.task_requested,
                      match:(x)=>displayStatus(x,todayStr)==='task_requested' },
                    { key:'waiting', title:t('columnGroup.waiting','진행대기'), color:STATUS_COLOR.waiting,
                      match:(x)=>displayStatus(x,todayStr)==='waiting' },
                    { key:'in_progress', title:t('columnGroup.in_progress','진행중'), color:STATUS_COLOR.in_progress,
                      match:(x)=>x.status==='in_progress' },
                    { key:'reviewing_obs', title:t('columnGroup.reviewing_obs','확인진행중'), color:STATUS_COLOR.reviewing,
                      match:(x)=>x.status==='reviewing' },
                    { key:'revision_self', title:t('columnGroup.revision_self','수정중'), color:STATUS_COLOR.revision_requested,
                      match:(x)=>x.status==='revision_requested' },
                    { key:'wrapup', title:t('columnGroup.done_feedback','마무리 대기'), color:STATUS_COLOR.done_feedback,
                      match:(x)=>x.status==='done_feedback' },
                    { key:'completed', title:t('columnGroup.completed','완료'), color:STATUS_COLOR.completed,
                      match:(x)=>x.status==='completed' },
                  ];
                } else {
                  // all + workspace : 관찰자 기준
                  cols = [
                    { key:'not_started', title:t('columnGroup.not_started','미진행'), color:STATUS_COLOR.not_started,
                      match:(x)=>displayStatus(x,todayStr)==='not_started' },
                    { key:'task_requested', title:t('columnGroup.task_requested','업무요청'), color:STATUS_COLOR.task_requested,
                      match:(x)=>displayStatus(x,todayStr)==='task_requested' },
                    { key:'waiting', title:t('columnGroup.waiting','진행대기'), color:STATUS_COLOR.waiting,
                      match:(x)=>displayStatus(x,todayStr)==='waiting' },
                    { key:'in_progress', title:t('columnGroup.in_progress','진행중'), color:STATUS_COLOR.in_progress,
                      match:(x)=>x.status==='in_progress' },
                    { key:'reviewing_obs', title:t('columnGroup.reviewing_obs','확인진행중'), color:STATUS_COLOR.reviewing,
                      match:(x)=>x.status==='reviewing' },
                    { key:'revision_obs', title:t('columnGroup.revision_obs','수정요청'), color:STATUS_COLOR.revision_requested,
                      match:(x)=>x.status==='revision_requested' },
                    { key:'wrapup', title:t('columnGroup.done_feedback','마무리 대기'), color:STATUS_COLOR.done_feedback,
                      match:(x)=>x.status==='done_feedback' },
                    { key:'completed', title:t('columnGroup.completed','완료'), color:STATUS_COLOR.completed,
                      match:(x)=>x.status==='completed' },
                  ];
                }
                // 빈 컬럼(업무 0개) 은 숨김 — 화면 집중도 향상
                const visibleCols=cols.filter(c=>filtered.some(c.match));
                if(visibleCols.length===0){
                  return (
                    <KanbanEmptyBoard>
                      <div>{t('list.empty','해당하는 업무가 없습니다')}</div>
                    </KanbanEmptyBoard>
                  );
                }
                return visibleCols.map(col=>{
                  const items=filtered.filter(col.match);
                  return (
                    <KanbanColumn key={col.key}>
                      <KanbanColHeader style={{background:col.color.bg,color:col.color.fg}}>
                        <span>{col.title}</span>
                        <KanbanCount>{items.length}</KanbanCount>
                      </KanbanColHeader>
                      <KanbanColBody>
                        {items.map(task=>{
                          const prog=task.progress_percent||0;
                          const isDelayed=task.due_date&&task.due_date.slice(0,10)<todayStr&&task.status!=='completed'&&task.status!=='canceled';
                          const showRequester=(task.source==='internal_request'||task.source==='qtalk_extract');
                          const myRole=primaryPerspective(getRoles(task,myId));
                          return (
                            <KanbanCard key={task.id} $delayed={!!isDelayed} $done={task.status==='completed'} onClick={()=>openDetail(task.id)}>
                              {task.Project?.name&&<KanbanProject>{task.Project.name}</KanbanProject>}
                              <KanbanTitle>{task.title}</KanbanTitle>
                              <KanbanRoleRow>
                                <KanbanRoleBadge $role={myRole}>{t(`roleBadge.${myRole}`,myRole)}</KanbanRoleBadge>
                                <KanbanStatusText>{getStatusLabel(task,myRole,todayStr,(k,f)=>t(k,f||k))}</KanbanStatusText>
                              </KanbanRoleRow>
                              <KanbanMeta>
                                {showRequester&&task.requester&&(
                                  <RequesterChip $client={task.source==='qtalk_extract'}>{task.requester.name}</RequesterChip>
                                )}
                                {(scope==='workspace'||tab==='requested')&&task.assignee&&(
                                  <AssigneeChip>{task.assignee.name}</AssigneeChip>
                                )}
                                {task.due_date&&(
                                  <KanbanDue $overdue={!!isDelayed}>{task.due_date.slice(5,10).replace('-','/')}</KanbanDue>
                                )}
                              </KanbanMeta>
                              {prog>0&&(
                                <KanbanProgress><KanbanProgressFill style={{width:`${prog}%`}}/></KanbanProgress>
                              )}
                            </KanbanCard>
                          );
                        })}
                        {items.length===0&&<KanbanEmpty>—</KanbanEmpty>}
                      </KanbanColBody>
                    </KanbanColumn>
                  );
                });
              })()}
            </KanbanBoard>
          )}

          {/* Add task — 제목 + 담당자 선택 (요청 탭/전체 모드면 담당자 강조) */}
          <AddRow>
            {addingTask?(
              <AddForm>
                <AddInput autoFocus value={newTitle} placeholder={t('add.placeholder','업무명 입력 후 Enter 로 저장')}
                  onChange={e=>setNewTitle(e.target.value)}
                  onKeyDown={e=>{
                    if(e.key==='Enter'){addTask();}
                    if(e.key==='Escape'){setAddingTask(false);setNewTitle('');setNewAssignee(null);}
                  }} />
                {(scope==='workspace'||tab==='requested')&&(
                  <div style={{flex:'0 0 180px'}}>
                    <PlanQSelect size="sm"
                      placeholder={tab==='requested'
                        ? t('add.assigneeRequiredHint','담당자 선택 (필수)')
                        : t('add.assigneeDefault','담당자: 나')}
                      value={newAssignee==null?null:{
                        value:String(newAssignee),
                        label:(members.find(m=>m.user_id===newAssignee)?.name||'-')+(newAssignee===myId?' (나)':''),
                      }}
                      onChange={(v)=>setNewAssignee((v as {value?:string})?.value?Number((v as {value:string}).value):null)}
                      options={
                        /* 요청하기 탭: 나 제외 (나를 담당자로 하면 일반 내 업무가 됨) */
                        members
                          .filter(m=>tab==='requested'?m.user_id!==myId:true)
                          .map(m=>({value:String(m.user_id),label:m.name+(m.user_id===myId?' (나)':'')}))
                      } />
                  </div>
                )}
                <AddCancelBtn type="button" onClick={()=>{setAddingTask(false);setNewTitle('');setNewAssignee(null);}}>
                  {t('add.cancel','취소')}
                </AddCancelBtn>
                <AddSaveBtn type="button" onClick={addTask}
                  disabled={!newTitle.trim()||(tab==='requested'&&!newAssignee)}>
                  {t('add.save','추가')}
                </AddSaveBtn>
              </AddForm>
            ):(
              <AddBtn onClick={()=>{
                setAddingTask(true);
                // 요청 탭이면 기본값 비움 (선택 강제), 그 외는 나
                setNewAssignee(tab==='requested'?null:myId);
              }}>+ {t('add.btn','업무 추가')}</AddBtn>
            )}
          </AddRow>

          {/* Backlog (미배정) — shown in 'all' tab */}
          {tab==='all'&&backlog.length>0&&(
            <BacklogSection>
              <BacklogHeader>{t('backlog.title','Unassigned')} ({backlog.length})</BacklogHeader>
              {backlog.map(task=>(
                <BacklogRow key={task.id}>
                  <BacklogName>{task.title}</BacklogName>
                  <BacklogProj>{task.Project?.name||''}</BacklogProj>
                  <ToWeekBtn onClick={()=>assignToWeek(task.id)}>{t('backlog.toWeek','This week')}</ToWeekBtn>
                </BacklogRow>
              ))}
            </BacklogSection>
          )}
        </ListScroll>
      </LeftPanel>

      {/* ════ RIGHT ════ */}
      {rightCollapsed?(
        <CollapsedStrip><CollapseBtn onClick={()=>setRightCollapsed(false)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </CollapseBtn></CollapsedStrip>
      ):detailTaskId?(
        /* ── 업무 상세 슬라이드오버 ── */
        <RightPanel>
          <RightHeader>
            <BackBtn onClick={closeDetail}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              {t('detail.back','Back')}
            </BackBtn>
            <CollapseBtn onClick={()=>setRightCollapsed(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            </CollapseBtn>
          </RightHeader>
          <RightScroll>
            {detailTask?(<>
              <RSection>
                <DetailTitle>{detailTask.title}</DetailTitle>
                <DetailMeta>
                  {detailTask.Project?.name&&<IProjTag>{detailTask.Project.name}</IProjTag>}
                  {detailTask.assignee?.name&&<span>{detailTask.assignee.name}</span>}
                  {detailTask.due_date&&<span>{detailTask.due_date.slice(0,10)}</span>}
                </DetailMeta>
              </RSection>
              <RSection>
                <RSTitle>{t('detail.description','Description')}</RSTitle>
                <DescTextarea defaultValue={detailTask.description||''} placeholder={t('detail.descPlaceholder','Add description...')}
                  onBlur={e=>saveTaskField(detailTask.id,'description',e.target.value)} />
              </RSection>
              <RSection>
                <RSTitle>{t('detail.dailyLog','Daily Log')}</RSTitle>
                {(detailTask.daily_progress||[]).length===0?<EmptyChart>{t('detail.noLog','No records yet')}</EmptyChart>:(
                  <DailyGrid>
                    <DailyHead>
                      <span>{t('detail.date','Date')}</span>
                      <span>{t('detail.prog','%')}</span>
                      <span>{t('detail.estUsed','Est used')}</span>
                      <span>{t('detail.actUsed','Act used')}</span>
                    </DailyHead>
                    {(detailTask.daily_progress||[]).map(dp=>{
                      const prog=(dp.progress_percent||0)/100;
                      const est=Number(dp.estimated_hours)||0;
                      const act=Number(dp.actual_hours)||0;
                      return(
                        <DailyRow key={dp.snapshot_date}>
                          <span>{dp.snapshot_date.slice(0,10).slice(5).replace('-','/')}</span>
                          <span>{dp.progress_percent||0}%</span>
                          <span>{(est*prog).toFixed(1)}h</span>
                          <span>{(act*prog).toFixed(1)}h</span>
                        </DailyRow>
                      );
                    })}
                  </DailyGrid>
                )}
              </RSection>
              <RSection>
                <RSTitle>{t('detail.comments','Comments')} ({detailTask.comments?.length||0})</RSTitle>
                {(detailTask.comments||[]).map(c=>(
                  <CommentItem key={c.id}>
                    <CommentHead><strong>{c.author?.name}</strong><span>{c.createdAt?.slice(5,16).replace('T',' ')}</span></CommentHead>
                    <CommentBody>{c.content}</CommentBody>
                  </CommentItem>
                ))}
                <CommentComposer>
                  <CommentInput value={newComment} placeholder={t('detail.writeComment','Write a comment...')}
                    onChange={e=>setNewComment(e.target.value)}
                    onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();addComment();}}} />
                  <CommentSend onClick={addComment} disabled={!newComment.trim()}>{t('detail.send','Send')}</CommentSend>
                </CommentComposer>
              </RSection>
            </>):<EmptyChart>Loading...</EmptyChart>}
          </RightScroll>
        </RightPanel>
      ):(
        /* ── 탭별 기본 패널 ── */
        <RightPanel>
          <RightHeader>
            <RightTitle>
              {tab==='week'?t('right.titleWeek','This week'):tab==='requested'?t('right.titleRequested','Feedback'):t('right.titleAll','From Q Talk')}
            </RightTitle>
            <CollapseBtn onClick={()=>setRightCollapsed(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
            </CollapseBtn>
          </RightHeader>
          <RightScroll>
            {/* 이번 주: 기간 + 가용시간 + 번다운 + 진척 + 이슈 + 메모 */}
            {tab==='week'&&<>
              <RSection>
                <RSTitle>{t('period.title','Period')}</RSTitle>
                <DateTrigger ref={periodAnchorRef} style={{width:'100%',padding:'8px 10px',border:'1px solid #E2E8F0',borderRadius:8,fontSize:13,color:'#0F172A',background:'#FAFBFC'}}
                  onClick={()=>setPeriodPickerOpen(v=>!v)}>
                  {periodFrom.replace(/-/g,'/')} ~ {periodTo.replace(/-/g,'/')}
                </DateTrigger>
                {periodPickerOpen&&<CalendarPicker isOpen={periodPickerOpen} startDate={periodFrom} endDate={periodTo} anchorRef={periodAnchorRef}
                  onRangeSelect={(s,e)=>{if(s)setPeriodFrom(s);if(e)setPeriodTo(e);}}
                  onClose={()=>setPeriodPickerOpen(false)} />}
              </RSection>
              <RSection>
                <RSTitle>{t('capacity.title','Weekly Capacity')}</RSTitle>
                <CapSettings>
                  <CapField>
                    <CapFieldLabel>{t('capacity.daily','Daily hours')}</CapFieldLabel>
                    <CapFieldInput type="number" step="0.5" min="1" max="24" defaultValue={capacity.daily||8}
                      onBlur={e=>saveCapacity('daily_work_hours',Number(e.target.value))}
                      onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}} />
                  </CapField>
                  <CapField>
                    <CapFieldLabel>{t('capacity.days','Work days')}</CapFieldLabel>
                    <CapFieldInput type="number" step="1" min="1" max="7" defaultValue={capacity.days||5}
                      onBlur={e=>saveCapacity('weekly_work_days',Number(e.target.value))}
                      onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}} />
                  </CapField>
                  <CapField>
                    <CapFieldLabel>{t('capacity.holidays','Holidays')}</CapFieldLabel>
                    <CapFieldInput type="number" step="1" min="0" max="5" defaultValue={0}
                      onChange={e=>setHolidayDays(Number(e.target.value)||0)} />
                  </CapField>
                </CapSettings>
                <CapSummary>{t('capacity.available','Available')}: {effectiveCapacity}h</CapSummary>
                <CapRow><CapTrack><CapFill $w={Math.min(100,(totalMyEst/Math.max(effectiveCapacity,1))*100)}/></CapTrack>
                  <CapText>{totalMyEst}h / {effectiveCapacity}h</CapText></CapRow>
              </RSection>
              <RSection>
                <RSTitle>{t('chart.weekly','Burndown')}</RSTitle>
                {(()=>{
                  // 차트 설정
                  const W=290,H=160,PL=28,PR=8,PT=12,PB=24;  // padding left/right/top/bottom
                  const cw=W-PL-PR, ch=H-PT-PB;
                  const n=computedBurndown.length;
                  const step=n>1?cw/(n-1):0;
                  const yMax=Math.ceil(maxY/5)*5||5;  // 5h 단위 올림
                  const yTicks=[0,yMax/2,yMax];
                  const xy=(i:number,v:number)=>({x:PL+i*step,y:PT+ch-(v/yMax)*ch});
                  const estPts=computedBurndown.map((p,i)=>xy(i,p.estimated_cumulative));
                  const actPts=computedBurndown.map((p,i)=>xy(i,p.actual_cumulative));
                  return(
                    <ChartSVG viewBox={`0 0 ${W} ${H}`}>
                      {/* Y축 그리드 + 숫자 */}
                      {yTicks.map((v,i)=>(
                        <React.Fragment key={i}>
                          <line x1={PL} y1={PT+ch-(v/yMax)*ch} x2={W-PR} y2={PT+ch-(v/yMax)*ch} stroke="#F1F5F9" strokeWidth="1" />
                          <text x={PL-4} y={PT+ch-(v/yMax)*ch+3} fontSize="9" fill="#94A3B8" textAnchor="end">{v}h</text>
                        </React.Fragment>
                      ))}
                      {/* 예측선 */}
                      <polyline fill="none" stroke="#14B8A6" strokeWidth="2" points={estPts.map(p=>`${p.x},${p.y}`).join(' ')}/>
                      {/* 실제선 */}
                      <polyline fill="none" stroke="#F43F5E" strokeWidth="2" strokeDasharray="4,3" points={actPts.map(p=>`${p.x},${p.y}`).join(' ')}/>
                      {/* 포인트 + 숫자 */}
                      {computedBurndown.map((p,i)=>(
                        <React.Fragment key={i}>
                          <circle cx={estPts[i].x} cy={estPts[i].y} r="3" fill="#14B8A6"/>
                          <circle cx={actPts[i].x} cy={actPts[i].y} r="3" fill="#F43F5E"/>
                          {p.estimated_cumulative>0&&<text x={estPts[i].x} y={estPts[i].y-6} fontSize="8" fill="#0F766E" textAnchor="middle" fontWeight="700">{p.estimated_cumulative}</text>}
                          {p.actual_cumulative>0&&p.actual_cumulative!==p.estimated_cumulative&&<text x={actPts[i].x} y={actPts[i].y+12} fontSize="8" fill="#9F1239" textAnchor="middle" fontWeight="700">{p.actual_cumulative}</text>}
                          {/* X축 라벨 */}
                          <text x={estPts[i].x} y={H-6} fontSize="10" fill="#64748B" textAnchor="middle" fontWeight="600">{p.label}</text>
                        </React.Fragment>
                      ))}
                    </ChartSVG>
                  );
                })()}
                <Legend><LI><Dot $c="#14B8A6"/>{t('chart.est','Estimated')}</LI><LI><Dot $c="#F43F5E"/>{t('chart.act','Actual')}</LI></Legend>
                {computedBurndown.every(p=>p.estimated_cumulative===0&&p.actual_cumulative===0)&&<EmptyChart>{t('chart.noData','No data in this period')}</EmptyChart>}
              </RSection>
              {projProg.size>0&&<RSection>
                <RSTitle>{t('projects.title','Project Progress')}</RSTitle>
                {Array.from(projProg.entries()).map(([n,p])=>{const avg=p.total>0?Math.round(p.sum/p.total):0;return(
                  <PPRow key={n}><PPName>{n}</PPName><PPTrack><PPFill $w={avg}/></PPTrack><PPPct>{avg}%</PPPct></PPRow>
                );})}
              </RSection>}
              {issues.length>0&&<RSection><RSTitle>{t('issues.title','Issues')}</RSTitle>
                {issues.map(i=><IssueCard key={i.id}><IBody>{i.body}</IBody><IMeta>{i.projectName&&<IProjTag>{i.projectName}</IProjTag>}{i.author?.name}</IMeta></IssueCard>)}
              </RSection>}
              {notes.length>0&&<RSection><RSTitle>{t('notes.title','Notes')}</RSTitle>
                {notes.map(n=><NoteCard key={n.id} $internal={n.visibility==='internal'}><IBody>{n.body}</IBody><IMeta>{n.projectName&&<IProjTag>{n.projectName}</IProjTag>}{n.author?.name}</IMeta></NoteCard>)}
              </RSection>}
            </>}

            {/* 요청한 업무: 담당자 댓글 목록 */}
            {tab==='requested'&&<RSection>
              <RSTitle>{t('right.recentFeedback','Recent feedback')}</RSTitle>
              {requestedComments.length===0?<EmptyChart>{t('right.noFeedback','No feedback yet')}</EmptyChart>:
                requestedComments.map(c=>(
                  <CommentItem key={c.id} onClick={()=>c.Task&&openDetail(c.Task.id)} style={{cursor:'pointer'}}>
                    <CommentHead><strong>{c.author?.name}</strong><span>{c.createdAt?.slice(5,16).replace('T',' ')}</span></CommentHead>
                    {c.Task&&<IProjTag>{c.Task.title}</IProjTag>}
                    <CommentBody>{c.content}</CommentBody>
                  </CommentItem>
                ))}
            </RSection>}

            {/* 전체업무: Q Talk 추출 후보 */}
            {tab==='all'&&<RSection>
              <RSTitle>{t('right.candidates','From Q Talk')} ({candidates.length})</RSTitle>
              {candidates.length===0?<EmptyChart>{t('right.noCandidates','No candidates yet')}</EmptyChart>:
                candidates.map(c=>(
                  <CandCard key={c.id}>
                    <CandTitle>{c.title}</CandTitle>
                    <IMeta>
                      {c.project_name&&<IProjTag>{c.project_name}</IProjTag>}
                      {c.guessedAssignee?.name&&<span>{c.guessedAssignee.name}</span>}
                    </IMeta>
                    <CandAddBtn onClick={()=>registerCandidate(c.id)}>+ {t('right.addAsTask','Add as task')}</CandAddBtn>
                  </CandCard>
                ))}
            </RSection>}
          </RightScroll>
        </RightPanel>
      )}
    </Layout>
  );
};
export default QTaskPage;

// ═══ Styled ═══
const Layout=styled.div`display:flex;height:calc(100vh - 0px);background:#F8FAFC;overflow:hidden;`;
const LeftPanel=styled.div`flex:1;min-width:0;display:flex;flex-direction:column;background:#FFF;`;
const Header=styled.div`padding:14px 20px;min-height:60px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #E2E8F0;flex-shrink:0;flex-wrap:wrap;`;
const PageTitle=styled.h1`font-size:18px;font-weight:700;color:#0F172A;margin:0;flex-shrink:0;letter-spacing:-0.2px;`;
const SearchBox=styled.input`height:36px;box-sizing:border-box;padding:0 12px;width:180px;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;color:#0F172A;background:#F8FAFC;&:focus{outline:none;border-color:#14B8A6;background:#FFF;}&::placeholder{color:#94A3B8;}`;
const HideCheck=styled.label`display:flex;align-items:center;gap:4px;font-size:12px;color:#64748B;cursor:pointer;white-space:nowrap;& input{accent-color:#0D9488;}`;
const ChipRow=styled.div`display:flex;gap:4px;margin-left:auto;`;
const Chip=styled.span<{$teal?:boolean;$coral?:boolean}>`padding:2px 8px;font-size:11px;font-weight:600;border-radius:6px;background:${p=>p.$teal?'#F0FDFA':p.$coral?'#FFF1F2':'#F1F5F9'};color:${p=>p.$teal?'#0F766E':p.$coral?'#9F1239':'#475569'};`;

const TabBar=styled.div`display:flex;border-bottom:1px solid #E2E8F0;flex-shrink:0;`;
const TabBtn=styled.button<{$active?:boolean}>`flex:1;padding:10px;font-size:13px;font-weight:600;border:none;cursor:pointer;background:transparent;color:${p=>p.$active?'#0F766E':'#94A3B8'};border-bottom:2px solid ${p=>p.$active?'#14B8A6':'transparent'};`;
const ListScroll=styled.div`flex:1;overflow-y:auto;&::-webkit-scrollbar{width:6px;}&::-webkit-scrollbar-thumb{background:#E2E8F0;border-radius:3px;}`;
const FilterBar=styled.div`display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #F1F5F9;background:#FFF;flex-wrap:wrap;`;

const ColRow=styled.div`display:flex;align-items:center;gap:6px;padding:6px 14px;border-bottom:1px solid #E2E8F0;background:#F8FAFC;position:sticky;top:0;z-index:1;`;
const Col=styled.span<{$w?:string;$flex?:boolean;$center?:boolean;$hideBelow?:number}>`
  box-sizing:border-box;
  ${p=>p.$flex
    ? 'flex:1 1 0;min-width:120px;'
    : `flex:0 0 ${p.$w||'auto'};width:${p.$w||'auto'};`}
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11px;font-weight:700;color:#94A3B8;cursor:pointer;user-select:none;
  ${p=>p.$center&&'text-align:center;'}
  &:hover{color:#475569;}
  ${p=>p.$hideBelow?`@media (max-width: ${p.$hideBelow}px){display:none;}`:''}
`;


const TRow=styled.div<{$done?:boolean;$delayed?:boolean}>`display:flex;align-items:center;gap:6px;padding:7px 14px;border-bottom:1px solid #F8FAFC;opacity:${p=>p.$done?0.45:1};${p=>p.$delayed&&!p.$done?'background:#FEF2F2;box-shadow:inset 3px 0 0 #DC2626;':''}&:hover{background:${p=>p.$delayed&&!p.$done?'#FEE2E2':'#FAFBFC'};}`;
const TCell=styled.div<{$w?:string;$flex?:boolean;$center?:boolean;$hideBelow?:number}>`
  box-sizing:border-box;
  ${p=>p.$flex
    ? 'flex:1 1 0;min-width:120px;display:flex;align-items:center;gap:6px;overflow:hidden;'
    : `flex:0 0 ${p.$w||'auto'};width:${p.$w||'auto'};overflow:hidden;`}
  ${p=>p.$center&&'display:flex;justify-content:center;align-items:center;'}
  ${p=>p.$hideBelow?`@media (max-width: ${p.$hideBelow}px){display:none;}`:''}
`;
const ProjLabel=styled.span`font-size:11px;color:#94A3B8;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;`;
const DelayBadge=styled.span`padding:1px 6px;font-size:9px;font-weight:700;color:#DC2626;background:#FEF2F2;border:1px solid #FECACA;border-radius:4px;flex-shrink:0;white-space:nowrap;`;
const TaskCheck=styled.input`accent-color:#0D9488;cursor:pointer;width:15px;height:15px;flex-shrink:0;`;
const TaskTitle=styled.span<{$done?:boolean}>`font-size:14px;font-weight:500;color:#0F172A;cursor:text;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${p=>p.$done&&'text-decoration:line-through;color:#94A3B8;'}&:hover{color:#0F766E;}`;
const TitleInput=styled.input`flex:1;font-size:14px;font-weight:500;color:#0F172A;border:1px solid #14B8A6;background:#F0FDFA;padding:2px 8px;border-radius:6px;font-family:inherit;height:24px;box-sizing:border-box;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}`;
const StatusPill=styled.span<{$bg:string;$fg:string;$clickable?:boolean}>`
  padding:2px 8px;background:${p=>p.$bg};color:${p=>p.$fg};font-size:10px;font-weight:700;
  border-radius:8px;white-space:nowrap;${p=>p.$clickable?'cursor:pointer;user-select:none;&:hover{opacity:0.8;}':''}
`;
const StatusDropdown=styled.div`
  position:absolute;top:100%;left:50%;transform:translateX(-50%);z-index:100;
  background:#FFF;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);
  padding:4px;min-width:100px;margin-top:4px;
`;
const StatusOption=styled.button<{$bg:string;$fg:string;$active?:boolean}>`
  display:block;width:100%;padding:5px 10px;font-size:11px;font-weight:600;text-align:left;
  border:none;border-radius:6px;cursor:pointer;
  background:${p=>p.$active?p.$bg:'transparent'};color:${p=>p.$fg};
  &:hover{background:${p=>p.$bg};}
`;
const PrioNum=styled.button<{$active?:boolean;$disabled?:boolean}>`
  width:24px;height:24px;display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:800;border-radius:50%;transition:all 0.15s;
  cursor:${p=>p.$disabled?'default':'pointer'};
  ${p=>p.$disabled?`
    color:#E2E8F0;background:transparent;border:2px dashed #F1F5F9;
  `:p.$active?`
    color:#FFF;background:#F43F5E;border:2px solid #F43F5E;
    &:hover{background:#E11D48;border-color:#E11D48;}
  `:`
    color:#CBD5E1;background:transparent;border:2px dashed #E2E8F0;
    &:hover{border-color:#14B8A6;color:#14B8A6;}
  `}
`;
const PrioEmpty=styled.span`display:block;width:6px;height:6px;border-radius:50%;background:#E2E8F0;`;
const NumInput=styled.input`width:36px;text-align:center;font-size:13px;font-weight:600;color:#0F172A;border:1px solid transparent;background:transparent;padding:3px 2px;border-radius:5px;&:focus{outline:none;background:#F0FDFA;border-color:#14B8A6;}&::placeholder{color:#CBD5E1;}`;

const SliderWrap=styled.div`display:flex;align-items:center;gap:6px;width:100%;position:relative;`;
const SliderTrack=styled.div`flex:1;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden;`;
const SliderFill=styled.div<{$w:number;$color:string}>`height:100%;width:${p=>p.$w}%;background:${p=>p.$color};border-radius:3px;`;
const SliderRange=styled.input`position:absolute;left:0;top:-4px;width:calc(100% - 40px);height:18px;opacity:0;cursor:pointer;`;
const SliderPct=styled.span`font-size:12px;font-weight:700;color:#475569;min-width:32px;text-align:right;`;

const DateTrigger=styled.button<{$color?:string;$empty?:boolean}>`
  width:100%;padding:4px 6px;font-size:12px;font-weight:600;
  background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer;
  white-space:nowrap;font-family:inherit;
  color:${p=>p.$empty?'#CBD5E1':p.$color==='overdue'?'#DC2626':p.$color==='today'?'#EA580C':'#64748B'};
  ${p=>p.$color==='overdue'&&!p.$empty?'background:#FEF2F2;':p.$color==='today'&&!p.$empty?'background:#FFF7ED;':''}
  &:hover{border-color:#14B8A6;color:#0F766E;}
`;

const EmptyMsg=styled.div`padding:32px;text-align:center;color:#94A3B8;font-size:13px;`;
const EmptyFull=styled.div`display:flex;align-items:center;justify-content:center;height:100vh;color:#94A3B8;`;
const AddRow=styled.div`padding:8px 14px;`;
const AddBtn=styled.button`font-size:13px;font-weight:500;color:#94A3B8;background:transparent;border:none;cursor:pointer;&:hover{color:#0F766E;}`;
const AddInput=styled.input`flex:1 1 auto;min-width:0;font-size:14px;color:#0F172A;border:1px solid #14B8A6;background:#F0FDFA;padding:6px 10px;border-radius:6px;font-family:inherit;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}&::placeholder{color:#94A3B8;}`;
const AddForm=styled.div`display:flex;gap:8px;align-items:center;`;
const AddSaveBtn=styled.button`flex:0 0 auto;padding:6px 14px;font-size:13px;font-weight:600;background:#14B8A6;color:#FFFFFF;border:none;border-radius:6px;cursor:pointer;&:hover:not(:disabled){background:#0D9488;}&:disabled{background:#CBD5E1;cursor:not-allowed;}`;
const AddCancelBtn=styled.button`flex:0 0 auto;padding:6px 10px;font-size:13px;color:#64748B;background:transparent;border:1px solid #E2E8F0;border-radius:6px;cursor:pointer;&:hover{background:#F8FAFC;color:#0F172A;}`;
const ViewToggle=styled.div`display:inline-flex;gap:2px;padding:2px;background:#F1F5F9;border-radius:8px;margin-left:auto;`;
const ViewBtn=styled.button<{$active:boolean}>`padding:6px 10px;background:${p=>p.$active?'#FFFFFF':'transparent'};color:${p=>p.$active?'#0F766E':'#94A3B8'};border:none;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;box-shadow:${p=>p.$active?'0 1px 2px rgba(0,0,0,0.06)':'none'};transition:background 0.15s;&:hover{background:${p=>p.$active?'#FFFFFF':'#E2E8F0'};color:#0F766E;}`;
const ScopeToggle=styled.div`display:inline-flex;gap:4px;padding:3px;background:#F1F5F9;border-radius:8px;`;

// ── Kanban ──
const KanbanBoard=styled.div`
  display:grid;
  grid-template-columns:repeat(7,minmax(220px,1fr));
  gap:12px;
  padding:16px 14px;
  overflow-x:auto;
  @media (max-width: 1280px){ grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); }
`;
const KanbanColumn=styled.div`display:flex;flex-direction:column;gap:8px;min-width:220px;`;
const KanbanColHeader=styled.div`display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;`;
const KanbanCount=styled.span`font-size:11px;font-weight:600;opacity:0.8;`;
const KanbanColBody=styled.div`display:flex;flex-direction:column;gap:8px;min-height:40px;`;
const KanbanCard=styled.div<{$delayed?:boolean;$done?:boolean}>`
  background:#FFFFFF;
  border:1px solid #E2E8F0;
  border-radius:8px;
  padding:10px 12px;
  cursor:pointer;
  transition:box-shadow 0.15s,border-color 0.15s,transform 0.15s;
  opacity:${p=>p.$done?0.6:1};
  ${p=>p.$delayed&&!p.$done?'box-shadow:inset 3px 0 0 #DC2626;':''}
  &:hover{box-shadow:0 4px 12px rgba(15,23,42,0.08);border-color:#CBD5E1;transform:translateY(-1px);}
`;
const KanbanProject=styled.div`font-size:10px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:4px;`;
const KanbanTitle=styled.div`font-size:13px;font-weight:600;color:#0F172A;line-height:1.4;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;`;
const KanbanMeta=styled.div`display:flex;flex-wrap:wrap;gap:4px;align-items:center;`;
const KanbanRoleRow=styled.div`display:flex;align-items:center;gap:6px;margin-bottom:6px;`;
const KanbanRoleBadge=styled.span<{$role:string}>`
  display:inline-block;padding:1px 6px;font-size:10px;font-weight:700;border-radius:4px;
  ${p=>p.$role==='assignee'?'background:#CCFBF1;color:#0F766E;':''}
  ${p=>p.$role==='reviewer'?'background:#FEF3C7;color:#92400E;':''}
  ${p=>p.$role==='requester'?'background:#E0E7FF;color:#3730A3;':''}
  ${p=>p.$role==='observer'?'background:#F1F5F9;color:#64748B;':''}
`;
const KanbanStatusText=styled.span`font-size:11px;color:#64748B;`;
const KanbanDue=styled.span<{$overdue?:boolean}>`font-size:11px;font-weight:600;color:${p=>p.$overdue?'#DC2626':'#64748B'};margin-left:auto;`;
const KanbanProgress=styled.div`height:4px;background:#F1F5F9;border-radius:999px;overflow:hidden;margin-top:8px;`;
const KanbanProgressFill=styled.div`height:100%;background:linear-gradient(90deg,#14B8A6,#0D9488);border-radius:999px;transition:width 0.3s;`;
const KanbanEmpty=styled.div`text-align:center;padding:20px 10px;color:#CBD5E1;font-size:12px;`;
const KanbanEmptyBoard=styled.div`
  grid-column:1 / -1;
  padding:60px 20px;
  text-align:center;
  color:#94A3B8;
  font-size:13px;
  background:#FFFFFF;
  border:1px dashed #E2E8F0;
  border-radius:12px;
`;
const ScopeBtn=styled.button<{$active:boolean}>`padding:6px 14px;font-size:13px;font-weight:600;background:${p=>p.$active?'#FFFFFF':'transparent'};color:${p=>p.$active?'#0F766E':'#64748B'};border:none;border-radius:6px;cursor:pointer;box-shadow:${p=>p.$active?'0 1px 2px rgba(0,0,0,0.06)':'none'};transition:background 0.15s;&:hover{background:${p=>p.$active?'#FFFFFF':'#E2E8F0'};}`;
const AssigneeChip=styled.span`display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;color:#0F766E;background:#CCFBF1;border-radius:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;`;
const RequesterChip=styled.span<{$client?:boolean}>`display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;border-radius:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;color:${p=>p.$client?'#991B1B':'#BE123C'};background:${p=>p.$client?'#FECACA':'#FFE4E6'};`;

const BacklogSection=styled.div`margin:12px 14px;padding:12px;background:#FAFBFC;border:1px dashed #E2E8F0;border-radius:10px;`;
const BacklogHeader=styled.div`font-size:12px;font-weight:700;color:#94A3B8;margin-bottom:8px;`;
const BacklogRow=styled.div`display:flex;align-items:center;gap:8px;padding:5px 0;& + &{border-top:1px solid #F1F5F9;}`;
const BacklogName=styled.span`flex:1;font-size:13px;color:#475569;`;
const BacklogProj=styled.span`font-size:11px;color:#CBD5E1;`;
const ToWeekBtn=styled.button`padding:3px 10px;font-size:11px;font-weight:600;color:#0F766E;background:#F0FDFA;border:1px solid #99F6E4;border-radius:6px;cursor:pointer;&:hover{background:#CCFBF1;}`;

// Right panel — Q Talk style
const CollapsedStrip=styled.aside`width:36px;flex-shrink:0;background:#FFF;border-left:1px solid #E2E8F0;display:flex;flex-direction:column;align-items:center;padding:12px 0;@media(max-width:1200px){display:none;}`;
const CollapseBtn=styled.button`width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:6px;color:#64748B;cursor:pointer;&:hover{background:#F1F5F9;color:#0F172A;}`;
const RightPanel=styled.aside`width:320px;flex-shrink:0;background:#FFF;border-left:1px solid #E2E8F0;display:flex;flex-direction:column;overflow:hidden;@media(max-width:1200px){display:none;}`;
const RightHeader=styled.div`min-height:60px;padding:14px 20px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;`;
const RightTitle=styled.h2`font-size:13px;font-weight:700;color:#0F172A;margin:0;letter-spacing:-0.1px;`;
const RightScroll=styled.div`flex:1;overflow-y:auto;&::-webkit-scrollbar{width:6px;}&::-webkit-scrollbar-thumb{background:#E2E8F0;border-radius:3px;}`;
const RSection=styled.div`border-bottom:1px solid #F1F5F9;padding:12px 14px;`;
const RSTitle=styled.h4`font-size:12px;font-weight:700;color:#0F172A;margin:0 0 8px;`;
const CapRow=styled.div`display:flex;align-items:center;gap:8px;`;
const CapTrack=styled.div`flex:1;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden;`;
const CapFill=styled.div<{$w:number}>`height:100%;width:${p=>p.$w}%;background:${p=>p.$w>100?'#E11D48':p.$w>85?'#F59E0B':'#14B8A6'};border-radius:3px;transition:width 0.3s;`;
const CapText=styled.span`font-size:11px;color:#64748B;font-weight:600;white-space:nowrap;`;
const CapSettings=styled.div`display:flex;gap:8px;margin-bottom:8px;`;
const CapField=styled.div`flex:1;`;
const CapFieldLabel=styled.div`font-size:10px;color:#94A3B8;font-weight:600;margin-bottom:3px;`;
const CapFieldInput=styled.input`width:100%;padding:4px 6px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;font-weight:600;color:#0F172A;text-align:center;background:#FAFBFC;&:focus{outline:none;border-color:#14B8A6;background:#FFF;}`;
const CapSummary=styled.div`font-size:12px;font-weight:600;color:#0F766E;margin-bottom:6px;`;
const ChartSVG=styled.svg`width:100%;height:160px;display:block;`;
const EmptyChart=styled.div`padding:16px;text-align:center;color:#CBD5E1;font-size:11px;`;
const Legend=styled.div`display:flex;gap:12px;margin-top:6px;`;
const LI=styled.div`display:flex;align-items:center;gap:3px;font-size:10px;color:#64748B;font-weight:600;`;
const Dot=styled.span<{$c:string}>`width:7px;height:7px;border-radius:50%;background:${p=>p.$c};`;
const PPRow=styled.div`display:flex;align-items:center;gap:8px;& + &{margin-top:6px;}`;
const PPName=styled.span`font-size:11px;color:#0F172A;font-weight:500;min-width:60px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const PPTrack=styled.div`flex:1;height:5px;background:#F1F5F9;border-radius:3px;overflow:hidden;`;
const PPFill=styled.div<{$w:number}>`height:100%;width:${p=>p.$w}%;background:#14B8A6;border-radius:3px;`;
const PPPct=styled.span`font-size:11px;font-weight:700;color:#475569;min-width:28px;text-align:right;`;
const IssueCard=styled.div`padding:6px 8px;background:#F8FAFC;border-radius:6px;border-left:2px solid #F43F5E;& + &{margin-top:4px;}`;
const NoteCard=styled.div<{$internal?:boolean}>`padding:6px 8px;background:#F8FAFC;border-radius:6px;border-left:2px solid ${p=>p.$internal?'#0369A1':'#94A3B8'};& + &{margin-top:4px;}`;
const IProjTag=styled.span`padding:1px 5px;background:#F1F5F9;color:#64748B;font-size:9px;font-weight:600;border-radius:4px;margin-right:4px;`;

// Detail slide-over
const BackBtn=styled.button`display:flex;align-items:center;gap:4px;background:transparent;border:none;color:#0F766E;font-size:12px;font-weight:600;cursor:pointer;padding:0;&:hover{color:#134E4A;}`;
const DetailTitle=styled.h3`font-size:15px;font-weight:700;color:#0F172A;margin:0 0 6px;line-height:1.4;`;
const DetailMeta=styled.div`display:flex;align-items:center;gap:6px;font-size:11px;color:#64748B;flex-wrap:wrap;`;
const DescTextarea=styled.textarea`width:100%;min-height:100px;padding:8px 10px;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;color:#0F172A;background:#FAFBFC;font-family:inherit;resize:vertical;line-height:1.5;&:focus{outline:none;border-color:#14B8A6;background:#FFF;}&::placeholder{color:#94A3B8;}`;
const CommentItem=styled.div`padding:8px 10px;background:#F8FAFC;border-radius:8px;& + &{margin-top:6px;}`;
const CommentHead=styled.div`display:flex;gap:8px;align-items:baseline;font-size:11px;color:#64748B;margin-bottom:3px;& strong{color:#0F172A;font-weight:600;}`;
const CommentBody=styled.div`font-size:12px;color:#1E293B;line-height:1.4;white-space:pre-wrap;`;
const CommentComposer=styled.div`display:flex;gap:6px;margin-top:8px;`;
const CommentInput=styled.textarea`flex:1;padding:6px 10px;border:1px solid #E2E8F0;border-radius:8px;font-size:12px;color:#0F172A;font-family:inherit;resize:none;min-height:32px;max-height:80px;&:focus{outline:none;border-color:#14B8A6;}&::placeholder{color:#94A3B8;}`;
const CommentSend=styled.button`padding:6px 12px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;&:disabled{background:#CBD5E1;cursor:not-allowed;}&:hover:not(:disabled){background:#0F766E;}`;
const DailyGrid=styled.div`display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:1px;background:#E2E8F0;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;`;
const DailyHead=styled.div`display:contents;& > span{padding:6px 8px;background:#F8FAFC;font-size:10px;font-weight:700;color:#94A3B8;text-align:center;}`;
const DailyRow=styled.div`display:contents;& > span{padding:6px 8px;background:#FFF;font-size:11px;color:#0F172A;text-align:center;font-variant-numeric:tabular-nums;}`;

// Candidate card (전체업무 탭)
const CandCard=styled.div`padding:8px 10px;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;& + &{margin-top:6px;}`;
const CandTitle=styled.div`font-size:12px;font-weight:600;color:#9F1239;margin-bottom:4px;`;
const CandAddBtn=styled.button`margin-top:6px;padding:3px 10px;font-size:10px;font-weight:700;color:#FFF;background:#F43F5E;border:none;border-radius:6px;cursor:pointer;&:hover{background:#E11D48;}`;

// Period row (right panel)

// Detail button on task row
const DetailBtn=styled.button`display:flex;align-items:center;justify-content:center;width:20px;height:20px;background:transparent;border:none;border-radius:4px;color:#94A3B8;cursor:pointer;flex-shrink:0;&:hover{background:#F1F5F9;color:#0F766E;}`;
const IBody=styled.div`font-size:12px;color:#1E293B;line-height:1.4;`;
const IMeta=styled.div`font-size:10px;color:#94A3B8;margin-top:2px;`;
