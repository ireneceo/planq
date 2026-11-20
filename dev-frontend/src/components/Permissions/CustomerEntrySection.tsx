// CustomerEntrySection — 설정 › 공개 페이지 «우리 페이지 주소» 카드 (2026-09-25 · 2026-11-20 권한 탭에서 이사)
//   소개·서비스 칸은 WorkspacePageSettings 로 옮겼다(가리기·추가 항목·서비스 카드와 한 화면).
//
//   설계: docs/CLIENT_ENTRY_DESIGN.md §4.5 · §5 P1
//   자리: «고객 공개 범위» 카드 **옆** — 둘 다 «고객에게 무엇이 보이는가» 의 결정이다.
//
// ★ 이 카드가 하는 일: ①창구 주소를 **다시 볼 수 있게**(복사·QR·메일 서명 한 줄) ②방문자 막기
//   ③주소 교체·회수 ④상담 예약 설정. 그 이상은 두지 않는다.
// ★ 발급 버튼이 막힐 수 있다(게스트 링크 킬스위치). 그때는 **이유를 화면이 말한다** —
//   눌리게 두고 서버가 403 으로 거절하면 사용자에게는 «아무 일도 안 일어남» 이다.
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import ConfirmDialog from '../Common/ConfirmDialog';
import BookingSettings from './BookingSettings';

interface Props { businessId: number; isOwner: boolean; }

type EntryLink = {
  id: number;
  url: string | null;
  can_write: boolean;
  last_used_at: string | null;
  contacts: { id: number; name: string | null; email: string | null; verified_at: string | null; revoked_at?: string | null }[];
};

