// QProjectDetailPage 의 styled 정의 — 화면 로직과 분리 (god-file 축소).
// 이 저장소의 기존 선례(QMail/MailPage.styles.ts)와 같은 패턴.

import styled from 'styled-components';

export const PinnedDocCard = styled.div`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 12px;
  padding: 24px 28px;
`;
export const PinnedDocHeader = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 16px;
  padding-bottom: 12px; border-bottom: 1px solid #E2E8F0;
`;
export const PinnedDocTitle = styled.h2`
  margin: 0; font-size: 18px; font-weight: 700; color: #0F172A;
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
export const PinnedDocActions = styled.div`
  display: inline-flex; gap: 6px; flex-shrink: 0;
`;
export const PinnedDocBtn = styled.button`
  display: inline-flex; align-items: center; gap: 5px;
  height: 32px; padding: 0 12px;
  background: #14B8A6; color: #fff;
  border: none; border-radius: 8px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #0D9488; }
`;
export const PinnedDocLoading = styled.div`
  text-align: center; padding: 40px; color: #94A3B8; font-size: 13px;
`;
export const PinnedDocEmpty = styled.div`
  text-align: center; padding: 40px; color: #DC2626; font-size: 13px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 12px;
`;
// 중립 안내(표 문서 등) — 에러 아님. 세로 정렬 + 버튼.
export const PinnedDocInfo = styled.div`
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  text-align: center; padding: 40px; color: #64748B; font-size: 13px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px;
`;

