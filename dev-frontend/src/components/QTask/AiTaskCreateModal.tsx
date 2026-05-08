// AI 업무 추가 모달 — /docs (NewDocumentModal) 와 1:1 동일 디자인.
// Backdrop + Dialog + Header + Body + FormActions 전부 NewDocumentModal 패턴 복제.
// 자연어 한 줄 → AI 가 다중 업무 분해 → 미리보기 → 일괄 확정.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ModalActionButton from '../Common/ModalActionButton';
import PlanQSelect from '../Common/PlanQSelect';
import { apiFetch } from '../../contexts/AuthContext';

interface Member { user_id: number; name: string; }
interface Project { id: number; name: string; }

interface Candidate {
  idx: number;
  title: string;
  description?: string;
  estimated_hours: number;
  duration_days: number;
  start_offset_days: number;
  due_offset_days: number;
  priority: string;
  assignee_hint: string | null;
  assignee_user_id: number | null;
  depends_on_index: number | null;
  vague: boolean;
  selected: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  projectId?: number | null;
  projectFixed?: boolean;
  projects?: Project[];
  members: Member[];
  onCreated: (createdTasks: Array<{ id: number; title: string }>) => void;
}

type Stage = 'input' | 'loading' | 'preview';

export default function AiTaskCreateModal({ open, onClose, businessId, projectId, projectFixed, projects = [], members, onCreated }: Props) {
  const { t } = useTranslation('qtask');
  const [stage, setStage] = useState<Stage>('input');
  const [prompt, setPrompt] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(projectId || null);

  useEffect(() => {
    if (open) {
      setStage('input');
      setPrompt('');
      setCandidates([]);
      setReasoning('');
      setError(null);
      setSubmitting(false);
      setSelectedProjectId(projectId || null);
      // autoFocus 제거 — 모달이 길면 textarea 위치로 스크롤 점프해서 헤더/탭이 안 보임
    }
  }, [open, projectId]);

  if (!open) return null;

  const generate = async () => {
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
      setError(e instanceof Error ? e.message : 'unknown');
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
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      const created = (j.data?.created || []) as Array<{ id: number; title: string }>;
      onCreated(created);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
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
              {error && <ErrorMsg>{error}</ErrorMsg>}
            </AIForm>
          )}

          {stage === 'loading' && (
            <LoadingBox>
              <Spinner />
              <LoadingText>{t('ai.loadingTitle', 'AI 가 업무를 분해하고 있어요')}</LoadingText>
              <LoadingSub>{t('ai.loadingSub', '결과물 중심으로 단계를 나누는 중...')}</LoadingSub>
            </LoadingBox>
          )}

          {stage === 'preview' && (
            <AIForm>
              {reasoning && <ReasoningBox>{reasoning}</ReasoningBox>}
              <CardList>
                {candidates.map(c => (
                  <Card key={c.idx} $disabled={!c.selected}>
                    <CardHeader>
                      <Checkbox
                        type="checkbox"
                        checked={c.selected}
                        onChange={e => updateCand(c.idx, { selected: e.target.checked })}
                      />
                      <TitleInput
                        value={c.title}
                        onChange={e => updateCand(c.idx, { title: e.target.value })}
                        $vague={c.vague}
                      />
                      {c.vague && <VagueBadge title={t('ai.vagueHint', '결과물 명사가 빠진 것 같아요. 예: "디자인" → "메인 시안 작성"') as string}>⚠</VagueBadge>}
                    </CardHeader>
                    <CardRow>
                      <Field>
                        <FieldMeta>{t('ai.estLabel', '예상시간')}</FieldMeta>
                        <NumInput type="number" min={1} max={80} value={c.estimated_hours}
                          onChange={e => updateCand(c.idx, { estimated_hours: Number(e.target.value) || 1 })} />
                        <Unit>h</Unit>
                      </Field>
                      <Field>
                        <FieldMeta>{t('ai.startLabel', '시작')}</FieldMeta>
                        <OffsetInput type="number" min={0} value={c.start_offset_days}
                          onChange={e => updateCand(c.idx, { start_offset_days: Number(e.target.value) || 0 })} />
                        <Unit>{t('ai.daysFromToday', 'D+')}</Unit>
                      </Field>
                      <Field>
                        <FieldMeta>{t('ai.dueLabel', '마감')}</FieldMeta>
                        <OffsetInput type="number" min={c.start_offset_days} value={c.due_offset_days}
                          onChange={e => updateCand(c.idx, { due_offset_days: Number(e.target.value) || 0 })} />
                        <Unit>{t('ai.daysFromToday', 'D+')}</Unit>
                      </Field>
                      <Field>
                        <FieldMeta>{t('ai.assigneeLabel', '담당자')}</FieldMeta>
                        <AssigneeWrap>
                          <PlanQSelect
                            size="sm"
                            isClearable
                            placeholder={t('ai.assigneeMe', '나') as string}
                            value={c.assignee_user_id
                              ? { value: String(c.assignee_user_id), label: members.find(m => m.user_id === c.assignee_user_id)?.name || `#${c.assignee_user_id}` }
                              : null}
                            onChange={(v) => {
                              const val = (v as { value?: string })?.value;
                              updateCand(c.idx, { assignee_user_id: val ? Number(val) : null });
                            }}
                            options={members.map(m => ({ value: String(m.user_id), label: m.name || `#${m.user_id}` }))}
                          />
                        </AssigneeWrap>
                      </Field>
                    </CardRow>
                    {c.description && <Description>{c.description}</Description>}
                  </Card>
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
              <ModalActionButton variant="ai" onClick={generate} disabled={!prompt.trim() || submitting}>
                {submitting ? t('ai.generating', '생성 중...') : t('ai.generate', 'AI 업무 추가')}
              </ModalActionButton>
            </>
          )}
          {stage === 'loading' && (
            <ModalActionButton variant="secondary" onClick={onClose}>{t('ai.cancel', '취소')}</ModalActionButton>
          )}
          {stage === 'preview' && (
            <>
              <ModalActionButton variant="secondary" onClick={() => setStage('input')}>{t('ai.regenerate', '다시 생성')}</ModalActionButton>
              <ModalActionButton variant="secondary" onClick={onClose}>{t('ai.cancel', '취소')}</ModalActionButton>
              <ModalActionButton variant="ai" onClick={confirm} disabled={selectedCount === 0 || submitting}>
                {submitting
                  ? t('ai.confirming', '추가 중...')
                  : selectedCount === 1
                    ? t('ai.confirmOne', '추가')
                    : t('ai.confirm', '모두 추가 ({{n}})', { n: selectedCount, defaultValue: `모두 추가 (${selectedCount})` })}
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
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px;
  width: 100%; max-width: 560px; max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  @media (max-width: 640px) { max-height: 100vh; height: 100vh; border-radius: 0; }
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

const ReasoningBox = styled.div`
  padding: 10px 12px; background: #F0FDFA; color: #0F766E;
  border-left: 3px solid #14B8A6; border-radius: 6px; font-size: 12px; line-height: 1.5;
`;
const CardList = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Card = styled.div<{ $disabled: boolean }>`
  padding: 10px 12px;
  background: ${p => p.$disabled ? '#F8FAFC' : '#FFFFFF'};
  border: 1px solid ${p => p.$disabled ? '#E2E8F0' : '#CBD5E1'};
  border-radius: 8px;
  opacity: ${p => p.$disabled ? 0.6 : 1};
  display: flex; flex-direction: column; gap: 8px;
`;
const CardHeader = styled.div`display: flex; align-items: center; gap: 8px;`;
const Checkbox = styled.input`width: 16px; height: 16px; flex-shrink: 0; cursor: pointer;`;
const TitleInput = styled.input<{ $vague: boolean }>`
  flex: 1; min-width: 0;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 14px; font-weight: 600; color: #0F172A;
  background: transparent;
  ${p => p.$vague && 'background: #FEF3C7; border-color: #FCD34D;'}
  &:focus { outline: none; border-color: #14B8A6; background: #FFFFFF; }
`;
const VagueBadge = styled.span`flex-shrink: 0; font-size: 14px; color: #B45309; cursor: help;`;
const CardRow = styled.div`
  display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
  padding-left: 24px;
`;
const Field = styled.label`display: flex; align-items: center; gap: 4px; font-size: 12px; color: #475569;`;
const FieldMeta = styled.span`color: #64748B; font-size: 11px;`;
const NumInput = styled.input`
  width: 48px; padding: 2px 4px; border: 1px solid #E2E8F0; border-radius: 4px;
  font-size: 12px; text-align: right;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const OffsetInput = styled(NumInput)`width: 44px;`;
const Unit = styled.span`color: #94A3B8; font-size: 11px;`;
const AssigneeWrap = styled.div`min-width: 140px; max-width: 180px;`;
const Description = styled.div`padding-left: 24px; font-size: 12px; color: #64748B; line-height: 1.4;`;
