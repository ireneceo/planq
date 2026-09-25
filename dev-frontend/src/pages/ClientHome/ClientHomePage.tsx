// 로그인 고객 홈 — `/home` (docs/CLIENT_ENTRY_DESIGN.md §4.7 · §5 P3)
//
// ★ 고객 창구(`/g/<token>`)의 **app 모드**다. 새로 그리지 않는다 — 안내는 `EntryInfoView`, 예약은
//   `GuestBookingPanel`, 내 문의는 `GuestBookingList` 를 **그대로** 얹고, 부르는 API 만 계정용
//   (`/api/client-home/:biz`)으로 바꾼다. 서버도 같은 함수(services/booking.js)를 신원만 바꿔 부른다.
// ★ 대화는 여기서 그리지 않는다 — 앱에는 Q Talk 가 있다. [문의하기] 는 내 대화방으로 간다.
// ★ 프로젝트·청구는 앱의 제 화면으로 간다(게스트 화면 안에 프로젝트 내용을 그리지 않는 것과 같은 규칙).
// ★ 고객이 아닌 사람(멤버·오너)은 대시보드로 보낸다 — 서버도 403 이다(accountActor).
import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PageShell from '../../components/Layout/PageShell';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { fetchTodo } from '../../services/dashboard';
import EntryInfoView, { AskBtn, Label } from '../Guest/EntryInfoView';
import GuestBookingPanel from '../Guest/GuestBookingPanel';
import GuestBookingList from '../Guest/GuestBookingList';
import { TabBar, Tab, Count } from '../Guest/guestShell';
import type { EntryInfo } from '../Guest/GuestWorkspacePage';

type Home = {
  workspace: { name: string | null; logo_url: string | null } | null;
  entry: EntryInfo | null;
  client: { id: number; name: string | null };
  conversation: { id: number; title: string | null } | null;
  projects_count: number;
};

const TAB_KEYS = ['info', 'book', 'mine'] as const;
type TabKey = typeof TAB_KEYS[number];

