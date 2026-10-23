// [사업자등록증으로 채우기] — 등록증 사진·PDF 를 AI 가 읽어 사업자 칸을 채운다. 설계 Fable 2026-10-23(.claude/plans/qmvkq7v2c.md)
//   저장하지 않는다 — 읽은 값은 부르는 쪽(고객 정보 확인 표 · 청구서 발행 창 빈 칸)으로만 가고 사람이 보고 저장한다.
//   동의창·실패 문구는 명함 사진 읽기(CardPhotoButton)와 같은 계약 — 동의 키도 하나(같은 OpenAI 국외 이전).
//   명함 버튼은 Q sale 머리줄의 카메라 아이콘이고 이것은 폼 안의 글자 버튼이라 껍데기만 따로 둔다.
import React, { useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../Common/ConfirmDialog';
import { useAuth } from '../../contexts/AuthContext';
import { readBizReg, type BizRegRead } from '../../services/sale';
import { hasConsent, rememberConsent } from './CardPhotoButton';

interface Props {
  businessId: number;
  /** 'sale' = 고객 정보(qsale 쓰기) · 'invoice' = 청구서 발행 창(qbill 쓰기) */
  door: 'sale' | 'invoice';
  /** 읽은 결과(못 읽었으면 null + 이유 문구) + 원본 파일 */
  onRead: (r: BizRegRead | null, file: File, error: string | null) => void;
  testId?: string;
}

const KNOWN = ['usage_limit', 'ai_unavailable', 'image_unreadable', 'image_required', 'pdf_unsupported', 'file_too_large'];

const BizRegReadButton: React.FC<Props> = ({ businessId, door, onRead, testId = 'bizreg-read' }) => {
  const { t } = useTranslation('clients');
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = () => {
    if (busy) return;
    if (hasConsent(user?.id)) inputRef.current?.click();
    else setAsk(true);
  };
  const read = async (file: File) => {
    setBusy(true);
    try {
      const r = await readBizReg(businessId, file, door);
      onRead(r, file, r.found ? null : t('bizReg.notFound') as string);
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      onRead(null, file, t(`bizReg.errors.${KNOWN.includes(code) ? code : 'generic'}`) as string);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Btn type="button" onClick={start} disabled={busy} aria-busy={busy} data-testid={testId}>
        {busy ? <Spinner aria-hidden /> : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" />
          </svg>
        )}
        <span>{busy ? t('bizReg.reading') : t('bizReg.button')}</span>
      </Btn>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" hidden data-testid={`${testId}-input`}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f); }} />
      <ConfirmDialog isOpen={ask} onClose={() => setAsk(false)}
        title={t('bizReg.consentTitle')} message={t('bizReg.consentMsg')}
        confirmText={t('cardPhoto.consentOk') as string} cancelText={t('contacts.cancel') as string}
        onConfirm={() => { setAsk(false); rememberConsent(user?.id); inputRef.current?.click(); }} />
    </>
  );
};
export default BizRegReadButton;

const Btn = styled.button`
  height: 32px; padding: 0 12px; flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFFFFF; color: #475569;
  font-size: 0.8125rem; font-weight: 500; cursor: pointer; white-space: nowrap;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; }
  &:disabled { cursor: progress; }
`;
const Spinner = styled.span`
  width: 14px; aspect-ratio: 1; border-radius: 50%; border: 2px solid #CBD5E1; border-top-color: #14B8A6;
  animation: brspin 0.8s linear infinite; @keyframes brspin { to { transform: rotate(360deg); } }
`;
