// InquirySection — Q sale 상담 탭 맨 위 «신규 문의» (2026-11-20 · docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §5.4)
//
//   공개 페이지·창구의 문의 폼으로 들어온 건. Irene 결정 ③ — 여기 쌓고, 한 번 눌러 고객(문의 단계)으로 등록.
//   데이터 GET /api/sale/:biz/inquiries?status= · 칩 숫자 /inquiry-counts · 처리 POST …/:id/status ·
//   등록은 다른 등록과 같은 문 POST /api/sale/:biz/save-as-client {from:'inquiry'}.
// ★ 왜 SaleInboxList 안이 아니라 따로인가: 그 파일이 컴포넌트 크기 한도(800줄)에 닿아 있고, 문의 건은 상태(신규·보류·처리·스팸)를
//   가진 «건» 이라 접점 목록(대화·메일)과 모양이 다르다. 같은 상담 탭의 맨 위 한 묶음으로 둔다.
// ★ 신규 문의가 0건이고 보류도 0건이면 묶음 자체를 그리지 않는다(빈 제목만 남지 않는다).
// ★ 실시간: 소켓 `inquiry:updated`(신호만) + 탭 복귀 재조회. 주소 `?inquiry=<id>` 면 그 건을 연다(확인필요 링크).
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import InquiryDrawer, { type Inquiry } from './InquiryDrawer';

type Status = 'new' | 'held' | 'handled' | 'spam';
const TABS: Status[] = ['new', 'held', 'handled', 'spam'];

export default function InquirySection({ businessId, onRegistered }: { businessId: number; onRegistered?: () => void }) {
  const { t } = useTranslation('qsale');
  const { user } = useAuth();
  const { formatTimeAgo } = useTimeFormat();
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState<Status>('new');
  const [rows, setRows] = useState<Inquiry[]>([]);
  const [counts, setCounts] = useState<Record<Status, number>>({ new: 0, held: 0, handled: 0, spam: 0 });
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<Inquiry | null>(null);
  const role = String(user?.business_role || '');
  const lv = user?.menu_levels?.qsale;
  // 서버 writeChain(requireMenu qsale write)과 같은 선 — 화면이 서버보다 넓으면 눌러도 403 이다
  const canWrite = role === 'owner' || role === 'admin' || user?.platform_role === 'platform_admin' || (role === 'member' && (!lv || lv === 'write'));

  const load = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([
        apiFetch(`/api/sale/${businessId}/inquiries?status=${status}&limit=50`).then((r) => r.json()),
        apiFetch(`/api/sale/${businessId}/inquiry-counts`).then((r) => r.json()),
      ]);
      if (l?.success) setRows(l.data || []);
      if (c?.success) setCounts(c.data);
    } catch { /* 목록은 다음 재조회에서 — 상담 목록 전체를 막지 않는다 */ }
    finally { setLoaded(true); }
  }, [businessId, status]);
  useEffect(() => { void load(); }, [load]);
  useVisibilityRefresh(load);
  useEffect(() => {
    let pending: number | null = null;
    const off = onSocket('inquiry:updated', () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; void load(); }, 250);
    });
    return () => { if (pending) window.clearTimeout(pending); off(); };
  }, [load]);

  // 확인필요·알림 링크(?inquiry=<id>) — 그 건을 연다
  const deepId = Number(sp.get('inquiry')) || 0;
  useEffect(() => {
    if (!deepId) return;
    let alive = true;
    (async () => {
      const r = await apiFetch(`/api/sale/${businessId}/inquiries/${deepId}`);
      const j = await r.json().catch(() => null);
      if (alive && j?.success) setOpen(j.data);
    })();
    return () => { alive = false; };
  }, [deepId, businessId]);
  const close = () => {
    setOpen(null);
    if (sp.get('inquiry')) { const n = new URLSearchParams(sp); n.delete('inquiry'); setSp(n, { replace: true }); }
  };

  if (!loaded || (counts.new === 0 && counts.held === 0 && status === 'new' && !open)) return null;

  return (
    <Wrap data-testid="sale-inquiries">
      <Head>
        <Title>{t('inquiryBox.title', '신규 문의')}</Title>
        <Hint>{t('inquiryBox.hint', '공개 페이지·고객 창구의 문의 폼으로 들어온 건이에요.')}</Hint>
      </Head>
      <Chips role="tablist">
        {TABS.map((s) => (
          <Chip key={s} type="button" role="tab" aria-selected={status === s} $on={status === s}
            data-testid={`sale-inquiries-tab-${s}`} onClick={() => setStatus(s)}>
            {t(`inquiryBox.status.${s}`, s)} <b>{counts[s] || 0}</b>
          </Chip>
        ))}
      </Chips>
      {rows.length === 0 ? (
        <Empty>{t('inquiryBox.empty', '이 칸에는 문의가 없어요.')}</Empty>
      ) : (
        <List>
          {rows.map((r) => (
            <Row key={r.id} type="button" data-testid={`sale-inquiry-${r.id}`}
              $active={open?.id === r.id}
              onClick={() => (open?.id === r.id ? close() : setOpen(r))}>
              <Who>{r.name}{r.company ? <Co> · {r.company}</Co> : null}</Who>
              {r.service_name && <Svc>{r.service_name}</Svc>}
              <Msg>{r.message}</Msg>
              <At>{formatTimeAgo(r.created_at)}</At>
            </Row>
          ))}
        </List>
      )}
      <InquiryDrawer
        inquiry={open}
        businessId={businessId}
        canWrite={canWrite}
        onClose={close}
        onChanged={(next) => { if (next) setOpen(next); void load(); }}
        onRegistered={() => { onRegistered?.(); void load(); }}
      />
    </Wrap>
  );
}

