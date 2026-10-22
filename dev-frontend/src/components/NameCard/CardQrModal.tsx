// 명함 링크·QR — 명함마다 다른 QR(이 명함의 /c/<토큰>). 라이브러리는 동적 import(AppQrCode 와 같은 방식).
//   내 명함(MyCardsPage)과 동료 명함 창(NameCardViewDrawer — v3 결정 4)이 같은 창을 쓴다. 필요한 것은 주소·이름·열림 여부뿐.
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';

export interface QrTarget { url: string; label: string; link_open?: boolean }
interface Props<T extends QrTarget> { card: T | null; onClose: () => void; onCopy: (c: T) => void; copied: boolean }

function CardQrModal<T extends QrTarget>({ card, onClose, onCopy, copied }: Props<T>) {
  const { t } = useTranslation('cards');
  const [src, setSrc] = useState<string | null>(null);
  const url = card?.url || '';

  useEffect(() => {
    setSrc(null);
    if (!url) return undefined;
    let alive = true;
    import('qrcode')
      .then((m) => m.toDataURL(url, { margin: 2, width: 1024, errorCorrectionLevel: 'M' }))
      .then((d) => { if (alive) setSrc(d); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [url]);

  const download = () => {
    if (!src || !card) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = `${(card.label || 'card').replace(/[\\/:*?"<>|]+/g, '')}-QR.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <StandardModal open={!!card} onClose={onClose} title={t('qr.title')} size="sm"
      footer={card ? (
        <>
          <ActionButton tone="secondary" size="md" onClick={() => onCopy(card)} data-testid="qr-copy">
            {copied ? t('card.linkCopied') : t('qr.copy')}
          </ActionButton>
          <ActionButton tone="primary" size="md" onClick={download} disabled={!src} data-testid="qr-download">{t('qr.download')}</ActionButton>
        </>
      ) : null}>
      {card && (
        <Body>
          {src ? <QrImg src={src} alt={url} data-testid="card-qr" data-qr-url={url} /> : <QrHolder aria-busy="true" />}
          <Url data-testid="qr-url">{url}</Url>
          <Hint>{t('qr.hint')}</Hint>
          {card.link_open === false && <Warn>{t('qr.closedWarn')}</Warn>}
        </Body>
      )}
    </StandardModal>
  );
}
export default CardQrModal;

const Body = styled.div`display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;`;
const QrImg = styled.img`width: 220px; height: 220px; max-width: 100%; border-radius: 8px; border: 1px solid #E2E8F0; background: #FFFFFF;`;
const QrHolder = styled.div`width: 220px; height: 220px; border-radius: 8px; background: #F1F5F9;`;
const Url = styled.div`font-size: 0.8125rem; color: #0F172A; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;`;
const Hint = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Warn = styled.div`padding: 8px 12px; border-radius: 8px; background: #FFFBEB; border: 1px solid #FDE68A; color: #B45309; font-size: 0.8125rem;`;
