// AI 업무 추가 모달 — /docs (PostAiModal) 와 1:1 동일 디자인.
// Backdrop + Dialog + Header + Body + FormActions 전부 PostAiModal 패턴 복제.
// 자연어 한 줄 → AI 가 다중 업무 분해 → 미리보기 → 일괄 확정.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ModalActionButton from '../Common/ModalActionButton';
import PlanQSelect from '../Common/PlanQSelect';
import SingleDateField from '../Common/SingleDateField';
import { apiFetch } from '../../contexts/AuthContext';
import { mapApiError } from '../../utils/apiError';
import AiCandidateCard, { type AiCandidate } from './AiCandidateCard';
import AiRegenerateBar from '../Common/AiRegenerateBar';
import AiAreaBlock, { type AiArea } from './AiAreaBlock';
import AiLoadSummary from './AiLoadSummary';

interface Member { user_id: number; name: string; }
interface Project { id: number; name: string; }

type Candidate = AiCandidate;

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  projectId?: number | null;
  projectFixed?: boolean;
  projects?: Project[];
  members: Member[];
  onCreated: (createdTasks: Array<{ id: number; title: string }>) => void;
  // AI 분해 전 "이 템플릿이랑 거의 같아요" 추천 → 클릭 시 부모가 템플릿 적용 모달 열기.
  // 미제공 시 추천 배너 자체를 숨김 (graceful).
  onUseTemplate?: (templateId: number) => void;
}

interface TemplateMatch {
  id: number;
  name: string;
  category: string | null;
  task_count: number | null;
  is_system: boolean;
  role_hints: string[];
}

type Stage = 'input' | 'loading' | 'preview';

