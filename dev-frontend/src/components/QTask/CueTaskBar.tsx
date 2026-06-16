// Q Task 상단 상시 "Cue에게 말하기" 바.
// 캐주얼하게 한마디 → Cue(AI 팀원)가 업무로 정리 → 인라인 미리보기 → [추가].
// 모달 아님(제자리 인라인). 백엔드는 분해 모달과 동일 재사용: /api/tasks/ai-create(+/confirm).
// 생성 후 socket task:new 가 리스트 자동 반영 (실시간 §16). 카드는 AiCandidateCard 공유.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { useTranslation } from 'react-i18next';
import ModalActionButton from '../Common/ModalActionButton';
import AiRegenerateBar from '../Common/AiRegenerateBar';
import { apiFetch } from '../../contexts/AuthContext';
import { mapApiError } from '../../utils/apiError';
import AiCandidateCard, { type AiCandidate, type AiCardMember } from './AiCandidateCard';

interface Props {
  businessId: number;
  members: AiCardMember[];
  projectId?: number | null;
  onCreated?: (created: Array<{ id: number; title: string }>) => void;
}

type Stage = 'idle' | 'loading' | 'preview';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CueTaskBar({ businessId, members, projectId = null, onCreated }: Props) {
  const { t } = useTranslation('qtask');
  const { t: tErr } = useTranslation('errors');
  const [stage, setStage] = useState<Stage>('idle');
  const [prompt, setPrompt] = useState('');
  const [candidates, setCandidates] = useState<AiCandidate[]>([]);
  const [reasoning, setReasoning] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [phIdx, setPhIdx] = useState(0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const baseDate = todayISO();

  // 예시 placeholder 회전 (idle + 비어있을 때만). 언어별 예시 문장.
  const examples = t('ai.bar.examples', {
    returnObjects: true,
    defaultValue: ['내일까지 메인 시안 완성', '이번 주 안에 경쟁사 비교표 작성', '다음 주 월요일 발표자료 초안'],
  }) as string[];
  useEffect(() => {
    if (stage !== 'idle' || prompt) return;
    const id = setInterval(() => setPhIdx(i => (i + 1) % (examples.length || 1)), 4000);
    return () => clearInterval(id);
  }, [stage, prompt, examples.length]);

  // textarea 자동 높이
  const autoGrow = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, []);
  useEffect(() => { autoGrow(); }, [prompt, autoGrow]);

  // ⌘T / Ctrl+T — 어디서든 바 포커스 (브라우저 새 탭 단축키 가로채지 않도록 입력 중이 아닐 때만)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 't' || e.key === 'T')) {
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
        taRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const send = async (instruction?: string) => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    setStage('loading');
    try {
      const r = await apiFetch('/api/tasks/ai-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, project_id: projectId, prompt: prompt.trim(), mode: 'quick', instruction: instruction || undefined }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      const list: AiCandidate[] = (j.data?.candidates || []).map((c: AiCandidate) => ({ ...c, selected: true }));
      if (list.length === 0) {
        setError(t('ai.noCandidates', '업무를 추출하지 못했어요. 더 구체적으로 입력해 주세요.') as string);
        setStage('idle');
        return;
      }
      setCandidates(list);
      setReasoning(j.data?.reasoning || '');
      setStage('preview');
    } catch (e) {
      setError(mapApiError(e, tErr));
      setStage('idle');
    } finally {
      setSubmitting(false);
    }
  };

  const updateCand = (idx: number, patch: Partial<AiCandidate>) => {
    setCandidates(prev => prev.map(c => c.idx === idx ? { ...c, ...patch } : c));
  };

  const reset = () => {
    setStage('idle');
    setPrompt('');
    setCandidates([]);
    setReasoning('');
    setError(null);
  };

  const confirm = async () => {
    const selected = candidates.filter(c => c.selected);
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await apiFetch('/api/tasks/ai-create/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, project_id: projectId, candidates: selected, base_date: baseDate }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      const created = (j.data?.created || []) as Array<{ id: number; title: string }>;
      onCreated?.(created);
      reset();
      setJustAdded(true);
      window.setTimeout(() => setJustAdded(false), 2200);
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally {
      setSubmitting(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const selectedCount = candidates.filter(c => c.selected).length;
  const placeholder = `${t('ai.bar.lead', 'Cue에게 말하기')} — "${examples[phIdx] || ''}"`;

  return (
    <Wrap>
      <BarRow $active={stage !== 'idle' || !!prompt}>
        <Sparkle aria-hidden>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z" /></svg>
        </Sparkle>
        <Field
          ref={taRef}
          rows={1}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          disabled={stage === 'loading'}
          aria-label={t('ai.bar.lead', 'Cue에게 말하기') as string}
        />
        {prompt.trim() ? (
          <SendBtn type="button" onClick={() => send()} disabled={submitting} aria-label={t('ai.bar.send', '보내기') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
          </SendBtn>
        ) : justAdded ? (
          <AddedBadge role="status"><Check viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></Check>{t('ai.bar.added', '추가됐어요')}</AddedBadge>
        ) : (
          <Shortcut aria-hidden>⌘T</Shortcut>
        )}
      </BarRow>

      {stage === 'idle' && prompt && (
        <SubHint>{t('ai.bar.hintEnter', 'Enter 로 Cue에게 보내기 · Shift+Enter 줄바꿈')}</SubHint>
      )}
      {stage === 'idle' && error && <ErrorMsg role="alert">{error}</ErrorMsg>}

      {stage === 'loading' && (
        <Drop>
          <Thinking>
            <Dots><i /><i /><i /></Dots>
            {t('ai.bar.thinking', 'Cue가 정리하는 중...')}
          </Thinking>
        </Drop>
      )}

      {stage === 'preview' && (
        <Drop role="region" aria-label={t('ai.title', 'AI 로 업무추가') as string}>
          <CueLine>
            <Sparkle aria-hidden><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z" /></svg></Sparkle>
            {reasoning || t('ai.bar.organized', 'Cue가 이렇게 정리했어요')}
          </CueLine>
          <CardList>
            {candidates.map(c => (
              <AiCandidateCard
                key={c.idx}
                candidate={c}
                members={members}
                baseDate={baseDate}
                onChange={(patch) => updateCand(c.idx, patch)}
              />
            ))}
          </CardList>
          {error && <ErrorMsg role="alert">{error}</ErrorMsg>}
          <Actions>
            <ModalActionButton variant="ai" onClick={confirm} disabled={selectedCount === 0 || submitting}>
              {submitting
                ? t('ai.confirming', '추가 중...')
                : selectedCount === 1
                  ? t('ai.confirmOne', '추가')
                  : t('ai.confirm', '{{n}}개 추가', { n: selectedCount, defaultValue: `${selectedCount}개 추가` })}
            </ModalActionButton>
            {/* 운영 — AI 재생성 UX 통일: 지시 기반 재생성 (인라인) */}
            <AiRegenerateBar busy={submitting} size="sm" onRegenerate={(ins) => send(ins)} />
            <ModalActionButton variant="secondary" onClick={reset} disabled={submitting}>{t('ai.bar.close', '닫기')}</ModalActionButton>
          </Actions>
        </Drop>
      )}
    </Wrap>
  );
}

const CORAL = '#F43F5E';

const Wrap = styled.div`
  padding: 10px 16px 0;
  flex-shrink: 0;
`;
const BarRow = styled.div<{ $active: boolean }>`
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px 7px 12px;
  background: #fff;
  border: 1px solid ${p => p.$active ? CORAL : '#E2E8F0'};
  border-radius: 10px;
  transition: border-color .15s, box-shadow .15s;
  box-shadow: ${p => p.$active ? `0 0 0 3px rgba(244,63,94,0.10)` : 'none'};
  &:focus-within { border-color: ${CORAL}; box-shadow: 0 0 0 3px rgba(244,63,94,0.12); }
`;
const Sparkle = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  color: ${CORAL}; flex-shrink: 0;
`;
const Field = styled.textarea`
  flex: 1; min-width: 0;
  border: none; outline: none; resize: none;
  background: transparent;
  font-family: inherit; font-size: 13.5px; line-height: 1.5; color: #0F172A;
  padding: 1px 0;
  max-height: 140px;
  &::placeholder { color: #94A3B8; }
  &:disabled { color: #94A3B8; }
`;
const SendBtn = styled.button`
  flex-shrink: 0;
  width: 30px; height: 30px; border-radius: 8px; border: none;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${CORAL}; color: #fff; cursor: pointer;
  transition: background .15s, transform .05s;
  &:hover { background: #E11D48; }
  &:active { transform: scale(0.94); }
  &:disabled { opacity: 0.5; cursor: default; }
`;
const Shortcut = styled.span`
  flex-shrink: 0;
  font-size: 11px; font-weight: 600; color: #CBD5E1;
  padding: 2px 6px; border: 1px solid #E2E8F0; border-radius: 5px;
  @media (max-width: 640px) { display: none; }
`;
const AddedBadge = styled.span`
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 600; color: #0D9488;
  animation: cuefade .25s ease;
  @keyframes cuefade { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; } }
`;
const Check = styled.svg`width: 14px; height: 14px;`;
const SubHint = styled.div`
  font-size: 11px; color: #94A3B8; padding: 5px 4px 0 14px;
`;
const ErrorMsg = styled.div`
  font-size: 12px; color: #DC2626; background: #FEF2F2;
  padding: 8px 10px; border-radius: 6px; margin-top: 8px;
`;
const Drop = styled.div`
  margin-top: 8px;
  padding: 12px;
  background: #FFF1F2;
  border: 1px solid #FECDD3;
  border-radius: 10px;
  display: flex; flex-direction: column; gap: 10px;
  animation: cuedrop .2s ease;
  @keyframes cuedrop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
`;
const CueLine = styled.div`
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 12.5px; line-height: 1.5; color: #9F1239; font-weight: 500;
`;
const CardList = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Actions = styled.div`
  display: flex; justify-content: flex-end; gap: 6px; flex-wrap: wrap;
`;
const Thinking = styled.div`
  display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; color: #9F1239; font-weight: 500;
`;
const blink = keyframes`0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}`;
const Dots = styled.span`
  display: inline-flex; gap: 3px;
  i { width: 5px; height: 5px; border-radius: 50%; background: ${CORAL}; display: inline-block; animation: ${blink} 1.2s infinite; }
  i:nth-child(2) { animation-delay: .2s; }
  i:nth-child(3) { animation-delay: .4s; }
`;
