// 워크스페이스 **고객 창구** — `/g/<token>` 의 scope='workspace' 화면
//
//   설계: docs/CLIENT_ENTRY_DESIGN.md §4.2 · §4.7 · §5 P1
//
// ★ **새로 그리지 않는다.** 껍데기(Wrap·Head·TabBar·Tab·GuestTabPane)는 `guestShell.tsx` 한 벌이고
//   프로젝트 화면과 **같은 것**을 쓴다. 채팅은 `GuestChatPanel`, 신원 띠는 `GuestNotifySection`,
//   잠금은 `LoginRequiredSheet` 그대로다. 베끼면 갈라진다(CLAUDE.md «새로 만들지 않는다»).
// ★ 창구 공유 링크에는 **대화방이 없다**(서버 ctx 의 `conversation: null`). 방은 방문자가 이메일을
//   확인하면 **개인 링크마다** 생긴다. 그래서 확인 전에는 「문의하기」·「내 문의」가 안내만 보여 주고,
//   확인이 끝나면 **개인 링크 주소로 옮겨간다**(§4.2 — 그 주소가 «내 자리» 다).
// ★ 프로젝트 내용은 창구에서 열지 않는다(§3-D2 — 이메일 확인은 로그인보다 약하다).
//   잠김 탭이고, 로그인해서 이 워크스페이스 고객이면 [앱에서 열기]로 바뀐다.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { PublicWorkspaceMark, PublicSubline, type PublicWorkspace } from '../../components/Layout/PublicPageShell';
import GuestChatPanel from './GuestChatPanel';
import GuestNotifySection from './GuestNotifySection';
import LoginRequiredSheet from './LoginRequiredSheet';
import GuestBookingPanel from './GuestBookingPanel';
import GuestBookingList from './GuestBookingList';
import {
  GuestTabPane, Empty, Lock,
  Wrap, Head, HeadRow, HeadText, Title, HeadBtn, TabBar, Tab, NotifyColumn,
} from './guestShell';

export type EntryInfo = {
  tagline: string | null;
  intro: string | null;
  services: string[];
  contact: { phone: string | null; email: string | null; website: string | null; address: string | null };
  /** 상담 예약(P2) — 켜져 있으면 «상담 예약» 탭이 보인다. 옛 응답에는 없을 수 있다. */
  booking?: { enabled: boolean; duration_minutes: number };
};

type Props = {
  token: string;
  workspace: PublicWorkspace | null;
  entry: EntryInfo | null;
  /** 이 토큰이 가리키는 방 — 창구 공유 링크는 null, 확인을 마친 개인 링크는 자기 방. */
  conversationId: number | null;
  canWrite: boolean;
  accountRequested: boolean;
  onGone: () => void;
  /** ctx 를 다시 읽는다 — 확인 뒤 주소가 바뀌면 부모가 새 토큰으로 다시 읽어야 한다. */
  onReload: () => void;
};

const TAB_KEYS = ['info', 'chat', 'book', 'mine', 'projects'] as const;
type TabKey = typeof TAB_KEYS[number];

