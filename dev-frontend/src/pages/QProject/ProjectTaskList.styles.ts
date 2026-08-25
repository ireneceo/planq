// ProjectTaskList 의 styled 정의 절출 (god-file 래칫 — 컴포넌트 파일 800줄 상한).
// Q Mail(MailPage.styles.ts)과 같은 패턴. 스타일 값은 Q Task 리스트와 동일해야 한다 — 한쪽만 바꾸지 말 것.
import styled from 'styled-components';

// 좌우 패딩은 TRow(본문 행)와 같아야 한다 — 2px 만 달라도 라벨이 컬럼과 어긋난다 (#236 후속)
export const ColRow = styled.div`display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid #E2E8F0;background:#F8FAFC;position:sticky;top:0;z-index:1;min-width:520px;@media(max-width:640px){min-width:0;}`;
export const Col = styled.span<{$w?:string;$flex?:boolean;$flex2?:boolean;$center?:boolean;$hideBelow?:number}>`
  box-sizing:border-box;min-width:0;
  /* ★ 헤더(Col)와 본문(TCell)의 flex·min-width 는 **문자 그대로 같아야** 한다.
     여태 헤더는 3:2.5, 본문은 1:2 라 비율이 갈려 있었고, #236 으로 본문 업무 셀을 넓히자
     라벨이 본문 컬럼 대비 밀려 "상태" 가 아이콘 위에 뜨는 어긋남이 드러났다.
     한쪽만 고치면 또 갈린다 — 값은 여기와 TCell 두 곳에서 같이 움직인다. */
  ${p=>p.$flex2 ? 'flex:2 1 0;min-width:240px;'
                : p.$flex ? 'flex:1 1 0;min-width:100px;'
                : `flex:0 0 ${p.$w||'72px'};width:${p.$w||'72px'};`}
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11px;font-weight:700;color:#94A3B8;cursor:pointer;user-select:none;
  ${p=>p.$center&&'text-align:center;'}
  &:hover{color:#475569;}
  ${p=>p.$hideBelow?`@media (max-width: ${p.$hideBelow}px){display:none;}`:''}
`;
export const TRow = styled.div<{$done?:boolean;$delayed?:boolean;$selected?:boolean;$dragging?:boolean}>`
  display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid #F8FAFC;
  /* 폰에서는 최소폭을 풀어 화면 안에 들어오게 한다 — 담당자(900)·진행률(1024)·설명(768) 열이
     이미 숨겨지므로 남는 것은 체크박스·제목뿐이다. 520px 을 고집하면 가로로 삐져나가
     "레이아웃이 나가버린다"(2026-08-25 실측). */
  @media (max-width: 640px){min-width:0;padding:8px 10px;}
  min-width:520px;@media(max-width:640px){min-width:0;}opacity:${p=>p.$dragging?0.4:p.$done?0.45:1};
  ${p=>p.$selected?'background:#FFF1F2;box-shadow:inset 3px 0 0 #F43F5E;':p.$delayed&&!p.$done?'box-shadow:inset 3px 0 0 #DC2626;':''}
  &:hover{background:${p=>p.$selected?'#FFE4E6':p.$delayed&&!p.$done?'#FEF2F2':'#FAFBFC'};}
`;
export const TCell = styled.div<{$w?:string;$flex?:boolean;$flex2?:boolean;$center?:boolean;$hideBelow?:number}>`
  box-sizing:border-box;
  ${p=>p.$flex2 ? 'flex:2 1 0;min-width:240px;display:flex;align-items:center;gap:6px;overflow:hidden;' : p.$flex ? 'flex:1 1 0;min-width:100px;display:flex;align-items:center;gap:6px;overflow:hidden;' : `flex:0 0 ${p.$w||'auto'};width:${p.$w||'auto'};overflow:hidden;`}
  ${p=>p.$center&&'display:flex;justify-content:center;align-items:center;'}
  ${p=>p.$hideBelow?`@media (max-width: ${p.$hideBelow}px){display:none;}`:''}
`;
export const Spacer = styled.div`flex:1;min-width:8px;`;
export const DragHandle = styled.span`
  display:inline-flex;align-items:center;justify-content:center;width:18px;height:24px;flex-shrink:0;
  color:#CBD5E1;cursor:grab;border-radius:4px;
  &:hover{color:#94A3B8;background:#F1F5F9;}
  &:active{cursor:grabbing;}
`;
export const TaskCheck = styled.input`accent-color:#0D9488;cursor:pointer;width:15px;height:15px;flex-shrink:0;`;
export const InlineAddRow = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  background: #F0FDFA;
  border-bottom: 1px solid #F8FAFC;
  min-width: 520px;
  @media (max-width: 640px) { min-width: 0; padding: 8px 10px; }