export default function ClientHomePage() {
  const { t } = useTranslation('guest');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const bizId = user?.business_id || null;
  const [home, setHome] = useState<Home | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [todoTotal, setTodoTotal] = useState(0);
  const [reschedule, setReschedule] = useState<{ id: number } | null>(null);
  const [mineKey, setMineKey] = useState(0);

  const load = useCallback(async () => {
    if (!bizId) return;
    try {
      const r = await apiFetch(`/api/client-home/${bizId}`);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) { setErr(j?.message || `error_${r.status}`); return; }
      setHome(j.data); setErr(null);
    } catch { setErr('error'); }
    // 확인필요 — 청구·컨펌 같은 «내가 할 일» 이 있으면 홈 위에 한 줄로(§4.7). 숫자는 todo API 한 곳.
    try { const td = await fetchTodo(bizId); setTodoTotal(td.total || 0); } catch { /* 줄만 안 뜬다 */ }
  }, [bizId]);
  useEffect(() => { void load(); }, [load]);

  if (user && user.business_role !== 'client') return <Navigate to="/dashboard" replace />;

  const bookingOn = !!home?.entry?.booking?.enabled;
  const raw = sp.get('tab');
  const tab: TabKey = (TAB_KEYS as readonly string[]).includes(raw || '') && (raw !== 'book' || bookingOn)
    ? (raw as TabKey) : 'info';
  const go = (k: TabKey) => {
    const n = new URLSearchParams(sp);
    if (k === 'info') n.delete('tab'); else n.set('tab', k);
    setSp(n, { replace: true });
  };
  const openChat = () => navigate(home?.conversation ? `/talk?conv=${home.conversation.id}` : '/talk');
  const apiBase = bizId ? `/api/client-home/${bizId}` : undefined;

  return (
    <PageShell title={home?.workspace?.name || t('home.title', { defaultValue: '홈' })}>
      <Col data-testid="client-home">
        {todoTotal > 0 && (
          <TodoBar type="button" data-testid="client-home-todo" onClick={() => navigate('/inbox')}>
            <span>{t('home.todo', { count: todoTotal, defaultValue: '확인할 일이 {{count}}건 있어요' })}</span>
            <TodoGo>{t('home.todoOpen', { defaultValue: '확인필요 열기' })}</TodoGo>
          </TodoBar>
        )}
        {err && <Warn data-testid="client-home-error">{t('home.loadFail', { defaultValue: '홈 정보를 불러오지 못했어요.' })}</Warn>}

        <TabBar role="tablist" aria-label={t('home.tabsAria', { defaultValue: '홈 탭' }) as string}>
          <Tab type="button" role="tab" aria-selected={tab === 'info'} $on={tab === 'info'}
            data-testid="home-tab-info" onClick={() => go('info')}>
            {t('entry.tabInfo', { defaultValue: '안내' })}
          </Tab>
          {bookingOn && (
            <Tab type="button" role="tab" aria-selected={tab === 'book'} $on={tab === 'book'}
              data-testid="home-tab-book" onClick={() => { setReschedule(null); go('book'); }}>
              {t('entry.tabBook', { defaultValue: '상담 예약' })}
            </Tab>
          )}
          <Tab type="button" role="tab" aria-selected={tab === 'mine'} $on={tab === 'mine'}
            data-testid="home-tab-mine" onClick={() => go('mine')}>
            {t('entry.tabMine', { defaultValue: '내 문의' })}
          </Tab>
          {/* 앱의 제 화면으로 가는 문 — 탭 모양이지만 누르면 이동한다(§4.7 «누르면 앱 /projects») */}
          <Tab type="button" $on={false} data-testid="home-go-projects" onClick={() => navigate('/projects')}>
            {t('entry.tabProjects', { defaultValue: '프로젝트' })}
            {!!home?.projects_count && <Count>{home.projects_count}</Count>}
          </Tab>
          <Tab type="button" $on={false} data-testid="home-go-bills" onClick={() => navigate('/bills')}>
            {t('home.bills', { defaultValue: '청구' })}
          </Tab>
        </TabBar>

        {tab === 'info' && (
          <Pane data-testid="home-body-info">
            <EntryInfoView entry={home?.entry || null} bookingOn={bookingOn}
              onAsk={openChat} onBook={() => { setReschedule(null); go('book'); }} />
          </Pane>
        )}

        {tab === 'book' && bookingOn && apiBase && (
          // 로그인 고객은 이미 신원이 있다 — 이메일 확인 단계가 없다(verified).
          <GuestBookingPanel token="" apiBase={apiBase} verified reschedule={reschedule}
            onDone={() => { setReschedule(null); setMineKey((k) => k + 1); go('mine'); }}
            onCancelReschedule={() => { setReschedule(null); go('mine'); }} />
        )}

        {tab === 'mine' && apiBase && (
          <Pane data-testid="home-body-mine">
            {/* 위 = 상태가 있는 것(상담) · 아래 = 흐름(대화) — 창구 «내 문의» 와 같은 순서(§4.4) */}
            <GuestBookingList token="" apiBase={apiBase} reloadKey={mineKey}
              onReschedule={(id) => { setReschedule({ id }); go('book'); }} />
            <Label>{t('entry.mineChat', { defaultValue: '대화' })}</Label>
            <AskBtn type="button" data-testid="home-open-chat" onClick={openChat}>
              {t('entry.goChat', { defaultValue: '문의하기' })}
            </AskBtn>
          </Pane>
        )}
      </Col>
    </PageShell>
  );
}

const Col = styled.div`display:flex;flex-direction:column;gap:14px;max-width:880px;width:100%;margin:0 auto;`;
const Pane = styled.div`display:flex;flex-direction:column;gap:14px;`;
const TodoBar = styled.button`
  display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;
  min-height:44px;padding:0 14px;border-radius:10px;cursor:pointer;text-align:left;
  background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412;font-size:0.8125rem;font-weight:600;
  &:hover{border-color:#FB923C;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
`;
const TodoGo = styled.span`flex-shrink:0;font-size:0.75rem;font-weight:700;`;
const Warn = styled.div`padding:9px 12px;background:#FFF1F2;border:1px solid #FECDD3;border-radius:8px;font-size:0.75rem;color:#B91C3C;`;
