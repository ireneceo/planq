// PageLinkDialog — «우리 페이지» 작은 창: 주소 복사 · QR · 열어 보기 · 꾸미기 → (2026-11-20)
//
//   설계: docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §7 ② «링크를 바로 아는 자리 3곳» — ⓑ Q sale 머리 · ⓒ 워크스페이스 이름 메뉴.
//   Irene: «어디에서 링크 바로 알게. 그리고 그거 고객들에게 주게.»
// ★ 데이터는 설정 탭과 같은 문(GET /api/businesses/:id/customer-entry — 멤버 이상). 주소를 여기서 만들지 않는다
//   (발급·교체는 오너가 설정 탭에서 — 교체하면 이미 나간 명함 링크가 죽는 무게라 한 곳에 둔다).
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { navigateTab } from '../../hooks/useChromeNav';
import { apiFetch } from '../../contexts/AuthContext';
import StandardModal from '../Common/StandardModal';

type Props = { open: boolean; onClose: () => void; businessId: number };

export default function PageLinkDialog({ open, onClose, businessId }: Props) {
  const { t } = useTranslation('settings');
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | 'url' | 'sig'>(null);

  useEffect(() => {
    if (!open || !businessId) return;
    let alive = true;
    setLoaded(false); setErr(false);
    (async () => {
      try {
        const r = await apiFetch(`/api/businesses/${businessId}/customer-entry`);
        const j = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok || !j?.success) { setErr(true); return; }
        setUrl(j.data?.link?.url || null);
      } catch { if (alive) setErr(true); }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, [open, businessId]);

  useEffect(() => {
    if (!url) { setQr(null); return; }
    let alive = true;
    import('qrcode').then((m) => m.toDataURL(url, { margin: 1, width: 180 }))
      .then((d) => { if (alive) setQr(d); }).catch(() => { if (alive) setQr(null); });
    return () => { alive = false; };
  }, [url]);

  const copy = async (text: string, which: 'url' | 'sig') => {
    try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(null), 1600); }
    catch { /* 주소는 화면에 그대로 보인다 */ }
  };
  // 사이드바(크롬)에서도 열리게 — 활성 탭 이동
  const goSettings = () => { onClose(); navigateTab('/business/settings/public-page'); };
  const sigLine = url ? `${t('entry.sigPrefix', '문의·상담 예약')}: ${url}` : '';

  return (
    <StandardModal open={open} onClose={onClose} size="sm" title={t('wspage.dialogTitle', '우리 페이지') as string}>
      <Body data-testid="wspage-link-dialog">
        {!loaded ? <Muted>{t('entry.loading', '불러오는 중…')}</Muted>
          : err ? <Muted>{t('wspage.loadErr', '공개 페이지 설정을 불러오지 못했습니다.')}</Muted>
          : url ? (
            <>
              <Muted>{t('wspage.dialogDesc', '고객에게 이 링크를 주세요. 회사 소개·서비스를 보고 바로 문의·상담 예약을 남길 수 있어요.')}</Muted>
              <Url data-testid="wspage-link-url" title={url}>{url}</Url>
              <Row>
                <Btn type="button" $primary onClick={() => copy(url, 'url')} data-testid="wspage-link-copy">
                  {copied === 'url' ? t('entry.copied', '복사됨') : t('entry.copy', '복사')}
                </Btn>
                <Btn type="button" onClick={() => copy(sigLine, 'sig')} data-testid="wspage-link-copy-sig">
                  {copied === 'sig' ? t('entry.copied', '복사됨') : t('entry.copySignature', '메일 서명 한 줄 복사')}
                </Btn>
                <Btn type="button" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')} data-testid="wspage-link-open">
                  {t('wspage.open', '열어 보기')}
                </Btn>
              </Row>
              {qr && <Qr src={qr} alt={t('entry.qrAlt', '창구 주소 QR 코드') as string} width={180} height={180} data-testid="wspage-link-qr" />}
              <LinkBtn type="button" onClick={goSettings} data-testid="wspage-link-settings">{t('wspage.decorate', '페이지 꾸미기 →')}</LinkBtn>
            </>
          ) : (
            <>
              <Muted>{t('wspage.noLink', '아직 우리 페이지 주소가 없어요. 대표가 «공개 페이지» 에서 만들 수 있어요.')}</Muted>
              <Btn type="button" $primary onClick={goSettings} data-testid="wspage-link-create">{t('wspage.makePage', '페이지 만들기 →')}</Btn>
            </>
          )}
      </Body>
    </StandardModal>
  );
}

const Body = styled.div`display:flex;flex-direction:column;gap:12px;align-items:flex-start;`;
const Muted = styled.div`font-size:0.8125rem;color:#64748b;line-height:1.5;`;
const Url = styled.div`
  width:100%;box-sizing:border-box;padding:0 12px;height:36px;display:flex;align-items:center;
  background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;
  font-size:0.8125rem;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
`;
const Row = styled.div`display:flex;flex-wrap:wrap;gap:6px;`;
const Btn = styled.button<{ $primary?: boolean }>`
  height:36px;padding:0 12px;border-radius:8px;cursor:pointer;white-space:nowrap;font-size:0.8125rem;font-weight:600;
  border:1px solid ${p => (p.$primary ? '#14B8A6' : '#cbd5e1')};
  background:${p => (p.$primary ? '#14B8A6' : '#fff')};color:${p => (p.$primary ? '#fff' : '#334155')};
  &:hover{border-color:#14B8A6;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
  @media (max-width:640px){ height:40px; }
`;
const Qr = styled.img`width:180px;height:180px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;`;
const LinkBtn = styled.button`
  border:none;background:none;padding:0;cursor:pointer;color:#0D9488;font-size:0.8125rem;font-weight:600;
  &:hover{text-decoration:underline;}
`;
