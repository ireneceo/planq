// CustomerEntrySection — 설정 › 권한 «고객 창구» 카드 (2026-09-25)
//
//   설계: docs/CLIENT_ENTRY_DESIGN.md §4.5 · §5 P1
//   자리: «고객 공개 범위» 카드 **옆** — 둘 다 «고객에게 무엇이 보이는가» 의 결정이다.
//
// ★ 이 카드가 하는 일은 셋뿐이다: ①창구 주소를 **다시 볼 수 있게** ②소개·서비스 문구 저장
//   ③주소 교체·회수. 그 이상은 두지 않는다.
// ★ 소개·서비스는 `AutoSaveField` 로 **변경 즉시** 저장한다(저장 버튼 없음 — CLAUDE.md 자동저장 절).
//   래퍼가 `onSave` 를 부르므로 컨트롤이 직접 저장하지 않는다(두 번 나간다).
// ★ 발급 버튼이 막힐 수 있다(게스트 링크 킬스위치). 그때는 **이유를 화면이 말한다** —
//   눌리게 두고 서버가 403 으로 거절하면 사용자에게는 «아무 일도 안 일어남» 이다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import AutoSaveField from '../Common/AutoSaveField';
import ConfirmDialog from '../Common/ConfirmDialog';
import BookingSettings from './BookingSettings';

interface Props { businessId: number; isOwner: boolean; }

type EntryLink = {
  id: number;
  url: string | null;
  can_write: boolean;
  last_used_at: string | null;
  contacts: { id: number; name: string | null; email: string | null; verified_at: string | null }[];
};
type Settings = { intro: string; services: string[] };

const MAX_SERVICES = 6;

const CustomerEntrySection: React.FC<Props> = ({ businessId, isOwner }) => {
  const { t } = useTranslation('settings');
  const [link, setLink] = useState<EntryLink | null>(null);
  const [cfg, setCfg] = useState<Settings>({ intro: '', services: [] });
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [askReplace, setAskReplace] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  // ★ 최신값은 **클로저가 아니라 ref** 로 읽는다 — AutoSaveField 의 onSave 가 불릴 때
  //   클로저는 뒤집기 전 값을 본다(CLAUDE.md 자동저장 절의 실사례).
  const cfgRef = useRef<Settings>(cfg);
  cfgRef.current = cfg;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/businesses/${businessId}/customer-entry`);
      const j = await r.json();
      if (j?.success) {
        setLink(j.data.link || null);
        setCfg({
          intro: j.data.customer_entry?.intro || '',
          services: Array.isArray(j.data.customer_entry?.services) ? j.data.customer_entry.services : [],
        });
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

  /** 저장 — **던진다.** `if (j.success)` 로 삼키면 저장이 안 돼도 화면은 바뀐 채라
   *  사용자는 값이 슬쩍 되돌아가는 것만 보고 이유를 모른다(CLAUDE.md). 던져야 «!» 배지가 뜬다. */
  const persist = useCallback(async () => {
    const r = await apiFetch(`/api/businesses/${businessId}/customer-entry`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfgRef.current),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) throw new Error(j?.message || `save_failed_${r.status}`);
  }, [businessId]);

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

  const copy = async () => {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* 클립보드가 막힌 브라우저 — 주소는 화면에 그대로 보인다 */ }
  };

  if (loading) return <Card><Empty>{t('entry.loading', '불러오는 중…')}</Empty></Card>;

  const verified = (link?.contacts || []).filter((c) => c.verified_at);

  return (
    <Card data-testid="settings-customer-entry">
      <CardHeader>
        <Title>{t('entry.title', '고객 창구')}</Title>
        <Desc>{t('entry.desc', '고객이 문의를 남길 수 있는 워크스페이스 주소입니다. 명함·메일 서명·홈페이지에 이 링크를 붙이세요.')}</Desc>
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
            <Btn type="button" onClick={copy} data-testid="entry-copy">
              {copied ? t('entry.copied', '복사됨') : t('entry.copy', '복사')}
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

      {/* 안내 탭 문구 — 고객이 창구를 열면 가장 먼저 읽는 글이다. */}
      <Field>
        <Label htmlFor="entry-intro">{t('entry.introLabel', '소개')}</Label>
        <AutoSaveField key={`entry-intro-${businessId}`} onSave={persist}>
          <Area
            id="entry-intro"
            data-testid="entry-intro"
            rows={4}
            maxLength={2000}
            disabled={!isOwner}
            placeholder={t('entry.introPh', '어떤 일을 하는 회사인지 두세 줄로 적어 주세요.') as string}
            value={cfg.intro}
            onChange={(e) => setCfg((p) => ({ ...p, intro: e.target.value }))}
          />
        </AutoSaveField>
      </Field>

      <Field>
        <Label>{t('entry.servicesLabel', '제공 서비스')}</Label>
        <Hint>{t('entry.servicesHint', { count: MAX_SERVICES, defaultValue: '최대 {{count}}개. 빈 칸은 저장되지 않습니다.' })}</Hint>
        <AutoSaveField key={`entry-svc-${businessId}`} onSave={persist}>
          <SvcList>
            {Array.from({ length: Math.min(MAX_SERVICES, cfg.services.length + 1) }).map((_, i) => (
              <Input
                key={i}
                data-testid={`entry-service-${i}`}
                maxLength={120}
                disabled={!isOwner}
                placeholder={t('entry.servicePh', '예: 브랜드 웹사이트 제작') as string}
                value={cfg.services[i] || ''}
                onChange={(e) => setCfg((p) => {
                  const next = [...p.services];
                  next[i] = e.target.value;
                  // 뒤쪽 빈 칸은 모양만 — 저장은 서버가 빈 항목을 버린다(정규화 한 곳).
                  return { ...p, services: next };
                })}
              />
            ))}
          </SvcList>
        </AutoSaveField>
      </Field>

      {/* 상담 예약(P2) — 창구가 있어야 뜻이 있다(예약 탭은 창구 화면 안에 있다). */}
      {link?.url && <BookingSettings businessId={businessId} isOwner={isOwner} />}

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
const QrRow = styled.div`display:flex;align-items:center;gap:12px;flex-wrap:wrap;`;
const QrImg = styled.img`
  flex-shrink:0;width:160px;height:160px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;
`;
const Field = styled.div`display:flex;flex-direction:column;gap:6px;`;
const Label = styled.label`font-size:0.75rem;font-weight:600;color:#475569;`;
const Hint = styled.div`font-size:0.75rem;color:#94a3b8;line-height:1.5;`;
const Area = styled.textarea`
  width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;
  font-size:0.8125rem;line-height:1.6;color:#0f172a;resize:vertical;font-family:inherit;
  &:focus{outline:none;border-color:#14B8A6;}
  &:disabled{background:#f8fafc;color:#94a3b8;}
`;
const SvcList = styled.div`display:flex;flex-direction:column;gap:6px;`;
const Input = styled.input`
  width:100%;height:36px;padding:0 12px;border:1px solid #e2e8f0;border-radius:8px;
  font-size:0.8125rem;color:#0f172a;
  &:focus{outline:none;border-color:#14B8A6;}
  &:disabled{background:#f8fafc;color:#94a3b8;}
  @media (max-width:640px){ height:40px; }
`;
const Empty = styled.div`flex:1;font-size:0.8125rem;color:#94a3b8;`;
const Warn = styled.div`
  padding:9px 12px;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;
  font-size:0.75rem;line-height:1.5;color:#B91C3C;
`;
