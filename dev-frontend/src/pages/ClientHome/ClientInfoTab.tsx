// 로그인 고객 홈 — «자료» 칸 (docs/CLIENT_QINFO_VIEW_DESIGN.md ④)
//
// 이 고객 범위로 등록된 Q info 를 **읽기 전용**으로 보인다. 술어·모양은 서버 한 벌(access_scope · services/kbClientView) —
//   화면은 받은 것만 그린다(비밀 칸·작성자·범위 칸은 서버가 애초에 안 보낸다).
// ★ 새로 그리지 않는다 — 목록 카드·읽기 시트는 무로그인 문서 탭(GuestDocsTab)의 껍데기 그대로.
// ★ 편집·복사·공유·첨부 UI 없음. 상세는 `?doc=<id>` 로 주소에 싣는다(새로고침·뒤로 가기 유지).
// ★ 실시간 — 팀이 자료를 만들거나 범위를 바꾸면 서버가 이 고객의 user: 방으로 kb:* 신호를 보낸다(services/kbSignal).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useBackToClose } from '../../hooks/useBackToClose';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { onSocket } from '../../services/socket';
import { sanitizeRichText } from '../../utils/sanitizeHtml';
import { formatPublicDate } from '../../utils/dateFormat';
import SearchBox from '../../components/Common/SearchBox';
import { FilterBar, FilterSearchSlot } from '../../components/Common/filterBar';
import { GuestTabPane, Empty, RetryInline, Sheet, SheetPortal } from '../Guest/guestShell';
import { CardGrid, Card, CardName, CardMeta, MetaFixed } from '../Guest/guestCards';
import { DocBox, DocHead, DocTitle, DocMeta, CloseBtn, DocBody } from '../Guest/GuestDocsTab';

type InfoRow = { id: number; title: string; updated_at: string | null; created_at: string | null; has_body: boolean; item_count: number };
type InfoCol = { id: string; name: string; type: string };
type InfoDetail = InfoRow & { body: string; custom_columns: InfoCol[]; custom_values: Record<string, unknown> };

type Props = { apiBase: string };

