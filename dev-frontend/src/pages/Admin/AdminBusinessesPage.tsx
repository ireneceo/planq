// /admin/businesses — 플랫폼 관리자 전용 워크스페이스 관리
// 마스터-디테일 드로어 패턴 (ClientsPage 와 동일)
// URL 싱크: ?workspace=:id
// 재클릭 토글 / body scroll lock / focus trap / Esc 스택
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import PageShell from '../../components/Layout/PageShell';
import SearchBox from '../../components/Common/SearchBox';
import DetailDrawer from '../../components/Common/DetailDrawer';
import CalendarPicker from '../../components/Common/CalendarPicker';
import BillingExemptModal from './BillingExemptModal';
import {
  ModalOverlay, Dialog, DTitle, DBody, DDesc, DFooter, DError, FSpacer,
  Field, FLabel, FValue, FHelp, PlanOptions, PlanOption,
  DateTrigger, DatePH, TextArea, PrimaryBtn, SecondaryBtn, ExemptBadge,
} from './adminModalKit';
import {
  fetchAdminBusinesses,
  fetchAdminBusinessDetail,
  fetchAdminBusinessHistory,
  fetchAdminPlanCatalog,
  adminChangePlan,
  adminUpdateTrial,
  type AdminBusinessRow,
  type AdminBusinessDetail,
  type AdminPlanHistoryItem,
} from '../../services/admin';
import type { PlanCode, PlanDef } from '../../services/plan';

// 면제가 **지금** 유효한가 — 백엔드 services/plan.js getBusinessPlan 의 exemptActive 와 같은 술어.
// raw 플래그만 보면 종료일이 지나 정상 과금 중인데도 목록에 면제 뱃지가 남는다(Fable 권고 3).
function isExemptNow(b: { billing_exempt?: boolean; billing_exempt_until?: string | null }): boolean {
  if (!b.billing_exempt) return false;
  if (!b.billing_exempt_until) return true;
  return new Date(b.billing_exempt_until).getTime() > Date.now();
}

const PLAN_ORDER: PlanCode[] = ['free', 'starter', 'basic', 'pro', 'enterprise'];
const PLAN_COLOR: Record<PlanCode, { bg: string; fg: string }> = {
  free:       { bg: '#F1F5F9', fg: '#475569' },
  starter:    { bg: '#FEF3C7', fg: '#92400E' },
  basic:      { bg: '#DBEAFE', fg: '#1D4ED8' },
  pro:        { bg: '#F0FDFA', fg: '#0F766E' },
  enterprise: { bg: '#F0FDFA', fg: '#0F766E' },
};

function fmtBytes(b: number): string {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function dateToInput(d: string | null | undefined): string {
  if (!d) return '';
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ''; }
}

