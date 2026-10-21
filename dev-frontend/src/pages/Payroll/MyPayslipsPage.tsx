// 내 급여명세서 — 급여 메뉴(/payroll)의 «내 명세서» 칸 (docs/PAYROLL_DESIGN.md §9). 기능이 켜져 있으면 직원 누구나, 보이는 것은 «자기 것» 만(서버 routes/payroll_me.js).
//   ★ 2026-10-20 Irene «급여/계약, 내 급여명세서 메뉴는 합쳐야 할 것 같은데 왜 나눠?» — 메뉴를 하나로 합쳤다.
//     관리자에게는 급여 화면의 탭 하나, 직원에게는 급여 화면 그 자체다. 옛 주소 /me/payslips 는 /payroll?tab=mine 으로 넘긴다(알림 링크·즐겨찾기).
//   목록 → 명세서 상세(DetailDrawer · ?entry= 싱크 · 재클릭 토글) + [PDF 내려받기].
//   ★ 금액은 확정된 회차만(초안은 명세서가 아니다 — 서버가 404). 계좌번호는 없다(끝 4자리만). 열람하면 «새로 옴» 이 사라진다.
//   실시간: payslip:new(내 개인 방) → 다시 읽기 + 탭 복귀 재조회.
import { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import DetailDrawer from '../../components/Common/DetailDrawer';
import ActionButton from '../../components/Common/ActionButton';
import { useAuth } from '../../contexts/AuthContext';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { listRowTitleCss } from '../../theme/tokens';
import { payrollApi, PayrollError, formatMoney, type MyContract, type Payslip, type PayslipSummary } from './payrollApi';

/** 옛 주소 /me/payslips?entry=… → /payroll?tab=mine&entry=… (쿼리 그대로) */
export default function MyPayslipsRedirect() {
  const loc = useLocation();
  const sp = new URLSearchParams(loc.search);
  sp.set('tab', 'mine');
  return <Navigate to={`/payroll?${sp.toString()}`} replace />;
}

export function MyPayslipsView() {
  const { t, i18n } = useTranslation('payroll');
  const lang = i18n.language;
  const { user } = useAuth();
  const bizId = user?.business_id ? Number(user.business_id) : null;
  const [rows, setRows] = useState<PayslipSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [params, setParams] = useSearchParams();
  const entryId = params.get('entry') ? Number(params.get('entry')) : null;
  const seqRef = useRef(0);

  const [contracts, setContracts] = useState<MyContract[]>([]);
  const load = useCallback(async (silent = false) => {
    if (!bizId) return;
    const seq = ++seqRef.current;
    if (!silent) setLoading(true);
    payrollApi.myContracts(bizId).then((c) => { if (seq === seqRef.current) setContracts(c); }).catch(() => null);
    try { const r = await payrollApi.myPayslips(bizId); if (seq === seqRef.current) { setRows(r); setError(false); } }
    catch { if (seq === seqRef.current && !silent) setError(true); }
    finally { if (seq === seqRef.current && !silent) setLoading(false); }
  }, [bizId]);
  useEffect(() => { load(); }, [load]);
  const silentLoad = useCallback(() => load(true), [load]);
  useVisibilityRefresh(silentLoad);
  useEffect(() => onSocket<{ business_id?: number }>('payslip:new', (d) => {
    if (d?.business_id && Number(d.business_id) !== bizId) return;
    silentLoad();
  }), [bizId, silentLoad]);

  const open = (id: number) => {
    const sp = new URLSearchParams(params);
    if (entryId === id) sp.delete('entry'); else sp.set('entry', String(id));
    setParams(sp, { replace: true });
  };
  const close = () => { const sp = new URLSearchParams(params); sp.delete('entry'); setParams(sp, { replace: true }); };

  return (
    <>
      {loading ? null : error ? (
        <Empty>
          <span>{t('payslips.loadFailed')}</span>
          <ActionButton tone="secondary" onClick={() => load()}>{t('payslips.retry')}</ActionButton>
        </Empty>
      ) : rows.length === 0 ? (
        <Empty data-testid="payslips-empty">{t('payslips.empty')}</Empty>
      ) : (
        <List data-testid="payslips-list">
          {rows.map((r) => (
            <Row key={r.entry_id} type="button" $active={entryId === r.entry_id} data-testid="payslip-row" onClick={() => open(r.entry_id)}>
              <Main>
                <RowTitle>
                  {t('payslips.period', { period: r.period_ym })}
                  {r.kind === 'adjustment' && <Adj>{t('payslips.adjustment', { n: r.seq - 1 })}</Adj>}
                  {!r.viewed && <New>{t('payslips.new')}</New>}
                </RowTitle>
                {r.pay_date && <RowMeta>{t('payslips.payDate', { date: r.pay_date })}</RowMeta>}
              </Main>
              <Net>{formatMoney(r.net_total, r.currency, lang)}</Net>
            </Row>
          ))}
        </List>
      )}
      {contracts.length > 0 && (
        <ContractBox data-testid="my-contracts">
          <BoxTitle>{t('payslips.myContracts')}</BoxTitle>
          {contracts.map((c) => (
            <ContractLine key={c.id}>
              <span><b>{t(`kind.${c.kind}`)}</b> · {c.start_date} ~ {c.end_date || t('contract.openEnded')} {c.status === 'active' ? <Current>{t('contractStatus.active')}</Current> : null}</span>
              <Muted>{c.lines.filter((l) => l.side === 'earning').map((l) => `${lang === 'en' && l.name_en ? l.name_en : l.name} ${formatMoney(l.amount, c.currency, lang)}`).join(' · ')}</Muted>
            </ContractLine>
          ))}
        </ContractBox>
      )}
      {bizId && entryId !== null && (
        <PayslipDrawer key={entryId} businessId={bizId} entryId={entryId} onClose={close} onViewed={silentLoad} />
      )}
    </>
  );
}

function PayslipDrawer({ businessId, entryId, onClose, onViewed }: { businessId: number; entryId: number; onClose: () => void; onViewed: () => void }) {
  const { t, i18n } = useTranslation('payroll');
  const lang = i18n.language;
  const [p, setP] = useState<Payslip | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    payrollApi.myPayslip(businessId, entryId).then((x) => { setP(x); onViewed(); }).catch((e) => setErr(e instanceof PayrollError ? e.code : 'generic'));
  }, [businessId, entryId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cur = p?.entry.currency || 'KRW';
  const money = (n: number | null) => formatMoney(n, cur, lang);
  const nm = (x: { name: string; name_en: string | null }) => (lang === 'en' && x.name_en ? x.name_en : x.name);
  const pdf = async () => {
    if (busy) return;
    setBusy(true);
    try { await payrollApi.myPayslipPdf(businessId, entryId, lang); } catch (e) { setErr(e instanceof PayrollError ? e.code : 'generic'); } finally { setBusy(false); }
  };
  return (
    <DetailDrawer open onClose={onClose} ariaLabel={t('payslips.title') as string}>
      <DetailDrawer.Header onClose={onClose}>
        <Title data-testid="payslip-title">{p ? t('payslips.period', { period: p.run.period_ym }) : t('payslips.title')}</Title>
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        {err && <Err role="alert">{t(`error.${err}`, { defaultValue: t('payslips.notFound') as string })}</Err>}
        {p && (
          <>
            <Who>
              <b>{p.entry.display_name}</b>
              <span>{[p.business.name, p.entry.department_name, p.entry.job_title, p.run.pay_date ? t('payslips.payDate', { date: p.run.pay_date }) : null].filter(Boolean).join(' · ')}</span>
            </Who>
            <Sec>{t('payslips.earnings')}</Sec>
            <Lines>
              {p.earnings.map((x, i) => <Line key={i} data-testid="payslip-line"><span>{nm(x)}{!x.taxable ? <Inl> ({t('payslips.nontax')})</Inl> : null}</span><b>{money(x.amount)}</b></Line>)}
              <Line $sum><span>{t('payslips.gross')}</span><b>{money(p.entry.gross_total)}</b></Line>
            </Lines>
            <Sec>{t('payslips.deductions')}</Sec>
            <Lines>
              {p.deductions.map((x, i) => <Line key={i} data-testid="payslip-line"><span>{nm(x)}{x.sign === 'minus' ? <Inl> (−)</Inl> : null}</span><b>{money(x.amount)}</b></Line>)}
              <Line $sum><span>{t('payslips.deduction')}</span><b>{money(p.entry.deduction_total)}</b></Line>
            </Lines>
            <NetBox data-testid="payslip-net"><span>{t('payslips.net')}</span><b>{money(p.entry.net_total)}</b></NetBox>
            {p.entry.bank_last4 && <Small>{t('payslips.account')}: {p.entry.bank_name || ''} ****{p.entry.bank_last4}</Small>}
            {!!p.entry.unpaid_leave_days && <Small>{t('payslips.unpaid', { n: p.entry.unpaid_leave_days })}</Small>}
            <Resp>{t('responsibility')}</Resp>
          </>
        )}
      </DetailDrawer.Body>
      {/* PDF 는 하단 고정 줄(2026-10-21 우측 패널 통일) — 명세 줄이 길면 본문 끝 버튼은 스크롤 밖이었다 */}
      {p && (
        <DetailDrawer.Footer>
          <ActionButton tone="secondary" size="sm" loading={busy} data-testid="payslip-pdf" onClick={pdf}>{t('payslips.pdf')}</ActionButton>
        </DetailDrawer.Footer>
      )}
    </DetailDrawer>
  );
}

const List = styled.div`background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;`;
const Row = styled.button<{ $active: boolean }>`
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 16px; min-height: 60px;
  background: ${(p) => (p.$active ? '#F0FDFA' : '#FFF')}; border: none; border-bottom: 1px solid #F1F5F9; text-align: left; cursor: pointer; font-family: inherit;
  &:last-child { border-bottom: none; } &:hover { background: ${(p) => (p.$active ? '#F0FDFA' : '#F8FAFC')}; }
`;
const Main = styled.div`flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const RowTitle = styled.span`${listRowTitleCss} color: #0F172A; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const RowMeta = styled.span`font-size: 0.75rem; color: #64748B;`;
const Adj = styled.span`padding: 0 6px; border-radius: 4px; background: #FFF7ED; color: #C2410C; font-size: 0.6875rem; font-weight: 600;`;
const New = styled.span`padding: 0 6px; border-radius: 4px; background: #FFE4E6; color: #E11D48; font-size: 0.6875rem; font-weight: 700;`;
const Net = styled.span`font-size: 0.875rem; font-weight: 700; color: #0F172A; font-variant-numeric: tabular-nums; white-space: nowrap;`;
const Empty = styled.div`padding: 40px 16px; text-align: center; color: #64748B; font-size: 0.875rem; background: #FFF; border: 1px dashed #E2E8F0; border-radius: 12px; display: flex; flex-direction: column; align-items: center; gap: 12px;`;
const Title = styled.h2`margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A;`;
const Err = styled.div`margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem;`;
const Who = styled.div`display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; b { font-size: 0.9375rem; color: #0F172A; } span { font-size: 0.75rem; color: #64748B; }`;
const Sec = styled.h3`margin: 12px 0 6px; font-size: 0.8125rem; font-weight: 700; color: #334155;`;
// ★ 서랍 본문은 세로 flex — overflow 를 준 상자는 flex-shrink:0 이 없으면 눌려 줄이 잘린다(2026-10-15 실측: 공제 줄 3개가 안 보였다)
const Lines = styled.div`border: 1px solid #F1F5F9; border-radius: 10px; overflow: hidden; flex-shrink: 0;`;
const Line = styled.div<{ $sum?: boolean }>`
  display: flex; justify-content: space-between; gap: 10px; padding: 8px 12px; border-bottom: 1px solid #F8FAFC; font-size: 0.8125rem; color: #334155;
  background: ${(p) => (p.$sum ? '#F8FAFC' : '#FFF')}; font-weight: ${(p) => (p.$sum ? 700 : 400)};
  b { font-variant-numeric: tabular-nums; color: #0F172A; } &:last-child { border-bottom: none; }
`;
const Small = styled.span`display: block; margin-top: 6px; font-size: 0.75rem; color: #64748B; font-weight: 400;`;
const Inl = styled.span`font-size: 0.75rem; color: #94A3B8;`;
const NetBox = styled.div`margin: 14px 0 6px; padding: 12px 14px; border-radius: 10px; background: #F0FDFA; display: flex; justify-content: space-between; font-size: 1rem; font-weight: 700; color: #0F766E; b { font-variant-numeric: tabular-nums; }`;
const Resp = styled.p`margin: 14px 0; font-size: 0.75rem; color: #94A3B8; line-height: 1.5;`;
const ContractBox = styled.section`margin-top: 16px; background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 16px;`;
const BoxTitle = styled.h3`margin: 0 0 6px; font-size: 0.8125rem; font-weight: 700; color: #334155;`;
const ContractLine = styled.div`display: flex; flex-direction: column; gap: 2px; padding: 8px 0; border-top: 1px solid #F8FAFC; font-size: 0.8125rem; color: #0F172A; &:first-of-type { border-top: none; }`;
const Current = styled.span`margin-left: 6px; padding: 0 6px; border-radius: 4px; background: #CCFBF1; color: #0F766E; font-size: 0.6875rem; font-weight: 700;`;
const Muted = styled.span`font-size: 0.75rem; color: #64748B;`;