export default function ClientInfoTab({ apiBase }: Props) {
  const { t } = useTranslation('guest');
  const [sp, setSp] = useSearchParams();
  const [rows, setRows] = useState<InfoRow[] | null>(null);
  const [err, setErr] = useState(false);
  const [q, setQ] = useState('');
  const [doc, setDoc] = useState<InfoDetail | null>(null);
  const [docMissing, setDocMissing] = useState(false);
  const docId = Number(sp.get('doc')) || null;

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${apiBase}/info?limit=200`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(true); return; }
      setRows(j.data || []); setErr(false);
    } catch { setErr(true); }
  }, [apiBase]);
  useEffect(() => { void load(); }, [load]);

  const loadDoc = useCallback(async (id: number) => {
    try {
      const r = await apiFetch(`${apiBase}/info/${id}`);
      const j = await r.json().catch(() => null);
      if (r.ok && j?.success) { setDoc(j.data as InfoDetail); setDocMissing(false); }
      else { setDoc(null); setDocMissing(true); }   // 범위가 바뀌어 사라진 자료 — 시트를 비우고 알린다
    } catch { setDoc(null); setDocMissing(true); }
  }, [apiBase]);
  useEffect(() => {
    if (docId) void loadDoc(docId); else { setDoc(null); setDocMissing(false); }
  }, [docId, loadDoc]);

  // 실시간 — 신호만 오므로 다시 읽는다(250ms 로 모은다). 탭 복귀도 같은 길.
  const timer = useRef<number | null>(null);
  const refresh = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void load();
      if (docId) void loadDoc(docId);
    }, 250);
  }, [load, loadDoc, docId]);
  useEffect(() => {
    const offs = [onSocket('kb:new', refresh), onSocket('kb:updated', refresh), onSocket('kb:deleted', refresh)];
    return () => { offs.forEach((off) => off()); if (timer.current) window.clearTimeout(timer.current); };
  }, [refresh]);
  useVisibilityRefresh(useCallback(() => { void load(); }, [load]));

  const openDoc = (id: number) => { const n = new URLSearchParams(sp); n.set('doc', String(id)); setSp(n); };
  const close = useCallback(() => {
    const n = new URLSearchParams(sp); n.delete('doc'); setSp(n, { replace: true });
  }, [sp, setSp]);

  const sheetOpen = !!docId && (!!doc || docMissing);
  const boxRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(sheetOpen);
  useEscapeStack(sheetOpen, close);
  useFocusTrap(boxRef, sheetOpen);
  useBackToClose(sheetOpen, close);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter((r) => !needle || r.title.toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <GuestTabPane data-testid="home-body-kb">
      {err ? (
        <Empty>
          {t('kb.failed', { defaultValue: '자료를 불러오지 못했습니다.' })}{' '}
          <RetryInline type="button" onClick={() => void load()}>{t('retry', { defaultValue: '다시 시도' })}</RetryInline>
        </Empty>
      ) : rows === null ? (
        <Empty>{t('loading', { defaultValue: '불러오는 중…' })}</Empty>
      ) : rows.length === 0 ? (
        <Empty data-testid="home-kb-empty">{t('kb.empty', { defaultValue: '아직 공유된 자료가 없어요.' })}</Empty>
      ) : (
        <>
          <FilterBar data-testid="home-kb-filter">
            <FilterSearchSlot>
              <SearchBox value={q} onChange={setQ} width="100%"
                placeholder={t('filter.search', { defaultValue: '제목 검색' }) as string}
                ariaLabel={t('filter.search', { defaultValue: '제목 검색' }) as string} />
            </FilterSearchSlot>
          </FilterBar>
          {shown.length === 0 ? (
            <Empty>{t('filter.noMatch', { defaultValue: '조건에 맞는 항목이 없어요.' })}</Empty>
          ) : (
            <CardGrid>
              {shown.map((d) => (
                <Card key={d.id} type="button" data-testid={`home-kb-${d.id}`} onClick={() => openDoc(d.id)} aria-label={d.title}>
                  <CardName $clamp><span>{d.title}</span></CardName>
                  <CardMeta>
                    {(d.updated_at || d.created_at) && <MetaFixed>{formatPublicDate((d.updated_at || d.created_at) as string)}</MetaFixed>}
                    {d.item_count > 0 && <span>{t('kb.items', { count: d.item_count, defaultValue: '항목 {{count}}' })}</span>}
                  </CardMeta>
                </Card>
              ))}
            </CardGrid>
          )}
        </>
      )}

      {sheetOpen && (
        <SheetPortal>
          <Sheet role="dialog" aria-modal="true" aria-label={doc?.title || (t('kb.title', { defaultValue: '자료' }) as string)} onClick={close}>
            <DocBox ref={boxRef} onClick={(e) => e.stopPropagation()} data-testid="home-kb-sheet">
              <DocHead>
                <DocTitle>{doc ? doc.title : t('kb.gone', { defaultValue: '이 자료는 더 이상 볼 수 없어요.' })}</DocTitle>
                {doc && (doc.updated_at || doc.created_at) && (
                  <DocMeta><span>{formatPublicDate((doc.updated_at || doc.created_at) as string)}</span></DocMeta>
                )}
                <CloseBtn type="button" onClick={close} aria-label={t('close', { defaultValue: '닫기' }) as string}>×</CloseBtn>
              </DocHead>
              {doc && (
                <DocBody data-testid="home-kb-body">
                  {doc.custom_columns.length > 0 && (
                    <Fields>
                      {doc.custom_columns.map((c) => {
                        const v = doc.custom_values[c.id];
                        if (v == null || String(v).trim() === '') return null;
                        return (
                          <FieldRow key={c.id}>
                            <FieldName>{c.name}</FieldName>
                            <FieldValue $long={c.type === 'longtext'}>{renderValue(c.type, String(v))}</FieldValue>
                          </FieldRow>
                        );
                      })}
                    </Fields>
                  )}
                  {doc.body && doc.body.trim() && (
                    // 정화를 지난 HTML 만 넣는다(utils/sanitizeHtml) — 링크는 새 탭·noopener 로 바꾼다
                    <div dangerouslySetInnerHTML={{ __html: withSafeLinks(sanitizeRichText(doc.body)) }} />
                  )}
                </DocBody>
              )}
            </DocBox>
          </Sheet>
        </SheetPortal>
      )}
    </GuestTabPane>
  );
}

// 칸 값 — url 은 새 탭 링크(http/https 만), email 은 mailto, 나머지는 글자
function renderValue(type: string, v: string) {
  if (type === 'url' && /^https?:\/\//i.test(v)) {
    return <a href={v} target="_blank" rel="noopener noreferrer">{v}</a>;
  }
  if (type === 'email' && /^[^\s@]+@[^\s@]+$/.test(v)) return <a href={`mailto:${v}`}>{v}</a>;
  return v;
}
function withSafeLinks(html: string) {
  return html.replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ');
}

const Fields = styled.dl`
  display:grid;grid-template-columns:minmax(88px, max-content) 1fr;gap:8px 14px;margin:0 0 16px;
  padding:12px 14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;
  @media (max-width:640px){grid-template-columns:1fr;gap:2px;}
`;
const FieldRow = styled.div`display:contents;`;
const FieldName = styled.dt`font-size:0.75rem;font-weight:600;color:#64748B;padding-top:2px;
  @media (max-width:640px){padding-top:8px;}`;
const FieldValue = styled.dd<{ $long?: boolean }>`
  margin:0;font-size:0.875rem;color:#0F172A;word-break:break-word;
  white-space:${(p) => (p.$long ? 'pre-wrap' : 'normal')};
  a{color:#0D9488;}
`;