const CustomerEntrySection: React.FC<Props> = ({ businessId, isOwner }) => {
  const { t } = useTranslation('settings');
  const [link, setLink] = useState<EntryLink | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<null | 'url' | 'sig'>(null);
  const [askReplace, setAskReplace] = useState(false);
  // 방문자 한 사람 막기(D3) — 되돌릴 수 없으므로 한 번 묻는다. 막은 사람은 이메일을 다시 확인해도 못 들어온다.
  const [askBlock, setAskBlock] = useState<EntryLink['contacts'][number] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/customer-entry`);
      const j = await r.json();
      if (j?.success) {
        setLink(j.data.link || null);
        setEnabled(j.data.guest_links_enabled !== false);
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [businessId]);
  useEffect(() => { void load(); }, [load]);

  // QR — 설계 §4.5 «주소·QR·[복사][교체]». 명함·전단 인쇄용이라 이미지 한 장이면 된다
  //   (브라우저 «이미지 저장» 으로 충분 — 다운로드·크기 옵션은 설계에 없다).
  //   라이브러리는 **이 카드에서만** 쓰므로 동적 import 로 설정 화면을 열 때만 받는다.
  //   주소를 교체하면 url 이 바뀌어 다시 그린다 — 옛 QR 이 남으면 닫힌 링크를 인쇄하게 된다.
  const linkUrl = link?.url || null;
  useEffect(() => {
    if (!linkUrl) { setQr(null); return; }
    let alive = true;
    import('qrcode')
      .then(m => m.toDataURL(linkUrl, { margin: 1, width: 160 }))
      .then(d => { if (alive) setQr(d); })
      .catch(() => { if (alive) setQr(null); });
    return () => { alive = false; };
  }, [linkUrl]);

  const issue = async (replace: boolean) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/customer-entry/link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || `error_${r.status}`); return; }
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); setAskReplace(false); }
  };

  const copy = async (text?: string, which: 'url' | 'sig' = 'url') => {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(text || link.url);
      setCopied(which);
      setTimeout(() => setCopied(null), 1600);
    } catch { /* 클립보드가 막힌 브라우저 — 주소는 화면에 그대로 보인다 */ }
  };
  // 메일 서명에 붙일 한 줄 — «고객에게 주는 방법» (docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §7 ②)
  const sigLine = link?.url ? `${t('entry.sigPrefix', '문의·상담 예약')}: ${link.url}` : '';

  if (loading) return <Card><Empty>{t('entry.loading', '불러오는 중…')}</Empty></Card>;

  const verified = (link?.contacts || []).filter((c) => c.verified_at);

  const block = async (c: EntryLink['contacts'][number]) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/customer-entry/contacts/${c.id}`, { method: 'DELETE' });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || `error_${r.status}`); return; }
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Card data-testid="settings-customer-entry">
      <CardHeader>
        <Title>{t('wspage.linkTitle', '우리 페이지 주소')}</Title>
        <Desc>{t('wspage.linkDesc', '고객에게 주는 링크입니다. 명함·메일 서명·홈페이지·카톡에 붙이세요. 검색에는 나오지 않습니다.')}</Desc>
      </CardHeader>

      {!enabled && (
        <Warn data-testid="entry-disabled">
          {t('entry.disabled', '게스트 링크가 꺼져 있어 창구를 만들 수 없습니다. 플랫폼 관리자에게 문의해 주세요.')}
        </Warn>
      )}

      {link?.url ? (
        <>
          <UrlRow>
            <Url data-testid="entry-url" title={link.url}>{link.url}</Url>
            <Btn type="button" onClick={() => copy()} data-testid="entry-copy">
              {copied === 'url' ? t('entry.copied', '복사됨') : t('entry.copy', '복사')}
            </Btn>
            <Btn type="button" onClick={() => copy(sigLine, 'sig')} data-testid="entry-copy-signature" title={sigLine}>
              {copied === 'sig' ? t('entry.copied', '복사됨') : t('entry.copySignature', '메일 서명 한 줄 복사')}
            </Btn>
            {/* 미리보기는 **새 탭** — 설정 화면을 잃지 않는다. */}
            <Btn type="button" data-testid="entry-preview"
              onClick={() => window.open(link.url as string, '_blank', 'noopener,noreferrer')}>
              {t('entry.preview', '고객 화면 미리보기')}
            </Btn>
            {isOwner && (
              <Btn type="button" $danger disabled={busy} onClick={() => setAskReplace(true)} data-testid="entry-replace">
                {t('entry.replace', '주소 교체')}
              </Btn>
            )}
          </UrlRow>
          <Hint>
            {verified.length > 0
              ? t('entry.visitors', { count: verified.length, defaultValue: '이메일을 확인한 방문자 {{count}}명' })
              : t('entry.noVisitors', '아직 이메일을 확인한 방문자가 없습니다.')}
          </Hint>
          {verified.length > 0 && (
            <Visitors data-testid="entry-visitors">
              {verified.map((c) => (
                <VRow key={c.id} data-testid={`entry-visitor-${c.id}`}>
                  <VName>{c.name || '—'}</VName>
                  <VMail title={c.email || ''}>{c.email}</VMail>
                  {c.revoked_at ? (
                    <VBlocked>{t('entry.blocked', '막음')}</VBlocked>
                  ) : isOwner && (
                    <Btn type="button" $danger disabled={busy} data-testid={`entry-visitor-block-${c.id}`} onClick={() => setAskBlock(c)}>
                      {t('entry.block', '막기')}
                    </Btn>
                  )}
                </VRow>
              ))}
            </Visitors>
          )}
          {qr && (
            <QrRow>
              <QrImg src={qr} alt={t('entry.qrAlt', '창구 주소 QR 코드') as string} data-testid="entry-qr" width={160} height={160} />
              <Hint>{t('entry.qrHint', '명함·전단에 인쇄할 수 있습니다. 이미지를 길게 누르거나 우클릭해 저장하세요.')}</Hint>
            </QrRow>
          )}
        </>
      ) : (
        <UrlRow>
          <Empty>{t('entry.none', '아직 창구 주소가 없습니다.')}</Empty>
          <Btn type="button" $primary disabled={busy || !enabled || !isOwner}
            title={!isOwner ? (t('entry.ownerOnly', '오너만 만들 수 있습니다') as string) : undefined}
            onClick={() => issue(false)} data-testid="entry-create">
            {t('entry.create', '창구 주소 만들기')}
          </Btn>
        </UrlRow>
      )}

      {err && <Warn data-testid="entry-error">{t(`entry.err.${err}`, err)}</Warn>}

      {/* 상담 예약(P2) — 창구가 있어야 뜻이 있다(예약 탭은 창구 화면 안에 있다). */}
      {link?.url && <BookingSettings businessId={businessId} isOwner={isOwner} />}

      <ConfirmDialog
        isOpen={!!askBlock}
        title={t('entry.blockTitle', '이 방문자를 막을까요?') as string}
        message={askBlock ? `${askBlock.name || ''} ${askBlock.email || ''}\n${t('entry.blockBody', '이 사람의 개인 링크가 즉시 닫힙니다. 이메일을 다시 확인해도 들어올 수 없습니다. 대화 기록은 남습니다.')}` : ''}
        confirmText={t('entry.blockOk', '막기') as string}
        cancelText={t('common.cancel', '취소') as string}
        variant="danger"
        onConfirm={() => { const c = askBlock; setAskBlock(null); if (c) void block(c); }}
        onClose={() => setAskBlock(null)}
      />
      <ConfirmDialog
        isOpen={askReplace}
        title={t('entry.replaceTitle', '창구 주소를 교체할까요?') as string}
        message={t('entry.replaceBody', '지금 주소는 즉시 열리지 않게 됩니다. 이미 배포한 명함·메일의 링크도 함께 닫힙니다. 이메일을 확인한 방문자의 개인 링크도 닫힙니다.') as string}
        confirmText={t('entry.replaceOk', '교체') as string}
        cancelText={t('common.cancel', '취소') as string}
        variant="danger"
        onConfirm={() => issue(true)}
        onClose={() => setAskReplace(false)}
      />
    </Card>
  );
};