export default function AiTaskCreateModal({ open, onClose, businessId, projectId, projectFixed, projects = [], members, onCreated, onUseTemplate }: Props) {
  const { t } = useTranslation('qtask');
  const { t: tErr } = useTranslation('errors');
  const [stage, setStage] = useState<Stage>('input');
  const [prompt, setPrompt] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  // #237 — 에러가 아니라 안내(업무는 만들어졌다). error 와 톤이 달라 별도 상태로 둔다.
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(projectId || null);
  const [baseDate, setBaseDate] = useState<string>(new Date().toISOString().slice(0, 10));
  // AI 템플릿 추천 — input 단계에서 prompt debounce 매칭
  const [recMatch, setRecMatch] = useState<TemplateMatch | null>(null);
  const [recDismissed, setRecDismissed] = useState(false);

  useEffect(() => {
    if (open) {
      setStage('input');
      setPrompt('');
      setCandidates([]);
      setReasoning('');
      setError(null);
      setNotice(null);
      setSubmitting(false);
      setSelectedProjectId(projectId || null);
      setBaseDate(new Date().toISOString().slice(0, 10));
      setRecMatch(null);
      setRecDismissed(false);
      // #312 누적 지시도 같이 초기화 — 안 하면 지난 번 프롬프트에 준 지시가 새 세션에 얹혀
      //   엉뚱한 결과가 나온다(모달이 언마운트되지 않고 open prop 으로만 여닫히기 때문).
      setAiInstructions([]);
      // autoFocus 제거 — 모달이 길면 textarea 위치로 스크롤 점프해서 헤더/탭이 안 보임
    }
  }, [open, projectId]);

  // 추천 매칭 — prompt 변경 시 600ms debounce + 이전 요청 취소(AbortController).
  // onUseTemplate 미제공이면 호출 안 함(배너 못 띄우므로 비용 0).
  useEffect(() => {
    if (!open || !onUseTemplate || recDismissed) { setRecMatch(null); return; }
    const q = prompt.trim();
    if (q.length < 6) { setRecMatch(null); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await apiFetch('/api/task-templates/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ business_id: businessId, prompt: q, project_id: selectedProjectId }),
          signal: ctrl.signal,
        });
        const j = await r.json();
        setRecMatch(j.success && j.data?.match ? j.data.match : null);
      } catch { /* abort/네트워크 — 무시(추천은 보조 신호) */ }
    }, 600);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [open, prompt, businessId, selectedProjectId, onUseTemplate, recDismissed]);

  // ★ 훅은 전부 early return **위**에 있어야 한다. 아래에 두면 닫힘(15개) → 열림(16개) 으로
  //   훅 개수가 달라져 React 가 "Rendered more hooks than during the previous render"
  //   (프로덕션 빌드 React #310) 로 크래시한다 — 버튼을 누르는 순간 모달이 죽는다.
  //   운영 신고 "AI 추가 버튼 에러나"(2026-08-24) 의 원인. tsc·가드 3축은 이걸 못 잡는다.
  //   memory: feedback_hooks_after_early_return
  // 운영 #312 — "다시 만들기" 로 준 지시를 누적한다. 마지막 한 줄만 보내면 앞서 시킨 것이 풀려
  //   결과가 처음으로 되돌아간다. 직전 후보 목록도 같이 넘겨 "고쳐 쓰기" 가 되게 한다.
  const [aiInstructions, setAiInstructions] = useState<string[]>([]);
  // #354 — 루틴 설계 모드. **명시 버튼으로만** 켠다(반복 어휘 자동 감지는 Fable 판정으로 반려 —
  //   #353 이후 일반 모드도 "매일 …" 을 RRULE 로 만들기 때문에 반복 어휘 ≠ 루틴 설계 의도다).
  const [routineMode, setRoutineMode] = useState(false);
  const [areas, setAreas] = useState<AiArea[]>([]);
  const [existingRules, setExistingRules] = useState<string[]>([]);
  // 서버가 "계약을 못 채웠다" 고 알려준 것 — 조용히 삼키지 않고 그대로 보여준다.
  type Shortfall = string | { code: string; n?: number; min?: number };
  const [shortfall, setShortfall] = useState<Shortfall[] | null>(null);

  if (!open) return null;

  const generate = async (instruction?: string) => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    setStage('loading');
    const nextInstructions = [...aiInstructions, ...(instruction ? [instruction] : [])];
    const baseCandidates = candidates.map((c) => ({ title: c.title, description: c.description }));
    try {
      const r = await apiFetch('/api/tasks/ai-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          project_id: selectedProjectId,
          prompt: prompt.trim(),
          mode: routineMode ? 'routine' : undefined,
          instructions: nextInstructions.length ? nextInstructions : undefined,
          base_candidates: baseCandidates.length ? baseCandidates : undefined,
          // #354 — 재생성 때 영역도 원본으로 넘긴다. 안 넘기면 "영역을 5개로 줄여" 같은 지시가
          //   업무 목록만 보고 돌아 반쪽 재생성이 된다.
          base_areas: routineMode && areas.length ? areas.map(a => ({ title: a.title, description: a.description })) : undefined,
        }),
      });
      const j = await r.json();
      if (!j.success) {
        // ★ 결과가 상한에서 잘린 경우 — "더 구체적으로 입력해 주세요" 를 띄우면 안 된다.
        //   더 구체적으로 쓸수록 출력이 길어져 더 잘린다. 반대 처방을 말해 준다.
        if (j.message === 'output_truncated') {
          setError(t('ai.truncated', '결과가 너무 커서 잘렸어요. 루틴 범위를 나눠서 다시 요청해 주세요.') as string);
          setStage('input');
          return;
        }
        throw new Error(j.message || 'failed');
      }
      // ★ 서버가 에코한 mode 를 대조한다. 예전엔 모르는 mode 가 조용히 일반 분해로 떨어져
      //   "루틴 설계를 눌렀는데 일반 업무가 나오는" 상태를 화면이 알 길이 없었다.
      const echoed = j.data?.mode ?? null;
      if (routineMode && echoed !== 'routine') {
        setError(t('ai.modeMismatch', '루틴 설계로 처리되지 않았어요. 잠시 후 다시 시도해 주세요.') as string);
        setStage('input');
        return;
      }
      const list: Candidate[] = (j.data?.candidates || []).map((c: Candidate) => ({ ...c, selected: true }));
      if (list.length === 0) {
        setError(t('ai.noCandidates', '업무를 추출하지 못했어요. 더 구체적으로 입력해 주세요.') as string);
        setStage('input');
        return;
      }
      setCandidates(list);
      setAreas(((j.data?.areas || []) as AiArea[]).map(a => ({ ...a, adopted: true })));
      setExistingRules(((j.data?.existing_recurring || []) as Array<{ recurrence_rule?: string }>)
        .map(x => x.recurrence_rule || '').filter(Boolean));
      setShortfall((j.data?.routine_shortfall as Shortfall[] | null) || null);
      setAiInstructions(nextInstructions);   // ★ 성공했을 때만 누적 확정 (실패한 지시는 쌓지 않는다)
      setReasoning(j.data?.reasoning || '');
      setStage('preview');
    } catch (e) {
      setError(mapApiError(e, tErr));
      setStage('input');
    } finally {
      setSubmitting(false);
    }
  };

  const updateCand = (idx: number, patch: Partial<Candidate>) => {
    setCandidates(prev => prev.map(c => c.idx === idx ? { ...c, ...patch } : c));
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
          business_id: businessId,
          project_id: selectedProjectId,
          candidates: selected,
          base_date: baseDate,
          ...(routineMode ? {
            mode: 'routine',
            // 폐기한 영역은 adopted:false 로 그대로 보낸다 — 서버가 "안 만든다" 를 판단한다.
            areas: areas.map(a => ({ idx: a.idx, title: a.title, description: a.description, adopted: a.adopted !== false })),
          } : {}),
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      const created = (j.data?.created || []) as Array<{ id: number; title: string; completed_skipped?: string }>;
      onCreated(created);
      // #237 — "완료로 추가" 했는데 완료까지 못 간 건이 있으면 **닫지 않고** 알린다.
      //   그냥 닫으면 사용자는 완료된 줄 알고, 목록에서 미착수로 남은 이유를 알 길이 없다.
      //   ※ `count` 를 쓰면 i18next 가 복수 접미사 키를 찾는다 — 패리티 가드가 모르는 형태라 `{{n}}` 보간.
      const skipped = created.filter(c => c.completed_skipped).length;
      if (skipped > 0) {
        setNotice(t('ai.completedSkipped', { n: skipped, defaultValue: '{{n}}건은 담당자가 달라 완료 처리하지 않고 업무만 추가했어요' }) as string);
        return;
      }
      onClose();
    } catch (e) {
      setError(mapApiError(e, tErr));
    } finally {
      setSubmitting(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      generate();
    }
  };

  const selectedCount = candidates.filter(c => c.selected).length;

  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('ai.title', 'AI 로 업무추가') as string}>
        <Header>
          <Title>
            <Sparkle>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
            </Sparkle>
            {t('ai.title', 'AI 로 업무추가')}
          </Title>
          <CloseBtn type="button" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </CloseBtn>
        </Header>
        <Body>
          {stage === 'input' && (
            <AIForm>
              <AIDesc>
                {t('ai.todayLabel', '오늘')}: {new Date().toISOString().slice(0, 10)} · {t('ai.membersLabel', '멤버')} {members.length}
              </AIDesc>
              <FieldRow>
                <FieldLabel>{t('ai.startDate', '시작일')}</FieldLabel>
                <SingleDateField value={baseDate} onChange={(d) => setBaseDate(d || new Date().toISOString().slice(0, 10))} size="sm" />
                <Hint>{t('ai.startHint', '이 날짜 기준으로 모든 업무의 일정이 자동 계산됩니다.') as string}</Hint>
              </FieldRow>
              {!projectFixed && (
                <FieldRow>
                  <FieldLabel>{t('ai.projectLabel', '프로젝트 연결 (선택)')}</FieldLabel>
                  <PlanQSelect
                    size="sm"
                    isClearable
                    placeholder={t('ai.projectNone', '선택 안 함 (워크스페이스 업무)') as string}
                    value={selectedProjectId
                      ? { value: String(selectedProjectId), label: projects.find(p => p.id === selectedProjectId)?.name || `#${selectedProjectId}` }
                      : null}
                    onChange={(v) => {
                      const val = (v as { value?: string })?.value;
                      setSelectedProjectId(val ? Number(val) : null);
                    }}
                    options={projects.map(p => ({ value: String(p.id), label: p.name }))}
                  />
                </FieldRow>
              )}
              {/* #354 — 루틴 설계 모드는 **명시 버튼**으로만 켠다. 프로젝트가 있어야 영역(업무그룹)을
                  만들 수 있으므로 프로젝트 미선택 시엔 켤 수 없다(서버도 400 으로 막는다). */}
              <FieldRow>
                <FieldLabel>{t('ai.modeLabel', '무엇을 만들까요')}</FieldLabel>
                <ModeRow role="radiogroup" aria-label={t('ai.modeLabel', '무엇을 만들까요') as string}>
                  <ModeBtn
                    type="button" role="radio" aria-checked={!routineMode}
                    $active={!routineMode}
                    data-testid="ai-mode-oneoff"
                    onClick={() => setRoutineMode(false)}
                  >
                    <ModeName>{t('ai.mode.oneoff', '일회성 업무 분해') as string}</ModeName>
                    <ModeDesc>{t('ai.mode.oneoffDesc', '프로젝트를 단계별 업무로 나눕니다') as string}</ModeDesc>
                  </ModeBtn>
                  <ModeBtn
                    type="button" role="radio" aria-checked={routineMode}
                    $active={routineMode}
                    disabled={!selectedProjectId}
                    data-testid="ai-mode-routine"
                    onClick={() => setRoutineMode(true)}
                    title={!selectedProjectId ? (t('ai.mode.routineNeedsProject', '프로젝트를 먼저 선택하세요') as string) : undefined}
                  >
                    <ModeName>{t('ai.mode.routine', '루틴 설계') as string}</ModeName>
                    <ModeDesc>{t('ai.mode.routineDesc', '영역을 나누고 반복 업무·실행 지침까지 만듭니다') as string}</ModeDesc>
                  </ModeBtn>
                </ModeRow>
                {!selectedProjectId && (
                  <Hint>{t('ai.mode.routineNeedsProject', '프로젝트를 먼저 선택하세요') as string}</Hint>
                )}
              </FieldRow>
              <FieldRow>
                <FieldLabel>{routineMode ? t('ai.promptLabelRoutine', '만들 루틴') : t('ai.promptLabel', '추가할 업무')}</FieldLabel>
                <FieldTextarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={handleKey}
                  rows={5}
                  placeholder={(routineMode
                    ? t('ai.placeholderRoutine', '예: 개인 브랜드 연구 루틴. 매일 논문 인사이트 기록, 평일 SNS 발행, 매주 월요일 리서치 계획, 매월 마지막 평일 회고.')
                    : t('ai.placeholder', '예: WordPress 블로그 사이트 한 달 안에 런칭. 디자인부터 컨텐츠 마이그레이션, SEO 까지.')) as string}
                />
                <Hint>{(routineMode
                  ? t('ai.promptHintRoutine', '반복 주기와 하고 싶은 일을 적으면 영역·반복 규칙·실행 지침까지 만들어요.')
                  : t('ai.promptHint', '한 줄로 적으면 AI 가 여러 업무로 나눠 줘요.')) as string}</Hint>
              </FieldRow>
              {recMatch && onUseTemplate && (
                <RecBanner>
                  <RecIcon aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0012 2z"/></svg>
                  </RecIcon>
                  <RecBody>
                    <RecTitle>
                      {t('ai.recommend.title', '저장된 \'{{name}}\' 템플릿과 거의 같아요', { name: recMatch.name, defaultValue: `저장된 '${recMatch.name}' 템플릿과 거의 같아요` })}
                    </RecTitle>
                    <RecMeta>
                      {t('ai.recommend.meta', '업무 {{n}}개', { n: recMatch.task_count || 0, defaultValue: `업무 ${recMatch.task_count || 0}개` })}
                      {recMatch.role_hints.length > 0 && ` · ${recMatch.role_hints.slice(0, 3).join('/')}`}
                    </RecMeta>
                  </RecBody>
                  <RecUseBtn type="button" onClick={() => { onUseTemplate(recMatch.id); onClose(); }}>
                    {t('ai.recommend.use', '이 템플릿 쓰기')}
                  </RecUseBtn>
                  <RecDismiss type="button" onClick={() => { setRecDismissed(true); setRecMatch(null); }} aria-label={t('ai.recommend.dismiss', '추천 닫기') as string} title={t('ai.recommend.dismiss', '추천 닫기') as string}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </RecDismiss>
                </RecBanner>
              )}
              {error && <ErrorMsg>{error}</ErrorMsg>}
            </AIForm>
          )}

          {stage === 'loading' && (
            <LoadingBox>
              <Spinner />
              <LoadingText>{t('ai.loadingTitle', 'AI 가 업무를 분해하고 있어요')}</LoadingText>
              <LoadingSub>{t('ai.loadingSub', '결과물 중심으로 단계를 나누는 중...')}</LoadingSub>
              <ProgressTrack><ProgressFill /></ProgressTrack>
              <LoadingHint>{t('ai.loadingHint', '보통 5~10초 정도 걸려요. 잠시만 기다려 주세요.')}</LoadingHint>
            </LoadingBox>
          )}

          {stage === 'preview' && (
            <AIForm>
              {reasoning && <ReasoningBox>{reasoning}</ReasoningBox>}
              <PreviewBaseRow>
                <FieldLabel>{t('ai.startDate', '시작일')}</FieldLabel>
                <SingleDateField value={baseDate} onChange={(d) => setBaseDate(d || new Date().toISOString().slice(0, 10))} size="sm" />
                <BaseHint>{t('ai.baseHint', '시작일을 바꾸면 모든 일정이 자동 재계산돼요.')}</BaseHint>
              </PreviewBaseRow>
              {/* #354 — 확정 전에 ① 영역 구조 ② 요일별 부하를 먼저 보여준다.
                  #358 이 요구한 "전량 저장 후 지우기의 반대" 를 여기서 실현한다. */}
              {routineMode && areas.length > 0 && (
                <BlockSection>
                  <BlockTitle>{t('ai.area.title', '영역') as string}</BlockTitle>
                  <AiAreaBlock
                    areas={areas}
                    taskCountByArea={candidates.reduce((acc, c) => {
                      if (typeof c.area_ref === 'number') acc[c.area_ref] = (acc[c.area_ref] || 0) + 1;
                      return acc;
                    }, {} as Record<number, number>)}
                    onChange={(idx, patch) => setAreas(prev => prev.map(a => a.idx === idx ? { ...a, ...patch } : a))}
                    disabled={submitting}
                  />
                </BlockSection>
              )}
              {routineMode && (
                <BlockSection>
                  <AiLoadSummary
                    proposedRules={candidates.filter(c => c.selected).map(c => c.recurrence_rule)}
                    existingRules={existingRules}
                  />
                </BlockSection>
              )}
              {routineMode && shortfall && shortfall.length > 0 && (
                <ShortfallBox role="status">
                  {/* ★ 문구는 여기서 만든다 — 서버가 한국어를 박아 보내면 영어 사용자에게 그대로 나간다.
                      서버는 code 만 준다(옛 문자열 형태도 그대로 그려 하위호환). */}
                  {shortfall.map((sf, i) => (
                    <div key={i}>
                      {typeof sf === 'string'
                        ? sf
                        : (t(`ai.shortfall.${sf.code}`, { n: sf.n, min: sf.min, defaultValue: sf.code }) as string)}
                    </div>
                  ))}
                </ShortfallBox>
              )}
              <CardList>
                {candidates.map(c => (
                  <AiCandidateCard
                    key={c.idx}
                    candidate={c}
                    members={members}
                    baseDate={baseDate}
                    onChange={(patch) => updateCand(c.idx, patch)}
                    hasProject={!!selectedProjectId}
                  />
                ))}
              </CardList>
              {error && <ErrorMsg>{error}</ErrorMsg>}
              {notice && <NoticeMsg role="status">{notice}</NoticeMsg>}
            </AIForm>
          )}
        </Body>
        <Footer>
          {stage === 'input' && (
            <>
              <ModalActionButton variant="secondary" onClick={onClose}>{t('ai.cancel', '취소')}</ModalActionButton>
              <ModalActionButton variant="ai" onClick={() => generate()} disabled={!prompt.trim() || submitting}>
                {submitting ? t('ai.generating', '생성 중...') : t('ai.generate', 'AI 업무 추가')}
              </ModalActionButton>
            </>
          )}
          {stage === 'loading' && (
            <ModalActionButton variant="secondary" onClick={onClose}>{t('ai.cancel', '취소')}</ModalActionButton>
          )}
          {/* #237 — 이미 생성이 끝난 뒤의 안내 상태. 다시 [추가] 를 누르면 중복 생성되므로 닫기만 남긴다. */}
          {stage === 'preview' && notice && (
            <ModalActionButton variant="secondary" onClick={onClose}>{t('ai.close', '닫기')}</ModalActionButton>
          )}
          {stage === 'preview' && !notice && (
            <>
              {/* 운영 — AI 재생성 UX 통일: 지시 기반 재생성(인라인). 기존 '입력으로 되돌리기' 대체 */}
              <AiRegenerateBar busy={submitting} onRegenerate={(ins) => generate(ins)} />
              <ModalActionButton variant="secondary" onClick={onClose}>{t('ai.cancel', '취소')}</ModalActionButton>
              <ModalActionButton variant="ai" onClick={confirm} disabled={selectedCount === 0 || submitting}>
                {submitting
                  ? t('ai.confirming', '추가 중...')
                  : selectedCount === 1
                    ? t('ai.confirmOne', '추가')
                    : t('ai.confirm', '{{n}}개 추가', { n: selectedCount, defaultValue: `${selectedCount}개 추가` })}
              </ModalActionButton>
            </>
          )}
        </Footer>
      </Dialog>
    </Backdrop>
  );
}

