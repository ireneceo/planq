// AI 로 문서 작성 모달 — 두 모드 (탭으로 구분)
//   1) 새 문서 작성 — kind/title/컨텍스트 → AI 본문 생성
//   2) 자료정리 — 여러 자료 텍스트 (빈 줄 2개 구분) → AI 통합 정리 → BriefViewer 진입
//
// 컨텍스트 우선순위 (새 문서 모드만 해당):
//   1. props.projectId (page-level) → selector 숨김
//   2. workspace 스코프 → client/project selector 표시
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { aiGenerateDoc, KIND_LABELS_KO, type DocKind } from '../../services/docs';
import { createBrief } from '../../services/posts';
import { listClientsForBilling, type ApiClientLite } from '../../services/invoices';
import { listProjects, type ApiProject } from '../../services/qtalk';
import { uploadMyFile } from '../../services/files';
import { fetchStatus } from '../../services/plan';
import PlanQSelect, { type PlanQSelectOption } from '../Common/PlanQSelect';
import AttachmentField from '../Common/AttachmentField';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  // 페이지에서 이미 알고 있는 컨텍스트. 주어지면 모달의 selector 숨기고 그대로 전송.
  projectId?: number | null;
  clientId?: number | null;
  onGenerate: (result: { title: string; bodyHtml: string }) => void;
  // 빈 에디터 진입 — 부모가 startNew 호출
  onBlank?: () => void;
  // 진입 의도 — 'manual'(빈 문서/표) 또는 'ai'(AI 작성/자료정리). default 'manual'
  intent?: 'manual' | 'ai';
}

const KIND_OPTIONS: PlanQSelectOption[] = [
  { value: 'proposal', label: KIND_LABELS_KO.proposal },
  { value: 'quote', label: KIND_LABELS_KO.quote },
  { value: 'invoice', label: KIND_LABELS_KO.invoice },
  { value: 'contract', label: KIND_LABELS_KO.contract },
  { value: 'sow', label: KIND_LABELS_KO.sow },
  { value: 'nda', label: KIND_LABELS_KO.nda },
  { value: 'meeting_note', label: KIND_LABELS_KO.meeting_note },
  { value: 'custom', label: KIND_LABELS_KO.custom },
];

type Mode = 'blank' | 'new' | 'brief' | 'table';

