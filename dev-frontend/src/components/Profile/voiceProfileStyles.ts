// components/Profile/voiceProfileStyles.ts — VoiceProfileSection 의 스타일 (800줄 기준을 넘어 나눴다, 값 그대로)
import styled from 'styled-components';

// ─── Styled (ProfilePage 에서 옮긴 값 그대로) ───────────────────
export const Banner = styled.div<{ $kind: 'error' | 'success' }>`
  padding: 12px 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  background: ${(p) => (p.$kind === 'error' ? '#fef2f2' : '#f0fdf4')};
  color: ${(p) => (p.$kind === 'error' ? '#b91c1c' : '#15803d')};
  border: 1px solid ${(p) => (p.$kind === 'error' ? '#fecaca' : '#bbf7d0')};
`;

export const SectionTitle = styled.h2`
  margin: 0 0 16px;
  font-size: 1rem;
  font-weight: 700;
  color: #0f172a;
`;

export const Description = styled.p`
  margin: 0 0 16px;
  color: #475569;
  font-size: 0.8125rem;
  line-height: 1.6;
  strong { color: #0f172a; font-weight: 600; }
`;

export const Hint = styled.div`
  font-size: 0.6875rem;
  color: #94a3b8;
`;

export const RegList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
`;

export const EmptyHint = styled.div`
  padding: 14px 16px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  font-size: 0.75rem;
  color: #64748b;
  text-align: center;
`;

export const RegItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  border-radius: 8px;
`;

export const RegLeft = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

export const RegLabel = styled.div`
  font-size: 0.8125rem;
  font-weight: 700;
  color: #0f172a;
`;

export const RegMeta = styled.div`
  font-size: 0.625rem;
  color: #0f766e;
`;

export const RegActions = styled.div`
  display: flex;
  gap: 6px;
`;

export const AddLangRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  margin-bottom: 10px;
`;

export const AddLangLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: #475569;

  svg { color: #0d9488; flex-shrink: 0; }
  strong { color: #0d9488; font-weight: 700; }
`;

export const ActionRow = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  padding-top: 8px;
  margin-top: 4px;
  border-top: 1px solid #f1f5f9;
`;

export const VerifyResultBox = styled.div<{ $match: boolean }>`
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 8px;
  background: ${(p) => (p.$match ? '#f0fdf4' : '#fff7ed')};
  border: 1px solid ${(p) => (p.$match ? '#bbf7d0' : '#fed7aa')};
`;

export const VerifyResultLine = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 0.8125rem;
  color: #0f172a;
  strong { font-weight: 700; }
  span { font-size: 0.6875rem; color: #64748b; font-variant-numeric: tabular-nums; }
`;

export const VerifyResultMsg = styled.div`
  font-size: 0.6875rem;
  color: #475569;
`;

export const VerifyPerLang = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #e2e8f0;
`;

export const VerifyPerLangItem = styled.div`
  display: flex;
  gap: 6px;
  font-size: 0.6875rem;
  color: #64748b;
  strong { color: #0f172a; font-weight: 700; font-variant-numeric: tabular-nums; }
`;

export const RecorderBox = styled.div`
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f1f5f9;
`;

export const SampleSentenceBox = styled.div`
  margin-bottom: 12px;
`;

export const SampleLabel = styled.div`
  font-size: 0.6875rem;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 6px;
  letter-spacing: 0.02em;
`;

export const SampleSentence = styled.div`
  padding: 12px 14px;
  background: #f8fafc;
  border-radius: 8px;
  font-size: 0.8125rem;
  color: #0f172a;
  line-height: 1.7;
`;

export const PrimaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  font-size: 0.75rem;
  font-weight: 600;
  background: #0d9488;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  &:hover:not(:disabled) { background: #0f766e; }
  &:disabled { background: #94a3b8; cursor: not-allowed; }
`;

export const SecondaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 0.75rem;
  font-weight: 600;
  background: #fff;
  color: #475569;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  cursor: pointer;
  &:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

export const DangerBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 0.75rem;
  font-weight: 600;
  background: #fff;
  color: #dc2626;
  border: 1px solid #fecaca;
  border-radius: 8px;
  cursor: pointer;
  &:hover { background: #fef2f2; }
`;

export const DangerIconBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 8px;
  background: #fff;
  color: #dc2626;
  border: 1px solid #fecaca;
  border-radius: 6px;
  cursor: pointer;
  &:hover { background: #fef2f2; }
`;

export const RecordingUI = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

export const RecordingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

export const RecDot = styled.span`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ef4444;
  animation: pulse 1.2s ease-in-out infinite;
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.85); }
  }
`;

export const RecElapsed = styled.div`
  font-size: 0.9375rem;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
`;

export const RecHint = styled.span`
  font-weight: 500;
  color: #94a3b8;
  font-size: 0.75rem;
`;

export const RecRemaining = styled.div`
  margin-left: auto;
  font-size: 0.6875rem;
  color: #64748b;
`;

export const RecHintLine = styled.div`
  font-size: 0.625rem;
  color: #94a3b8;
  text-align: center;
  padding-top: 2px;
`;

export const LevelBar = styled.div`
  height: 8px;
  background: #f1f5f9;
  border-radius: 4px;
  overflow: hidden;
`;

export const LevelFill = styled.div`
  height: 100%;
  background: linear-gradient(90deg, #14b8a6, #f43f5e);
  transition: width 50ms linear;
`;

export const RecBtnRow = styled.div`
  display: flex;
  gap: 8px;
`;

export const ProcessingUI = styled.div`
  padding: 12px;
  text-align: center;
  color: #64748b;
  font-size: 0.8125rem;
`;

export const InlineError = styled.div`
  margin-top: 12px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #b91c1c;
  font-size: 0.75rem;
  line-height: 1.6;

  svg { flex-shrink: 0; }
  span { flex: 1; }
`;

export const RetryBtn = styled.button`
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 0.6875rem;
  font-weight: 600;
  background: #fff;
  color: #b91c1c;
  border: 1px solid #fecaca;
  border-radius: 6px;
  cursor: pointer;
  &:hover { background: #fef2f2; border-color: #f87171; }
`;

// ─── 2026-10-05 추가 — 동의·용도·자동 인식 ───
export const UsageBox = styled.div`
  margin: 4px 0 12px; padding: 10px 12px; border-radius: 8px;
  background: #F8FAFC; border: 1px solid #E2E8F0;
`;
export const UsageTitle = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A; margin-bottom: 4px;`;
export const UsageBody = styled.div`font-size: 0.8125rem; color: #475569; line-height: 1.6;`;
export const ConsentRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;
  font-size: 0.8125rem; color: #0F172A;
  input { accent-color: #14B8A6; flex-shrink: 0; cursor: pointer; }
  label { cursor: pointer; }
`;
export const ConsentMore = styled.button`
  border: none; background: none; padding: 4px 2px; color: #0D9488; font-size: 0.75rem; cursor: pointer;
  &:hover { text-decoration: underline; }
`;
export const ConsentFull = styled.p`
  margin: 4px 0 8px; padding: 10px 12px; border-radius: 8px; background: #F0FDFA;
  font-size: 0.75rem; color: #334155; line-height: 1.7; white-space: pre-line;
`;
export const OutdatedNote = styled.div`
  margin-bottom: 8px; padding: 8px 12px; border-radius: 8px; background: #FFFBEB; color: #92400E; font-size: 0.8125rem;
`;
export const MatchRow = styled.div`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 10px 0 12px;
  font-size: 0.8125rem; color: #0F172A;
`;
