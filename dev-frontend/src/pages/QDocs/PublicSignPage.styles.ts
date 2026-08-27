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
export const TopMeta = styled.span`font-size:12px;color:#64748B;`;

export const ProgressBar = styled.nav`
  display: flex; gap: 0; padding: 0; background: #fff;
  border-bottom: 1px solid #E2E8F0;
  overflow-x: auto;
  &::-webkit-scrollbar { display: none; }
`;
export const Step = styled.div<{ $active: boolean; $done: boolean }>`
  flex: 1; min-width: 100px; padding: 12px 16px;
  font-size: 12px; font-weight: 600;
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

export const Section = styled.section`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 14px;
  padding: 24px;
  @media (max-width: 640px) { padding: 16px; border-radius: 12px; }
`;
export const SectionTitle = styled.h2`
  font-size: 18px; font-weight: 700; color: #0F172A; margin: 0 0 8px 0; line-height: 1.4;
`;
export const SectionDesc = styled.p`
  font-size: 13px; color: #64748B; margin: 0 0 16px 0; line-height: 1.55;
`;
export const NoteBox = styled.div`
  margin: 8px 0 16px; padding: 12px 14px;
  font-size: 13px; color: #334155; line-height: 1.55;
  background: #F8FAFC; border-left: 3px solid #14B8A6; border-radius: 0 8px 8px 0;
  white-space: pre-wrap;
`;
export const ProjectChip = styled.div`
  display: inline-flex; align-items: center; gap: 6px;
  margin: 0 0 12px;
  padding: 4px 10px;
  font-size: 12px; font-weight: 600; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 999px;
`;
export const DocBody = styled.div`
  margin-top: 12px; padding-top: 16px;
  border-top: 1px solid #E2E8F0;
`;

// 별첨 (2026-08-27) — 서명 대상에 포함된 파일 목록. 기존 카드 톤(NoteBox·DocBody)과 같은 결.
export const AttachBox = styled.div`
  margin-top: 16px; padding-top: 14px;
  border-top: 1px solid #E2E8F0;
`;
export const AttachTitle = styled.div`
  font-size: 12px; font-weight: 700; color: #475569; letter-spacing: -0.1px;
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
  flex: 1; min-width: 0; font-size: 13px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
export const AttachSize = styled.span`
  flex-shrink: 0; font-size: 12px; color: #94A3B8;
`;

// OTP
export const OtpRow = styled.div`
  display: flex; gap: 8px; margin: 8px 0 12px;
  @media (max-width: 480px) { gap: 4px; }
`;
export const OtpInput = styled.input`
  width: 52px; height: 56px;
  text-align: center;
  font-size: 22px; font-weight: 700; color: #0F172A;
  border: 1px solid #CBD5E1; border-radius: 10px; background: #fff;
  font-variant-numeric: tabular-nums;
  transition: border-color 0.15s, box-shadow 0.15s;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  @media (max-width: 480px) { width: 44px; height: 52px; font-size: 20px; }
`;
export const OtpActions = styled.div`display: flex; gap: 8px; align-items: center; flex-wrap: wrap;`;
export const ResendBtn = styled.button`
  height: 36px; padding: 0 14px;
  font-size: 12px; font-weight: 600; color: #475569;
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
export const Canvas = styled.canvas`
  flex: 1; width: 100%; touch-action: none;
  cursor: crosshair;
`;
export const CanvasPlaceholder = styled.div`
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
  font-size: 14px; color: #CBD5E1;
`;
export const CanvasClear = styled.button`
  position: absolute; top: 8px; right: 8px;
  height: 36px; padding: 0 14px;
  font-size: 11px; font-weight: 600; color: #64748B;
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
export const ConsentTitle = styled.div`font-size:13px;font-weight:600;color:#0F172A;line-height:1.5;`;
export const ConsentHint = styled.div`font-size:11px;color:#94A3B8;margin-top:2px;line-height:1.5;`;

// 액션
export const ActionRow = styled.div`
  display: flex; gap: 8px; justify-content: flex-end;
  margin-top: 16px;
  @media (max-width: 480px) { flex-direction: column-reverse; & button { width: 100%; } }
`;
export const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  height: 44px; padding: 0 18px;
  font-size: 14px; font-weight: 700; color: #fff;
  background: #14B8A6; border: none; border-radius: 10px; cursor: pointer;
  transition: background 0.15s, transform 0.15s;
  &:hover:not(:disabled) { background: #0D9488; transform: translateY(-1px); }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
export const SecondaryBtn = styled.button`
  height: 44px; padding: 0 16px;
  font-size: 14px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; border-color: #CBD5E1; }
`;
export const RejectBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  height: 44px; padding: 0 16px;
  font-size: 14px; font-weight: 600; color: #DC2626;
  background: #fff; border: 1px solid #EF4444; border-radius: 10px; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF2F2; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

export const ErrorBox = styled.div`
  font-size: 12px; color: #DC2626; background: #FEF2F2;
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
  & h3 { margin: 0 0 8px; font-size: 17px; font-weight: 700; color: #0F172A; }
  & p { margin: 0 0 14px; font-size: 13px; color: #64748B; line-height: 1.55; }
`;
export const Textarea = styled.textarea`
  width: 100%; padding: 10px 12px;
  font-size: 13px; color: #0F172A; line-height: 1.55;
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
export const ResultTitle = styled.h2`font-size:20px;font-weight:700;color:#0F172A;margin:0;`;
export const ResultMeta = styled.div`font-size:13px;color:#64748B;`;
export const ResultHint = styled.p`font-size:13px;color:#475569;margin:8px 0 0;line-height:1.55;max-width:480px;`;
export const SignatureSnap = styled.div`
  margin-top: 12px; padding: 10px 14px;
  background: #FAFBFC; border: 1px solid #E2E8F0; border-radius: 10px;
  & img { max-width: 240px; max-height: 100px; display: block; }
`;

// 로딩 / 에러
export const LoadingCenter = styled.div`
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 10px;
  color: #64748B; font-size: 14px;
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
export const ErrorTitle = styled.h2`font-size:17px;font-weight:700;color:#0F172A;margin:0;text-align:center;`;
export const ErrorHint = styled.p`font-size:13px;color:#64748B;margin:0;text-align:center;`;

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
  font: inherit; font-size: 14px; line-height: 1.6; color: #0F172A;
  resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
`;
export const ConfirmActions = styled.div` display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; `;
export const ConfirmedComment = styled.div`
  margin-top: 12px; padding: 10px 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; line-height: 1.6; color: #334155; white-space: pre-wrap;
`;

