import React, { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { SkeletonList } from '../../components/Common/Skeleton';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { quickActionFor } from '../../components/QTask/popoutQuickAction';   // 체크박스 노출 규칙 — 팝아웃과 단일 원천
import { useAuth } from '../../contexts/AuthContext';
import { joinRoom, leaveRoom, onSocket, getSocket } from '../../services/socket';
import { apiFetch } from '../../contexts/AuthContext';
import CalendarPicker from '../../components/Common/CalendarPicker';
import SingleDateField from '../../components/Common/SingleDateField';
import { PanelLayout, Panel } from '../../components/Layout/PanelLayout';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { todayInTz, mondayOfDateStr, addDaysStr, detectBrowserTz } from '../../utils/timezones';
import { inTodaySet } from '../../utils/todayTaskSet';
import { STATUS_CODES, STATUS_COLOR, displayStatus, getStatusLabel, statusOptionsFor, type StatusCode } from '../../utils/taskLabel';
import { getRoles, primaryPerspective } from '../../utils/taskRoles';
import TaskDetailDrawer from '../../components/QTask/TaskDetailDrawer';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { cacheKey, readCache, hasCache, writeCache } from '../../lib/pageCache';
import TaskRowActionMenu from '../../components/QTask/TaskRowActionMenu';
import { responsiveDrawerWidth } from '../../utils/responsiveDrawer';
import { plainToHtml } from '../../utils/plainToHtml';
import type { VoiceHandoff } from '../../utils/voiceHandoff';
import { identityText } from '../../components/Common/IdentityContext';
import AiTaskCreateModal from '../../components/QTask/AiTaskCreateModal';
import TemplateSelectModal from '../../components/QTask/TemplateSelectModal';
import CueTaskBar from '../../components/QTask/CueTaskBar';
import AiActionButton from '../../components/Common/AiActionButton';
import EmptyState from '../../components/Common/EmptyState';
import { StatusGlyph } from '../../components/Common/Icons';
import RichEditor from '../../components/Common/RichEditor';
import AttachmentField from '../../components/Common/AttachmentField';
import SearchBox from '../../components/Common/SearchBox';
import FloatingPanelToggle, { PANEL_WIDTH_CSS } from '../../components/Common/FloatingPanelToggle';
import CreateDrawer from '../../components/Common/CreateDrawer';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav';
import { formatHours, utilizationPercent, utilizationStatus, UTIL_COLOR } from '../../utils/hours';
import HelpDot from '../../components/Common/HelpDot';
import { displayName } from '../../utils/displayName';
import { friendlyDeleteError } from '../../utils/taskDeleteError';
import TaskCandidateCard from '../../components/Common/TaskCandidateCard';
import i18nClient from '../../i18n';
import {
  buildPresetRRule, buildCustomRRule, formatRRuleLabel, presetLabelMap, SELECTABLE_PRESETS,
  type RecurEndType, type RecurPreset, type RecurCustomUnit,
} from '../../utils/recurrence';
import type { TFunction } from 'i18next';
import WeeklyReviewModal from '../../components/QTask/WeeklyReviewModal';
import WeeklyReviewTab from '../../components/QTask/WeeklyReviewTab';
import PartnerKindBadge from '../../components/Common/PartnerKindBadge';
import { type TaskTagLite } from '../../components/QTask/TagChips';
import TagPicker from '../../components/QTask/TagPicker';
import RowTags from '../../components/QTask/RowTags';
import OpenTaskPopoutButton from '../../components/QTask/OpenTaskPopoutButton';
import TagManageModal from '../../components/QTask/TagManageModal';
import { usePanelStack } from '../../hooks/usePanelStack';
import { askCue } from '../../utils/cueAsk';

// #249 — 우측 패널을 인라인으로 붙여둘 최소 뷰포트 폭.
//   이보다 좁으면 overlay(기본 닫힘 + 떠 있는 토글 + ⌘/·Ctrl+\)로 전환해 리스트가 전폭을 쓴다.
//   옛 값 1200 은 "노트북에서 창을 좀 작게 연" 전형(1280~1366)을 못 걸러 업무명이 압사했다.
//   ★ useIsNarrow 인자와 RightPanel 의 media query 가 **반드시 같은 값**이어야 한다 —
//     어긋나면 패널이 사라졌는데 토글도 안 나오는 사각지대가 생긴다.
const RIGHT_PANEL_INLINE_MIN = 1366;

// ─── Types ───
type Scope = 'mine' | 'workspace';
type ListTab = 'today' | 'week' | 'all' | 'requested' | 'weekly-review' | 'workspace-tasks' | 'workspace-weekly' | 'workspace-monthly';
type ViewMode = 'list' | 'kanban';
interface OrgUnitLite { id: number; name: string; name_en?: string | null }
interface MemberOption { user_id: number; name: string; is_ai?: boolean; department?: OrgUnitLite | null; team?: OrgUnitLite | null; }
type SortKey = 'priority_order' | 'title' | 'status' | 'estimated_hours' | 'actual_hours' | 'progress_percent' | 'due_date';
type SortDir = 'asc' | 'desc';

interface TaskRow {
  id: number; title: string; description: string | null; status: string;
  hold_reason?: string | null;   // #206 — 보류 사유(리스트 title·칸반 카드 표시)
  has_unread?: boolean;
  priority_order: number | null; start_date: string | null; due_date: string | null;
  estimated_hours: number | null; actual_hours: number; progress_percent: number;
  // 최신 estimation 출처 — 'ai' 면 시각 분기 (회색 + ✨), 'user' / null 은 일반
  latest_estimation_source?: 'ai' | 'user' | null;
  // actual_hours 출처 — 'auto' (status 전환 자동 누적, 회색) vs 'user' (직접 입력, 검정). 사이클 N+6.
  actual_source?: 'auto' | 'user' | null;
  planned_week_start: string | null;
  // ★ category 는 **동결** 컬럼이다 (#250 ③청크) — QTask UI 에 노출된 적이 없고, 태그가 그 역할을 맡는다.
  //   새 UI 에 노출하지 말 것. 태그로의 승격/폐기는 후속 결정 항목 (routes/task_tags.js 헤더 참조).
  category: string | null;
  // #250 — 백엔드가 이름 사전순으로 실어 보낸다. [0] 이 대표 태그.
  tags?: TaskTagLite[] | null;
  completed_at?: string | null;
  assignee_id: number | null; project_id: number | null; created_by: number;
  // Phase 1 워크플로우 필드
  source?: 'manual' | 'internal_request' | 'qtalk_extract';
  request_by_user_id?: number | null;
  request_ack_at?: string | null;
  review_round?: number | null;
  review_policy?: 'all' | 'any';
  reviewers?: Array<{ id: number; user_id: number; state: 'pending'|'approved'|'revision'; is_client?: boolean }>;
  Project?: { id: number; name: string } | null;
  assignee?: { id: number; name: string } | null;
  requester?: { id: number; name: string } | null;
  // 정기업무 — parent: rule != null && parent_id == null. instance: rule == null && parent_id != null.
  recurrence_rule?: string | null;
  recurrence_parent_id?: number | null;
  next_occurrence_at?: string | null;
  createdAt: string;
}
interface IssueRow { id: number; body: string; author?: { name: string }; projectName?: string; }
interface NoteRow { id: number; body: string; author?: { name: string }; visibility?: string; projectName?: string; }
interface CommentAttach { id: number; stored_name?: string; original_name: string; file_size: number; mime_type: string | null; }
interface CommentRow { id: number; content: string; createdAt: string; author?: { name: string }; Task?: { id: number; title: string }; attachments?: CommentAttach[]; }
interface CandidateRow { id: number; title: string; description: string | null; project_name?: string; guessedAssignee?: { id: number; name: string }; guessed_due_date: string | null; }

// 라벨·displayStatus·STATUS_COLOR 는 utils 로 이동 — 관점별 라벨 반영
// (utils/taskLabel.ts + utils/taskRoles.ts)

// #206 — 보류/외부컨펌은 회색으로 탈색한다(진행률 값 자체는 보존).
//   teal 로 두면 "지금 흐르는 중"으로 읽혀 보류 상태와 모순.
function sliderColor(status?:string){
  return (status==='on_hold'||status==='external_review') ? '#94A3B8' : '#14B8A6';
}

// 우선순위 번호(1,2,3..)를 매길 때의 정렬 사슬.
//   ★ 팝아웃 `TaskPopoutView.tsx` 의 prioMap 비교자와 **동일**해야 한다 — 두 화면의 번호 칩이 갈리면
//     사용자에겐 버그로 보인다. 사슬: priority(asc) → 완료 뒤로 → 마감(null last) → 제목.
//   ★ 예전에는 "이미 정렬된 filtered 를 priority 만으로 stable sort" 해서 tie 순서가 입력 순서에
//     암묵 의존했다. 입력이 바뀌면 조용히 깨지므로 사슬을 명시한다.
function cmpNullLastStr(a?:string|null,b?:string|null){
  if(!a&&!b)return 0;
  if(!a)return 1;
  if(!b)return -1;
  return a<b?-1:a>b?1:0;
}
function byPriorityChain(a:TaskRow,b:TaskRow):number{
  const p=(a.priority_order||0)-(b.priority_order||0);
  if(p!==0)return p;
  const doneRank=(t:TaskRow)=>(t.status==='completed'||t.status==='canceled')?1:0;
  const d=doneRank(a)-doneRank(b);
  if(d!==0)return d;
  const due=cmpNullLastStr(a.due_date,b.due_date);
  if(due!==0)return due;
  const title=(a.title||'').localeCompare(b.title||'');
  if(title!==0)return title;
  // ★ 맨 끝 절대 tie-break — 서버 services/taskPriority.js byPriorityChain 과 문자 그대로 동일해야 한다.
  //   id 를 **위로 올리지 말 것**(옛 실버그: 두 화면 번호가 갈리고 같은 화면 안에서도 행 순서와
  //   칩 번호가 역전됐다). 여기 맨 끝의 id 는 완전 동률일 때 순서를 결정론적으로 고정할 뿐이다.
  return a.id-b.id;
}

// 날짜 범위 셀 — 시작+마감 통합. 클릭 시 캘린더 피커 열림
// 운영 #279 — readOnly 면 피커를 열지 않는다 (저장 실패를 보여주는 대신 애초에 못 열게).
const DateRangeCell:React.FC<{
  start:string|null|undefined; due:string|null|undefined;
  onSave:(start:string|null,due:string|null)=>void;
  dueColor?:string;
  readOnly?:boolean;
  readOnlyHint?:string;
}>=({start,due,onSave,dueColor,readOnly,readOnlyHint})=>{
  const[open,setOpen]=React.useState(false);
  const anchorRef=React.useRef<HTMLButtonElement>(null);
  const s=start?.slice(0,10)||''; const d=due?.slice(0,10)||'';
  const fmt=(v:string)=>v?v.slice(5).replace('-','/'):'';
  const label=s&&d?(s===d?fmt(d):`${fmt(s)} ~ ${fmt(d)}`):d?fmt(d):s?fmt(s):'-';
  const hasValue=!!(s||d);
  return(<>
    <DateTrigger ref={anchorRef} $color={dueColor} $empty={!hasValue}
      disabled={!!readOnly} title={readOnly?readOnlyHint:undefined}
      onClick={e=>{e.stopPropagation();if(readOnly)return;setOpen(v=>!v);}}>
      {label}
    </DateTrigger>
    {open&&!readOnly&&<CalendarPicker isOpen={open} startDate={s||d} endDate={d||s} anchorRef={anchorRef}
      onRangeSelect={(a,b)=>{onSave(a||null,b||null);}} onClose={()=>setOpen(false)} />}
  </>);
};
// fmtDate removed — using native date inputs now

const QTaskPage:React.FC=()=>{
  const{t}=useTranslation('qtask');
  const{user}=useAuth();
  const isClient = user?.business_role === 'client';
  const bizId=user?.business_id||null;
  const myId=user?Number(user.id):-1;
  // 전체 보고서(통합) 는 owner/admin 전용 — 백엔드 /integrated 게이트와 일치. 멤버에겐 탭 자체 숨김.
  const myWsRole=(user?.workspaces||[]).find((w)=>w.business_id===bizId)?.role
    ||(user?.business_id===bizId?user?.business_role:null);
  const canManageReports=myWsRole==='owner'||myWsRole==='admin'||user?.platform_role==='platform_admin';
  // 운영 #279 — 기간(착수·마감) 편집 가능 여부. 백엔드 FIELD_RULES.due_date/start_date 와 같은 집합
  //   (담당자 OR 작성자 OR owner OR admin). 여태 프론트에 이 판정이 아예 없어 담당자에게 편집 가능한
  //   셀을 열어두고 저장 시점에 403 → "저장 실패" 만 떴다.
  const canEditDatesFor=useCallback((t:{created_by?:number|null;assignee_id?:number|null})=>(
    t.created_by===myId||t.assignee_id===myId
    ||myWsRole==='owner'||myWsRole==='admin'||user?.platform_role==='platform_admin'
  ),[myId,myWsRole,user?.platform_role]);

  const location=useLocation();
  const navigate=useNavigate();
  // pathname 기반 판정 (새로고침 시에도 안정적). useParams 는 라우트 매칭 변형에 취약해서 회피
  const scope:Scope=location.pathname.endsWith('/tasks/workspace')?'workspace':'mine';

  // 탭은 URL ?tab= 로 동기화 (리프레시 후 같은 탭 유지)
  // useState lazy init — 첫 마운트 시 window.location.search 직접 읽어 SSR/hydration 영향 회피
  const[tab,_setTab]=useState<ListTab>(() => {
    const search = typeof window !== 'undefined' ? window.location.search : location.search;
    const v = new URLSearchParams(search).get('tab');
    const mineTabs: ListTab[] = ['today', 'week', 'all', 'requested', 'weekly-review'];
    const wsTabs: ListTab[] = ['workspace-tasks', 'workspace-weekly', 'workspace-monthly'];
    const isWorkspace = (typeof window !== 'undefined' ? window.location.pathname : location.pathname).endsWith('/tasks/workspace');
    if (!isWorkspace && mineTabs.includes(v as ListTab)) return v as ListTab;
    if (isWorkspace && wsTabs.includes(v as ListTab)) return v as ListTab;
    return isWorkspace ? 'workspace-tasks' : 'week';
  });
  const setTab=(t:ListTab)=>{
    _setTab(t);
    const sp = new URLSearchParams(window.location.search);
    sp.set('tab', t);
    sp.delete('task'); // 탭 변경 시 detail 패널도 같이 정리 (closeDetail race 회피)
    navigate({ pathname: window.location.pathname, search: '?' + sp.toString() }, { replace: true });
  };
  const setScope=(s:Scope)=>{
    // scope 변경 시 적절한 default tab 으로 reset
    let nextTab = tab;
    if(s==='workspace'&&!['workspace-tasks','workspace-weekly','workspace-monthly'].includes(tab))nextTab='workspace-tasks';
    if(s==='mine'&&['workspace-tasks','workspace-weekly','workspace-monthly'].includes(tab))nextTab='week';
    _setTab(nextTab);
    const sp = new URLSearchParams(location.search);
    sp.set('tab', nextTab);
    navigate({ pathname: s==='workspace'?'/tasks/workspace':'/tasks', search: '?' + sp.toString() });
  };
  // 권한 없는 멤버가 URL 로 전체 보고서 탭 직접 진입 시 전체 업무로 폴백 (빈 화면 방지)
  useEffect(()=>{ if((tab==='workspace-weekly'||tab==='workspace-monthly')&&!canManageReports) setTab('workspace-tasks'); },[tab,canManageReports]);  // eslint-disable-line react-hooks/exhaustive-deps
  const[weeklyReviewModalOpen,setWeeklyReviewModalOpen]=useState(false);
  // 우선순위: URL (?view=) > localStorage > 기본값 'list'
  const[viewMode,setViewMode]=useState<ViewMode>(()=>{
    const urlView=new URLSearchParams(location.search).get('view');
    if(urlView==='list'||urlView==='kanban')return urlView;
    try{ return (localStorage.getItem('qtask_view_mode') as ViewMode)||'list'; }catch{ return 'list'; }
  });
  const changeView=(v:ViewMode)=>{
    setViewMode(v);
    try{localStorage.setItem('qtask_view_mode',v);}catch{/* ignore */}
    // URL 싱크 — 기본값 list 는 파라미터 생략
    const sp=new URLSearchParams(location.search);
    if(v==='list')sp.delete('view'); else sp.set('view',v);
    const qs=sp.toString();
    navigate(qs?`${location.pathname}?${qs}`:location.pathname,{replace:true});
  };
  // 재진입 즉시 표시 — 지난 목록이 있으면 그것으로 그리고 시작(전체 화면 "Loading..." 회피).
  //   서버 값이 오면 그대로 덮어쓴다. 캐시는 표시를 앞당길 뿐 진실의 원천이 아니다.
  const taskCacheKey=cacheKey('qtask',myId,bizId);
  const[allTasks,setAllTasks]=useState<TaskRow[]>(()=>readCache<TaskRow[]>(cacheKey('qtask',myId,bizId))??[]);
  const[members,setMembers]=useState<MemberOption[]>(()=>readCache<MemberOption[]>(cacheKey('qtask-members',myId,bizId))??[]);
  const[aiOpen,setAiOpen]=useState(false);
  const[tplSelOpen,setTplSelOpen]=useState(false);
  const[tplSelInitialId,setTplSelInitialId]=useState<number|null>(null);
  // 인라인 "아래에 업무 추가" — ProjectTaskList 와 동일 패턴
  const[addingBelowId,setAddingBelowId]=useState<number|null>(null);
  const[newBelowTitle,setNewBelowTitle]=useState('');
  const[submittingBelow,setSubmittingBelow]=useState(false);
  const[assigneeFilter,setAssigneeFilter]=useState<number|null>(null); // workspace mode 담당자 필터
  // ★ "못 불러옴" 과 "업무 없음" 은 다른 상태다(500 재현으로 실측 — 오류인데 빈 상태가 떴다).
  const[loadError,setLoadError]=useState(false);
  const[capacity,setCapacity]=useState<{daily:number;days:number;rate:number;weekly:number}>({daily:8,days:5,rate:1,weekly:40});
  const[issues,setIssues]=useState<IssueRow[]>([]);
  const[notes,setNotes]=useState<NoteRow[]>([]);
  const[loading,setLoading]=useState(()=>!hasCache(cacheKey('qtask',myId,bizId)));
  const[rightCollapsed,setRightCollapsed]=useState(false);
  const[detailTaskId,setDetailTaskId]=useState<number|null>(()=>{
    const q=new URLSearchParams(location.search).get('task');
    return q?Number(q):null;
  });
  // ★ 2·3단 단일 계약(hooks/usePanelStack). 자체 useIsNarrow 판정을 여기로 흡수한다 —
  //   분기점이 페이지마다 흩어져 있어 화면마다 동작이 달랐다(Irene, 2026-08-25).
  //   Q Task 작업대는 넓어야 쓸모 있어 3단 상한만 1366 으로 올린다(계약 안에서).
  const panel = usePanelStack(!!detailTaskId, true, () => closeDetail?.(), RIGHT_PANEL_INLINE_MIN);
  // 계약 값을 그대로 쓴다 — 자체 상태(isNarrow·rightOverlayOpen)를 따로 두면 다시 갈라진다.
  const isNarrow = panel.drilldown || panel.cols === 2;
  // ★ 운영 신고 (Irene, 2026-08-28): "모바일에서 업무추가버튼 누르면 상단 제목이 가려져."
  //   폰에서 이 폼은 전체화면인데 입력에 autoFocus 가 걸려 있어 **열리자마자 키보드가 튀어오른다**.
  //   화면 667 중 330 을 키보드가 먹어, 사용자는 폼을 보기도 전에 좁은 틈만 보게 된다.
  //   폰에서만 자동 포커스를 끈다 — 먼저 폼을 보고, 입력할 때 사용자가 직접 탭한다.
  //   (isNarrow 는 레이아웃 기준이라 태블릿·분할에서도 참이다 — 여기선 폰만 대상이라 별도 판정)
  const isPhone = useMediaQuery('(max-width: 640px)');
  const rightOverlayOpen = panel.asideOpen;
  const setRightOverlayOpen = (v: boolean | ((x: boolean) => boolean)) =>
    panel.setAsideOpen(typeof v === 'function' ? (v as (x: boolean) => boolean)(panel.asideOpen) : v);
  useBodyScrollLock(isNarrow&&rightOverlayOpen);

  // 키보드 단축키: ⌘/ (mac) · Ctrl+\ (win) → 우측 패널 토글
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const mod=e.metaKey||e.ctrlKey;
      if(!mod)return;
      if(e.key==='/'||e.key==='\\'){
        e.preventDefault();
        if(isNarrow)setRightOverlayOpen(x=>!x);
        else setRightCollapsed(x=>!x);
      }
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[isNarrow]);
  const[holidayDays,setHolidayDays]=useState(0);
  // WORK_FLOW §6 (U5) — 실측 참여율 자동 제안 (포커스 커버리지 충분할 때만 서버가 반환)
  const[rateSuggestion,setRateSuggestion]=useState<{percent:number;focusHours:number;weeks:number}|null>(null);

  // 워크스페이스 tz 기준 오늘/월요일 — 모든 업무 경계 계산의 기준
  const wsTz=user?.workspace_timezone||detectBrowserTz();
  // ★ 자정 롤오버 — "오늘" 탭이 생기면서 필요해졌다. 상수로 두면 창을 밤새 열어둔 사용자의
  //   오늘 목록이 어제에 머문다(주 단위일 땐 주 경계에서만 드러나던 결함).
  //   60초 타이머 + 탭 복귀(visibility) 시 재평가.
  const[todayStr,setTodayStr]=useState<string>(()=>todayInTz(wsTz));
  useEffect(()=>{
    const sync=()=>setTodayStr(prev=>{const now=todayInTz(wsTz);return now===prev?prev:now;});
    sync();
    const id=window.setInterval(sync,60000);
    const onVis=()=>{if(document.visibilityState==='visible')sync();};
    document.addEventListener('visibilitychange',onVis);
    window.addEventListener('focus',onVis);
    return()=>{window.clearInterval(id);document.removeEventListener('visibilitychange',onVis);window.removeEventListener('focus',onVis);};
  },[wsTz]);
  const thisMondayStr=mondayOfDateStr(todayStr);

  // Period range (기본: 이번 주 월~금)
  const[periodFrom,setPeriodFrom]=useState(()=>thisMondayStr);
  const[periodTo,setPeriodTo]=useState(()=>addDaysStr(thisMondayStr,6));

  // Filters
  const[search,setSearch]=useState('');
  const[statusFilter,setStatusFilter]=useState('');
  // #250 — 태그 필터. ★ 이 값은 `filtered`(보기 옵션) 에만 들어간다.
  //   weekSet / displayPriorityMap / 서버 재인덱스 입력에는 **절대 닿지 않는다** —
  //   보기 옵션이 우선순위 번호의 정본 집합을 좁히면 필터 밖 업무의 번호와 충돌한다
  //   (2026-07-28 실사고. inWeekCanonical 주석 참조).
  const[tagFilter,setTagFilter]=useState<number|null>(null);
  const[tagDict,setTagDict]=useState<Array<{id:number;name:string;color:string|null;usage_count?:number}>>([]);
  // 운영 #236/#250 — 업무 **추가 폼**의 태그. 여태 태그를 만들 수 있는 자리가 상세 드로어뿐이라,
  //   태그가 0개인 워크스페이스에서는 필터·관리 버튼이 모두 숨어 "개발 안 된 기능" 으로 보였다.
  //   생성 시점에 고르고 만들 수 있게 하면 그 막힌 고리가 풀린다.
  const[newTagIds,setNewTagIds]=useState<number[]>([]);
  const[tagManageOpen,setTagManageOpen]=useState(false);
  // 기본 true: 체크박스 = 완료 = 리스트에서 사라짐 (완료 업무 다시 보려면 헤더 체크 해제)
  const[hideCompleted,setHideCompleted]=useState(true);
  // week 탭 — "완료 가리기" (다른 탭과 동일 라벨). 기본 체크 해제 = 완료 보임.
  const[hideCompletedInWeek,setHideCompletedInWeek]=useState(false);
  const[rightWidth,setRightWidth]=useState<number>(()=>{
    try{const v=localStorage.getItem('qtask_right_width');return v?Math.max(320,Math.min(720,Number(v))):420;}catch{return 420;}
  });
  const rightResizingRef=useRef(false);
  const[drawerWidth,setDrawerWidth]=useState<number>(()=>responsiveDrawerWidth('qtask_drawer_width'));
  const drawerResizingRef=useRef(false);
  useEffect(()=>{
    const onMove=(e:MouseEvent)=>{
      if(rightResizingRef.current){
        const w=Math.max(320,Math.min(720,window.innerWidth-e.clientX));
        setRightWidth(w);
      }
      if(drawerResizingRef.current){
        const w=Math.max(420,Math.min(1000,window.innerWidth-e.clientX));
        setDrawerWidth(w);
      }
    };
    const onUp=()=>{
      if(rightResizingRef.current){
        rightResizingRef.current=false;
        try{localStorage.setItem('qtask_right_width',String(rightWidth));}catch{}
      }
      if(drawerResizingRef.current){
        drawerResizingRef.current=false;
        try{localStorage.setItem('qtask_drawer_width',String(drawerWidth));}catch{}
      }
      document.body.style.userSelect='';
      document.body.style.cursor='';
    };
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
    return()=>{window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp);};
  },[rightWidth,drawerWidth]);
  const startResize=(e:React.MouseEvent)=>{
    e.preventDefault();
    rightResizingRef.current=true;
    document.body.style.userSelect='none';
    document.body.style.cursor='col-resize';
  };
  // 기본 정렬: 우선순위 asc (priority_order 없는 항목은 맨 아래, tie-break 아래 sort 로직에서 due_date→title)
  const[sortKey,setSortKey]=useState<SortKey>('priority_order');
  const[sortDir,setSortDir]=useState<SortDir>('asc');

  // Inline edit
  const[editingTitle,setEditingTitle]=useState<number|null>(null);
  const[titleDraft,setTitleDraft]=useState('');
  const[addingTask,setAddingTask]=useState(false);
  // 인라인(=표 하단 행 추가) 모드 여부. true=표 아래에서 폼 / false=우측 패널 폼
  const[addInline,setAddInline]=useState(false);
  // 모바일에서 업무추가 폼(우측 패널·오버레이)이 열리면 body 잠금 → data-overlay-open → 우하단 FAB 자동 숨김(#181).
  // 인라인 추가(표 하단)는 오버레이가 아니라 제외. ref-count 방식이라 위 rightOverlayOpen lock 과 병존 안전.
  useBodyScrollLock(isNarrow && addingTask && !addInline);
  const[newTitle,setNewTitle]=useState('');
  const[newAssignee,setNewAssignee]=useState<number|null>(null);
  const[newProjectId,setNewProjectId]=useState<number|null>(null);
  // 업무 추가 폼 담당자 후보 — 프로젝트를 고르면 그 프로젝트의 외부 참여자(고객·협력사·프리랜서)도 나온다.
  //   프로젝트를 안 고르면 내부 멤버만 (외부인은 프로젝트 스코프 안에서만 담당자가 될 수 있다 — 백엔드 assertAssignable 과 같은 규칙).
  const[addExternals,setAddExternals]=useState<Array<{user_id:number;name:string;kind:string}>>([]);
  useEffect(()=>{
    if(!bizId||!newProjectId){setAddExternals([]);return;}
    let alive=true;
    (async()=>{
      try{
        const r=await apiFetch(`/api/tasks/by-business/${bizId}/assignable-externals?project_id=${newProjectId}`);
        const j=await r.json();
        if(alive&&j.success)setAddExternals((j.data||[]).map((e:{user_id:number;name:string;kind:string})=>({user_id:e.user_id,name:e.name,kind:e.kind})));
      }catch{/* 외부 후보는 부가 — 실패해도 내부 멤버로 등록은 된다 */}
    })();
    return()=>{alive=false;};
  },[bizId,newProjectId]);
  const[newDueDate,setNewDueDate]=useState<string>('');
  const[newStartDate,setNewStartDate]=useState<string>('');
  const[newEstHours,setNewEstHours]=useState<string>('');
  const[newDescription,setNewDescription]=useState<string>('');
  const[aiEstimating,setAiEstimating]=useState(false);
  const[aiEstReason,setAiEstReason]=useState<string>('');
  // 첨부: 새 task 생성 시 인라인 폼/패널 폼 양쪽 공유. 저장 시 task 생성 후 link.
  const[newUploads,setNewUploads]=useState<File[]>([]);
  const[newExistingFileIds,setNewExistingFileIds]=useState<number[]>([]);
  const[newExistingPostIds,setNewExistingPostIds]=useState<number[]>([]);
  const[showAttachInline,setShowAttachInline]=useState(false);
  const[showAttachPanel,setShowAttachPanel]=useState(false);

  // 담당자 미선택 시 서버 체인(프로젝트 기본담당자→PM→생성자)이 정하는 **실제 배정자** 미리보기.
  //   내 업무(week/all)는 나로 고정, 요청 탭은 선택 필수라 체인이 개입하지 않는다 — 그 두 경우엔 조회 안 함.
  //   ★ 값은 서버가 createTask 와 같은 함수로 계산한다(미리보기 ≠ 실제 방지).
  const chainApplies = !(scope==='mine'&&(tab==='week'||tab==='today'||tab==='all')) && tab!=='requested';
  const[resolvedAssignee,setResolvedAssignee]=useState<{name:string|null;is_me:boolean}|null>(null);
  useEffect(()=>{
    if(!chainApplies||!newProjectId){setResolvedAssignee(null);return;}
    let cancelled=false;
    (async()=>{
      try{
        const r=await apiFetch(`/api/projects/${newProjectId}`);
        const j=await r.json();
        const rd=j?.success?j.data?.resolved_default_assignee:null;
        if(!cancelled)setResolvedAssignee(rd?{name:rd.name,is_me:rd.is_me}:null);
      }catch{ if(!cancelled)setResolvedAssignee(null); }
    })();
    return()=>{cancelled=true;};
  },[newProjectId,chainApplies]);
  // 담당자 셀렉트 placeholder — 동작(체인)이 바뀌었으므로 "담당자: 나" 를 고정 문구로 두면 거짓말이 된다.
  const assigneePlaceholder = tab==='requested'
    ? t('add.assigneeRequiredHint','담당자 선택 (필수)')
    : (resolvedAssignee?.name
        ? (resolvedAssignee.is_me
            ? t('add.assigneeResolvedMe',{name:resolvedAssignee.name,defaultValue:'담당자: {{name}} (나)'})
            : t('add.assigneeResolvedChain',{name:resolvedAssignee.name,defaultValue:'담당자: {{name}} (프로젝트 기본)'}))
        : t('add.assigneeDefault','담당자: 나'));

  // AI 예측 — 제목 (+ 설명) 기반으로 LLM 추천 시간 받아서 newEstHours 채움.
  const handleAiEstimate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || aiEstimating) return;
    setAiEstimating(true);
    setAiEstReason('');
    try {
      const r = await apiFetch('/api/tasks/estimate-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: newDescription || undefined }),
      });
      const j = await r.json();
      if (j.success && typeof j.data?.value === 'number') {
        setNewEstHours(String(j.data.value));
        setAiEstReason(j.data.reason || '');
      }
    } catch (e) {
      console.warn('[ai-estimate]', e);
    } finally {
      setAiEstimating(false);
    }
  }, [newTitle, newDescription, aiEstimating]);
  // 정기업무 (recurring) — 5 프리셋 + Custom + 종료 조건
  const[newRecurEnabled,setNewRecurEnabled]=useState(false);
  const[newRecurPreset,setNewRecurPreset]=useState<RecurPreset>('weekly');
  const[newRecurEndType,setNewRecurEndType]=useState<RecurEndType>('never');
  const[newRecurEndCount,setNewRecurEndCount]=useState<string>('10');
  const[newRecurEndUntil,setNewRecurEndUntil]=useState<string>('');
  const[newRecurCustomEvery,setNewRecurCustomEvery]=useState<string>('1');
  const[newRecurCustomUnit,setNewRecurCustomUnit]=useState<RecurCustomUnit>('week');
  const[showCustomRecurModal,setShowCustomRecurModal]=useState(false);
  const[addingSubmitting,setAddingSubmitting]=useState(false);
  const[statusDropdownId,setStatusDropdownId]=useState<number|null>(null);

  // PWA Share Target 등에서 ?prefill= 으로 본문 전달받음. 마운트 시 한 번만 적용.
  // 사이클 N+56 — ?attachFileIds=1,2,3 도 같이 받아 새 task 모달 첨부 prefill.
  const [searchParams, setSearchParams] = useSearchParams();
  // 퀵메뉴 '+업무' 진입 → 일반 업무추가 드로어(일정·메일과 동일한 '추가' 팝업). (Irene — AI 분해모달 아님)
  //
  // 음성 캡처('말로 추가')도 같은 트리거로 들어온다. 다만 내용은 URL 이 아니라 **navigate state**
  // (`{ voice: VoiceHandoff }`) 로 온다 — 전사문을 주소창·히스토리에 남기지 않기 위해서다.
  // ★ state 는 반드시 이 effect 안에서, `setSearchParams` **전에** 읽어야 한다:
  //   setSearchParams 는 state 를 넘기지 않아 호출 순간 location.state 가 지워진다.
  //   (그래서 별도의 정리용 navigate 도 필요 없다 — 넣으면 방금 지운 create=1 이 되살아난다.)
  //   같은 이유로 재적용 방지용 ref 도 두지 않는다: `create=1` 과 state 가 **같이** 사라지므로 재실행은
  //   위 early-return 에서 끝난다. ref 를 두면 한 번 쓰인 뒤 영구 잠겨 **같은 페이지에서 두 번째로 말한
  //   내용이 통째로 버려진다** (시트는 RightDock 소속이라 /tasks→/tasks 이동은 remount 를 안 일으킨다).
  useEffect(() => {
    if (searchParams.get('create') !== '1') return;
    const voice = (location.state as { voice?: VoiceHandoff } | null)?.voice ?? null;
    setAddingTask(true);
    setAddInline(false);
    if (voice) {
      setNewTitle(voice.title || voice.text || '');
      // detail 은 평문 — RichEditor 는 HTML 을 받는다. 그대로 넣으면 개행이 사라진다.
      //   비어 있으면 **명시적으로 비운다** — 안 그러면 직전 진입의 설명이 그대로 남는다.
      setNewDescription(voice.detail ? plainToHtml(voice.detail) : '');
      // 서버가 워크스페이스 멤버로 확정한 담당자만 쓴다(정확 일치). 확정 실패면 기본 로직대로.
      if (voice.assignee_user_id) setNewAssignee(voice.assignee_user_id);
      else setNewAssignee(tab === 'requested' ? null : (myId ?? null));
      setNewDueDate(voice.when_start ? voice.when_start.slice(0, 10) : '');
    } else {
      setNewAssignee(tab === 'requested' ? null : (myId ?? null));
    }
    const next = new URLSearchParams(searchParams); next.delete('create'); setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, tab, myId, location.state]);
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (prefillAppliedRef.current) return;
    const prefill = searchParams.get('prefill');
    const attachFileIds = searchParams.get('attachFileIds');
    if (prefill || attachFileIds) {
      if (prefill) {
        const decoded = decodeURIComponent(prefill);
        const lines = decoded.split('\n');
        setNewTitle(lines[0]?.slice(0, 200) || '');
        // 공유로 들어온 평문을 RichEditor(HTML) 에 그대로 넣으면 개행이 전부 사라지고
        //   `<`·`&` 가 마크업으로 해석된다 (음성 경로와 같은 계열).
        if (lines.length > 1) setNewDescription(plainToHtml(lines.slice(1).join('\n')));
      }
      if (attachFileIds) {
        const ids = attachFileIds.split(',').map(s => Number(s)).filter(n => Number.isFinite(n) && n > 0);
        if (ids.length > 0) setNewExistingFileIds(ids);
      }
      setAddingTask(true);
      setAddInline(true);
      const next = new URLSearchParams(searchParams);
      next.delete('prefill');
      next.delete('attachFileIds');
      setSearchParams(next, { replace: true });
      prefillAppliedRef.current = true;
    }
  }, [searchParams, setSearchParams]);

  // 인박스 → 업무 후보 카드 강조 (사이클 N+9). 인박스 task_candidate 클릭 시 ?candidate=Y
  // → 우측 패널의 해당 카드로 스크롤 + flash. all 탭 자동 전환 + 우측 패널 자동 열기.
  // 사이클 N+26: 후보 못 찾을 때 silent 실패 대신 상단 안내 띠 노출 (사용자 표현: "눌러도 없어").
  const candidateFlashRef = useRef(false);
  const [candidateMissing, setCandidateMissing] = useState<string | null>(null);
  useEffect(() => {
    if (candidateFlashRef.current) return;
    const cid = searchParams.get('candidate');
    if (!cid) return;
    // 우측 패널 접혀있으면 펼침 + scope/tab 강제 (다른 탭에서 진입한 경우)
    setRightCollapsed(false);
    if (scope === 'mine' && tab !== 'all') setTab('all');
    // candidates 가 아직 로드 안 됐을 수 있어 polling — 최대 5초.
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const el = document.querySelector(`[data-candidate-id="${cid}"]`) as HTMLElement | null;
      if (el) {
        clearInterval(timer);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'background 0.3s, box-shadow 0.3s';
        el.style.boxShadow = '0 0 0 2px rgba(244,63,94,0.5)';
        el.style.background = 'rgba(244,63,94,0.08)';
        setTimeout(() => {
          el.style.boxShadow = '';
          el.style.background = '';
        }, 1800);
        const next = new URLSearchParams(searchParams);
        next.delete('candidate');
        setSearchParams(next, { replace: true });
        candidateFlashRef.current = true;
      } else if (tries >= 25) {  // 5s 대기 후 포기 — 보통 다른 워크스페이스 후보거나 이미 처리됨
        clearInterval(timer);
        candidateFlashRef.current = true;
        setCandidateMissing(cid);
        const next = new URLSearchParams(searchParams);
        next.delete('candidate');
        setSearchParams(next, { replace: true });
      }
    }, 200);
    return () => clearInterval(timer);
    // candidates 변화는 polling 으로 자동 감지 — deps 에 안 넣어도 OK.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams]);
  // 지연 뱃지 quick chip popover (사용자 요청: 마감 지난 업무 즉시 갱신 안내)
  const[delayChipsForId,setDelayChipsForId]=useState<number|null>(null);
  // AI 예측시간 호출 상태 (per task)
  const[aiEstLoading,setAiEstLoading]=useState<Record<number,boolean>>({});
  const[aiEstFlash,setAiEstFlash]=useState<Record<number,boolean>>({});
  const[requestedComments,setRequestedComments]=useState<CommentRow[]>([]);
  const[candidates,setCandidates]=useState<CandidateRow[]>([]);
  const[periodPickerOpen,setPeriodPickerOpen]=useState(false);
  const periodAnchorRef=React.useRef<HTMLButtonElement>(null);
  // 기간 picker — 시작/마감 단일 셀로 통일 (리스트의 DateRangeCell 패턴과 동일)
  const[newDatePickerOpen,setNewDatePickerOpen]=useState(false);
  const newDateAnchorRefInline=React.useRef<HTMLButtonElement>(null);
  const newDateAnchorRefPanel=React.useRef<HTMLButtonElement>(null);
  const formatDateRange=(s:string,d:string)=>{
    const fmt=(v:string)=>v?v.slice(5).replace('-','/'):'';
    if(s&&d) return s===d?fmt(d):`${fmt(s)} ~ ${fmt(d)}`;
    if(d) return fmt(d);
    if(s) return fmt(s);
    return '';
  };
  const[dailyProgress,setDailyProgress]=useState<{date:string;est_used:number;act_used:number}[]>([]);
  // #254 — 업무별 기준선(기간 시작 이전 최신 스냅샷). 오늘 라이브 값도 같은 기준으로 Δ 를 내야
  //   과거일(서버 Δ)과 오늘(라이브)이 같은 선 위에 놓인다.
  const[progressBases,setProgressBases]=useState<Record<string,{act:number;est_done:number}>>({});
  const myMemberIdRef=useRef<number|null>(null);   // 가용시간 저장용 member row id (왕복 절약)
  // ★ P0-1 (Irene 승인 2026-08-24) — 쓰기 실패를 **절대 침묵시키지 않는다.**
  //   운영 실측 #228: 10시간·100% 를 넣었는데 요청이 실패했고 화면은 아무 말도 하지 않았다
  //   (`if(!r.ok) return;` + uncontrolled input 이 타이핑한 값을 붙들고 있어 "저장됨" 으로 보인다).
  //   그래서 "그래프가 틀렸다" 는 신고가 반복됐다 — 그래프는 맞았고 데이터가 안 들어갔다.
  const[saveErr,setSaveErr]=useState<string|null>(null);
  const saveErrTimer=useRef<number|undefined>(undefined);
  const reportSaveFail=useCallback((what:string,status?:number)=>{
    setSaveErr(status===401||status===403
      ? t('save.failAuth',{ defaultValue: '{{what}} 을(를) 저장하지 못했어요 — 로그인이 만료되었을 수 있어요. 새로고침 후 다시 시도해 주세요.', what })as string
      : t('save.fail',{ defaultValue: '{{what}} 을(를) 저장하지 못했어요. 값이 서버에 반영되지 않았습니다.', what })as string);
    if(saveErrTimer.current)window.clearTimeout(saveErrTimer.current);
    saveErrTimer.current=window.setTimeout(()=>setSaveErr(null),8000);
  },[t]);

  const thisMonday=thisMondayStr;

  // ── 업무 생성 기본값의 단일 원천 ────────────────────────────────────────
  //   "오늘/이번 주 나의 업무" 에서 만든 업무는 **그 목록 안에 남아야 한다.**
  //   여태 규칙이 일반 추가 폼에만 있어서, 같은 탭의 Cue 바·행 아래 추가로 만들면
  //   방금 만든 업무가 즉시 사라졌다(Irene 신고). 정의를 여기 한 곳에 두고 전부 이걸 쓴다.
  //   · due_date = 오늘 → 오늘 탭 술어(due === today) 통과. 주간 술어도 함께 통과.
  //   · planned_week_start = 이번 주 월요일 → 이번 주 탭 술어 통과.
  const tabCreateDefaults=useMemo(
    ()=>(scope==='mine'&&(tab==='week'||tab==='today'))
      ? { due_date: todayStr, planned_week_start: thisMonday }
      : null,
    [scope,tab,todayStr,thisMonday]
  );

  // ── Load ALL data once ──
  // 1단계: 리스트(전체 업무) + 멤버 — 즉시 렌더를 위한 최소 로드
  const load=useCallback(async()=>{
    // ★ 워크스페이스가 아직 안 잡혔으면 **대기 상태도 같이 끝낸다.**
    //   그냥 return 하면 loading 초기값 true 가 그대로 남아 화면이 영원히 "Loading..." 이다
    //   (memory: feedback_predicate_must_match_both_sides — 안 하기를 추가하는 변경은 대기 상태도 손봐야).
    if(!bizId){ setLoading(false); return; }
    // 캐시로 이미 그려 놓았으면 전체 화면 스피너로 되돌리지 않는다.
    if(!hasCache(taskCacheKey)) setLoading(true);
    try{
      // 사이클 N+55 — auto-paginate. 워크스페이스 task 1000+ 누적 시 5000 까지 자동 누적
      const allTasksCollected: unknown[] = [];
      let firstPageOk = false;
      for (let page = 1; page <= 5; page++) {
        const r = await(await apiFetch(`/api/projects/workspace/${bizId}/all-tasks?page=${page}&limit=1000`)).json();
        if (!r.success) break;
        if (page === 1) firstPageOk = true;
        allTasksCollected.push(...(r.data || []));
        if (!r.pagination || !r.pagination.has_more) break;
      }
      // ★ 첫 페이지부터 실패하면 **빈 목록으로 바꾸지 않는다.** 옛 코드는 빈 배열을 상태에 넣고
      //   캐시에까지 써서, 서버 오류가 "업무가 하나도 없음" 으로 보였고 그 상태가 저장됐다.
      //   (2페이지 이후 실패는 부분 성공이라 있는 만큼 보여준다 — 종전 동작 유지)
      //   ★ 대기 상태를 같이 끝낸다 — setLoading(false) 는 try 밖에 있어서 return 하면 건너뛴다.
      //     안 그러면 스켈레톤이 영원히 돈다(이 함수 맨 위 주석의 그 함정 그대로).
      if (!firstPageOk) { setLoadError(true); setLoading(false); return; }
      setLoadError(false);
      setAllTasks(allTasksCollected as never[]);
      writeCache(taskCacheKey, allTasksCollected);
      try{
        const mr=await(await apiFetch(`/api/businesses/${bizId}/members`)).json();
        if(mr.success){
          // 사이클 P8 — Cue (is_ai=true) 도 팀원으로 표시. 자동 실행 가능.
          const opts=(mr.data||[])
            .filter((m:{user_id:number|null})=>m.user_id!=null) // user_id null row (탈퇴/끊김) 제외
            .map((m:{user_id:number;name?:string|null;user?:{name:string;is_ai?:boolean};department?:OrgUnitLite|null;team?:OrgUnitLite|null})=>({
              user_id:m.user_id,
              // 워크스페이스 표시명 (BusinessMember.name) 우선 — 계정명 fallback
              name:m.name||m.user?.name||`user ${m.user_id}`,
              is_ai:!!m.user?.is_ai,
              department:m.department||null,
              team:m.team||null,
            }));
          setMembers(opts);
          writeCache(cacheKey('qtask-members',myId,bizId), opts);
          // 가용시간 저장 때 쓸 내 member row id — 저장할 때마다 목록을 다시 받지 않기 위해.
          const mine=(mr.data||[]).find((m:{user_id:number|null;id:number})=>m.user_id===myId);
          if(mine) myMemberIdRef.current=mine.id;
        }
      }catch{}
    }catch{}
    setLoading(false);
  },[bizId,myId,taskCacheKey]);   // myId — members 매핑에서 내 member row id 를 잡는다

  useEffect(()=>{load();},[load]);

  // 2단계: 탭별 lazy 로드 (한 번만)
  const loadedExtrasRef=useRef<{insights?:boolean;requested?:boolean;all?:boolean}>({});
  // scope 바뀌면 insights 재로드 (mine ↔ workspace 프로젝트 범위 다름)
  useEffect(()=>{loadedExtrasRef.current.insights=false;},[scope]);
  useEffect(()=>{
    if(!bizId||allTasks.length===0)return;
    const ran=loadedExtrasRef.current;
    // 인사이트(Capacity/Burndown/Issues/Notes) 는 모든 탭에서 공통으로 노출되므로 한 번만 로드
    if(!ran.insights){
      ran.insights=true;
      (async()=>{
        try{
          const wr=await(await apiFetch(`/api/tasks/my-week?business_id=${bizId}`)).json();
          // ★ capacity 가 없으면 **넣지 않는다**. 여태는 그대로 넣어서 undefined 가 상태에 들어가고
          //   effectiveCapacity 의 `capacity.daily` 에서 Q Task 화면 전체가 죽었다(React 오류 화면).
          //   바로 아랫줄은 `?.` 로 방어하고 있는데 이 줄만 빠져 있었다.
          //   ※ 계산식·기본값은 건드리지 않는다 — 가용시간은 동결 영역이다.
          if(wr.success&&wr.data?.capacity){
            setCapacity(wr.data.capacity);
            // 운영 #50 — 이번 주 휴일도 백엔드에서 복원 (페이지 이탈 후 0 리셋 버그 fix)
            if(typeof wr.data.capacity?.holidays==='number')setHolidayDays(wr.data.capacity.holidays);
          }
        }catch{/* ignore */}
        // WORK_FLOW §6 (U5) — 실측 참여율 제안 (서버가 커버리지 충분할 때만 suggested_rate 반환)
        try{
          const sr=await(await apiFetch(`/api/tasks/by-business/${bizId}/participation-suggestion`)).json();
          if(sr.success&&sr.data?.suggested_rate!=null&&sr.data.suggested_percent!==sr.data.current_percent){
            setRateSuggestion({percent:sr.data.suggested_percent,focusHours:sr.data.focus_hours,weeks:sr.data.weeks});
          }else setRateSuggestion(null);
        }catch{/* ignore */}
        // 이슈/메모 (scope 에 따라 소스 달라짐: mine=내가 담당한 프로젝트, workspace=전체 프로젝트 상위 N)
        const projMap=new Map<number,string>();
        const relevantTasks=scope==='workspace'?allTasks:allTasks.filter(x=>x.assignee_id===myId);
        for(const t of relevantTasks){if(t.project_id&&t.Project?.name)projMap.set(t.project_id,t.Project.name);}
        const projIds=[...projMap.keys()].slice(0,scope==='workspace'?10:5);
        const ai:IssueRow[]=[];const an:NoteRow[]=[];
        await Promise.all(projIds.map(async pid=>{
          const pName=projMap.get(pid)||'';
          try{
            const [ir,nr]=await Promise.all([
              apiFetch(`/api/projects/${pid}/issues`).then(r=>r.json()),
              apiFetch(`/api/projects/${pid}/notes`).then(r=>r.json()),
            ]);
            if(ir.success)ai.push(...(ir.data||[]).slice(0,2).map((i:IssueRow)=>({...i,projectName:pName})));
            if(nr.success)an.push(...(nr.data||[]).slice(0,2).map((n:NoteRow)=>({...n,projectName:pName})));
          }catch{/* ignore */}
        }));
        setIssues(ai.slice(0,scope==='workspace'?8:5));setNotes(an.slice(0,scope==='workspace'?8:5));
      })();
    }
    if(tab==='requested'&&!ran.requested){
      ran.requested=true;
      (async()=>{
        try{
          const rc=await(await apiFetch(`/api/tasks/requested-comments?business_id=${bizId}`)).json();
          if(rc.success)setRequestedComments(rc.data||[]);
        }catch{}
      })();
    }
    if(tab==='all'&&!ran.all){
      ran.all=true;
      (async()=>{
        try{
          const ec=await(await apiFetch(`/api/tasks/extracted-candidates?business_id=${bizId}`)).json();
          if(ec.success)setCandidates(ec.data||[]);
        }catch{}
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[tab,bizId,allTasks.length,scope]);

  // Socket.IO (공유 소켓 services/socket) — 워크스페이스 room 에서 task:* 수신 (Q Talk 후보 등록 즉시 반영)
  useEffect(() => {
    if (!bizId || !user) return;
    joinRoom(`business:${bizId}`);
    const offNew = onSocket('task:new', (task: TaskRow) => {
      setAllTasks((prev) => {
        if (prev.some((t) => t.id === task.id)) return prev;
        return [task, ...prev];
      });
    });
    const offUpd = onSocket('task:updated', (task: TaskRow) => {
      setAllTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...task } : t)));
    });
    const offDel = onSocket('task:deleted', (meta: { id: number }) => {
      setAllTasks((prev) => prev.filter((t) => t.id !== meta.id));
    });
    // N+93 — 프로젝트명 변경 실시간 반영 (#11). project:updated 수신 시 전체 reload (프로젝트명 갱신).
    const offProj = onSocket('project:updated', () => { load(); });
    // #250 — 태그 사전 변경(이름/색/삭제)은 전 업무의 칩 표기에 전파된다. 사전만 다시 읽는다.
    //   업무 자체의 태그 지정 변경은 `task:updated`(payload.tags) 가 위 merge 로 처리한다.
    const offTag = onSocket('task_tag:updated', () => { loadTagDict(); });
    return () => {
      leaveRoom(`business:${bizId}`);
      offNew(); offUpd(); offDel(); offProj(); offTag();
    };
  }, [bizId, user?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // #250 — 태그 사전(필터 드롭다운의 정본). 업무 목록과 별개 축이라 따로 읽는다.
  const loadTagDict=useCallback(async()=>{
    if(!bizId)return;
    const r=await apiFetch(`/api/tasks/tags?business_id=${bizId}`);
    if(!r.ok)return;   // apiFetch 는 throw 안 함 — 실패 시 옛 사전 유지
    const j=await r.json();
    setTagDict(Array.isArray(j?.data)?j.data:[]);
  },[bizId]);
  useEffect(()=>{loadTagDict();},[loadTagDict]);

  // 모바일 PWA background 복귀 시 missed events 회복 — socket 재연결 동안 emit 된
  // task:new/updated/deleted 는 영구 손실되므로 load() 로 보정
  useVisibilityRefresh(useCallback(() => {
    load();
    const s = getSocket();
    if (s && !s.connected) s.connect();
  }, [load]));

  // Esc 키로 드로어 닫기 (상세 + 업무 추가)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (addingTask) { setAddingTask(false); resetNewTask(); return; }
      if (detailTaskId) { closeDetail(); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addingTask, detailTaskId]);

  // 일별 스냅샷 로드 — WORK_FLOW §6-C: 이번 주 업무 집합(chartTaskIds)으로 스코핑.
  //   chartTaskIds 는 filtered 정의 이후라 아래(weekTotalEst 근처)에서 effect 로 실행.

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
  // 진행률 ↔ status 자동 전환은 backend (PATCH /time + PUT 양쪽) 가 단독 처리 — 단일 진실 원천.
  // frontend optimistic 만 (응답 socket task:updated 가 정확한 status 로 다시 갱신).
  const saveField=async(taskId:number,field:string,value:unknown)=>{
    try{
      const r=await apiFetch(`/api/tasks/${taskId}/time`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({[field]:value})});
      if(!r.ok){
        // ★ 침묵 금지 — 사유를 말하고, 서버 값으로 되돌려 화면이 거짓말하지 않게 한다.
        reportSaveFail(field==='actual_hours'?t('col.act','실제시간') as string
          :field==='estimated_hours'?t('col.est','예측시간') as string
          :field==='progress_percent'?t('col.progress','진행률') as string:field, r.status);
        load();
        return;
      }
      setAllTasks(prev=>prev.map(t=>{
        if(t.id!==taskId)return t;
        const u={...t,[field]:value};
        if(field==='progress_percent'){
          const pct=Number(value);
          const hasReviewer=(t.reviewers||[]).length>0;
          // ★ #206 R1 — 보류/외부컨펌 중에는 progress→status 자동 전환 정지 (backend PUT 과 미러).
          //   보류한 업무가 진행률 100 입력만으로 소리없이 completed 가 되면 보류 선언이 무시된다.
          const holdBlocks=t.status==='on_hold'||t.status==='external_review';
          // optimistic — backend 의 reviewer 분기와 일치
          if(holdBlocks){
            /* 자동 전환 없음 — 진행률만 반영 */
          } else if(pct===100&&!hasReviewer&&t.status!=='completed'){
            u.status='completed';
          } else if(pct>0&&pct<100&&(t.status==='not_started'||t.status==='task_requested'||t.status==='task_re_requested'||t.status==='waiting')){
            u.status='in_progress';
          } else if(pct===0&&t.status==='in_progress'){
            u.status='not_started';
          } else if(pct<100&&t.status==='completed'){
            u.status='in_progress';
          }
        }
        return u;
      }));
      // N+92 — status/progress 변경은 backend 에서 Focus session 을 전환/종료한다 (routes/tasks.js PATCH /time).
      // 좌측 FocusWidget 이 즉시 반영하도록 focus:refresh dispatch (피드백 ID 15/16 — 30s 폴링 지연 호소 fix).
      if(field==='status'||field==='progress_percent'){
        try{window.dispatchEvent(new CustomEvent('focus:refresh'));}catch{/* noop */}
      }
    }catch{}
  };

  const saveTitle=async(taskId:number,title:string)=>{
    const task=allTasks.find(t=>t.id===taskId);
    if(!task)return;
    try{
      const r=await apiFetch(`/api/tasks/by-business/${bizId}/${taskId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})});
      if(!r.ok)return;  // 실패 시 낙관적 title 적용 금지
      setAllTasks(prev=>prev.map(t=>t.id===taskId?{...t,title}:t));
    }catch{}
  };

  // 프로젝트 옵션 — 워크스페이스 전체 프로젝트 (active) 직접 fetch.
  // 이전 구현: allTasks 에서 distinct → 업무 없는 신규 프로젝트가 드롭다운에 안 떠 검색 불가능.
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    if (!bizId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/projects?business_id=${bizId}&status=active`);
        const j = await r.json();
        if (!cancelled && j.success && Array.isArray(j.data)) {
          setProjects(j.data.map((p: { id: number; name: string }) => ({ id: p.id, name: p.name })));
        }
      } catch { /* skip */ }
    })();
    return () => { cancelled = true; };
  }, [bizId]);
  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: String(p.id), label: p.name })),
    [projects]
  );

  const resetNewTask=()=>{
    setNewTitle('');setNewAssignee(null);setNewProjectId(null);
    setNewDueDate('');setNewStartDate('');setNewEstHours('');setNewDescription('');
    setNewRecurEnabled(false);setNewRecurPreset('weekly');
    setNewRecurEndType('never');setNewRecurEndCount('10');setNewRecurEndUntil('');
    setNewRecurCustomEvery('1');setNewRecurCustomUnit('week');
    setNewUploads([]);setNewExistingFileIds([]);setNewExistingPostIds([]);
    setShowAttachInline(false);setShowAttachPanel(false);
    setAiEstReason('');
    setNewTagIds([]);
  };

  // 현재 폼 상태 → RRULE 문자열 (없으면 null).
  const buildCurrentRRule = (dueDate: string): string | null => {
    if (!newRecurEnabled || !dueDate) return null;
    const end = {
      type: newRecurEndType,
      count: newRecurEndType === 'count' ? Number(newRecurEndCount) || 1 : undefined,
      until: newRecurEndType === 'until' ? newRecurEndUntil : undefined,
    };
    if (newRecurPreset === 'custom') {
      return buildCustomRRule(Number(newRecurCustomEvery) || 1, newRecurCustomUnit, end);
    }
    // 운영 #347 — 새로 만드는 폼에서는 'advanced' 가 나올 수 없지만, 타입상 가능하므로 명시적으로 막는다
    //   (여기서 재빌드하면 규칙이 축소된다 — 상세 드로어에서 났던 회귀와 같은 종류).
    if (newRecurPreset === 'advanced') return null;
    return buildPresetRRule(newRecurPreset, dueDate, end);
  };
  const addTask=async()=>{
    if(addingSubmitting)return; // 중복 방지
    if(!newTitle.trim()||!bizId)return;
    // 담당자 결정
    // - 내 업무 week/all : 무조건 나 (담당자 선택 UI 없음 — 내 업무 목록이니 나로 고정)
    // - requested : 선택 필수
    // - workspace : 선택 가능. **미선택이면 null 로 보낸다** — 그래야 서버의 담당자 체인
    //   (프로젝트 기본담당자 → PM → 생성자)이 탄다. 여기서 나로 채우면 그 체인은 영영 죽은 코드다.
    //   프로젝트를 안 골랐으면 서버가 생성자로 폴백하므로 종전과 결과가 같다.
    let targetAssignee:number|null;
    if(scope==='mine'&&(tab==='week'||tab==='today'||tab==='all')){
      targetAssignee=myId;
    }else if(tab==='requested'){
      if(!newAssignee)return; // 필수
      targetAssignee=newAssignee;
    }else{
      targetAssignee=newAssignee;
    }
    // 이번 주/오늘 탭에서는 마감일 기본값 = 오늘 (그 목록의 범위 안에 들어오도록).
    //   ★ 오늘 탭에도 필요하다 — 없으면 날짜 없는 not_started 가 backlog flood 차단 규칙에 걸려
    //     방금 추가한 업무가 목록에서 즉시 사라진다(추가했는데 안 보임).
    const defaultDue=tabCreateDefaults?.due_date??null;
    const finalDueDate = newDueDate || defaultDue;
    // 정기업무는 due_date 필수 (백엔드도 검증)
    if (newRecurEnabled && !finalDueDate) return;
    const recurrenceRule = newRecurEnabled && finalDueDate ? buildCurrentRRule(finalDueDate) : null;
    setAddingSubmitting(true);
    try{
      const r=await(await apiFetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          business_id:Number(bizId),
          title:newTitle.trim(),
          description:newDescription.trim()||null,
          assignee_id:targetAssignee,
          project_id:newProjectId,
          planned_week_start:tabCreateDefaults?.planned_week_start??null,
          start_date:newStartDate||null,
          due_date:finalDueDate,
          estimated_hours:newEstHours?Number(newEstHours):null,
          recurrence_rule:recurrenceRule,
        })
      })).json();
      if(r.success){
        const newTaskId = r.data.id;
        // 1) 새 업로드 파일들 — 워크스페이스 업로드 후 fileId 수집
        const uploadedFileIds: number[] = [...newExistingFileIds];
        if (newUploads.length > 0) {
          for (const f of newUploads) {
            try {
              const fd = new FormData();
              fd.append('file', f);
              const upR = await apiFetch(`/api/files/${bizId}`, { method: 'POST', body: fd });
              const upJ = await upR.json();
              if (upJ.success && upJ.data?.id) uploadedFileIds.push(Number(upJ.data.id));
            } catch (err) { console.warn('[task upload]', err); }
          }
        }
        // 2) 모은 fileId 들을 task 에 link (TaskAttachment 생성)
        //   ★ 운영 #256 — context 는 'description_attach' 다. 업무를 **추가하는 시점**의 첨부는
        //     의뢰 명세(업무 설명)에 딸린 자료이지 수행자가 낸 결과물이 아니다.
        //     'task' 로 붙이면 상세 드로어의 **업무 결과물** 아래에 렌더된다
        //     (Irene: "업무추가할 때 넣은 첨부파일이 업무결과물 넣는 곳 아래로 붙어").
        //     권한도 이쪽이 맞다 — description_attach 는 작성자/owner/admin 이고 생성자는 곧 작성자다.
        //     결과물 첨부는 상세 드로어의 TaskAttachments 가 계속 'task' 로 붙인다(무변경).
        //   ★ 문서(post)도 같이 보낸다 — 여태 고른 문서는 **아무 데도 가지 않았다**
        //     (아래 3) 자리에 TODO 만 남아 있었다). 첨부했다고 믿는데 조용히 사라졌다.
        if (uploadedFileIds.length > 0 || newExistingPostIds.length > 0) {
          try {
            const linkRes = await apiFetch(`/api/tasks/${newTaskId}/attachments/link`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                file_ids: uploadedFileIds,
                post_ids: newExistingPostIds,
                context: 'description_attach',
              }),
            });
            // apiFetch 는 throw 하지 않는다 — res.ok 를 직접 본다.
            if (!linkRes.ok) console.warn('[task attach link] HTTP', linkRes.status);
          } catch (err) { console.warn('[task attach link]', err); }
        }
        // 2-B) 태그 붙이기 (#236/#250) — 실패해도 업무 생성은 이미 성공이라 되돌리지 않는다.
        //   ★ apiFetch 는 throw 하지 않는다 — res.ok 를 직접 본다(안 보면 실패가 조용히 삼켜진다).
        if (newTagIds.length > 0) {
          try {
            const tagRes = await apiFetch(`/api/tasks/${newTaskId}/tags`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tag_ids: newTagIds }),
            });
            if (!tagRes.ok) console.warn('[task tags] HTTP', tagRes.status);
          } catch (err) { console.warn('[task tags]', err); }
        }
        // Socket task:new 가 먼저 도착했을 가능성 — 중복 방지
        setAllTasks(prev=>prev.some(x=>x.id===r.data.id)?prev:[r.data,...prev]);
        resetNewTask();
        setAddingTask(false);
      }
    }catch(e){console.error('[addTask]',e);}
    finally{setAddingSubmitting(false);}
  };

  // 우선순위 토글 — #250 ②청크. **재인덱스는 백엔드가 단독 수행**한다.
  //   옛 코드는 여기서 낙관적 state 를 만들고 task 마다 개별 PUT 을 쐈다 —
  //     ① 비원자적이라 중간 실패 시 1,2,4,5 로 깨졌다
  //     ② 정본 집합에 들어온 **남의 업무**(pending 컨펌자·관여완료 분기)는 PATCH /time 이 403 을 내
  //        조용히 부분 실패했다
  //     ③ 팝아웃은 같은 로직이 없어 읽기 전용이었다 (#250 "우선순위 관리도 여기서도 해야 해")
  //   이제 `POST /api/tasks/priority/toggle` 이 정본 집합을 원자적으로 다시 매기고, 응답의
  //   priorities 맵으로 state 를 맞춘다. 서버 사슬은 byPriorityChain 과 문자 그대로 동일하다.
  const [prioBusy,setPrioBusy]=useState(false);   // 중복 제출 가드 (UI_DESIGN_GUIDE §1.8)
  const togglePriority=async(taskId:number, autoSort:boolean=true)=>{
    if(prioBusy)return;   // 더블클릭 = 부여 후 즉시 해제 사고 차단
    if(autoSort){
      setSortKey('priority_order');
      setSortDir('asc');
    }
    setPrioBusy(true);
    try{
      const r=await apiFetch('/api/tasks/priority/toggle',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({business_id:bizId,task_id:taskId,from:periodFrom,to:periodTo}),
      });
      if(!r.ok)return;   // apiFetch 는 throw 안 함 — 실패 시 낙관적 적용 금지(거짓 성공)
      const j=await r.json();
      const map=new Map<number,number|null>((j?.data?.priorities||[]).map((p:{id:number;priority_order:number|null})=>[p.id,p.priority_order]));
      setAllTasks(prev=>prev.map(t=>(map.has(t.id)?{...t,priority_order:map.get(t.id)??null}:t)));
    }catch{}
    finally{setPrioBusy(false);}
  };

  // ── 상세 드로어 오픈/닫기 (URL 싱크) — 로딩/워크플로우는 TaskDetailDrawer 내부 처리 ──
  // 같은 taskId 재호출 시 토글 — 통일된 UX 원칙 (CLAUDE.md)
  const openDetail=(taskId:number)=>{
    if(detailTaskId===taskId){closeDetail();return;}
    setDetailTaskId(taskId);
    // 열면 안 읽음 뱃지 옵티미스틱 해제 (backend GET /detail 이 알림 read 처리 — 운영 #5)
    setAllTasks(prev=>prev.map(t=>t.id===taskId&&t.has_unread?{...t,has_unread:false}:t));
    const sp=new URLSearchParams(location.search);
    sp.set('task',String(taskId));
    navigate(`${location.pathname}?${sp.toString()}`,{replace:true});
  };
  const closeDetail=()=>{
    setDetailTaskId(null);
    const sp=new URLSearchParams(location.search);
    sp.delete('task');
    const qs=sp.toString();
    navigate(qs?`${location.pathname}?${qs}`:location.pathname,{replace:true});
  };

  // N+92 — URL ?task= → detailTaskId 동기화 (피드백 ID 16#4 fix).
  //   detailTaskId 는 mount 시 1회만 URL 에서 초기화돼서, 이미 /tasks 에 있을 때 외부(좌측 FocusWidget
  //   배너 업무명 클릭 등)에서 navigate(/tasks?task=N) 해도 드로어가 안 열리던 회귀.
  //   URL→state 단방향 sync (openDetail 이 state+URL 둘 다 set 하므로 동일 값 set 은 no-op, 루프 없음).
  useEffect(()=>{
    const q=searchParams.get('task');
    const next=q?Number(q):null;
    setDetailTaskId(prev=>prev===next?prev:next);
  },[searchParams]);

  // 리스트 타이틀/날짜 편집용 간단 저장 (드로어 내부에도 자체 saveField 존재)
  // 운영 #279 — 여러 필드를 한 번의 PUT 으로. 기간을 두 번 쏘면 경쟁 + 부분 저장이 난다.
  const saveTaskFields=async(taskId:number,patch:Record<string,unknown>)=>{
    try{
      const r=await apiFetch(`/api/tasks/by-business/${bizId}/${taskId}`,{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(patch)});
      if(!r.ok)return;  // 실패 시 낙관적 적용 금지
      setAllTasks(prev=>prev.map(t=>t.id===taskId?{...t,...patch}:t));
    }catch{}
  };
  const saveTaskField=async(taskId:number,field:string,value:unknown)=>saveTaskFields(taskId,{[field]:value});

  const registerCandidate=async(candId:number,overrides?:{title?:string;assignee_id?:number|null;start_date?:string|null;due_date?:string|null})=>{
    try{
      const r=await apiFetch(`/api/projects/task-candidates/${candId}/register`,{
        method:'POST',
        headers:overrides?{'Content-Type':'application/json'}:undefined,
        body:overrides?JSON.stringify(overrides):undefined,
      });
      const j=await r.json();
      if(!r.ok||!j?.success)return;  // 실패 시 candidate 유지(성공 전 제거 금지 — 거짓 등록 방지)
      setCandidates(prev=>prev.filter(c=>c.id!==candId));
      await load();
      if(j?.data?.task?.id){
        openDetail(j.data.task.id);
      }
    }catch{}
  };
  // 운영 #46 — 채팅 후보 카드와 동일하게 거절도 지원 (공유 TaskCandidateCard 사용).
  const rejectCandidate=async(candId:number)=>{
    try{
      const r=await apiFetch(`/api/projects/task-candidates/${candId}/reject`,{method:'POST'});
      if(r.ok)setCandidates(prev=>prev.filter(c=>c.id!==candId));
    }catch{}
  };

  // 업무 종류별 선택 가능한 단계 목록
  // 드롭다운 옵션 라벨 — not_started 가 요청 업무면 task_requested 라벨 사용
  const optionLabel=(task:{source?:string;request_ack_at?:string|null},status:string,role:string):string=>{
    const isReq=task.source==='internal_request'||task.source==='qtalk_extract';
    if(status==='not_started'&&isReq&&!task.request_ack_at){
      return t(`status.task_requested.${role}`,t('status.task_requested.observer','업무요청')) as string;
    }
    return t(`status.${status}.${role}`,t(`status.${status}.observer`,status)) as string;
  };

  const changeStatus=async(taskId:number,newStatus:string,opts?:{resetProgress?:boolean})=>{
    try{
      const nextProg=newStatus==='completed'?100:(opts?.resetProgress?0:undefined);
      if(nextProg!==undefined){
        const pr=await apiFetch(`/api/tasks/${taskId}/time`,{method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({progress_percent:nextProg})});
        if(!pr.ok){ reportSaveFail(t('col.progress','진행률') as string, pr.status); load(); return; }
      }
      // Use the existing PUT route for status
      const sr=await apiFetch(`/api/tasks/by-business/${bizId}/${taskId}`,{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({status:newStatus})});
      // status 전이는 reviewer 가드(no_reviewers 400)·권한(403)으로 거절될 수 있다 — 성공 시에만 낙관적 적용(거짓 성공 방지)
      if(!sr.ok){ reportSaveFail(t('col.status','상태') as string, sr.status); load(); }
      if(sr.ok){
        setAllTasks(prev=>prev.map(t=>{
          if(t.id!==taskId)return t;
          const u={...t,status:newStatus};
          if(newStatus==='completed'){u.progress_percent=100;}
          if(opts?.resetProgress){u.progress_percent=0;}
          return u;
        }));
        // 완료 시 우선순위 해제
        if(newStatus==='completed'){
          const task=allTasks.find(t=>t.id===taskId);
          if(task?.priority_order)togglePriority(taskId,false);
        }
      }
    }catch{}
    setStatusDropdownId(null);
  };

  const toggleComplete=(task:TaskRow)=>{
    // #206 — 보류/외부컨펌 중엔 완료로 못 간다(백엔드 가드와 미러). 체크박스는 disabled 지만
    //   프로그램적 호출 경로까지 막아 우회를 원천 차단한다.
    if(task.status==='on_hold'||task.status==='external_review')return;
    // ★ Irene 2026-08-24 — "체크 다시 해제하면 진행률 0이 되어야 한다". 리스트·팝아웃 공통 규칙.
    if(task.status==='completed')changeStatus(task.id,'in_progress',{resetProgress:true});
    else changeStatus(task.id,'completed');
  };
  const completeBlocked=(status?:string)=>status==='on_hold'||status==='external_review';

  const handleSort=(key:SortKey)=>{
    if(sortKey===key)setSortDir(d=>d==='asc'?'desc':'asc');
    else{setSortKey(key);setSortDir('asc');}
  };

  const today=todayStr;

  // ── 이번 주 canonical 집합 판정 ──
  //   ★ 우선순위 번호와 DB 재인덱스의 정본은 **이 판정**이다. search / statusFilter / 완료 가리기 같은
  //     "보기 옵션" 은 번호에 영향을 주면 안 된다. 예전에는 filtered 를 그대로 입력으로 써서, week 탭에서
  //     검색어만 입력해도 매칭된 부분집합 기준으로 priority_order 를 1..N 으로 silent PUT 재작성 →
  //     검색 밖 task 의 우선순위와 충돌하는 데이터 오염이 났다 (2026-07-28 Fable 설계 게이트가 잡은 실버그).
  //   ★ 백엔드 `my-week` 의 where 절과 **미러**다 (routes/tasks.js). 한쪽만 고치면 메인과 팝아웃의
  //     우선순위 번호가 갈린다 — 실제로 reviewer·관여완료 분기 누락으로 그 결함이 났다.
  const inWeekCanonical=useCallback((t:TaskRow, includeDone:boolean)=>{
    // 1) 기간/상태 검사 — "이번 주 나의 업무" canonical 규칙 (docs/WORK_FLOW_DESIGN.md §5).
    //  - 완료/취소: "완료시점"이 이번 주인 것만 (completed_at 이 기간 안). 마감 과거여도 이번 주에
    //    끝냈으면 이번 주 업무 (완료시점 기준). completed_at 없으면 제외(언제 끝났는지 모름).
    //  - 미진행(not_started): "이번 주 것"만 — 이번 주 계획(planned_week_start) 또는 이번 주 마감(due).
    //    옛/미래/날짜없는 미진행은 제외 (착수 안 한 backlog 가 이번 주로 쏟아지는 워프로랩 flood 차단).
    //  - 진행중·검토중·수정요청·대기: 날짜 무관 전부 표시. 한 번 착수한 내 업무는 마감/날짜 없어도
    //    끝까지 이번 주 책임선에 남는다 (요청받아 진행 중인 마감없는 업무 포함).
    const completedStr=(t.completed_at||'').slice(0,10);
    const dueStr=(t.due_date||'').slice(0,10);
    const plannedStr=(t.planned_week_start||'').slice(0,10);
    const isDone=t.status==='completed'||t.status==='canceled';
    const inPeriod=(()=>{
      if(isDone) return completedStr ? (completedStr>=periodFrom&&completedStr<=periodTo) : false;
      if(t.status==='not_started'){
        if(plannedStr===periodFrom) return true;            // 이번 주 계획
        if(!dueStr) return false;                            // 마감 없는 backlog 제외 (flood 차단)
        if(dueStr<periodFrom) return true;                   // ★ 지연(마감 지난 미착수)도 이번 주 포함 — Irene 2026-07-05
        return dueStr<=periodTo;                             // 이번 주 마감 (미래만 제외)
      }
      // #206 R6 — 보류는 이번 주 무대에서 퇴장(전체 탭·보류 컬럼에만 주차). 서버 my-week 화이트리스트와 미러.
      //   external_review 는 잔류 — 외부를 채근할 책임이 담당자에게 남는다.
      if(t.status==='on_hold') return false;
      return true; // in_progress·reviewing·revision_requested·waiting·external_review
    })();
    if(!inPeriod) return false;

    // 2) 내가 행동해야 하는 것 + 완료 포함 여부
    // 담당자=나: 활성 단계(reviewing 포함) 모두 표시. 마감 책임이 끝까지 담당자에게 있어
    // 컨펌 대기 중이라도 본인 화면에서 사라지면 안 됨. completed/canceled 는 아래 완료 분기가 담당.
    if(t.assignee_id===myId){
      if(!isDone) return true;
    }
    // 운영 #375 — 외부컨펌을 건 사람이 컨펌 완료 시점을 관리한다. 담당자 분기에만 잔류 규칙이
    //   있어서 의뢰자·작성자가 자기가 건 외부컨펌을 잃었다. 서버 weekTaskSet.myWeekWhere 와 **미러** —
    //   한쪽만 고치면 우선순위 번호가 화면마다 갈린다.
    if(t.status==='external_review'&&(t.request_by_user_id===myId||t.created_by===myId))return true;
    const myRev=t.reviewers?.find(rv=>rv.user_id===myId);
    if(myRev&&myRev.state==='pending'&&(t.status==='reviewing'||t.status==='revision_requested'))return true;
    // 내가 관여한 이번 주 완료 (리스트에서는 "완료 가리기" OFF 일 때만, 번호 정본에서는 항상)
    if(includeDone && isDone){
      const involved =
        t.assignee_id===myId ||
        t.request_by_user_id===myId ||
        t.created_by===myId ||
        !!myRev;
      if(involved) return true;
    }
    return false;
  },[myId,periodFrom,periodTo]);

  // 우선순위 번호·재인덱스의 정본 집합 (보기 옵션 무관). week 탭 밖에서는 쓰지 않는다.
  const weekSet=useMemo(()=>(
    scope==='mine'&&(tab==='week'||tab==='today') ? allTasks.filter(t=>inWeekCanonical(t,true)) : []
  ),[allTasks,scope,tab,inWeekCanonical]);

  // ── Client-side filtering (no reload) ──
  const filtered=useMemo(()=>{
    let list=allTasks;
    if(scope==='workspace'){
      if(assigneeFilter!=null)list=list.filter(t=>t.assignee_id===assigneeFilter);
    }else{
      if(tab==='today'){
        // 오늘 = 이번 주 정본의 부분집합 (utils/todayTaskSet 단일 술어).
        //   주간 판정을 복사하지 않는다 — 세 번째 미러를 만들면 화면 간 우선순위 번호가 갈린다.
        list=list.filter(t=>inWeekCanonical(t,!hideCompletedInWeek)&&inTodaySet(t,todayStr,myId,wsTz,!hideCompletedInWeek));
      }
      if(tab==='week'){
        // 사용자: 기간(periodFrom~periodTo) 기준으로 업무 리스트 + 가용시간 매칭
        // 기간 안에 들어오는 task 중에서 내가 행동해야 하거나 기간 안에 완료한 것.
        // 판정은 canonical 과 **같은 함수** — 다른 건 완료 표시 여부뿐이다.
        list=list.filter(t=>inWeekCanonical(t,!hideCompletedInWeek));
      }
      if(tab==='all')list=list.filter(t=>t.assignee_id===myId||(t.reviewers||[]).some(rv=>rv.user_id===myId));
      if(tab==='requested')list=list.filter(t=>(t.request_by_user_id===myId)||(t.created_by===myId&&t.assignee_id!=null&&t.assignee_id!==myId));
    }
    if(search){const q=search.toLowerCase();list=list.filter(t=>t.title.toLowerCase().includes(q)||(t.Project?.name||'').toLowerCase().includes(q));}
    if(statusFilter)list=list.filter(t=>t.status===statusFilter);
    // #250 태그 필터 — 보기 옵션이다. 위 weekSet(정본)에는 관여하지 않는다.
    if(tagFilter!=null)list=list.filter(t=>(t.tags||[]).some(tg=>tg.id===tagFilter));
    // week 탭은 자체 hideCompletedInWeek 로직을 위 위에서 처리. 다른 탭만 일괄 hideCompleted 적용.
    if(hideCompleted && !(scope==='mine'&&(tab==='week'||tab==='today')))list=list.filter(t=>t.status!=='completed'&&t.status!=='canceled');

    // Sort — 기본 복합 정렬: priority_order → due_date → title (nulls-last)
    // 사용자가 특정 컬럼 클릭 시 그 키가 주 정렬, 동률은 priority→due→title 로 tie-break
    list=[...list].sort((a,b)=>{
      // 완료/취소는 항상 맨 아래 (Irene: "완료업무는 맨 아래")
      //   ★ 2026-08-24 — 옛 조건은 week 탭만이라 **오늘 탭에서는 완료가 리스트 사이사이에 끼어** 있었다
      //     (Irene: "완료가 왜 리스트 사이사이에 나와. 맨 아래로 빠져야지").
      //     두 탭 모두 같은 규칙이다 — 완료는 읽을 순서의 끝이다.
      if(scope==='mine'&&(tab==='week'||tab==='today')){
        const aDone=a.status==='completed'||a.status==='canceled';
        const bDone=b.status==='completed'||b.status==='canceled';
        if(aDone&&!bDone)return 1;
        if(!aDone&&bDone)return -1;
      }
      // 1) 주 정렬 (사용자 선택)
      const va=a[sortKey];const vb=b[sortKey];
      const aNull=va==null||va===''; const bNull=vb==null||vb==='';
      if(aNull&&!bNull)return 1;
      if(!aNull&&bNull)return -1;
      if(!aNull&&!bNull){
        const cmp=typeof va==='string'&&typeof vb==='string'
          ?(sortDir==='asc'?va.localeCompare(vb):vb.localeCompare(va))
          :(sortDir==='asc'?(Number(va)-Number(vb)):(Number(vb)-Number(va)));
        if(cmp!==0)return cmp;
      }
      // 2) tie-break: priority_order asc (null last)
      if(sortKey!=='priority_order'){
        const pa=a.priority_order, pb=b.priority_order;
        if(pa!=null&&pb==null)return -1;
        if(pa==null&&pb!=null)return 1;
        if(pa!=null&&pb!=null&&pa!==pb)return pa-pb;
      }
      // 3) tie-break: due_date asc (null last)
      if(sortKey!=='due_date'){
        const da=a.due_date, db=b.due_date;
        if(da&&!db)return -1;
        if(!da&&db)return 1;
        if(da&&db&&da!==db)return da.localeCompare(db);
      }
      // 4) tie-break: title
      if(sortKey!=='title')return a.title.localeCompare(b.title);
      return 0;
    });
    return list;
  },[allTasks,scope,tab,assigneeFilter,todayStr,myId,search,statusFilter,tagFilter,hideCompleted,sortKey,sortDir,hideCompletedInWeek,periodFrom,periodTo]);

  // (grouped removed — flat list with project column)

  // 키보드 ↑/↓ — 리스트 뷰에서만 활성화
  const taskItemIds=useMemo(()=>filtered.map(t=>t.id),[filtered]);

  // togglePriority 가 latest weekSet 에 접근하기 위한 ref.
  //   ★ filtered 가 아니라 weekSet — 보기 옵션(검색·상태필터·완료가리기)이 DB 재인덱스 범위를
  //     좁히면 그 밖의 task 우선순위와 충돌한다 (inWeekCanonical 주석 참조).
  const weekSetRef=useRef<typeof weekSet>([]);
  useEffect(()=>{weekSetRef.current=weekSet;},[weekSet]);

  // 표시용 우선순위 인덱스 — canonical weekSet 안에서 priority_order 가 있는 task 들 sort 후 1,2,3..로 매핑.
  // DB 컬럼은 글로벌이라 갭(예: 1,2,9,10) 가능. 표시는 항상 연속.
  // ★ 팝아웃 TaskPopoutView.prioMap 과 같은 결과여야 한다 (같은 집합 + 같은 tie-break).
  const displayPriorityMap=useMemo(()=>{
    const m=new Map<number,number>();
    if(!(scope==='mine'&&(tab==='week'||tab==='today')))return m;
    const inWeek=weekSet.filter(t=>t.priority_order!=null);
    inWeek.sort(byPriorityChain);
    inWeek.forEach((t,i)=>m.set(t.id,i+1));
    return m;
  },[weekSet,scope,tab]);

  // 진입 시 갭 자동 정리 (silent) — 사용자가 토글 안 해도 DB가 1,2,3..로 일치.
  //   #250 ②청크: 옛 코드는 여기서 task 마다 PUT 을 쐈다. 서버가 정본 집합을 원자적으로
  //   재인덱스하는 엔드포인트 **1회 호출**로 대체한다(멱등 — 이미 1..N 이면 UPDATE 0건).
  //   ★ dep 에 weekSet 을 넣지 말 것 — reindex → task:updated N건 → allTasks 갱신 →
  //     weekSet 재계산 → effect 재발화 → reindex … 무한 사이클이 된다.
  //     기간/탭/스코프가 바뀔 때만 한 번 돈다. (서버가 changed=0 이면 broadcast 도 안 한다)
  useEffect(()=>{
    if(!(scope==='mine'&&(tab==='week'||tab==='today')))return;
    if(!bizId)return;
    let cancelled=false;
    (async()=>{
      const r=await apiFetch('/api/tasks/priority/reindex',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({business_id:bizId,from:periodFrom,to:periodTo}),
      });
      if(!r.ok||cancelled)return;
      const j=await r.json();
      if(!j?.data?.changed)return;   // 멱등 — 바뀐 게 없으면 state 도 안 건드린다
      const map=new Map<number,number|null>((j.data.priorities||[]).map((p:{id:number;priority_order:number|null})=>[p.id,p.priority_order]));
      setAllTasks(prev=>prev.map(t=>(map.has(t.id)?{...t,priority_order:map.get(t.id)??null}:t)));
    })();
    return()=>{cancelled=true;};
  },[scope,tab,bizId,periodFrom,periodTo]);

  // 지연 뱃지 quick chip — outside click + ESC 닫기
  useEffect(()=>{
    if(delayChipsForId==null)return;
    const close=()=>setDelayChipsForId(null);
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};
    document.addEventListener('click',close);
    document.addEventListener('keydown',onKey);
    return()=>{
      document.removeEventListener('click',close);
      document.removeEventListener('keydown',onKey);
    };
  },[delayChipsForId]);

  // 지연 마감 빠른 갱신 — addDays=0 이면 오늘로
  const extendDue=useCallback((taskId:number,addDays:number)=>{
    const target=addDays===0?todayStr:addDaysStr(todayStr,addDays);
    saveTaskField(taskId,'due_date',target);
    setDelayChipsForId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[todayStr]);

  // AI 예측시간 추천 — 호출 → input 자동 fill + 1초 flash + DB 저장
  const requestAiEstimate=useCallback(async(taskId:number)=>{
    setAiEstLoading(prev=>({...prev,[taskId]:true}));
    try{
      const r=await apiFetch(`/api/tasks/${taskId}/estimate/ai`,{method:'POST',headers:{'Content-Type':'application/json'}});
      const j=await r.json();
      if(!r.ok||!j.success)return;
      const v=Number(j.data.value);
      if(!Number.isFinite(v))return;
      // 입력값 채우기 + DB 저장 (saveField → user 이력 자동 기록)
      saveField(taskId,'estimated_hours',v);
      setAiEstFlash(prev=>({...prev,[taskId]:true}));
      window.setTimeout(()=>setAiEstFlash(prev=>{const n={...prev};delete n[taskId];return n;}),1200);
    }catch{/* ignore */}
    finally{setAiEstLoading(prev=>{const n={...prev};delete n[taskId];return n;});}
  },[]);
  useListKeyboardNav<number>({
    itemIds:taskItemIds,
    activeId:detailTaskId,
    onChange:(id)=>{ setDetailTaskId(id); const sp=new URLSearchParams(location.search); sp.set('task',String(id)); navigate(`${location.pathname}?${sp.toString()}`,{replace:true}); },
    enabled:viewMode==='list',
    itemSelector:(id)=>`[data-qtask-row="${id}"]`,
  });

  // Summary — 시간/진행율은 담당자만 입력. 합산 정책:
  //  mine 뷰: 본인이 assignee 인 task 만 합산 (= 본인이 직접 처리하는 시간)
  //  workspace 뷰: 모든 task 의 담당자 시간 합산
  // 다른 담당자의 시간은 화면 task 행에 참고용으로 표시 (read-only).
  // #206 V1 — 보류해서 주간 목록에서 빠진 "내 담당" 업무 수. 주간 탭에서만 의미가 있다.
  //   allTasks 기준(주간 필터를 이미 통과 못 한 것들을 세야 하므로 filtered 로는 셀 수 없다).
  const myHoldCount=useMemo(()=>allTasks.filter(t=>t.status==='on_hold'&&t.assignee_id===myId).length,[allTasks,myId]);
  const goToHeldTasks=useCallback(()=>{ setTab('all'); setStatusFilter('on_hold'); },[setTab]);

  const summary=useMemo(()=>{
    let est=0,act=0;
    for(const t of filtered){
      if(t.status==='canceled') continue;
      if(scope==='workspace'){
        est += Number(t.estimated_hours)||0;
        act += Number(t.actual_hours)||0;
      }else{
        // mine: 내가 담당자인 것만
        if(t.assignee_id===myId){
          est += Number(t.estimated_hours)||0;
          act += Number(t.actual_hours)||0;
        }
      }
    }
    // ★ 2026-08-24 (Irene) — "업무 00건, 요청 00건" 으로 표시.
    //   업무 = 담당자가 나 / 요청 = 담당자가 내가 아닌데 목록에 있는 것(= 내가 컨펌해야 할 확인 요청.
    //   utils/todayTaskSet ⑦ 분기가 그것만 끌어온다). 둘의 합이 화면에 보이는 행 수와 같아야
    //   "리스트는 13개인데 헤더는 10건" 같은 어긋남이 생기지 않는다.
    const mineCount = filtered.filter(t=>t.assignee_id===myId).length;
    const reqCount = filtered.length - mineCount;
    return {
      count: filtered.length,
      mineCount, reqCount,
      myEst: Math.round(est*10)/10,
      reqEst: 0,
      est: Math.round(est*10)/10,
      act: Math.round(act*10)/10,
    };
  },[filtered,myId,scope]);

  // 우측 "이번 주 마무리" 패널 카운트 — "내 할 일(action-pending)" 기준
  // - 받은 업무요청에서 내 할 일: assignee=me && action-pending (task_requested 미ack 또는 revision_requested)
  // - 보낸 업무요청에서 내 할 일: request_by=me && status=reviewing && 내 reviewer pending (내가 컨펌해야 함)
  // ※ 탭 뱃지는 여기가 아니라 badgeCounts 가 만든다 — 뱃지는 "그 탭 목록의 크기" 라는 다른 잣대다(#297).
  //    이 값들을 탭 뱃지로 재사용하면 오늘(목록 크기) 과 이번 주(액션 수) 가 다른 자를 쓰게 된다.
  const panelCounts=useMemo(()=>{
    let received=0,sent=0,review=0;
    const receivedList:TaskRow[]=[], sentList:TaskRow[]=[], reviewList:TaskRow[]=[];
    for(const t of allTasks){
      if(t.assignee_id===myId){
        const ds=displayStatus(t,todayStr);
        if(ds==='task_requested'||t.status==='revision_requested'){received++;receivedList.push(t);}
      }
      // 내가 컨펌자(reviewer)이고 pending — 컨펌해야 할 일 (확인 요청 받음)
      const myRev=t.reviewers?.find(rv=>rv.user_id===myId);
      if(myRev&&myRev.state==='pending'&&(t.status==='reviewing'||t.status==='revision_requested')){
        review++; reviewList.push(t);
      }
      // 내가 요청자(requester)이고 status=reviewing — 내가 의뢰한 것의 컨펌 진행
      // 단, 내가 그 업무의 pending 컨펌자이면 '확인 요청 받음'(review)이 내 실제 액션 버킷이므로
      // '보낸 업무요청'(sent)에 중복 표시하지 않는다 (한 업무 = 한 버킷). 컨펌자가 아니거나
      // 이미 내 컨펌을 끝낸(approved/revision) 경우에만 내가 의뢰한 것을 watching 으로 표시.
      const isRequester=(t.request_by_user_id===myId)||(t.created_by===myId&&t.assignee_id!=null&&t.assignee_id!==myId);
      if(isRequester&&t.status==='reviewing'){
        if(!myRev||myRev.state!=='pending'){sent++;sentList.push(t);}
      }
    }
    return{received,sent,review,receivedList,sentList,reviewList};
  },[allTasks,myId,todayStr]);
  // 탭 뱃지 = **그 탭 목록의 미완료 건수** (완료분 제외: "남은 일" 이 신호다).
  //
  // #297 "오늘 나의 업무가 15인데 어떻게 이번 주 나의 업무가 1이야?"
  //   오늘 뱃지만 목록 크기였고, 나머지는 "내 할 일(action-pending)" 이라는 **다른 잣대**를 쓰고 있었다
  //   (week=받은+보낸+컨펌 합, all=Q Talk 추출 후보 수). 오늘 ⊆ 이번 주 인데 15 vs 1 이 나와
  //   사용자는 "지연 업무가 주간 탭에서 빠지나?" 로 읽었다 — 목록은 멀쩡했고 **뱃지가 딴 걸 세고 있었다**.
  //   (#237 로 오늘 탭이 들어올 때 기존 탭의 잣대를 같이 훑지 않아 생긴 어긋남.)
  //   이제 네 탭 모두 자기 목록을 센다 → 오늘 ≤ 이번 주 ≤ 내 전체 가 항상 성립한다.
  //   action-pending 신호(panelCounts)는 "이번 주 마무리" 패널에 그대로 있고, 추출 후보 수도
  //   우측 "추출된 업무 (N)" 섹션에 이미 있다 — 신호가 사라지는 게 아니라 제자리로 간다.
  const isOpen=useCallback((t:TaskRow)=>t.status!=='completed'&&t.status!=='canceled',[]);
  const badgeCounts=useMemo(()=>{
    if(scope!=='mine')return{today:0,week:0,all:0,requested:0};
    const week=allTasks.filter(t=>inWeekCanonical(t,false));
    return{
      today: week.filter(t=>inTodaySet(t,todayStr,myId,wsTz,false)).length,
      week: week.length,
      // 내 전체업무 탭 목록과 같은 술어 (담당자=나 또는 내가 컨펌자)
      all: allTasks.filter(t=>isOpen(t)&&(t.assignee_id===myId||(t.reviewers||[]).some(rv=>rv.user_id===myId))).length,
      // 요청하기 탭 목록과 같은 술어 (내가 의뢰했거나, 내가 만들어 남에게 맡긴 것)
      requested: allTasks.filter(t=>isOpen(t)&&((t.request_by_user_id===myId)||(t.created_by===myId&&t.assignee_id!=null&&t.assignee_id!==myId))).length,
    };
  },[allTasks,scope,inWeekCanonical,todayStr,myId,wsTz,isOpen]);


  // WORK_FLOW §6 — 가용시간 비교는 잔여(remainingTotal) 기반으로 일원화 (전체 예측 totalMyEst 폐기).
  //   "요청한 task 는 다른 사람 가용시간" 분리 유지(내 assignee 만). 잔여 = 예측×(1−진행률).

  // Project progress — mine=내가 담당한 업무만 집계, workspace=모든 업무 집계
  const projProg=useMemo(()=>{
    const m=new Map<string,{total:number;sum:number}>();
    const source=scope==='workspace'?allTasks:allTasks.filter(x=>x.assignee_id===myId);
    for(const t of source){
      const n=t.Project?.name;if(!n)continue;
      if(!m.has(n))m.set(n,{total:0,sum:0});const p=m.get(n)!;p.total++;p.sum+=t.progress_percent||0;
    }
    return m;
  },[allTasks,myId,scope]);

  const effectiveCapacity=Math.round(capacity.daily*(capacity.days-holidayDays)*capacity.rate*10)/10;

  // WORK_FLOW §6 — 잔여(remaining) 기반 부하 + 이월(carried) 도출.
  //  잔여 = 예측 × (1 − 진행률) — 거의 끝난 carried-over 업무가 가용을 거짓으로 잡아먹는 왜곡 제거.
  //  이월 = 활성 단계(in_progress~) 이면서 표시 주 시작(periodFrom) 이전에 생성됨 → 지난 주에서 넘어온 업무(derived, 복제 0).
  const taskRemaining=useCallback((t:TaskRow)=>Math.max(0,(Number(t.estimated_hours)||0)*(1-(t.progress_percent||0)/100)),[]);
  // #206 external_review 는 활성 단계(이월 대상). on_hold 는 이번 주 목록에서 빠지므로 여기서도 제외.
  const isCarried=useCallback((t:TaskRow)=>(
    (t.status==='in_progress'||t.status==='reviewing'||t.status==='revision_requested'||t.status==='waiting'||t.status==='external_review')
    && (t.createdAt||'').slice(0,10) < periodFrom
  ),[periodFrom]);
  // 부하 구성 — 내 활성 업무의 잔여를 이월/이번주 신규로 분해 (가용시간 인지 핵심)
  // ★ 집합 = 이번 주 정본 ∩ **담당자=나** (Irene 2026-08-24 명시: "담당자=나 당연하지.
  //   리스트에 담당자 나 아닌 걸 왜 내 업무정보에 넣어"). 내 시간·내 진척이므로 남의 담당 업무는
  //   컨펌자로 관여해도 이 수치에 넣지 않는다. 이 조건을 제거하지 말 것.
  const chartWeekTasks=useMemo(()=>(
    scope==='mine' ? allTasks.filter(t=>inWeekCanonical(t,true)&&t.assignee_id===myId&&t.status!=='canceled') : []
  ),[allTasks,scope,myId,inWeekCanonical]);

  // ★ 카드도 **그래프와 같은 집합**(chartWeekTasks = 이번 주 정본 ∩ 담당자=나)을 읽는다.
  //   옛 코드는 `filtered`(보기 옵션 반영)를 써서 대각선 종점(계획=Σ예측시간)과 카드의 '계획' 이
  //   서로 다른 수가 됐다. 같은 이름의 값은 한 집합에서 나와야 한다.
  const loadBreakdown=useMemo(()=>{
    let carried=0, fresh=0, done=0, doneCarried=0, plan=0;
    for(const t of chartWeekTasks){
      // ★ 2026-08-24 — 완료 업무를 여기서 걸러 **계획·진척에서 통째로 빠뜨리고 있었다.**
      //   운영 실측(irene): 계획 완료포함 75.0h vs 제외 55.5h · 진척 19.1h vs 0.3h — 완료 6건이 사라졌다.
      //   그래서 카드(55.5)와 그래프 대각선(75.0)이 갈라졌고, "완료했는데 진척이 안 오른다" 로 보였다.
      //   계획은 완료해도 줄지 않는다(Irene 2026-08-21: "완료하면 시간이 줄어들어버리면 안되지").
      //   완료 제외는 **남은 일** 계산에만 적용한다(완료는 남은 일이 아니다).
      if(t.status==='canceled') continue;
      // 진척(누적) — 남은 일과 **같은 집합·같은 기준**이어야 한다. 분모(남은 일)는 이월을 포함하는데
      //   분자(진척)만 "이번 주 증가분" 이면 한 카드 안에서 자가 두 개가 된다
      //   (Irene 2026-08-24: 주가 바뀌자 진척만 0 이 됐다 — "지연된 업무도 예측시간이 다 들어가야").
      const est=Number(t.estimated_hours)||0;
      plan+=est;                       // 계획 = 모든 예측시간 (완료분 포함) — 카드의 기준선
      const d=Math.max(0, est*((t.progress_percent||0)/100));
      if(d>0){ done+=d; if(isCarried(t)) doneCarried+=d; }
      if(t.status==='completed') continue;   // 남은 일에서만 제외
      const rem=taskRemaining(t); if(rem<=0) continue;
      if(isCarried(t)) carried+=rem; else fresh+=rem;
    }
    carried=Math.round(carried*10)/10; fresh=Math.round(fresh*10)/10;
    return {
      carried, fresh, total:Math.round((carried+fresh)*10)/10,
      done:Math.round(done*10)/10, doneCarried:Math.round(doneCarried*10)/10,
      plan:Math.round(plan*10)/10,
    };
  },[chartWeekTasks,taskRemaining,isCarried]);
  const remainingTotal=loadBreakdown.total;
  // #100 — 남은 예측(Σ예측×미완료)이 가용시간을 넘으면 오버커밋 → 칩을 경고색+초과분 표시.
  //   "가용시간 인지"(§6) 핵심: 계획이 캐파를 초과했음을 즉시 알려 마감 지연 예방.
  // ★ 2026-08-24 (Irene) — 초과 판정 축을 **계획(Σ예측)** 으로. 카드와 상단 칩이 같은 기준을 쓴다.
  //   남은 일 기준이면 진행률을 올리는 것만으로 초과 경고가 사라져 "계획이 캐파를 넘었다" 는 사실이 가려진다.
  const planOverHours=Math.round((loadBreakdown.plan-effectiveCapacity)*10)/10;
  const isOverCap=scope!=='workspace'&&effectiveCapacity>0&&planOverHours>0;

  // ★ 2026-08-24 (Irene: "바꾸자마자 저장해서 바로 반영이 안되고 느려. 실시간 반영 부탁해")
  //   옛 흐름은 **왕복 2회**(멤버목록 조회 → PATCH)를 모두 기다린 뒤에야 숫자를 바꿨다.
  //   → ①내 member row id 는 load 에서 이미 받아 캐시했으므로 목록 재조회를 없앤다
  //     ②화면은 **즉시** 바꾸고(낙관적), 저장이 실패하면 되돌린다. 자동저장 규약(성공 토스트 금지)과 정합.
  const applyCapacity=(field:string,value:number)=>{
    if(field==='daily_work_hours')setCapacity(prev=>({...prev,daily:value,weekly:Math.round(value*prev.days*prev.rate*10)/10}));
    if(field==='weekly_work_days')setCapacity(prev=>({...prev,days:value,weekly:Math.round(prev.daily*value*prev.rate*10)/10}));
    if(field==='participation_rate')setCapacity(prev=>({...prev,rate:value,weekly:Math.round(prev.daily*prev.days*value*10)/10}));
    if(field==='weekly_holidays')setHolidayDays(value);
  };
  const saveCapacity=async(field:string,value:number)=>{
    if(!bizId)return;
    const prevCap={...capacity}, prevHol=holidayDays;
    applyCapacity(field,value);                     // ① 즉시 반영 — 기다리지 않는다
    try{
      let memberId=myMemberIdRef.current;
      if(!memberId){                                // 캐시가 없을 때만 1회 조회
        const mr=await(await apiFetch(`/api/businesses/${bizId}/members`)).json();
        const me=mr.data?.find((m:{user_id:number;id:number})=>m.user_id===myId);
        if(!me){ setCapacity(prevCap); setHolidayDays(prevHol); return; }
        memberId=me.id; myMemberIdRef.current=me.id;
      }
      const r=await apiFetch(`/api/businesses/${bizId}/members/${memberId}/work-hours`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({[field]:value}),
      });
      // ★ apiFetch 는 throw 하지 않는다 — res.ok 를 봐야 실패를 안다(memory: apifetch_no_throw).
      if(!r.ok){ setCapacity(prevCap); setHolidayDays(prevHol); }
    }catch{ setCapacity(prevCap); setHolidayDays(prevHol); }
  };

  // ★ #254 — 그래프의 정본 집합. **filtered 파생 금지**: 검색어를 치거나 "완료 가리기" 를 켜면
  //   그래프가 같이 변해서, 보기 옵션이 사실을 바꾸는 상태였다(weekSet 정본 vs filtered 보기 분리 원칙 위반).
  //   탭과도 무관하다 — 어느 탭에서 보든 "이번 주 내 투입" 은 한 값이어야 한다.

  // 주간 진척 그래프 — 번업(0 → 위로 누적 상승, Irene 스펙 2026-06-29):
  //  - estimated_cumulative = Σ(예측시간 × 진행률) 누적 → 예측 진척 라인 (0→base 로 상승, 100% 시 base 도달).
  //  - actual_cumulative   = Σ(실제 입력시간) 누적 → 실제 투입 라인. 가용시간(가로선) 넘으면 그 위로 솟아 초과 시각화.
  //  렌더는 월요일 앞 '시작' 앵커(0h)를 prepend 해 라인이 바닥에서 출발. (EVM 판정칩은 누적값 EV/AC 그대로 사용.)
  //  데이터: /daily-progress 의 est_used(=Σ예측×진행률)·act_used(=Σ실제) 일별 스냅샷 사용, 오늘은 라이브.
  const computedBurndown=useMemo(()=>{
    const days:{label:string;date:string}[]=[];
    const dayNames=[t('weekdayShort.0','일'),t('weekdayShort.1','월'),t('weekdayShort.2','화'),t('weekdayShort.3','수'),t('weekdayShort.4','목'),t('weekdayShort.5','금'),t('weekdayShort.6','토')];
    let cursor=periodFrom;
    while(cursor<=periodTo){
      const [y,m,d]=cursor.split('-').map(Number);
      const dt=new Date(Date.UTC(y,m-1,d));
      days.push({label:dayNames[dt.getUTCDay()],date:cursor});
      cursor=addDaysStr(cursor,1);
    }
    // ★ #254 — 그래프 집합은 정본(chartWeekTasks)이다. filtered 를 쓰면 검색·완료가리기가 사실을 바꾼다.
    const chartTasks=chartWeekTasks;
    // 오늘 라이브 값 (스냅샷은 아침 기준이라 당일 변동 반영 위해 라이브 계산).
    //   ★ 2026-08-24 (Irene 확정) — 두 선은 **같은 축(진행률)** 위에 있다:
    //       진척(예측시간) = 예측시간 × 진행률   /   실제 업무시간 = 실제시간 × 진행률
    //     기준선 차감(Δ)은 걷어냈다 — 실제시간을 아래로 정정하면 Δ 가 0 으로 클램프되어
    //     진행률 100% 인 업무가 그 주 내내 0 만 기여했다(운영 실측 #385).
    //     서버(routes/tasks.js daily-progress)·보고서와 **같은 공식**이다.
    const liveEstDone=chartTasks.reduce((s,t)=>s+(Number(t.estimated_hours)||0)*((t.progress_percent||0)/100),0);
    const liveAct=chartTasks.reduce((s,t)=>s+(Number(t.actual_hours)||0)*((t.progress_percent||0)/100),0);
    const snapMap=new Map(dailyProgress.map(d=>[d.date.slice(0,10),d]));
    const raw=days.map(d=>{
      let estV=0, actV=0;
      const isFuture=d.date>todayStr;
      // ★ "그날 값이 0" 과 "그날 기록이 아예 없다" 는 다른 상태다. 아래 되돌림 판정이 이 둘을
      //   구분해야 한다 — 안 그러면 스냅샷이 빠진 날을 되돌림으로 오탐하거나(옛 게이트가 막던 것),
      //   반대로 진짜 0 으로 떨어진 날을 놓친다(지금 고치는 것).
      let hasData=false;
      // 오늘 actual = max(라이브 actual_hours 합, 백엔드 포커스 누적 라이브) — 진행중 active 포커스도 즉시 반영(운영 #57/#58).
      if(d.date===todayStr){ estV=liveEstDone; actV=Math.max(liveAct, Number(snapMap.get(todayStr)?.act_used||0)); hasData=true; }
      else if(d.date<todayStr){ const s=snapMap.get(d.date); if(s){ estV=Number(s.est_used)||0; actV=Number(s.act_used)||0; hasData=true; } }
      // 미래 = 라인 그리지 않음 (잘림). 주는 "가는 중" 이므로 오늘까지만.
      return{label:d.label,date:d.date,isFuture,hasData,est:Math.round(estV*10)/10,act:Math.round(actV*10)/10};
    });
    // 누적(단조증가) 강제 — 진척·실제는 줄지 않음. 미래는 null (라인 잘림).
    // WORK_FLOW §6 (U4) — 단조완화: 진척이 되돌려진 날(완료→재오픈 등 progress 하락)을 ↓마커로 표면화.
    //   라인 자체는 피크 유지(가독성)하되, 그 날 되돌림이 있었음을 사용자에게 알림.
    let mE=0,mA=0;
    return raw.map(p=>{
      let estReverted=false, actReverted=false;
      if(!p.isFuture && p.hasData){
        // 되돌림 판정은 **기록이 있는 날**에만. 값이 0 이어도 앞서 쌓인 피크보다 낮으면 되돌림이다.
        //   ★ 옛 조건은 `p.est>0` 이었다 — 그래서 하락 폭이 커서 그 주가 통째로 0 으로 클램프되면
        //     ↓마커도 안내 문구도 뜨지 않고 **아무 설명 없는 평평한 0 선**만 남았다.
        //     사용자에겐 "그래프가 죽었다" 로 읽힌다("증가 0" 과 "데이터 없음" 이 같은 화면을 내면 안 된다).
        if(p.est<mE-0.05)estReverted=true; mE=Math.max(mE,p.est);
        if(p.act<mA-0.05)actReverted=true; mA=Math.max(mA,p.act);
      }
      return{
        label:p.label, date:p.date, isFuture:p.isFuture,
        estimated_cumulative: p.isFuture ? null : mE,
        actual_cumulative: p.isFuture ? null : mA,
        reverted: estReverted||actReverted,
      };
    });
  },[chartWeekTasks,periodFrom,periodTo,dailyProgress,todayStr]);

  // 운영 #254/#300 후속 — 그래프가 평평한 0 일 때 **왜** 그런지 가른다.
  //   여태 문구가 "이 기간의 진척 데이터가 없어요" 하나뿐이라, 업무도 있고 기록도 있는데
  //   그 주 증가가 0 인 경우까지 "없다" 고 말했다. 사용자는 그걸 고장으로 읽는다
  //   (#288 "왜 다 없는 거야" 와 같은 계열 — "증가 0" 과 "데이터 없음" 은 다른 상태다).
  //
  //   특히 진행률이 기준(그 주 시작 시점)보다 **내려간** 업무는 Δ 가 0 으로 클램프되어
  //   피크가 아예 안 올라가고, 그래서 되돌림 ↓마커조차 뜨지 않는다 — 설명 없는 평평한 선만 남는다.
  const chartEmptyKind = useMemo<'none'|'noTasks'|'reverted'|'noIncrement'>(()=>{
    const flat = computedBurndown.length>0
      && computedBurndown.every(p=>(p.estimated_cumulative??0)===0 && (p.actual_cumulative??0)===0);
    if(!flat) return 'none';
    if(chartWeekTasks.length===0) return 'noTasks';
    // 지금 진척(예측×진행률)이 그 주 기준선보다 낮은 업무가 있으면 = 진행률이 내려가 클램프된 것
    const baseOf=(id:number)=>progressBases[String(id)]||{act:0,est_done:0};
    const anyBelowBase = chartWeekTasks.some(t=>{
      const now=(Number(t.estimated_hours)||0)*((t.progress_percent||0)/100);
      return now < (baseOf(t.id).est_done||0) - 0.05;
    });
    return anyBelowBase ? 'reverted' : 'noIncrement';
  },[computedBurndown,chartWeekTasks,progressBases]);

  // ★ 2026-08-24 (Irene) — 바가 읽는 값을 **그래프 오늘 점(이번 주 Δ)** 에서
  //   **이번 주 집합의 누적 진척(Σ예측×진행률)** 으로 바꿨다.
  //   주가 바뀌는 순간 Δ 는 구조적으로 0 이 되는데 같은 카드의 '남은 일' 은 이월을 포함한 누적이라,
  //   분자만 리셋되고 분모는 안 되는 상태였다(운영 실측: 남은 57.7h · 실제 13.5h 인데 진척 0.0).
  //   이제 카드 안 세 수가 한 기준이다 — 진척 + 남은 일 = 그 집합의 Σ예측.
  //   그래프는 그대로 Δ(번업) 를 그린다. 이월분을 그래프에 다시 실으면 지난 주 시간이 이번 주 선에
  //   실리던 #254 회귀다 — 두 화면은 **다른 질문**에 답한다(카드=지금 어디까지 / 그래프=이번 주에 얼마나).
  // (옛 주석) 가용시간 바가 **채우는** 값 = 그래프 "진척(예측시간)" 선의 오늘 점.
  //   여태 바는 `남은 일 / 가용시간` 이라 **완료할수록 줄었다** — 24h 는 이번 주에 채워야 할
  //   계획인데 일을 하면 비어가는 셈이었다(Irene: "완료하면 시간이 줄어들어버리면 안되지").
  //   ★ 새 공식을 만들지 않는다 — 차트가 이미 쓰는 정의(Σ예측×진행률의 이번 주 Δ)를 그대로 읽는다.
  //     그래서 **바의 끝점 = 그래프 오늘 점**이 되어 두 화면이 한 이야기를 한다.
  //     (`가용 − 남은 일` 은 여유(headroom)와 같은 수라 계획을 적게 세운 주에 "이미 했다" 는
  //      거짓 표시가 되고, 오버커밋 주엔 음수가 되어 초과 경고와 충돌한다 — Fable 판정으로 기각.)
  // 진척(누적, 이월 포함)은 loadBreakdown.done 이 정본이다 — 카드 보조 줄이 그걸 그대로 읽는다.
  // 그래프 오늘 점(이번 주 Δ) — 카드에서 "이번 주 새로 쌓인 분" 보조 표기에 쓴다.
  const weekDeltaHours=useMemo(()=>{
    const past=computedBurndown.filter(p=>!p.isFuture&&p.estimated_cumulative!=null);
    return past.length?Math.round(Number(past[past.length-1].estimated_cumulative)*10)/10:0;
  },[computedBurndown]);

  // weekTotalEst = Σ예측 = **계획(예측시간)**. chartVerdict(SPI 판정) + 그래프 페이스 대각선의 종점 (Irene 2026-08-24)
  const weekTotalEst=useMemo(()=>(
    Math.round(chartWeekTasks.reduce((s,t)=>s+(Number(t.estimated_hours)||0),0)*10)/10
  ),[chartWeekTasks]);

  // WORK_FLOW §6-C — 그래프 스코핑 키 = 이번 주 차트 대상 업무(내 담당·¬취소) ID 집합(정렬).
  //   ID 집합이 바뀔 때만(주 진입/이탈) 재요청 — 진행률 편집은 같은 집합이라 재요청 안 함.
  const chartTaskIdsKey=useMemo(()=>(
    chartWeekTasks.map(t=>t.id).sort((a,b)=>a-b).join(',')
  ),[chartWeekTasks]);
  useEffect(()=>{
    if(!bizId)return;
    (async()=>{
      try{
        // ★ #254 — scope=mine 이면 **항상** 스코핑한다(집합이 비어도 `&task_ids=`).
        //   빈 값을 안 보내면 서버가 "미지정" 으로 보고 내 전체 업무로 폴백해, 대상 0건인 화면에
        //   전체 누적이 그려진다.
        const idsParam=(scope==='mine')?`&task_ids=${chartTaskIdsKey}`:'';
        const r=await(await apiFetch(`/api/tasks/daily-progress?business_id=${bizId}&from=${periodFrom}&to=${periodTo}${idsParam}`)).json();
        if(r.success){setDailyProgress(r.data?.days||[]);setProgressBases(r.data?.bases||{});}
      }catch{/* ignore */}
    })();
  },[bizId,periodFrom,periodTo,chartTaskIdsKey,scope]);

  // WORK_FLOW §6 (U1) — EVM 신호를 일상어 판정으로 번역.
  //  EV(진척)=오늘 estimated_cumulative, AC(투입)=오늘 actual_cumulative, PV(목표)=weekTotalEst × 경과영업일/총영업일.
  //  SPI=EV/PV(일정), CPI=EV/AC(예산). 전문용어 비노출, 칩+탭설명으로만.
  const chartVerdict=useMemo(()=>{
    const pts=computedBurndown.filter(p=>!p.isFuture);
    const today=pts.length?pts[pts.length-1]:null;
    if(!today||weekTotalEst<=0) return null;
    const ev=today.estimated_cumulative??0;
    const ac=today.actual_cumulative??0;
    if(ev<=0&&ac<=0) return null; // 아직 시작 전 — 칩 숨김
    let elapsedBiz=0;
    for(const p of pts){const[y,m,d]=p.date.split('-').map(Number);const wd=new Date(Date.UTC(y,m-1,d)).getUTCDay();if(wd>=1&&wd<=5)elapsedBiz++;}
    const totalBiz=Math.max(1,(capacity.days||5)-holidayDays);
    const weekProgress=elapsedBiz/totalBiz;
    const pv=weekTotalEst*Math.min(1,weekProgress);
    const spi=ev/Math.max(pv,0.1);
    const cpi=ev/Math.max(ac,0.1);
    let key:'onTrack'|'ahead'|'overBudget'|'behind'|'behindPace', tone:'good'|'warn'|'bad';
    // #166 — '가용 페이스'는 궤적이지 매 시점 합격선이 아니다. 주 초반(경과 40% 미만)엔 SPI 노이즈가 커서
    //   '미달' 완료형 판정을 봉인(중립 진행중). 단 심각(spi<0.6)은 유예 무시. 주중=과정형(behindPace)/주말=결과형(behind).
    if(spi<0.85){
      const serious=spi<0.6;
      if(!serious&&weekProgress<0.4){ key='onTrack'; tone='good'; }
      else if(elapsedBiz<totalBiz){ key='behindPace'; tone=serious?'bad':'warn'; }
      else { key='behind'; tone=serious?'bad':'warn'; }
    }
    else if(cpi<0.85){ key='overBudget'; tone='warn'; }
    else if(spi>1.15){ key='ahead'; tone='good'; }
    else { key='onTrack'; tone='good'; }
    return { key, tone, ev:Math.round(ev*10)/10, ac:Math.round(ac*10)/10 };
  },[computedBurndown,weekTotalEst,capacity.days,holidayDays]);

  if(!bizId)return<EmptyFull>No workspace</EmptyFull>;
  // 로딩 중에 영어 "Loading..." 한 줄만 띄우던 자리. 목록 화면이므로 목록 모양으로 기다린다 —
  //   완료 시 레이아웃이 덜 튀고, 사용자가 "안 눌렸나" 로 읽지 않는다.
  if(loading)return<SkeletonList rows={8}/>;

  const sortIcon=(key:SortKey)=>sortKey===key?(sortDir==='asc'?'↑':'↓'):'';

  return(
    <PanelLayout>
      <Panel $grow $last onMouseDownCapture={(e)=>{
        // 드로어 열린 상태에서 좌측 리스트의 빈 영역 클릭 → 드로어 닫기
        // (행/버튼/입력/캘린더/폼/포털 클릭은 각자 핸들러로 처리되므로 제외)
        if(!detailTaskId&&!addingTask)return;
        const tgt=e.target as HTMLElement;
        if(tgt.closest('[data-task-row],[data-task-add-form],[data-calendar-picker],[data-portal-anchor],button,a,input,select,textarea,label,[role="button"],[role="dialog"],[data-dropdown]'))return;
        // 폼 내부 div(에디터·드롭다운 등) 도 폼 마커 안에 있으므로 위에서 차단됨.
        // 인라인 폼은 자동 닫기 비활성화 — 명시적으로 취소/저장 버튼으로만 닫는다 (Irene: 기간/반복 클릭 시 닫히던 버그 fix).
        if(addingTask&&!addInline){setAddingTask(false);resetNewTask();return;}
        if(detailTaskId){closeDetail();}
      }}>
        {/* Header — 제목 + 스코프 세그먼트 토글 */}
        <Header data-tour="qtask-header">
          <PageTitle>Q task</PageTitle>
          <HelpDot askCue={t('help.cuePrefill','Q task 페이지의 우선순위, 가용시간, 그래프가 어떻게 작동하는지 알려줘') as string} topic="qtask">
            {t('help.body','이번 주 본인이 행동할 업무, 우선순위 클릭 순서대로 매김(필터 안에서만 1,2,3..). 가용시간 = 일×영업일×효율, 그래프 baseline = 헤더의 내 업무 시간. 마감 지나면 지연 뱃지 클릭으로 마감 갱신.')}
          </HelpDot>
          {scope==='mine'&&tab==='week'&&(
            <FinalizeBtn type="button" onClick={()=>setWeeklyReviewModalOpen(true)} title={t('weeklyReview.finalize','이번 주 마무리') as string}>
              <FinalizeIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </FinalizeIcon>
              <FinalizeText>{t('weeklyReview.finalize','이번 주 마무리')}</FinalizeText>
            </FinalizeBtn>
          )}
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
          <ScopeMobileWrap>
            <PlanQSelect size="sm"
              value={{value:scope,label:scope==='mine'?t('scope.mine','내 업무'):t('scope.workspace','전체 업무')}}
              onChange={(v)=>setScope((v as {value:string})?.value as Scope||'mine')}
              options={[{value:'mine',label:t('scope.mine','내 업무')},{value:'workspace',label:t('scope.workspace','전체 업무')}]}
            />
          </ScopeMobileWrap>
        </Header>

        {/* Tabs — 내 업무 모드 (이번 주 내 / 내 전체 / 요청하기 / 지난주 내 업무보고) */}
        {scope==='mine'&&(
          <TabBar>
            <TabBtn type="button" $active={tab==='today'} onClick={()=>setTab('today')}>
              {t('tab.today','오늘 나의 업무')}
              {badgeCounts.today>0&&<TabBadge $active={tab==='today'}>{badgeCounts.today}</TabBadge>}
            </TabBtn>
            <TabBtn type="button" $active={tab==='week'} onClick={()=>setTab('week')}>
              {t('tab.week','이번 주 내 업무')}
              {badgeCounts.week>0&&<TabBadge $active={tab==='week'}>{badgeCounts.week}</TabBadge>}
            </TabBtn>
            <TabBtn type="button" $active={tab==='all'} onClick={()=>setTab('all')}>
              {t('tab.all','내 전체업무')}
              {badgeCounts.all>0&&<TabBadge $active={tab==='all'}>{badgeCounts.all}</TabBadge>}
            </TabBtn>
            <TabBtn type="button" $active={tab==='requested'} onClick={()=>setTab('requested')}>
              {t('tab.requested','요청하기')}
              {badgeCounts.requested>0&&<TabBadge $active={tab==='requested'}>{badgeCounts.requested}</TabBadge>}
            </TabBtn>
            <TabBtn type="button" $active={tab==='weekly-review'} onClick={()=>setTab('weekly-review')}>
              {t('tab.weeklyReviewMine', { defaultValue: '나의 보고서' }) as string}
            </TabBtn>
          </TabBar>
        )}

        {/* 인박스에서 진입한 후보를 못 찾았을 때 안내 띠 (cross-workspace / 이미 처리됨) */}
        {candidateMissing && (
          <CandMissingBar role="status">
            <CandMissingIcon>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </CandMissingIcon>
            <CandMissingBody>
              <CandMissingTitle>{t('candidate.missingTitle', '이 업무 후보를 현재 워크스페이스에서 찾을 수 없습니다')}</CandMissingTitle>
              <CandMissingDesc>{t('candidate.missingDesc', '다른 워크스페이스의 후보이거나 이미 등록·반려되었을 수 있어요. 우측 "추출된 업무" 섹션에서 최신 목록을 확인하세요.')}</CandMissingDesc>
            </CandMissingBody>
            <CandMissingClose type="button" onClick={() => setCandidateMissing(null)} aria-label={t('common.close','닫기') as string}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </CandMissingClose>
          </CandMissingBar>
        )}

        {/* Tabs — 전체 업무 모드 (전체 업무 / 전체 주간보고 / 전체 월간보고) */}
        {scope==='workspace'&&(
          <TabBar>
            <TabBtn type="button" $active={tab==='workspace-tasks'} onClick={()=>setTab('workspace-tasks')}>
              {t('tab.workspaceTasks', { defaultValue: '전체 업무' }) as string}
            </TabBtn>
            {canManageReports && (<>
              <TabBtn type="button" $active={tab==='workspace-weekly'} onClick={()=>setTab('workspace-weekly')}>
                {t('tab.workspaceWeekly', { defaultValue: '전체 주간보고' }) as string}
              </TabBtn>
              <TabBtn type="button" $active={tab==='workspace-monthly'} onClick={()=>setTab('workspace-monthly')}>
                {t('tab.workspaceMonthly', { defaultValue: '전체 월간보고' }) as string}
              </TabBtn>
            </>)}
          </TabBar>
        )}

        {/* 보고서 탭 — 본인 (mine 4번째) */}
        {tab==='weekly-review' && bizId && (
          <WeeklyReviewTab businessId={bizId} userId={myId} reviewScope="mine" />
        )}

        {/* 전체 주간/월간 보고 탭 — workspace (owner/admin 전용). 멤버가 URL 강제 시 전체 업무로 폴백 */}
        {tab==='workspace-weekly' && bizId && canManageReports && (
          <WeeklyReviewTab businessId={bizId} userId={myId} reviewScope="workspace" periodType="weekly" canManage={canManageReports} />
        )}
        {tab==='workspace-monthly' && bizId && canManageReports && (
          <WeeklyReviewTab businessId={bizId} userId={myId} reviewScope="workspace" periodType="monthly" canManage={canManageReports} />
        )}

        {/* Cue에게 말하기 바 — 캐주얼 한마디 → AI 업무 즉시 생성 (리스트 탭에서만, 요청하기 제외) */}
        {bizId && ((scope==='mine'&&(tab==='week'||tab==='today'||tab==='all')) || (scope==='workspace'&&tab==='workspace-tasks')) && (
          <CueTaskBar
            businessId={bizId}
            projectId={null}
            members={members.map(m=>({user_id:m.user_id,name:m.name}))}
            /* 일반 추가 폼(위 defaultDue)과 **같은 규칙**. 여기가 비어 있어서 Cue 로 만든 업무가
               방금 만든 그 목록에서 바로 사라졌다(Irene). 기본값의 정의는 한 곳에서만 바뀌게 둔다. */
            defaults={tabCreateDefaults}
            onCreated={()=>{ /* socket task:new 가 리스트 자동 반영 */ }}
          />
        )}

        {/* 일반 탭 — 기존 리스트 (week/all/requested/workspace-tasks/scope=workspace 기본) */}
        {tab!=='weekly-review' && tab!=='workspace-weekly' && tab!=='workspace-monthly' && (
          <ListScroll>
          {/* Filter bar — 테이블과 함께 스크롤 */}
          <FilterBar>
            <SearchBox placeholder={t('search','Search tasks...') as string} value={search} onChange={setSearch} width={200} size="md" />
            <div style={{minWidth:140}}>
              <PlanQSelect size="sm" isClearable
                placeholder={t('filter.allStatus','All status')}
                value={statusFilter?{value:statusFilter,label:t(`status.${statusFilter}.observer`,statusFilter)}:null}
                onChange={(v)=>setStatusFilter((v as {value?:string})?.value||'')}
                options={STATUS_CODES.filter(k=>k!=='task_requested'&&k!=='done_feedback').map(k=>({value:k,label:t(`status.${k}.observer`,k)}))} />
            </div>
            {/* #250 태그 필터 — isClearable 이 "전체"(CLAUDE.md 필터 규칙). 태그가 없는 워크스페이스엔
                죽은 컨트롤을 두지 않는다. ★ 보기 옵션이라 우선순위 정본 집합에는 관여하지 않는다. */}
            {tagDict.length>0&&(
              <div style={{minWidth:150}}>
                <PlanQSelect size="sm" isClearable maxMenuHeight={280}
                  placeholder={t('filter.allTags','전체 태그')}
                  value={tagFilter==null?null:{value:String(tagFilter),label:tagDict.find(g=>g.id===tagFilter)?.name||'-'}}
                  onChange={(v)=>setTagFilter((v as {value?:string})?.value?Number((v as {value:string}).value):null)}
                  options={tagDict.map(g=>({value:String(g.id),label:g.name}))} />
              </div>
            )}
            {/* #250 — 태그 사전 관리(이름 변경·삭제). 필터 옆에 두는 이유: 사용자가 태그 목록을
                보는 바로 그 자리다. 생성은 업무 상세의 TagPicker 가 담당한다. */}
            {/* 팝아웃 열기 — 여태 우하단 도크에만 있어서 정작 업무 화면에서 여는 길이 없었다 (Irene) */}
            <OpenTaskPopoutButton />
            {/* 헤더의 '태그 관리' 버튼은 제거했다 (Irene 2026-08-24) — 행의 + 메뉴 하단에서 연다.
                + 는 "이 업무에 붙이기", 관리는 "사전 자체(이름 변경·삭제)" 로 하는 일이 다르지만
                둘 다 태그 일이라 한 자리에 모으는 편이 헤더도 가볍고 찾기도 쉽다. */}
            {scope==='workspace'&&(
              <div style={{minWidth:160}}>
                <PlanQSelect size="sm" isClearable maxMenuHeight={280}
                  placeholder={t('workspace.allMembers','전체 멤버')}
                  value={assigneeFilter==null?null:{value:String(assigneeFilter),label:(members.find(m=>m.user_id===assigneeFilter)?.name||'-')+(assigneeFilter===myId?` ${t('common.meSuffix',{defaultValue:'(나)'}) as string}`:'')}}
                  onChange={(v)=>setAssigneeFilter((v as {value?:string})?.value?Number((v as {value:string}).value):null)}
                  options={members.map(m=>({value:String(m.user_id),label:m.name+(m.user_id===myId?` ${t('common.meSuffix',{defaultValue:'(나)'}) as string}`:'')}))} />
              </div>
            )}
            {tab!=='week' && tab!=='today' && <HideCheck><input type="checkbox" checked={hideCompleted} onChange={e=>setHideCompleted(e.target.checked)} />{t('filter.hideCompleted','Hide completed')}</HideCheck>}
            {(tab==='week'||tab==='today') && <HideCheck><input type="checkbox" checked={hideCompletedInWeek} onChange={e=>setHideCompletedInWeek(e.target.checked)} />{t('filter.hideCompleted','Hide completed')}</HideCheck>}
            <ChipRow>
              {/* ★ 2026-08-24 (Irene) — 오늘 탭은 건수만. 계획/가용/초과는 **주간 개념**이라
                  (loadBreakdown.plan = 주간 Σ예측, effectiveCapacity = 1일×영업일) 오늘 탭에 붙으면
                  "오늘의 가용" 으로 읽혀 거짓말이 된다. 이번 주 탭은 종전 그대로 둔다(동결 영역). */}
              {tab==='today' ? (
                <Chip data-testid="qtask-today-count">
                  {t('summary.taskReqCount', { n: summary.mineCount, r: summary.reqCount, defaultValue: '업무 {{n}}건, 요청 {{r}}건' })}
                </Chip>
              ) : (<>
              <Chip>{summary.count}{t('summary.unit','개')}</Chip>
              <Chip $teal={!isOverCap} $warn={isOverCap}
                title={(isOverCap
                  ? t('summary.overCapHint', { over: formatHours(planOverHours), defaultValue: '계획한 예측시간이 가용시간을 {{over}}h 초과 — 마감 조정·위임·기간 재배분을 검토하세요.' })
                  : t('summary.remainCapHint','내가 담당자인 활성 업무의 남은 일(예측×미완료) / 주간 가용시간')) as string}>
                {scope==='workspace'
                  ? t('summary.workspacePredict', { est: formatHours(summary.myEst) })
                  : isOverCap
                    ? t('summary.planCapOver2', { plan: formatHours(loadBreakdown.plan), cap: formatHours(effectiveCapacity), over: formatHours(planOverHours), defaultValue: '계획 {{plan}}h / 가용 {{cap}}h · {{over}}h 초과' })
                    : t('summary.planCap2', { plan: formatHours(loadBreakdown.plan), cap: formatHours(effectiveCapacity), defaultValue: '계획 {{plan}}h / 가용 {{cap}}h' })}
              </Chip>
              <Chip $coral title={t('summary.actualHint','') as string}>{t('summary.actual', { act: formatHours(summary.act) })}</Chip>
              </>)}
              {/* #206 V1 — 보류하면 주간 목록에서 사라진다. 사라졌다는 사실 자체를 여기서 말해주지 않으면
                  사용자는 업무가 없어졌다고 느낀다. 클릭하면 전체 탭 + 보류 필터로 착지. */}
              {tab==='week'&&myHoldCount>0&&(
                <Chip as="button" type="button" data-testid="qtask-hold-chip"
                  onClick={goToHeldTasks}
                  title={t('weekHold.emptyCta','보류 업무 보기') as string}
                  style={{background:'#FFEDD5',color:'#9A3412',cursor:'pointer',border:'none'}}>
                  <StatusGlyph code="on_hold" /> {t('weekHold.chip',{n:myHoldCount,defaultValue:'보류 {{n}}'})}
                </Chip>
              )}
            </ChipRow>
            <AiActionButton
              testId="qtask-ai-open"
              onClick={()=>setAiOpen(true)}
              label={t('ai.btnShort','AI')}
              title={t('ai.btnHint','자연어 한 줄로 여러 업무 자동 생성') as string}
            />
            <HeaderAddBtn type="button" data-testid="task-add-btn" onClick={()=>{
              setAddInline(false);                 // 우측 상단 = panel 모드
              setAddingTask(true);
              setNewAssignee(tab==='requested'?null:myId);
            }}>+ {scope==='mine'&&tab==='requested'?t('add.reqBtn','요청 추가'):t('add.btn','업무 추가')}</HeaderAddBtn>
          </FilterBar>

          {/* ★ P0-1 — 저장 실패를 여기서 말한다. 침묵하면 사용자는 "저장됨" 으로 읽는다(#228). */}
          {saveErr&&(
            <SaveErrorBar role="alert" data-testid="qtask-save-error">
              <SaveErrorMark aria-hidden="true">!</SaveErrorMark>
              <span>{saveErr}</span>
              <SaveErrorClose type="button" onClick={()=>setSaveErr(null)}
                aria-label={t('common.close','닫기') as string}>×</SaveErrorClose>
            </SaveErrorBar>
          )}

          {/* Column headers (sortable) */}
          {viewMode==='list'&&(
          <TableHScroll>
          <ColRow>
            {(tab==='week'||tab==='today') && <Col $w="30px" $center onClick={()=>handleSort('priority_order')} data-tour="qtask-priority" title={t('tab.priorityWeeklyHint','주간 우선순위 번호 — 오늘 탭에서는 번호가 건너뛸 수 있어요') as string}>#{sortIcon('priority_order')}</Col>}
            <Col $w="64px" $hideBelow={640} onClick={()=>handleSort('title')}>{t('col.project','Project')}</Col>
            <Col $flex onClick={()=>handleSort('title')}>{t('col.task','Task')} {sortIcon('title')}</Col>
            {scope==='workspace' && <Col $w="90px" $hideBelow={768}>{t('col.assignee','담당자')}</Col>}
            <Col $w="68px" $center $hideBelow={640} onClick={()=>handleSort('status')}>{t('col.status','Status')} {sortIcon('status')}</Col>
            <Col $w="62px" $center $hideBelow={900} onClick={()=>handleSort('estimated_hours')}>{t('col.est','Est(h)')} {sortIcon('estimated_hours')}</Col>
            <Col $w="62px" $center $hideBelow={900} onClick={()=>handleSort('actual_hours')}>{t('col.act','Act(h)')} {sortIcon('actual_hours')}</Col>
            <Col $w="96px" $center $hideBelow={1024} $compactBelow={1280} $wCompact="46px" onClick={()=>handleSort('progress_percent')}>{t('col.progress','Progress')} {sortIcon('progress_percent')}</Col>
            <Col $w="100px" $center $hideBelow={640} onClick={()=>handleSort('due_date')}>{t('col.dates','기간')} {sortIcon('due_date')}</Col>
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
                  <Fragment key={task.id}>
                  <TRow data-task-row data-qtask-row={task.id} $done={task.status==='completed'} $delayed={!!isDelayed} $selected={detailTaskId===task.id}
                    onClick={(e)=>{
                      // 빈 공간 클릭 → 상세 드로어 오픈. 인터랙티브 요소는 제외 (그 요소가 자체 핸들러 실행)
                      const tgt=e.target as HTMLElement;
                      if(tgt.closest('button,a,input,select,textarea,[role="button"],[data-dropdown]'))return;
                      openDetail(task.id);
                    }}
                    style={{cursor:'pointer'}}>

                    {(tab==='week'||tab==='today') && (
                      <TCell $w="30px" $center>
                        <PrioNum $active={!!task.priority_order} $disabled={task.status==='completed'||task.status==='canceled'}
                          disabled={prioBusy}
                          onClick={e=>{e.stopPropagation();if(task.status!=='completed'&&task.status!=='canceled')togglePriority(task.id);}}>
                          {displayPriorityMap.get(task.id)||<PrioEmpty />}
                        </PrioNum>
                      </TCell>
                    )}
                    <TCell $w="80px" $hideBelow={640}>
                      <ProjLabel>{task.Project?.name||'-'}</ProjLabel>
                    </TCell>
                    <TCell $flex>
                      <TaskRowActionMenu
                        onAddBelow={() => { setNewBelowTitle(''); setAddingBelowId(task.id); }}
                        onCopy={async () => {
                          const r = await apiFetch(`/api/tasks/${task.id}/copy`, { method: 'POST' });
                          if (!r.ok) { const j = await r.json().catch(() => ({})); return { ok: false, message: j?.message }; }  // 실패 표면화(onDelete 패턴)
                          return { ok: true };  // socket task:new 자동 반영
                        }}
                        onDelete={async () => {
                          const r = await apiFetch(`/api/tasks/by-business/${bizId}/${task.id}`, { method: 'DELETE' });
                          if (!r.ok) {
                            const j = await r.json().catch(() => ({}));
                            return { ok: false, message: friendlyDeleteError(j?.message, t) };
                          }
                          // 성공: 즉시 제거(optimistic) — socket task:deleted 도 보정
                          setAllTasks(prev => prev.filter(x => x.id !== task.id));
                          return { ok: true };
                        }}
                      />
                      {/* ★ 행 onClick(상세 열기)과 겹쳐 체크가 먹지 않았다 — 클릭을 여기서 끊는다.
                          (mousedown 까지 끊어야 행의 드래그/선택 처리에 삼켜지지 않는다) */}
                      {/* ★ 2026-08-24 (Irene) — "확인요청·컨펌·요청받은 업무는 리스트에서 완료 체크박스가
                          없어야 하는 거 아니야? 내가 마음대로 완료하면 안 되잖아."
                          팝아웃은 이미 quickActionFor 로 판정하고 있었는데 메인 리스트만 전부 체크박스를
                          내주고 있었다. **같은 순수 함수를 공유**한다 — 규칙이 두 벌이면 반드시 갈린다.
                            · 담당자가 아니면        → 체크박스 없음 (컨펌은 상세에서)
                            · reviewer 가 있고 완료  → 잠긴 ☑ (컨펌으로 완료된 건은 여기서 못 되돌린다)
                            · reviewing / 제출 대기  → 체크박스 없음 (재제출은 승인을 리셋한다)
                          자리는 항상 차지한다 — 안 그리면 제목 좌측선이 행마다 어긋난다. */}
                      {(()=>{
                        const qa=quickActionFor(task.status,(task.reviewers||[]).length,task.assignee_id===myId);
                        if(qa==='complete'||qa==='uncheck'){
                          return (
                            <TaskCheck type="checkbox" checked={task.status==='completed'}
                              disabled={completeBlocked(task.status)}
                              data-testid="task-row-check"
                              title={completeBlocked(task.status)?t('hold.completeBlocked','보류 해제 후 완료 처리할 수 있어요') as string:undefined}
                              onClick={e=>e.stopPropagation()}
                              onMouseDown={e=>e.stopPropagation()}
                              onChange={()=>toggleComplete(task)} />
                          );
                        }
                        if(qa==='checked_locked'){
                          return (
                            <TaskCheck type="checkbox" checked readOnly disabled
                              data-testid="task-row-check-locked"
                              title={t('list.checkLocked',{defaultValue:'컨펌으로 완료됨 — 되돌리기는 상세에서'}) as string}
                              onClick={e=>e.stopPropagation()}
                              onMouseDown={e=>e.stopPropagation()} />
                          );
                        }
                        return <CheckSpacer aria-hidden="true" />;
                      })()}
                      {isEditing?(
                        <TitleInput autoFocus value={titleDraft} onChange={e=>setTitleDraft(e.target.value)}
                          onClick={e=>e.stopPropagation()}
                          onMouseDown={e=>e.stopPropagation()}
                          onBlur={()=>{if(titleDraft.trim())saveTitle(task.id,titleDraft.trim());setEditingTitle(null);}}
                          onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();if(e.key==='Escape')setEditingTitle(null);}} />
                      ):(<>
                        {task.has_unread && <UnreadDot title={t('list.hasUnread', { defaultValue: '새 활동(댓글·변경) — 열면 사라집니다' }) as string} />}
                        <TaskTitle role="button" $done={task.status==='completed'}
                          onClick={(e)=>{e.stopPropagation();setEditingTitle(task.id);setTitleDraft(task.title);}}
                          title={t('list.titleClickEdit','클릭하여 업무명 수정') as string}>
                          {task.title}
                        </TaskTitle>
                        {/* #250 "리스트에도 태그들 볼 수 있게 하기로 하지 않았어?" — 메인은 3칩 + `+k`.
                            백엔드가 이름 사전순으로 실어 보내므로 여기서 다시 정렬하지 않는다.
                            #290 — 태그로 걸러 보는 중이면 그 태그는 모든 행이 반드시 갖고 있다(필터 술어가 보장).
                            전 행에 같은 칩이 반복되는 건 정보가 아니라 노이즈 — 그 태그만 빼고 나머지는 남긴다. */}
                        {/* Irene 2026-08-23 — "리스트에서도 태그는 추가되어야 하지 않을까?"
                            여태 리스트의 태그는 읽기 전용 칩이라 하나 붙이려면 업무를 열어야 했다.
                            권한 집합은 백엔드 PUT /:id/tags 의 canEdit(담당자·작성자·owner·admin)과 같다
                            — canEditDatesFor 가 이미 그 집합이라 판정을 두 벌로 만들지 않는다.
                            ★ shownTags 는 필터 중인 태그를 뺀 **표시용**, allTags 가 저장 기준이다. */}
                        {/* ★ 2026-08-24 (Irene) — 칩만 여기. 붙이기 + 는 행 끝 > 화살표 **바로 앞**으로 뺀다.
                            칩 바로 뒤에 두면 칩 개수에 따라 + 의 가로 위치가 행마다 달라져 정신없다. */}
                        <RowTags
                          only="chips"
                          taskId={task.id} bizId={bizId} max={3}
                          shownTags={tagFilter != null ? (task.tags || []).filter(tg => tg.id !== tagFilter) : task.tags}
                          allTags={task.tags}
                          editable={!isClient && canEditDatesFor(task)}
                          dict={tagDict}
                          onManage={()=>setTagManageOpen(true)}
                          onSaved={(tags)=>setAllTasks(prev=>prev.map(x=>x.id===task.id?{...x,tags}:x))}
                          onDictAdd={(tag)=>setTagDict(prev=>prev.some(g=>g.id===tag.id)
                            ? prev
                            : [...prev,{id:tag.id,name:tag.name,color:tag.color??null}].sort((a,b)=>a.name.localeCompare(b.name)))}
                        />
                        {/* WORK_FLOW §6 — 이월 배지: 지난 주에서 넘어온 활성 업무. 과거 이력이 살아있음을 인지시킴. */}
                        {scope==='mine' && (tab==='week'||tab==='today') && isCarried(task) && (
                          <CarriedBadge title={t('list.carriedHint', { h: formatHours(task.actual_hours), defaultValue: '지난주에 시작한 업무예요. 이미 {{h}}h 투입 — 열면 이력·대화·메모 전부 볼 수 있어요.' }) as string}>
                            {t('list.carried','이월')}
                          </CarriedBadge>
                        )}
                        {task.recurrence_rule && (
                          /* Irene 2026-08-24 — 리스트에서는 **아이콘만**. "평일 매일"·"매주 월·수·금" 같은
                             문구가 제목 줄을 밀어 반복 표시가 통째로 아래 줄로 떨어졌다. 규칙 전문은
                             hover(title)와 업무 상세에서 본다. */
                          <RecurChip $iconOnly title={formatRRuleLabel(task.recurrence_rule, task.due_date, t, { short: false })}>
                            <RecurIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="23 4 23 10 17 10"/>
                              <polyline points="1 20 1 14 7 14"/>
                              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                            </RecurIcon>
                          </RecurChip>
                        )}
                        {(() => {
                          // workspace 뷰는 담당자 컬럼이 별도로 있어 chip 중복 → 표시 안 함.
                          // mine 뷰만 본인 관계 표시 (요청자/내가 의뢰한 담당자 등)
                          if(scope==='workspace') return null;
                          // 내가 받은 요청 → 요청자 (로즈)
                          if(task.assignee_id===myId&&(task.source==='internal_request'||task.source==='qtalk_extract')&&task.requester?.name){
                            return <NameChip $type="from" title={t('chip.fromRequester','Requester') as string}>{displayName(task.requester, i18nClient.language)}</NameChip>;
                          }
                          // 내가 보낸 요청 → 담당자 (티일)
                          if((task.request_by_user_id===myId||task.created_by===myId)&&task.assignee?.name&&task.assignee_id!==myId){
                            return <NameChip $type="to" title={t('chip.toAssignee','My requestee') as string}>{displayName(task.assignee, i18nClient.language)}</NameChip>;
                          }
                          return null;
                        })()}
                        {isDelayed&&(()=>{
                          const dueStr=(task.due_date||'').slice(0,10);
                          const days=dueStr?Math.floor((new Date(todayStr).getTime()-new Date(dueStr).getTime())/86400000):0;
                          const severe=days>=7;
                          const label=days>=1?t('status.delayedDays',{d:days}):t('status.delayed','Delayed');
                          // 운영 #279 — 마감 변경 권한이 없으면 지연 뱃지는 표시만 하고 칩을 열지 않는다.
                          //   (열어봐야 저장이 403 이라 "저장 실패" 만 보게 된다)
                          const dueEditable=canEditDatesFor(task);
                          return(
                            <DelayBadgeWrap>
                              <DelayBadge $severe={severe}
                                onClick={e=>{e.stopPropagation();if(!dueEditable)return;setDelayChipsForId(prev=>prev===task.id?null:task.id);}}
                                title={(dueEditable?t('status.delayedHint','클릭하여 마감 변경'):t('list.datesReadOnly','기간은 요청자·담당자·관리자만 변경할 수 있어요')) as string}>
                                {label}
                              </DelayBadge>
                              {dueEditable&&delayChipsForId===task.id&&(
                                <DelayChipPopover onClick={e=>e.stopPropagation()}>
                                  <DelayChip onClick={e=>{e.stopPropagation();extendDue(task.id,1);}}>{t('status.delayQuick.addDay','+1일')}</DelayChip>
                                  <DelayChip onClick={e=>{e.stopPropagation();extendDue(task.id,7);}}>{t('status.delayQuick.addWeek','+1주')}</DelayChip>
                                  <DelayChip onClick={e=>{e.stopPropagation();extendDue(task.id,0);}}>{t('status.delayQuick.today','오늘')}</DelayChip>
                                </DelayChipPopover>
                              )}
                            </DelayBadgeWrap>
                          );
                        })()}
                        {/* 태그 붙이기 — 항상 > 화살표 바로 앞 고정 자리 (위 only="chips" 주석 참조) */}
                        <RowTags
                          only="menu"
                          taskId={task.id} bizId={bizId} max={3}
                          shownTags={task.tags}
                          allTags={task.tags}
                          editable={!isClient && canEditDatesFor(task)}
                          dict={tagDict}
                          onManage={()=>setTagManageOpen(true)}
                          onSaved={(tags)=>setAllTasks(prev=>prev.map(x=>x.id===task.id?{...x,tags}:x))}
                          onDictAdd={(tag)=>setTagDict(prev=>prev.some(g=>g.id===tag.id)
                            ? prev
                            : [...prev,{id:tag.id,name:tag.name,color:tag.color??null}].sort((a,b)=>a.name.localeCompare(b.name)))}
                        />
                      </>)}
                    </TCell>
                    {/* ★ 상세 열기 `>` — **자기 칸**을 갖는다 (Irene 2026-08-31
                        "가로 사이즈가 짧으면 이 화살표가 잘려. 마지막까지 잘리면 안되는 버튼 아니야?").
                        여태 업무명 셀(flex:1 1 0 · overflow:hidden) **안**에 있어서, 제목·뱃지가
                        셀 폭을 넘기면 맨 끝의 이 버튼부터 잘려 나갔다 — 상세를 여는 유일한 버튼인데
                        가로 스크롤로도 닿지 못했다(실측: 리스트 폭이 좁아지면 31px 밖으로 나감).
                        고정폭 칸으로 빼면 업무명 셀이 대신 줄어들어 버튼은 항상 남는다. */}
                    <TCell $w="32px" $center>
                      <DetailBtn
                        $active={detailTaskId===task.id}
                        data-testid="task-open-detail"
                        onClick={e=>{e.stopPropagation();if(detailTaskId===task.id)closeDetail();else openDetail(task.id);}}
                        title={t('detail.open','Open detail')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                      </DetailBtn>
                    </TCell>
                    {scope==='workspace' && (
                      <TCell $w="140px" $hideBelow={768} style={{overflow:'visible'}}>
                        {/* D1 후속 — 담당자 소속(부서·팀)은 hover tooltip 으로 (행 밀집 노이즈 0) */}
                        <div onClick={e=>e.stopPropagation()} title={(()=>{const am=members.find(m=>m.user_id===task.assignee_id);return am?identityText({type:'member',department:am.department,team:am.team},i18nClient.language)||undefined:undefined;})()}>
                          <PlanQSelect size="sm" isClearable
                            placeholder={t('list.assigneePh','담당자') as string}
                            value={task.assignee_id==null ? null : {
                              value: String(task.assignee_id),
                              label: displayName(task.assignee, i18nClient.language) || (members.find(m=>m.user_id===task.assignee_id)?.name || '-'),
                            }}
                            onChange={(v)=>{
                              const uid = (v as {value?:string})?.value ? Number((v as {value:string}).value) : null;
                              const m = members.find(mm=>mm.user_id===uid);
                              // 낙관적 업데이트 — 실패 시 이전 담당자로 원복
                              const prevAssigneeId = task.assignee_id;
                              const prevAssignee = task.assignee;
                              setAllTasks(prev => prev.map(tt => tt.id===task.id
                                ? { ...tt, assignee_id: uid, assignee: uid != null ? { id: uid, name: m?.name || tt.assignee?.name || '-' } : null }
                                : tt));
                              {
                                const revert = () => setAllTasks(prev => prev.map(tt => tt.id===task.id
                                  ? { ...tt, assignee_id: prevAssigneeId, assignee: prevAssignee }
                                  : tt));
                                // apiFetch 는 non-2xx 에 throw 안 함 — .catch 만 두면 403(권한)에 revert 가 안 터진다(거짓 성공).
                                apiFetch(`/api/tasks/by-business/${bizId}/${task.id}`, {
                                  method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ assignee_id: uid }),
                                }).then(r => { if (!r.ok) revert(); }).catch(revert);
                              }
                            }}
                            options={members.map(m=>({value:String(m.user_id),label:m.name+(m.user_id===myId?t('detail.meSuffix',' (나)'):'')}))} />
                        </div>
                      </TCell>
                    )}
                    <TCell $w="68px" $center $hideBelow={640} style={{position:'relative',overflow:'visible'}}>
                      <StatusPill $bg={sc.bg} $fg={sc.fg} $clickable
                        onClick={e=>{e.stopPropagation();setStatusDropdownId(statusDropdownId===task.id?null:task.id);}}
                        title={task.status==='on_hold'&&task.hold_reason ? task.hold_reason : t('list.statusHint','클릭하면 단계 선택')}
                        aria-haspopup="listbox" aria-expanded={statusDropdownId===task.id}
                      ><StatusGlyph code={task.status} /> {_statusLabel}</StatusPill>
                      {statusDropdownId===task.id&&(
                        <StatusDropdown data-dropdown="status">
                          {statusOptionsFor(task).map(s=>{const c=STATUS_COLOR[s as StatusCode]||STATUS_COLOR.not_started;return(
                            <StatusOption key={s} $bg={c.bg} $fg={c.fg} $active={task.status===s}
                              onClick={e=>{e.stopPropagation();changeStatus(task.id,s);setStatusDropdownId(null);}}
                            >{optionLabel(task,s,_role)}</StatusOption>
                          );})}
                        </StatusDropdown>
                      )}
                    </TCell>
                    {(() => {
                      // 시간 컬럼 — task당 1쌍 (담당자 시간). 모든 사용자가 같은 값을 본다.
                      // 편집은 담당자 본인만 가능. 다른 역할은 read-only (참고용).
                      const e = Number(task.estimated_hours)||0;
                      const a = Number(task.actual_hours)||0;
                      const editable = task.assignee_id===myId;
                      return (<>
                        <TCell $w="62px" $center $hideBelow={900}>
                          <EstWrap $flash={!!aiEstFlash[task.id]}>
                            <NumInput key={`e${task.id}-${e}`}
                              type="number" step="0.5" min="0"
                              $ai={task.latest_estimation_source==='ai' && e>0}
                              defaultValue={e?formatHours(e):''} placeholder="-"
                              disabled={!editable}
                              title={
                                task.latest_estimation_source==='ai' && e>0
                                  ? (t('list.aiEstimateHint', { defaultValue: 'AI 자동 예측 — 직접 입력하면 확정됩니다' }) as string)
                                  : (editable ? undefined : (t('list.notMyHours','담당자만 수정 가능 (참고용)') as string))
                              }
                              onClick={ev=>ev.stopPropagation()}
                              onBlur={ev=>{const v=Number(ev.target.value);if(!isNaN(v)&&editable){saveField(task.id,'estimated_hours',v);(ev.target as HTMLInputElement).value=formatHours(v);}}}
                              onKeyDown={ev=>{if(ev.key==='Enter')(ev.target as HTMLInputElement).blur();}} />
                            {task.latest_estimation_source==='ai' && e>0 && (
                              <AiInlineBadge title={t('list.aiEstimateHint', { defaultValue: 'AI 자동 예측' }) as string} aria-hidden="true">
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
                              </AiInlineBadge>
                            )}
                            {editable && e===0 && (
                              <AiSparkBtn type="button" disabled={!!aiEstLoading[task.id]}
                                onClick={ev=>{ev.stopPropagation();requestAiEstimate(task.id);}}
                                title={t('list.aiEstimate','AI 예측시간 추천') as string}
                                aria-label={t('list.aiEstimate','AI 예측시간 추천') as string}>
                                {aiEstLoading[task.id]
                                  ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="9" strokeDasharray="40 16"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>
                                  : <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>}
                              </AiSparkBtn>
                            )}
                          </EstWrap>
                        </TCell>
                        <TCell $w="62px" $center $hideBelow={900}>
                          <ActWrap>
                            <NumInput key={`a${task.id}-${a}-${task.actual_source||'auto'}`}
                              type="number" step="0.5" min="0"
                              $ai={(task.actual_source ?? 'auto') === 'auto' && a > 0}
                              defaultValue={a?formatHours(a):''} placeholder="-"
                              disabled={!editable}
                              title={
                                (task.actual_source ?? 'auto') === 'auto' && a > 0
                                  ? (t('list.actHint', { defaultValue: '진행 시작·완료 시 자동 누적 — 직접 입력하면 확정됩니다' }) as string)
                                  : (editable?undefined:t('list.notMyHours','담당자만 수정 가능 (참고용)') as string)
                              }
                              onClick={ev=>ev.stopPropagation()}
                              onBlur={ev=>{const v=Number(ev.target.value);if(!isNaN(v)&&editable){saveField(task.id,'actual_hours',v);(ev.target as HTMLInputElement).value=formatHours(v);}}}
                              onKeyDown={ev=>{if(ev.key==='Enter')(ev.target as HTMLInputElement).blur();}} />
                            {task.status==='in_progress' && (
                              <InProgressDotMini role="img"
                                title={t('list.inProgressDot', { defaultValue: '진행 중 — 지금 이 업무의 시간이 쌓이고 있어요' }) as string}
                                aria-label={t('list.inProgressDot', { defaultValue: '진행 중 — 지금 이 업무의 시간이 쌓이고 있어요' }) as string} />
                            )}
                          </ActWrap>
                        </TCell>
                      </>);
                    })()}
                    <TCell $w="96px" $hideBelow={1024} $compactBelow={1280} $wCompact="46px">
                      {(() => {
                        const progEditable = task.assignee_id===myId;
                        return (
                          <SliderWrap $disabled={!progEditable}>
                            <SliderTrack><SliderFill $w={prog} $color={sliderColor(task.status)} /></SliderTrack>
                            <SliderRange type="range" min="0" max="100" step="5" value={prog}
                              disabled={!progEditable}
                              title={progEditable?undefined:t('list.notMyProgress','담당자만 수정 가능 (참고용)') as string}
                              onClick={e=>e.stopPropagation()}
                              onChange={e=>{ if(!progEditable) return; setAllTasks(prev=>prev.map(x=>x.id===task.id?{...x,progress_percent:Number(e.target.value)}:x)); }}
                              onMouseUp={e=>{ if(progEditable) saveField(task.id,'progress_percent',Number((e.target as HTMLInputElement).value)); }}
                              onTouchEnd={e=>{ if(progEditable) saveField(task.id,'progress_percent',Number((e.target as HTMLInputElement).value)); }} />
                            <SliderPct>{prog}%</SliderPct>
                          </SliderWrap>
                        );
                      })()}
                    </TCell>
                    <TCell $w="100px" $center $hideBelow={640}>
                      <DateRangeCell start={task.start_date} due={task.due_date}
                        dueColor={dColor}
                        readOnly={!canEditDatesFor(task)}
                        readOnlyHint={t('list.datesReadOnly','기간은 요청자·담당자·관리자만 변경할 수 있어요') as string}
                        onSave={(s,d)=>{ saveTaskFields(task.id,{start_date:s,due_date:d}); }} />
                    </TCell>
                  </TRow>
                  {addingBelowId === task.id && (
                    <QTaskInlineAddRow>
                      <QTaskInlineSpacer />
                      <QTaskInlineInput
                        autoFocus value={newBelowTitle}
                        placeholder={t('list.inlineAddPh', '업무명 입력 (Enter 저장 / Esc 취소)') as string}
                        onChange={e => setNewBelowTitle(e.target.value)}
                        onKeyDown={async e => {
                          if (e.key === 'Enter' && newBelowTitle.trim() && !submittingBelow) {
                            setSubmittingBelow(true);
                            try {
                              const r = await apiFetch('/api/tasks', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  business_id: bizId,
                                  project_id: task.project_id,
                                  title: newBelowTitle.trim(),
                                  assignee_id: myId,
                                  start_date: task.start_date || null,
                                  //   기준 업무의 기간을 물려받되, 그 업무에 날짜가 없으면
                                  //   탭 기본값으로 떨어진다 — 안 그러면 오늘/이번 주 탭에서
                                  //   "아래에 추가" 한 업무가 만들자마자 목록에서 사라진다.
                                  due_date: task.due_date || tabCreateDefaults?.due_date || null,
                                  planned_week_start: task.due_date ? null : (tabCreateDefaults?.planned_week_start || null),
                                }),
                              });
                              if (!r.ok) return;  // 실패 시 입력 유지(폼 보존)
                              setAddingBelowId(null); setNewBelowTitle('');
                            } finally { setSubmittingBelow(false); }
                          }
                          if (e.key === 'Escape') { setAddingBelowId(null); setNewBelowTitle(''); }
                        }}
                        onBlur={() => { if (!newBelowTitle.trim()) setAddingBelowId(null); }}
                      />
                    </QTaskInlineAddRow>
                  )}
                  </Fragment>
                );
          })}
          {/* #206 V1 — 주간이 비었는데 보류가 있으면 "없다"가 아니라 "어디 있는지"를 말해야 한다.
              기본 빈 상태만 두면 삭제된 줄 안다. */}
          {/* ★ 실패를 빈 상태로 위장하지 않는다. 아래 빈 상태들보다 **먼저** 판정한다 —
              순서가 뒤면 "업무를 시작해 보세요" 가 먼저 걸려 오류가 영영 안 보인다. */}
          {loadError&&(
            <EmptyCenterWrap>
            <EmptyState
              icon={
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              }
              title={t('loadError.title','업무를 불러오지 못했습니다')}
              description={t('loadError.desc','잠시 후 다시 시도해 주세요. 계속 안 되면 네트워크 연결을 확인해 주세요.')}
              ctaLabel={t('loadError.retry','다시 시도') as string}
              onCta={()=>{void load();}}
            />
            </EmptyCenterWrap>
          )}
          {!loadError&&filtered.length===0&&tab==='week'&&myHoldCount>0&&(
            <EmptyCenterWrap>
            <EmptyState
              icon={
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="9" y1="4" x2="9" y2="20" /><line x1="15" y1="4" x2="15" y2="20" />
                </svg>
              }
              title={t('weekHold.emptyTitle','이번 주 활성 업무가 없어요')}
              description={t('weekHold.emptyDesc',{n:myHoldCount,defaultValue:'보류 중인 업무 {{n}}건은 전체 탭에 있어요'})}
              ctaLabel={t('weekHold.emptyCta','보류 업무 보기') as string}
              onCta={goToHeldTasks}
              ctaTestId="qtask-hold-empty-cta"
            />
            </EmptyCenterWrap>
          )}
          {!loadError&&filtered.length===0&&!(tab==='week'&&myHoldCount>0)&&(
            <EmptyCenterWrap>
            <EmptyState
              icon={
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              }
              title={t('empty.title','업무를 시작해 보세요')}
              description={<>
                {t('empty.line1','요청을 받고, 배정하고, 결과까지')}
                <br />
                {t('empty.line2','한 화면에서 실행으로 연결됩니다.')}
              </>}
              ctaLabel={scope==='mine'&&tab==='requested'?t('add.reqBtn','요청 추가'):t('add.btn','업무 추가')}
              ctaIcon={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              }
              onCta={()=>{setAddInline(false);setAddingTask(true);setNewAssignee(tab==='requested'?null:myId);}}
              secondaryCtaLabel={t('empty.askCue','Cue 에게 묻기')}
              onSecondaryCta={()=>askCue(t('help.cuePrefill') as string)}
            />
            </EmptyCenterWrap>
          )}
          {filtered.length>0&&!addingTask&&<BottomAddLink type="button" onClick={()=>{setAddInline(true);setAddingTask(true);setNewAssignee(tab==='requested'?null:myId);}}>
            + {scope==='mine'&&tab==='requested'?t('add.reqBtn','요청 추가'):t('add.btn','업무 추가')}
          </BottomAddLink>}
          {/* 인라인 추가 폼 — 표 하단에서 새 행 형태 (사용자: 표 아래에서 추가).
              data-task-add-form 마커: 외부 클릭 핸들러가 폼 내부 클릭을 외부로 인식 안 하도록.  */}
          {addingTask&&addInline&&(
            <InlineAddBox data-task-add-form>
              {/* 제목 — 풀폭 */}
              <AddInput autoFocus={!isPhone} value={newTitle} placeholder={t('add.placeholder','업무명 입력 후 Ctrl+Enter 로 저장')}
                onChange={e=>setNewTitle(e.target.value)}
                onKeyDown={e=>{
                  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();addTask();}
                  if(e.key==='Escape'){setAddingTask(false);setAddInline(false);resetNewTask();}
                }} />
              {/* 필드 한 줄 — 가로 풀폭 활용해 4 항목 펼침 (panel 의 2 행 분리와 차별화) */}
              <AddOptRow>
                <AddOptField>
                  <AddOptLabel>{t('add.project','프로젝트')}</AddOptLabel>
                  <PlanQSelect size="sm" isClearable
                    placeholder={t('add.projectNone','선택')}
                    value={newProjectId==null?null:{value:String(newProjectId),label:projectOptions.find(p=>p.value===String(newProjectId))?.label||'-'}}
                    onChange={(v)=>setNewProjectId((v as {value?:string})?.value?Number((v as {value:string}).value):null)}
                    options={projectOptions} />
                </AddOptField>
                <AddOptField>
                  <AddOptLabel>{t('add.assignee','담당자')}{tab==='requested'&&' *'}</AddOptLabel>
                  <PlanQSelect size="sm" isClearable={tab!=='requested'}
                    placeholder={assigneePlaceholder as string}
                    value={newAssignee==null?null:{
                      value:String(newAssignee),
                      label:(members.find(m=>m.user_id===newAssignee)?.name||addExternals.find(e=>e.user_id===newAssignee)?.name||'-')+(newAssignee===myId?t('detail.meSuffix',' (나)'):''),
                    }}
                    onChange={(v)=>setNewAssignee((v as {value?:string})?.value?Number((v as {value:string}).value):null)}
                    options={[
                      ...members.filter(m=>tab==='requested'?m.user_id!==myId:true)
                        .map(m=>({value:String(m.user_id),label:m.name+(m.user_id===myId?t('detail.meSuffix',' (나)'):'')})),
                      ...addExternals.map(e=>({value:String(e.user_id),label:e.name,icon:<PartnerKindBadge kind={e.kind} size="xs" />})),
                    ]} />
                </AddOptField>
                <AddOptField style={{flex:'1 1 200px'}}>
                  <AddOptLabel>{t('add.dateRange','시작 ~ 마감')}</AddOptLabel>
                  <AddDateTrigger ref={newDateAnchorRefInline} type="button" onClick={()=>setNewDatePickerOpen(v=>!v)}>
                    {(newStartDate||newDueDate)
                      ? formatDateRange(newStartDate,newDueDate)
                      : <AddDatePH>{t('add.dateRangePlaceholder','기간 선택')}</AddDatePH>}
                  </AddDateTrigger>
                  {newDatePickerOpen&&(
                    <CalendarPicker isOpen anchorRef={newDateAnchorRefInline}
                      startDate={newStartDate||newDueDate}
                      endDate={newDueDate||newStartDate}
                      onRangeSelect={(s,d)=>{setNewStartDate(s||'');setNewDueDate(d||'');}}
                      onClose={()=>setNewDatePickerOpen(false)} />
                  )}
                </AddOptField>
                {/* 사이클 N+19 — 요청 탭에서는 예측시간/AI 추천 UI 숨김.
                    estimated_hours 는 담당자만 입력 (PERMISSION_MATRIX §5.7).
                    요청자는 명세만 — description 에 기대 시간 적으면 됨. */}
                {tab!=='requested' && (
                  <AddOptField style={{flex:'0 0 200px'}}>
                    <AddOptLabel>{t('add.estHours','예측(h)')}</AddOptLabel>
                    <AddEstWrap>
                      <AddEstNumberInput type="number" step="0.5" min="0" placeholder="—"
                        value={newEstHours} onChange={e=>{setNewEstHours(e.target.value);setAiEstReason('');}} />
                      <AddEstAiBtn type="button" disabled={!newTitle.trim()||aiEstimating}
                        onClick={handleAiEstimate}
                        title={!newTitle.trim()
                          ? (t('add.estAiNeedTitle','제목 입력 후 클릭하면 AI 가 추천합니다') as string)
                          : (t('add.estAiHint','AI 가 제목·설명으로 예측 시간을 추천합니다') as string)}>
                        {aiEstimating ? '…' : (newEstHours ? t('add.estAiAgain','AI 다시') : t('add.estAi','AI 추천'))}
                      </AddEstAiBtn>
                    </AddEstWrap>
                    {aiEstReason && <AddEstReason title={aiEstReason}>{aiEstReason}</AddEstReason>}
                  </AddOptField>
                )}
                {/* 운영 #236/#250 — 태그를 여기서 고르고 새로 만든다. 사전이 비어 있어도 항상 보인다:
                    이 자리가 유일한 진입점이므로 숨기면 태그 기능 전체가 발견 불가가 된다.
                    (필터·관리 버튼은 고를 게 없으면 죽은 컨트롤이라 계속 숨긴다 — 여기와 역할이 다르다.) */}
                <AddOptField style={{flex:'1 1 220px',minWidth:200}}>
                  <AddOptLabel>{t('add.tags','태그')}</AddOptLabel>
                  <TagPicker
                    bizId={bizId}
                    dict={tagDict}
                    value={tagDict.filter(g=>newTagIds.includes(g.id))}
                    onChange={setNewTagIds}
                    onDictAdd={(tag)=>setTagDict(prev=>prev.some(g=>g.id===tag.id)
                      ? prev
                      // TagPicker 의 TaskTagLite 는 color 가 optional — 사전 state 는 필수라 정규화한다.
                      : [...prev,{id:tag.id,name:tag.name,color:tag.color??null}])}
                  />
                </AddOptField>
              </AddOptRow>
              {/* 반복 토글 + 옵션 — 요청 탭에서는 숨김 (담당자가 ack 후 정함).
                  요청은 일시적, 정기성은 담당자 권한. */}
              {tab!=='requested' && (
                <RecurRow>
                  <RecurToggleLabel>
                    <input type="checkbox" checked={newRecurEnabled} disabled={!newDueDate}
                      onChange={(e)=>setNewRecurEnabled(e.target.checked)} />
                    <span>{t('recur.toggle','반복하기')}</span>
                    {!newDueDate && <RecurHint>{t('recur.needDueDate','반복하려면 마감일이 필요해요')}</RecurHint>}
                  </RecurToggleLabel>
                </RecurRow>
              )}
              {/* 반복 활성 + 마감일 있을 때만 옵션 펼침 */}
              {tab!=='requested' && newRecurEnabled && newDueDate && (
                <InlineRecurRow>
                  <PlanQSelect size="sm"
                    // 운영 #347 — 라벨은 utils/recurrence 단일 원천 (프리셋 추가 시 여기 고칠 일 없음)
                    value={{ value: newRecurPreset, label: presetLabelMap(t as unknown as TFunction, newDueDate)[newRecurPreset] }}
                    onChange={(v)=>{
                      const p=(v as {value?:string})?.value as RecurPreset|undefined;
                      if(!p) return;
                      if(p==='custom'){setShowCustomRecurModal(true);}
                      else{setNewRecurPreset(p);}
                    }}
                    options={(()=>{
                      const labels = presetLabelMap(t as unknown as TFunction, newDueDate);
                      return SELECTABLE_PRESETS.map((k)=>({ value:k, label:labels[k] }));
                    })()} />
                  <PlanQSelect size="sm"
                    value={{
                      value: newRecurEndType,
                      label: newRecurEndType==='never'?t('recur.endTypeNever','계속 반복')
                        : newRecurEndType==='count'?t('recur.endTypeCount','횟수 후 종료')
                        : t('recur.endTypeUntil','특정 날짜까지'),
                    }}
                    onChange={(v)=>{
                      const e=(v as {value?:string})?.value as RecurEndType|undefined;
                      if(e) setNewRecurEndType(e);
                    }}
                    options={[
                      { value:'never', label:t('recur.endTypeNever','계속 반복') },
                      { value:'count', label:t('recur.endTypeCount','횟수 후 종료') },
                      { value:'until', label:t('recur.endTypeUntil','특정 날짜까지') },
                    ]} />
                  {newRecurEndType==='count' && (
                    <AddDateInput type="number" min="1" max="999" style={{width:80}}
                      value={newRecurEndCount} onChange={(e)=>setNewRecurEndCount(e.target.value)} />
                  )}
                  {newRecurEndType==='until' && (
                    <SingleDateField value={newRecurEndUntil}
                      onChange={(d)=>setNewRecurEndUntil(d)} width={140} />
                  )}
                </InlineRecurRow>
              )}
              {/* 설명 — RichEditor (panel 과 동일) */}
              <DescEditorWrap>
                <RichEditor
                  value={newDescription}
                  onChange={setNewDescription}
                  placeholder={t('add.descPlaceholder','업무 설명 — 이미지 붙여넣기·드래그 지원') as string}
                  uploadUrl={bizId ? `/api/files/${bizId}` : undefined}
                  minHeight={100}
                />
              </DescEditorWrap>
              {/* 첨부 토글 + 인라인 펼침 (panel 과 동일) */}
              <AttachToggleRow>
                <AttachToggleBtn type="button" onClick={()=>setShowAttachInline(v=>!v)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                  {showAttachInline ? t('add.attachHide','파일·문서 첨부 닫기') : t('add.attachShow','파일·문서 첨부')}
                  {(newUploads.length+newExistingFileIds.length+newExistingPostIds.length)>0 &&
                    <AttachCount>{newUploads.length+newExistingFileIds.length+newExistingPostIds.length}</AttachCount>}
                </AttachToggleBtn>
              </AttachToggleRow>
              {showAttachInline && bizId && (
                <AttachInlineBox>
                  <AttachmentField
                    businessId={Number(bizId)}
                    uploads={newUploads}
                    onUploadsChange={setNewUploads}
                    existingFileIds={newExistingFileIds}
                    onExistingFileIdsChange={setNewExistingFileIds}
                    includePosts
                    existingPostIds={newExistingPostIds}
                    onExistingPostIdsChange={setNewExistingPostIds}
                  />
                </AttachInlineBox>
              )}
              <AddBtnRow>
                <AddCancelBtn type="button" onClick={()=>{setAddingTask(false);setAddInline(false);resetNewTask();}}>
                  {t('add.cancel','취소')}
                </AddCancelBtn>
                <AddSaveBtn type="button" onClick={addTask}
                  disabled={addingSubmitting||!newTitle.trim()||(tab==='requested'&&!newAssignee)||(newRecurEnabled&&!newDueDate)||(newRecurEnabled&&newRecurEndType==='count'&&(!newRecurEndCount||Number(newRecurEndCount)<1))||(newRecurEnabled&&newRecurEndType==='until'&&!newRecurEndUntil)}>
                  {addingSubmitting?t('add.saving','저장 중...'):t('add.save','추가')}
                </AddSaveBtn>
              </AddBtnRow>
            </InlineAddBox>
          )}
          {showCustomRecurModal && (
            <CustomRecurOverlay onClick={()=>setShowCustomRecurModal(false)}>
              <CustomRecurDialog onClick={(e)=>e.stopPropagation()}>
                <CustomRecurTitle>{t('recur.customTitle','사용자 지정 반복')}</CustomRecurTitle>
                <CustomRecurField>
                  <CustomRecurFieldLabel>{t('recur.customEvery','반복 간격')}</CustomRecurFieldLabel>
                  <CustomRecurInline>
                    <AddDateInput type="number" min="1" max="99" style={{width:80}}
                      value={newRecurCustomEvery} onChange={(e)=>setNewRecurCustomEvery(e.target.value)} />
                    <PlanQSelect size="sm"
                      value={{
                        value: newRecurCustomUnit,
                        label: newRecurCustomUnit==='day'?t('recur.customUnitDay','일')
                          : newRecurCustomUnit==='week'?t('recur.customUnitWeek','주')
                          : newRecurCustomUnit==='month'?t('recur.customUnitMonth','개월')
                          : t('recur.customUnitYear','년'),
                      }}
                      onChange={(v)=>{
                        const u=(v as {value?:string})?.value as RecurCustomUnit|undefined;
                        if(u) setNewRecurCustomUnit(u);
                      }}
                      options={[
                        { value:'day', label:t('recur.customUnitDay','일') },
                        { value:'week', label:t('recur.customUnitWeek','주') },
                        { value:'month', label:t('recur.customUnitMonth','개월') },
                        { value:'year', label:t('recur.customUnitYear','년') },
                      ]} />
                  </CustomRecurInline>
                </CustomRecurField>
                <AddBtnRow>
                  <AddCancelBtn type="button" onClick={()=>setShowCustomRecurModal(false)}>
                    {t('recur.customCancel','취소')}
                  </AddCancelBtn>
                  <AddSaveBtn type="button" onClick={()=>{
                    setNewRecurPreset('custom');
                    setShowCustomRecurModal(false);
                  }}>
                    {t('recur.customSave','적용')}
                  </AddSaveBtn>
                </AddBtnRow>
              </CustomRecurDialog>
            </CustomRecurOverlay>
          )}
          </TableHScroll>
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
                    { key:'external_review', title:t('columnGroup.external_review','외부컨펌중'), color:STATUS_COLOR.external_review,
                      match:(x)=>x.assignee_id===myId&&x.status==='external_review' },
                    { key:'revision', title:t('columnGroup.revision_requested','수정필요'), color:STATUS_COLOR.revision_requested,
                      match:(x)=>x.assignee_id===myId&&displayStatus(x,todayStr)==='revision_requested' },
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
                    { key:'external_review', title:t('columnGroup.external_review','외부컨펌중'), color:STATUS_COLOR.external_review,
                      match:(x)=>x.status==='external_review' },
                    { key:'reviewing_obs', title:t('columnGroup.reviewing_obs','확인진행중'), color:STATUS_COLOR.reviewing,
                      match:(x)=>x.status==='reviewing' },
                    { key:'revision_self', title:t('columnGroup.revision_self','수정중'), color:STATUS_COLOR.revision_requested,
                      match:(x)=>x.status==='revision_requested' },
                    { key:'on_hold', title:t('columnGroup.on_hold','보류'), color:STATUS_COLOR.on_hold,
                      match:(x)=>x.status==='on_hold' },
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
                    { key:'external_review', title:t('columnGroup.external_review','외부컨펌중'), color:STATUS_COLOR.external_review,
                      match:(x)=>x.status==='external_review' },
                    { key:'reviewing_obs', title:t('columnGroup.reviewing_obs','확인진행중'), color:STATUS_COLOR.reviewing,
                      match:(x)=>x.status==='reviewing' },
                    { key:'revision_obs', title:t('columnGroup.revision_obs','수정요청'), color:STATUS_COLOR.revision_requested,
                      match:(x)=>x.status==='revision_requested' },
                    { key:'on_hold', title:t('columnGroup.on_hold','보류'), color:STATUS_COLOR.on_hold,
                      match:(x)=>x.status==='on_hold' },
                    { key:'completed', title:t('columnGroup.completed','완료'), color:STATUS_COLOR.completed,
                      match:(x)=>x.status==='completed' },
                  ];
                }
                // 빈 컬럼(업무 0개) 은 숨김 — 화면 집중도 향상
                const visibleCols=cols.filter(c=>filtered.some(c.match));
                if(visibleCols.length===0){
                  return (
                    <KanbanEmptyBoard>
                      <EmptyState
                        icon={
                          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 11l3 3L22 4" />
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                          </svg>
                        }
                        title={t('empty.title','업무를 시작해 보세요')}
                        description={<>{t('empty.line1','요청을 받고, 배정하고, 결과까지')}<br />{t('empty.line2','한 화면에서 실행으로 연결됩니다.')}</>}
                        ctaLabel={scope==='mine'&&tab==='requested'?t('add.reqBtn','요청 추가'):t('add.btn','업무 추가')}
                        ctaIcon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
                        onCta={()=>{setAddInline(false);setAddingTask(true);setNewAssignee(tab==='requested'?null:myId);}}
                      />
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
                          const myRole=primaryPerspective(getRoles(task,myId));
                          return (
                            <KanbanCard key={task.id} data-task-row $delayed={!!isDelayed} $done={task.status==='completed'} $selected={detailTaskId===task.id} onClick={()=>openDetail(task.id)}>
                              {isDelayed&&<KanbanDelayBadge>{t('status.delayed','Delayed')}</KanbanDelayBadge>}
                              {task.Project?.name&&<KanbanProject>{task.Project.name}</KanbanProject>}
                              <KanbanTitle>
                                {task.title}
                                {(() => {
                                  if(task.assignee_id===myId&&(task.source==='internal_request'||task.source==='qtalk_extract')&&task.requester?.name){
                                    return <NameChip $type="from">{displayName(task.requester, i18nClient.language)}</NameChip>;
                                  }
                                  if((task.request_by_user_id===myId||task.created_by===myId)&&task.assignee?.name&&task.assignee_id!==myId){
                                    return <NameChip $type="to">{displayName(task.assignee, i18nClient.language)}</NameChip>;
                                  }
                                  if(task.assignee?.name&&task.assignee_id!==myId){
                                    return <NameChip $type="observer">{displayName(task.assignee, i18nClient.language)}</NameChip>;
                                  }
                                  return null;
                                })()}
                              </KanbanTitle>
                              <KanbanRoleRow>
                                <KanbanRoleBadge $role={myRole}>{t(`roleBadge.${myRole}`,myRole)}</KanbanRoleBadge>
                                <KanbanStatusText><StatusGlyph code={task.status} /> {getStatusLabel(task,myRole,todayStr,(k,f)=>t(k,f||k))}</KanbanStatusText>
                              </KanbanRoleRow>
                              {/* #206 — 보류 카드는 "왜 멈췄나"가 카드에서 바로 보여야 컬럼을 훑을 때 판단이 된다 */}
                              {task.status==='on_hold'&&task.hold_reason&&(
                                <KanbanHoldReason title={task.hold_reason}>{task.hold_reason}</KanbanHoldReason>
                              )}
                              <KanbanMeta>
                                {task.due_date&&(
                                  <KanbanDue $overdue={!!isDelayed}>{task.due_date.slice(5,10).replace('-','/')}</KanbanDue>
                                )}
                              </KanbanMeta>
                              {prog>0&&(
                                <KanbanProgress><KanbanProgressFill style={{width:`${prog}%`,background:sliderColor(task.status)}}/></KanbanProgress>
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

        </ListScroll>
        )}
      </Panel>

      {/* ════ RIGHT ════ */}
      {/* 우측 패널 접기/펼치기 — 공통 FloatingPanelToggle(뷰포트 변 플로팅, 전 폭 동일 디자인).
          토글은 '인사이트 컬럼(rightWidth)' 전용. 상세 드로어(TaskDetailDrawer, fixed 오버레이,
          폭 drawerWidth)가 열리면 그 위를 덮으므로 토글 숨김 — 닫기는 드로어 자체 CloseBtn 이 담당.
          (혼선 방지: 토글이 rightWidth 만 보고 떠서 drawerWidth 와 어긋나던 회귀 차단) */}
      {!isNarrow && !detailTaskId && !isClient && (
        <FloatingPanelToggle
          side="right"
          open={!rightCollapsed}
          onToggle={()=>setRightCollapsed(v=>!v)}
          offsetOpen={`${rightWidth}px`}
          ariaLabel={`${(rightCollapsed ? t('right.expand','패널 열기') : t('right.collapse','패널 접기')) as string} (⌘/)`}
        />
      )}
      {/* TaskDetailDrawer 는 position:fixed 오버레이 — rightCollapsed 와 무관하게 detailTaskId 만 보고 렌더. */}
      {detailTaskId && bizId && (
        <TaskDetailDrawer
          taskId={detailTaskId}
          bizId={Number(bizId)}
          myId={myId}
          todayStr={todayStr}
          members={members}
          projects={projects}
          width={drawerWidth}
          onWidthChange={(w)=>{setDrawerWidth(w);try{localStorage.setItem('qtask_drawer_width',String(w));}catch{}}}
          onClose={closeDetail}
          onPatch={(patch)=>setAllTasks(prev=>prev.map(t=>t.id===patch.id?({...t,...patch} as TaskRow):t))}
          onRefresh={load}
          onDuplicated={(newId)=>{ openDetail(newId); load(); }}
        />
      )}
      {/* ── 탭별 기본 패널 — 항상 렌더. 상세 드로어는 position:fixed로 덮음. ── */}
      {isNarrow && rightOverlayOpen && <RightPanelBackdrop onClick={()=>setRightOverlayOpen(false)} />}
      {isNarrow && !detailTaskId && (
        <FloatingPanelToggle
          open={rightOverlayOpen}
          onToggle={()=>setRightOverlayOpen((x)=>!x)}
          ariaLabel={t('right.toggle','인사이트 패널 토글') as string}
        />
      )}
      {/* 고객(client)은 우측 대시보드 카드 미표시 — 업무 상세(detailTaskId)일 때만 패널 노출 */}
      {(((!isNarrow && !rightCollapsed) || (isNarrow && rightOverlayOpen)) && (!isClient || !!detailTaskId))&&(
        <RightPanel $w={rightWidth} $overlay={isNarrow}>
          {!isNarrow && !detailTaskId&&<ResizeHandle onMouseDown={startResize} />}
          <RightHeader>
            <RightTitle>
              {scope==='workspace'
                ? t('scope.workspace','전체 업무')
                : tab==='today' ? t('tab.today','오늘 나의 업무')
                : tab==='week' ? t('tab.week','이번 주 내 업무')
                : tab==='requested' ? t('tab.requested','요청하기')
                : t('tab.all','내 전체업무')}
            </RightTitle>
          </RightHeader>
          <RightScroll>
            {(()=>{
              // 공통 인사이트 섹션 — 개인(Period/Capacity/Burndown + 진척+이슈+메모)과
              // 워크스페이스 전체 (진척+이슈+메모) 두 변형을 정의. 각 탭에서 필요한 것만 렌더.
              const projectProgressNode = projProg.size>0 ? (
                <RSection>
                  <RSTitle>{t('projects.title','Project Progress')}</RSTitle>
                  {Array.from(projProg.entries()).map(([n,p])=>{const avg=p.total>0?Math.round(p.sum/p.total):0;return(
                    <PPRow key={n}><PPName>{n}</PPName><PPTrack><PPFill $w={avg}/></PPTrack><PPPct>{avg}%</PPPct></PPRow>
                  );})}
                </RSection>
              ) : null;
              const issuesNode = issues.length>0 ? (
                <RSection><RSTitle>{t('issues.title','Issues')}</RSTitle>
                  {issues.map(i=><IssueCard key={i.id}><IBody>{i.body}</IBody><IMeta>{i.projectName&&<IProjTag>{i.projectName}</IProjTag>}{i.author?.name}</IMeta></IssueCard>)}
                </RSection>
              ) : null;
              const notesNode = notes.length>0 ? (
                <RSection><RSTitle>{t('notes.title','Notes')}</RSTitle>
                  {notes.map(n=><NoteCard key={n.id} $internal={n.visibility==='internal'}><IBody>{n.body}</IBody><IMeta>{n.projectName&&<IProjTag>{n.projectName}</IProjTag>}{n.author?.name}</IMeta></NoteCard>)}
                </RSection>
              ) : null;
              const personalInsights = <>
                <RSection>
                  <RSTitle>{t('period.title','Period')}</RSTitle>
                  <DateTrigger ref={periodAnchorRef} style={{width:'100%',padding:'8px 10px',border:'1px solid #E2E8F0',borderRadius:8,fontSize:'0.8125rem',color:'#0F172A',background:'#FAFBFC'}}
                    onClick={()=>setPeriodPickerOpen(v=>!v)}>
                    {periodFrom.replace(/-/g,'/')} ~ {periodTo.replace(/-/g,'/')}
                  </DateTrigger>
                  {periodPickerOpen&&<CalendarPicker isOpen={periodPickerOpen} startDate={periodFrom} endDate={periodTo} anchorRef={periodAnchorRef}
                    onRangeSelect={(s,e)=>{if(s)setPeriodFrom(s);if(e)setPeriodTo(e);}}
                    onClose={()=>setPeriodPickerOpen(false)} />}
                </RSection>
                <RSection>
                  <RSTitle>{t('capacity.title','가용시간')}</RSTitle>
                  {(() => {
                    // WORK_FLOW §6 — 잔여(남은 일) 기반. 활용률 = 남은 일 ÷ 가용.
                    const pct = utilizationPercent(remainingTotal, effectiveCapacity);
                    const status = utilizationStatus(pct);
                    const color = UTIL_COLOR[status];
                    // 여유(가용 − 남은 일) 행은 삭제했다 (Irene 지시, 2026-08-21).
                    //   이미 쓴 시간을 빼지 않아 "20h 일하고 남은 일 13h" 인 주에도 여유 11h 로 나왔다.
                    //   위 진척 줄이 초과를 말하는데 아래에서 여유가 있다고 해 서로 어긋났다.
                    //   오버커밋 경고는 상단 요약 칩(summary.remainCapOver)이 계속 맡는다.
                    // ★ 2026-08-24 (Irene 지시) — 카드의 큰 수 = **계획(모든 예측시간)** / 가용.
                    //   "계획된 예측시간이라고 해서 모든 예측시간이 나와야 해. 이 시간과 기준이 되는
                    //    가용시간을 맞춰야 하고 00h 초과 경고" — 초과 판정 축이 진척이 아니라 계획이다.
                    //   바는 **남은/계획** 이라 100% 에서 시작해 완료할수록 줄어든다
                    //   ("100% 계획된 시간에서 점점 완료하면서 시간이 주는 거야").
                    //   진척(계획−남은)은 아래 보조 줄에서 말한다.
                    const planTotal = loadBreakdown.plan;
                    const planOver = Math.round((planTotal - effectiveCapacity) * 10) / 10;
                    const planIsOver = effectiveCapacity > 0 && planOver > 0;
                    // ★ 2026-08-24 (Irene) — 100% = 계획(예측시간). 그 안에서 **진척이 차오르고**
                    //   남은(계획−진척)이 줄어든다. 색은 초과여도 포인트 민트 고정 —
                    //   "많이 계획할수록 빨강" 은 진척 지표의 의미를 뒤집는다. 초과는 옆 배지가 말한다.
                    const donePct = planTotal > 0
                      ? Math.max(0, Math.min(100, Math.round((loadBreakdown.done / planTotal) * 100))) : 0;
                    return (
                      <CapDashboard>
                        <CapHeadline>
                          <CapBigNum>
                            <CapTinyLabel>{t('capacity.plannedWork', '계획 (예측시간)')}</CapTinyLabel>
                            <CapUsed style={{color: '#0F766E'}}>{formatHours(planTotal)}</CapUsed>
                            <CapSep>/</CapSep>
                            <CapTotal>{formatHours(effectiveCapacity)}h</CapTotal>
                          </CapBigNum>
                          {planIsOver && (
                            <CapOverChip>
                              {t('capacity.overBy', { h: formatHours(planOver), defaultValue: '{{h}}h 초과' })}
                            </CapOverChip>
                          )}
                        </CapHeadline>
                        {/* 계획 100% 안에서 진척이 차오른다 — 빈 부분이 곧 남은 예측시간.
                            % 는 헤드라인이 아니라 **바 바로 옆**에 둔다 — 무엇의 퍼센트인지가 붙어 있어야 읽힌다
                            (Irene 2026-08-24: "%표시가 그래프에 있어야 하는데 이상한 위치에 있어서 이상해"). */}
                        <CapBarRow>
                          <CapBar><CapBarFill style={{background: '#14B8A6', width: `${donePct}%`}}/></CapBar>
                          <CapBarPct>{donePct}%</CapBarPct>
                        </CapBarRow>
                        <CapRemainingRow>
                          <CapRemainingLabel>{t('capacity.remainingEst', '남은 예측시간')}</CapRemainingLabel>
                          <CapRemainingValue style={{color: color.text}}>{formatHours(remainingTotal)}h</CapRemainingValue>
                        </CapRemainingRow>
                        {/* 진척(계획−남은)은 보조 줄. 이월 업무가 이미 쌓아 둔 분까지 포함한 누적이다. */}
                        {loadBreakdown.done > 0 && (
                          <CapDoneNote>
                            {t('capacity.doneWork', '진척 (예측시간)')} {formatHours(loadBreakdown.done)}h
                            {weekDeltaHours > 0 && (
                              <> · {t('capacity.doneThisWeek', { h: formatHours(weekDeltaHours), defaultValue: '이번 주 새로 {{h}}h' })}</>
                            )}
                          </CapDoneNote>
                        )}
                        {remainingTotal > 0 && (
                          <CapBreakdown>
                            {loadBreakdown.carried > 0 && <CapBreakItem><CapBreakDot $carried/>{t('capacity.carriedLoad', { h: formatHours(loadBreakdown.carried), defaultValue: '이월 {{h}}h' })}</CapBreakItem>}
                            <CapBreakItem><CapBreakDot/>{t('capacity.freshLoad', { h: formatHours(loadBreakdown.fresh), defaultValue: '이번 주 신규 {{h}}h' })}</CapBreakItem>
                          </CapBreakdown>
                        )}
                      </CapDashboard>
                    );
                  })()}
                  <CapSettingsRow>
                    <CapSettingsField>
                      <CapFieldLabel>{t('capacity.daily','하루')}</CapFieldLabel>
                      {/* ★ 운영(Irene 2026-08-24) — "루아는 4시간인데 8시간으로 바뀌어 버려".
                          원인: defaultValue 는 **최초 mount 때만** 반영되는 uncontrolled input 인데,
                          capacity 초기 state 가 8 이고 실제 값(4)은 /api/tasks/my-week 로 **나중에** 온다.
                          그래서 칸은 영원히 8. 같은 줄 4칸 중 key 가 있던 휴일·실작업률만 갱신됐고,
                          key 가 없던 이 둘(하루·영업일)이 정확히 신고된 칸이다 → 값 기반 key 로 재mount.
                          ★ 더 심각했던 것: onBlur 은 값을 안 바꿔도 발화한다 — 8 이 찍힌 칸을 클릭했다
                          나가기만 해도 DB 의 4 를 8 로 **덮어썼다**. 그래서 실제 변경일 때만 저장한다. */}
                      <CapFieldInput key={`daily-${capacity.daily}`} type="number" step="0.5" min="1" max="24"
                        defaultValue={capacity.daily||8}
                        onBlur={e=>{const v=Number(e.target.value);
                          if(!Number.isFinite(v)||v<=0){(e.target as HTMLInputElement).value=String(capacity.daily||8);return;}
                          if(v===capacity.daily)return;   // 안 바꿨으면 저장하지 않는다
                          saveCapacity('daily_work_hours',v);}}
                        onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}} />
                    </CapSettingsField>
                    <CapSettingsField>
                      <CapFieldLabel>{t('capacity.days','영업일')}</CapFieldLabel>
                      <CapFieldInput key={`days-${capacity.days}`} type="number" step="1" min="1" max="7"
                        defaultValue={capacity.days||5}
                        onBlur={e=>{const v=Number(e.target.value);
                          if(!Number.isFinite(v)||v<=0){(e.target as HTMLInputElement).value=String(capacity.days||5);return;}
                          if(v===capacity.days)return;
                          saveCapacity('weekly_work_days',v);}}
                        onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}} />
                    </CapSettingsField>
                    <CapSettingsField>
                      <CapFieldLabel>{t('capacity.holidays','휴일')}</CapFieldLabel>
                      <CapFieldInput key={`hol-${holidayDays}`} type="number" step="1" min="0" max="5" defaultValue={holidayDays}
                        onBlur={e=>{const v=Math.max(0,Number(e.target.value)||0);
                          if(v===holidayDays)return; saveCapacity('weekly_holidays',v);}}
                        onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}} />
                    </CapSettingsField>
                    {/* 실작업률 — 근무시간 중 회의·잡무 제외하고 실제 업무에 쓰는 비율(%). 백엔드 participation_rate(0~1). */}
                    <CapSettingsField>
                      <CapFieldLabel title={t('capacity.participationHint','회의·잡무를 뺀, 근무시간 중 실제 업무에 쓰는 비율. 예: 회의가 많으면 85') as string}>{t('capacity.participation','실작업률 %')}</CapFieldLabel>
                      <CapFieldInput key={`rate-${capacity.rate}`} type="number" step="5" min="10" max="100"
                        defaultValue={Math.round((capacity.rate||1)*100)}
                        title={t('capacity.participationHint','회의·잡무를 뺀, 근무시간 중 실제 업무에 쓰는 비율. 예: 회의가 많으면 85') as string}
                        onBlur={e=>{const v=Math.max(10,Math.min(100,Math.round(Number(e.target.value)||100)));
                          (e.target as HTMLInputElement).value=String(v);
                          if(Math.abs(v/100-(capacity.rate||1))<0.0001)return;   // 안 바꿨으면 저장 안 함
                          saveCapacity('participation_rate',v/100);}}
                        onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}} />
                    </CapSettingsField>
                  </CapSettingsRow>
                  <CapFormulaHint>
                    {t('capacity.formula', {
                      daily: formatHours(capacity.daily||8),
                      days: Math.max(0,(capacity.days||5)-holidayDays),
                      rate: Math.round((capacity.rate||1)*100),
                      total: formatHours(effectiveCapacity),
                      defaultValue: '{{daily}}h × {{days}}일 × {{rate}}% = 주 {{total}}h',
                    })}
                  </CapFormulaHint>
                  {rateSuggestion && (
                    <CapSuggest title={t('capacity.suggestHint', { focus: formatHours(rateSuggestion.focusHours), weeks: rateSuggestion.weeks, defaultValue: '최근 {{weeks}}주 포커스 실측 {{focus}}h 기준. 포커스를 주 업무 추적에 쓸 때 정확합니다.' }) as string}>
                      {t('capacity.suggest', { weeks: rateSuggestion.weeks, pct: rateSuggestion.percent, defaultValue: '최근 {{weeks}}주 실측 {{pct}}%' })}
                      <CapSuggestBtn type="button" onClick={()=>{ saveCapacity('participation_rate', rateSuggestion.percent/100); setRateSuggestion(null); }}>{t('capacity.suggestApply','적용')}</CapSuggestBtn>
                    </CapSuggest>
                  )}
                </RSection>
                <RSection>
                  <RSTitle>{t('chart.weekly','Weekly Progress')}</RSTitle>
                  {chartVerdict && (
                    <VerdictChip $tone={chartVerdict.tone}
                      title={t(`chart.verdict.${chartVerdict.key}.detail`, { ev: formatHours(chartVerdict.ev), ac: formatHours(chartVerdict.ac), defaultValue: '' }) as string}>
                      <VerdictDot $tone={chartVerdict.tone} />
                      {t(`chart.verdict.${chartVerdict.key}.label`, { defaultValue: chartVerdict.key })}
                    </VerdictChip>
                  )}
                  {(()=>{
                    const W=290,H=160,PL=28,PR=8,PT=12,PB=24;
                    const cw=W-PL-PR, ch=H-PT-PB;
                    // 번업(Irene 스펙 2026-06-29): 0 에서 위로 누적 상승. i=0 = 시작 앵커(월요일 앞, 0h), i=1.. = 영업일.
                    //   실제 투입이 가용시간(가로선)을 넘으면 라인이 그 위로 솟구쳐 시각적으로 초과를 알린다.
                    // ★ 2026-08-24 (Irene 확정) — 페이스 대각선은 **계획(Σ예측시간)** 에 맞춰 올라간다.
                    //   종점이 가로 가용선과 만나는 지점은 주마다 다를 수 있다(계획이 가용보다 많거나 적다).
                    //   옛 정의는 종점을 가용시간에 **고정**해, 계획이 가용과 다른 주에도 늘 같은 각도로 그려졌다.
                    //   계획 미설정(Σ예측 0) 시에만 가용으로 폴백 — 대각선이 통째로 사라지는 회귀 방지.
                    const base=weekTotalEst>0?weekTotalEst:(effectiveCapacity||0);
                    const days=computedBurndown;
                    const N=days.length+1;
                    const step=N>1?cw/(N-1):0;
                    // 실제 투입이 가용/예측을 넘으면 그 위로 솟구쳐야 보이므로 maxY 에 실제·예측 누적 최댓값도 포함.
                    const maxAct=Math.max(0,...days.map(p=>p.actual_cumulative==null?0:p.actual_cumulative));
                    const maxEst=Math.max(0,...days.map(p=>p.estimated_cumulative==null?0:p.estimated_cumulative));
                    // base(=가용)로 y축 기준. Σ예측 선제 인플레 제거. 그려진 실데이터(maxAct/maxEst)는
                    //   잘림 방지 위해 유지 — 가용 초과 시 그때만 y축 확장(초과 솟구침 의도 유지).
                    //   y축에는 가용선도 반드시 포함 — 계획이 가용보다 작은 주에 가로 가용선이 잘리면
                    //   "계획이 가용을 넘었는지" 를 눈으로 못 읽는다.
                    const yMaxBase=Math.max(base, effectiveCapacity, maxAct, maxEst, 1);
                    const yMax=Math.ceil(yMaxBase/5)*5||5;
                    const yTicks=[0,yMax/2,yMax];
                    const xPos=(i:number)=>PL+i*step;
                    const yPos=(v:number)=>PT+ch-(v/yMax)*ch;
                    type Pt={x:number;y:number;v:number};
                    // 예측 누적 = Σ예측×진행률. 시작 앵커(0) + 영업일(오늘까지, 미래 잘림). 100% 완료 시 base 도달.
                    const estPts=[{x:xPos(0),y:yPos(0),v:0} as Pt, ...days.map((p,di)=>(
                      p.isFuture||p.estimated_cumulative==null ? null
                        : ({x:xPos(di+1),y:yPos(p.estimated_cumulative),v:Math.round(p.estimated_cumulative*10)/10} as Pt)
                    ))].filter((p):p is Pt=>!!p);
                    // 실제 누적 = Σ실제투입. 가용시간 넘으면 가로선 위로 상승.
                    const actPts=[{x:xPos(0),y:yPos(0),v:0} as Pt, ...days.map((p,di)=>(
                      p.isFuture||p.actual_cumulative==null ? null
                        : ({x:xPos(di+1),y:yPos(p.actual_cumulative),v:Math.round(p.actual_cumulative*10)/10} as Pt)
                    ))].filter((p):p is Pt=>!!p);
                    // 가용시간 초과량 (실제 누적 최댓값 − 가용)
                    const overCap = effectiveCapacity>0 && maxAct>effectiveCapacity ? Math.round((maxAct-effectiveCapacity)*10)/10 : 0;
                    const actOver = overCap>0;
                    return(
                      <ChartSVG viewBox={`0 0 ${W} ${H}`}>
                        {yTicks.map((v,i)=>(
                          <React.Fragment key={i}>
                            <line x1={PL} y1={yPos(v)} x2={W-PR} y2={yPos(v)} stroke="#F1F5F9" strokeWidth="1" />
                            <text x={PL-4} y={yPos(v)+3} fontSize="9" fill="#94A3B8" textAnchor="end">{v}h</text>
                          </React.Fragment>
                        ))}
                        {/* 운영 #50 — 가용시간 기준선 (가로): 1일 업무시간 × (업무일수 - 휴일) × 참여율 = effectiveCapacity */}
                        {effectiveCapacity>0 && (
                          <>
                            <line x1={PL} y1={yPos(effectiveCapacity)} x2={W-PR} y2={yPos(effectiveCapacity)}
                              stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="2,3" />
                            <text x={W-PR} y={yPos(effectiveCapacity)-4} fontSize="8" fill="#B45309" textAnchor="end" fontWeight="700">
                              {t('chart.capacityLine', { h: effectiveCapacity, defaultValue: `가용 ${effectiveCapacity}h` }) as string}
                            </text>
                          </>
                        )}
                        {/* 페이스 대각선 — 시작 0 → 계획(Σ예측시간). 종점이 가용선과 만나는 지점은 주마다 다르다 (Irene 2026-08-24) */}
                        {base>0 && N>1 && (
                          <line x1={xPos(0)} y1={yPos(0)} x2={xPos(N-1)} y2={yPos(base)}
                            stroke="#94A3B8" strokeWidth="1.5" strokeDasharray="4,4" />
                        )}
                        {/* 예측 진척 라인 (오늘까지) */}
                        {estPts.length>1 && <polyline fill="none" stroke="#14B8A6" strokeWidth="2" points={estPts.map(p=>`${p.x},${p.y}`).join(' ')}/>}
                        {/* 실제 투입 라인 (오늘까지) — 가용 초과 시 빨강 강조 */}
                        {actPts.length>1 && <polyline fill="none" stroke={actOver?'#DC2626':'#F43F5E'} strokeWidth="2" strokeDasharray="4,3" points={actPts.map(p=>`${p.x},${p.y}`).join(' ')}/>}
                        {/* 예측 점·값 */}
                        {estPts.map((p,i)=>(
                          <React.Fragment key={'e'+i}>
                            <circle cx={p.x} cy={p.y} r="3" fill="#14B8A6"/>
                            {p.v>0&&<text x={p.x} y={p.y-6} fontSize="8" fill="#0F766E" textAnchor="middle" fontWeight="700">{p.v}</text>}
                          </React.Fragment>
                        ))}
                        {/* 실제 점·값 */}
                        {actPts.map((p,i)=>(
                          <React.Fragment key={'a'+i}>
                            <circle cx={p.x} cy={p.y} r="3" fill={actOver?'#DC2626':'#F43F5E'}/>
                            {p.v>0&&<text x={p.x} y={p.y+12} fontSize="8" fill={actOver?'#DC2626':'#9F1239'} textAnchor="middle" fontWeight="700">{p.v}</text>}
                          </React.Fragment>
                        ))}
                        {/* 가용시간 초과 마커 — 실제 투입이 가용을 넘으면 (라인이 가로선 위로 솟음) */}
                        {overCap>0 && (
                          <g>
                            <title>{t('chart.overTip',{ h: overCap, base: effectiveCapacity, defaultValue: `이번 주 실제 투입이 가용시간(${effectiveCapacity}h)을 ${overCap}h 넘었어요.` }) as string}</title>
                            <text x={W-PR} y={PT+8} fontSize="9" fill="#DC2626" textAnchor="end" fontWeight="800">
                              {t('chart.over',{ h: overCap, defaultValue: `가용 초과 +${overCap}h` }) as string}
                            </text>
                          </g>
                        )}
                        {/* WORK_FLOW §6 (U4) — 되돌림(progress 하락) 마커: 해당 날 상단에 ▽ 표시 */}
                        {days.map((p,i)=>(p.reverted?(
                          <g key={'rv'+i}>
                            <title>{t('chart.revertedTip','이 날 진척이 일부 되돌려졌어요 (완료 취소·진행률 하향). 그래프 선은 최고치를 유지합니다.') as string}</title>
                            <path d={`M${xPos(i+1)-4},${PT+2} L${xPos(i+1)+4},${PT+2} L${xPos(i+1)},${PT+9} Z`} fill="#F59E0B"/>
                          </g>
                        ):null))}
                        {/* 요일 라벨 — i=0 시작 앵커 + 영업일 (미래 포함, 주 구조 표시) */}
                        <text x={xPos(0)} y={H-6} fontSize="10" fill="#94A3B8" textAnchor="middle" fontWeight="600">{t('chart.weekStart','시작') as string}</text>
                        {days.map((p,i)=>(
                          <text key={'d'+i} x={xPos(i+1)} y={H-6} fontSize="10" fill={p.isFuture?'#CBD5E1':'#64748B'} textAnchor="middle" fontWeight="600">{p.label}</text>
                        ))}
                      </ChartSVG>
                    );
                  })()}
                  <Legend>
                    {/* ★ 2026-08-24 (Irene 확정) — 두 선은 같은 축(진행률) 위에 있고, 재는 자만 다르다.
                        진척(예측시간) = Σ(예측시간 × 진행률)  /  실제 업무시간 = Σ(실제시간 × 진행률)
                        목록의 "남은 …h" = Σ(예측×남은비율) 이라 진척과 더하면 Σ예측이 된다(같은 축). */}
                    <LI title={t('chart.estTip','') as string}><Dot $c="#14B8A6"/>{t('chart.est','진척 (예측시간)')}</LI>
                    <LI title={t('chart.actTip','') as string}><Dot $c="#F43F5E"/>{t('chart.act','실제 업무시간')}</LI>
                    <LI><DashDot $c="#94A3B8"/>{t('chart.pace','계획 페이스')}</LI>
                    <LI><DashDot $c="#F59E0B"/>{t('chart.capacity','가용시간')}</LI>
                    {computedBurndown.some(p=>p.reverted)&&(
                      <LI><RevertTri/>{t('chart.reverted','되돌림')}</LI>
                    )}
                  </Legend>
                  <ChartScopeHint>{t('chart.scopeHint','이번 주 · 내가 담당자인 업무 기준. 검색어·완료 가리기 같은 보기 설정에는 영향받지 않습니다.')}</ChartScopeHint>
                  {chartEmptyKind!=='none'&&(
                    <EmptyChart>
                      {chartEmptyKind==='noTasks'
                        ? t('chart.noData','이 기간의 진척 데이터가 없어요')
                        : chartEmptyKind==='reverted'
                          ? t('chart.revertedFlat','이번 주에는 진행률이 기준보다 내려가 진척 증가가 없어요. 그래프는 최고치를 유지합니다.')
                          : t('chart.noIncrement','이 기간에 새로 기록된 진행이 아직 없어요')}
                    </EmptyChart>
                  )}
                </RSection>
                {projectProgressNode}
                {issuesNode}
                {notesNode}
              </>;
              const workspaceInsights = <>
                {projectProgressNode}
                {issuesNode}
                {notesNode}
              </>;
              return <>
            {/* 이번 주: 받은/보낸 업무요청 + 개인 인사이트 — count 0 이면 섹션 자체 숨김 */}
            {scope==='mine'&&(tab==='week'||tab==='today')&&<>
              {panelCounts.received>0&&(
                <RSection>
                  <RSTitle>{t('right.received','받은 업무요청')} ({panelCounts.received})</RSTitle>
                  {panelCounts.receivedList.map(x=>(
                    <CandCard key={`rc-${x.id}`} onClick={()=>openDetail(x.id)} style={{cursor:'pointer'}}>
                      <CandTitle>{x.title}</CandTitle>
                      <IMeta>
                        {x.Project?.name&&<IProjTag>{x.Project.name}</IProjTag>}
                        {x.requester?.name&&<span>{x.requester.name}</span>}
                      </IMeta>
                    </CandCard>
                  ))}
                </RSection>
              )}
              {panelCounts.review>0&&(
                <RSection>
                  <RSTitle>{t('right.review','확인 요청 받음')} ({panelCounts.review})</RSTitle>
                  {panelCounts.reviewList.map(x=>(
                    <CandCard key={`rv-${x.id}`} onClick={()=>openDetail(x.id)} style={{cursor:'pointer'}}>
                      <CandTitle>{x.title}</CandTitle>
                      <IMeta>
                        {x.Project?.name&&<IProjTag>{x.Project.name}</IProjTag>}
                        {x.assignee?.name&&<span>{x.assignee.name}</span>}
                      </IMeta>
                    </CandCard>
                  ))}
                </RSection>
              )}
              {panelCounts.sent>0&&(
                <RSection>
                  <RSTitle>{t('right.sent','보낸 업무요청')} ({panelCounts.sent})</RSTitle>
                  {panelCounts.sentList.map(x=>(
                    <CandCard key={`sc-${x.id}`} onClick={()=>openDetail(x.id)} style={{cursor:'pointer'}}>
                      <CandTitle>{x.title}</CandTitle>
                      <IMeta>
                        {x.Project?.name&&<IProjTag>{x.Project.name}</IProjTag>}
                        {x.assignee?.name&&<span>{x.assignee.name}</span>}
                      </IMeta>
                    </CandCard>
                  ))}
                </RSection>
              )}
              {personalInsights}
            </>}

            {/* 요청하기: 받은/확인/보낸 (이번 주 패턴 그대로) + 피드백 + 개인 인사이트 — 모두 count 0 이면 섹션 자체 숨김 */}
            {scope==='mine'&&tab==='requested'&&<>
              {panelCounts.received>0&&(
                <RSection>
                  <RSTitle>{t('right.received','받은 업무요청')} ({panelCounts.received})</RSTitle>
                  {panelCounts.receivedList.map(x=>(
                    <CandCard key={`req-rc-${x.id}`} onClick={()=>openDetail(x.id)} style={{cursor:'pointer'}}>
                      <CandTitle>{x.title}</CandTitle>
                      <IMeta>
                        {x.Project?.name&&<IProjTag>{x.Project.name}</IProjTag>}
                        {x.requester?.name&&<span>{x.requester.name}</span>}
                      </IMeta>
                    </CandCard>
                  ))}
                </RSection>
              )}
              {panelCounts.review>0&&(
                <RSection>
                  <RSTitle>{t('right.review','확인 요청 받음')} ({panelCounts.review})</RSTitle>
                  {panelCounts.reviewList.map(x=>(
                    <CandCard key={`req-rv-${x.id}`} onClick={()=>openDetail(x.id)} style={{cursor:'pointer'}}>
                      <CandTitle>{x.title}</CandTitle>
                      <IMeta>
                        {x.Project?.name&&<IProjTag>{x.Project.name}</IProjTag>}
                        {x.assignee?.name&&<span>{x.assignee.name}</span>}
                      </IMeta>
                    </CandCard>
                  ))}
                </RSection>
              )}
              {panelCounts.sent>0&&(
                <RSection>
                  <RSTitle>{t('right.sent','보낸 업무요청')} ({panelCounts.sent})</RSTitle>
                  {panelCounts.sentList.map(x=>(
                    <CandCard key={`sr-${x.id}`} onClick={()=>openDetail(x.id)} style={{cursor:'pointer'}}>
                      <CandTitle>{x.title}</CandTitle>
                      <IMeta>
                        {x.Project?.name&&<IProjTag>{x.Project.name}</IProjTag>}
                        {x.assignee?.name&&<span>{x.assignee.name}</span>}
                      </IMeta>
                    </CandCard>
                  ))}
                </RSection>
              )}
              {requestedComments.length>0&&<RSection>
                <RSTitle>{t('right.recentFeedback','Recent feedback')}</RSTitle>
                {requestedComments.map(c=>(
                  <CommentItem key={c.id} onClick={()=>c.Task&&openDetail(c.Task.id)} style={{cursor:'pointer'}}>
                    <CommentHead><strong>{c.author?.name}</strong><span>{c.createdAt?.slice(5,16).replace('T',' ')}</span></CommentHead>
                    {c.Task&&<IProjTag>{c.Task.title}</IProjTag>}
                    <CommentBody>{c.content}</CommentBody>
                  </CommentItem>
                ))}
              </RSection>}
              {personalInsights}
            </>}

            {/* 전체업무: 추출된 업무 (있으면만) + 개인 인사이트 */}
            {scope==='mine'&&tab==='all'&&<>
              {candidates.length>0&&(
                <RSection>
                  <RSTitle>{t('right.candidatesExtracted','추출된 업무')} ({candidates.length})</RSTitle>
                  {/* 운영 #46 — 채팅 후보와 동일한 공유 카드(제목·담당·기간 인라인 편집 + 등록/거절) */}
                  {candidates.map(c=>(
                    <div key={c.id} data-candidate-id={c.id}>
                      <TaskCandidateCard
                        candidate={{
                          id:c.id, title:c.title, description:c.description,
                          guessed_assignee:c.guessedAssignee?{user_id:c.guessedAssignee.id,name:c.guessedAssignee.name}:null,
                          guessed_due_date:c.guessed_due_date,
                        }}
                        members={members.map(m=>({user_id:m.user_id,name:m.name}))}
                        myUserId={myId}
                        onRegister={(id,ov)=>registerCandidate(id,ov)}
                        onReject={(id)=>rejectCandidate(id)}
                      />
                    </div>
                  ))}
                </RSection>
              )}
              {personalInsights}
            </>}

            {/* 전체 워크스페이스 업무: 프로젝트 진척(전체) + 이슈 + 메모 */}
            {scope==='workspace'&&workspaceInsights}
            </>;
            })()}
          </RightScroll>
        </RightPanel>
      )}
      {/* ── 업무 추가 우측 패널 (panel 모드만) ── */}
      {addingTask&&!addInline&&(
        <CreateDrawer
          open
          wide
          onClose={()=>{setAddingTask(false);setAddInline(false);resetNewTask();}}
          title={scope==='mine'&&tab==='requested'?t('add.reqBtn','요청 추가'):t('add.btn','업무 추가')}
          onSubmit={addTask}
          submitting={addingSubmitting}
          submitLabel={t('add.save','추가')}
          submitDisabled={!newTitle.trim()||(tab==='requested'&&!newAssignee)}
        >
            <PanelAddForm>
              <AddInput autoFocus={!isPhone} value={newTitle} placeholder={t('add.placeholder','업무명 입력 후 Ctrl+Enter 로 저장')}
                onChange={e=>setNewTitle(e.target.value)}
                onKeyDown={e=>{
                  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();addTask();}
                  if(e.key==='Escape'){setAddingTask(false);resetNewTask();}
                }} />
              <AddOptRow>
                <AddOptField>
                  <AddOptLabel>{t('add.project','프로젝트')}</AddOptLabel>
                  <PlanQSelect size="sm" isClearable
                    placeholder={t('add.projectNone','선택')}
                    value={newProjectId==null?null:{value:String(newProjectId),label:projectOptions.find(p=>p.value===String(newProjectId))?.label||'-'}}
                    onChange={(v)=>setNewProjectId((v as {value?:string})?.value?Number((v as {value:string}).value):null)}
                    options={projectOptions} />
                </AddOptField>
                <AddOptField>
                  <AddOptLabel>{t('add.assignee','담당자')}{tab==='requested'&&' *'}</AddOptLabel>
                  <PlanQSelect size="sm" isClearable={tab!=='requested'}
                    placeholder={assigneePlaceholder as string}
                    value={newAssignee==null?null:{
                      value:String(newAssignee),
                      label:(members.find(m=>m.user_id===newAssignee)?.name||addExternals.find(e=>e.user_id===newAssignee)?.name||'-')+(newAssignee===myId?t('detail.meSuffix',' (나)'):''),
                    }}
                    onChange={(v)=>setNewAssignee((v as {value?:string})?.value?Number((v as {value:string}).value):null)}
                    options={[
                      ...members.filter(m=>tab==='requested'?m.user_id!==myId:true)
                        .map(m=>({value:String(m.user_id),label:m.name+(m.user_id===myId?t('detail.meSuffix',' (나)'):'')})),
                      ...addExternals.map(e=>({value:String(e.user_id),label:e.name,icon:<PartnerKindBadge kind={e.kind} size="xs" />})),
                    ]} />
                </AddOptField>
              </AddOptRow>
              <AddOptRow>
                <AddOptField style={{flex:'1 1 220px'}}>
                  <AddOptLabel>{t('add.dateRange','시작 ~ 마감')}</AddOptLabel>
                  <AddDateTrigger ref={newDateAnchorRefPanel} type="button" onClick={()=>setNewDatePickerOpen(v=>!v)}>
                    {(newStartDate||newDueDate)
                      ? formatDateRange(newStartDate,newDueDate)
                      : <AddDatePH>{t('add.dateRangePlaceholder','기간 선택')}</AddDatePH>}
                  </AddDateTrigger>
                  {newDatePickerOpen&&(
                    <CalendarPicker isOpen anchorRef={newDateAnchorRefPanel}
                      startDate={newStartDate||newDueDate}
                      endDate={newDueDate||newStartDate}
                      onRangeSelect={(s,d)=>{setNewStartDate(s||'');setNewDueDate(d||'');}}
                      onClose={()=>setNewDatePickerOpen(false)} />
                  )}
                </AddOptField>
                <AddOptField style={{flex:'0 0 200px'}}>
                  <AddOptLabel>{t('add.estHours','예측(h)')}</AddOptLabel>
                  <AddEstWrap>
                    <AddEstNumberInput type="number" step="0.5" min="0" placeholder="—"
                      value={newEstHours} onChange={e=>{setNewEstHours(e.target.value);setAiEstReason('');}} />
                    <AddEstAiBtn type="button" disabled={!newTitle.trim()||aiEstimating}
                      onClick={handleAiEstimate}
                      title={!newTitle.trim()
                        ? (t('add.estAiNeedTitle','제목 입력 후 클릭하면 AI 가 추천합니다') as string)
                        : (t('add.estAiHint','AI 가 제목·설명으로 예측 시간을 추천합니다') as string)}>
                      {aiEstimating ? '…' : (newEstHours ? t('add.estAiAgain','AI 다시') : t('add.estAi','AI 추천'))}
                    </AddEstAiBtn>
                  </AddEstWrap>
                  {aiEstReason && <AddEstReason title={aiEstReason}>{aiEstReason}</AddEstReason>}
                </AddOptField>
              </AddOptRow>
              {/* 정기업무 (반복) — 인라인 폼과 동일. 마감일 있을 때만 활성. */}
              <RecurRow>
                <RecurToggleLabel>
                  <input type="checkbox" checked={newRecurEnabled} disabled={!newDueDate}
                    onChange={(e)=>setNewRecurEnabled(e.target.checked)} />
                  <span>{t('recur.toggle','반복하기')}</span>
                  {!newDueDate && <RecurHint>{t('recur.needDueDate','반복하려면 마감일이 필요해요')}</RecurHint>}
                </RecurToggleLabel>
                {newRecurEnabled && newDueDate && (
                  <RecurOptions>
                    <PlanQSelect size="sm"
                      // 운영 #347 — 라벨은 utils/recurrence 단일 원천 (프리셋 추가 시 여기 고칠 일 없음)
                      value={{ value: newRecurPreset, label: presetLabelMap(t as unknown as TFunction, newDueDate)[newRecurPreset] }}
                      onChange={(v)=>{
                        const p=(v as {value?:string})?.value as RecurPreset|undefined;
                        if(!p) return;
                        if(p==='custom'){setShowCustomRecurModal(true);}
                        else{setNewRecurPreset(p);}
                      }}
                      options={(()=>{
                        const labels = presetLabelMap(t as unknown as TFunction, newDueDate);
                        return SELECTABLE_PRESETS.map((k)=>({ value:k, label:labels[k] }));
                      })()} />
                    <RecurEndBox>
                      <PlanQSelect size="sm"
                        value={{
                          value: newRecurEndType,
                          label: newRecurEndType==='never'?t('recur.endTypeNever','계속 반복')
                            : newRecurEndType==='count'?t('recur.endTypeCount','횟수 후 종료')
                            : t('recur.endTypeUntil','특정 날짜까지'),
                        }}
                        onChange={(v)=>{
                          const e=(v as {value?:string})?.value as RecurEndType|undefined;
                          if(e) setNewRecurEndType(e);
                        }}
                        options={[
                          { value:'never', label:t('recur.endTypeNever','계속 반복') },
                          { value:'count', label:t('recur.endTypeCount','횟수 후 종료') },
                          { value:'until', label:t('recur.endTypeUntil','특정 날짜까지') },
                        ]} />
                      {newRecurEndType==='count' && (
                        <AddDateInput type="number" min="1" max="999" style={{width:64}}
                          value={newRecurEndCount} onChange={(e)=>setNewRecurEndCount(e.target.value)} />
                      )}
                      {newRecurEndType==='until' && (
                        <SingleDateField value={newRecurEndUntil}
                          onChange={(d)=>setNewRecurEndUntil(d)} width={140} />
                      )}
                    </RecurEndBox>
                  </RecurOptions>
                )}
              </RecurRow>
              <DescEditorWrap>
                <RichEditor
                  value={newDescription}
                  onChange={setNewDescription}
                  placeholder={t('add.descPlaceholder','업무 설명 — 이미지 붙여넣기·드래그 지원') as string}
                  uploadUrl={bizId ? `/api/files/${bizId}` : undefined}
                  minHeight={120}
                />
              </DescEditorWrap>
              <AttachToggleRow>
                <AttachToggleBtn type="button" onClick={()=>setShowAttachPanel(v=>!v)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                  {showAttachPanel ? t('add.attachHide','파일·문서 첨부 닫기') : t('add.attachShow','파일·문서 첨부')}
                  {(newUploads.length+newExistingFileIds.length+newExistingPostIds.length)>0 &&
                    <AttachCount>{newUploads.length+newExistingFileIds.length+newExistingPostIds.length}</AttachCount>}
                </AttachToggleBtn>
              </AttachToggleRow>
              {showAttachPanel && bizId && (
                <AttachInlineBox>
                  <AttachmentField
                    businessId={Number(bizId)}
                    uploads={newUploads}
                    onUploadsChange={setNewUploads}
                    existingFileIds={newExistingFileIds}
                    onExistingFileIdsChange={setNewExistingFileIds}
                    includePosts
                    existingPostIds={newExistingPostIds}
                    onExistingPostIdsChange={setNewExistingPostIds}
                  />
                </AttachInlineBox>
              )}
            </PanelAddForm>
        </CreateDrawer>
      )}
      {/* 주간 보고 마무리 모달 */}
      {weeklyReviewModalOpen && bizId && (
        <WeeklyReviewModal
          businessId={bizId}
          wsTz={wsTz}
          onClose={() => setWeeklyReviewModalOpen(false)}
          onSaved={() => {
            setWeeklyReviewModalOpen(false);
            setTab('weekly-review');
          }}
        />
      )}
      {/* #250 태그 사전 관리 — 삭제 시 usage_count 를 보여주고 지운다(백엔드 CASCADE). */}
      <TagManageModal
        bizId={bizId}
        open={tagManageOpen}
        onClose={()=>setTagManageOpen(false)}
        dict={tagDict}
        onChanged={()=>{loadTagDict();load();}}
      />
      {bizId && (
        <AiTaskCreateModal
          open={aiOpen}
          onClose={()=>setAiOpen(false)}
          businessId={bizId}
          projectId={null}
          projects={projects}
          members={members.map(m=>({user_id:m.user_id,name:m.name}))}
          onCreated={()=>{ /* socket task:new 가 자동 반영 */ }}
          onUseTemplate={(id)=>{ setAiOpen(false); setTplSelInitialId(id); setTplSelOpen(true); }}
        />
      )}
      {bizId && (
        <TemplateSelectModal
          open={tplSelOpen}
          onClose={()=>{ setTplSelOpen(false); setTplSelInitialId(null); }}
          businessId={bizId}
          projectId={null}
          members={members.map(m=>({user_id:m.user_id,name:m.name}))}
          onApplied={()=>{ /* socket task:new 가 자동 반영 */ }}
          initialTemplateId={tplSelInitialId}
        />
      )}
    </PanelLayout>
  );
};
export default QTaskPage;

