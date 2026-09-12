// ClientPanel — 고객 정보 **우측 패널** (Q sale 상담·고객 탭 공용)
//
// Irene 2026-09-12: *"설정에서 고객/파트너에 나오는 정보랑 통합해서 제대로 만들어줘. 그리고 전체보기
//   아이콘 만들어서 누르면 지금처럼 전체 고객페이지 보게 해주고, 고객들 이름 여기 저기 나오면
//   고객페이지 보기 기능이 있어서 누르면 전체보기 형태로 다 보게 해줘."*
//   그리고: *"설정에 있는 건 관리자가 하는 관리도 있는 거고 Q sale에는 관리설정은 빠지고 잘 동기화 하면 돼"*
//
// ★ 경계 — **정보는 공유, 관리는 설정에만.**
//   여기 있는 것: 프로필 · 연락처(종류별) · 사업자 정보 · 단계 · 연결된 프로젝트/대화 수
//   여기 **없는** 것: 초대/재초대 · 보관 스위치 · 삭제 · 한도 포함 여부 — 그건 /business/clients 의 몫이다.
//
// ★ 정본은 `GET /api/sale/:biz/clients/:id` 하나다. 화면마다 따로 모으면 반드시 갈라진다.
//   목록용 직렬화는 이메일을 하나로 접지만(초대→계정→청구), 상세는 **종류별로 펴서** 내려온다 —
//   그래야 "어떤 주소인지" 를 말할 수 있다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../Common/DetailDrawer';
import ActionButton from '../Common/ActionButton';
import LetterAvatar from '../Common/LetterAvatar';
import { useChromeNav } from '../../hooks/useChromeNav';
import { getSaleClient, setSaleStage, type SaleClientDetail } from '../../services/sale';

/** 아직 고객이 아닌 문의(상담 행)를 그릴 때 쓰는 값 — 원본에서 **가져올 수 있는 것은 다 넣는다**.
 *  Irene 2026-09-12: *"만약 고객이 아니고 게스트면 가져올 수 있는 정보를 다 넣어야지. 이름 이메일주소 등등."* */
export interface InquiryView {
  who: string | null;
  email: string | null;
  company: { name: string; estimated: boolean } | null;
  title: string | null;
  preview: string | null;
  at: string | null;
  needsReply: boolean;
  source: string;
  /** 등록 가능하면 누를 수 있다(링크 없는 순수 대화방은 서버가 못 받는다) */
  canRegister: boolean;
  emailVerified?: boolean;
}

interface Props {
  businessId: number;
  clientId: number | null;
  /** clientId 가 없고 이것이 있으면 **미등록 문의**를 그린다 */
  inquiry?: InquiryView | null;
  onClose: () => void;
  /** 단계가 바뀌면 부모 목록도 다시 읽는다 */
  onChanged?: () => void;
  /** 미등록 문의를 고객으로 등록 */
  onRegister?: () => void;
}

