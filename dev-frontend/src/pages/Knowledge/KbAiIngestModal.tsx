// Q knowledge — AI 자동 분석 추가 모달
// 사용자가 자유 텍스트 입력 → AI 가 토픽별 분리 + 분류 + 태그 추출 → 검수 → 일괄 저장
// 설계: docs/KB_AI_INGEST_DESIGN.md
import React, { useState, useCallback } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { SparkleIcon } from '../../components/Common/Icons';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';

type Lang = 'ko' | 'en';
type Category = 'policy' | 'manual' | 'incident' | 'faq' | 'about' | 'pricing';
type Visibility = 'translate' | 'show_original' | 'hide_other';

interface Candidate {
  title: string;
  body: string;
  category: Category;
  tags: string[];
  excluded?: boolean;
}

interface Props {
  businessId: number;
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES: Category[] = ['policy', 'manual', 'incident', 'faq', 'about', 'pricing'];

const KbAiIngestModal: React.FC<Props> = ({ businessId, onClose, onSaved }) => {
  const { t } = useTranslation('knowledge');
  const [step, setStep] = useState<'input' | 'review'>('input');
  const [text, setText] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState<Lang>('ko');
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [visibility, setVisibility] = useState<Visibility>('translate');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [skipReview, setSkipReview] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    if (!text.trim() || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/kb/ai-ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), source_language: sourceLanguage }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.message || 'analysis_failed');
      const list = (j.data?.candidates || []) as Candidate[];
      if (list.length === 0) throw new Error(t('aiIngest.errEmpty', '추출된 항목이 없습니다. 입력 내용을 확인해주세요.') as string);
      setCandidates(list);
      // 검수 스킵 토글이 켜져 있으면 즉시 저장
      if (skipReview) {
        await saveBatch(list);
      } else {
        setStep('review');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally {
      setAnalyzing(false);
    }
  }, [text, analyzing, businessId, sourceLanguage, skipReview, t]);

  const saveBatch = useCallback(async (items: Candidate[]) => {
    const filtered = items.filter(it => !it.excluded);
    if (filtered.length === 0) {
      setError(t('aiIngest.errAllExcluded', '저장할 항목이 없습니다.') as string);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/kb/documents/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: filtered,
          scope: 'workspace',
          source_language: sourceLanguage,
          auto_translate: autoTranslate,
          translation_visibility: visibility,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.message || 'save_failed');
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally {
      setSaving(false);
    }
  }, [businessId, sourceLanguage, autoTranslate, visibility, onSaved, onClose, t]);

  const updateCandidate = (idx: number, patch: Partial<Candidate>) => {
    setCandidates(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };

  return (
    <Backdrop onClick={onClose}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('aiIngest.title', 'AI 자동 추가') as string}>
        <Header>
          <Title>
            <SparkleIcon size={16} />
            {t('aiIngest.title', 'AI 로 자동 추가')}
          </Title>
          <CloseBtn type="button" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </CloseBtn>
        </Header>

        <Body>
          {step === 'input' && (
            <>
              <Hint>
                {t('aiIngest.hint', '회의록·매뉴얼·이메일 같은 자유 텍스트를 붙여넣으면 AI 가 토픽별로 분리하고 카테고리·태그를 자동 추출합니다. 원문 정보만 사용 — 새 정보는 만들지 않습니다.')}
              </Hint>
              <Field>
                <Label>{t('aiIngest.text', '내용')}</Label>
                <TextArea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={t('aiIngest.textPh', '여기에 텍스트를 붙여넣으세요. 토픽이 여러 개면 자동으로 분리됩니다.') as string}
                  rows={10}
                  maxLength={50000}
                />
                <CharCount>{text.length} / 50,000</CharCount>
              </Field>

              <Row>
                <Field>
                  <Label>{t('aiIngest.lang', '원문 언어')}</Label>
                  <PlanQSelect size="sm" isSearchable={false}
                    value={{ value: sourceLanguage, label: sourceLanguage === 'ko' ? (t('aiIngest.langKo', '한국어') as string) : (t('aiIngest.langEn', '영어') as string) }}
                    options={[
                      { value: 'ko', label: t('aiIngest.langKo', '한국어') as string },
                      { value: 'en', label: t('aiIngest.langEn', '영어') as string },
                    ]}
                    onChange={(opt) => {
                      const v = (opt as PlanQSelectOption | null)?.value as Lang | undefined;
                      if (v) setSourceLanguage(v);
                    }}
                  />
                </Field>
                <Field>
                  <Label>{t('aiIngest.translate', '자동 번역')}</Label>
                  <SwitchRow>
                    <Switch type="button" role="switch" aria-checked={autoTranslate} $on={autoTranslate}
                      onClick={() => setAutoTranslate(v => !v)}>
                      <SwitchKnob $on={autoTranslate} />
                    </Switch>
                    <SwitchHint>{autoTranslate ? t('aiIngest.translateOn', '두 언어 자동 번역 (Cue 사용량 차감)') : t('aiIngest.translateOff', '번역 안 함')}</SwitchHint>
                  </SwitchRow>
                </Field>
              </Row>

              {!autoTranslate && (
                <Field>
                  <Label>{t('aiIngest.visibility', '다른 언어 사용자에게')}</Label>
                  <PlanQSelect size="sm" isSearchable={false}
                    value={(() => {
                      const map: Record<Visibility, string> = {
                        translate: t('aiIngest.visTranslate', '번역해서 보여주기 (자동 번역 켜짐과 동일)') as string,
                        show_original: t('aiIngest.visShow', '원문 그대로 보여주기 (언어 뱃지 표시)') as string,
                        hide_other: t('aiIngest.visHide', '안 보이기 (해당 언어 사용자만)') as string,
                      };
                      return { value: visibility, label: map[visibility] };
                    })()}
                    options={[
                      { value: 'translate', label: t('aiIngest.visTranslate', '번역해서 보여주기 (자동 번역 켜짐과 동일)') as string },
                      { value: 'show_original', label: t('aiIngest.visShow', '원문 그대로 보여주기 (언어 뱃지 표시)') as string },
                      { value: 'hide_other', label: t('aiIngest.visHide', '안 보이기 (해당 언어 사용자만)') as string },
                    ]}
                    onChange={(opt) => {
                      const v = (opt as PlanQSelectOption | null)?.value as Visibility | undefined;
                      if (v) setVisibility(v);
                    }}
                  />
                </Field>
              )}

              <SkipReview>
                <Switch type="button" role="switch" aria-checked={skipReview} $on={skipReview}
                  onClick={() => setSkipReview(v => !v)}>
                  <SwitchKnob $on={skipReview} />
                </Switch>
                <SwitchHint>{t('aiIngest.skipReview', '검수 없이 즉시 저장 (효율 우선)')}</SwitchHint>
              </SkipReview>

              {error && <ErrorBox>{error}</ErrorBox>}
            </>
          )}

          {step === 'review' && (
            <>
              <Hint>
                {t('aiIngest.reviewHint', 'AI 가 추출한 항목입니다. 수정·제외 후 일괄 저장합니다.')}
                <ReviewCount>{candidates.filter(c => !c.excluded).length} / {candidates.length}</ReviewCount>
              </Hint>
              <ReviewList>
                {candidates.map((c, idx) => (
                  <ReviewCard key={idx} $excluded={!!c.excluded}>
                    <CardTopRow>
                      <CardNum>#{idx + 1}</CardNum>
                      <CardCategoryWrap>
                        <PlanQSelect size="sm" isSearchable={false}
                          value={{ value: c.category, label: t(`category.${c.category}`, c.category) as string }}
                          options={CATEGORIES.map(cat => ({ value: cat, label: t(`category.${cat}`, cat) as string }))}
                          onChange={(opt) => {
                            const v = (opt as PlanQSelectOption | null)?.value as Category | undefined;
                            if (v) updateCandidate(idx, { category: v });
                          }}
                        />
                      </CardCategoryWrap>
                      <CardSpacer />
                      <CardExcludeBtn type="button" onClick={() => updateCandidate(idx, { excluded: !c.excluded })}>
                        {c.excluded ? t('aiIngest.include', '복원') : t('aiIngest.exclude', '제외')}
                      </CardExcludeBtn>
                    </CardTopRow>
                    <CardTitleInput value={c.title} onChange={e => updateCandidate(idx, { title: e.target.value })}
                      placeholder={t('aiIngest.titlePh', '제목') as string} />
                    <CardBodyTextArea value={c.body} onChange={e => updateCandidate(idx, { body: e.target.value })}
                      placeholder={t('aiIngest.bodyPh', '본문') as string} rows={3} />
                    <CardTagsInput value={(c.tags || []).join(', ')}
                      onChange={e => updateCandidate(idx, { tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                      placeholder={t('aiIngest.tagsPh', '태그 (쉼표 구분)') as string} />
                  </ReviewCard>
                ))}
              </ReviewList>

              {error && <ErrorBox>{error}</ErrorBox>}
            </>
          )}
        </Body>

        <Footer>
          <SecondaryBtn type="button" onClick={onClose} disabled={analyzing || saving}>
            {t('common.cancel', '취소')}
          </SecondaryBtn>
          {step === 'input' && (
            <PrimaryBtn type="button" onClick={analyze} disabled={!text.trim() || analyzing || saving}>
              <SparkleIcon size={14} />
              {analyzing ? t('aiIngest.analyzing', '분석 중...') : t('aiIngest.analyze', 'AI 분석 시작')}
            </PrimaryBtn>
          )}
          {step === 'review' && (
            <>
              <SecondaryBtn type="button" onClick={() => setStep('input')} disabled={saving}>
                {t('aiIngest.back', '뒤로')}
              </SecondaryBtn>
              <PrimaryBtn type="button" onClick={() => saveBatch(candidates)} disabled={saving}>
                {saving ? t('aiIngest.saving', '저장 중...') : t('aiIngest.saveAll', '일괄 저장')}
              </PrimaryBtn>
            </>
          )}
        </Footer>
      </Dialog>
    </Backdrop>
  );
};

export default KbAiIngestModal;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 200;
  background: rgba(15, 23, 42, 0.5);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  @media (max-width: 640px) { padding: 0; align-items: stretch; }
`;
const Dialog = styled.div`
  width: 100%; max-width: 720px; max-height: 90vh;
  background: #FFFFFF; border-radius: 14px;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.18);
  display: flex; flex-direction: column; overflow: hidden;
  @media (max-width: 640px) {
    max-width: none; max-height: none; border-radius: 0;
    margin-top: 60px; height: calc(100vh - 60px); height: calc(100dvh - 60px);
  }
`;
const Header = styled.div`
  padding: 18px 22px 14px;
  border-bottom: 1px solid #E2E8F0;
  display: flex; align-items: center; justify-content: space-between;
`;
const Title = styled.h3`
  margin: 0; font-size: 16px; font-weight: 700; color: #0F172A;
  display: inline-flex; align-items: center; gap: 8px;
  svg { color: #14B8A6; }
`;
const CloseBtn = styled.button`
  width: 32px; height: 32px; border: none; background: transparent;
  border-radius: 8px; cursor: pointer; color: #64748B;
  display: inline-flex; align-items: center; justify-content: center;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`
  padding: 20px 22px; overflow-y: auto; flex: 1;
  display: flex; flex-direction: column; gap: 14px;
`;
const Hint = styled.div`
  font-size: 13px; color: #475569; line-height: 1.6;
  padding: 12px 14px; background: #F0FDFA; border: 1px solid #99F6E4;
  border-radius: 8px;
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
`;
const ReviewCount = styled.span`
  font-size: 11px; font-weight: 700; color: #0F766E; flex-shrink: 0;
  padding: 2px 8px; background: #FFFFFF; border: 1px solid #99F6E4; border-radius: 999px;
`;
const Field = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const Label = styled.label`
  font-size: 12px; font-weight: 700; color: #475569;
`;
const TextArea = styled.textarea`
  width: 100%; box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #0F172A; font-family: inherit;
  resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const CharCount = styled.div`
  text-align: right; font-size: 11px; color: #94A3B8;
`;
const Row = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
`;
// (raw HTML select 요소 폐지 — PlanQSelect 로 통일)
const SwitchRow = styled.div`
  display: flex; align-items: center; gap: 10px; padding: 6px 0;
`;
const Switch = styled.button<{ $on: boolean }>`
  width: 40px; height: 22px; border-radius: 11px; padding: 0;
  background: ${p => p.$on ? '#14B8A6' : '#CBD5E1'};
  border: none; cursor: pointer; position: relative;
  transition: background 0.15s;
`;
const SwitchKnob = styled.div<{ $on: boolean }>`
  position: absolute; top: 2px; left: ${p => p.$on ? '20px' : '2px'};
  width: 18px; height: 18px; border-radius: 50%;
  background: #FFFFFF; transition: left 0.15s;
`;
const SwitchHint = styled.span`
  font-size: 12px; color: #475569;
`;
const SkipReview = styled.div`
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 8px;
`;
const ErrorBox = styled.div`
  padding: 10px 12px; background: #FEF2F2; border: 1px solid #FECACA;
  border-radius: 8px; font-size: 13px; color: #B91C1C;
`;
const ReviewList = styled.div`
  display: flex; flex-direction: column; gap: 10px;
`;
const ReviewCard = styled.div<{ $excluded: boolean }>`
  padding: 12px 14px;
  border: 1px solid ${p => p.$excluded ? '#CBD5E1' : '#E2E8F0'};
  background: ${p => p.$excluded ? '#F8FAFC' : '#FFFFFF'};
  opacity: ${p => p.$excluded ? 0.5 : 1};
  border-radius: 10px;
  display: flex; flex-direction: column; gap: 8px;
`;
const CardTopRow = styled.div`
  display: flex; align-items: center; gap: 8px;
`;
const CardNum = styled.span`
  font-size: 11px; font-weight: 700; color: #94A3B8;
  font-family: ui-monospace, monospace;
`;
// CardCategorySelect 폐지 — PlanQSelect 사용
const CardCategoryWrap = styled.div`
  min-width: 120px;
`;
const CardSpacer = styled.div`flex: 1;`;
const CardExcludeBtn = styled.button`
  padding: 4px 10px; font-size: 12px; font-weight: 600; color: #64748B;
  border: 1px solid #E2E8F0; background: #FFFFFF; border-radius: 6px; cursor: pointer;
  &:hover { color: #B91C1C; border-color: #FECACA; background: #FEF2F2; }
`;
const CardTitleInput = styled.input`
  padding: 8px 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 14px; font-weight: 600; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const CardBodyTextArea = styled.textarea`
  padding: 8px 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 13px; color: #334155; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const CardTagsInput = styled.input`
  padding: 6px 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 12px; color: #475569;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const Footer = styled.div`
  padding: 14px 22px;
  border-top: 1px solid #E2E8F0;
  display: flex; justify-content: flex-end; gap: 8px;
`;
const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; background: #14B8A6; color: #FFFFFF;
  border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 8px 16px; background: #FFFFFF; color: #475569;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
