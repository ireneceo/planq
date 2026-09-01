// pages/QNote/AudioUploadModal.tsx — 녹음 파일 올려 텍스트로 (#383, 2026-08-30)
//
// Irene: "음성노트에 녹음파일을 올리면 텍스트로 바꿔줘서 만들어줄 수도 있어?"
//
// 서버는 접수 즉시 session_id 를 주고 STT 는 백그라운드로 돈다. 그래서 이 모달은
// **기다리지 않는다** — 올리면 닫히고, 목록의 그 노트가 "처리 중" 으로 서 있다가 완성된다.
// (2시간짜리 파일을 모달을 띄운 채 붙잡아 두는 것은 오답이다)
import { useCallback, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { AUDIO_UPLOAD_EXT, AUDIO_UPLOAD_MAX_BYTES, uploadAudioForStt } from '../../services/qnote';
import { CONTROL } from '../../theme/tokens';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';

type Props = {
  open: boolean;
  businessId: number;
  onClose: () => void;
  onUploaded: (sessionId: number) => void;
};

const ACCEPT = AUDIO_UPLOAD_EXT.map((e) => `.${e}`).join(',');

export default function AudioUploadModal({ open, businessId, onClose, onUploaded }: Props) {
  const { t } = useTranslation('qnote');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useBodyScrollLock(open);
  useEscapeStack(open && !busy, onClose);
  useFocusTrap(ref, open);

  const pick = useCallback((f: File | null) => {
    setError(null);
    if (!f) { setFile(null); return; }
    const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '';
    if (!(AUDIO_UPLOAD_EXT as readonly string[]).includes(ext)) {
      setError(t('audioUpload.errUnsupported', { list: AUDIO_UPLOAD_EXT.join(', ') }) as string);
      setFile(null); return;
    }
    if (f.size > AUDIO_UPLOAD_MAX_BYTES) {
      setError(t('audioUpload.errTooBig', { mb: Math.floor(AUDIO_UPLOAD_MAX_BYTES / 1024 / 1024) }) as string);
      setFile(null); return;
    }
    setFile(f);
  }, [t]);

  const submit = async () => {
    if (!file || busy) return;               // 중복 제출 가드
    setBusy(true); setError(null);
    try {
      const r = await uploadAudioForStt(file, businessId);
      onUploaded(r.session_id);
      setFile(null);
      onClose();
    } catch (e) {
      // 서버가 준 이유를 그대로 보여준다 — "실패했습니다" 로 뭉개면 사용자가 다음 행동을 못 정한다.
      const msg = (e as Error).message || '';
      const status = (e as Error & { status?: number }).status;
      if (status === 429) setError(t('audioUpload.errRateLimited') as string);
      else if (status === 409) setError(t('audioUpload.errBusy') as string);
      else if (status === 402) setError(t('audioUpload.errQuota') as string);
      else if (status === 503) setError(t('audioUpload.errUnavailable') as string);
      else if (/duration/.test(msg)) setError(t('audioUpload.errCorrupt') as string);
      else if (/too long/.test(msg)) setError(t('audioUpload.errTooLong') as string);
      else setError(msg || (t('audioUpload.errGeneric') as string));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Backdrop onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <Panel ref={ref} role="dialog" aria-modal="true" aria-label={t('audioUpload.title') as string}>
        <ModalHead>
          <H>{t('audioUpload.title')}</H>
          <CloseBtn type="button" onClick={onClose} disabled={busy} aria-label={t('audioUpload.close') as string}>×</CloseBtn>
        </ModalHead>

        <Body>
          <Desc>{t('audioUpload.desc')}</Desc>

          <Drop
            $on={dragging}
            $has={!!file}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0] || null); }}
            onClick={() => inputRef.current?.click()}
            data-testid="qnote-upload-drop"
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => pick(e.target.files?.[0] || null)}
            />
            {file ? (
              <>
                <FileName>{file.name}</FileName>
                <FileMeta>{(file.size / 1024 / 1024).toFixed(1)} MB</FileMeta>
              </>
            ) : (
              <>
                <DropTitle>{t('audioUpload.dropTitle')}</DropTitle>
                <DropHint>{t('audioUpload.dropHint', { list: AUDIO_UPLOAD_EXT.join(' · ') })}</DropHint>
              </>
            )}
          </Drop>

          {error && <ErrorMsg role="alert">{error}</ErrorMsg>}
          <Note>{t('audioUpload.note')}</Note>
        </Body>

        <Footer>
          <GhostBtn type="button" onClick={onClose} disabled={busy}>{t('audioUpload.cancel')}</GhostBtn>
          <PrimaryBtn type="button" onClick={submit} disabled={!file || busy} data-testid="qnote-upload-submit">
            {busy ? t('audioUpload.uploading') : t('audioUpload.submit')}
          </PrimaryBtn>
        </Footer>
      </Panel>
    </Backdrop>
  );
}