// ─── styled — /docs PostAiModal 1:1 동일 ───
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 20px;
  @media (max-width: 640px) { padding: 0; align-items: stretch; }
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px;
  width: 100%; max-width: 560px; max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  @media (max-width: 640px) {
    max-width: none; max-height: none; border-radius: 0;
    margin-top: 60px; height: calc(100vh - 60px); height: calc(var(--vvh, 100dvh) - 60px);
  }
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 14px; border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
`;
const Title = styled.h2`
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 1rem; font-weight: 700; color: #0F172A; margin: 0;
`;
const Sparkle = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  color: #F43F5E;
`;
const CloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }

  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px;
  color: #64748B; cursor: pointer;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  padding: 16px 22px 12px;
  flex: 1; overflow-y: auto;
  min-height: 0;
`;
const Footer = styled.div`
  display: flex; justify-content: flex-end; gap: 6px;
  padding: 12px 22px 18px;
  flex-shrink: 0;
  border-top: 1px solid #F1F5F9; background: #fff;
`;
const AIForm = styled.div`display:flex;flex-direction:column;gap:14px;`;
const AIDesc = styled.div`font-size:0.75rem;color:#64748B;line-height:1.5;`;
const FieldRow = styled.div`display:flex;flex-direction:column;gap:6px;`;
const FieldLabel = styled.label`font-size:0.75rem;font-weight:600;color:#0F172A;`;
const FieldTextarea = styled.textarea`
  width:100%;padding:10px 12px;font-size:0.8125rem;color:#0F172A;line-height:1.55;
  border:1px solid #E2E8F0;border-radius:8px;background:#FFF;font-family:inherit;resize:vertical;
  &:focus{outline:none;border-color:#14B8A6;}
  &::placeholder{color:#CBD5E1;}
`;
const ErrorMsg = styled.div`font-size:0.75rem;color:#DC2626;background:#FEF2F2;padding:8px 10px;border-radius:6px;`;
// #237 — 실패가 아니라 안내(업무는 생성됨). 실패와 같은 빨강을 쓰지 않는다.
const NoticeMsg = styled.div`font-size:0.75rem;color:#B45309;background:#FFFBEB;padding:8px 10px;border-radius:6px;`;