export default function AdminBusinessesPage() {
  const { t } = useTranslation('admin');
  const { formatDateTime } = useTimeFormat();
  const [params, setParams] = useSearchParams();

  const [rows, setRows] = useState<AdminBusinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [catalog, setCatalog] = useState<PlanDef[]>([]);

  const activeId = params.get('workspace') ? Number(params.get('workspace')) : null;

  const [detail, setDetail] = useState<AdminBusinessDetail | null>(null);
  const [history, setHistory] = useState<AdminPlanHistoryItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // 모달 상태
  // 결제 면제 (운영 #275) — 모달 본체는 BillingExemptModal 로 절출했다(god-file 래칫).
  const [exemptOpen, setExemptOpen] = useState(false);

  const [planModal, setPlanModal] = useState<{ open: boolean; toPlan: PlanCode; note: string; expires: string; submitting: boolean; error: string | null }>(
    { open: false, toPlan: 'free', note: '', expires: '', submitting: false, error: null }
  );
  const [trialModal, setTrialModal] = useState<{ open: boolean; date: string; submitting: boolean; error: string | null }>(
    { open: false, date: '', submitting: false, error: null }
  );

  // 날짜 선택기 상태
  const [planExpiresPickerOpen, setPlanExpiresPickerOpen] = useState(false);
  const [trialDatePickerOpen, setTrialDatePickerOpen] = useState(false);
  const planExpiresAnchorRef = useRef<HTMLButtonElement>(null);
  const trialDateAnchorRef = useRef<HTMLButtonElement>(null);

  const loadList = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await fetchAdminBusinesses(query.trim());
      setRows(data);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [query]);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    fetchAdminPlanCatalog().then(setCatalog).catch(() => {});
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const [d, h] = await Promise.all([
        fetchAdminBusinessDetail(id),
        fetchAdminBusinessHistory(id),
      ]);
      setDetail(d);
      setHistory(h);
    } catch (e) {
      setError((e as Error).message);
    } finally { setDetailLoading(false); }
  }, []);

  useEffect(() => {
    if (activeId) {
      loadDetail(activeId);
    } else {
      setDetail(null);
      setHistory([]);
    }
  }, [activeId, loadDetail]);

  // 리스트 재클릭 토글
  const selectRow = (id: number) => {
    if (activeId === id) {
      params.delete('workspace');
      setParams(params, { replace: true });
    } else {
      params.set('workspace', String(id));
      setParams(params, { replace: true });
    }
  };

  const closeDrawer = () => {
    params.delete('workspace');
    setParams(params, { replace: true });
    // ★ 드로어 안에서 열린 모달의 open 상태를 같이 내린다.
    //   안 내리면 사용자가 모달을 못 닫은 채 드로어를 닫았을 때(뒤에 깔려 버튼이 안 눌리는 등)
    //   다음에 드로어를 열 때마다 그 모달이 계속 따라 뜬다 — 실제 운영 신고.
    setPlanModal(p => (p.open ? { ...p, open: false } : p));
    setTrialModal(t => (t.open ? { ...t, open: false } : t));
    setExemptOpen(false);
    // ★ 날짜 픽커 open state 도 같이 내린다 (Fable M3).
    //   모달만 닫고 픽커 state 를 남기면, 다음에 모달을 열 때 픽커가 **저절로 펼쳐진 채** 뜬다.
    setPlanExpiresPickerOpen(false);
    setTrialDatePickerOpen(false);
  };

  // 모달을 닫는 모든 경로(취소·Esc·백드롭·저장 성공)에서 픽커도 같이 닫는다.
  const closePlanModal = () => { setPlanModal(p => ({ ...p, open: false })); setPlanExpiresPickerOpen(false); };
  const closeTrialModal = () => { setTrialModal(t => ({ ...t, open: false })); setTrialDatePickerOpen(false); };

  // DetailDrawer 내부가 Esc 스택을 처리하므로 별도 훅 불필요.
  // 모달 Esc 는 아래에서 스택에 등록 — 최상단(모달)이 먼저 닫힘.
  // CLAUDE.md 모달 3훅 — 드로어 위에 열리므로 trap 이 없으면 Shift+Tab 이 드로어로 새어나간다
  // (Fable M4 실측: 모달 안에서 Shift+Tab → 드로어의 '면제 설정' 버튼으로 포커스 탈취).
  const planDialogRef = useRef<HTMLDivElement>(null);
  const trialDialogRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(planModal.open || trialModal.open);
  useFocusTrap(planDialogRef, planModal.open);
  useFocusTrap(trialDialogRef, trialModal.open);
  useEscapeStack(planModal.open, closePlanModal);
  useEscapeStack(trialModal.open, closeTrialModal);

  const filtered = useMemo(() => rows, [rows]);

  const filterText = t('page.searchPlaceholder', '이름 · 슬러그 검색') as string;

  // ─── 플랜 변경 ───
  const openPlanModal = () => {
    if (!detail) return;
    const current = detail.plan;
    setPlanModal({
      open: true,
      toPlan: current,
      note: '',
      expires: dateToInput(detail.plan_expires_at),
      submitting: false,
      error: null,
    });
  };

  const submitPlan = async () => {
    if (!detail || planModal.submitting) return;
    if (planModal.toPlan === detail.plan && dateToInput(detail.plan_expires_at) === planModal.expires) {
      setPlanModal(p => ({ ...p, error: t('modal.changePlan.noChanges', '변경 사항이 없습니다') as string }));
      return;
    }
    setPlanModal(p => ({ ...p, submitting: true, error: null }));
    try {
      await adminChangePlan(detail.id, {
        to_plan: planModal.toPlan,
        note: planModal.note || null,
        plan_expires_at: planModal.expires ? planModal.expires : null,
      });
      setPlanModal({ open: false, toPlan: 'free', note: '', expires: '', submitting: false, error: null });
      setPlanExpiresPickerOpen(false);
      await loadList();
      await loadDetail(detail.id);
    } catch (e) {
      setPlanModal(p => ({ ...p, submitting: false, error: (e as Error).message }));
    }
  };

  // ─── 체험 연장 ───
  const openTrialModal = () => {
    if (!detail) return;
    setTrialModal({ open: true, date: dateToInput(detail.trial_ends_at), submitting: false, error: null });
  };

  const submitTrial = async (clear = false) => {
    if (!detail || trialModal.submitting) return;
    setTrialModal(t => ({ ...t, submitting: true, error: null }));
    try {
      await adminUpdateTrial(detail.id, clear ? null : (trialModal.date || null));
      setTrialModal({ open: false, date: '', submitting: false, error: null });
      setTrialDatePickerOpen(false);
      await loadList();
      await loadDetail(detail.id);
    } catch (e) {
      setTrialModal(t => ({ ...t, submitting: false, error: (e as Error).message }));
    }
  };

  return (
    <PageShell
      title={t('page.title', '워크스페이스 관리')}
      count={rows.length}
      actions={
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={filterText}
        />
      }
    >
      <PageDesc>{t('page.desc', '')}</PageDesc>

      {loading && <InfoText>Loading…</InfoText>}
      {error && <ErrorText>{error}</ErrorText>}
      {!loading && !error && rows.length === 0 && (
        <InfoText>{query ? t('page.noResults') : t('page.empty')}</InfoText>
      )}

      <List role="list">
        {filtered.map(row => (
          <Row
            key={row.id}
            role="listitem"
            $active={activeId === row.id}
            onClick={() => selectRow(row.id)}
            aria-current={activeId === row.id ? 'true' : undefined}
          >
            <RowMain>
              <RowTitle>{row.name}</RowTitle>
              <RowMeta>
                <PlanBadge $code={row.plan}>
                  {t(`list.planBadge.${row.plan}`)}
                </PlanBadge>
                {isExemptNow(row) && (
                  <ExemptBadge>{t(`exemptKind.${row.billing_exempt_kind || 'internal'}`)}</ExemptBadge>
                )}
                {row.scheduled_plan && row.scheduled_plan !== row.plan && (
                  <StateBadge $tone="info">
                    {t('list.scheduled', { plan: t(`list.planBadge.${row.scheduled_plan}`) })}
                  </StateBadge>
                )}
                {row.trial_ends_at && new Date(row.trial_ends_at) > new Date() && (
                  <StateBadge $tone="warn">{t('list.trialOn')}</StateBadge>
                )}
                {row.grace_ends_at && new Date(row.grace_ends_at) > new Date() && (
                  <StateBadge $tone="warn">{t('list.graceOn')}</StateBadge>
                )}
                {row.plan_expires_at && new Date(row.plan_expires_at) < new Date() && (
                  <StateBadge $tone="danger">{t('list.expired')}</StateBadge>
                )}
                <Dim>{t('list.member', { count: row.member_count })}</Dim>
                <Dim>{row.slug}</Dim>
              </RowMeta>
            </RowMain>
          </Row>
        ))}
      </List>

      <DetailDrawer
        open={activeId != null}
        onClose={closeDrawer}
        width={460}
        ariaLabel={t('page.title') as string}
      >
        {detailLoading && !detail && <Padded><InfoText>Loading…</InfoText></Padded>}
        {detail && (
          <>
            <DetailDrawer.Header onClose={closeDrawer}>
              <DrawerTitle>{detail.name}</DrawerTitle>
              <DrawerSub>{detail.slug}</DrawerSub>
            </DetailDrawer.Header>

            <DetailDrawer.Body>
              <Section>
                <SectionHead>
                  <SectionTitle>{t('detail.planSection')}</SectionTitle>
                  <SecondaryBtn type="button" data-testid="admin-biz-change-plan" onClick={openPlanModal}>{t('actions.changePlan')}</SecondaryBtn>
                </SectionHead>
                <KV>
                  <KLabel>{t('detail.plan')}</KLabel>
                  <KValue>
                    <PlanBadge $code={detail.plan}>{t(`list.planBadge.${detail.plan}`)}</PlanBadge>
                  </KValue>
                </KV>
                <KV>
                  <KLabel>{t('detail.subscriptionStatus')}</KLabel>
                  <KValue>{detail.subscription_status}</KValue>
                </KV>
                <KV>
                  <KLabel>{t('detail.planExpiresAt')}</KLabel>
                  <KValue>{detail.plan_expires_at ? formatDateTime(detail.plan_expires_at) : t('detail.notSet')}</KValue>
                </KV>
                <KV>
                  <KLabel>{t('detail.scheduledPlan')}</KLabel>
                  <KValue>
                    {detail.scheduled_plan
                      ? <PlanBadge $code={detail.scheduled_plan}>{t(`list.planBadge.${detail.scheduled_plan}`)}</PlanBadge>
                      : <Dim>{t('detail.notSet')}</Dim>}
                  </KValue>
                </KV>
                <KV>
                  <KLabel>{t('detail.graceEndsAt')}</KLabel>
                  <KValue>{detail.grace_ends_at ? formatDateTime(detail.grace_ends_at) : t('detail.notSet')}</KValue>
                </KV>
              </Section>

              <Section>
                <SectionHead>
                  <SectionTitle>{t('detail.trialSection')}</SectionTitle>
                  <SecondaryBtn type="button" data-testid="admin-biz-extend-trial" onClick={openTrialModal}>{t('actions.extendTrial')}</SecondaryBtn>
                </SectionHead>
                <KV>
                  <KLabel>{t('detail.trialEndsAt')}</KLabel>
                  <KValue>{detail.trial_ends_at ? formatDateTime(detail.trial_ends_at) : <Dim>{t('detail.notSet')}</Dim>}</KValue>
                </KV>
              </Section>

              {/* 결제 면제 (운영 #275) — 내부 워크스페이스·테스터 고객은 구독료를 청구하지 않는다. */}
              <Section>
                <SectionHead>
                  <SectionTitle>{t('detail.exemptSection', '결제 면제')}</SectionTitle>
                  <SecondaryBtn type="button" data-testid="admin-biz-set-exempt" onClick={() => setExemptOpen(true)}>{t('actions.setExempt', '면제 설정')}</SecondaryBtn>
                </SectionHead>
                <KV>
                  <KLabel>{t('detail.exemptStatus', '상태')}</KLabel>
                  <KValue>
                    {isExemptNow(detail)
                      ? <ExemptBadge>{t(`exemptKind.${detail.billing_exempt_kind || 'internal'}`)}</ExemptBadge>
                      : <Dim>{t('detail.exemptOff', '면제 아님 (정상 과금)')}</Dim>}
                  </KValue>
                </KV>
                {detail.billing_exempt && (
                  <>
                    <KV>
                      <KLabel>{t('detail.exemptPlan', '면제 플랜')}</KLabel>
                      <KValue>
                        {detail.billing_exempt_plan
                          ? <PlanBadge $code={detail.billing_exempt_plan}>{t(`list.planBadge.${detail.billing_exempt_plan}`)}</PlanBadge>
                          : <Dim>{t('detail.exemptPlanKeep', '현재 플랜 유지')}</Dim>}
                      </KValue>
                    </KV>
                    <KV>
                      <KLabel>{t('detail.exemptUntil', '면제 종료일')}</KLabel>
                      <KValue>
                        {detail.billing_exempt_until
                          ? <>{formatDateTime(detail.billing_exempt_until)}{!isExemptNow(detail) && <Dim> · {t('detail.exemptExpired')}</Dim>}</>
                          : <Dim>{t('detail.exemptForever')}</Dim>}
                      </KValue>
                    </KV>
                    {detail.billing_exempt_note && (
                      <KV>
                        <KLabel>{t('detail.exemptNote', '사유')}</KLabel>
                        <KValue>{detail.billing_exempt_note}</KValue>
                      </KV>
                    )}
                  </>
                )}
              </Section>

              <Section>
                <SectionHead>
                  <SectionTitle>{t('detail.usageSection')}</SectionTitle>
                </SectionHead>
                <UsageGrid>
                  <UsageItem
                    label={t('detail.members') as string}
                    used={detail.usage.members}
                    max={detail.effective_plan.limits.members_max}
                  />
                  <UsageItem
                    label={t('detail.clients') as string}
                    used={detail.usage.clients}
                    max={detail.effective_plan.limits.clients_max}
                  />
                  <UsageItem
                    label={t('detail.projects') as string}
                    used={detail.usage.projects}
                    max={detail.effective_plan.limits.projects_max}
                  />
                  <UsageItem
                    label={t('detail.conversations') as string}
                    used={detail.usage.conversations}
                    max={detail.effective_plan.limits.conversations_max}
                  />
                  <UsageItem
                    label={t('detail.storage') as string}
                    used={detail.usage.storage_bytes}
                    max={detail.effective_plan.limits.storage_bytes}
                    format="bytes"
                  />
                  <UsageItem
                    label={t('detail.cueThisMonth') as string}
                    used={detail.usage.cue_actions_this_month}
                    max={detail.effective_plan.limits.cue_actions_monthly}
                  />
                  <UsageItem
                    label={t('detail.qnoteThisMonth') as string}
                    used={detail.usage.qnote_minutes_this_month}
                    max={detail.effective_plan.limits.qnote_minutes_monthly}
                    unit="min"
                  />
                </UsageGrid>
              </Section>

              <Section>
                <SectionTitle>{t('detail.historySection')}</SectionTitle>
                {history.length === 0 ? (
                  <Dim style={{ padding: '8px 2px' }}>{t('history.empty')}</Dim>
                ) : (
                  <History>
                    {history.map(h => (
                      <HistRow key={h.id}>
                        <HistBullet />
                        <HistBody>
                          <HistPlans>
                            {t('history.planChange', {
                              from: t(`list.planBadge.${h.from_plan}`),
                              to: t(`list.planBadge.${h.to_plan}`),
                            })}
                            <ReasonTag>{t(`history.reason.${h.reason}`, h.reason)}</ReasonTag>
                          </HistPlans>
                          <HistMeta>
                            {formatDateTime(h.created_at)}
                            {' · '}
                            {h.changed_by ? t('history.by', { name: h.changed_by.name }) : t('history.system')}
                          </HistMeta>
                          {h.note && <HistNote>{h.note}</HistNote>}
                        </HistBody>
                      </HistRow>
                    ))}
                  </History>
                )}
              </Section>
            </DetailDrawer.Body>
          </>
        )}
      </DetailDrawer>

      {/* 플랜 변경 모달 */}
      {planModal.open && detail && (
        <ModalOverlay onMouseDown={e => { if (e.target === e.currentTarget) closePlanModal(); }}>
          <Dialog ref={planDialogRef} role="dialog" aria-modal="true" aria-label={t('modal.changePlan.title') as string}>
            <DTitle>{t('modal.changePlan.title')}</DTitle>
            <DBody>
              <DDesc>{t('modal.changePlan.desc')}</DDesc>

              <Field>
                <FLabel>{t('modal.changePlan.from')}</FLabel>
                <FValue>
                  <PlanBadge $code={detail.plan}>{t(`list.planBadge.${detail.plan}`)}</PlanBadge>
                </FValue>
              </Field>

              <Field>
                <FLabel>{t('modal.changePlan.to')}</FLabel>
                <PlanOptions role="radiogroup">
                  {(catalog.length ? catalog.map(p => p.code) : PLAN_ORDER).map(code => (
                    <PlanOption
                      key={code}
                      type="button"
                      role="radio"
                      aria-checked={planModal.toPlan === code}
                      $active={planModal.toPlan === code}
                      onClick={() => setPlanModal(p => ({ ...p, toPlan: code, error: null }))}
                    >
                      <PlanBadge $code={code}>{t(`list.planBadge.${code}`)}</PlanBadge>
                    </PlanOption>
                  ))}
                </PlanOptions>
              </Field>

              <Field>
                <FLabel>{t('modal.changePlan.expiresLabel')}</FLabel>
                <DateTrigger ref={planExpiresAnchorRef} type="button" onClick={() => setPlanExpiresPickerOpen(v => !v)}>
                  {planModal.expires || <DatePH>{t('modal.datePlaceholder', '날짜 선택') as string}</DatePH>}
                </DateTrigger>
                {planExpiresPickerOpen && (
                  <CalendarPicker
                    isOpen anchorRef={planExpiresAnchorRef}
                    singleMode
                    startDate={planModal.expires}
                    endDate={planModal.expires}
                    onRangeSelect={(s) => setPlanModal(p => ({ ...p, expires: s || '', error: null }))}
                    onClose={() => setPlanExpiresPickerOpen(false)}
                  />
                )}
                <FHelp>{t('modal.changePlan.expiresHelp')}</FHelp>
              </Field>

              <Field>
                <FLabel>{t('modal.changePlan.noteLabel')}</FLabel>
                <TextArea
                  value={planModal.note}
                  onChange={e => setPlanModal(p => ({ ...p, note: e.target.value }))}
                  placeholder={t('modal.changePlan.notePlaceholder') as string}
                  rows={3}
                />
              </Field>

              {planModal.error && <DError>{planModal.error}</DError>}
            </DBody>
            <DFooter>
              <SecondaryBtn type="button" disabled={planModal.submitting} onClick={closePlanModal}>
                {t('actions.cancel')}
              </SecondaryBtn>
              <PrimaryBtn type="button" disabled={planModal.submitting} onClick={submitPlan}>
                {planModal.submitting ? t('actions.saving') : t('modal.changePlan.confirm')}
              </PrimaryBtn>
            </DFooter>
          </Dialog>
        </ModalOverlay>
      )}

      {/* 체험 모달 */}
      {trialModal.open && detail && (
        <ModalOverlay onMouseDown={e => { if (e.target === e.currentTarget) closeTrialModal(); }}>
          <Dialog ref={trialDialogRef} role="dialog" aria-modal="true" aria-label={t('modal.trial.title') as string}>
            <DTitle>{t('modal.trial.title')}</DTitle>
            <DBody>
              <DDesc>{t('modal.trial.desc')}</DDesc>
              <Field>
                <FLabel>{t('modal.trial.current')}</FLabel>
                <FValue>{detail.trial_ends_at ? formatDateTime(detail.trial_ends_at) : t('detail.notSet')}</FValue>
              </Field>
              <Field>
                <FLabel>{t('modal.trial.newDate')}</FLabel>
                <DateTrigger ref={trialDateAnchorRef} type="button" onClick={() => setTrialDatePickerOpen(v => !v)}>
                  {trialModal.date || <DatePH>{t('modal.datePlaceholder', '날짜 선택') as string}</DatePH>}
                </DateTrigger>
                {trialDatePickerOpen && (
                  <CalendarPicker
                    isOpen anchorRef={trialDateAnchorRef}
                    singleMode
                    startDate={trialModal.date}
                    endDate={trialModal.date}
                    onRangeSelect={(s) => setTrialModal(tt => ({ ...tt, date: s || '', error: null }))}
                    onClose={() => setTrialDatePickerOpen(false)}
                  />
                )}
              </Field>

              {trialModal.error && <DError>{trialModal.error}</DError>}
            </DBody>
            <DFooter>
              <DangerBtn type="button" disabled={trialModal.submitting} onClick={() => submitTrial(true)}>
                {t('modal.trial.clearDate')}
              </DangerBtn>
              <FSpacer />
              <SecondaryBtn type="button" disabled={trialModal.submitting} onClick={closeTrialModal}>
                {t('actions.cancel')}
              </SecondaryBtn>
              <PrimaryBtn type="button" disabled={trialModal.submitting || !trialModal.date} onClick={() => submitTrial(false)}>
                {trialModal.submitting ? t('actions.saving') : t('modal.trial.confirm')}
              </PrimaryBtn>
            </DFooter>
          </Dialog>
        </ModalOverlay>
      )}

      {/* 결제 면제 모달 — 별도 컴포넌트로 절출 (god-file 래칫) */}
      {exemptOpen && detail && (
        <BillingExemptModal
          detail={detail}
          planCodes={catalog.length ? catalog.map(pl => pl.code) : PLAN_ORDER}
          renderPlanBadge={(code) => <PlanBadge $code={code}>{t(`list.planBadge.${code}`)}</PlanBadge>}
          onClose={() => setExemptOpen(false)}
          onSaved={async () => { await loadList(); if (detail) await loadDetail(detail.id); }}
        />
      )}
    </PageShell>
  );
}

