// 구독 플랜 페이지 — 현재 플랜 카드 + 사용량 바 + 비교표 + Enterprise 문의 + 이력
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import {
  fetchCatalog, fetchStatus, changePlan, cancelScheduledChange, startTrial,
  formatPrice, formatLimit, formatBytes, formatMinutes, usageColor, receiptPdfUrl,
  type PlanDef, type PlanStatus, type PlanCode, type BillingCycle, type Currency,
} from '../../services/plan';
import { submitInquiry } from '../../services/inquiries';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import CheckoutModal from './CheckoutModal';

interface Props { businessId: number; }

const PlanSettings: React.FC<Props> = ({ businessId }) => {
  const { t } = useTranslation('plan');
  const { formatDate } = useTimeFormat();
  const { user } = useAuth();

  const [catalog, setCatalog] = useState<PlanDef[]>([]);
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState<Currency>('KRW');
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [actionPlan, setActionPlan] = useState<PlanCode | null>(null);  // 업그레이드/다운그레이드 모달 대상
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cancelScheduleOpen, setCancelScheduleOpen] = useState(false);
  // P-2: bank info (Business 의 워크스페이스 입금 계좌)
  const [bankInfo, setBankInfo] = useState<{ name?: string; account?: string; holder?: string } | null>(null);
  useEffect(() => {
    apiFetch(`/api/businesses/${businessId}`)
      .then(r => r.json())
      .then(j => {
        if (j.success && j.data) {
          setBankInfo({
            name: j.data.bank_name || undefined,
            account: j.data.bank_account_number || undefined,
            holder: j.data.bank_account_name || j.data.brand_name || j.data.name || undefined,
          });
        }
      })
      .catch(() => { /* noop */ });
  }, [businessId]);

  // ─── Enterprise 문의 ───
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [inquirySubmitting, setInquirySubmitting] = useState(false);
  const [inquirySuccess, setInquirySuccess] = useState<{ email: string } | null>(null);
  const [inquiryErr, setInquiryErr] = useState(false);
  const [inqName, setInqName] = useState('');
  const [inqEmail, setInqEmail] = useState('');
  const [inqCompany, setInqCompany] = useState('');
  const [inqPhone, setInqPhone] = useState('');
  const [inqMessage, setInqMessage] = useState('');

  const openInquiry = useCallback(() => {
    // 로그인 사용자 정보 prefill
    setInqName(user?.name || '');
    setInqEmail(user?.email || '');
    setInqCompany(user?.business_name || '');
    setInqPhone('');
    setInqMessage('');
    setInquiryErr(false);
    setInquirySuccess(null);
    setInquiryOpen(true);
  }, [user]);

  const submitInquiryForm = useCallback(async () => {
    if (!inqName.trim() || !inqEmail.trim() || !inqMessage.trim()) return;
    setInquirySubmitting(true);
    setInquiryErr(false);
    const r = await submitInquiry({
      kind: 'enterprise',
      source: 'plan_page',
      from_name: inqName,
      from_email: inqEmail,
      from_company: inqCompany || undefined,
      from_phone: inqPhone || undefined,
      message: inqMessage,
    });
    setInquirySubmitting(false);
    if (r) setInquirySuccess({ email: inqEmail });
    else setInquiryErr(true);
  }, [inqName, inqEmail, inqCompany, inqPhone, inqMessage]);

  // 표에 표시할 플랜 — Enterprise 는 별도 섹션으로 이동 (Irene 요청)
  const comparisonPlans = useMemo(() => catalog.filter(p => p.code !== 'enterprise'), [catalog]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([fetchCatalog(), fetchStatus(businessId)]);
      setCatalog(c); setStatus(s);
    } finally { setLoading(false); }
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

  const currentPlan = status?.plan;
  const usage = status?.usage;

  // 업그레이드 여부 판별용 순서
  const planOrder: PlanCode[] = ['free', 'starter', 'basic', 'pro', 'enterprise'];
  const isUpgrade = (target: PlanCode) => {
    if (!currentPlan) return false;
    return planOrder.indexOf(target) > planOrder.indexOf(currentPlan.code);
  };

  const handleAction = async (target: PlanCode) => {
    if (target === 'enterprise') {
      // Enterprise 는 표에서 제외되었으므로 이 분기는 실행되지 않지만,
      // 혹시 남은 호출이 있어도 문의 모달로 안전하게 유도.
      openInquiry();
      return;
    }
    if (isUpgrade(target)) {
      setActionPlan(target);
      setPaymentOpen(true);
    } else {
      // 다운그레이드 확인 모달
      setActionPlan(target);
    }
  };

  // P-2 자체 결제 흐름 — CheckoutModal 의 onPaid 가 직접 status 갱신
  const handleCheckoutPaid = useCallback(async () => {
    setPaymentOpen(false);
    setActionPlan(null);
    await load();
  }, [load]);

  const handleDowngradeConfirm = async () => {
    if (!actionPlan) return;
    const r = await changePlan(businessId, actionPlan, cycle);
    if (r) { setActionPlan(null); await load(); }
  };

  const handleCancelSchedule = async () => {
    await cancelScheduledChange(businessId);
    setCancelScheduleOpen(false);
    await load();
  };

  const handleStartTrial = async (target: Exclude<PlanCode, 'free' | 'enterprise'>) => {
    const ok = await startTrial(businessId, target);
    if (ok) await load();
  };

  if (loading || !status || !currentPlan || !usage) return <Skeleton />;

  return (
    <Wrap>
      {/* 현재 플랜 카드 */}
      <CurrentCard $plan={currentPlan.code}>
        <CardHead>
          <PlanBadge $code={currentPlan.code}>{currentPlan.name_ko}</PlanBadge>
          <PlanTitle>{currentPlan.name}</PlanTitle>
          <StatusBadges>
            {status.in_trial && <StateBadge $kind="trial">{t('current.trial')}</StateBadge>}
            {status.in_grace && <StateBadge $kind="grace">{t('current.grace')}</StateBadge>}
            {!status.in_trial && !status.in_grace && status.active && <StateBadge $kind="active">{t('current.active')}</StateBadge>}
          </StatusBadges>
        </CardHead>
        <PriceRow>
          {currentPlan.code === 'enterprise' ? (
            <Price>{t('comparison.contact')}</Price>
          ) : currentPlan.price_monthly.KRW === 0 ? (
            <Price>{t('comparison.free')}</Price>
          ) : (
            <>
              <Price>{formatPrice(currentPlan.price_monthly[currency], currency)}</Price>
              <PriceUnit>/ {t('comparison.month')}</PriceUnit>
            </>
          )}
        </PriceRow>
        <MetaRow>
          {status.in_trial && status.trial_ends_at && (
            <Meta>{t('current.trialEnds', { days: Math.ceil((new Date(status.trial_ends_at).getTime() - Date.now()) / 86400000) })}</Meta>
          )}
          {status.plan_expires_at && !status.in_trial && (
            <Meta>{t('current.expires', { date: formatDate(status.plan_expires_at) })}</Meta>
          )}
          {status.scheduled_plan && (
            <Meta style={{ color: '#C2410C' }}>
              {t('current.scheduledDown', {
                plan: catalog.find(p => p.code === status.scheduled_plan)?.name_ko || status.scheduled_plan,
                date: status.plan_expires_at ? formatDate(status.plan_expires_at) : '-'
              })}
              <LinkBtn type="button" onClick={() => setCancelScheduleOpen(true)}>{t('current.cancelSchedule')}</LinkBtn>
            </Meta>
          )}
        </MetaRow>
      </CurrentCard>

      {/* 사용량 바 */}
      <Section>
        <SectionTitle>{t('usage.title')}</SectionTitle>
        <UsageGrid>
          <UsageRow
            label={t('usage.members')}
            current={usage.members}
            limit={currentPlan.limits.members_max}
            t={t}
          />
          <UsageRow
            label={t('usage.clients')}
            current={usage.clients}
            limit={currentPlan.limits.clients_max}
            t={t}
          />
          <UsageRow
            label={t('usage.projects')}
            current={usage.projects}
            limit={currentPlan.limits.projects_max}
            t={t}
          />
          <UsageRow
            label={t('usage.conversations')}
            current={usage.conversations}
            limit={currentPlan.limits.conversations_max}
            t={t}
          />
          <UsageRow
            label={t('usage.storage')}
            current={usage.storage_bytes}
            limit={currentPlan.limits.storage_bytes}
            formatter={formatBytes}
            t={t}
          />
          <UsageRow
            label={t('usage.cue')}
            current={usage.cue_actions_this_month}
            limit={currentPlan.limits.cue_actions_monthly}
            unit={t('usage.cueUnit')}
            t={t}
          />
          <UsageRow
            label={t('usage.qnote')}
            current={usage.qnote_minutes_this_month}
            limit={currentPlan.limits.qnote_minutes_monthly}
            formatter={formatMinutes}
            t={t}
          />
        </UsageGrid>
      </Section>

      {/* 비교표 */}
      <Section>
        <SectionHeadRow>
          <SectionTitle>{t('comparison.title')}</SectionTitle>
          <Controls>
            <Seg role="group" aria-label="currency">
              <SegBtn $active={currency === 'KRW'} type="button" onClick={() => setCurrency('KRW')}>KRW</SegBtn>
              <SegBtn $active={currency === 'USD'} type="button" onClick={() => setCurrency('USD')}>USD</SegBtn>
            </Seg>
            <Seg role="group" aria-label="cycle">
              <SegBtn $active={cycle === 'monthly'} type="button" onClick={() => setCycle('monthly')}>{t('comparison.monthly')}</SegBtn>
              <SegBtn $active={cycle === 'yearly'} type="button" onClick={() => setCycle('yearly')}>
                {t('comparison.yearly')} <SmallBadge>{t('comparison.yearlyDiscount')}</SmallBadge>
              </SegBtn>
            </Seg>
          </Controls>
        </SectionHeadRow>

        <PlanGrid>
          {comparisonPlans.map(p => {
            const isCurrent = p.code === currentPlan.code;
            const price = cycle === 'yearly' ? p.price_yearly[currency] : p.price_monthly[currency];
            const isScheduled = status.scheduled_plan === p.code;
            return (
              <PlanCol key={p.code} $current={isCurrent}>
                {isCurrent && <TopRibbon>{t('comparison.current')}</TopRibbon>}
                {isScheduled && <TopRibbon $warn>{t('comparison.scheduled')}</TopRibbon>}
                <PlanColHead>
                  <PlanName>{p.name_ko}</PlanName>
                  <PlanEn>{p.name}</PlanEn>
                  <ColPriceRow>
                    {p.code === 'enterprise' ? (
                      <ColPrice>{t('comparison.contact')}</ColPrice>
                    ) : price === 0 ? (
                      <ColPrice>{t('comparison.free')}</ColPrice>
                    ) : (
                      <>
                        <ColPrice>{formatPrice(price, currency)}</ColPrice>
                        <ColPriceUnit>/ {cycle === 'yearly' ? t('comparison.year') : t('comparison.month')}</ColPriceUnit>
                      </>
                    )}
                  </ColPriceRow>
                  {price !== 0 && p.code !== 'enterprise' && <VatText>{t('comparison.vat')}</VatText>}
                  <PlanTarget>{p.target_ko}</PlanTarget>
                </PlanColHead>

                <FeatureList>
                  <FeatItem><FK>{t('features.members')}</FK><FV>{formatLimit(p.limits.members_max)}</FV></FeatItem>
                  <FeatItem><FK>{t('features.clients')}</FK><FV>{formatLimit(p.limits.clients_max)}</FV></FeatItem>
                  <FeatItem><FK>{t('features.projects')}</FK><FV>{formatLimit(p.limits.projects_max)}</FV></FeatItem>
                  <FeatItem><FK>{t('features.conversations')}</FK><FV>{formatLimit(p.limits.conversations_max)}</FV></FeatItem>
                  <FeatItem $hl><FK>{t('features.storage')}</FK><FV>{formatBytes(p.limits.storage_bytes)}</FV></FeatItem>
                  <FeatItem><FK>{t('features.fileSize')}</FK><FV>{formatBytes(p.limits.file_size_max_bytes)}</FV></FeatItem>
                  <FeatItem $hl><FK>{t('features.cue')}</FK><FV>{formatLimit(p.limits.cue_actions_monthly)}</FV></FeatItem>
                  <FeatItem $hl><FK>{t('features.qnote')}</FK><FV>{formatMinutes(p.limits.qnote_minutes_monthly)}</FV></FeatItem>
                  <FeatItem><FK>{t('features.externalCloud')}</FK><FV>{p.features.external_cloud ? '✓' : '—'}</FV></FeatItem>
                  <FeatItem><FK>{t('features.dataExport')}</FK><FV>{p.features.data_export ? '✓' : '—'}</FV></FeatItem>
                  <FeatItem><FK>{t('features.apiAccess')}</FK><FV>{p.features.api_access ? '✓' : '—'}</FV></FeatItem>
                  <FeatItem><FK>{t('features.sso')}</FK><FV>{p.features.sso ? '✓' : '—'}</FV></FeatItem>
                  <FeatItem><FK>{t('features.retention')}</FK><FV>{p.limits.trash_retention_days} {t('features.days')}</FV></FeatItem>
                  <FeatItem><FK>{t('features.support')}</FK><FV>{t(`support.${p.support}`)}</FV></FeatItem>
                  <FeatItem><FK>{t('features.sla')}</FK><FV>{p.sla ? `${p.sla}%` : '—'}</FV></FeatItem>
                </FeatureList>

                <ColCta>
                  {isCurrent ? (
                    <BtnGhost type="button" disabled>{t('comparison.current')}</BtnGhost>
                  ) : p.code === 'enterprise' ? (
                    <BtnGhost type="button" onClick={() => handleAction(p.code)}>{t('comparison.contactSales')}</BtnGhost>
                  ) : isUpgrade(p.code) ? (
                    <>
                      <BtnPrimary type="button" onClick={() => handleAction(p.code)}>
                        {t('comparison.upgrade')}
                      </BtnPrimary>
                      {currentPlan.code === 'free' && !status.trial_ends_at && (
                        <BtnLink type="button" onClick={() => handleStartTrial(p.code as 'starter' | 'basic' | 'pro')}>
                          {t('comparison.startTrial')}
                        </BtnLink>
                      )}
                    </>
                  ) : (
                    <BtnGhost type="button" onClick={() => handleAction(p.code)}>{t('comparison.downgrade')}</BtnGhost>
                  )}
                </ColCta>
              </PlanCol>
            );
          })}
        </PlanGrid>
      </Section>

      {/* Enterprise — 별도 섹션 (표에서 분리) */}
      <EnterpriseCard>
        <EntContent>
          <EntTitle>{t('enterprise.title')}</EntTitle>
          <EntDesc>{t('enterprise.desc')}</EntDesc>
          <EntBullets>
            <li>{t('enterprise.bullets.sla')}</li>
            <li>{t('enterprise.bullets.support')}</li>
            <li>{t('enterprise.bullets.security')}</li>
            <li>{t('enterprise.bullets.custom')}</li>
          </EntBullets>
        </EntContent>
        <EntCta>
          <BtnPrimary type="button" onClick={openInquiry}>{t('enterprise.contactBtn')}</BtnPrimary>
        </EntCta>
      </EnterpriseCard>

      {/* P-2 결제 이력 — 영수증 PDF */}
      <Section>
        <SectionTitle>{t('billing.history.title', '결제 이력')}</SectionTitle>
        {(!status.recent_payments || status.recent_payments.length === 0) ? (
          <Dim>{t('billing.history.empty', '결제 내역이 없습니다')}</Dim>
        ) : (
          <PaymentList>
            {status.recent_payments.map(p => (
              <PaymentRow key={p.id}>
                <PaymentDate>{p.paid_at ? formatDate(p.paid_at) : '—'}</PaymentDate>
                <PaymentAmount>{p.currency === 'KRW' ? `₩${Number(p.amount).toLocaleString()}` : `${p.currency} ${Number(p.amount).toLocaleString()}`}</PaymentAmount>
                <PaymentMeta>
                  {t(`billing.cycle.${p.cycle}`, p.cycle)}
                  {p.period_start && p.period_end && ` · ${formatDate(p.period_start)} ~ ${formatDate(p.period_end)}`}
                </PaymentMeta>
                <PaymentStatus $status={p.status}>{t(`billing.payment.status.${p.status}`, p.status)}</PaymentStatus>
                {p.status === 'paid' && (
                  <ReceiptLink href={receiptPdfUrl(businessId, p.id)} target="_blank" rel="noopener">
                    {t('billing.history.receipt', '영수증')}
                  </ReceiptLink>
                )}
              </PaymentRow>
            ))}
          </PaymentList>
        )}
      </Section>

      {/* 변경 이력 */}
      <Section>
        <SectionTitle>{t('history.title')}</SectionTitle>
        {status.history.length === 0 ? (
          <Dim>{t('history.empty')}</Dim>
        ) : (
          <HistoryList>
            {status.history.map(h => (
              <HistoryRow key={h.id}>
                <HistoryDate>{formatDate(h.effective_at)}</HistoryDate>
                <HistoryChange>
                  {h.from_plan && <><PlanInline>{h.from_plan}</PlanInline> → </>}
                  <PlanInline $to>{h.to_plan}</PlanInline>
                </HistoryChange>
                <HistoryReason>{t(`history.reason.${h.reason}`)}</HistoryReason>
                <HistoryActor>{h.changed_by || t('history.system')}</HistoryActor>
                {h.note && <HistoryNote title={h.note}>{h.note}</HistoryNote>}
              </HistoryRow>
            ))}
          </HistoryList>
        )}
      </Section>

      {/* P-2 자체 결제 — CheckoutModal (입금 안내 + mark-paid) */}
      {paymentOpen && actionPlan && actionPlan !== 'free' && actionPlan !== 'enterprise' && (() => {
        const targetPlan = catalog.find(p => p.code === actionPlan);
        if (!targetPlan) return null;
        return (
          <CheckoutModal
            open={paymentOpen}
            businessId={businessId}
            plan={targetPlan}
            cycle={cycle}
            bankInfo={bankInfo}
            existingPaymentId={status.pending_payment?.id || null}
            existingAmount={status.pending_payment ? Number(status.pending_payment.amount) : null}
            onClose={() => { setPaymentOpen(false); setActionPlan(null); }}
            onPaid={handleCheckoutPaid}
          />
        );
      })()}

      {/* 다운그레이드 확인 모달 */}
      {actionPlan && !paymentOpen && !isUpgrade(actionPlan) && actionPlan !== 'enterprise' && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget) setActionPlan(null); }}>
          <Dialog>
            <DTitle>{t('confirm.downgradeTitle', { plan: catalog.find(p => p.code === actionPlan)?.name_ko || actionPlan })}</DTitle>
            <DBody>
              <p>{t('confirm.downgradeDesc', {
                date: status.plan_expires_at ? formatDate(status.plan_expires_at) : '다음 결제일'
              })}</p>
              {(() => {
                const target = catalog.find(p => p.code === actionPlan);
                if (!target) return null;
                const exceeds: string[] = [];
                if (target.limits.members_max != null && usage.members > target.limits.members_max)
                  exceeds.push(`${t('features.members')}: ${usage.members} / ${target.limits.members_max}`);
                if (target.limits.clients_max != null && usage.clients > target.limits.clients_max)
                  exceeds.push(`${t('features.clients')}: ${usage.clients} / ${target.limits.clients_max}`);
                if (target.limits.projects_max != null && usage.projects > target.limits.projects_max)
                  exceeds.push(`${t('features.projects')}: ${usage.projects} / ${target.limits.projects_max}`);
                if (target.limits.storage_bytes != null && usage.storage_bytes > target.limits.storage_bytes)
                  exceeds.push(`${t('features.storage')}: ${formatBytes(usage.storage_bytes)} / ${formatBytes(target.limits.storage_bytes)}`);
                if (exceeds.length === 0) return null;
                return (
                  <WarnBox>
                    <WarnTitle>{t('confirm.downgradeWarn')}</WarnTitle>
                    <WarnList>{exceeds.map((e, i) => <li key={i}>{e}</li>)}</WarnList>
                  </WarnBox>
                );
              })()}
            </DBody>
            <DFooter>
              <BtnGhost type="button" onClick={() => setActionPlan(null)}>{t('confirm.cancel')}</BtnGhost>
              <BtnDanger type="button" onClick={handleDowngradeConfirm}>{t('confirm.confirm')}</BtnDanger>
            </DFooter>
          </Dialog>
        </Modal>
      )}

      {/* 예약 취소 모달 */}
      {cancelScheduleOpen && status.scheduled_plan && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget) setCancelScheduleOpen(false); }}>
          <Dialog>
            <DTitle>{t('confirm.cancelScheduleTitle')}</DTitle>
            <DBody>
              <p>{t('confirm.cancelScheduleDesc', { plan: catalog.find(p => p.code === status.scheduled_plan)?.name_ko || status.scheduled_plan })}</p>
            </DBody>
            <DFooter>
              <BtnGhost type="button" onClick={() => setCancelScheduleOpen(false)}>{t('confirm.cancel')}</BtnGhost>
              <BtnPrimary type="button" onClick={handleCancelSchedule}>{t('confirm.confirm')}</BtnPrimary>
            </DFooter>
          </Dialog>
        </Modal>
      )}

      {/* Enterprise 문의 모달 */}
      {inquiryOpen && (
        <Modal onMouseDown={e => { if (e.target === e.currentTarget && !inquirySubmitting) setInquiryOpen(false); }}>
          <Dialog>
            <DTitle>{t('inquiry.title')}</DTitle>
            {inquirySuccess ? (
              <>
                <DBody>
                  <SuccessBox>
                    <SuccessTitle>{t('inquiry.successTitle')}</SuccessTitle>
                    <SuccessDesc>{t('inquiry.successDesc', { email: inquirySuccess.email })}</SuccessDesc>
                  </SuccessBox>
                </DBody>
                <DFooter>
                  <BtnPrimary type="button" onClick={() => setInquiryOpen(false)}>{t('inquiry.close')}</BtnPrimary>
                </DFooter>
              </>
            ) : (
              <>
                <DBody>
                  <InqSub>{t('inquiry.subtitle')}</InqSub>
                  <InqGrid>
                    <InqField>
                      <InqLabel>{t('inquiry.name')}<Req>*</Req></InqLabel>
                      <InqInput value={inqName} onChange={e => setInqName(e.target.value)} placeholder={t('inquiry.namePh') as string} maxLength={100} />
                    </InqField>
                    <InqField>
                      <InqLabel>{t('inquiry.email')}<Req>*</Req></InqLabel>
                      <InqInput type="email" value={inqEmail} onChange={e => setInqEmail(e.target.value)} placeholder={t('inquiry.emailPh') as string} maxLength={200} />
                    </InqField>
                    <InqField>
                      <InqLabel>{t('inquiry.company')}</InqLabel>
                      <InqInput value={inqCompany} onChange={e => setInqCompany(e.target.value)} placeholder={t('inquiry.companyPh') as string} maxLength={200} />
                    </InqField>
                    <InqField>
                      <InqLabel>{t('inquiry.phone')}</InqLabel>
                      <InqInput value={inqPhone} onChange={e => setInqPhone(e.target.value)} placeholder={t('inquiry.phonePh') as string} maxLength={50} />
                    </InqField>
                    <InqField $span2>
                      <InqLabel>{t('inquiry.message')}<Req>*</Req></InqLabel>
                      <InqTextarea rows={5} value={inqMessage} onChange={e => setInqMessage(e.target.value)} placeholder={t('inquiry.messagePh') as string} maxLength={5000} />
                    </InqField>
                  </InqGrid>
                  {inquiryErr && <InqError>{t('inquiry.error')}</InqError>}
                </DBody>
                <DFooter>
                  <BtnGhost type="button" disabled={inquirySubmitting} onClick={() => setInquiryOpen(false)}>{t('inquiry.cancel')}</BtnGhost>
                  <BtnPrimary type="button" disabled={inquirySubmitting || !inqName.trim() || !inqEmail.trim() || !inqMessage.trim()} onClick={submitInquiryForm}>
                    {inquirySubmitting ? t('inquiry.submitting') : t('inquiry.submit')}
                  </BtnPrimary>
                </DFooter>
              </>
            )}
          </Dialog>
        </Modal>
      )}
    </Wrap>
  );
};

