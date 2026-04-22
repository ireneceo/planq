// /admin/businesses — 플랫폼 관리자 전용 워크스페이스 관리
// 마스터-디테일 드로어 패턴 (ClientsPage 와 동일)
// URL 싱크: ?workspace=:id
// 재클릭 토글 / body scroll lock / focus trap / Esc 스택
import { useEffect, useState, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import PageShell from '../../components/Layout/PageShell';
import SearchBox from '../../components/Common/SearchBox';
import DetailDrawer from '../../components/Common/DetailDrawer';
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

const PLAN_ORDER: PlanCode[] = ['free', 'starter', 'basic', 'pro', 'enterprise'];
const PLAN_COLOR: Record<PlanCode, { bg: string; fg: string }> = {
  free:       { bg: '#F1F5F9', fg: '#475569' },
  starter:    { bg: '#FEF3C7', fg: '#92400E' },
  basic:      { bg: '#DBEAFE', fg: '#1D4ED8' },
  pro:        { bg: '#F0FDFA', fg: '#0F766E' },
  enterprise: { bg: '#F3E8FF', fg: '#7C3AED' },
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
  const [planModal, setPlanModal] = useState<{ open: boolean; toPlan: PlanCode; note: string; expires: string; submitting: boolean; error: string | null }>(
    { open: false, toPlan: 'free', note: '', expires: '', submitting: false, error: null }
  );
  const [trialModal, setTrialModal] = useState<{ open: boolean; date: string; submitting: boolean; error: string | null }>(
    { open: false, date: '', submitting: false, error: null }
  );

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
  };

  // DetailDrawer 내부가 Esc 스택을 처리하므로 별도 훅 불필요.
  // 모달 Esc 는 아래에서 스택에 등록 — 최상단(모달)이 먼저 닫힘.
  useEscapeStack(planModal.open, () => setPlanModal(p => ({ ...p, open: false })));
  useEscapeStack(trialModal.open, () => setTrialModal(t => ({ ...t, open: false })));

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
      setPlanModal(p => ({ ...p, error: '변경 사항이 없습니다' }));
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
                  <SecondaryBtn type="button" onClick={openPlanModal}>{t('actions.changePlan')}</SecondaryBtn>
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
                  <SecondaryBtn type="button" onClick={openTrialModal}>{t('actions.extendTrial')}</SecondaryBtn>
                </SectionHead>
                <KV>
                  <KLabel>{t('detail.trialEndsAt')}</KLabel>
                  <KValue>{detail.trial_ends_at ? formatDateTime(detail.trial_ends_at) : <Dim>{t('detail.notSet')}</Dim>}</KValue>
                </KV>
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
        <ModalOverlay onMouseDown={e => { if (e.target === e.currentTarget) setPlanModal(p => ({ ...p, open: false })); }}>
          <Dialog>
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
                <DateInput
                  type="date"
                  value={planModal.expires}
                  onChange={e => setPlanModal(p => ({ ...p, expires: e.target.value, error: null }))}
                />
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
              <SecondaryBtn type="button" disabled={planModal.submitting} onClick={() => setPlanModal(p => ({ ...p, open: false }))}>
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
        <ModalOverlay onMouseDown={e => { if (e.target === e.currentTarget) setTrialModal(p => ({ ...p, open: false })); }}>
          <Dialog>
            <DTitle>{t('modal.trial.title')}</DTitle>
            <DBody>
              <DDesc>{t('modal.trial.desc')}</DDesc>
              <Field>
                <FLabel>{t('modal.trial.current')}</FLabel>
                <FValue>{detail.trial_ends_at ? formatDateTime(detail.trial_ends_at) : t('detail.notSet')}</FValue>
              </Field>
              <Field>
                <FLabel>{t('modal.trial.newDate')}</FLabel>
                <DateInput
                  type="date"
                  value={trialModal.date}
                  onChange={e => setTrialModal(tt => ({ ...tt, date: e.target.value, error: null }))}
                />
              </Field>

              {trialModal.error && <DError>{trialModal.error}</DError>}
            </DBody>
            <DFooter>
              <DangerBtn type="button" disabled={trialModal.submitting} onClick={() => submitTrial(true)}>
                {t('modal.trial.clearDate')}
              </DangerBtn>
              <FSpacer />
              <SecondaryBtn type="button" disabled={trialModal.submitting} onClick={() => setTrialModal(tt => ({ ...tt, open: false }))}>
                {t('actions.cancel')}
              </SecondaryBtn>
              <PrimaryBtn type="button" disabled={trialModal.submitting || !trialModal.date} onClick={() => submitTrial(false)}>
                {trialModal.submitting ? t('actions.saving') : t('modal.trial.confirm')}
              </PrimaryBtn>
            </DFooter>
          </Dialog>
        </ModalOverlay>
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
  padding: 16px 20px; border-bottom: 1px solid #EEF2F6;
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
const ModalOverlay = styled.div`
  position: fixed; inset: 0; z-index: 90;
  background: rgba(15,23,42,0.28);
  display: flex; align-items: center; justify-content: center; padding: 20px;
`;
const Dialog = styled.div`
  background: #fff; border-radius: 14px; width: 100%; max-width: 460px;
  box-shadow: 0 20px 50px rgba(15,23,42,0.2);
  display: flex; flex-direction: column; overflow: hidden;
  max-height: calc(100vh - 40px);
`;
const DTitle = styled.div`padding: 18px 20px 8px; font-size: 15px; font-weight: 700; color: #0F172A;`;
const DBody = styled.div`padding: 0 20px 16px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto;`;
const DDesc = styled.p`font-size: 13px; color: #475569; line-height: 1.5; margin: 0;`;
const DFooter = styled.div`
  padding: 12px 20px; border-top: 1px solid #EEF2F6;
  display: flex; gap: 8px; justify-content: flex-end; align-items: center;
`;
const DError = styled.div`font-size: 12px; color: #DC2626; background: #FEF2F2; padding: 8px 10px; border-radius: 6px;`;
const FSpacer = styled.div`flex: 1;`;

const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FLabel = styled.label`font-size: 12px; font-weight: 600; color: #475569;`;
const FValue = styled.div`font-size: 13px; color: #0F172A;`;
const FHelp = styled.div`font-size: 11px; color: #94A3B8; line-height: 1.4;`;

const PlanOptions = styled.div`display: flex; gap: 6px; flex-wrap: wrap;`;
const PlanOption = styled.button<{ $active: boolean }>`
  all: unset; cursor: pointer; padding: 6px 4px; border-radius: 8px;
  border: 1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  background: ${p => p.$active ? '#F0FDFA' : '#fff'};
  transition: all 0.15s;
  &:hover { border-color: #CBD5E1; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;

const DateInput = styled.input`
  height: 34px; padding: 0 10px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; color: #0F172A; font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const TextArea = styled.textarea`
  padding: 8px 10px; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; color: #0F172A; font-family: inherit; resize: vertical; min-height: 60px;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;

const PrimaryBtn = styled.button`
  height: 34px; padding: 0 16px; background: #14B8A6; color: #fff; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.15s;
  &:hover:not(:disabled){ background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #0D9488; outline-offset: 2px; }
`;
const SecondaryBtn = styled.button`
  height: 30px; padding: 0 12px; background: #fff; color: #0F172A;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 12px; font-weight: 600;
  cursor: pointer;
  &:hover:not(:disabled){ background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const DangerBtn = styled.button`
  height: 34px; padding: 0 14px; background: #fff; color: #DC2626;
  border: 1px solid #FCA5A5; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled){ background: #FEF2F2; border-color: #DC2626; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