// ═══ Candidate Missing 안내 띠 (인박스에서 진입했으나 후보 못 찾았을 때) ═══
const CandMissingBar = styled.div`
  display: flex; align-items: flex-start; gap: 10px;
  margin: 0 20px 12px; padding: 12px 14px;
  background: #FFFBEB; border: 1px solid #FCD34D; border-radius: 10px;
`;
const CandMissingIcon = styled.span`
  display: inline-flex; flex-shrink: 0;
  width: 24px; height: 24px;
  align-items: center; justify-content: center;
  color: #B45309;
`;
const CandMissingBody = styled.div`flex: 1; min-width: 0;`;
const CandMissingTitle = styled.div`
  font-size: 0.8125rem; font-weight: 700; color: #92400E; margin-bottom: 2px;
`;
const CandMissingDesc = styled.div`font-size: 0.75rem; color: #78350F; line-height: 1.5;`;
const CandMissingClose = styled.button`
  flex-shrink: 0; width: 24px; height: 24px; padding: 0;
  background: transparent; border: none; border-radius: 4px; cursor: pointer;
  color: #92400E;
  display: inline-flex; align-items: center; justify-content: center;
  &:hover { background: rgba(146, 64, 14, 0.1); }
`;

// ═══ Styled ═══
const Header=styled.div`padding:14px 20px;height:60px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #E2E8F0;flex-shrink:0;`;
const PageTitle=styled.h1`font-size:1.125rem;font-weight:700;color:#0F172A;margin:0;flex-shrink:0;letter-spacing:-0.2px;`;
const HideCheck=styled.label`display:flex;align-items:center;gap:4px;font-size:0.75rem;color:#64748B;cursor:pointer;white-space:nowrap;& input{accent-color:#0D9488;}`;
const ChipRow=styled.div`display:flex;gap:4px;margin-left:auto;`;
const Chip=styled.span<{$teal?:boolean;$coral?:boolean;$warn?:boolean}>`padding:2px 8px;font-size:0.6875rem;font-weight:600;border-radius:6px;background:${p=>p.$warn?'#FEF3C7':p.$teal?'#F0FDFA':p.$coral?'#FFF1F2':'#F1F5F9'};color:${p=>p.$warn?'#B45309':p.$teal?'#0F766E':p.$coral?'#9F1239':'#475569'};`;