// ─── 사용량 서브컴포넌트 ───
interface UsageItemProps {
  label: string;
  used: number;
  max: number | null;
  format?: 'count' | 'bytes';
  unit?: 'min' | undefined;
}

function UsageItem({ label, used, max, format = 'count', unit }: UsageItemProps) {
  const { t } = useTranslation('admin');
  const isInf = max == null;
  const pct = !isInf && max! > 0 ? Math.min(100, (used / max!) * 100) : 0;
  const fmt = (v: number) => format === 'bytes' ? fmtBytes(v) : (unit === 'min' ? `${v} min` : String(v));
  const warn = pct >= 95;
  const caution = pct >= 80;
  return (
    <UsageCard>
      <UsageLabel>{label}</UsageLabel>
      <UsageRow>
        <UsageVal>{fmt(used)}</UsageVal>
        <UsageMax>
          {isInf ? t('detail.infinite') : ` / ${fmt(max!)}`}
        </UsageMax>
      </UsageRow>
      {!isInf && (
        <UsageBar>
          <UsageFill style={{ width: `${pct.toFixed(1)}%` }} $warn={warn} $caution={caution} />
        </UsageBar>
      )}
    </UsageCard>
  );
}

// ─── styled ───
const PageDesc = styled.p`
  font-size: 13px; color: #64748B; line-height: 1.5; margin: 0 0 16px;
`;
const InfoText = styled.div`font-size: 13px; color: #64748B; padding: 24px 4px;`;
const ErrorText = styled.div`font-size: 13px; color: #DC2626; padding: 12px 4px;`;
const Padded = styled.div`padding: 24px;`;
const Dim = styled.span`color: #94A3B8; font-size: 12px;`;

