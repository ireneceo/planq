// PublicSignPage 의 styled-components 모음.
//
// 왜 갈라냈나: #239 로 '확인 요청' 화면이 붙으면서 한 파일이 808줄이 되어 god-file 래칫(컴포넌트 800)에
// 걸렸다. 로직과 스타일 중 **스타일만** 떼는 게 가장 안전한 절단면이다 — 렌더 흐름을 건드리지 않는다.
// 새 스타일은 여기에 추가한다.
import styled from 'styled-components';

export const Page = styled.div`
  min-height: 100vh; background: #F8FAFC; color: #0F172A;
  display: flex; flex-direction: column;
  font-family: inherit;
`;
export const Topbar = styled.header`
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px;
  background: #fff; border-bottom: 1px solid #E2E8F0;
  position: sticky; top: 0; z-index: 10;
`;
export const Brand = styled.img`display:block;width:120px;height:auto;user-select:none;`;
export const TopMeta = styled.span`font-size:0.75rem;color:#64748B;`;

export const ProgressBar = styled.nav`
  display: flex; gap: 0; padding: 0; background: #fff;
  border-bottom: 1px solid #E2E8F0;
  overflow-x: auto;
  &::-webkit-scrollbar { display: none; }
`;
export const Step = styled.div<{ $active: boolean; $done: boolean }>`
  flex: 1; min-width: 100px; padding: 12px 16px;
  font-size: 0.75rem; font-weight: 600;
  text-align: center; white-space: nowrap;
  color: ${p => p.$active ? '#0F766E' : p.$done ? '#14B8A6' : '#94A3B8'};
  border-bottom: 2px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  position: relative;
  &:not(:last-child)::after {
    content: '›'; position: absolute; right: 0; top: 50%; transform: translateY(-50%);
    color: #CBD5E1; font-weight: 400;
  }
`;

export const Content = styled.main`
  flex: 1; max-width: 760px; width: 100%;
  margin: 0 auto; padding: 24px 20px 40px;
  display: flex; flex-direction: column; gap: 20px;
  @media (max-width: 640px) { padding: 16px 12px 32px; gap: 16px; }
`;

export const Section = styled.section<{ $nudge?: boolean }>`
  background: #fff; border: 1px solid ${p => (p.$nudge ? '#F43F5E' : '#E2E8F0')}; border-radius: 14px;
  padding: 24px;
  box-shadow: ${p => (p.$nudge ? '0 0 0 4px rgba(244,63,94,0.12)' : 'none')};
  transition: border-color 0.2s, box-shadow 0.2s;
  scroll-margin-top: 16px;
  @media (max-width: 640px) { padding: 16px; border-radius: 12px; }
`;
// 내 서명 칸을 눌렀을 때 «여기서 서명한다» 를 말하는 줄(2026-10-05)
export const NudgeNote = styled.div`
  margin: 0 0 12px; padding: 10px 12px; border-radius: 8px;
  background: #FFF1F2; color: #9F1239; font-size: 0.8125rem; line-height: 1.55;
`;
export const SectionTitle = styled.h2`
  font-size: 1.125rem; font-weight: 700; color: #0F172A; margin: 0 0 8px 0; line-height: 1.4;
`;
export const SectionDesc = styled.p`
  font-size: 0.8125rem; color: #64748B; margin: 0 0 16px 0; line-height: 1.55;
`;
export const NoteBox = styled.div`
  margin: 8px 0 16px; padding: 12px 14px;
  font-size: 0.8125rem; color: #334155; line-height: 1.55;
  background: #F8FAFC; border-left: 3px solid #14B8A6; border-radius: 0 8px 8px 0;
  white-space: pre-wrap;
`;
export const ProjectChip = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  margin: 0 0 12px;
  padding: 4px 10px;
  font-size: 0.75rem; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 999px;