`;
export const InlineSpacer = styled.div`width: 24px; flex-shrink: 0;`;
export const InlineInput = styled.input`
  flex: 1; min-width: 0;
  padding: 4px 8px; height: 26px;
  font-size: 13px; color: #0F172A;
  background: #FFFFFF; border: 1px solid #14B8A6; border-radius: 6px;
  font-family: inherit;
  &:focus { outline: none; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
  &::placeholder { color: #94A3B8; }
`;
// #249 — QTaskPage 와 같은 결함. 같은 셀의 배지들이 flex-shrink:0 이라 좁아지면 업무명만 압사한다.
export const TaskTitle = styled.span<{$done?:boolean}>`font-size:14px;font-weight:500;color:#0F172A;cursor:text;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:96px;${p=>p.$done&&'text-decoration:line-through;color:#94A3B8;'}&:hover{color:#0F766E;}`;
export const TitleInput = styled.input`flex:1;font-size:14px;font-weight:500;color:#0F172A;border:1px solid #14B8A6;background:#F0FDFA;padding:2px 8px;border-radius:6px;font-family:inherit;height:24px;box-sizing:border-box;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}`;
export const DelayBadge = styled.span`padding:1px 6px;font-size:9px;font-weight:700;color:#DC2626;background:#FEF2F2;border:1px solid #FECACA;border-radius:4px;flex-shrink:0;white-space:nowrap;`;
export const DetailBtn = styled.button<{$active?:boolean}>`display:flex;align-items:center;justify-content:center;width:28px;height:28px;background:${p=>p.$active?'#F43F5E':'transparent'};border:1px solid ${p=>p.$active?'#F43F5E':'transparent'};border-radius:6px;color:${p=>p.$active?'#FFF':'#94A3B8'};cursor:pointer;flex-shrink:0;transition:all 0.15s;&:hover{background:${p=>p.$active?'#E11D48':'#F1F5F9'};color:${p=>p.$active?'#FFF':'#0F766E'};border-color:${p=>p.$active?'#E11D48':'#E2E8F0'};}`;
export const NameChip = styled.span<{$type:'from'|'to'|'observer'}>`
  display:inline-flex;align-items:center;padding:1px 8px;font-size:10px;font-weight:700;border-radius:8px;white-space:nowrap;flex-shrink:0;
  ${p=>p.$type==='from'?'background:#FFF1F2;color:#9F1239;'
    :p.$type==='to'?'background:#F0FDFA;color:#0F766E;'
    :'background:#F1F5F9;color:#64748B;'}
`;
// 그룹 이동 (행별 드롭다운)
export const GroupMoveWrap = styled.div`position:relative;flex-shrink:0;`;
export const GroupMoveBtn = styled.button`display:inline-flex;align-items:center;gap:1px;height:24px;padding:0 5px;background:transparent;border:1px solid transparent;border-radius:6px;color:#94A3B8;cursor:pointer;&:hover{background:#F1F5F9;color:#0F766E;border-color:#E2E8F0;}`;
export const GroupMenu = styled.div`position:absolute;top:100%;left:0;z-index:120;min-width:160px;max-height:240px;overflow-y:auto;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:4px;margin-top:4px;`;
export const GroupMenuItem = styled.button<{$active?:boolean;$danger?:boolean}>`
  display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;font-size:12px;text-align:left;border:none;border-radius:6px;cursor:pointer;
  background:${p=>p.$active?'#F0FDFA':'transparent'};
  color:${p=>p.$danger?'#DC2626':p.$active?'#0F766E':'#0F172A'};font-weight:${p=>p.$active?600:500};
  &:hover{background:${p=>p.$danger?'#FEF2F2':'#F0FDFA'};color:${p=>p.$danger?'#DC2626':'#0F766E'};}
`;
export const GroupMenuHint = styled.div`padding:4px 10px 2px;font-size:10px;color:#94A3B8;`;
export const GroupDot = styled.span`width:9px;height:9px;border-radius:50%;flex-shrink:0;`;
// 그룹 헤더
export const GroupHeader = styled.div<{$over?:boolean}>`
  display:flex;align-items:center;gap:8px;padding:8px 12px;min-width:520px;@media(max-width:640px){min-width:0;}
  background:${p=>p.$over?'#F0FDFA':'#FBFCFE'};border-bottom:1px solid #E2E8F0;border-top:1px solid #F1F5F9;
  ${p=>p.$over&&'box-shadow:inset 0 0 0 2px #99F6E4;'}
`;
export const GroupCollapseBtn = styled.button`display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:transparent;border:none;border-radius:4px;color:#64748B;cursor:pointer;flex-shrink:0;&:hover{background:#F1F5F9;color:#0F172A;}`;
export const GroupTitle = styled.span<{$editable?:boolean}>`font-size:13px;font-weight:700;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;${p=>p.$editable&&'cursor:text;&:hover{color:#0F766E;}'}`;
export const GroupTitleInput = styled.input`font-size:13px;font-weight:700;color:#0F172A;border:1px solid #14B8A6;background:#F0FDFA;padding:2px 8px;border-radius:6px;font-family:inherit;height:26px;box-sizing:border-box;min-width:160px;flex:0 1 240px;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}&::placeholder{color:#94A3B8;font-weight:500;}`;
export const GroupCount = styled.span`display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 6px;background:#E2E8F0;color:#475569;border-radius:999px;font-size:10px;font-weight:700;flex-shrink:0;`;
export const GroupBar = styled.div`flex:0 1 120px;min-width:48px;height:5px;background:#F1F5F9;border-radius:999px;overflow:hidden;margin-left:4px;`;
export const GroupBarFill = styled.div`height:100%;background:linear-gradient(90deg,#99F6E4,#14B8A6);border-radius:999px;`;
export const GroupPct = styled.span`font-size:11px;font-weight:700;color:#64748B;font-variant-numeric:tabular-nums;flex-shrink:0;min-width:30px;`;
export const GroupActions = styled.div`display:flex;align-items:center;gap:2px;margin-left:auto;flex-shrink:0;`;
export const GroupIconBtn = styled.button`display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;background:transparent;border:1px solid transparent;border-radius:6px;color:#94A3B8;cursor:pointer;&:hover:not(:disabled){background:#F1F5F9;color:#0F766E;border-color:#E2E8F0;}&:disabled{opacity:0.35;cursor:default;}`;
export const GroupBody = styled.div<{$over?:boolean}>`${p=>p.$over&&'background:#F0FDFA;'}`;
export const GroupEmpty = styled.div`padding:10px 16px 10px 40px;font-size:12px;color:#CBD5E1;min-width:520px;@media(max-width:640px){min-width:0;}`;
export const AddGroupBtn = styled.button`display:inline-flex;align-items:center;gap:6px;margin:10px 0 4px 12px;padding:7px 12px;background:transparent;color:#0F766E;border:1px dashed #99F6E4;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;&:hover{background:#F0FDFA;border-color:#14B8A6;}`;
export const AddGroupRow = styled.div`display:flex;align-items:center;gap:8px;padding:8px 12px;min-width:520px;@media(max-width:640px){min-width:0;}background:#F0FDFA;border-top:1px solid #99F6E4;`;
// #120 — 그룹별 업무 추가
export const AddTaskInGroupBtn = styled.button`display:inline-flex;align-items:center;gap:5px;margin:4px 0 4px 40px;padding:5px 10px;background:transparent;color:#94A3B8;border:1px dashed #E2E8F0;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;&:hover{background:#F0FDFA;border-color:#99F6E4;color:#0F766E;}`;
export const AddTaskInGroupRow = styled.div`display:flex;align-items:center;gap:8px;padding:6px 12px 6px 40px;min-width:520px;@media(max-width:640px){min-width:0;}`;
export const AddTaskInGroupInput = styled.input`flex:0 1 360px;font-size:13px;color:#0F172A;border:1px solid #14B8A6;background:#F0FDFA;padding:5px 10px;border-radius:6px;font-family:inherit;height:30px;box-sizing:border-box;&:focus{outline:none;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}&::placeholder{color:#94A3B8;}`;
export const AddTaskInGroupGo = styled.button`height:30px;padding:0 14px;background:#14B8A6;color:#FFF;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;&:hover:not(:disabled){background:#0D9488;}&:disabled{opacity:0.5;cursor:not-allowed;}`;
export const StatusPill = styled.span<{$bg:string;$fg:string;$clickable?:boolean}>`
  padding:2px 8px;background:${p=>p.$bg};color:${p=>p.$fg};font-size:10px;font-weight:600;
  border-radius:8px;white-space:nowrap;${p=>p.$clickable?'cursor:pointer;user-select:none;&:hover{filter:brightness(0.96);}':''}
`;
export const StatusDropdown = styled.div`position:absolute;top:100%;left:50%;transform:translateX(-50%);z-index:100;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:4px;min-width:100px;margin-top:4px;`;
export const StatusOption = styled.button<{$bg:string;$fg:string;$active?:boolean}>`
  display:block;width:100%;padding:5px 10px;font-size:11px;font-weight:600;text-align:left;border:none;border-radius:6px;cursor:pointer;
  background:${p=>p.$active?p.$bg:'transparent'};color:${p=>p.$fg};&:hover{background:${p=>p.$bg};}
`;
export const SliderWrap = styled.div`display:flex;align-items:center;gap:6px;width:100%;position:relative;`;
export const SliderTrack = styled.div`flex:1;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden;`;
export const SliderFill = styled.div<{$w:number;$color:string}>`height:100%;width:${p=>p.$w}%;background:${p=>p.$color};border-radius:3px;`;
export const SliderRange = styled.input`position:absolute;left:0;top:-4px;width:calc(100% - 40px);height:18px;opacity:0;cursor:pointer;`;
export const SliderPct = styled.span`font-size:12px;font-weight:700;color:#475569;min-width:32px;text-align:right;`;
export const DateTrigger = styled.button<{$color?:string;$empty?:boolean}>`
  width:100%;padding:4px 6px;font-size:12px;font-weight:600;background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer;white-space:nowrap;font-family:inherit;text-align:center;
  color:${p=>p.$empty?'#CBD5E1':p.$color==='overdue'?'#DC2626':p.$color==='today'?'#EA580C':'#64748B'};
  ${p=>p.$color==='overdue'&&!p.$empty?'background:#FEF2F2;':p.$color==='today'&&!p.$empty?'background:#FFF7ED;':''}
  &:hover{border-color:#14B8A6;color:#0F766E;}
`;
export const AssigneeLabel = styled.span`display:inline-block;font-size:12px;color:#0F172A;cursor:pointer;padding:2px 6px;border-radius:4px;&:hover{background:#F1F5F9;}`;
export const AssigneeDropdown = styled.div`position:absolute;top:100%;left:0;z-index:100;min-width:140px;max-height:220px;overflow-y:auto;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:4px;margin-top:4px;`;
export const AssigneeOpt = styled.button<{$active?:boolean}>`display:block;width:100%;padding:5px 10px;font-size:12px;text-align:left;border:none;border-radius:6px;cursor:pointer;background:${p=>p.$active?'#F0FDFA':'transparent'};color:${p=>p.$active?'#0F766E':'#0F172A'};font-weight:${p=>p.$active?600:500};&:hover{background:#F0FDFA;color:#0F766E;}`;
export const AssigneeOptInner = styled.span`display:inline-flex;align-items:center;gap:8px;`;
export const EmptyMsg = styled.div`padding:32px;text-align:center;color:#94A3B8;font-size:13px;`;
export const DescText = styled.span`font-size:12px;color:#64748B;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;`;
export const DescEmpty = styled.span`color:#CBD5E1;`;