export default function GuestWorkspacePage({
  token, workspace, entry, conversationId, canWrite, accountRequested, onGone, onReload,
}: Props) {
  const { t } = useTranslation('guest');
  const [sp, setSp] = useSearchParams();

  // 탭은 URL 싱크 — 프로젝트 화면과 **같은 규약**(`?tab=`, 기본 탭은 파라미터를 지운다).
  const raw = sp.get('tab');
  // 예약이 꺼진 창구에서 `?tab=book` 으로 들어오면 안내로 떨어진다 — 없는 탭을 그리지 않는다.
  const bookingOn = !!entry?.booking?.enabled;
  const tab: TabKey = (TAB_KEYS as readonly string[]).includes(raw || '') && (raw !== 'book' || bookingOn)
    ? (raw as TabKey) : 'info';
  const go = (k: TabKey) => {
    const n = new URLSearchParams(sp);
    if (k === 'info') n.delete('tab'); else n.set('tab', k);
    setSp(n, { replace: true });
  };

  // 내가 이 워크스페이스를 앱에서 볼 수 있나 — 로그인한 사람에게만 답이 온다(무인증이면 조용히 지나간다).
  //   판정은 서버 `auth-check` 하나이고, 앱 목록이 쓰는 술어를 그대로 부른다.
  const [access, setAccess] = useState<{ canAccess: boolean; appUrl: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/guest/${token}/auth-check`);
        if (!alive || !r.ok) return;
        const j = await r.json();
        if (j?.success) setAccess(j.data);
      } catch { /* 무인증 방문자는 여기 오지 않는다 */ }
    })();
    return () => { alive = false; };
  }, [token]);

  const [sheet, setSheet] = useState<null | 'register'>(null);
  const [requested, setRequested] = useState(accountRequested);

  // 확인이 끝나면 **개인 링크 주소로** 옮긴다. 그 주소에만 자기 방·«내 문의» 가 있다.
  //   ★ 재확인(토큰 null)이면 옮기지 않고 ctx 만 다시 읽는다 — 토큰은 회전하지 않으므로
  //     그때는 이미 이 브라우저가 자기 주소를 갖고 있거나 메일 링크로 들어온 것이다.
  const onVerified = useCallback((personalToken: string | null) => {
    if (personalToken) window.location.assign(`/g/${personalToken}?tab=chat`);
    else onReload();
  }, [onReload]);

  const hasRoom = !!conversationId;
  // 제안받은 건에서 [다른 시간] 을 누르면 예약 탭이 재신청 모드로 열린다.
  const [reschedule, setReschedule] = useState<{ id: number } | null>(null);
  const [mineKey, setMineKey] = useState(0);

  return (
    <Wrap>
      <Head>
        <HeadRow>
          {workspace && <PublicWorkspaceMark workspace={workspace} />}
          <HeadText>
            <Title>{workspace?.name || t('entry.title', { defaultValue: '고객 창구' })}</Title>
            {entry?.tagline && <PublicSubline sub={entry.tagline} />}
          </HeadText>
          {/* 오른쪽 문은 **하나**다 — 앱에서 볼 수 있으면 [앱에서 열기], 아니면 [고객으로 등록].
              둘을 같이 두면 «어느 것이 내 길인지» 를 방문자가 판단해야 한다. */}
          {access?.canAccess && access.appUrl ? (
            <HeadBtn type="button" data-testid="guest-open-app"
              onClick={() => window.location.assign(access.appUrl as string)}>
              {t('login.openInApp', { defaultValue: '앱에서 열기' })}
            </HeadBtn>
          ) : (
            <HeadBtn type="button" data-testid="guest-register" onClick={() => setSheet('register')}>
              {t('login.register', { defaultValue: '고객으로 등록' })}
            </HeadBtn>
          )}
        </HeadRow>
      </Head>

      <TabBar role="tablist" aria-label={t('entry.tabsAria', { defaultValue: '고객 창구 탭' }) as string}>
        <Tab type="button" role="tab" aria-selected={tab === 'info'} $on={tab === 'info'}
          data-testid="guest-tab-info" onClick={() => go('info')}>
          {t('entry.tabInfo', { defaultValue: '안내' })}
        </Tab>
        <Tab type="button" role="tab" aria-selected={tab === 'chat'} $on={tab === 'chat'}
          data-testid="guest-tab-chat" onClick={() => go('chat')}>
          {t('entry.tabChat', { defaultValue: '문의하기' })}
        </Tab>
        {bookingOn && (
          <Tab type="button" role="tab" aria-selected={tab === 'book'} $on={tab === 'book'}
            data-testid="guest-tab-book" onClick={() => { setReschedule(null); go('book'); }}>
            {t('entry.tabBook', { defaultValue: '상담 예약' })}
          </Tab>
        )}
        <Tab type="button" role="tab" aria-selected={tab === 'mine'} $on={tab === 'mine'}
          data-testid="guest-tab-mine" onClick={() => go('mine')}>
          {t('entry.tabMine', { defaultValue: '내 문의' })}
        </Tab>
        <Tab type="button" role="tab" aria-selected={tab === 'projects'} $on={tab === 'projects'}
          data-testid="guest-tab-projects" onClick={() => go('projects')}>
          {t('entry.tabProjects', { defaultValue: '프로젝트' })}
          {!access?.canAccess && <Lock />}
        </Tab>
      </TabBar>

      {/* 신원 띠 — `GuestNotifySection` **그대로**다. 문구만 «문의·예약» 이고 닫기가 없다. */}
      <NotifyColumn>
        <GuestNotifySection token={token} onGone={onGone} variant="entry" onVerified={onVerified} />
      </NotifyColumn>

      {tab === 'info' && (
        <GuestTabPane data-testid="guest-tab-body-info">
          {entry?.intro ? <Para>{entry.intro}</Para> : (
            <Empty>{t('entry.noIntro', { defaultValue: '아직 소개가 등록되지 않았어요.' })}</Empty>
          )}
          {entry?.services && entry.services.length > 0 && (
            <Section>
              <Label>{t('entry.services', { defaultValue: '제공 서비스' })}</Label>
              <Chips>{entry.services.map((s, i) => <Chip key={i}>{s}</Chip>)}</Chips>
            </Section>
          )}
          {entry?.contact && (entry.contact.phone || entry.contact.email
            || entry.contact.website || entry.contact.address) && (
            <Section>
              <Label>{t('entry.contact', { defaultValue: '연락처' })}</Label>
              {entry.contact.phone && (
                <CRow><CKey>{t('entry.phone', { defaultValue: '전화' })}</CKey>
                  <a href={`tel:${entry.contact.phone}`}>{entry.contact.phone}</a></CRow>
              )}
              {entry.contact.email && (
                <CRow><CKey>{t('entry.email', { defaultValue: '이메일' })}</CKey>
                  <a href={`mailto:${entry.contact.email}`}>{entry.contact.email}</a></CRow>
              )}
              {entry.contact.website && (
                <CRow><CKey>{t('entry.website', { defaultValue: '홈페이지' })}</CKey>
                  {/* 외부 주소는 새 탭 + noreferrer — 우리 화면 주소가 제3자에게 가지 않게. */}
                  <a href={entry.contact.website} target="_blank" rel="noopener noreferrer">{entry.contact.website}</a></CRow>
              )}
              {entry.contact.address && (
                <CRow><CKey>{t('entry.address', { defaultValue: '주소' })}</CKey>
                  <span>{entry.contact.address}</span></CRow>
              )}
            </Section>
          )}
          <BtnRow>
            <AskBtn type="button" data-testid="entry-go-chat" onClick={() => go('chat')}>
              {t('entry.goChat', { defaultValue: '문의하기' })}
            </AskBtn>
            {bookingOn && (
              <AskGhost type="button" data-testid="entry-go-book" onClick={() => { setReschedule(null); go('book'); }}>
                {t('entry.goBook', { defaultValue: '상담 예약' })}
              </AskGhost>
            )}
          </BtnRow>
        </GuestTabPane>
      )}

      {tab === 'book' && bookingOn && (
        <GuestBookingPanel
          token={token}
          verified={hasRoom}
          reschedule={reschedule}
          onDone={() => { setReschedule(null); setMineKey((k) => k + 1); go('mine'); }}
          onCancelReschedule={() => { setReschedule(null); go('mine'); }}
        />
      )}

      {/* 대화 — 방이 있을 때만 그린다. 언마운트로 쓰던 글이 날아가지 않게 `display:none` 으로 접는다
          (프로젝트 화면의 ChatWrap 과 같은 이유). */}
      {hasRoom ? (
        <ChatWrap $on={tab === 'chat'} data-testid="guest-tab-body-chat">
          <GuestChatPanel token={token} canWrite={canWrite} active={tab === 'chat'} column onGone={onGone} />
        </ChatWrap>
      ) : tab === 'chat' && (
        <GuestTabPane data-testid="guest-tab-body-chat">
          {/* ★ 눌리는데 아무 일도 안 일어나는 입력을 두지 않는다 — 확인 전에는 **왜** 못 쓰는지 말한다
              (CLAUDE.md: 눌리게 두고 서버가 거절하면 사용자에게는 «아무 일도 안 일어남» 이다). */}
          <Notice data-testid="entry-chat-locked">
            {t('entry.chatLocked', { defaultValue: '이메일을 확인하면 이 자리에서 바로 문의를 남길 수 있어요. 위의 [확인하기] 를 눌러 주세요.' })}
          </Notice>
        </GuestTabPane>
      )}

      {tab === 'mine' && (
        <GuestTabPane data-testid="guest-tab-body-mine">
          {hasRoom ? (
            <>
              {/* 위 = 상태가 있는 것(상담·미팅) · 아래 = 흐름(대화) — §4.4. 없으면 묶음 자체가 안 그려진다. */}
              <GuestBookingList token={token} reloadKey={mineKey}
                onReschedule={(id) => { setReschedule({ id }); go('book'); }} />
              <Label>{t('entry.mineChat', { defaultValue: '대화' })}</Label>
              <MineRow type="button" data-testid="entry-mine-chat" onClick={() => go('chat')}>
                <span>{workspace?.name || t('entry.title', { defaultValue: '고객 창구' })}</span>
                <MineGo>{t('entry.open', { defaultValue: '열기' })}</MineGo>
              </MineRow>
            </>
          ) : (
            <Notice data-testid="entry-mine-locked">
              {t('entry.mineLocked', { defaultValue: '이메일을 확인하면 남긴 문의를 여기서 다시 볼 수 있어요.' })}
            </Notice>
          )}
        </GuestTabPane>
      )}

      {tab === 'projects' && (
        <GuestTabPane data-testid="guest-tab-body-projects">
          {access?.canAccess && access.appUrl ? (
            <>
              <Notice>{t('entry.projectsOpen', { defaultValue: '이 워크스페이스의 프로젝트를 앱에서 볼 수 있어요.' })}</Notice>
              <AskBtn type="button" data-testid="entry-projects-app"
                onClick={() => window.location.assign(access.appUrl as string)}>
                {t('login.openInApp', { defaultValue: '앱에서 열기' })}
              </AskBtn>
            </>
          ) : (
            <>
              <Notice data-testid="entry-projects-locked">
                <Lock size={14} />{' '}
                {t('entry.projectsLocked', { defaultValue: '초대된 고객 계정으로 로그인하면 프로젝트를 볼 수 있어요.' })}
              </Notice>
              <AskBtn type="button" data-testid="entry-projects-login" onClick={() => setSheet('register')}>
                {t('login.register', { defaultValue: '고객으로 등록' })}
              </AskBtn>
            </>
          )}
        </GuestTabPane>
      )}

      <LoginRequiredSheet
        open={sheet === 'register'}
        onClose={() => setSheet(null)}
        reason="register"
        token={token}
        tab={tab}
        requested={requested}
        onRequested={() => setRequested(true)}
        notInvited={!!access && !access.canAccess}
        onGone={onGone}
      />
    </Wrap>
  );
}

const Para = styled.p`margin:0;font-size:0.8125rem;color:#475569;line-height:1.6;white-space:pre-wrap;`;
const Section = styled.div`display:flex;flex-direction:column;gap:6px;`;
const Label = styled.div`font-size:0.6875rem;font-weight:600;color:#94a3b8;letter-spacing:-0.1px;`;
const Chips = styled.div`display:flex;flex-wrap:wrap;gap:6px;`;
const Chip = styled.span`
  display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;
  background:#F1F5F9;color:#475569;font-size:0.6875rem;font-weight:600;
`;
const CRow = styled.div`
  display:flex;align-items:baseline;gap:8px;font-size:0.8125rem;color:#334155;
  a{color:#0D9488;text-decoration:none;&:hover{text-decoration:underline;}}
`;
const CKey = styled.span`flex-shrink:0;min-width:3.5rem;font-size:0.75rem;color:#94A3B8;`;
const Notice = styled.div`
  padding:10px 12px;background:#f1f5f9;border-radius:8px;
  font-size:0.75rem;line-height:1.5;color:#64748b;
`;
// 주요 행동 — 3톤 규칙의 Primary. 프로젝트 화면 AskBtn 과 같은 값이다.
const AskBtn = styled.button`
  align-self:flex-start;min-height:40px;padding:0 16px;border-radius:10px;cursor:pointer;
  border:none;background:#14B8A6;color:#fff;font-size:0.875rem;font-weight:700;
  &:hover{background:#0D9488;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const BtnRow = styled.div`display:flex;flex-wrap:wrap;gap:8px;`;
// 보조 행동 — 3톤 규칙의 Secondary. 높이·모서리는 AskBtn 과 같다.
const AskGhost = styled.button`
  min-height:40px;padding:0 16px;border-radius:10px;cursor:pointer;
  border:1px solid #CBD5E1;background:#fff;color:#334155;font-size:0.875rem;font-weight:700;
  &:hover{border-color:#14B8A6;}
  &:focus-visible{outline:2px solid #0D9488;outline-offset:2px;}
`;
const MineRow = styled.button`
  display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;
  padding:12px 14px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;cursor:pointer;
  font-size:0.875rem;color:#0F172A;text-align:left;
  &:hover{border-color:#14B8A6;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
`;
const MineGo = styled.span`flex-shrink:0;font-size:0.75rem;font-weight:700;color:#0D9488;`;
// 대화 탭 — 숨길 때도 **언마운트하지 않는다**(쓰던 글 보존). 자리만 접는다.
const ChatWrap = styled.div<{ $on: boolean }>`
  display:${p => (p.$on ? 'flex' : 'none')};
  flex-direction:column;flex:1;min-height:0;
`;