`;
// $mySlot — 이 서명자의 칸. 문서 안에서 **그 칸만** 테두리로 집어 준다.
//   서명란 규격(.pq-sig*)은 서버 services/signedDocument.js `SIGNED_CSS` 가 정본이고,
//   여기서는 화면 톤과 «내 칸» 강조만 얹는다.
export const DocBody = styled.div<{ $mySlot?: number | null; $mySlotHint?: string; $locate?: boolean }>`
  margin-top: 12px; padding-top: 16px;
  border-top: 1px solid #E2E8F0;

  .pq-sig { border: 1px solid #CBD5E1; border-radius: 8px; padding: 10px 12px; margin: 12px 0; min-height: 64px; }
  .pq-sig-cap { font-size: 0.6875rem; font-weight: 700; color: #64748B; margin-bottom: 4px; }
  .pq-sig-empty { color: #94A3B8; font-size: 0.75rem; border-bottom: 1px dashed #CBD5E1; padding-bottom: 14px; }
  .pq-sig-done { border-color: #14B8A6; background: #F0FDFA; }
  .pq-sig-img { display: block; max-height: 96px; max-width: min(300px, 100%); }
  .pq-sig-meta { font-size: 0.75rem; color: #334155; margin-top: 4px; }
  .pq-sig-badge { font-size: 0.625rem; color: #0F766E; margin-top: 2px; }
  .pq-sig-rejected { border-color: #FCA5A5; background: #FEF2F2; }
  /* 2026-10-05 서명 항목 — 서명일·이름 칸(services/signedDocument dateItemHtml·nameItemHtml) */
  .pq-sig-item { display: inline-block; min-width: 120px; padding: 2px 6px; border-bottom: 1px dashed #CBD5E1; color: #94A3B8; font-size: 0.8125rem; }
  .pq-sig-item.pq-sig-filled { color: #0F172A; border-bottom-color: #14B8A6; }
  .pq-sig-no { color: #B91C1C; font-size: 0.75rem; font-weight: 700; padding: 6px 0; }
  .pq-sig-zone { margin-top: 20px; display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }

  ${p => (p.$mySlot != null ? `
  .pq-sig[data-slot="${p.$mySlot}"] {
    border: 2px solid #F43F5E; background: #FFF1F2;
    box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.12);
  }
  .pq-sig[data-slot="${p.$mySlot}"] { cursor: pointer; }
  .pq-sig[data-slot="${p.$mySlot}"] .pq-sig-cap::after {
    content: ' ← ' ${JSON.stringify(String(p.$mySlotHint || ''))};
    color: #F43F5E; font-weight: 600;
  }
  ${p.$locate ? `
  /* «서명하겠습니다» 를 누른 뒤 — 내 칸이 어디인지 눈에 띄게(맥박) */
  @keyframes pqSigLocate { 0%,100% { box-shadow: 0 0 0 4px rgba(244,63,94,0.12); } 50% { box-shadow: 0 0 0 10px rgba(244,63,94,0.28); } }
  .pq-sig[data-slot="${p.$mySlot}"] { animation: pqSigLocate 1.2s ease-in-out 3; }
  ` : ''}
  ` : '')}
`;
export const SignedHtml = styled.div`
  font-size: 0.9375rem; line-height: 1.75; color: #1E293B;
  h1, h2, h3 { margin: 1.2em 0 0.5em; line-height: 1.35; }
  p { margin: 0 0 0.75em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #E2E8F0; padding: 6px 8px; }
  img { max-width: 100%; }
`;

// 별첨 (2026-08-27) — 서명 대상에 포함된 파일 목록. 기존 카드 톤(NoteBox·DocBody)과 같은 결.
export const AttachBox = styled.div`
  margin-top: 16px; padding-top: 14px;
  border-top: 1px solid #E2E8F0;
`;
export const AttachTitle = styled.div`
  font-size: 0.75rem; font-weight: 700; color: #475569; letter-spacing: -0.1px;
  margin-bottom: 8px;
`;
export const AttachRow = styled.a`
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; margin-bottom: 6px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  background: #fff; text-decoration: none; color: #0F172A;
  min-height: 44px;   /* 폰 터치 타깃 — 토큰 44 */
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
`;
export const AttachIcon = styled.svg`
  /* height 를 px 로 박지 않는다 — 컨트롤 높이 래칫이 잡는다. 정사각은 aspect-ratio 로. */
  width: 16px; aspect-ratio: 1 / 1; flex-shrink: 0; color: #64748B;
`;
export const AttachName = styled.span`
  flex: 1; min-width: 0; font-size: 0.8125rem; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
export const AttachSize = styled.span`
  flex-shrink: 0; font-size: 0.75rem; color: #94A3B8;
`;

// OTP
export const OtpRow = styled.div`
  display: flex; gap: 8px; margin: 8px 0 12px;
  @media (max-width: 480px) { gap: 4px; }
`;
export const OtpInput = styled.input`
  width: 52px; height: 56px;
  text-align: center;
  font-size: 1.375rem; font-weight: 700; color: #0F172A;
  border: 1px solid #CBD5E1; border-radius: 10px; background: #fff;
  font-variant-numeric: tabular-nums;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  @media (max-width: 480px) { width: 44px; height: 52px; font-size: 1.25rem; }
`;
export const OtpActions = styled.div`display: flex; gap: 8px; align-items: center; flex-wrap: wrap;`;
export const ResendBtn = styled.button`
  height: 36px; padding: 0 14px;
  font-size: 0.75rem; font-weight: 600; color: #475569;
  background: transparent; border: 1px solid transparent; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { color: #0F766E; }
  &:disabled { color: #94A3B8; cursor: not-allowed; }
`;

// 캔버스
export const CanvasWrap = styled.div`
  position: relative;
  border: 2px dashed #CBD5E1; border-radius: 12px;
  background: #FAFBFC;
  height: 200px;
  display: flex; flex-direction: column;
  overflow: hidden;
  &:hover { border-color: #14B8A6; }
`;
export const CanvasPlaceholder = styled.div`
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
  font-size: 0.875rem; color: #CBD5E1;
`;
export const CanvasClear = styled.button`
  position: absolute; top: 8px; right: 8px;
  height: 36px; padding: 0 14px;
  font-size: 0.6875rem; font-weight: 600; color: #64748B;
  background: rgba(255,255,255,0.95); border: 1px solid #E2E8F0; border-radius: 999px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover:not(:disabled) { background: #FEF2F2; color: #DC2626; border-color: #FCA5A5; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

// 동의
export const ConsentBox = styled.div`
  display: flex; align-items: flex-start; gap: 10px;
  margin: 16px 0 8px;
  padding: 12px 14px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
  & input[type="checkbox"] { width: 16px; height: 16px; margin-top: 2px; accent-color: #14B8A6; cursor: pointer; }
`;
export const ConsentLabel = styled.label`flex: 1; cursor: pointer;`;
export const ConsentTitle = styled.div`font-size:0.8125rem;font-weight:600;color:#0F172A;line-height:1.5;`;
export const ConsentHint = styled.div`font-size:0.6875rem;color:#94A3B8;margin-top:2px;line-height:1.5;`;

// 액션
export const ActionRow = styled.div`
  display: flex; gap: 8px; justify-content: flex-end;
  margin-top: 16px;
  @media (max-width: 480px) { flex-direction: column-reverse; & button { width: 100%; } }
`;
export const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  height: 44px; padding: 0 18px;
  font-size: 0.875rem; font-weight: 700; color: #fff;
  background: #14B8A6; border: none; border-radius: 10px; cursor: pointer;
  transition: background 0.15s, transform 0.15s;
  &:hover:not(:disabled) { background: #0D9488; transform: translateY(-1px); }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
export const SecondaryBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;  /* <a> 로 써도(PDF 다운로드) 같은 높이·가운데 */
  text-decoration: none;
  height: 44px; padding: 0 16px;
  font-size: 0.875rem; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #CBD5E1; }
`;
export const RejectBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  height: 44px; padding: 0 16px;
  font-size: 0.875rem; font-weight: 600; color: #DC2626;
  background: #fff; border: 1px solid #EF4444; border-radius: 10px; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF2F2; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

export const ErrorBox = styled.div`
  font-size: 0.75rem; color: #DC2626; background: #FEF2F2;
  padding: 10px 12px; border-radius: 8px; margin-top: 8px; line-height: 1.5;
`;

// 거절 모달
export const RejectBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px;
`;
export const RejectDialog = styled.div`
  background: #fff; border-radius: 14px; max-width: 460px; width: 100%;
  padding: 24px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  & h3 { margin: 0 0 8px; font-size: 1.0625rem; font-weight: 700; color: #0F172A; }
  & p { margin: 0 0 14px; font-size: 0.8125rem; color: #64748B; line-height: 1.55; }
`;
export const Textarea = styled.textarea`
  width: 100%; padding: 10px 12px;
  font-size: 0.8125rem; color: #0F172A; line-height: 1.55;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  resize: vertical; font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
export const RejectActions = styled.div`display: flex; justify-content: flex-end; gap: 6px; margin-top: 14px;`;

// 결과
export const ResultCard = styled.section<{ $tone: 'ok' | 'reject' }>`
  background: #fff; border: 1px solid ${p => p.$tone === 'ok' ? '#14B8A6' : '#EF4444'};
  border-radius: 14px; padding: 36px 24px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  text-align: center;
`;
export const ResultIcon = styled.div<{ $tone: 'ok' | 'reject' }>`
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: ${p => p.$tone === 'ok' ? '#F0FDFA' : '#FEF2F2'};
  color: ${p => p.$tone === 'ok' ? '#0F766E' : '#DC2626'};
  border: 1px solid ${p => p.$tone === 'ok' ? '#14B8A6' : '#EF4444'};
  animation: pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  @keyframes pop { 0% { transform: scale(0.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
`;
export const ResultTitle = styled.h2`font-size:1.25rem;font-weight:700;color:#0F172A;margin:0;`;
export const ResultMeta = styled.div`font-size:0.8125rem;color:#64748B;`;
export const ResultHint = styled.p`font-size:0.8125rem;color:#475569;margin:8px 0 0;line-height:1.55;max-width:480px;`;
export const SignatureSnap = styled.div`
  margin-top: 12px; padding: 10px 14px;
  background: #FAFBFC; border: 1px solid #E2E8F0; border-radius: 10px;
  & img { max-width: min(320px, 100%); max-height: 140px; display: block; }
`;

// 서명 완료 뒤 갈 곳 — [서명한 문서 보기] [닫기]
export const DoneActions = styled.div`
  margin-top: 16px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
  & > button { min-width: 140px; }
  @media (max-width: 640px) { & > button { flex: 1 1 140px; min-height: 44px; } }
`;

// 로딩 / 에러
export const LoadingCenter = styled.div`
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 10px;
  color: #64748B; font-size: 0.875rem;
`;
export const ErrorCenter = styled.div`
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  padding: 40px 20px;
`;
export const ErrorIcon = styled.div`
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA;
`;
export const ErrorTitle = styled.h2`font-size:1.0625rem;font-weight:700;color:#0F172A;margin:0;text-align:center;`;
export const ErrorHint = styled.p`font-size:0.8125rem;color:#64748B;margin:0;text-align:center;`;

export const Spinner = styled.span`
  width: 16px; height: 16px;
  border: 2px solid #CBD5E1; border-top-color: #14B8A6;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
export const InlineSpinner = styled.span`
  width: 12px; height: 12px; margin-right: 6px;
  border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff;
  border-radius: 50%; animation: spin 0.7s linear infinite;
`;

// #239 확인 요청 전용 — 서명 UI 와 섞이지 않게 별도 스타일.
export const ConfirmTextArea = styled.textarea`
  width: 100%; margin-top: 10px; padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font: inherit; font-size: 0.875rem; line-height: 1.6; color: #0F172A;
  resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
`;
export const ConfirmActions = styled.div` display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; `;
export const ConfirmedComment = styled.div`
  margin-top: 12px; padding: 10px 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; line-height: 1.6; color: #334155; white-space: pre-wrap;
`;
// 서명 위치 안내 줄 — 본인 확인·서명 단계 맨 위. «위치 다시 보기» 는 문서의 내 칸으로 되돌아간다.
export const SlotLine = styled.div`
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 4px 0 10px;
  padding: 8px 12px; border-radius: 8px; background: #FFF1F2; border: 1px solid #FECDD3;
  font-size: 0.8125rem; color: #9F1239;
`;
export const SlotLink = styled.button`
  background: none; border: none; padding: 0; cursor: pointer; font-size: 0.8125rem; font-weight: 700; color: #BE123C;
  text-decoration: underline;
  &:focus-visible { outline: 2px solid #F43F5E; outline-offset: 2px; border-radius: 4px; }
`;
