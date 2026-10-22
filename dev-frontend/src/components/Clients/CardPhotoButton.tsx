// Q sale [명함 사진] — 종이 명함을 찍거나 사진을 고르면 AI 가 칸을 읽어 «고객 추가» 를 채운다.
//   설계 docs/NAME_CARD_V3_STRATEGY.md 9절 결정 3. 저장하지 않는다 — 읽은 값은 폼으로만 가고 사람이 확인해 저장한다.
//   ★ 사진은 글자를 읽기 위해 OpenAI(미국)로 간다 — 처음 쓸 때 한 번 확인창(사람마다 한 번, 이 기기에 기억).
//   실패는 이유를 말한다(한도·AI 없음·사진 못 읽음). AI 가 없어도 «직접 입력» 으로 이어진다(부르는 쪽이 빈 폼을 연다).
import React, { useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../Common/ConfirmDialog';
import { useAuth } from '../../contexts/AuthContext';
import { readCardPhoto, type CardPhotoRead } from '../../services/sale';

interface Props {
  businessId: number;
  /** 읽은 결과(또는 못 읽었을 때 null 값) + 원본 파일 — 저장 뒤 고객 파일로 남길 때 다시 올린다 */
  onRead: (r: CardPhotoRead | null, file: File, error: string | null) => void;
}

const consentKey = (uid: number | string | undefined) => `planq:card-read-consent:${uid ?? 'anon'}`;
function hasConsent(uid: number | string | undefined) { try { return localStorage.getItem(consentKey(uid)) === '1'; } catch { return false; } }
function rememberConsent(uid: number | string | undefined) { try { localStorage.setItem(consentKey(uid), '1'); } catch { /* 기억 못 하면 다음에 다시 묻는다 */ } }

const KNOWN = ['usage_limit', 'ai_unavailable', 'image_unreadable', 'image_required'];

const CardPhotoButton: React.FC<Props> = ({ businessId, onRead }) => {
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
    try { onRead(await readCardPhoto(businessId, file), file, null); }
    catch (e) {
      const code = e instanceof Error ? e.message : '';
      onRead(null, file, t(`cardPhoto.errors.${KNOWN.includes(code) ? code : 'generic'}`) as string);
    } finally { setBusy(false); }
  };

  return (
    <>
      <IconBtn type="button" onClick={start} disabled={busy} aria-busy={busy} data-testid="sale-card-photo"
        title={t('cardPhoto.button') as string} aria-label={t('cardPhoto.button') as string}>
        {busy ? <Spinner aria-hidden /> : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
          </svg>
        )}
      </IconBtn>
      <input ref={inputRef} type="file" accept="image/*" hidden data-testid="sale-card-photo-input"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f); }} />
      <ConfirmDialog isOpen={ask} onClose={() => setAsk(false)}
        title={t('cardPhoto.consentTitle')} message={t('cardPhoto.consentMsg')}
        confirmText={t('cardPhoto.consentOk') as string} cancelText={t('contacts.cancel') as string}
        onConfirm={() => { setAsk(false); rememberConsent(user?.id); inputRef.current?.click(); }} />
    </>
  );
};
export default CardPhotoButton;

const IconBtn = styled.button`
  width: 36px; height: 36px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFFFFF; color: #475569; cursor: pointer;
  &:hover:not(:disabled) { border-color: #14B8A6; color: #0F766E; }
  &:disabled { cursor: progress; }
`;
const Spinner = styled.span`
  width: 16px; aspect-ratio: 1; border-radius: 50%; border: 2px solid #CBD5E1; border-top-color: #14B8A6;
  animation: cpspin 0.8s linear infinite; @keyframes cpspin { to { transform: rotate(360deg); } }
`;