// ───────── Dashboard Timeline (공용 GanttTrack) ─────────
// ───────── styled ─────────
export const BackBtn = styled.button`padding:6px 12px;background:#FFF;color:#334155;border:1px solid #CBD5E1;border-radius:8px;font-size:12px;cursor:pointer;&:hover{background:#F8FAFC;border-color:#94A3B8;}`;
export const TabBar = styled.div`display:flex;gap:4px;border-bottom:1px solid #E2E8F0;background:#FFF;padding:0 20px;margin:-20px -20px 20px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;&::-webkit-scrollbar{display:none;}`;
export const TabFallback = styled.div`padding:40px 24px;text-align:center;font-size:13px;color:#94A3B8;`;
export const Tab = styled.button<{$active:boolean}>`
  padding:12px 14px;background:transparent;border:none;color:${p=>p.$active?'#0F766E':'#64748B'};
  font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid ${p=>p.$active?'#14B8A6':'transparent'};
  display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex:0 0 auto;
  &:hover{color:#0F766E;}
`;
export const InfoBody = styled.div`display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:16px;@media (max-width:900px){grid-template-columns:1fr;}`;
// #96 — PostsPage(Layout height:100%) 를 프로젝트 탭에 임베드. 경계 높이 부여 → 내부 사이드바·그리드 자체 스크롤.
//   상단 네비(64)+PageShell 헤더(60)+Body padding+TabBar 보정. Body padding(20) 상쇄 위해 음수 마진.
export const ProjectDocsWrap = styled.div`
  height: calc(100vh - 210px);
  min-height: 460px;
  margin: -20px;
  @media (max-width: 768px) { height: calc(100vh - 180px); margin: -16px; }
`;
export const EditGrid = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:12px;`;
export const EditField = styled.div`display:flex;flex-direction:column;gap:4px;`;
export const EditLabel = styled.span`font-size:11px;color:#64748B;font-weight:700;`;
export const EditHint = styled.div`font-size:10px;color:#94A3B8;margin-top:4px;line-height:1.5;`;
export const EditInput = styled.input`height:34px;padding:0 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
export const EditTextarea = styled.textarea`padding:8px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;font-family:inherit;resize:vertical;&:focus{outline:none;border-color:#14B8A6;}`;
export const TypeBtn2 = styled.button<{$active?:boolean}>`flex:1;padding:8px 12px;border:1px solid ${p=>p.$active?'#14B8A6':'#E2E8F0'};background:${p=>p.$active?'#F0FDFA':'#FFF'};color:${p=>p.$active?'#0F766E':'#334155'};border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;&:hover{border-color:#14B8A6;}`;
export const EditDateRangeTrigger = styled.button`width:100%;height:34px;padding:0 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:13px;color:#0F172A;background:#FFF;font-family:inherit;text-align:left;cursor:pointer;&:hover{border-color:#14B8A6;}`;
export const DatePH = styled.span`color:#94A3B8;`;
export const ColorRow = styled.div`display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-start;padding:2px 0;width:100%;`;
export const ColorSwatch = styled.button<{$active?:boolean}>`width:28px;height:28px;border-radius:50%;border:2px solid ${p=>p.$active?'#0F172A':'#E2E8F0'};cursor:pointer;padding:0;transition:transform 0.15s;&:hover{transform:scale(1.1);}`;
export const HexRow = styled.div`display:flex;align-items:center;gap:8px;margin-top:8px;`;
export const HexPreview = styled.div`width:28px;height:28px;border-radius:8px;border:1px solid #E2E8F0;flex-shrink:0;`;
export const HexNativePicker = styled.input`
  width:36px;height:28px;padding:0;border:1px solid #CBD5E1;border-radius:6px;background:transparent;cursor:pointer;
  &::-webkit-color-swatch-wrapper{padding:2px;}
  &::-webkit-color-swatch{border:none;border-radius:4px;}
`;
export const HexInput = styled.input`
  width:110px;height:28px;padding:0 10px;border:1px solid #CBD5E1;border-radius:6px;
  font-size:12px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;color:#0F172A;letter-spacing:0.5px;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 2px rgba(20,184,166,0.15);}
`;
export const ClientsBody = styled.div``;
export const Card = styled.div`background:#FFF;border:1px solid #E2E8F0;border-radius:10px;padding:16px;`;
export const CardTitle = styled.h3`margin:0 0 12px;font-size:14px;font-weight:700;color:#0F172A;display:flex;align-items:center;gap:8px;small{font-size:11px;font-weight:600;color:#64748B;}`;

// 상태 변경 이력 타임라인 (기본 히스토리)
export const ProjHistEmpty = styled.div`font-size:12px;color:#94A3B8;`;
export const ProjHistList = styled.div`display:flex;flex-direction:column;gap:12px;`;
export const ProjHistRow = styled.div`display:flex;gap:10px;align-items:flex-start;`;
export const ProjHistDot = styled.div`width:8px;height:8px;border-radius:999px;background:#14B8A6;margin-top:5px;flex-shrink:0;`;
export const ProjHistBody = styled.div`display:flex;flex-direction:column;gap:2px;min-width:0;`;
export const ProjHistMain = styled.div`display:flex;align-items:center;gap:6px;flex-wrap:wrap;`;
export const ProjHistChip = styled.span<{ $to?: boolean }>`font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:${p => (p.$to ? '#F0FDFA' : '#F1F5F9')};color:${p => (p.$to ? '#0F766E' : '#64748B')};`;
export const ProjHistArrow = styled.span`font-size:12px;color:#94A3B8;`;
export const ProjHistMeta = styled.div`font-size:11px;color:#94A3B8;`;


export const ConvList = styled.div`display:flex;flex-direction:column;gap:6px;`;
export const ConvRow = styled.div`
  position:relative;display:flex;align-items:center;gap:10px;padding:8px 10px;
  border:1px solid #E2E8F0;border-radius:6px;cursor:pointer;
  &:hover{border-color:#14B8A6;background:#F0FDFA;}
  &:hover .conv-more-btn{opacity:1;}
`;
export const ConvMoreBtn = styled.button.attrs({ className: 'conv-more-btn' })`
  width:24px;height:24px;background:transparent;border:none;border-radius:4px;
  display:inline-flex;align-items:center;justify-content:center;color:#64748B;cursor:pointer;
  opacity:0;transition:opacity 0.15s,background 0.15s;
  &:hover{background:#FFFFFF;color:#0F172A;}
  &:focus-visible{opacity:1;outline:1px solid #14B8A6;}
`;
export const ConvMenu = styled.div`
  position:absolute;right:6px;top:calc(100% - 4px);z-index:20;
  min-width:160px;padding:4px;background:#FFFFFF;
  border:1px solid #E2E8F0;border-radius:8px;
  box-shadow:0 4px 12px rgba(0,0,0,0.06);
`;
export const ConvMenuBtn = styled.button<{$danger?:boolean}>`
  width:100%;padding:8px 10px;text-align:left;font-size:12px;font-weight:500;
  color:${p=>p.$danger?'#DC2626':'#334155'};
  background:transparent;border:none;border-radius:6px;cursor:pointer;
  transition:background 0.15s;
  &:hover{background:${p=>p.$danger?'#FEF2F2':'#F8FAFC'};}
`;
export const ConvChannel = styled.span<{$type:string}>`
  padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;flex-shrink:0;
  background:${p=>p.$type==='customer'?'#FFF1F2':p.$type==='internal'?'#F0FDFA':'#F1F5F9'};
  color:${p=>p.$type==='customer'?'#9F1239':p.$type==='internal'?'#0F766E':'#475569'};
`;
export const ConvTitle = styled.span`flex:1;font-size:13px;color:#0F172A;`;


export const ClientList = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:12px;`;
export const ClientRow = styled.div`display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid #E2E8F0;border-radius:6px;strong{flex:1;font-size:13px;color:#0F172A;}span{font-size:12px;color:#64748B;}`;
export const ClientStatusPill = styled.span<{ $joined: boolean }>`
  flex-shrink:0;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:600;white-space:nowrap;
  ${p=>p.$joined?'background:#CCFBF1;color:#0F766E;':'background:#FEF3C7;color:#92400E;'}
`;
export const ClientDelBtn = styled.button`width:24px;height:24px;border:none;background:transparent;color:#94A3B8;cursor:pointer;border-radius:4px;font-size:14px;&:hover{background:#FEE2E2;color:#DC2626;}`;
export const InviteSentAt = styled.span`font-size:11px!important;color:#94A3B8!important;white-space:nowrap;`;
export const ResendBtn = styled.button`
  height:26px;padding:0 10px;border:1px solid #CBD5E1;background:#fff;color:#0F766E;
  border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;
  &:hover:not(:disabled){background:#F0FDFA;border-color:#14B8A6;}
  &:disabled{opacity:0.5;cursor:not-allowed;}
`;
// ── Close Project modal ──
export const CloseBackdrop = styled.div`position:fixed;inset:0;background:rgba(15,23,42,0.40);z-index: 1000;display:flex;align-items:center;justify-content:center;padding:20px;animation:cpfade 0.15s ease-out;@keyframes cpfade{from{opacity:0;}to{opacity:1;}}`;
export const CloseDialog = styled.div`width:100%;max-width:520px;background:#FFF;border-radius:14px;box-shadow:0 24px 48px rgba(15,23,42,0.20);display:flex;flex-direction:column;max-height:88vh;overflow:hidden;`;
export const CloseHeader = styled.h2`font-size:16px;font-weight:700;color:#0F172A;margin:0;padding:18px 22px;border-bottom:1px solid #E2E8F0;`;
export const CloseBody = styled.div`padding:18px 22px;font-size:13px;color:#334155;line-height:1.6;overflow-y:auto;& p{margin:0 0 8px;}& ul{margin:0 0 12px 18px;padding:0;}& li{margin-bottom:2px;}`;
export const ClientsChoiceTitle = styled.div`font-size:13px;font-weight:700;color:#0F172A;margin:14px 0 4px;`;
export const ClientsChoiceHint = styled.div`font-size:11px;color:#94A3B8;line-height:1.5;margin-bottom:8px;`;
export const ClientChoiceList = styled.div`display:flex;flex-direction:column;gap:6px;padding:10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;max-height:200px;overflow-y:auto;`;
export const ClientChoiceRow = styled.label`display:flex;align-items:center;gap:8px;font-size:12px;color:#0F172A;cursor:pointer;& input{accent-color:#14B8A6;}& strong{font-weight:600;}`;
export const ClientChoiceEmail = styled.span`color:#64748B;font-size:11px;margin-left:auto;`;
export const CloseFooter = styled.div`padding:14px 22px;border-top:1px solid #E2E8F0;display:flex;justify-content:flex-end;gap:8px;background:#FAFBFC;flex-shrink:0;`;
export const CFCancelBtn = styled.button`height:40px;padding:0 16px;background:#FFF;color:#475569;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;&:hover:not(:disabled){background:#F8FAFC;}&:disabled{opacity:0.5;cursor:not-allowed;}`;
export const CFConfirmBtn = styled.button`height:40px;padding:0 20px;background:#14B8A6;color:#FFF;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;&:hover:not(:disabled){background:#0D9488;}&:disabled{background:#CBD5E1;cursor:not-allowed;}`;

export const LinkClientBar = styled.div`display:flex;gap:10px;align-items:center;padding:10px 12px;background:#F0FDFA;border:1px solid #CCFBF1;border-radius:8px;margin-bottom:8px;`;
export const LinkClientLabel = styled.span`font-size:12px;font-weight:600;color:#0F766E;flex-shrink:0;`;
export const AddClientForm = styled.form`display:flex;gap:6px;align-items:center;padding:10px;background:#F8FAFC;border-radius:8px;border:1px dashed #E2E8F0;margin-top:4px;`;
export const ClientInput = styled.input`flex:1;padding:6px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
export const AddClientBtn = styled.button`padding:6px 12px;background:#14B8A6;color:#FFF;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;&:hover:not(:disabled){background:#0D9488;}&:disabled{background:#CBD5E1;cursor:not-allowed;}`;

export const Dim = styled.div`padding:16px;text-align:center;font-size:12px;color:#94A3B8;`;

// 프로젝트 멤버 카드
export const MemberList = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:8px;`;
export const MemberRow = styled.div`display:flex;align-items:center;gap:8px;padding:6px 8px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;`;
export const MemberName = styled.div`flex:1;min-width:0;font-size:13px;font-weight:600;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px;`;
export const OwnerTag = styled.span`padding:1px 6px;font-size:10px;font-weight:600;background:#F0FDFA;color:#0F766E;border-radius:6px;`;
export const PmTag = styled.span`padding:1px 6px;font-size:10px;font-weight:700;background:#EEF2FF;color:#4338CA;border-radius:6px;letter-spacing:0.2px;`;
export const MemberRoleInput = styled.input`flex:0 0 120px;min-width:80px;height:28px;padding:0 8px;font-size:12px;color:#0F172A;border:1px solid transparent;background:transparent;border-radius:6px;font-family:inherit;&:hover:not(:disabled){background:#FFF;border-color:#E2E8F0;}&:focus{outline:none;background:#FFF;border-color:#14B8A6;}&:disabled{color:#94A3B8;cursor:not-allowed;}`;
export const PmToggle = styled.button<{ $active: boolean }>`
  flex-shrink:0;width:36px;height:24px;padding:0;font-size:10px;font-weight:700;letter-spacing:0.3px;
  border-radius:6px;cursor:pointer;transition:background 0.12s, color 0.12s, border-color 0.12s;
  ${p => p.$active
    ? 'background:#4338CA;color:#fff;border:1px solid #4338CA;'
    : 'background:#fff;color:#94A3B8;border:1px solid #CBD5E1;'}
  &:hover:not(:disabled){ ${p => p.$active ? 'background:#3730A3;' : 'background:#F8FAFC;color:#4338CA;border-color:#4338CA;'} }
  &:disabled{ background:#EEF2FF;color:#4338CA;border:1px solid #C7D2FE;cursor:not-allowed;opacity:0.85; }
`;
export const MemberRemoveBtn = styled.button`width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#94A3B8;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;&:hover{background:#FEE2E2;color:#DC2626;}`;
export const AddMemberBox = styled.div`display:flex;flex-direction:column;gap:6px;padding:8px;background:#FFF;border:1px solid #E2E8F0;border-radius:8px;margin-top:6px;`;
export const MemberCandidateList = styled.div`display:flex;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto;`;
export const MemberCandidateItem = styled.button`display:flex;flex-direction:column;gap:2px;padding:6px 10px;text-align:left;background:transparent;border:none;border-radius:4px;font-size:12px;color:#0F172A;cursor:pointer;&:hover{background:#F0FDFA;color:#0F766E;}`;
export const MemberEmail = styled.span`font-size:10px;color:#94A3B8;`;
export const AddMemberCancelBtn = styled.button`align-self:flex-start;padding:5px 10px;background:transparent;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;color:#64748B;cursor:pointer;&:hover{background:#F8FAFC;color:#0F172A;}`;
export const AddMemberLink = styled.button`margin-top:8px;padding:6px 0;background:transparent;border:none;color:#94A3B8;font-size:12px;font-weight:500;cursor:pointer;text-align:left;font-family:inherit;&:hover{color:#0F766E;}`;
export const IssueList = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:10px;`;
export const IssueRow = styled.div`padding:8px 10px;background:#F8FAFC;border-radius:6px;display:flex;flex-direction:column;gap:2px;`;
export const IssueBody = styled.div`font-size:12px;color:#0F172A;line-height:1.5;display:flex;align-items:center;gap:6px;strong{font-size:12px;}`;
export const IssueMeta = styled.div`font-size:10px;color:#94A3B8;`;
/* 상세 탭의 전략 요약 (#148) — 개요와 같은 데이터를 읽기 전용으로 비춘다 */
export const ReadOnlyHint = styled.span`
  margin-left:8px;padding:2px 8px;border-radius:10px;
  font-size:11px;font-weight:500;color:#94A3B8;background:#F1F5F9;
`;
export const StrategyEditLink = styled.button`
  margin-left:auto;padding:2px 8px;border:none;background:none;cursor:pointer;
  font-size:12px;font-weight:600;font-family:inherit;color:#0D9488;border-radius:6px;
  &:hover{background:#F0FDFA;}
  &:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(20,184,166,0.3);}
`;
export const StrategyBlock = styled.div`& + &{margin-top:16px;}`;
export const StrategyLabel = styled.div`font-size:12px;font-weight:600;color:#64748B;margin-bottom:6px;`;
export const StrategyText = styled.div`font-size:13px;font-weight:500;color:#334155;line-height:1.6;white-space:pre-wrap;`;

export const AddIssueRow = styled.div`display:flex;gap:6px;align-items:center;`;
/* 이슈·메모 등록 버튼 (#148) — Enter 없이도 등록할 수 있어야 한다 (태블릿·모바일). Primary 토큰. */
export const AddBtn = styled.button`
  flex-shrink:0;height:32px;min-width:56px;padding:0 12px;
  font-size:12px;font-weight:600;font-family:inherit;
  color:#fff;background:#14B8A6;border:1px solid #14B8A6;border-radius:6px;cursor:pointer;
  transition:background 0.15s, border-color 0.15s;
  &:hover:not(:disabled){background:#0D9488;border-color:#0D9488;}
  &:active:not(:disabled){background:#0F766E;border-color:#0F766E;}
  &:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(20,184,166,0.3);}
  &:disabled{background:#E2E8F0;border-color:#E2E8F0;color:#94A3B8;cursor:not-allowed;}
`;
export const IssueInput = styled.input`flex:1;padding:6px 10px;border:1px solid #E2E8F0;border-radius:6px;font-size:12px;font-family:inherit;&:focus{outline:none;border-color:#14B8A6;}`;
export const VisTag = styled.span<{$internal?:boolean}>`padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;flex-shrink:0;background:${p=>p.$internal?'#F0FDFA':'#F1F5F9'};color:${p=>p.$internal?'#0F766E':'#64748B'};`;
export const Empty = styled.div`padding:60px;text-align:center;color:#94A3B8;`;

export const HeaderActions = styled.div`display: flex; align-items: center; gap: 8px;`;
export const HeaderBtn = styled.button`
  height: 32px; padding: 0 12px; border-radius: 8px; cursor: pointer;
  font-size: 12px; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4;
  &:hover { background: #CCFBF1; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