export default PlanSettings;

// ─── 사용량 바 서브 컴포넌트 ───

interface UsageRowProps {
  label: string;
  current: number;
  limit: number | null;
  formatter?: (n: number | null) => string;
  unit?: string;
  t: (k: string) => string;
}
const UsageRow: React.FC<UsageRowProps> = ({ label, current, limit, formatter, unit, t }) => {
  const isUnlimited = limit === null || limit === undefined;
  const ratio = isUnlimited ? 0 : Math.min(1, current / Math.max(1, limit as number));
  const color = usageColor(ratio);
  const fmt = formatter || ((n: number | null) => n === null ? '∞' : n.toLocaleString());
  return (
    <UsageBlock>
      <UsageLabel>{label}</UsageLabel>
      <UsageValueRow>
        <UsageValue>{fmt(current)}{unit ? unit : ''}</UsageValue>
        <UsageDivider>/</UsageDivider>
        <UsageLimit>{fmt(limit)}{unit ? unit : ''}</UsageLimit>
        {!isUnlimited && (
          <UsagePct $color={color}>{Math.round(ratio * 100)}%</UsagePct>
        )}
      </UsageValueRow>
      {!isUnlimited && (
        <>
          <UsageBar>
            <UsageFill style={{ width: `${ratio * 100}%` }} $color={color} />
          </UsageBar>
          {color !== 'ok' && (
            <UsageWarn $color={color}>
              {color === 'crit' ? t('usage.warningFull') : t('usage.warningSoon')}
            </UsageWarn>
          )}
        </>
      )}
    </UsageBlock>
  );
};

