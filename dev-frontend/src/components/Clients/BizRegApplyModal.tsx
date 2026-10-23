// 사업자등록증에서 읽은 값 → 고객 «사업자·증빙 정보» 확인 표. 설계 Fable 2026-10-23 판정 7
//   칸 / 읽은 값 / 지금 값 / 적용 — 빈 칸은 켜 두고, 이미 값이 있고 다르면 꺼 둔다(나란히 보여 준다), 같으면 고를 것 없음.
//   [적용] = PUT /api/clients 한 번(체크된 칸 + is_business) → 등록증 원본을 그 고객 파일로(명함 사진과 같은 규칙).
//   등록증이 정본이지만 기존 값은 사람이 일부러 고친 것일 수 있어 말없이 덮어쓰지 않는다.
import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import ModalActionButton from '../Common/ModalActionButton';
import { putClientFields, saveBizRegFile, type BizRegRead, type BizRegValues, type ClientBilling } from '../../services/sale';
import { mediaPhone } from '../../theme/breakpoints';

const KEYS: (keyof BizRegValues)[] = ['biz_name', 'biz_tax_id', 'biz_ceo', 'biz_type', 'biz_item', 'biz_address'];
const LABEL_KEY: Record<keyof BizRegValues, string> = {
  biz_name: 'billing.bizName', biz_tax_id: 'billing.bizTaxId', biz_ceo: 'billing.bizCeo',
  biz_type: 'billing.bizType', biz_item: 'billing.bizItem', biz_address: 'billing.bizAddress',
};
const norm = (v: string | null | undefined) => String(v || '').replace(/\s+/g, ' ').trim();
const digitsSame = (a: string, b: string) => a.replace(/\D/g, '') === b.replace(/\D/g, '') && a.replace(/\D/g, '').length > 0;

interface Props {
  businessId: number;
  clientId: number;
  billing: ClientBilling;
  read: BizRegRead;
  file: File;
  onClose: () => void;
  onSaved: () => void;
}

export default function BizRegApplyModal({ businessId, clientId, billing, read, file, onClose, onSaved }: Props) {
  const { t } = useTranslation('clients');
  const rows = useMemo(() => KEYS.filter((k) => read.values[k]).map((k) => {
    const got = norm(read.values[k]);
    const cur = norm(billing[k]);
    const same = cur === got || (k === 'biz_tax_id' && digitsSame(cur, got));
    return { k, got, cur, same };
  }), [read, billing]);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.k, !r.cur])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const picked = rows.filter((r) => !r.same && on[r.k]);
  const needBiz = !billing.is_business;

  // autosave-exempt: 액션 버튼 — 확인 표에서 고른 칸을 한 번에 적용한다
  const apply = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    const patch: Record<string, unknown> = Object.fromEntries(picked.map((r) => [r.k, r.got]));
    if (needBiz) patch.is_business = true;
    try {
      await putClientFields(businessId, clientId, patch);
    } catch {
      setErr(t('bizReg.applyFailed') as string); setBusy(false); return;
    }
    try { await saveBizRegFile(businessId, clientId, file); }
    catch { setErr(t('bizReg.fileFailed') as string); setBusy(false); onSaved(); return; }
    setBusy(false);
    onSaved();
    onClose();
  };

  return (
    <StandardModal open onClose={onClose} title={t('bizReg.applyTitle') as string} size="lg"
      footer={<>
        <ModalActionButton onClick={onClose}>{t('contacts.cancel')}</ModalActionButton>
        <ModalActionButton variant="primary" disabled={busy || (!picked.length && !needBiz)} onClick={apply} data-testid="bizreg-apply">
          {t('bizReg.apply', { n: picked.length })}
        </ModalActionButton>
      </>}>
      <Hint>{t('bizReg.applyHint')}</Hint>
      {read.warnings.includes('tax_id_checksum') && <Warn role="status">{t('bizReg.taxIdUnreadable')}</Warn>}
      {err && <Warn role="alert">{err}</Warn>}
      <Table data-testid="bizreg-apply-table">
        <thead><tr>
          <th>{t('bizReg.colField')}</th><th>{t('bizReg.colRead')}</th><th>{t('bizReg.colCurrent')}</th><th>{t('bizReg.colApply')}</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.k} data-testid={`bizreg-row-${r.k}`}>
              <td data-label={t('bizReg.colField') as string}>{t(LABEL_KEY[r.k])}</td>
              <td data-label={t('bizReg.colRead') as string}><Strong>{r.got}</Strong></td>
              <td data-label={t('bizReg.colCurrent') as string}>{r.cur || <Empty>{t('bizReg.empty')}</Empty>}</td>
              <td data-label={t('bizReg.colApply') as string}>
                {r.same ? <Same>{t('bizReg.same')}</Same> : (
                  <label>
                    <input type="checkbox" checked={!!on[r.k]} onChange={(e) => setOn((o) => ({ ...o, [r.k]: e.target.checked }))}
                      data-testid={`bizreg-check-${r.k}`} />
                    {' '}{r.cur ? t('bizReg.replace') : t('bizReg.fill')}
                  </label>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Hint>{t('bizReg.fileNote')}</Hint>
    </StandardModal>
  );
}

const Hint = styled.p`margin: 0; font-size: 0.8125rem; color: #64748B; line-height: 1.5;`;
const Warn = styled.p`margin: 0; font-size: 0.8125rem; color: #B45309; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 8px 10px;`;
const Strong = styled.span`color: #0F172A; font-weight: 600; word-break: break-word;`;
const Empty = styled.span`color: #94A3B8;`;
const Same = styled.span`color: #94A3B8; font-size: 0.75rem;`;
const Table = styled.table`
  width: 100%; border-collapse: collapse; font-size: 0.8125rem; color: #334155;
  th { text-align: left; font-weight: 600; color: #64748B; font-size: 0.75rem; padding: 6px 8px; border-bottom: 1px solid #E2E8F0; }
  td { padding: 8px; border-bottom: 1px solid #F1F5F9; vertical-align: top; word-break: break-word; }
  td:first-child { white-space: nowrap; color: #64748B; }
  td:last-child { white-space: nowrap; }
  label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  input[type='checkbox'] { accent-color: #14B8A6; }
  ${mediaPhone} {
    thead { display: none; }
    tr { display: block; padding: 8px 0; border-bottom: 1px solid #E2E8F0; }
    td { display: flex; gap: 8px; border: 0; padding: 3px 0; }
    td::before { content: attr(data-label); flex: 0 0 64px; color: #94A3B8; font-size: 0.75rem; }
    td:first-child { font-weight: 600; color: #0F172A; }
    td:first-child::before { display: none; }
  }
`;
