// 청구서 상세 — «카드 결제 링크» 칸 (2026-10-15).
//   국내 결제 대행사(토스페이먼츠 링크페이·페이앱 등)에서 만든 링크를 단일 청구서 또는 분할 회차에 건다.
//   고객용 청구서 화면에 «카드로 결제» 버튼이 생긴다. 결제 결과는 PlanQ 로 오지 않는다 — 확정은 «결제 완료» 표시.
//   검증(https + 결제 대행사 도메인)은 서버 services/cardPayLink 한 곳 — 화면은 서버 거절 사유를 그대로 보여 줄 뿐이다.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { setCardPayLink, type ApiInvoice, type ApiInstallment } from '../../services/invoices';

interface Props {
  invoice: ApiInvoice;
  installments: ApiInstallment[];
  canEdit: boolean;            // owner·platform_admin (서버 assertInvoiceMutationOwner 와 같은 선)
  onSaved: () => void;         // 저장 뒤 상세를 다시 읽는다
}

const ERROR_KEYS: Record<string, string> = {
  card_pay_url_domain_not_allowed: 'detail.cardLink.errDomain',
  card_pay_url_https_only: 'detail.cardLink.errHttps',
  card_pay_url_invalid_url: 'detail.cardLink.errInvalid',
  card_pay_url_too_long: 'detail.cardLink.errLong',
};

function LinkRow({ invoice, installment, canEdit, onSaved }: {
  invoice: ApiInvoice; installment: ApiInstallment | null; canEdit: boolean; onSaved: () => void;
}) {
  const { t } = useTranslation('qbill');
  const saved = (installment ? installment.card_pay_url : invoice.card_pay_url) || '';
  const [val, setVal] = useState(saved);
  const [err, setErr] = useState<string | null>(null);
  const closed = installment
    ? installment.status === 'paid' || installment.status === 'canceled'
    : invoice.status === 'paid' || invoice.status === 'canceled';

  const save = async () => {
    if (val.trim() === saved) return;
    setErr(null);
    try {
      await setCardPayLink(invoice.business_id, invoice.id, val.trim(), installment ? installment.id : null);
      onSaved();
    } catch (e) {
      const code = (e as Error).message;
      // 보안 미들웨어(SSRF 방어)가 http·내부 주소를 라우트 전에 «Invalid URL parameter» 로 먼저 거절한다
      const key = ERROR_KEYS[code] || (/Invalid URL/i.test(code) ? 'detail.cardLink.errHttps' : 'detail.cardLink.errSave');
      setErr(t(key, { defaultValue: '저장하지 못했습니다. 주소를 확인해 주세요.' }) as string);
      throw e;   // AutoSaveField 가 ! 배지를 띄운다
    }
  };

  if (!canEdit || closed) {
    if (!saved) return null;
    return (
      <Row>
        {installment && <RowLabel>{installment.label}</RowLabel>}
        <LinkText href={saved} target="_blank" rel="noopener noreferrer">{saved}</LinkText>
      </Row>
    );
  }
  return (
    <Row>
      {installment && <RowLabel>{installment.label}</RowLabel>}
      <AutoSaveField type="input" onSave={save}>
        <Input
          type="url" inputMode="url" value={val} autoComplete="off"
          onChange={(e) => setVal(e.target.value)}
          placeholder={t('detail.cardLink.placeholder', { defaultValue: 'https://… (결제 대행사에서 만든 결제 링크)' }) as string}
          data-testid={installment ? `invoice-card-link-${installment.id}` : 'invoice-card-link'}
        />
      </AutoSaveField>
      {err && <Err role="alert">{err}</Err>}
    </Row>
  );
}

// 칸을 보일지 — 드로어가 빈 섹션 상자를 남기지 않게 같은 판정을 밖에서도 쓴다.
export function cardPayLinkVisible(invoice: ApiInvoice, installments: ApiInstallment[], canEdit: boolean): boolean {
  const isSplit = invoice.installment_mode === 'split';
  const anyLink = isSplit ? installments.some((i) => i.card_pay_url) : !!invoice.card_pay_url;
  if (anyLink) return true;
  // 초안·취소는 고객 화면이 없다(공개 링크가 열리지 않는다) — 발행 뒤에 건다. 결제 완료면 걸 일이 없다.
  return canEdit && !['draft', 'canceled', 'paid'].includes(invoice.status);
}

export default function CardPayLinkSection({ invoice, installments, canEdit, onSaved }: Props) {
  const { t } = useTranslation('qbill');
  const isSplit = invoice.installment_mode === 'split';
  if (!cardPayLinkVisible(invoice, installments, canEdit)) return null;
  return (
    <Wrap data-testid="invoice-card-link-section">
      <Title>{t('detail.cardLink.title', { defaultValue: '카드 결제 링크' })}</Title>
      <Desc>{t('detail.cardLink.desc', { defaultValue: '토스페이먼츠 링크페이·페이앱 등에서 이 금액으로 만든 결제 링크를 붙여 넣으면 고객용 청구서 화면에 «카드로 결제» 버튼이 생깁니다. 결제가 들어오면 «결제 완료» 를 직접 표시해 주세요.' })}</Desc>
      {isSplit
        ? installments.map((ins) => (
          <LinkRow key={ins.id} invoice={invoice} installment={ins} canEdit={canEdit} onSaved={onSaved} />
        ))
        : <LinkRow invoice={invoice} installment={null} canEdit={canEdit} onSaved={onSaved} />}
    </Wrap>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Title = styled.h4`margin: 0; font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const Desc = styled.p`margin: 0; font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Row = styled.div`display: flex; flex-direction: column; gap: 4px; min-width: 0;`;
const RowLabel = styled.span`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const Input = styled.input`
  width: 100%; box-sizing: border-box; height: 36px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.8125rem; color: #0F172A; background: #fff;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.15); }
`;
const LinkText = styled.a`
  font-size: 0.8125rem; color: #0F766E; word-break: break-all; text-decoration: underline;
`;
const Err = styled.span`font-size: 0.75rem; color: #DC2626;`;