const Skeleton: React.FC = () => (
  <Wrap>
    <SkBar style={{ width: '40%', height: 18, marginBottom: 8 }} />
    <SkBar style={{ width: '80%', height: 12, marginBottom: 24 }} />
    <SkCard />
    <SkCard />
  </Wrap>
);
const shim = `@keyframes sk{0%{background-position:-200px 0}100%{background-position:calc(200px + 100%) 0}}`;
const SkBar = styled.div`${shim}background:linear-gradient(90deg,#F1F5F9 0,#E2E8F0 40px,#F1F5F9 80px);background-size:200px 100%;animation:sk 1.2s linear infinite;border-radius:6px;`;
const SkCard = styled(SkBar)`height:140px;margin-bottom:16px;border-radius:12px;`;

// ─── styled ───

const Wrap = styled.div`display:flex;flex-direction:column;gap:20px;`;

const CurrentCard = styled.div<{ $plan: PlanCode }>`
  background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:20px 24px;
  position:relative;overflow:hidden;
`;
const CardHead = styled.div`display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;`;
const PlanBadge = styled.span<{ $code: PlanCode }>`
  padding:4px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.3px;
  ${p => planBadge(p.$code)}
`;
const PlanTitle = styled.h3`margin:0;font-size:18px;font-weight:700;color:#0F172A;`;
const StatusBadges = styled.div`margin-left:auto;display:flex;gap:6px;`;
const StateBadge = styled.span<{ $kind: 'active' | 'trial' | 'grace' }>`
  padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;
  ${p => p.$kind === 'active' ? 'background:#F0FDFA;color:#0F766E;'
    : p.$kind === 'trial' ? 'background:#DBEAFE;color:#1D4ED8;'
    : 'background:#FEF3C7;color:#92400E;'}
`;
const PriceRow = styled.div`display:flex;align-items:baseline;gap:6px;margin-top:4px;`;
const Price = styled.div`font-size:28px;font-weight:800;color:#0F172A;`;
const PriceUnit = styled.div`font-size:13px;color:#64748B;`;
const MetaRow = styled.div`display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:8px;`;
const Meta = styled.div`font-size:12px;color:#475569;display:inline-flex;align-items:center;gap:8px;`;
const LinkBtn = styled.button`background:none;border:none;color:#0D9488;font-size:12px;font-weight:600;cursor:pointer;text-decoration:underline;
  &:hover{color:#0F766E;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}`;