const Wrap = styled.section`
  display:flex;flex-direction:column;gap:8px;margin:0 0 14px;padding:14px 16px;
  background:#fff;border:1px solid #99F6E4;border-radius:12px;
`;
const Head = styled.div`display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;`;
const Title = styled.h3`margin:0;font-size:0.9375rem;font-weight:700;color:#0F172A;`;
const Hint = styled.span`font-size:0.75rem;color:#64748B;`;
const Chips = styled.div`display:flex;gap:6px;flex-wrap:wrap;`;
const Chip = styled.button<{ $on: boolean }>`
  height:32px;padding:0 12px;border-radius:999px;cursor:pointer;font-size:0.75rem;font-weight:600;
  border:1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  background:${(p) => (p.$on ? '#F0FDFA' : '#fff')};color:${(p) => (p.$on ? '#0F766E' : '#475569')};
  b{margin-left:4px;}
`;
const List = styled.div`display:flex;flex-direction:column;`;
const Row = styled.button<{ $active: boolean }>`
  display:grid;grid-template-columns:minmax(0, 200px) auto minmax(0, 1fr) auto;align-items:center;gap:10px;
  min-height:44px;padding:8px 10px;border:none;border-top:1px solid #F1F5F9;text-align:left;cursor:pointer;
  background:${(p) => (p.$active ? '#F0FDFA' : '#fff')};
  &:hover{background:#F8FAFC;}
  @media (max-width:640px){ grid-template-columns:minmax(0, 1fr) auto; grid-template-areas:'who at' 'msg msg';
    & > :nth-child(2){display:none;} }
`;
const Who = styled.span`font-size:0.8125rem;font-weight:700;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const Co = styled.span`font-weight:500;color:#64748B;`;
const Svc = styled.span`
  font-size:0.6875rem;font-weight:600;color:#0F766E;background:#F0FDFA;border-radius:999px;padding:2px 8px;white-space:nowrap;
`;
const Msg = styled.span`font-size:0.8125rem;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  @media (max-width:640px){ grid-column:1 / -1; }`;
const At = styled.span`font-size:0.75rem;color:#94A3B8;white-space:nowrap;`;
const Empty = styled.div`font-size:0.8125rem;color:#94A3B8;padding:8px 2px;`;