const List = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const Row = styled.button<{ $active: boolean }>`
  all: unset; box-sizing: border-box; cursor: pointer;
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px;
  border: 1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  background: ${p => p.$active ? '#F0FDFA' : '#fff'};
  border-radius: 10px;
  &:hover { border-color: ${p => p.$active ? '#14B8A6' : '#CBD5E1'}; background: ${p => p.$active ? '#F0FDFA' : '#F8FAFC'}; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
const RowMain = styled.div`flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px;`;
const RowTitle = styled.div`font-size: 14px; font-weight: 600; color: #0F172A;`;
const RowMeta = styled.div`display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;

const PlanBadge = styled.span<{ $code: PlanCode }>`
  display: inline-flex; align-items: center; padding: 2px 10px;
  background: ${p => PLAN_COLOR[p.$code].bg};
  color: ${p => PLAN_COLOR[p.$code].fg};
  border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.2px;
`;
const StateBadge = styled.span<{ $tone: 'info' | 'warn' | 'danger' }>`
  display: inline-flex; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600;
  ${p => p.$tone === 'warn' && `background:#FEF3C7; color:#92400E;`}
  ${p => p.$tone === 'info' && `background:#DBEAFE; color:#1D4ED8;`}
  ${p => p.$tone === 'danger' && `background:#FEE2E2; color:#B91C1C;`}