const PostAiModal: React.FC<Props> = ({ open, onClose, businessId, projectId: pageProjectId, clientId: pageClientId, onGenerate, onBlank, intent = 'manual' }) => {
  const { t } = useTranslation('qdocs');
  const navigate = useNavigate();
  // intent 별 사용 가능 탭 — manual: 빈문서+표 / ai: AI 작성+자료정리
  const visibleModes: Mode[] = intent === 'ai' ? ['new', 'brief'] : ['blank', 'table'];
  const defaultMode: Mode = intent === 'ai' ? 'new' : 'blank';
  const [mode, setMode] = useState<Mode>(defaultMode);
  // intent 가 바뀔 때마다 default 모드로 초기화
  useEffect(() => { if (open) setMode(defaultMode); }, [intent, open]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [kind, setKind] = useState<DocKind | null>(null);
  const [title, setTitle] = useState('');
  const [userInput, setUserInput] = useState('');
  const [briefTitle, setBriefTitle] = useState('');
  const [briefText, setBriefText] = useState('');
  const [briefStagedUploads, setBriefStagedUploads] = useState<File[]>([]);
  const [briefExistingIds, setBriefExistingIds] = useState<number[]>([]);
  const [briefPostIds, setBriefPostIds] = useState<number[]>([]);

  // 사이클 N+20 — Cue 사용량 hint + 한도 초과 임박 시 확인 모달
  const [cueUsage, setCueUsage] = useState<{ current: number; limit: number | null } | null>(null);
  const [briefConfirmOpen, setBriefConfirmOpen] = useState(false);
  useEffect(() => {
    if (!open || !businessId) return;
    let mounted = true;
    fetchStatus(businessId)
      .then((s) => {
        if (!mounted || !s) return;
        setCueUsage({
          current: s.usage?.cue_actions_this_month ?? 0,
          limit: s.plan?.limits?.cue_actions_monthly ?? null,
        });
      })
      .catch(() => { /* status fetch 실패 — hint 미표시 */ });
    return () => { mounted = false; };
  }, [open, businessId]);
  const cueRemaining = cueUsage?.limit != null ? Math.max(0, cueUsage.limit - cueUsage.current) : null;
  const cueNearLimit = cueUsage?.limit != null && cueUsage.current / cueUsage.limit >= 0.8;
  const cueOverLimit = cueUsage?.limit != null && cueUsage.current >= cueUsage.limit;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ total: number; limit: number } | null>(null);

  // 페이지에서 컨텍스트가 주어지지 않은 워크스페이스 스코프에서만 selector 표시.
  const showSelectors = !pageProjectId;
  const [pickedClientId, setPickedClientId] = useState<number | null>(null);
  const [pickedProjectId, setPickedProjectId] = useState<number | null>(null);
  const [clients, setClients] = useState<ApiClientLite[]>([]);
  const [projects, setProjects] = useState<ApiProject[]>([]);

  useEffect(() => {
    if (!open) return;
    if (!showSelectors) return;
    let cancelled = false;
    (async () => {
      const [cls, prjs] = await Promise.all([
        listClientsForBilling(businessId).catch(() => [] as ApiClientLite[]),
        listProjects(businessId).catch(() => [] as ApiProject[]),
      ]);
      if (cancelled) return;
      setClients(cls); setProjects(prjs);
    })();
    return () => { cancelled = true; };
  }, [open, businessId, showSelectors]);

  // project 선택 → 그 프로젝트의 primary client 자동 매핑 (사용자가 client 미선택 상태에 한해)
  useEffect(() => {
    if (!pickedProjectId || pickedClientId) return;
    const proj = projects.find(p => p.id === pickedProjectId);
    const pc = proj?.projectClients?.[0];
    if (pc?.client_id) setPickedClientId(pc.client_id);
  }, [pickedProjectId, projects, pickedClientId]);

  const clientOptions: PlanQSelectOption[] = useMemo(() => clients.map(c => ({
    value: c.id, label: c.display_name || c.company_name || `Client ${c.id}`,
  })), [clients]);
  const projectOptions: PlanQSelectOption[] = useMemo(() => projects.map(p => ({
    value: p.id, label: p.name,
  })), [projects]);

  useBodyScrollLock(open);
  useEscapeStack(open && !busy, onClose);

  if (!open) return null;

  // 백엔드로 보낼 client/project — 페이지 컨텍스트 우선, 없으면 사용자가 모달에서 고른 값.
  const sendClientId = pageClientId ?? pickedClientId;
  const sendProjectId = pageProjectId ?? pickedProjectId;

  const submitNewDoc = async () => {
    setError(null);
    if (!kind) { setError(t('ai.kindRequired', '문서 종류를 선택하세요') as string); return; }
    if (!title.trim()) { setError(t('ai.titleRequired', '제목을 입력하세요') as string); return; }
    setBusy(true);
    try {
      const r = await aiGenerateDoc({
        business_id: businessId, kind, title: title.trim(), user_input: userInput.trim(),
        client_id: sendClientId,
        project_id: sendProjectId,
      });
      if (r.usage) setUsage({ total: r.usage.total, limit: r.usage.limit });
      onGenerate({ title: title.trim(), bodyHtml: r.body_html });
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('cue_limit_exceeded') || msg.includes('limit_exceeded')) {
        setError(t('ai.limitExceeded', '이번 달 AI 사용량 한도를 모두 사용했습니다. 플랜을 업그레이드하거나 다음 달까지 기다려 주세요.') as string);
      } else if (msg.includes('llm_unavailable')) {
        setError(t('ai.unavailable', 'AI 서비스가 일시적으로 사용 불가합니다. 잠시 후 다시 시도해 주세요.') as string);
      } else {
        setError(msg || (t('ai.failed', 'AI 생성에 실패했습니다.') as string));
      }
    } finally {
      setBusy(false);
    }
  };


  const submitBrief = async () => {
    setError(null);
    const blocks = briefText.split(/\n{3,}/).map(b => b.trim()).filter(Boolean);
    const hasFiles = briefStagedUploads.length > 0 || briefExistingIds.length > 0;
    const hasPosts = briefPostIds.length > 0;
    if (blocks.length === 0 && !hasFiles && !hasPosts) {
      setError(t('brief.emptyError', '자료를 입력하거나 파일·기존 문서를 첨부하세요.') as string);
      return;
    }
    const finalTitle = briefTitle.trim() || `${t('brief.defaultTitlePrefix', '자료정리')} — ${new Date().toLocaleDateString('ko-KR')}`;
    setBusy(true);
    try {
      // 1) 로컬 업로드 → file_id 수집
      const uploadedIds: number[] = [];
      for (const f of briefStagedUploads) {
        const r = await uploadMyFile(businessId, f);
        if (r.success && r.file) {
          const numId = Number(String(r.file.id).replace('direct-', ''));
          if (Number.isFinite(numId)) uploadedIds.push(numId);
        }
      }
      const allFileIds = [...uploadedIds, ...briefExistingIds];

      const result = await createBrief({
        business_id: businessId,
        project_id: pageProjectId ?? null,
        title: finalTitle,
        text_blocks: blocks,
        attached_file_ids: allFileIds,
        attached_post_ids: briefPostIds,
      });
      onClose();
      navigate(`/docs/brief/${result.post_id}`);
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('cue_limit_exceeded') || msg.includes('limit_exceeded')) {
        setError(t('brief.limitExceeded', '이번 달 AI 사용량 한도를 모두 사용했습니다.') as string);
      } else {
        setError(t('brief.failed', '자료정리 생성 실패. 잠시 후 다시 시도하세요.') as string);
      }
    } finally {
      setBusy(false);
    }
  };

  // 표(table) — 자동 제목으로 빈 q_record + post 생성 → /docs?post=:id 진입.
  // 제목은 편집 화면에서 인라인으로 변경.
  const submitTable = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const autoTitle = title.trim() || `${t('ai.tableDefaultPrefix', '표')} — ${new Date().toLocaleDateString('ko-KR')}`;
      const { apiFetch } = await import('../../contexts/AuthContext');
      const r = await apiFetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          project_id: pageProjectId ?? pickedProjectId ?? null,
          client_id: pageClientId ?? pickedClientId ?? null,
          title: autoTitle,
          kind: 'table',
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      onClose();
      navigate(`/docs?post=${j.data.id}`);
    } catch (e: unknown) {
      setError((e as Error).message || (t('ai.failed', '생성 실패') as string));
    } finally {
      setBusy(false);
    }
  };

  // 빈 에디터 진입 — 부모 startNew 호출
  const submitBlank = () => { if (onBlank) { onBlank(); onClose(); } };

  // 사이클 N+20 — brief / new doc 은 AI cue 차감. 한도 초과 임박 시 확인 모달.
  const submitWithCueGuard = (action: () => void) => {
    if (cueOverLimit) {
      // 이미 초과 — 진행 차단 (사용자에게 알리고 업그레이드 유도). modal 안에서 disable.
      return;
    }
    if (cueNearLimit) {
      setBriefConfirmOpen(true);
      return;
    }
    action();
  };
  const submit = () => {
    if (mode === 'blank') return submitBlank();
    if (mode === 'table') return submitTable();
    if (mode === 'brief') return submitWithCueGuard(submitBrief);
    return submitWithCueGuard(submitNewDoc);
  };
  const canSubmit = mode === 'blank' ? true
    : mode === 'table' ? true   // 자동 제목으로 즉시 생성, 셀렉터만 채우면 됨
    : mode === 'brief' ? (!!briefText.trim() || briefStagedUploads.length > 0 || briefExistingIds.length > 0 || briefPostIds.length > 0)
    : !!title.trim();

  return (
    <Backdrop onClick={() => !busy && onClose()}>
      <Dialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={(intent === 'ai' ? t('ai.title') : t('btn.new')) as string}>
        <Header>
          <Title>
            {intent === 'ai' && (
              <Sparkle>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
              </Sparkle>
            )}
            {intent === 'ai' ? t('ai.title') : t('btn.new')}
          </Title>
          <CloseBtn type="button" onClick={onClose} disabled={busy} aria-label={t('common.close', '닫기') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </CloseBtn>
        </Header>

        <Body>
        <Tabs role="tablist" aria-label={t('ai.modeAria', '작성 방식 선택') as string} style={{ display: 'grid', gridTemplateColumns: `repeat(${visibleModes.length}, 1fr)` }}>
          {visibleModes.includes('blank') && (
            <Tab type="button" role="tab" aria-selected={mode === 'blank'} $active={mode === 'blank'}
              onClick={() => { if (!busy) { setMode('blank'); setError(null); } }} disabled={busy}>
              <TabTitle>{t('ai.modeBlank', '빈 문서')}</TabTitle>
              <TabHint>{t('ai.modeBlankHint', '직접 작성')}</TabHint>
            </Tab>
          )}
          {visibleModes.includes('table') && (
            <Tab type="button" role="tab" aria-selected={mode === 'table'} $active={mode === 'table'}
              onClick={() => { if (!busy) { setMode('table'); setError(null); } }} disabled={busy}>
              <TabTitle>{t('ai.modeTable', '표')}</TabTitle>
              <TabHint>{t('ai.modeTableHint', '계정·자산 등 행/열 데이터')}</TabHint>
            </Tab>
          )}
          {visibleModes.includes('new') && (
            <Tab type="button" role="tab" aria-selected={mode === 'new'} $active={mode === 'new'}
              onClick={() => { if (!busy) { setMode('new'); setError(null); } }} disabled={busy}>
              <TabTitle>{t('ai.modeNew', 'AI 신규작성')}</TabTitle>
              <TabHint>{t('ai.modeNewHint', '제안서·견적·계약 등 양식 기반')}</TabHint>
            </Tab>
          )}
          {visibleModes.includes('brief') && (
            <Tab type="button" role="tab" aria-selected={mode === 'brief'} $active={mode === 'brief'}
              onClick={() => { if (!busy) { setMode('brief'); setError(null); } }} disabled={busy}>
              <TabTitle>{t('ai.modeBrief', '자료 기반 작성')}</TabTitle>
              <TabHint>{t('ai.modeBriefHint', '자료 분석 후 재정리하여 작성')}</TabHint>
            </Tab>
          )}
        </Tabs>

          {(pageProjectId || pageClientId) && (
            <ContextBadge>
              {t('ai.contextLinked', '현재 페이지 컨텍스트로 연결되어 회사명·담당자·금액이 자동 채워집니다.')}
            </ContextBadge>
          )}
          {/* blank/table 은 첨부 UI 미노출 — 에디터에서 본문 작성 중 첨부하도록.
              모달 단계에 첨부가 있으면 'AI 가 자료 가공해서 만들어준다' 같은 오해를 줌. */}
          {mode === 'blank' ? (
            <BriefIntro>
              {t('ai.blankDesc', '빈 본문으로 시작합니다. 제목을 입력하고 본문을 직접 작성하세요. AI 사용량 안 씁니다.')}
            </BriefIntro>
          ) : mode === 'table' ? (
            <>
              <BriefIntro>
                {t('ai.tableDesc2', '빈 표가 생성됩니다. 제목·컬럼·행은 표 화면에서 직접 편집할 수 있어요.')}
              </BriefIntro>
              {error && <ErrorBox>{error}</ErrorBox>}
            </>
          ) : mode === 'new' ? (
            <>
              <Field>
                <Label>{t('ai.kind', '문서 종류')} *</Label>
                <PlanQSelect
                  size="sm"
                  options={KIND_OPTIONS}
                  value={KIND_OPTIONS.find(o => o.value === kind) || null}
                  onChange={(opt) => setKind(((opt as PlanQSelectOption)?.value as DocKind) || null)}
                  placeholder={t('ai.kindPh', '문서 종류 선택') as string}
                  isSearchable={false}
                  isDisabled={busy}
                />
              </Field>
              <Field>
                <Label>{t('ai.docTitle', '제목')} *</Label>
                <Input
                  type="text" value={title} onChange={e => setTitle(e.target.value)}
                  placeholder={t('ai.titlePh', '예: 클라이언트 온보딩 자동화 제안서') as string}
                  disabled={busy}
                />
              </Field>
              <Field>
                <Label>{t('ai.input', '요구사항 / 컨텍스트 (선택)')}</Label>
                <Textarea
                  rows={5} value={userInput} onChange={e => setUserInput(e.target.value)}
                  placeholder={t('ai.inputPh', '특별히 강조하고 싶은 점, 고객 상황, 포함해야 할 항목 등을 자유롭게 작성하세요. (비워도 표준 양식으로 작성됩니다)') as string}
                  disabled={busy}
                />
              </Field>
              <Field>
                <Label>{t('common.attach', '파일·문서 첨부')} <OptionalMark>{t('brief.optional', '(선택)')}</OptionalMark></Label>
                <AttachmentField
                  businessId={businessId}
                  uploads={briefStagedUploads}
                  onUploadsChange={setBriefStagedUploads}
                  existingFileIds={briefExistingIds}
                  onExistingFileIdsChange={setBriefExistingIds}
                  includePosts
                  existingPostIds={briefPostIds}
                  onExistingPostIdsChange={setBriefPostIds}
                  disabled={busy}
                />
              </Field>
              <Hint>{t('ai.hint', '생성된 본문은 자동 저장되지 않습니다. 검토·수정 후 저장 버튼을 눌러주세요.')}</Hint>
            </>
          ) : (
            <>
              <BriefIntro>
                {t('brief.composeDesc', '여러 자료(메일·회의록·파일)를 빈 줄 2개로 구분해 붙여넣거나 파일을 첨부하면 시점·자료별로 정리하고 추천 후속 문서를 만들어 드립니다.')}
              </BriefIntro>
              <Field>
                <Label>{t('brief.titleLabel', '제목 (선택)')}</Label>
                <Input
                  type="text" value={briefTitle} onChange={e => setBriefTitle(e.target.value)}
                  placeholder={t('brief.titlePh', '비우면 오늘 날짜로 자동 생성') as string}
                  maxLength={200}
                  disabled={busy}
                />
              </Field>
              <Field>
                <Label>{t('brief.textLabel', '텍스트로 붙여넣기')} <OptionalMark>{t('brief.optional', '(선택)')}</OptionalMark></Label>
                <Textarea
                  rows={5} value={briefText} onChange={e => setBriefText(e.target.value)}
                  placeholder={t('brief.sourcesPh', '예시:\n\n2026-04-15 회의록\n주제: 1분기 매출 리뷰\n결정: 마케팅 예산 20% 증액\n\n\n2026-04-22 후속 미팅\n주제: ROI 분석\n결정: 페이스북 축소·네이버 확대') as string}
                  disabled={busy}
                />
                <Hint>{t('brief.separatorHint', '여러 자료는 빈 줄 2개로 구분하세요.')}</Hint>
              </Field>

              <Field>
                <Label>{t('brief.attachLabel', '파일·문서 첨부')} <OptionalMark>{t('brief.optional', '(선택)')}</OptionalMark></Label>
                <AttachmentField
                  businessId={businessId}
                  uploads={briefStagedUploads}
                  onUploadsChange={setBriefStagedUploads}
                  existingFileIds={briefExistingIds}
                  onExistingFileIdsChange={setBriefExistingIds}
                  includePosts
                  existingPostIds={briefPostIds}
                  onExistingPostIdsChange={setBriefPostIds}
                  disabled={busy}
                />
              </Field>
            </>
          )}
          {/* 4 모드 공통 — 컨텍스트 셀렉터 (Body 맨 끝에 배치) */}
          {showSelectors && (
            <>
              <Field>
                <Label>{t('ai.client', '고객 연결 (선택)')}</Label>
                <PlanQSelect
                  size="sm"
                  options={clientOptions}
                  value={clientOptions.find(o => o.value === pickedClientId) || null}
                  onChange={(opt) => setPickedClientId(opt ? Number((opt as PlanQSelectOption).value) : null)}
                  placeholder={
                    clientOptions.length === 0
                      ? (t('ai.clientEmpty', '등록된 고객 없음') as string)
                      : (t('ai.clientPh', '고객 선택 — 회사명·담당자 자동 채움 (선택)') as string)
                  }
                  isClearable isSearchable isDisabled={busy}
                />
              </Field>
              <Field>
                <Label>{t('ai.project', '프로젝트 연결 (선택)')}</Label>
                <PlanQSelect
                  size="sm"
                  options={projectOptions}
                  value={projectOptions.find(o => o.value === pickedProjectId) || null}
                  onChange={(opt) => setPickedProjectId(opt ? Number((opt as PlanQSelectOption).value) : null)}
                  placeholder={t('ai.projectPh', '프로젝트 선택 — 고객 자동 매핑 (선택)') as string}
                  isClearable isSearchable isDisabled={busy}
                />
              </Field>
            </>
          )}
          {usage && (
            <UsageRow>
              {t('ai.usage', '이번 달 사용량')}: <strong>{usage.total} / {usage.limit}</strong>
            </UsageRow>
          )}
          {/* 사이클 N+20 — Cue 잔여 hint (AI 모드만). 초과 임박/도달 시 강조. */}
          {intent === 'ai' && cueUsage && cueUsage.limit != null && (mode === 'brief' || mode === 'new') && (
            <CueHint $danger={cueOverLimit} $warn={cueNearLimit && !cueOverLimit}>
              {cueOverLimit
                ? t('ai.cueOver', { defaultValue: 'AI 한도 초과 — 플랜을 업그레이드해야 진행할 수 있어요.' }) as string
                : cueNearLimit
                  ? t('ai.cueNear', { remaining: cueRemaining, defaultValue: '잔여 {{remaining}}회 — 진행 시 확인 모달이 뜹니다.' }) as string
                  : t('ai.cueNormal', { used: cueUsage.current, limit: cueUsage.limit, defaultValue: 'AI 사용 1회 차감 (이번 달 {{used}}/{{limit}})' }) as string}
            </CueHint>
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
        </Body>

        <Footer>
          <SecondaryBtn type="button" onClick={onClose} disabled={busy}>{t('cancel', '취소')}</SecondaryBtn>
          <PrimaryBtn type="button" $accent={intent === 'ai'} onClick={submit} disabled={busy || !canSubmit || cueOverLimit}>
            {busy ? (
              <><Spinner />{mode === 'brief'
                ? t('brief.generating', '작성 중...')
                : mode === 'table'
                  ? t('ai.tableCreating', '작성 중...')
                  : t('ai.generating', '작성 중…')}</>
            ) : (
              <>
                {intent === 'ai' && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
                )}
                {mode === 'blank'
                  ? t('ai.blankStart', '빈 문서 작성')
                  : mode === 'brief'
                  ? t('brief.generate', '자료 기반 작성')
                  : mode === 'table'
                    ? t('ai.tableCreate', '표 작성')
                    : t('ai.generate', 'AI 신규작성')}
              </>
            )}
          </PrimaryBtn>
        </Footer>

        {/* 사이클 N+20 — Cue 한도 임박 시 진행 확인 모달 */}
        {briefConfirmOpen && cueUsage && (
          <ConfirmOverlay onClick={() => setBriefConfirmOpen(false)}>
            <ConfirmDialog onClick={(e) => e.stopPropagation()}>
              <ConfirmTitle>{t('ai.cueConfirmTitle', 'AI 한도 임박 — 진행할까요?')}</ConfirmTitle>
              <ConfirmDesc>
                {t('ai.cueConfirmDesc', {
                  used: cueUsage.current,
                  limit: cueUsage.limit,
                  remaining: cueRemaining,
                  defaultValue: '이번 달 AI 사용 {{used}}/{{limit}} — 잔여 {{remaining}}회. 이 작업은 1회 차감됩니다.',
                }) as string}
              </ConfirmDesc>
              <ConfirmActions>
                <SecondaryBtn type="button" onClick={() => setBriefConfirmOpen(false)}>
                  {t('cancel', '취소') as string}
                </SecondaryBtn>
                <PrimaryBtn type="button" $accent={true} onClick={() => {
                  setBriefConfirmOpen(false);
                  if (mode === 'brief') submitBrief();
                  else if (mode === 'new') submitNewDoc();
                }}>
                  {t('ai.cueConfirmProceed', '진행') as string}
                </PrimaryBtn>
              </ConfirmActions>
            </ConfirmDialog>
          </ConfirmOverlay>
        )}
      </Dialog>
    </Backdrop>
  );
};

export default PostAiModal;

// ─── styled ───
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.4);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px;
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px; max-width: 560px; width: 100%;
  max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  /* mobile: top/bottom 고정으로 GNB 피하고 화면 안에 확실히 배치 */
  @media (max-width: 640px) {
    position: fixed; top: 70px; bottom: 20px; left: 16px; right: 16px;
    width: auto; max-width: none; max-height: none;
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
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #64748B;
  &:hover:not(:disabled) { background: #F1F5F9; color: #0F172A; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Tabs = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  margin-bottom: 12px;
`;
const Tab = styled.button<{ $active: boolean }>`
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 12px 14px;
  background: ${({ $active }) => $active ? '#F0FDFA' : '#FFFFFF'};
  border: 1px solid ${({ $active }) => $active ? '#14B8A6' : '#E2E8F0'};
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
  &:hover:not(:disabled) { border-color: #14B8A6; background: #F0FDFA; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid rgba(20,184,166,0.3); outline-offset: 2px; }
`;
const TabTitle = styled.span`
  font-size: 13px; font-weight: 700; color: #0F172A;
`;
const TabHint = styled.span`
  font-size: 11px; font-weight: 500; color: #64748B; line-height: 1.4;
`;
const BriefIntro = styled.p`
  font-size: 12px; color: #334155; line-height: 1.6; margin: 0 0 12px;
  padding: 10px 12px; background: #F8FAFC; border-radius: 8px;
`;
const Body = styled.div`
  padding: 16px 22px 12px;
  flex: 1; overflow-y: auto;
  min-height: 0;
`;
const OptionalMark = styled.span`color: #94A3B8; font-weight: 400; font-size: 11px; margin-left: 4px;`;
const Field = styled.div`display:flex;flex-direction:column;gap:6px;margin-bottom:12px;`;
const Label = styled.label`font-size:12px;font-weight:600;color:#0F172A;`;
const Input = styled.input`
  width: 100%; padding: 9px 12px; font-size: 13px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  &:focus { outline: none; border-color: #14B8A6; }
  &:disabled { background: #F8FAFC; }
`;
const Textarea = styled.textarea`
  width: 100%; padding: 10px 12px; font-size: 13px; color: #0F172A;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #fff;
  resize: vertical; font-family: inherit; line-height: 1.55;
  &:focus { outline: none; border-color: #14B8A6; }
  &:disabled { background: #F8FAFC; }
`;
const Hint = styled.p`font-size:11px;color:#94A3B8;margin:6px 0 0;line-height:1.5;`;
const ContextBadge = styled.div`
  font-size: 11px; color: #0F766E;
  background: #F0FDFA; border: 1px solid #CCFBF1;
  padding: 8px 10px; border-radius: 6px; margin: 8px 0;
`;
const UsageRow = styled.div`
  font-size: 12px; color: #64748B; margin-top: 8px;
  background: #F8FAFC; padding: 8px 10px; border-radius: 6px;
`;
const ErrorBox = styled.div`
  font-size: 12px; color: #DC2626; background: #FEF2F2;
  padding: 8px 10px; border-radius: 6px; margin-top: 8px;
`;
const Footer = styled.div`
  display: flex; justify-content: flex-end; gap: 6px;
  padding: 12px 22px 18px;
  flex-shrink: 0;
  border-top: 1px solid #F1F5F9; background: #fff;
`;
const PrimaryBtn = styled.button<{ $accent?: boolean }>`
  display: inline-flex; align-items: center;
  padding: 9px 18px; font-size: 13px; font-weight: 700; color: #fff;
  background: ${p => p.$accent ? 'linear-gradient(135deg, #F43F5E 0%, #BE185D 100%)' : '#14B8A6'};
  border: none; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, transform 0.15s;
  &:hover:not(:disabled) { ${p => p.$accent ? 'transform: translateY(-1px);' : 'background: #0D9488;'} }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 9px 16px; font-size: 13px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { border-color: #CBD5E1; background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Spinner = styled.span`
  width: 12px; height: 12px; margin-right: 6px;
  border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
`;

// 사이클 N+20 — Cue 한도 hint + 확인 모달 styled
const CueHint = styled.div<{ $danger?: boolean; $warn?: boolean }>`
  margin-top: 8px;
  padding: 8px 12px;
  background: ${p => p.$danger ? '#FEF2F2' : p.$warn ? '#FFFBEB' : '#F0FDFA'};
  border: 1px solid ${p => p.$danger ? '#FECACA' : p.$warn ? '#FDE68A' : '#99F6E4'};
  color: ${p => p.$danger ? '#991B1B' : p.$warn ? '#78350F' : '#0F766E'};
  border-radius: 8px;
  font-size: 12px; font-weight: 500;
`;
const ConfirmOverlay = styled.div`
  position: absolute; inset: 0;
  background: rgba(15,23,42,0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 10;
  border-radius: 14px;
`;
const ConfirmDialog = styled.div`
  background: #FFFFFF;
  border-radius: 12px;
  padding: 20px 22px;
  max-width: 380px; width: 90%;
  box-shadow: 0 16px 48px rgba(15,23,42,0.25);
  display: flex; flex-direction: column; gap: 12px;
`;
const ConfirmTitle = styled.div`
  font-size: 15px; font-weight: 700; color: #0F172A;
`;
const ConfirmDesc = styled.div`
  font-size: 13px; color: #475569; line-height: 1.6;
`;
const ConfirmActions = styled.div`
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;
`;
