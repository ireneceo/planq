// 운영 — AI 생성물 재생성/재수정 공용 바 (Q docs·Q task·Cue·Q Note 통일).
//   "다시 만들기" → 인라인 지시 입력("어떻게 고칠까요? (선택)") + 재생성. 팝업 안 팝업 금지 → 같은 영역 expand.
//   지시 비우면 같은 입력으로 단순 재생성, 채우면 그 지시를 반영해 재생성.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

interface Props {
  onRegenerate: (instruction: string) => void;
  busy?: boolean;
  size?: 'sm' | 'md';
}

const AiRegenerateBar: React.FC<Props> = ({ onRegenerate, busy, size = 'md' }) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');

  const run = () => {
    if (busy) return;
    onRegenerate(instruction.trim());
    setInstruction('');
    setOpen(false);
  };

  return (
    <Wrap>
      {!open ? (
        <RegenBtn type="button" $sm={size === 'sm'} disabled={busy} onClick={() => setOpen(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {t('aiRegen.btn', { defaultValue: '다시 만들기' }) as string}
        </RegenBtn>
      ) : (
        <Row onClick={(e) => e.stopPropagation()}>
          <Input
            autoFocus value={instruction}
            placeholder={t('aiRegen.placeholder', { defaultValue: '어떻게 고칠까요? (비우면 그대로 다시 생성)' }) as string}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); run(); } if (e.key === 'Escape') { setOpen(false); setInstruction(''); } }}
          />
          <GoBtn type="button" disabled={busy} onClick={run}>
            {busy ? (t('aiRegen.running', { defaultValue: '생성 중…' }) as string) : (t('aiRegen.go', { defaultValue: '재생성' }) as string)}
          </GoBtn>
          <CancelBtn type="button" disabled={busy} onClick={() => { setOpen(false); setInstruction(''); }} aria-label={t('common.cancel', { defaultValue: '취소' }) as string}>×</CancelBtn>
        </Row>
      )}
    </Wrap>
  );
};

export default AiRegenerateBar;

const Wrap = styled.div`display: inline-flex; flex: 1; min-width: 0;`;
const RegenBtn = styled.button<{ $sm?: boolean }>`
  display: inline-flex; align-items: center; gap: 5px;
  height: ${p => p.$sm ? 30 : 36}px; padding: 0 ${p => p.$sm ? 10 : 12}px;
  border: 1px solid #E2E8F0; background: #FFFFFF; border-radius: 8px;
  font-size: ${p => p.$sm ? 12 : 13}px; font-weight: 600; color: #475569; cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  svg { color: #94A3B8; }
  &:hover:not(:disabled) svg { color: #0F766E; }
`;
const Row = styled.div`display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; width: 100%;`;
const Input = styled.input`
  flex: 1; min-width: 0; height: 36px; padding: 0 12px;
  border: 1px solid #14B8A6; border-radius: 8px; font-size: 13px; color: #0F172A; outline: none;
  &::placeholder { color: #94A3B8; }
  &:focus { box-shadow: 0 0 0 3px rgba(20,184,166,0.18); }
`;
const GoBtn = styled.button`
  flex-shrink: 0; height: 36px; padding: 0 14px; border: none; border-radius: 8px;
  background: #14B8A6; color: #FFFFFF; font-size: 13px; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
const CancelBtn = styled.button`
  flex-shrink: 0; width: 30px; height: 36px; border: none; background: transparent;
  color: #94A3B8; font-size: 18px; line-height: 1; cursor: pointer;
  &:hover { color: #0F172A; }
`;
