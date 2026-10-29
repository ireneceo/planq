// 위험 구역(Danger Zone) 껍데기 — 계정 탈퇴(프로필)·워크스페이스 삭제(설정)가 같이 쓴다.
//   2026-10-29 AccountDeletionSection 에서 값 그대로 옮겼다(docs/WORKSPACE_DELETION_DESIGN.md ⑤-1 «껍데기 재사용»).
//   베끼면 갈라진다 — 새 위험 동작도 여기 조각을 쓴다.
import styled from 'styled-components';

export const Zone = styled.div`
  grid-column: 1 / -1;
  margin-top: 8px;
  padding: 20px;
  border: 1px solid #fecaca;
  border-radius: 12px;
  background: #fff;
`;
export const ZoneTitle = styled.h3`font-size: 0.9375rem; font-weight: 700; color: #b91c1c; margin: 0 0 6px;`;
export const ZoneDesc = styled.p`font-size: 0.8125rem; color: #64748b; margin: 0 0 12px; line-height: 1.5;`;
export const ExportHint = styled.p`font-size: 0.78125rem; color: #475569; margin: 0 0 14px;`;
export const ExportLink = styled.a`color: #0f766e; font-weight: 600; text-decoration: none; &:hover { text-decoration: underline; }`;
export const BlockCard = styled.div`
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
  padding: 12px 14px; margin-bottom: 12px;
`;
export const BlockTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #b91c1c; margin-bottom: 4px;`;
export const BlockBody = styled.div`font-size: 0.78125rem; color: #7f1d1d; line-height: 1.5;`;
export const BlockWs = styled.div`font-size: 0.78125rem; color: #7f1d1d; margin-top: 2px;`;
export const SoloHint = styled.div`
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
  padding: 10px 14px; margin-bottom: 12px; font-size: 0.78125rem; color: #92400e; line-height: 1.5;
`;
export const SoloWs = styled.div`margin-top: 2px;`;
export const DeleteBtn = styled.button`
  height: 40px; padding: 0 18px; border-radius: 8px;
  border: 1px solid #ef4444; background: #fff; color: #dc2626;
  font-size: 0.84375rem; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #fef2f2; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`;
export const ConfirmWarn = styled.p`
  font-size: 0.8125rem; color: #7f1d1d; background: #fef2f2; border: 1px solid #fecaca;
  border-radius: 8px; padding: 12px 14px; margin: 0 0 16px; line-height: 1.5;
`;
export const FieldLabel = styled.label`display: block; font-size: 0.78125rem; font-weight: 600; color: #334155; margin: 0 0 6px;`;
export const Input = styled.input`
  width: 100%; height: 40px; padding: 0 12px; margin-bottom: 16px;
  border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.875rem;
  &:focus { outline: none; border-color: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,0.12); }
`;
export const ErrText = styled.p`font-size: 0.78125rem; color: #dc2626; margin: -6px 0 8px;`;