const Backdrop = styled.div`
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
`;
const Panel = styled.div`
  width: min(460px, 100%); max-height: 90vh; overflow: auto;
  background: #fff; border-radius: 14px;
  box-shadow: 0 20px 60px rgba(15,23,42,0.24);
  display: flex; flex-direction: column;
  @media (max-width: 640px) { width: 100%; border-radius: 12px; padding-bottom: var(--pq-safe-bottom, 0px); }
`;
const ModalHead = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px 8px;
`;
const H = styled.h2`font-size: 1rem; font-weight: 700; color: #0F172A; margin: 0;`;
const CloseBtn = styled.button`
  width: ${CONTROL.sm}px; height: ${CONTROL.sm}px; border: none; background: none; cursor: pointer;
  font-size: 1.25rem; color: #64748B; border-radius: 8px;
  &:hover:not(:disabled) { background: #F1F5F9; }
  &:disabled { opacity: .4; cursor: not-allowed; }
`;
const Body = styled.div`padding: 4px 18px 8px; display: flex; flex-direction: column; gap: 12px;`;
const Desc = styled.p`font-size: 0.8125rem; color: #475569; margin: 0; line-height: 1.6;`;
const Drop = styled.div<{ $on: boolean; $has: boolean }>`
  border: 1.5px dashed ${p => (p.$on ? '#14B8A6' : p.$has ? '#14B8A6' : '#CBD5E1')};
  background: ${p => (p.$on || p.$has ? '#F0FDFA' : '#F8FAFC')};
  border-radius: 12px; padding: 24px 16px; text-align: center; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  min-height: 108px; justify-content: center;
  &:hover { border-color: #14B8A6; }
`;
const DropTitle = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A;`;
const DropHint = styled.div`font-size: 0.75rem; color: #94A3B8; line-height: 1.5;`;
const FileName = styled.div`font-size: 0.875rem; font-weight: 600; color: #0F172A; word-break: break-all;`;
const FileMeta = styled.div`font-size: 0.75rem; color: #64748B;`;
const ErrorMsg = styled.div`
  font-size: 0.75rem; color: #B91C1C; background: #FEF2F2;
  border: 1px solid #FECACA; border-radius: 8px; padding: 8px 10px; line-height: 1.5;
`;
const Note = styled.div`font-size: 0.6875rem; color: #94A3B8; line-height: 1.6;`;
const Footer = styled.div`
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px 18px;
`;
const GhostBtn = styled.button`
  height: ${CONTROL.md}px; padding: 0 16px; border-radius: 8px; cursor: pointer;
  background: #fff; border: 1px solid #E2E8F0; color: #475569;
  font-size: 0.8125rem; font-weight: 600;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: .5; cursor: not-allowed; }
`;
const PrimaryBtn = styled.button`
  height: ${CONTROL.md}px; padding: 0 18px; border-radius: 8px; cursor: pointer;
  background: #14B8A6; border: 1px solid #14B8A6; color: #fff;
  font-size: 0.8125rem; font-weight: 700;
  &:hover:not(:disabled) { background: #0F9C8D; }
  &:disabled { opacity: .5; cursor: not-allowed; }
`;
