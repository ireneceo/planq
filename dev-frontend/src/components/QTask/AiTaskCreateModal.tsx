// AI 업무 추가 모달 — /docs (NewDocumentModal) 와 1:1 동일 디자인.
// Backdrop + Dialog + Header + Body + FormActions 전부 NewDocumentModal 패턴 복제.
// 자연어 한 줄 → AI 가 다중 업무 분해 → 미리보기 → 일괄 확정.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ModalActionButton from '../Common/ModalActionButton';
import PlanQSelect from '../Common/PlanQSelect';
import SingleDateField from '../Common/SingleDateField';
import { CalendarIcon, ClockIcon } from '../Common/Icons';
import { apiFetch } from '../../contexts/AuthContext';
import { mapApiError } from '../../utils/apiError';

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

// 날짜 헬퍼 (UTC 기준 — 표시용)
function addDaysISO(baseISO: string, days: number): string {
  const d = new Date(baseISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function fmtMd(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[1])}/${Number(m[2])}` : iso;
}

export default function AiTaskCreateModal({ open, onClose, businessId, projectId, projectFixed, projects = [], members, onCreated }: Props) {
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
                {candidates.map(c => {
                  const dur = Math.max(1, c.due_offset_days - c.start_offset_days);
                  const startDateStr = addDaysISO(baseDate, c.start_offset_days);
                  const dueDateStr = addDaysISO(baseDate, c.due_offset_days);
                  return (
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
                        <AssigneeInline>
                          <PlanQSelect
                            size="sm"
                            isClearable
                            placeholder={t('ai.assigneeUnassigned', '미배정') as string}
                            value={c.assignee_user_id
                              ? { value: String(c.assignee_user_id), label: members.find(m => m.user_id === c.assignee_user_id)?.name || `#${c.assignee_user_id}` }
                              : null}
                            onChange={(v) => {
                              const val = (v as { value?: string })?.value;
                              updateCand(c.idx, { assignee_user_id: val ? Number(val) : null });
                            }}
                            options={members.map(m => ({ value: String(m.user_id), label: m.name || `#${m.user_id}` }))}
                          />
                        </AssigneeInline>
                      </CardHeader>
                      <CardMetaRow>
                        <MetaItem>
                          <MetaIcon><CalendarIcon size={13} /></MetaIcon>
                          <DateRange>{fmtMd(startDateStr)} → {fmtMd(dueDateStr)}</DateRange>
                          <DurEdit>(
                            <DurInput type="number" min={1} max={90} value={dur}
                              onChange={e => {
                                const newDur = Math.max(1, Number(e.target.value) || 1);
                                updateCand(c.idx, { due_offset_days: c.start_offset_days + newDur });
                              }} />
                            {t('ai.itemDays', '일')})
                          </DurEdit>
                        </MetaItem>
                        <MetaItem>
                          <MetaIcon><ClockIcon size={13} /></MetaIcon>
                          <DurInput type="number" min={1} max={80} value={c.estimated_hours}
                            onChange={e => updateCand(c.idx, { estimated_hours: Number(e.target.value) || 1 })} />
                          <Unit>h</Unit>
                        </MetaItem>
                      </CardMetaRow>
                    </Card>
                  );
                })}
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
const AssigneeInline = styled.div`
  flex-shrink: 0; min-width: 110px; max-width: 150px;
  margin-left: auto;
`;
const CardMetaRow = styled.div`
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding-left: 24px;
  font-size: 12px; color: #475569;
`;
const MetaItem = styled.div`
  display: inline-flex; align-items: center; gap: 4px;
`;
const MetaIcon = styled.span`
  display: inline-flex; align-items: center; color: #94A3B8; flex-shrink: 0;
`;
const DateRange = styled.span`color: #0F172A; font-weight: 600;`;
const DurEdit = styled.span`
  display: inline-flex; align-items: center; gap: 2px;
  color: #94A3B8; font-size: 11px;
`;
const DurInput = styled.input`
  width: 38px; padding: 1px 3px;
  border: 1px solid #E2E8F0; border-radius: 4px;
  font-size: 11px; text-align: right;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const Unit = styled.span`color: #94A3B8; font-size: 11px;`;
const PreviewBaseRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 10px;
  background: #F8FAFC; border-radius: 6px;
`;
const BaseHint = styled.div`font-size: 11px; color: #94A3B8;`;
const Hint = styled.div`font-size: 11px; color: #94A3B8;`;
