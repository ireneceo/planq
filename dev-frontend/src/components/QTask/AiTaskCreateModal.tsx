// AI 업무 추가 모달 — /docs (NewDocumentModal) 와 1:1 동일 디자인.
// Backdrop + Dialog + Header + Body + FormActions 전부 NewDocumentModal 패턴 복제.
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
      setSubmitting(false);
      setSelectedProjectId(projectId || null);
      setBaseDate(new Date().toISOString().slice(0, 10));
      setRecMatch(null);
      setRecDismissed(false);
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

  if (!open) return null;

  const generate = async (instruction?: string) => {
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    setStage('loading');
    try {
      const r = await apiFetch('/api/tasks/ai-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          project_id: selectedProjectId,
          prompt: prompt.trim(),
          instruction: instruction || undefined,  // 운영 — 재생성 지시
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      const list: Candidate[] = (j.data?.candidates || []).map((c: Candidate) => ({ ...c, selected: true }));
      if (list.length === 0) {
        setError(t('ai.noCandidates', '업무를 추출하지 못했어요. 더 구체적으로 입력해 주세요.') as string);
        setStage('input');
        return;
      }
      setCandidates(list);
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
    try {
      const r = await apiFetch('/api/tasks/ai-create/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          project_id: selectedProjectId,
          candidates: selected,
          base_date: baseDate,
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      const created = (j.data?.created || []) as Array<{ id: number; title: string }>;
      onCreated(created);
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
              <FieldRow>
                <FieldLabel>{t('ai.promptLabel', '요청 내용')}</FieldLabel>
                <FieldTextarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={handleKey}
                  rows={5}
                  placeholder={t('ai.placeholder', '예: WordPress 블로그 사이트 한 달 안에 런칭. 디자인부터 컨텐츠 마이그레이션, SEO 까지.') as string}
                />
              </FieldRow>
              {recMatch && onUseTemplate && (
                <RecBanner>
                  <RecIcon aria-hidden>💡</RecIcon>
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
              {error && <ErrorMsg>{error}</ErrorMsg>}
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
          {stage === 'preview' && (
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
    margin-top: 60px; height: calc(100vh - 60px); height: calc(100dvh - 60px);
  }
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px 14px; border-bottom: 1px solid #F1F5F9;
  flex-shrink: 0;
`;
const Title = styled.h2`
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 16px; font-weight: 700; color: #0F172A; margin: 0;
`;
const Sparkle = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  color: #F43F5E;
`;
const CloseBtn = styled.button`
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
const AIDesc = styled.div`font-size:12px;color:#64748B;line-height:1.5;`;
const FieldRow = styled.div`display:flex;flex-direction:column;gap:6px;`;
const FieldLabel = styled.label`font-size:12px;font-weight:600;color:#0F172A;`;
const FieldTextarea = styled.textarea`
  width:100%;padding:10px 12px;font-size:13px;color:#0F172A;line-height:1.55;
  border:1px solid #E2E8F0;border-radius:8px;background:#FFF;font-family:inherit;resize:vertical;
  &:focus{outline:none;border-color:#14B8A6;}
  &::placeholder{color:#CBD5E1;}
`;
const ErrorMsg = styled.div`font-size:12px;color:#DC2626;background:#FEF2F2;padding:8px 10px;border-radius:6px;`;

// AI 템플릿 추천 배너 — subtle info 톤 (memory feedback_ai_recommendation_threshold). 강제 아님.
const RecBanner = styled.div`
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: #F0FDFA; border: 1px solid #CCFBF1; border-radius: 8px;
`;
const RecIcon = styled.span`font-size: 16px; line-height: 1; flex-shrink: 0;`;
const RecBody = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const RecTitle = styled.div`
  font-size: 12px; font-weight: 600; color: #0F766E; line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const RecMeta = styled.div`font-size: 11px; color: #64748B;`;
const RecUseBtn = styled.button`
  flex-shrink: 0;
  padding: 6px 12px; font-size: 12px; font-weight: 600;
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
const LoadingText = styled.div`font-size: 14px; font-weight: 600; color: #0F172A;`;
const LoadingSub = styled.div`font-size: 12px; color: #64748B;`;
const LoadingHint = styled.div`font-size: 11px; color: #94A3B8; margin-top: 4px;`;
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
  border-left: 3px solid #14B8A6; border-radius: 6px; font-size: 12px; line-height: 1.5;
`;
const CardList = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const PreviewBaseRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 10px;
  background: #F8FAFC; border-radius: 6px;
`;
const BaseHint = styled.div`font-size: 11px; color: #94A3B8;`;
const Hint = styled.div`font-size: 11px; color: #94A3B8;`;