const TabBar=styled.div`display:flex;border-bottom:1px solid #E2E8F0;flex-shrink:0;@media(max-width:640px){overflow-x:auto;-webkit-overflow-scrolling:touch;&::-webkit-scrollbar{display:none;}}`;
const TabBtn=styled.button<{$active?:boolean}>`flex:1;padding:10px 8px;font-size:0.8125rem;font-weight:600;border:none;cursor:pointer;background:transparent;color:${p=>p.$active?'#0F766E':'#94A3B8'};border-bottom:2px solid ${p=>p.$active?'#14B8A6':'transparent'};display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;@media(max-width:640px){flex:none;padding:10px 12px;font-size:0.75rem;}`;
const FinalizeBtn=styled.button`display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:6px;font-size:0.8125rem;font-weight:600;color:#475569;cursor:pointer;transition:background 0.15s, border-color 0.15s;&:hover{background:#F8FAFC;border-color:#CBD5E1;color:#0F172A;}@media(max-width:640px){padding:6px 10px;}`;
const FinalizeIcon=styled.svg`width:16px;height:16px;flex-shrink:0;`;
const FinalizeText=styled.span`@media(max-width:640px){display:none;}`;
const TabBadge=styled.span<{$active?:boolean}>`display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 6px;border-radius:8px;background:${p=>p.$active?'#F43F5E':'#CBD5E1'};color:#FFF;font-size:0.6875rem;font-weight:700;line-height:1;`;
const ListScroll=styled.div`flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;&::-webkit-scrollbar{width:6px;}&::-webkit-scrollbar-thumb{background:#E2E8F0;border-radius:3px;}`;
const TableHScroll=styled.div`overflow-x:auto;overflow-y:visible;overscroll-behavior-x:contain;&::-webkit-scrollbar{height:6px;}&::-webkit-scrollbar-thumb{background:#E2E8F0;border-radius:3px;}`;
const BottomAddLink=styled.button`margin:10px 14px 20px;padding:6px 0;background:transparent;color:#94A3B8;border:none;font-size:0.8125rem;font-weight:500;cursor:pointer;text-align:left;display:block;font-family:inherit;&:hover{color:#0F766E;}`;
// #250 태그 관리 진입 — FilterBar 안의 보조 버튼. 기존 FinalizeBtn 톤을 그대로(bespoke 금지).
const FilterBar=styled.div`display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #F1F5F9;background:#FFF;flex-wrap:wrap;`;