// AI 템플릿 추천 배너 — subtle info 톤 (memory feedback_ai_recommendation_threshold). 강제 아님.
const RecBanner = styled.div`
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: #F0FDFA; border: 1px solid #CCFBF1; border-radius: 8px;
`;
const RecIcon = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0; color: #0F766E;
`;
const RecBody = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const RecTitle = styled.div`
  font-size: 0.75rem; font-weight: 600; color: #0F766E; line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const RecMeta = styled.div`font-size: 0.6875rem; color: #64748B;`;
const RecUseBtn = styled.button`
  flex-shrink: 0;
  padding: 6px 12px; font-size: 0.75rem; font-weight: 600;
  color: #FFFFFF; background: #14B8A6; border: none; border-radius: 6px;
  cursor: pointer; transition: background 0.15s;
  &:hover { background: #0D9488; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.3); outline-offset: 2px; }
`;
const RecDismiss = styled.button`
  flex-shrink: 0;
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px;
  color: #64748B; cursor: pointer;
  &:hover { background: #CCFBF1; color: #0F766E; }
`;

const LoadingBox = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 40px 20px; gap: 12px;
`;
const Spinner = styled.div`
  width: 32px; height: 32px; border: 3px solid #E2E8F0; border-top-color: #14B8A6;
  border-radius: 50%; animation: spin 0.8s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;