const ClientPanel: React.FC<Props> = ({ businessId, clientId, onClose, onChanged }) => {
  const { t } = useTranslation('qsale');
  const navigate = useChromeNav();
  const [data, setData] = useState<SaleClientDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!clientId) { setData(null); return; }
    let alive = true;
    setLoading(true); setError(false);
    getSaleClient(businessId, clientId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [businessId, clientId]);

  const changeStage = useCallback(async (stage: 'won' | 'lost') => {
    if (!clientId || busy) return;
    setBusy(true);
    try {
      // ★ 시그니처는 **객체**다(`{ to, reason?, lost_reason?, lost_note? }`). 문자열을 넘기면 서버가 단계를 못 읽는다.
      // ☐ 한계 — 불발 사유(lost_reason·lost_note)를 아직 안 받는다. 사유 없이 닫으면 "왜 깨졌는지" 가
      //   원장에 남지 않는다. 사유 입력은 다음 묶음에서 붙인다.
      await setSaleStage(businessId, clientId, { to: stage });
      const fresh = await getSaleClient(businessId, clientId);
      setData(fresh);
      onChanged?.();
    } catch { setError(true); } finally { setBusy(false); }
  }, [businessId, clientId, busy, onChanged]);

  const name = data?.display_name || data?.company_name || '';

  return (
    <DetailDrawer open={!!clientId} onClose={onClose} width={420} ariaLabel={name || 'client'}>
      <DetailDrawer.Header onClose={onClose}>
        <HeadRow>
          <HeadName title={name}>{name || '—'}</HeadName>
          {/* 전체보기 — 지금처럼 고객 페이지 전체를 본다 */}
          {clientId && (
            <IconBtn type="button" data-testid="client-panel-full"
              title={t('panel.openFull') as string} aria-label={t('panel.openFull') as string}
              onClick={() => navigate(`/sale/${clientId}`)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6" /><path d="M10 14L21 3" />
                <path d="M21 14v7H3V3h7" />
              </svg>
            </IconBtn>
          )}
        </HeadRow>
      </DetailDrawer.Header>

      <DetailDrawer.Body>
        {loading ? (
          <Dim>{t('timeline.loading', { defaultValue: '불러오는 중…' }) as string}</Dim>
        ) : error || !data ? (
          <Dim>{t('error.loadFailed') as string}</Dim>
        ) : (
          <>
            <Top>
              <LetterAvatar name={name || '—'} size={44} variant="neutral" />
              <TopText>
                <TopName>{name || '—'}</TopName>
                {data.company_name && data.display_name && <TopSub>{data.company_name}</TopSub>}
                <StageTag>{t(`stage.${data.sales_stage}`) as string}</StageTag>
              </TopText>
            </Top>

            <Section>
              <SectionTitle>{t('panel.contact') as string}</SectionTitle>
              <Row label={t('panel.phone') as string} value={data.contact?.phone} />
              {/* ★ 이메일은 **종류별로** 보여준다 — 목록처럼 하나로 접으면 어떤 주소인지 알 수 없다 */}
              <Row label={t('panel.accountEmail') as string} value={data.contact?.account_email} />
              <Row label={t('panel.inviteEmail') as string} value={data.contact?.invite_email} />
              <Row label={t('panel.billingEmail') as string} value={data.contact?.billing_email} />
              <Row label={t('panel.taxEmail') as string} value={data.contact?.tax_invoice_email} />
            </Section>

            {data.biz && (
              <Section>
                <SectionTitle>{t('panel.biz') as string}</SectionTitle>
                <Row label={t('panel.bizName') as string} value={data.biz.name} />
                <Row label={t('panel.bizCeo') as string} value={data.biz.ceo} />
                <Row label={t('panel.bizTaxId') as string} value={data.biz.tax_id} />
                <Row label={t('panel.bizAddress') as string} value={data.biz.address} />
              </Section>
            )}

            <Section>
              <SectionTitle>{t('panel.linked') as string}</SectionTitle>
              <Row label={t('panel.conversations') as string} value={String(data.channels?.conversations ?? 0)} />
              <Row label={t('panel.emailThreads') as string} value={String(data.channels?.email_threads ?? 0)} />
              {data.projects?.length > 0 && (
                <ProjList>
                  {data.projects.map((p) => (
                    <ProjItem key={p.id} type="button" onClick={() => navigate(`/projects/${p.id}`)}>{p.name}</ProjItem>
                  ))}
                </ProjList>
              )}
            </Section>

            {/* ★ 관리(초대·보관·삭제·한도)는 여기 없다 — 설정 > 고객/파트너의 몫이다. */}
          </>
        )}
      </DetailDrawer.Body>

      <DetailDrawer.Footer>
        {/* 계약 성사/불발만 둔다. 프로젝트·청구는 받는 화면이 고객 지정을 아직 안 읽어
            지금 버튼을 달면 눌러도 고객이 안 실린 빈 화면으로 간다(죽은 링크). 받는 쪽을 만든 뒤 붙인다. */}
        <ActionButton tone="secondary" size="md" disabled={busy || !data}
          data-testid="client-panel-lost" onClick={() => changeStage('lost')}>
          {t('action.markLost') as string}
        </ActionButton>
        <ActionButton tone="primary" size="md" disabled={busy || !data}
          data-testid="client-panel-won" onClick={() => changeStage('won')}>
          {t('action.markWon') as string}
        </ActionButton>
      </DetailDrawer.Footer>
    </DetailDrawer>
  );
};

const Row: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  value ? <FieldRow><FieldLabel>{label}</FieldLabel><FieldValue>{value}</FieldValue></FieldRow> : null
);

export default ClientPanel;

const HeadRow = styled.div`display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;`;
const HeadName = styled.div`
  font-size: 0.9375rem; font-weight: 700; color: #0F172A;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;
`;
const IconBtn = styled.button`
  width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFFFFF; color: #475569;
  cursor: pointer; flex-shrink: 0;
  &:hover { background: #F8FAFC; }
`;
const Top = styled.div`display: flex; align-items: center; gap: 12px; padding: 4px 0 16px;`;
const TopText = styled.div`min-width: 0;`;
const TopName = styled.div`font-size: 1rem; font-weight: 700; color: #0F172A;`;
const TopSub = styled.div`margin-top: 2px; font-size: 0.8125rem; color: #64748B;`;
const StageTag = styled.span`
  display: inline-block; margin-top: 6px; padding: 3px 8px; border-radius: 999px;
  background: #F0FDFA; color: #0F766E; font-size: 0.75rem; font-weight: 600;
`;
const Section = styled.section`padding: 14px 0; border-top: 1px solid #F1F5F9;`;
const SectionTitle = styled.h3`margin: 0 0 8px; font-size: 0.8125rem; font-weight: 700; color: #475569;`;
const FieldRow = styled.div`display: flex; gap: 10px; padding: 4px 0; font-size: 0.8125rem;`;
const FieldLabel = styled.span`min-width: 92px; color: #94A3B8; flex-shrink: 0;`;
const FieldValue = styled.span`color: #0F172A; word-break: break-all;`;
const ProjList = styled.div`display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;`;
const ProjItem = styled.button`
  padding: 4px 10px; border: 1px solid #E2E8F0; border-radius: 999px; background: #FFFFFF;
  color: #334155; font-size: 0.75rem; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
const Dim = styled.div`padding: 32px 0; text-align: center; color: #94A3B8; font-size: 0.8125rem;`;