const Section = styled.div`background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:20px 24px;`;
const SectionTitle = styled.h3`margin:0 0 16px;font-size:14px;font-weight:700;color:#0F172A;`;
const SectionHeadRow = styled.div`display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;
  h3{margin:0;}`;
const Controls = styled.div`display:flex;gap:8px;`;
const Seg = styled.div`display:inline-flex;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:8px;padding:2px;gap:2px;`;
const SegBtn = styled.button<{ $active: boolean }>`
  height:28px;padding:0 12px;font-size:12px;font-weight:600;border:none;border-radius:6px;cursor:pointer;
  display:inline-flex;align-items:center;gap:6px;
  background:${p => p.$active ? '#fff' : 'transparent'};
  color:${p => p.$active ? '#0F172A' : '#64748B'};
  box-shadow:${p => p.$active ? '0 1px 2px rgba(15,23,42,0.06)' : 'none'};
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
`;
const SmallBadge = styled.span`padding:1px 6px;background:#F43F5E;color:#fff;border-radius:4px;font-size:9px;font-weight:700;`;

/* 사용량 */
const UsageGrid = styled.div`display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;`;
const UsageBlock = styled.div`display:flex;flex-direction:column;gap:6px;`;
const UsageLabel = styled.div`font-size:12px;font-weight:600;color:#475569;`;
const UsageValueRow = styled.div`display:flex;align-items:baseline;gap:6px;`;
const UsageValue = styled.span`font-size:15px;font-weight:700;color:#0F172A;`;
const UsageDivider = styled.span`color:#CBD5E1;`;
const UsageLimit = styled.span`font-size:13px;color:#64748B;`;
const UsagePct = styled.span<{ $color: 'ok' | 'warn' | 'crit' }>`
  margin-left:auto;font-size:11px;font-weight:700;
  color:${p => p.$color === 'crit' ? '#DC2626' : p.$color === 'warn' ? '#C2410C' : '#0F766E'};
`;
const UsageBar = styled.div`height:6px;background:#F1F5F9;border-radius:4px;overflow:hidden;`;
const UsageFill = styled.div<{ $color: 'ok' | 'warn' | 'crit' }>`
  height:100%;transition:width .3s;
  background:${p => p.$color === 'crit' ? '#DC2626' : p.$color === 'warn' ? '#F59E0B' : '#14B8A6'};
`;
const UsageWarn = styled.div<{ $color: 'ok' | 'warn' | 'crit' }>`
  font-size:11px;font-weight:600;
  color:${p => p.$color === 'crit' ? '#DC2626' : '#C2410C'};
`;

