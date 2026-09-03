// Q info — AI 자동 분석 추가 모달
// 사용자가 자유 텍스트 입력 → AI 가 토픽별 분리 + 분류 + 태그 추출 → 검수 → 일괄 저장
// 설계: docs/KB_AI_INGEST_DESIGN.md
import React, { useState, useCallback, useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import AttachmentField from '../../components/Common/AttachmentField';
import { SparkleIcon } from '../../components/Common/Icons';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { mapApiError } from '../../utils/apiError';
import { listKbCategories } from '../../services/knowledge';

type Lang = 'ko' | 'en';
type Category = 'policy' | 'manual' | 'incident' | 'faq' | 'about' | 'pricing';
type Visibility = 'translate' | 'show_original' | 'hide_other';

interface KbColumn { id: string; name: string; type: string; show_in_list: boolean }
interface Candidate {
  title: string;
  body: string;
  category: Category;
  // #316/#320 — 백엔드가 자유 카테고리 배열과 항목을 함께 내려준다. 그대로 batch 로 넘긴다.
  categories?: string[];
  tags: string[];
  custom_columns?: KbColumn[] | null;
  custom_values?: Record<string, string> | null;
  excluded?: boolean;
}

interface Props {
  businessId: number;
  onClose: () => void;
  onSaved: () => void;
  /** 문서에서 바로 열 때 — 본문을 채워 두고 분석 단계로 시작한다 (#284).
   *  "내용이 그냥 텍스트로 정리되어 버리는데 AI가 검토해서 항목별로 따로 저장할 거 있으면 하고 보낼 수 없어?"
   *  → 문서→Info 는 여태 통짜 텍스트로 넣었다. 같은 AI 추출을 태우면 항목이 나뉜다. */
  initialText?: string;
  /** 어느 문서에서 왔는가 — 저장되는 항목마다 출처로 남겨 서로 참조하게 한다 (#284 두 번째 요청). */
  sourcePostId?: number;
  /** 어느 범위에 저장하는가. 프로젝트>정보 탭이 이 모달을 그대로 재사용한다 (Irene 2026-09-03).
   *  ★ 여태 'workspace' 로 못 박혀 있어서, 프로젝트에서 열어도 워크스페이스 자료로 저장됐을 것이다.
   *    범위를 인자로 받는 이유가 그것이다 — 모달을 한 벌 더 만들면 프롬프트·검수 화면이 갈라진다. */
  scope?: 'workspace' | 'project';
  /** scope='project' 일 때 필수. 저장 시 project_id 로 나간다. */
  projectId?: number;
}

const CATEGORIES: Category[] = ['policy', 'manual', 'incident', 'faq', 'about', 'pricing'];

const FileNote = styled.div`
  margin-top: 6px; font-size: 0.71875rem; line-height: 1.5; color: #64748B;
`;
const TruncBox = styled.div`
  margin: 8px 0; padding: 8px 12px; border-radius: 6px;
  background: #FFF7ED; border: 1px solid #FED7AA; color: #9A3412;
  font-size: 0.75rem; line-height: 1.5;
`;

const KbAiIngestModal: React.FC<Props> = ({ businessId, onClose, onSaved, initialText, sourcePostId, scope = 'workspace', projectId }) => {
  // ★ 워크스페이스에 **실제로 등록된** 카테고리를 쓴다 (Irene 2026-09-03: "카테고리 등록된대로 안 떠").
  //   여태 legacy 6종을 화면에도 프롬프트에도 박아 놔서, 사용자가 만든 카테고리는 어디에도 없었다.
  //   Q info 목록 화면과 **같은 엔드포인트**를 본다 — 사본을 만들면 갈라진다.
  const [wsCats, setWsCats] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    listKbCategories(businessId)
      .then((r) => { if (alive) setWsCats([...(r.master || []).map((m) => m.name), ...(r.orphan || [])]); })
      .catch(() => { /* 실패하면 아래 fallback(legacy + AI 가 준 값)으로 */ });
    return () => { alive = false; };
  }, [businessId]);
  const { t } = useTranslation('knowledge');
  const { t: tErr } = useTranslation('errors');
  /** 후보가 실제로 들고 있는 분류. 백엔드는 `categories`(배열)를 주는데 화면은 `category`(단수)를
   *  읽고 있었다 — 그래서 항상 undefined 였고 `category.undefined` 가 그대로 렌더됐다(Irene 신고). */
  const catOf = useCallback((c: Candidate): string => (c.categories?.[0] || c.category || ''), []);
  /** 라벨 — legacy 코드면 i18n, 사용자가 만든 자유 이름이면 그대로. 빈 값이면 "미분류". */
  const catLabel = useCallback((v: string): string => (
    v ? (t(`category.${v}`, v) as string) : (t('aiIngest.noCategory', '미분류') as string)
  ), [t]);
  /** 선택지 = 워크스페이스 등록분 ∪ legacy 6종 ∪ **지금 이 후보의 값**.
   *  마지막 항목이 중요하다 — AI 가 목록 밖 이름을 내놨을 때 그것을 선택지에서 지워 버리면
   *  사용자에게는 값이 조용히 사라진 것으로 보인다(빈 셀렉트). 보이게 두고 고를 수 있게 한다. */
  const catOptions = useCallback((current: string) => {
    const base = wsCats.length ? wsCats : [...CATEGORIES];
    const all = [...new Set([...base, ...CATEGORIES, ...(current ? [current] : [])])];
    return all.map((v) => ({ value: v, label: catLabel(v) }));
  }, [wsCats, catLabel]);
  const [step, setStep] = useState<'input' | 'review'>('input');
  const [text, setText] = useState(initialText || '');
  const [sourceLanguage, setSourceLanguage] = useState<Lang>('ko');
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [visibility, setVisibility] = useState<Visibility>('translate');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [truncNote, setTruncNote] = useState<string | null>(null);   // #322
  const [skipReview, setSkipReview] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 운영 #315 — "AI 추가 할 때도 파일이나 내용 아무거나 올리면 분석해서 적용이 안되는 것 같아."
  //   원인: 이 모달은 **텍스트 붙여넣기 전용**이었다. 파일을 받을 자리가 아예 없는데
  //   진입 버튼 설명은 "문서·링크에서 …" 라고 약속하고 있었다 — 사용자는 "되는데 안 먹는다" 로 읽는다.
  //
  //   ★ 서버가 URL 을 가져오는 방식(링크 수집)은 넣지 않는다 — SSRF 표면이 새로 생긴다.
  //   ★ PDF·워드·엑셀은 파서 의존성이 이 프로젝트에 **하나도 없다**(pdf-parse 미설치).
  //     그래서 조용히 빈 결과를 내는 대신, **무엇이 되고 무엇이 안 되는지 그 자리에서 말한다.**
  //     파일은 브라우저에서 읽어 입력칸에 채운다 — 분석 전에 사용자가 내용을 눈으로 확인할 수 있다.
  const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'html', 'htm', 'xml', 'yml', 'yaml'];
  const [fileNote, setFileNote] = useState<string | null>(null);

  const stripHtml = (raw: string) => raw
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const ingestFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const parts: string[] = [];
    const rejected: string[] = [];
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!TEXT_EXT.includes(ext)) { rejected.push(f.name); continue; }
      try {
        const raw = await f.text();
        const body = (ext === 'html' || ext === 'htm' || ext === 'xml') ? stripHtml(raw) : raw;
        if (body.trim()) parts.push(`--- ${f.name} ---\n${body.trim()}`);
      } catch { rejected.push(f.name); }
    }
    if (parts.length) {
      setText((prev) => {
        const merged = prev.trim() ? `${prev.trim()}\n\n${parts.join('\n\n')}` : parts.join('\n\n');
        return merged.slice(0, 50000);   // 입력 상한과 같은 규칙 — 잘림은 아래에서 고지한다
      });
    }
    const notes: string[] = [];
    if (parts.length) notes.push(t('aiIngest.fileLoaded', { count: parts.length, defaultValue: '{{count}}개 파일을 불러왔습니다.' }) as string);
    if (rejected.length) {
      notes.push(t('aiIngest.fileUnsupported', {
        names: rejected.join(', '),
        defaultValue: '{{names}} 은(는) 아직 읽지 못합니다. 텍스트·마크다운·CSV·JSON·HTML 만 지원합니다 — 내용을 복사해 붙여넣어 주세요.',
      }) as string);
    }
    setFileNote(notes.join(' ') || null);
  }, [t]);

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
      // #322 — 잘렸으면 알린다.
      if (j.data?.truncated) {
        setTruncNote(t('aiIngest.truncated', '{{total}}건 중 {{returned}}건만 가져왔습니다 (한 번에 최대 {{limit}}건).', {
          total: j.data.total_parsed, returned: j.data.returned, limit: j.data.limit,
        }) as string);
      } else setTruncNote(null);
      if (list.length === 0) throw new Error(t('aiIngest.errEmpty', '추출된 항목이 없습니다. 입력 내용을 확인해주세요.') as string);
      setCandidates(list);
      // 검수 스킵 토글이 켜져 있으면 즉시 저장
      if (skipReview) {
        await saveBatch(list);
      } else {
        setStep('review');
      }
    } catch (e) {
      setError(mapApiError(e, tErr));
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
          scope,
          ...(scope === 'project' && projectId ? { project_id: projectId } : {}),
          // 출처를 같이 보낸다 — 저장된 항목에서 원본 문서로 되짚을 수 있게(#284).
          ...(sourcePostId ? { source_post_id: sourcePostId } : {}),
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
      setError(mapApiError(e, tErr));
    } finally {
      setSaving(false);
    }
  }, [businessId, sourceLanguage, autoTranslate, visibility, onSaved, onClose, t, scope, projectId]);

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

              {/* 운영 #315 · #232 — 첨부는 드래그드롭 회색 라운드박스로 통일 */}
              <Field>
                <Label>{t('aiIngest.file', '파일에서 가져오기 (선택)')}</Label>
                {/* ★ 파일을 워크스페이스에 올리지 않는다 — 브라우저에서 읽어 입력칸에 채우고 곧바로 비운다.
                    (여기서 필요한 건 "내용" 이지 "저장된 파일" 이 아니다. 저장하면 지식 목록이 오염된다.) */}
                <AttachmentField
                  businessId={businessId}
                  uploads={[]}
                  onUploadsChange={(fs) => { void ingestFiles(fs); }}
                  existingFileIds={[]}
                  onExistingFileIdsChange={() => {}}
                  hideExistingSearch
                  accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.html,.htm,.xml,.yml,.yaml"
                  uploadHint={t('aiIngest.fileHint', '텍스트·마크다운·CSV·JSON·HTML 파일을 떨어뜨리면 내용을 입력칸에 채웁니다') as string}
                />
                {fileNote && <FileNote>{fileNote}</FileNote>}
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
              {/* #322 — 초과분이 조용히 잘리지 않게 */}
              {truncNote && <TruncBox>{truncNote}</TruncBox>}
              <ReviewList>
                {candidates.map((c, idx) => (
                  <ReviewCard key={idx} $excluded={!!c.excluded}>
                    <CardTopRow>
                      <CardNum>#{idx + 1}</CardNum>
                      <CardCategoryWrap>
                        <PlanQSelect size="sm" isSearchable={false}
                          value={{ value: catOf(c), label: catLabel(catOf(c)) }}
                          options={catOptions(catOf(c))}
                          onChange={(opt) => {
                            const v = (opt as PlanQSelectOption | null)?.value as string | undefined;
                            // 저장은 categories(배열)로 나간다 — 단수 필드만 고치면 화면만 바뀌고 저장은 그대로다.
                            if (v) updateCandidate(idx, { categories: [v], category: v as Category });
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
    margin-top: 60px; height: calc(var(--vvh, 100vh) - 60px);
  }
`;
const Header = styled.div`
  padding: 18px 22px 14px;
  border-bottom: 1px solid #E2E8F0;
  display: flex; align-items: center; justify-content: space-between;
`;
const Title = styled.h3`
  margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A;
  display: inline-flex; align-items: center; gap: 8px;
  svg { color: #14B8A6; }
`;
const CloseBtn = styled.button`
  /* touch-target-44: 폰 터치 타깃 (theme/tokens CONTROL.touchMin). 데스크탑 크기는 그대로. */
  @media (max-width: 640px) { min-width: 44px; min-height: 44px; }

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
  font-size: 0.8125rem; color: #475569; line-height: 1.6;
  padding: 12px 14px; background: #F0FDFA; border: 1px solid #99F6E4;
  border-radius: 8px;
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
`;
const ReviewCount = styled.span`
  font-size: 0.6875rem; font-weight: 700; color: #0F766E; flex-shrink: 0;
  padding: 2px 8px; background: #FFFFFF; border: 1px solid #99F6E4; border-radius: 999px;
`;
const Field = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const Label = styled.label`
  font-size: 0.75rem; font-weight: 700; color: #475569;
`;
const TextArea = styled.textarea`
  width: 100%; box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; font-family: inherit;
  resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const CharCount = styled.div`
  text-align: right; font-size: 0.6875rem; color: #94A3B8;
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
  font-size: 0.75rem; color: #475569;
`;
const SkipReview = styled.div`
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 8px;
`;
const ErrorBox = styled.div`
  padding: 10px 12px; background: #FEF2F2; border: 1px solid #FECACA;
  border-radius: 8px; font-size: 0.8125rem; color: #B91C1C;
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
  font-size: 0.6875rem; font-weight: 700; color: #94A3B8;
  font-family: ui-monospace, monospace;
`;
// CardCategorySelect 폐지 — PlanQSelect 사용
const CardCategoryWrap = styled.div`
  min-width: 120px;
`;
const CardSpacer = styled.div`flex: 1;`;
const CardExcludeBtn = styled.button`
  padding: 4px 10px; font-size: 0.75rem; font-weight: 600; color: #64748B;
  border: 1px solid #E2E8F0; background: #FFFFFF; border-radius: 6px; cursor: pointer;
  &:hover { color: #B91C1C; border-color: #FECACA; background: #FEF2F2; }
`;
const CardTitleInput = styled.input`
  padding: 8px 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 0.875rem; font-weight: 600; color: #0F172A;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const CardBodyTextArea = styled.textarea`
  padding: 8px 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 0.8125rem; color: #334155; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; }
`;
const CardTagsInput = styled.input`
  padding: 6px 10px;
  border: 1px solid #E2E8F0; border-radius: 6px;
  font-size: 0.75rem; color: #475569;
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
  border: none; border-radius: 8px; font-size: 0.8125rem; font-weight: 700; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 8px 16px; background: #FFFFFF; color: #475569;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