export default CustomerEntrySection;

const Card = styled.div`
  background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;
  display:flex;flex-direction:column;gap:14px;
`;
const CardHeader = styled.div`display:flex;flex-direction:column;gap:4px;`;
const Title = styled.div`font-size:0.9375rem;font-weight:700;color:#0f172a;`;
const Desc = styled.div`font-size:0.8125rem;color:#64748b;line-height:1.5;`;
const UrlRow = styled.div`display:flex;flex-wrap:wrap;align-items:center;gap:8px;`;
const Url = styled.div`
  flex:1 1 260px;min-width:0;padding:0 12px;height:36px;display:flex;align-items:center;
  background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;
  font-size:0.8125rem;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
`;
// 한 줄 안 컨트롤은 **36** 이다(필터줄 계약). 폰에서는 40.
const Btn = styled.button<{ $primary?: boolean; $danger?: boolean }>`
  flex-shrink:0;height:36px;padding:0 12px;border-radius:8px;cursor:pointer;white-space:nowrap;
  font-size:0.8125rem;font-weight:600;
  border:1px solid ${p => (p.$primary ? '#14B8A6' : p.$danger ? '#FECDD3' : '#cbd5e1')};
  background:${p => (p.$primary ? '#14B8A6' : '#fff')};
  color:${p => (p.$primary ? '#fff' : p.$danger ? '#B91C3C' : '#334155')};
  &:hover:not(:disabled){border-color:${p => (p.$danger ? '#F43F5E' : '#14B8A6')};}
  &:disabled{opacity:.55;cursor:default;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
  @media (max-width:640px){ height:40px; }
`;
const Visitors = styled.div`display:flex;flex-direction:column;gap:6px;`;
const VRow = styled.div`
  display:flex;align-items:center;gap:8px;min-height:36px;padding:0 0 0 10px;
  border:1px solid #F1F5F9;border-radius:8px;
  @media (max-width:640px){ flex-wrap:wrap;padding:6px 10px; }
`;
const VName = styled.span`flex-shrink:0;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8125rem;font-weight:600;color:#0F172A;`;
const VMail = styled.span`flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.75rem;color:#64748B;`;
const VBlocked = styled.span`flex-shrink:0;padding:0 10px;font-size:0.75rem;font-weight:600;color:#94A3B8;`;
const QrRow = styled.div`display:flex;align-items:center;gap:12px;flex-wrap:wrap;`;
const QrImg = styled.img`
  flex-shrink:0;width:160px;height:160px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;
`;
const Hint = styled.div`font-size:0.75rem;color:#94a3b8;line-height:1.5;`;
const Empty = styled.div`flex:1;font-size:0.8125rem;color:#94a3b8;`;
const Warn = styled.div`
  padding:9px 12px;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;
  font-size:0.75rem;line-height:1.5;color:#B91C3C;
`;