/* 비교표 */
const PlanGrid = styled.div`
  display:grid;grid-template-columns:repeat(4, 1fr);gap:14px;
  @media (max-width: 1180px){ grid-template-columns:repeat(2, 1fr); }
  @media (max-width: 640px){ grid-template-columns:1fr; }
`;
const PlanCol = styled.div<{ $current: boolean }>`
  position:relative;display:flex;flex-direction:column;
  background:#fff;border:${p => p.$current ? '2px solid #14B8A6' : '1px solid #E2E8F0'};
  border-radius:14px;padding:20px 16px;gap:12px;
  ${p => p.$current ? 'box-shadow:0 4px 12px rgba(20,184,166,0.08);' : ''}
`;
const TopRibbon = styled.div<{ $warn?: boolean }>`
  position:absolute;top:-10px;left:50%;transform:translateX(-50%);
  padding:3px 12px;background:${p => p.$warn ? '#F59E0B' : '#14B8A6'};color:#fff;
  border-radius:999px;font-size:10px;font-weight:700;letter-spacing:0.2px;
`;
const PlanColHead = styled.div`text-align:center;padding-bottom:12px;border-bottom:1px solid #F1F5F9;`;
const PlanName = styled.div`font-size:16px;font-weight:700;color:#0F172A;`;
const PlanEn = styled.div`font-size:11px;color:#94A3B8;letter-spacing:0.3px;text-transform:uppercase;margin-top:2px;`;
const ColPriceRow = styled.div`margin-top:12px;display:flex;align-items:baseline;justify-content:center;gap:4px;min-height:32px;`;
const ColPrice = styled.div`font-size:22px;font-weight:800;color:#0F172A;`;
const ColPriceUnit = styled.div`font-size:12px;color:#64748B;`;
const VatText = styled.div`font-size:10px;color:#94A3B8;margin-top:2px;`;
const PlanTarget = styled.div`font-size:12px;color:#64748B;margin-top:8px;line-height:1.4;`;
const FeatureList = styled.div`display:flex;flex-direction:column;gap:6px;flex:1;`;
const FeatItem = styled.div<{ $hl?: boolean }>`
  display:flex;justify-content:space-between;gap:8px;font-size:12px;align-items:center;
  ${p => p.$hl
    ? 'background:#F8FAFC;padding:8px 10px;border-radius:6px;margin:2px 0;'
    : 'padding:2px 10px;'}
`;
const FK = styled.span`color:#64748B;`;
const FV = styled.span`color:#0F172A;font-weight:600;`;
const ColCta = styled.div`display:flex;flex-direction:column;gap:6px;padding-top:8px;`;
const BtnPrimary = styled.button`
  height:36px;background:#14B8A6;color:#fff;border:none;border-radius:8px;
  font-size:13px;font-weight:600;cursor:pointer;
  &:hover:not(:disabled){background:#0D9488;}
  &:disabled{opacity:0.5;cursor:not-allowed;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const BtnGhost = styled.button`
  height:36px;background:#fff;color:#0F172A;border:1px solid #CBD5E1;border-radius:8px;
  font-size:13px;font-weight:600;cursor:pointer;
  &:hover:not(:disabled){background:#F8FAFC;}
  &:disabled{opacity:0.5;cursor:not-allowed;color:#94A3B8;}
`;
const BtnDanger = styled.button`
  height:36px;background:#fff;color:#DC2626;border:1px solid #FCA5A5;border-radius:8px;
  font-size:13px;font-weight:600;cursor:pointer;
  &:hover{background:#FEF2F2;border-color:#DC2626;}
`;
const BtnLink = styled.button`
  height:30px;background:transparent;color:#0D9488;border:none;
  font-size:12px;font-weight:600;cursor:pointer;text-decoration:underline;
  &:hover{color:#0F766E;}
`;

/* 이력 */
const HistoryList = styled.div`display:flex;flex-direction:column;gap:1px;`;
const HistoryRow = styled.div`
  display:grid;grid-template-columns:100px minmax(140px, 1fr) 80px 80px 1fr;
  gap:12px;padding:10px 8px;font-size:12px;
  border-bottom:1px solid #F1F5F9;align-items:center;
  &:last-child{border-bottom:none;}
  @media (max-width: 768px){ grid-template-columns:1fr; gap:4px; padding:10px 0;}
`;
const HistoryDate = styled.div`color:#64748B;`;
const HistoryChange = styled.div`color:#0F172A;`;
const PlanInline = styled.span<{ $to?: boolean }>`
  padding:1px 6px;background:#F1F5F9;border-radius:4px;font-size:11px;font-weight:600;
  color:${p => p.$to ? '#0F766E' : '#475569'};
`;
const HistoryReason = styled.div`color:#475569;`;
const HistoryActor = styled.div`color:#64748B;`;
const HistoryNote = styled.div`color:#94A3B8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;

const Dim = styled.div`padding:20px;text-align:center;font-size:12px;color:#94A3B8;`;

/* 모달 */
const Modal = styled.div`position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.24);display:flex;align-items:center;justify-content:center;padding:20px;`;
const Dialog = styled.div`background:#fff;border-radius:14px;width:100%;max-width:520px;box-shadow:0 20px 50px rgba(15,23,42,.2);display:flex;flex-direction:column;overflow:hidden;`;
const DTitle = styled.div`padding:20px 22px 12px;font-size:16px;font-weight:700;color:#0F172A;`;
const DBody = styled.div`padding:0 22px 16px;font-size:13px;color:#475569;line-height:1.6;p{margin:4px 0;}`;
const DFooter = styled.div`padding:12px 22px;border-top:1px solid #EEF2F6;display:flex;gap:8px;justify-content:flex-end;`;
const WarnBox = styled.div`margin-top:12px;padding:10px 12px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;`;
const WarnTitle = styled.div`font-size:12px;font-weight:700;color:#92400E;margin-bottom:4px;`;
const WarnList = styled.ul`margin:0;padding-left:18px;font-size:12px;color:#92400E;`;

/* Enterprise 카드 (표 아래 별도 섹션) */
const EnterpriseCard = styled.div`
  display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;
  background:linear-gradient(135deg,#0F172A 0%,#1E293B 100%);color:#fff;
  border-radius:14px;padding:28px 28px;
  @media (max-width: 768px){ grid-template-columns:1fr; gap:16px; padding:24px 20px; }
`;
const EntContent = styled.div`display:flex;flex-direction:column;gap:10px;`;
const EntTitle = styled.h3`margin:0;font-size:18px;font-weight:700;letter-spacing:-0.2px;`;
const EntDesc = styled.p`margin:0;font-size:13px;line-height:1.6;color:#CBD5E1;`;
const EntBullets = styled.ul`
  margin:4px 0 0;padding:0;list-style:none;
  display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;
  li{font-size:12px;color:#E2E8F0;padding-left:16px;position:relative;}
  li::before{content:'';position:absolute;left:0;top:8px;width:6px;height:6px;border-radius:50%;background:#14B8A6;}
  @media (max-width: 560px){ grid-template-columns:1fr; }
`;
const EntCta = styled.div`display:flex;justify-content:flex-end;align-items:center;`;

/* 문의 모달 폼 */
const InqSub = styled.p`margin:0 0 16px;font-size:12px;color:#64748B;`;
const InqGrid = styled.div`
  display:grid;grid-template-columns:1fr 1fr;gap:12px;
  @media (max-width: 560px){ grid-template-columns:1fr; }
`;
const InqField = styled.div<{ $span2?: boolean }>`
  display:flex;flex-direction:column;gap:6px;
  ${p => p.$span2 && 'grid-column: 1 / -1;'}
`;
const InqLabel = styled.label`font-size:12px;font-weight:600;color:#334155;display:flex;align-items:center;gap:2px;`;
const Req = styled.span`color:#DC2626;font-weight:700;`;
const InqInput = styled.input`
  height:36px;padding:0 12px;font-size:13px;color:#0F172A;
  background:#fff;border:1px solid #CBD5E1;border-radius:8px;font-family:inherit;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.12);}
  &::placeholder{color:#94A3B8;}
`;
const InqTextarea = styled.textarea`
  padding:10px 12px;font-size:13px;color:#0F172A;
  background:#fff;border:1px solid #CBD5E1;border-radius:8px;font-family:inherit;
  resize:vertical;min-height:100px;line-height:1.6;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.12);}
  &::placeholder{color:#94A3B8;}
`;
const InqError = styled.div`margin-top:10px;padding:8px 12px;background:#FEF2F2;border:1px solid #FCA5A5;color:#B91C1C;border-radius:8px;font-size:12px;`;
const SuccessBox = styled.div`padding:20px;background:#F0FDFA;border:1px solid #99F6E4;border-radius:10px;text-align:center;`;
const SuccessTitle = styled.div`font-size:15px;font-weight:700;color:#0F766E;margin-bottom:6px;`;
const SuccessDesc = styled.div`font-size:13px;color:#0F766E;line-height:1.6;`;

// ─── Plan 배지 색상 ───
function planBadge(code: PlanCode): string {
  switch (code) {
    case 'free':       return 'background:#F1F5F9;color:#64748B;';
    case 'starter':    return 'background:#DBEAFE;color:#1D4ED8;';
    case 'basic':      return 'background:#F0FDFA;color:#0F766E;';
    case 'pro':        return 'background:#F3E8FF;color:#6B21A8;';
    case 'enterprise': return 'background:#FEF3C7;color:#92400E;';
  }
}

// ─── P-2 결제 이력 styled ───
const PaymentList = styled.div`display: flex; flex-direction: column;`;
const PaymentRow = styled.div`
  display: grid;
  grid-template-columns: 100px 110px 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
  font-size: 12px;
  @media (max-width: 768px) {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
  }
`;
const PaymentDate = styled.div`color: #64748B; font-variant-numeric: tabular-nums;`;
const PaymentAmount = styled.div`font-weight: 700; color: #0F172A;`;
const PaymentMeta = styled.div`color: #64748B;`;
const PaymentStatus = styled.span<{ $status: string }>`
  padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600;
  background: ${p =>
    p.$status === 'paid' ? '#DCFCE7' :
    p.$status === 'refunded' ? '#FEF3C7' :
    p.$status === 'failed' ? '#FEE2E2' :
    '#F1F5F9'};
  color: ${p =>
    p.$status === 'paid' ? '#15803D' :
    p.$status === 'refunded' ? '#92400E' :
    p.$status === 'failed' ? '#B91C1C' :
    '#64748B'};
`;
const ReceiptLink = styled.a`
  font-size: 11px; color: #0D9488; font-weight: 600;
  text-decoration: none; padding: 4px 10px;
  border: 1px solid #5EEAD4; border-radius: 6px;
  &:hover { background: #F0FDFA; }
`;