const LoadingText = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A;`;
const LoadingSub = styled.div`font-size: 0.75rem; color: #64748B;`;
const LoadingHint = styled.div`font-size: 0.6875rem; color: #94A3B8; margin-top: 4px;`;
const ProgressTrack = styled.div`
  width: 240px; height: 6px; max-width: 100%;
  background: #E2E8F0; border-radius: 999px; overflow: hidden;
`;
const ProgressFill = styled.div`
  height: 100%;
  background: linear-gradient(90deg, #14B8A6 0%, #0D9488 100%);
  border-radius: 999px;
  width: 0%;
  animation: planq-ai-progress 12s cubic-bezier(0.16, 0.84, 0.44, 1) forwards;
  @keyframes planq-ai-progress {
    0% { width: 0%; }
    50% { width: 60%; }
    80% { width: 88%; }
    100% { width: 95%; }
  }
`;

const ReasoningBox = styled.div`
  padding: 10px 12px; background: #F0FDFA; color: #0F766E;
  border-left: 3px solid #14B8A6; border-radius: 6px; font-size: 0.75rem; line-height: 1.5;
`;
const CardList = styled.div`display: flex; flex-direction: column; gap: 8px;`;

// #354 — 모드 선택 (일회성 분해 / 루틴 설계). 상태색을 버튼 배경에 칠하지 않는다(3톤 규칙) —
//   선택 표시는 테두리와 옅은 바탕으로만 한다.
const ModeRow = styled.div`
  display: flex; gap: 8px; width: 100%;
  @media (max-width: 640px) { flex-direction: column; }
`;
const ModeBtn = styled.button<{ $active: boolean }>`
  flex: 1; min-width: 0; text-align: left;
  padding: 10px 12px;
  border: 1px solid ${(p) => (p.$active ? '#14B8A6' : '#e2e8f0')};
  background: ${(p) => (p.$active ? '#f0fdfa' : '#ffffff')};
  border-radius: 10px; cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  &:hover:not(:disabled) { border-color: ${(p) => (p.$active ? '#14B8A6' : '#cbd5e1')}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.4); outline-offset: 1px; }
`;
const ModeName = styled.div`
  font-size: 0.8125rem; font-weight: 700; color: #0f172a; margin-bottom: 2px;
`;
const ModeDesc = styled.div`
  font-size: 0.75rem; color: #64748b; line-height: 1.4;
`;
const BlockSection = styled.div`
  display: flex; flex-direction: column; gap: 8px;
`;
const BlockTitle = styled.div`
  font-size: 0.8125rem; font-weight: 700; color: #0f172a;
`;
// 서버가 "계약을 못 채웠다" 고 알려준 것. 오류가 아니라 안내 톤이다 — 결과는 쓸 수 있다.
const ShortfallBox = styled.div`
  border: 1px solid #fde68a; background: #fffbeb; color: #92400e;
  border-radius: 8px; padding: 8px 10px;
  font-size: 0.75rem; line-height: 1.5;
  display: flex; flex-direction: column; gap: 2px;
`;
const PreviewBaseRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 10px;
  background: #F8FAFC; border-radius: 6px;
`;
const BaseHint = styled.div`font-size: 0.6875rem; color: #94A3B8;`;
const Hint = styled.div`font-size: 0.6875rem; color: #94A3B8;`;