`;

// Drawer
const DrawerTitle = styled.div`font-size: 16px; font-weight: 700; color: #0F172A;`;
const DrawerSub = styled.div`font-size: 12px; color: #94A3B8; margin-top: 2px;`;

const Section = styled.section`
  padding: 16px 20px; border-bottom: 1px solid #E2E8F0;
  &:last-child { border-bottom: none; }
`;
const SectionHead = styled.div`
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;
`;
const SectionTitle = styled.h3`
  margin: 0; font-size: 13px; font-weight: 700; color: #0F172A; letter-spacing: -0.1px;
`;
const KV = styled.div`
  display: flex; align-items: center; padding: 6px 0; gap: 8px;
`;
const KLabel = styled.div`width: 110px; font-size: 12px; color: #64748B; flex-shrink: 0;`;
const KValue = styled.div`flex: 1; font-size: 13px; color: #0F172A; display: flex; align-items: center; gap: 6px;`;

// Usage
const UsageGrid = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  @media (max-width: 640px) { grid-template-columns: 1fr; }
`;
const UsageCard = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px; background: #F8FAFC; border-radius: 8px;
`;
const UsageLabel = styled.div`font-size: 11px; color: #64748B; font-weight: 600;`;
const UsageRow = styled.div`display: flex; align-items: baseline; gap: 4px;`;
const UsageVal = styled.div`font-size: 14px; font-weight: 700; color: #0F172A;`;
const UsageMax = styled.div`font-size: 11px; color: #94A3B8;`;
const UsageBar = styled.div`height: 4px; background: #E2E8F0; border-radius: 2px; overflow: hidden;`;
const UsageFill = styled.div<{ $warn: boolean; $caution: boolean }>`
  height: 100%;
  background: ${p => p.$warn ? '#DC2626' : p.$caution ? '#F59E0B' : '#14B8A6'};
  transition: width .3s;
`;

// History
const History = styled.div`display: flex; flex-direction: column; gap: 12px; padding-top: 4px;`;
const HistRow = styled.div`display: flex; gap: 10px; align-items: flex-start;`;
const HistBullet = styled.div`
  width: 8px; height: 8px; border-radius: 999px; background: #14B8A6; margin-top: 6px; flex-shrink: 0;
`;
const HistBody = styled.div`flex: 1; min-width: 0;`;
const HistPlans = styled.div`font-size: 13px; color: #0F172A; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const ReasonTag = styled.span`
  display: inline-flex; padding: 1px 8px; border-radius: 999px;
  background: #F1F5F9; color: #475569; font-size: 10px; font-weight: 600;
`;
const HistMeta = styled.div`font-size: 11px; color: #94A3B8; margin-top: 2px;`;
const HistNote = styled.div`font-size: 12px; color: #475569; margin-top: 4px; padding: 6px 10px; background: #F8FAFC; border-radius: 6px;`;

// Modal
const DangerBtn = styled.button`
  height: 34px; padding: 0 14px; background: #fff; color: #DC2626;
  border: 1px solid #FCA5A5; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled){ background: #FEF2F2; border-color: #DC2626; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
