// 청구서 상세 — 입금 코드(`0009퍼플히어`)의 번호 뒤 이름 바꾸기 (2026-10-23).
//   Irene: «회사이름이 있으면 회사이름 … 번호 뒤에 직접 입금자명 표시를 바꾸고 싶으면 클릭해서 바꾸게.
//   사장이 자기 이름 꼭 넣어서 경리직원에게 돈을 보내라고 시키게 만드는 일 같은 거» 가 없게.
//   번호(식별)는 고정 · 이름만 이 청구서에서 바꾼다. 빈 값 = 자동(회사 이름 → 사람 이름).
//   코드 계산은 서버 receiptsDue.payerCodeOf 한 곳 — 저장 뒤 받은 payer_code 를 그대로 그린다(메일·공개 페이지와 같은 값).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import AutoSaveField from '../../components/Common/AutoSaveField';
import { setPayerLabel, type ApiInvoice } from '../../services/invoices';
import { payerCodeOf } from './invoiceCaps';

interface Props {
  invoice: ApiInvoice;
  fallbackName: string;        // 서버 payer_code 가 아직 없을 때만(목록 행으로 먼저 그릴 때)
  canEdit: boolean;            // 워크스페이스 멤버(qbill 쓰기) — 서버 requireMenu('qbill','write') 와 같은 선
  onSaved: (payerCode: string, label: string | null) => void;
}

const LABEL_MAX = 20;   // 서버 receiptsDue.PAYER_LABEL_MAX 와 같다

export default function PayerCodeEditor({ invoice, fallbackName, canEdit, onSaved }: Props) {
  const { t } = useTranslation('qbill');
  const code = payerCodeOf(invoice, fallbackName);
  const head = /^[\d-]+/.exec(code)?.[0] || '';
  const name = code.slice(head.length);
  const custom = invoice.meta?.payer_label || '';
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(custom || name);
  const editable = canEdit && invoice.status !== 'canceled';

  const save = async (next: string) => {
    const r = await setPayerLabel(invoice.business_id, invoice.id, next.trim());
    onSaved(r.payer_code, r.payer_label);
  };

  if (!editable) return <Code data-testid="invoice-payer-code">{code}</Code>;

  if (!editing) {
    return (
      <Row>
        <Code data-testid="invoice-payer-code">
          {head}
          <NameBtn
            type="button"
            onClick={() => { setVal(custom || name); setEditing(true); }}
            title={t('detail.bank.payerEditHint', { defaultValue: '번호 뒤 이름을 눌러 바꿀 수 있습니다' }) as string}
            data-testid="invoice-payer-name-edit"
          >
            {name || t('detail.bank.payerNameEmpty', { defaultValue: '이름 넣기' })}
          </NameBtn>
        </Code>
        {custom && (
          // autosave-exempt: 액션 버튼(자동 이름으로 되돌리기 — 누르는 것이 곧 결과)
          <ResetBtn type="button" onClick={() => { void save(''); }} data-testid="invoice-payer-name-reset">
            {t('detail.bank.payerReset', { defaultValue: '자동으로' })}
          </ResetBtn>
        )}
      </Row>
    );
  }

  return (
    <Row>
      <Head>{head}</Head>
      <AutoSaveField type="input" onSave={() => save(val)}>
        <Input
          autoFocus value={val} maxLength={LABEL_MAX} autoComplete="off"
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder={t('detail.bank.payerNamePlaceholder', { defaultValue: '비우면 회사 이름' }) as string}
          aria-label={t('detail.bank.payerNameLabel', { defaultValue: '입금자명 번호 뒤 이름' }) as string}
          data-testid="invoice-payer-name-input"
        />
      </AutoSaveField>
    </Row>
  );
}

const Row = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0;
`;
const Code = styled.code`
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem; color: #0F172A; font-weight: 600;
  background: #fff; padding: 4px 8px; border-radius: 4px;
  border: 1px solid #FDE68A; word-break: break-all;
`;
const Head = styled(Code)``;
const NameBtn = styled.button`
  font: inherit; color: inherit; background: none; border: none; padding: 0; margin: 0;
  cursor: pointer; border-bottom: 1px dashed #D97706;
  &:hover { color: #B45309; }
  &:focus-visible { outline: 2px solid #F59E0B; outline-offset: 2px; }
`;
const ResetBtn = styled.button`
  font-size: 0.6875rem; color: #92400E; background: none; border: none; padding: 4px 2px;
  cursor: pointer; text-decoration: underline;
`;
const Input = styled.input`
  height: 30px; width: 180px; max-width: 100%; box-sizing: border-box;
  padding: 0 8px; border: 1px solid #F59E0B; border-radius: 4px;
  font-size: 0.8125rem; color: #0F172A; background: #fff;
  &:focus { outline: none; box-shadow: 0 0 0 2px #FDE68A; }
`;
