// Q Task 상단 상시 "Cue에게 말하기" 바.
// 캐주얼하게 한마디 → Cue(AI 팀원)가 업무로 정리 → 인라인 미리보기 → [추가].
// 모달 아님(제자리 인라인). 백엔드는 분해 모달과 동일 재사용: /api/tasks/ai-create(+/confirm).
// 생성 후 socket task:new 가 리스트 자동 반영 (실시간 §16). 카드는 AiCandidateCard 공유.
import React, { useCallback, useEffect, useRef, useState } from 'react';
// styled 는 이 파일에 더 남아 있지 않다 — 껍데기는 Common/cueBarShell 한 곳이다
import { useTranslation } from 'react-i18next';
import ModalActionButton from '../Common/ModalActionButton';
import AiRegenerateBar from '../Common/AiRegenerateBar';
import { apiFetch } from '../../contexts/AuthContext';
import { mapApiError } from '../../utils/apiError';
import AiCandidateCard, { type AiCandidate, type AiCardMember } from './AiCandidateCard';
import { isEnterAction } from '../../utils/imeKey';
import {
  Wrap, BarRow, Sparkle, Field, SendBtn, Shortcut, AddedBadge, Check,
  SubHint, ErrorMsg, NoticeMsg, Drop, CueLine, CardList, Actions, Thinking, Dots,
} from '../Common/cueBarShell';

interface Props {
  businessId: number;
  members: AiCardMember[];
  projectId?: number | null;
  /** 채팅·메일 작업대에서 쓸 때 — 등록된 업무가 그 대화/스레드에 연결된다 (안 붙으면 그 자리 리스트에 안 보인다) */
  context?: { conversation_id?: number | null; email_thread_id?: number | null } | null;
  /** 좁은 패널(320~440px)용 — 글로벌 ⌘T 미등록, 여백 축소 */
  compact?: boolean;
  /** 탭 문맥 기본값 — "오늘/이번 주 나의 업무" 에서 만들면 그 목록 안에 남아야 한다.
   *  안 넘기면 종전 동작 그대로(채팅·메일 작업대는 탭 개념이 없어 안 넘긴다). */
  defaults?: { due_date?: string | null; planned_week_start?: string | null } | null;
  onCreated?: (created: Array<{ id: number; title: string }>) => void;
}

type Stage = 'idle' | 'loading' | 'preview';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CueTaskBar({ businessId, members, projectId = null, context = null, compact = false, defaults = null, onCreated }: Props) {
  const { t } = useTranslation('qtask');
  const { t: tErr } = useTranslation('errors');
  const [stage, setStage] = useState<Stage>('idle');
  const [prompt, setPrompt] = useState('');
  const [candidates, setCandidates] = useState<AiCandidate[]>([]);
  const [reasoning, setReasoning] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  // #237 — 에러가 아니라 안내(업무는 만들어졌다). error 와 톤이 달라 별도 상태로 둔다.
  const [notice, setNotice] = useState<string | null>(null);
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

  // ⌘T / Ctrl+T — 어디서든 바 포커스 (브라우저 새 탭 단축키 가로채지 않도록 입력 중이 아닐 때만).
  //   패널판(compact)은 등록하지 않는다 — 같은 화면에 바가 둘이면 포커스가 어디로 갈지 알 수 없다.
  useEffect(() => {
    if (compact) return;
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
  }, [compact]);

  const send = async (instruction?: string) => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    setStage('loading');
    try {
      const r = await apiFetch('/api/tasks/ai-create', {
        method: 'POST',
        // 미리보기(저장 없음) — 순단 1회 자동 재시도. confirm 은 저장이라 켜지 않는다.
        retryOnNetworkError: true,
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
    setNotice(null);
    try {
      const r = await apiFetch('/api/tasks/ai-create/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId, project_id: projectId, candidates: selected,
          base_date: baseDate, context: context || undefined,
          // 탭 기본값 — 서버는 후보가 날짜를 안 정했을 때만 쓴다(LLM 이 정한 날짜를 안 덮는다)
          default_due_date: defaults?.due_date || undefined,
          default_planned_week_start: defaults?.planned_week_start || undefined,
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      const created = (j.data?.created || []) as Array<{ id: number; title: string; completed_skipped?: string }>;
      // #237 — "완료로 추가" 했는데 완료까지 못 간 건이 있으면 알려준다. 조용히 넘기면 완료된 줄 안다.
      const skipped = created.filter(c => c.completed_skipped).length;
      // ※ `count` 를 쓰면 i18next 가 복수 접미사 키(_one/_other)를 찾는다 — 패리티 가드가 모르는 형태라
      //   일부러 평범한 보간 `{{n}}` 을 쓴다.
      setNotice(skipped > 0
        ? t('ai.completedSkipped', { n: skipped, defaultValue: '{{n}}건은 담당자가 달라 완료 처리하지 않고 업무만 추가했어요' }) as string
        : null);
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
    if (isEnterAction(e) && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const selectedCount = candidates.filter(c => c.selected).length;
  const placeholder = `${t('ai.bar.lead', 'Cue에게 말하기')} — "${examples[phIdx] || ''}"`;

  return (
    <Wrap $compact={compact}>
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
      {stage === 'idle' && notice && <NoticeMsg role="status">{notice}</NoticeMsg>}

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
                hasProject={!!projectId}
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

/* ★ 껍데기(스타일)는 `components/Common/cueBarShell` 로 옮겼다 — Q sale 이 같은 것을 쓴다.
   베껴 두면 갈라진다(2026-09-13 실제로 갈라져 있었다). 값은 하나도 바꾸지 않고 옮겼다. */