const ColRow=styled.div`display:flex;align-items:center;gap:6px;padding:6px 14px;border-bottom:1px solid #E2E8F0;background:#F8FAFC;position:sticky;top:0;z-index:1;min-width:520px;@media(max-width:640px){min-width:0;padding:6px 10px;}`;
const Col=styled.span<{$w?:string;$flex?:boolean;$center?:boolean;$hideBelow?:number;$compactBelow?:number;$wCompact?:string}>`
  box-sizing:border-box;
  ${p=>p.$flex
    ? 'flex:1 1 0;min-width:180px;'
    : `flex:0 0 ${p.$w||'auto'};width:${p.$w||'auto'};`}
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:0.6875rem;font-weight:700;color:#94A3B8;cursor:pointer;user-select:none;
  ${p=>p.$center&&'display:inline-flex;justify-content:center;align-items:center;gap:4px;text-align:center;'}
  &:hover{color:#475569;}
  ${p=>p.$hideBelow?`@media (max-width: ${p.$hideBelow}px){display:none;}`:''}
  ${p=>p.$compactBelow&&p.$wCompact?`@media (max-width: ${p.$compactBelow}px){flex:0 0 ${p.$wCompact};width:${p.$wCompact};}`:''}
`;


const TRow=styled.div<{$done?:boolean;$delayed?:boolean;$selected?:boolean}>`display:flex;align-items:center;gap:6px;padding:7px 14px;border-bottom:1px solid #F8FAFC;min-width:520px;@media(max-width:640px){min-width:0;padding:8px 10px;}opacity:${p=>p.$done?0.45:1};${p=>p.$selected?'background:#F0FDFA;box-shadow:inset 3px 0 0 #14B8A6;':p.$delayed&&!p.$done?'box-shadow:inset 3px 0 0 #DC2626;':''}&:hover{background:${p=>p.$selected?'#CCFBF1':p.$delayed&&!p.$done?'#FEF2F2':'#FAFBFC'};}`;
const TCell=styled.div<{$w?:string;$flex?:boolean;$center?:boolean;$hideBelow?:number;$compactBelow?:number;$wCompact?:string}>`
  box-sizing:border-box;
  ${p=>p.$flex
    // #249 — 업무명 셀 최소폭 상향(180→240). 배지들이 shrink 불가라 180px 에서는
    //   업무명 몫이 20~30px(한글 1~2자)까지 압사했다.
    ? 'flex:1 1 0;min-width:240px;display:flex;align-items:center;gap:6px;overflow:hidden;'
    : `flex:0 0 ${p.$w||'auto'};width:${p.$w||'auto'};overflow:hidden;`}
  ${p=>p.$center&&'display:flex;justify-content:center;align-items:center;'}
  ${p=>p.$hideBelow?`@media (max-width: ${p.$hideBelow}px){display:none;}`:''}
  ${p=>p.$compactBelow&&p.$wCompact?`@media (max-width: ${p.$compactBelow}px){flex:0 0 ${p.$wCompact};width:${p.$wCompact};}`:''}
`;
const ProjLabel=styled.span`font-size:0.6875rem;color:#94A3B8;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;`;
const DelayBadge=styled.span<{$severe?:boolean}>`
  padding:1px 6px;font-size:0.5625rem;font-weight:700;border-radius:4px;flex-shrink:0;white-space:nowrap;
  cursor:pointer;user-select:none;transition:background 120ms ease,border-color 120ms ease,color 120ms ease;
  color:${p=>p.$severe?'#fff':'#DC2626'};
  background:${p=>p.$severe?'#DC2626':'#FEF2F2'};
  border:1px solid ${p=>p.$severe?'#DC2626':'#FECACA'};
  &:hover{
    background:${p=>p.$severe?'#B91C1C':'#FEE2E2'};
    border-color:${p=>p.$severe?'#B91C1C':'#FCA5A5'};
  }
  &:focus-visible{outline:2px solid #F43F5E;outline-offset:1px;}
`;
const DelayBadgeWrap=styled.span`position:relative;display:inline-flex;flex-shrink:0;`;
const DelayChipPopover=styled.div`
  position:absolute;top:calc(100% + 4px);left:0;
  display:flex;gap:4px;
  background:#fff;border:1px solid #E2E8F0;border-radius:6px;
  padding:4px;box-shadow:0 4px 12px rgba(15,23,42,0.08);
  z-index:200;white-space:nowrap;
`;
const DelayChip=styled.button`
  padding:4px 10px;font-size:0.6875rem;font-weight:600;
  color:#475569;background:#F1F5F9;
  border:none;border-radius:4px;cursor:pointer;
  transition:background 120ms ease,color 120ms ease;
  &:hover{background:#E2E8F0;color:#0F172A;}
`;
const TaskCheck=styled.input`accent-color:#0D9488;cursor:pointer;width:15px;height:15px;flex-shrink:0;`;
// 체크박스를 내주지 않는 행의 자리 유지 — 안 그리면 제목 좌측선이 행마다 어긋난다.
const CheckSpacer=styled.span`width:15px;height:15px;flex-shrink:0;display:inline-block;`;
// 저장 실패 배너 — UI_DESIGN_GUIDE §1.3 (에러는 인라인, alert 금지)
const SaveErrorBar=styled.div`
  display:flex;align-items:center;gap:8px;
  margin:0 12px 8px;padding:8px 12px;
  background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;
  font-size:0.75rem;color:#991B1B;line-height:1.5;
`;
const SaveErrorMark=styled.span`
  flex-shrink:0;width:16px;height:16px;border-radius:50%;
  background:#DC2626;color:#fff;font-size:0.6875rem;font-weight:800;
  display:inline-flex;align-items:center;justify-content:center;
`;
const SaveErrorClose=styled.button`
  margin-left:auto;flex-shrink:0;background:none;border:none;cursor:pointer;
  font-size:1rem;line-height:1;color:#991B1B;padding:0 2px;
  &:hover{color:#7F1D1D;}
`;
const QTaskInlineAddRow=styled.div`display:flex;align-items:center;gap:8px;padding:6px 12px;background:#F0FDFA;border-bottom:1px solid #F8FAFC;min-width:520px;@media(max-width:640px){min-width:0;padding:8px 10px;}`;
const QTaskInlineSpacer=styled.div`width:24px;flex-shrink:0;`;
const QTaskInlineInput=styled.input`flex:1;min-width:0;padding:4px 8px;height:26px;font-size:0.8125rem;color:#0F172A;background:#FFFFFF;border:1px solid #14B8A6;border-radius:6px;font-family:inherit;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}&::placeholder{color:#94A3B8;}`;
// #249 — 업무명이 셀 안에서 **최약자**였다. 같은 셀의 형제(체크·이월배지·반복칩·이름칩·지연배지·
//   상세버튼)가 전부 flex-shrink:0 이라, 셀이 좁아지면 그것들이 폭을 먼저 다 먹고 업무명에
//   1~2글자만 남았다("노트북에서 1, 2글자만 보여"). 성장 + 최소폭 바닥을 줘서
//   "업무명 > 장식 배지" 우선순위를 강제한다 — 셀의 overflow:hidden 이 뒤쪽 배지부터 잘라낸다.
const TaskTitle=styled.span<{$done?:boolean}>`font-size:0.875rem;font-weight:600;@media(max-width:640px){font-size:0.9375rem;}color:#0F172A;cursor:text;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:96px;${p=>p.$done&&'text-decoration:line-through;color:#94A3B8;'}&:hover{color:#0F766E;}`;
// WORK_FLOW §6 — 이월 배지 (차분·비강조, slate)
const CarriedBadge=styled.span`flex-shrink:0;display:inline-flex;align-items:center;padding:1px 7px;font-size:0.625rem;font-weight:700;color:#475569;background:#F1F5F9;border-radius:10px;letter-spacing:-0.2px;cursor:help;`;
// 안 읽은 업무 활동(댓글·변경) 점 (운영 #5)
const UnreadDot=styled.span`flex-shrink:0;width:7px;height:7px;border-radius:50%;background:#F43F5E;margin-right:2px;align-self:center;`;
const TitleInput=styled.input`flex:1;font-size:0.875rem;font-weight:500;color:#0F172A;border:1px solid #14B8A6;background:#F0FDFA;padding:2px 8px;border-radius:6px;font-family:inherit;height:24px;box-sizing:border-box;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}`;
const StatusPill=styled.span<{$bg:string;$fg:string;$clickable?:boolean}>`
  padding:2px 8px;background:${p=>p.$bg};color:${p=>p.$fg};font-size:0.625rem;font-weight:700;
  border-radius:8px;white-space:nowrap;${p=>p.$clickable?'cursor:pointer;user-select:none;&:hover{opacity:0.8;}':''}
`;
const StatusDropdown=styled.div`
  position:absolute;top:100%;left:50%;transform:translateX(-50%);z-index:100;
  background:#FFF;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);
  padding:4px;min-width:100px;margin-top:4px;
`;
const StatusOption=styled.button<{$bg:string;$fg:string;$active?:boolean}>`
  display:block;width:100%;padding:5px 10px;font-size:0.6875rem;font-weight:600;text-align:left;
  border:none;border-radius:6px;cursor:pointer;
  background:${p=>p.$active?p.$bg:'transparent'};color:${p=>p.$fg};
  &:hover{background:${p=>p.$bg};}
`;
const PrioNum=styled.button<{$active?:boolean;$disabled?:boolean}>`
  width:24px;height:24px;display:flex;align-items:center;justify-content:center;
  font-size:0.75rem;font-weight:800;border-radius:50%;transition:all 0.15s;
  cursor:${p=>p.$disabled?'default':'pointer'};
  ${p=>p.$disabled?`
    color:#E2E8F0;background:transparent;border:2px dashed #F1F5F9;
  `:p.$active?`
    /* 우선순위 번호 = 단순 순서 표시 (danger 아님). 빨강 → Primary Teal 로 변경.
       빨강은 overdue·delete·error 같은 실제 위험에만 남김 (시각 위계 회복). */
    color:#FFF;background:#14B8A6;border:2px solid #14B8A6;
    &:hover{background:#0D9488;border-color:#0D9488;}
  `:`
    color:#CBD5E1;background:transparent;border:2px dashed #E2E8F0;
    &:hover{border-color:#14B8A6;color:#14B8A6;}
  `}
`;
const PrioEmpty=styled.span`display:block;width:6px;height:6px;border-radius:50%;background:#E2E8F0;`;
const EstWrap=styled.span<{$flash?:boolean}>`
  position:relative;display:inline-flex;align-items:center;
  ${p=>p.$flash?'background:#D1FAE5;border-radius:5px;animation:estFlash 1.2s ease-out;':''}
  @keyframes estFlash{0%{background:#A7F3D0;}100%{background:transparent;}}
`;
// 실제시간 셀 wrap — 진행 중 dot 표시용
const ActWrap=styled.span`position:relative;display:inline-flex;align-items:center;gap:5px;min-width:0;`;
// 진행 중 라이브 dot — 작업 중 (status=in_progress) 일 때 actual_hours 옆 (Apple Watch 스톱워치 패턴)
//
// ★ 운영 신고(Irene 2026-08-24) — "실제 시간 옆에 잘려서 보이지 않는 빨강색 깜빡이는 뭐야? 보이지도 않아."
//   원인 둘:
//   ① `position:absolute; right:-6px` 로 **부모 박스 밖**에 찍혀, 열의 overflow 에 그대로 잘렸다.
//      → 흐름 안(inline-flex 형제)으로 넣고 부모 gap 으로 띄운다. 잘릴 자리가 없어진다.
//   ② `aria-hidden="true"` + 6px 점이라 **무엇을 뜻하는지 알 방법이 없었다.**
//      → aria-hidden 제거 + role/aria-label 부여. 마우스를 올리면 "진행 중" 이라고 말한다.
const InProgressDotMini=styled.span`
  flex-shrink:0;
  width:7px;height:7px;border-radius:50%;background:#DC2626;
  animation:actPulse 1.4s ease-in-out infinite;
  @keyframes actPulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:0.45;transform:scale(0.78);}}
  @media (prefers-reduced-motion: reduce){animation:none;}
`;
const AiSparkBtn=styled.button`
  position:absolute;right:-2px;top:50%;transform:translateY(-50%);
  width:14px;height:14px;
  display:inline-flex;align-items:center;justify-content:center;
  background:transparent;border:none;border-radius:50%;
  color:#F43F5E;cursor:pointer;padding:0;
  opacity:0.55;transition:opacity 0.15s,background 0.15s;
  &:hover{opacity:1;background:#FFF1F2;}
  &:disabled{cursor:wait;}
  &:focus-visible{outline:1px solid rgba(244,63,94,0.5);outline-offset:1px;}
`;
// AI 자동 예측 값 옆 inline ✨ 배지 — 사용자 미확정 표시 (회색 italic NumInput 와 짝)
const AiInlineBadge=styled.span`
  position:absolute;right:-2px;top:50%;transform:translateY(-50%);
  width:12px;height:12px;
  display:inline-flex;align-items:center;justify-content:center;
  color:#F43F5E;opacity:0.65;pointer-events:none;
`;
const NumInput=styled.input<{$ai?:boolean}>`
  width:54px;text-align:center;font-size:0.8125rem;font-weight:600;
  color:${p=>p.$ai?'#94A3B8':'#0F172A'};
  font-style:${p=>p.$ai?'italic':'normal'};
  border:1px solid transparent;background:transparent;padding:3px 2px;border-radius:5px;
  -moz-appearance:textfield;
  &:focus{outline:none;background:#F0FDFA;border-color:#14B8A6;color:#0F172A;font-style:normal;}
  &::placeholder{color:#CBD5E1;}
  &::-webkit-outer-spin-button,&::-webkit-inner-spin-button{
    -webkit-appearance:inner-spin-button;opacity:0.55;height:18px;cursor:pointer;
  }
  &:hover::-webkit-inner-spin-button,&:focus::-webkit-inner-spin-button{opacity:1;}
  &:disabled{
    color:#94A3B8;
    background:#F1F5F9;
    border:1px dashed #E2E8F0;
    cursor:not-allowed;
    font-weight:500;
  }
  &:disabled::-webkit-outer-spin-button,&:disabled::-webkit-inner-spin-button{display:none;}
`;

const SliderWrap=styled.div<{$disabled?:boolean}>`
  /* gap 6→3: 그래프와 % 를 더 붙여 폭을 줄인다 (Irene 2026-08-24) */
  display:flex;align-items:center;gap:3px;width:100%;position:relative;
  ${p=>p.$disabled && `opacity:0.5;cursor:not-allowed;`}
`;
// #78 — 좁은 화면(≤1280px)에선 가로 라인그래프·슬라이더 숨기고 % 만 남겨 업무명 공간 확보
const SliderTrack=styled.div`flex:1;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden;@media (max-width:1280px){display:none;}`;
const SliderFill=styled.div<{$w:number;$color:string}>`height:100%;width:${p=>p.$w}%;background:${p=>p.$color};border-radius:3px;`;
const SliderRange=styled.input`position:absolute;left:0;top:-4px;width:calc(100% - 29px);height:18px;opacity:0;cursor:pointer;&:disabled{cursor:not-allowed;}@media (max-width:1280px){display:none;}`;
// % 는 입력 필드가 아니라 표시값이라 작게 — 남는 폭은 업무명·담당자로 간다 (Irene 2026-08-24)
const SliderPct=styled.span`font-size:0.6875rem;font-weight:700;color:#475569;min-width:26px;text-align:right;@media (max-width:1280px){min-width:0;width:100%;text-align:center;}`;

const DateTrigger=styled.button<{$color?:string;$empty?:boolean}>`
  width:100%;padding:4px 6px;font-size:0.75rem;font-weight:600;
  background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer;
  white-space:nowrap;font-family:inherit;text-align:left;
  color:${p=>p.$empty?'#CBD5E1':p.$color==='overdue'?'#DC2626':p.$color==='today'?'#EA580C':'#64748B'};
  ${p=>p.$color==='overdue'&&!p.$empty?'background:#FEF2F2;':p.$color==='today'&&!p.$empty?'background:#FFF7ED;':''}
  &:hover{border-color:#14B8A6;color:#0F766E;}
`;

const EmptyFull=styled.div`display:flex;align-items:center;justify-content:center;height:100vh;color:#94A3B8;`;
// 헤더 생성 버튼 규격 = ActionButton sm (h36)
const HeaderAddBtn=styled.button`display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;font-size:0.8125rem;font-weight:700;cursor:pointer;white-space:nowrap;&:hover:not(:disabled){background:#0D9488;}&:disabled{background:#CBD5E1;cursor:not-allowed;}`;
const AddInput=styled.input`flex:1 1 auto;min-width:0;font-size:0.875rem;color:#0F172A;border:1px solid #14B8A6;background:#F0FDFA;padding:6px 10px;border-radius:6px;font-family:inherit;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}&::placeholder{color:#94A3B8;}`;
/* 인라인 추가 (표 하단 새 행) — 표와 자연스럽게 연결되도록 좌우 margin 만 적용 */
const InlineAddBox=styled.div`display:flex;flex-direction:column;gap:8px;margin:8px 14px 20px;padding:12px;background:#F8FAFC;border:1px solid #14B8A6;border-radius:10px;`;
// 반복 옵션 펼침 (inline 폼 전용 컴팩트 행)
const InlineRecurRow=styled.div`display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding-top:4px;border-top:1px dashed #E2E8F0;`;
// 빈 상태 — 명시적으로 flex column 안에서 가운데 정렬. 부모(LeftPanel) 의 남은 공간 모두 차지.
const EmptyCenterWrap=styled.div`flex:1;display:flex;align-items:center;justify-content:center;min-height:50vh;width:100%;`;
/* 우측 패널 추가 폼 — 박스 없이 패널 padding 안에 직접 배치 (박스 안 박스 금지) */
const PanelAddForm=styled.div`display:flex;flex-direction:column;gap:10px;padding:20px;background:transparent;border:none;`;
// 행별 그룹: row1=프로젝트/담당자, row2=기간/예측+AI. 모바일에서는 wrap.
const AddOptRow=styled.div`display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;`;
const DescEditorWrap=styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:8px;padding:0;overflow:hidden;&:focus-within{border-color:#14B8A6;}`;
const AttachToggleRow=styled.div`display:flex;`;
const AttachToggleBtn=styled.button`display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;font-size:0.75rem;font-weight:600;color:#475569;cursor:pointer;font-family:inherit;&:hover{background:#F1F5F9;border-color:#CBD5E1;}`;
const AttachCount=styled.span`display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;background:#14B8A6;color:#FFF;border-radius:8px;font-size:0.625rem;font-weight:700;`;
const AttachInlineBox=styled.div`background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:14px;`;
const AddOptField=styled.div`flex:1 1 140px;min-width:120px;display:flex;flex-direction:column;gap:3px;`;
const AddOptLabel=styled.label`font-size:0.6875rem;color:#64748B;font-weight:600;`;
const AddDateInput=styled.input`height:30px;padding:0 8px;font-size:0.8125rem;color:#0F172A;border:1px solid #E2E8F0;border-radius:6px;background:#FFF;font-family:inherit;width:100%;min-width:0;&:focus{outline:none;border-color:#14B8A6;}`;
const AddEstWrap=styled.div`display:flex;gap:6px;align-items:stretch;`;
const AddEstNumberInput=styled.input`width:60px;flex-shrink:0;height:30px;padding:0 8px;font-size:0.8125rem;color:#0F172A;border:1px solid #E2E8F0;border-radius:6px;background:#FFF;font-family:inherit;text-align:right;&:focus{outline:none;border-color:#14B8A6;}`;
const AddEstAiBtn=styled.button`flex:1;min-width:0;height:30px;padding:0 10px;font-size:0.75rem;font-weight:600;color:#0D9488;background:#F0FDFA;border:1px solid #99F6E4;border-radius:6px;cursor:pointer;font-family:inherit;letter-spacing:0.2px;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap;&:hover:not(:disabled){background:#CCFBF1;border-color:#14B8A6;}&:disabled{opacity:0.5;cursor:not-allowed;}`;
const AddEstReason=styled.div`font-size:0.625rem;color:#64748B;margin-top:2px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;`;
const AddDateTrigger=styled.button`height:30px;padding:0 10px;font-size:0.8125rem;color:#0F172A;border:1px solid #E2E8F0;border-radius:6px;background:#FFF;font-family:inherit;cursor:pointer;text-align:left;display:inline-flex;align-items:center;&:hover{border-color:#CBD5E1;}&:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}`;
const AddDatePH=styled.span`color:#94A3B8;`;
const AddBtnRow=styled.div`display:flex;justify-content:flex-end;gap:6px;`;
const AddSaveBtn=styled.button`flex:0 0 auto;padding:6px 14px;font-size:0.8125rem;font-weight:600;background:#14B8A6;color:#FFFFFF;border:none;border-radius:6px;cursor:pointer;&:hover:not(:disabled){background:#0D9488;}&:disabled{background:#CBD5E1;cursor:not-allowed;}`;
const AddCancelBtn=styled.button`flex:0 0 auto;padding:6px 10px;font-size:0.8125rem;color:#64748B;background:transparent;border:1px solid #E2E8F0;border-radius:6px;cursor:pointer;&:hover{background:#F8FAFC;color:#0F172A;}`;
const RecurRow=styled.div`display:flex;flex-direction:column;gap:6px;padding:8px 10px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:6px;`;
const RecurToggleLabel=styled.label`display:inline-flex;align-items:center;gap:8px;font-size:0.8125rem;color:#0F172A;cursor:pointer;input{cursor:pointer;}input:disabled{cursor:not-allowed;}`;
const RecurHint=styled.span`font-size:0.75rem;color:#94A3B8;margin-left:6px;`;
const RecurOptions=styled.div`display:flex;gap:8px;flex-wrap:wrap;align-items:center;`;
const RecurEndBox=styled.div`display:inline-flex;gap:6px;align-items:center;`;
const RecurChip=styled.span<{$iconOnly?:boolean}>`display:inline-flex;align-items:center;gap:4px;padding:${p=>p.$iconOnly?'2px 4px':'2px 8px'};font-size:0.6875rem;font-weight:600;color:#0F766E;background:#CCFBF1;border-radius:10px;line-height:1.5;flex-shrink:0;`;
// 반복 아이콘 — "매주 토" 라벨 앞 (텍스트 "반복" 대신 회전 화살표 아이콘)
const RecurIcon=styled.svg`width:11px;height:11px;flex-shrink:0;`;
// Custom recurrence modal
const CustomRecurOverlay=styled.div`position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;`;
const CustomRecurDialog=styled.div`background:#FFFFFF;border-radius:12px;padding:20px 22px;width:min(420px,90vw);box-shadow:0 20px 60px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:14px;`;
const CustomRecurTitle=styled.h3`margin:0;font-size:1rem;font-weight:700;color:#0F172A;`;
const CustomRecurField=styled.div`display:flex;flex-direction:column;gap:6px;`;
const CustomRecurFieldLabel=styled.label`font-size:0.75rem;color:#64748B;font-weight:600;`;
const CustomRecurInline=styled.div`display:flex;gap:8px;align-items:center;`;
const ViewToggle=styled.div`display:inline-flex;gap:2px;padding:2px;background:#F1F5F9;border-radius:8px;margin-left:auto;`;
const ViewBtn=styled.button<{$active:boolean}>`padding:6px 10px;background:${p=>p.$active?'#FFFFFF':'transparent'};color:${p=>p.$active?'#0F766E':'#94A3B8'};border:none;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;box-shadow:${p=>p.$active?'0 1px 2px rgba(0,0,0,0.06)':'none'};transition:background 0.15s;&:hover{background:${p=>p.$active?'#FFFFFF':'#E2E8F0'};color:#0F766E;}`;
const ScopeToggle=styled.div`display:inline-flex;gap:4px;padding:3px;background:#F1F5F9;border-radius:8px;@media(max-width:640px){display:none;}`;
const ScopeMobileWrap=styled.div`display:none;min-width:100px;@media(max-width:640px){display:block;}`;

// ── Kanban ──
const KanbanBoard=styled.div`
  display:grid;
  grid-auto-flow:column;
  grid-auto-columns:minmax(240px,1fr);
  gap:12px;
  padding:16px 14px;
  overflow-x:auto;
`;
const KanbanColumn=styled.div`display:flex;flex-direction:column;gap:8px;min-width:220px;`;
const KanbanColHeader=styled.div`display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:8px;font-size:0.75rem;font-weight:700;`;
const KanbanCount=styled.span`font-size:0.6875rem;font-weight:600;opacity:0.8;`;
const KanbanColBody=styled.div`display:flex;flex-direction:column;gap:8px;min-height:40px;`;
const KanbanHoldReason=styled.div`font-size:0.6875rem;line-height:1.4;color:#9A3412;margin-top:2px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const KanbanCard=styled.div<{$delayed?:boolean;$done?:boolean;$selected?:boolean}>`
  position:relative;
  background:#FFFFFF;
  border:1px solid ${p=>p.$selected?'#F43F5E':'#E2E8F0'};
  border-radius:8px;
  padding:10px 12px;
  cursor:pointer;
  transition:box-shadow 0.15s,border-color 0.15s;
  opacity:${p=>p.$done?0.6:1};
  ${p=>p.$selected?'box-shadow:inset 3px 0 0 #F43F5E;':''}
  &:hover{box-shadow:${p=>p.$selected?'inset 3px 0 0 #F43F5E,0 4px 12px rgba(244,63,94,0.12)':'0 4px 12px rgba(15,23,42,0.08)'};border-color:${p=>p.$selected?'#F43F5E':'#CBD5E1'};}
`;
const KanbanDelayBadge=styled.span`position:absolute;top:6px;right:8px;padding:1px 6px;font-size:0.5625rem;font-weight:700;color:#B91C1C;background:#FEE2E2;border-radius:4px;letter-spacing:0.3px;`;
const KanbanProject=styled.div`font-size:0.625rem;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:4px;`;
const KanbanTitle=styled.div`font-size:0.8125rem;font-weight:600;color:#0F172A;line-height:1.4;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;`;
const KanbanMeta=styled.div`display:flex;flex-wrap:wrap;gap:4px;align-items:center;`;
const KanbanRoleRow=styled.div`display:flex;align-items:center;gap:6px;margin-bottom:6px;`;
const KanbanRoleBadge=styled.span<{$role:string}>`
  display:inline-block;padding:1px 6px;font-size:0.625rem;font-weight:700;border-radius:4px;
  ${p=>p.$role==='assignee'?'background:#CCFBF1;color:#0F766E;':''}
  ${p=>p.$role==='reviewer'?'background:#FEF3C7;color:#92400E;':''}
  ${p=>p.$role==='requester'?'background:#E0E7FF;color:#3730A3;':''}
  ${p=>p.$role==='observer'?'background:#F1F5F9;color:#64748B;':''}
`;
const KanbanStatusText=styled.span`font-size:0.6875rem;color:#64748B;`;
const KanbanDue=styled.span<{$overdue?:boolean}>`font-size:0.6875rem;font-weight:600;color:${p=>p.$overdue?'#DC2626':'#64748B'};margin-left:auto;`;
const KanbanProgress=styled.div`height:4px;background:#F1F5F9;border-radius:999px;overflow:hidden;margin-top:8px;`;
const KanbanProgressFill=styled.div`height:100%;background:linear-gradient(90deg,#14B8A6,#0D9488);border-radius:999px;transition:width 0.3s;`;
const KanbanEmpty=styled.div`text-align:center;padding:20px 10px;color:#CBD5E1;font-size:0.75rem;`;
const KanbanEmptyBoard=styled.div`
  grid-column:1 / -1;
  padding:60px 20px;
  text-align:center;
  color:#94A3B8;
  font-size:0.8125rem;
  background:#FFFFFF;
  border:1px dashed #E2E8F0;
  border-radius:12px;
`;
const ScopeBtn=styled.button<{$active:boolean}>`padding:6px 14px;font-size:0.8125rem;font-weight:600;background:${p=>p.$active?'#FFFFFF':'transparent'};color:${p=>p.$active?'#0F172A':'#64748B'};border:none;border-radius:6px;cursor:pointer;box-shadow:${p=>p.$active?'0 1px 2px rgba(0,0,0,0.06)':'none'};transition:background 0.15s, color 0.15s;&:hover{background:${p=>p.$active?'#FFFFFF':'#E2E8F0'};color:${p=>p.$active?'#0F172A':'#0F172A'};}`;
const NameChip=styled.span<{$type:'from'|'to'|'observer'}>`
  display:inline-block;margin-left:6px;padding:1px 7px;font-size:0.6875rem;font-weight:600;
  border-radius:10px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;vertical-align:middle;
  ${p=>p.$type==='from'?'color:#BE123C;background:#FFE4E6;':p.$type==='to'?'color:#0F766E;background:#CCFBF1;':'color:#64748B;background:#F1F5F9;'}
`;


// Right panel — Q Talk / Q docs 표준 EdgeHandle 패턴 (2026-05-18 통일)
// CollapsedStrip 은 0 폭 anchor — EdgeHandle 만 LeftPanel·RightPanel 경계에 노출.
// N+63 — 시인성·세련도 강화. 옛 8×60 회색 → 12×72 + 진한 색 + chevron 14×14 + hover 시 18×84 teal + nudge animation.
// 평소도 명확히 보이게, hover 시 확실한 affordance, focus ring 강화.
const RightPanel=styled.aside<{$w?:number;$overlay?:boolean}>`background:#FFF;border-left:1px solid #E2E8F0;display:flex;flex-direction:column;overflow:hidden;
  ${p=>p.$overlay?`
    position:fixed;top:0;right:0;bottom:0;
    width:${PANEL_WIDTH_CSS};
    z-index:50;
    box-shadow:-16px 0 40px rgba(15,23,42,0.14);
    animation:pqRpSlide 0.28s cubic-bezier(0.22,1,0.36,1);
    @keyframes pqRpSlide{from{transform:translateX(100%);}to{transform:translateX(0);}}
    padding-bottom:var(--pq-safe-bottom, 0px);
    @media (prefers-reduced-motion: reduce){animation:none;}
  `:`
    width:${p.$w||420}px;flex-shrink:0;position:relative;
    @media(max-width:${RIGHT_PANEL_INLINE_MIN}px){display:none;}
  `}
`;
const RightPanelBackdrop=styled.div`position:fixed;inset:0;background:rgba(15, 23, 42, 0.08);-webkit-z-index:45;animation:pqRpFade 0.22s ease-out;@keyframes pqRpFade{from{opacity:0;}to{opacity:1;}}@media (prefers-reduced-motion: reduce){animation:none;}`;
const ResizeHandle=styled.div`position:absolute;top:0;left:-3px;width:6px;height:100%;cursor:col-resize;z-index:5;&:hover{background:rgba(20,184,166,0.2);}&:active{background:rgba(20,184,166,0.4);}`;
const RightHeader=styled.div`height:60px;padding:14px 20px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;`;
const RightTitle=styled.h2`font-size:0.8125rem;font-weight:700;color:#0F172A;margin:0;letter-spacing:-0.1px;`;
const RightScroll=styled.div`flex:1;overflow-y:auto;overflow-x:hidden;min-width:0;&>*{min-width:0;max-width:100%;}&::-webkit-scrollbar{width:6px;}&::-webkit-scrollbar-thumb{background:#E2E8F0;border-radius:3px;}`;
const RSection=styled.div`border-bottom:1px solid #F1F5F9;padding:12px 14px;`;
const RSTitle=styled.h4`font-size:0.75rem;font-weight:700;color:#0F172A;margin:0 0 8px;`;
const CapFieldLabel=styled.div`font-size:0.625rem;color:#94A3B8;font-weight:600;margin-bottom:3px;`;
const CapFieldInput=styled.input`width:100%;padding:4px 6px;border:1px solid #E2E8F0;border-radius:6px;font-size:0.8125rem;font-weight:600;color:#0F172A;text-align:center;background:#FAFBFC;&:focus{outline:none;border-color:#14B8A6;background:#FFF;}`;
/* 가용시간 대시보드 — 큰 숫자 + 진행바 + 남은 시간 강조 (사용자: 탁월한 UI/UX) */
const CapDashboard=styled.div`display:flex;flex-direction:column;gap:10px;margin-bottom:12px;`;
const CapHeadline=styled.div`display:flex;align-items:baseline;justify-content:space-between;gap:10px;`;
const CapBigNum=styled.div`display:flex;align-items:baseline;gap:6px;`;
const CapTinyLabel=styled.span`font-size:0.6875rem;color:#94A3B8;font-weight:600;`;
const CapUsed=styled.span`font-size:1.5rem;font-weight:800;letter-spacing:-0.4px;`;
const CapSep=styled.span`font-size:1.125rem;color:#CBD5E1;font-weight:600;`;
const CapTotal=styled.span`font-size:0.9375rem;color:#64748B;font-weight:600;`;
const CapBarRow=styled.div`display:flex;align-items:center;gap:8px;`;
const CapBar=styled.div`flex:1;min-width:0;height:8px;background:#F1F5F9;border-radius:4px;overflow:hidden;`;
const CapBarPct=styled.span`flex-shrink:0;font-size:0.6875rem;font-weight:700;color:#0F766E;min-width:30px;text-align:right;`;
const CapBarFill=styled.div`height:100%;border-radius:4px;transition:width 0.25s ease,background 0.15s;`;
const CapOverChip=styled.span`
  flex-shrink:0;padding:2px 8px;border-radius:10px;
  font-size:0.6875rem;font-weight:700;color:#B91C1C;background:#FEE2E2;
`;
const CapDoneNote=styled.div`
  margin-top:4px; font-size:0.6875rem; color:#94A3B8; line-height:1.4;
`;
const CapRemainingRow=styled.div`display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#F8FAFC;border-radius:8px;`;
const CapRemainingLabel=styled.span`font-size:0.6875rem;color:#64748B;font-weight:600;`;
const CapRemainingValue=styled.span`font-size:0.9375rem;font-weight:700;letter-spacing:-0.2px;`;
const CapSettingsRow=styled.div`display:flex;flex-wrap:wrap;gap:6px;`;
const CapSettingsField=styled.div`flex:1;min-width:56px;`;
const CapFormulaHint=styled.div`margin-top:8px;font-size:0.6875rem;color:#94A3B8;font-weight:500;text-align:center;letter-spacing:-0.2px;`;
// WORK_FLOW §6 (U5) — 실측 참여율 제안 (은은하게)
const CapSuggest=styled.div`margin-top:6px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:0.6875rem;color:#64748B;font-weight:600;cursor:help;`;
const CapSuggestBtn=styled.button`padding:2px 10px;font-size:0.6875rem;font-weight:700;color:#0F766E;background:#F0FDFA;border:1px solid #99F6E4;border-radius:10px;cursor:pointer;transition:background 0.15s;&:hover{background:#CCFBF1;}`;
// WORK_FLOW §6 (U1) — 판정 칩 (EVM→일상어). good/warn/bad 3톤.
const VERDICT_TONE={good:{bg:'#F0FDFA',text:'#0F766E',dot:'#14B8A6'},warn:{bg:'#FFFBEB',text:'#B45309',dot:'#F59E0B'},bad:{bg:'#FEF2F2',text:'#B91C1C',dot:'#EF4444'}} as const;
const VerdictChip=styled.div<{$tone:'good'|'warn'|'bad'}>`display:inline-flex;align-items:center;gap:6px;margin-bottom:8px;padding:4px 10px;font-size:0.75rem;font-weight:700;border-radius:14px;letter-spacing:-0.2px;cursor:help;background:${p=>VERDICT_TONE[p.$tone].bg};color:${p=>VERDICT_TONE[p.$tone].text};`;
const VerdictDot=styled.span<{$tone:'good'|'warn'|'bad'}>`width:7px;height:7px;border-radius:50%;background:${p=>VERDICT_TONE[p.$tone].dot};`;
// WORK_FLOW §6 — 부하 구성(이월/신규) 표시
const CapBreakdown=styled.div`display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:4px 12px;padding:6px 0 2px;`;
const CapBreakItem=styled.span`display:inline-flex;align-items:center;gap:5px;font-size:0.6875rem;color:#64748B;font-weight:600;`;
const CapBreakDot=styled.span<{$carried?:boolean}>`width:7px;height:7px;border-radius:2px;background:${p=>p.$carried?'#94A3B8':'#14B8A6'};`;
const ChartSVG=styled.svg`width:100%;height:160px;display:block;`;
const EmptyChart=styled.div`padding:16px;text-align:center;color:#CBD5E1;font-size:0.6875rem;`;
// 운영 #300 — 그래프가 어느 집합·어느 기간을 그리는지 화면에 적는다.
//   이게 없으면 왼쪽 목록 숫자와 다를 때 사용자는 고장으로 읽는다(실제로 그렇게 신고됐다).
const ChartScopeHint=styled.div`margin-top:6px;font-size:0.65625rem;line-height:1.45;color:#94A3B8;`;
const Legend=styled.div`display:flex;gap:12px;margin-top:6px;`;
const LI=styled.div`display:flex;align-items:center;gap:3px;font-size:0.625rem;color:#64748B;font-weight:600;`;
const Dot=styled.span<{$c:string}>`width:7px;height:7px;border-radius:50%;background:${p=>p.$c};`;
const DashDot=styled.span<{$c:string}>`width:14px;height:0;border-top:2px dashed ${p=>p.$c};flex-shrink:0;`;
// WORK_FLOW §6 (U4) — 되돌림 마커 범례 (▽ 주황)
const RevertTri=styled.span`width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:6px solid #F59E0B;flex-shrink:0;`;
const PPRow=styled.div`display:flex;align-items:center;gap:8px;& + &{margin-top:6px;}`;
const PPName=styled.span`font-size:0.6875rem;color:#0F172A;font-weight:500;min-width:60px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const PPTrack=styled.div`flex:1;height:5px;background:#F1F5F9;border-radius:3px;overflow:hidden;`;
const PPFill=styled.div<{$w:number}>`height:100%;width:${p=>p.$w}%;background:#14B8A6;border-radius:3px;`;
const PPPct=styled.span`font-size:0.6875rem;font-weight:700;color:#475569;min-width:28px;text-align:right;`;
const IssueCard=styled.div`padding:6px 8px;background:#F8FAFC;border-radius:6px;border-left:2px solid #F43F5E;& + &{margin-top:4px;}`;
const NoteCard=styled.div<{$internal?:boolean}>`padding:6px 8px;background:#F8FAFC;border-radius:6px;border-left:2px solid ${p=>p.$internal?'#0284C7':'#94A3B8'};& + &{margin-top:4px;}`;
// 프로젝트 태그 — 흰 배경 + 포인트(코랄) 글자·테두리. 회색 배경이 코랄 카드 위에서 안 보이던 것 개선(Irene).
const IProjTag=styled.span`padding:1px 6px;background:#FFFFFF;color:#E11D48;border:1px solid #FECDD3;font-size:0.5625rem;font-weight:700;border-radius:999px;margin-right:4px;`;

// Detail slide-over
const CommentItem=styled.div`padding:8px 10px;background:#F8FAFC;border-radius:8px;& + &{margin-top:6px;}`;
const CommentHead=styled.div`display:flex;gap:8px;align-items:baseline;font-size:0.6875rem;color:#64748B;margin-bottom:3px;& strong{color:#0F172A;font-weight:600;}`;
const CommentBody=styled.div`font-size:0.75rem;color:#1E293B;line-height:1.4;white-space:pre-wrap;`;
// Candidate card (전체업무 탭)
const CandCard=styled.div`padding:8px 10px;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;& + &{margin-top:6px;}`;
const CandTitle=styled.div`font-size:0.75rem;font-weight:600;color:#9F1239;margin-bottom:4px;`;

// Period row (right panel)

// Detail button on task row
const DetailBtn=styled.button<{$active?:boolean}>`display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:${p=>p.$active?'#F43F5E':'transparent'};border:1px solid ${p=>p.$active?'#F43F5E':'transparent'};border-radius:6px;color:${p=>p.$active?'#FFF':'#94A3B8'};cursor:pointer;flex-shrink:0;transition:all 0.15s;&:hover{background:${p=>p.$active?'#E11D48':'#F1F5F9'};color:${p=>p.$active?'#FFF':'#0F766E'};border-color:${p=>p.$active?'#E11D48':'#E2E8F0'};}`;
const IBody=styled.div`font-size:0.75rem;color:#1E293B;line-height:1.4;`;
const IMeta=styled.div`font-size:0.625rem;color:#94A3B8;margin-top:2px;`;

// ─── Phase C: 워크플로우 상세 UI ───
// 액션 버튼 — COLOR_GUIDE 준수 (Primary/Secondary/Danger 3톤으로 통일)
// 범위 입력을 진행바처럼 보이게 — 트랙 위에 fill(teal) + 작은 thumb
