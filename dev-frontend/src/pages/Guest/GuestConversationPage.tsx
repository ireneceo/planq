// 무로그인 게스트 화면 (운영 #259) — `/g/:token`
//
// Irene: "카톡 채팅으로 일하는 고객이 하나도 불편하지 않게 우리 채팅에서 요청을 하게 할 방법."
//   그래서 이 화면의 목표는 **가입 유도가 아니라 바로 쓰게 하는 것**이다.
//   로그인 배너·계정 만들기 권유를 두지 않는다 — 그 자체가 Irene 이 말한 불편이다.
//
// ★ 이 파일은 **껍데기**다: 컨텍스트를 한 번 받아 링크의 종류(scope)로 갈라 준다.
//     scope='project'      → GuestProjectPage (개요·업무·대화 탭)
//     scope='conversation' → 이 화면(대화). 옛 링크는 전부 이쪽이다.
//   채팅 본체는 두 화면이 **같은 GuestChatPanel** 을 쓴다 — 각자 구현하면 반드시 갈라진다.
//
// ★ 워크스페이스 chrome 은 하나도 쓰지 않는다(utils/publicSurface 의 '/g/').
//   고객이 보는 것은 "우리 회사와의 대화" 지 "남의 회사 업무도구" 가 아니다.
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import GuestNotifySection from './GuestNotifySection';
import GuestChatPanel from './GuestChatPanel';
import GuestProjectPage, { type GuestProject } from './GuestProjectPage';

type GuestCtx = {
  // 링크가 여는 것의 종류. 없으면 옛 링크 = 대화(fail-closed: 넓은 쪽으로 추정하지 않는다).
  scope?: 'conversation' | 'project';
  guest_name: string; can_write: boolean; client_name: string | null; account_requested?: boolean;
  conversation: { id: number; title: string | null };
  project: GuestProject | null;
};

export default function GuestConversationPage() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation('guest');
  const [ctx, setCtx] = useState<GuestCtx | null>(null);
  const [gone, setGone] = useState(false);
  // 첫 로드가 실패했는가 — 끝나지 않는 스피너 대신 이유와 다시 시도를 보여준다.
  const [loadErr, setLoadErr] = useState(false);
  // 계정 안내 배너 — 닫으면 이 브라우저에서 다시 안 뜬다. 읽기만 하러 온 사람을 막지 않는다.
  const bannerKey = `guest:banner:${token || ''}`;
  const [bannerHidden, setBannerHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(bannerKey) === '1'; } catch { return false; }
  });
  const [reqEmail, setReqEmail] = useState('');
  const [reqSending, setReqSending] = useState(false);
  const [requested, setRequested] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    // ★ 첫 로드는 조용히 실패하면 안 된다 (2026-09-02, 운영 사고).
    //   전에는 catch 를 통째로 삼켜서, 네트워크가 한 번만 흔들려도 `ctx` 가 null 로 남고
    //   화면이 **영원히 "불러오는 중…"** 이었다. 고객에게는 "고장" 과 구별되지 않는다
    //   (실제로 그렇게 보고됐다: "로딩이래. 이상해. 왜 안되지?").
    try {
      const r = await fetch(`/api/guest/${token}`);
      if (r.status === 404) { setGone(true); return; }
      if (!r.ok) throw new Error(`ctx ${r.status}`);
      const j = await r.json();
      if (!j.success || !j.data) throw new Error('ctx payload');
      setCtx(j.data);
      setLoadErr(false);
    } catch {
      setLoadErr(true);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  // ctx 를 아직 못 받았으면 5초마다 다시 시도한다 — 사용자가 아무것도 안 해도 네트워크가
  //   돌아오면 저절로 열린다. (메시지 폴링은 GuestChatPanel 안에 있다.)
  useEffect(() => {
    if (gone || ctx) return;
    const id = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(id);
  }, [load, gone, ctx]);

  // ★ 가입 화면으로 보내지 않는다. 초대 토큰 없이 가입하면 `routes/auth.js:216` 가
  //   **자기 워크스페이스를 새로 만들어** 고객이 빈 화면에 떨어지고 이 대화는 못 본다
  //   (Fable 판정). 담당자에게 요청만 보내고, 계정 생성은 멤버가 보내는 초대 메일 한 곳으로 몬다.
  const requestAccount = async () => {
    if (reqSending || !token) return;
    setReqSending(true);
    try {
      const r = await fetch(`/api/guest/${token}/account-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: reqEmail.trim() || undefined }),
      });
      if (r.status === 404) { setGone(true); return; }
      if (r.ok) setRequested(true);
    } catch { /* 조용히 실패하지 않게 버튼이 그대로 남는다 */ }
    finally { setReqSending(false); }
  };

  if (gone) {
    return (
      <Center>
        <Card>
          <H1>{t('expired.title', { defaultValue: '링크가 만료되었습니다' })}</H1>
          <P>{t('expired.body', { defaultValue: '오래 사용하지 않아 링크가 닫혔습니다. 담당자가 다음 안내 메일을 보내면 새 링크가 함께 도착합니다.' })}</P>
        </Card>
      </Center>
    );
  }
  if (!ctx) {
    // 스피너가 끝나지 않는 것은 사용자에게 고장이다 — 실패했으면 그렇게 말하고 손잡이를 준다.
    if (loadErr) {
      return (
        <Center>
          <Card>
            <P>{t('loadFailed', { defaultValue: '대화를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.' })}</P>
            <RetryBtn type="button" data-testid="guest-retry"
              onClick={() => { setLoadErr(false); void load(); }}>
              {t('retry', { defaultValue: '다시 시도' })}
            </RetryBtn>
          </Card>
        </Center>
      );
    }
    return <Center><P>{t('loading', { defaultValue: '불러오는 중…' })}</P></Center>;
  }

  // ── 프로젝트 링크 — 화면의 주인이 프로젝트다(대화는 탭 하나).
  if (ctx.scope === 'project' && ctx.project) {
    return (
      <GuestProjectPage
        token={token || ''}
        project={ctx.project}
        canWrite={!!ctx.can_write}
        onGone={() => setGone(true)}
      />
    );
  }

  // ── 대화 링크 — 옛 링크는 전부 이쪽. **정보 띠를 얹지 않는다**(2026-09-05):
  //    채팅 위에 프로젝트 정보를 붙이는 방식은 "열면 그냥 채팅" 이라 되돌린 방향이다
  //    (Irene: "나는 프로젝트 안 탭들 보는 그대로 프로젝트 링크 물어본건데?").
  //    프로젝트 이름은 제목 한 줄로만 남는다.
  return (
    <Wrap>
      <Head>
        <Title>{ctx.project ? ctx.project.name : (ctx.conversation.title || t('defaultTitle', { defaultValue: '대화' }))}</Title>
        {ctx.client_name && <Sub>{ctx.client_name}</Sub>}
      </Head>
      {/* 답글 알림 신청 (#259 A안) — 등록은 선택이고, 닫으면 이 브라우저에서 다시 안 뜬다. */}
      <GuestNotifySection token={token || ''} onGone={() => setGone(true)} />
      {/* 헤더 아래 1줄 — 고정하지 않는다(본문과 함께 밀려 올라감). */}
      {!bannerHidden && (
        <Banner data-testid="guest-account-banner">
          {requested || ctx.account_requested ? (
            <BannerText>{t('acct.sent', { defaultValue: '요청을 보냈어요. 담당자가 초대 메일을 보내면 계정을 만들 수 있어요.' })}</BannerText>
          ) : (
            <>
              <BannerText>
                {t('acct.lead', { defaultValue: '이 링크로는 이 대화만 볼 수 있어요. 프로젝트·자료까지 보려면 계정이 필요해요.' })}
              </BannerText>
              <BannerRow>
                <BannerInput value={reqEmail} onChange={(e) => setReqEmail(e.target.value)}
                  data-testid="guest-account-email"
                  placeholder={t('acct.emailPh', { defaultValue: '이메일 (선택)' }) as string}
                  maxLength={200} inputMode="email" />
                <BannerBtn type="button" onClick={requestAccount} disabled={reqSending}
                  data-testid="guest-account-request">
                  {t('acct.request', { defaultValue: '계정 요청하기' })}
                </BannerBtn>
              </BannerRow>
            </>
          )}
          <BannerClose type="button" aria-label={t('acct.close', { defaultValue: '닫기' }) as string}
            onClick={() => { setBannerHidden(true); try { localStorage.setItem(bannerKey, '1'); } catch { /* 시크릿 창 */ } }}>
            ×
          </BannerClose>
        </Banner>
      )}
      <GuestChatPanel token={token || ''} canWrite={!!ctx.can_write} onGone={() => setGone(true)} />
    </Wrap>
  );
}

const Wrap = styled.div`display:flex;flex-direction:column;height:100dvh;background:#f8fafc;`;
const Head = styled.div`min-height:60px;padding:14px 20px;background:#fff;border-bottom:1px solid #e2e8f0;flex-shrink:0;`;
const Title = styled.div`font-size:1.125rem;font-weight:700;letter-spacing:-0.2px;color:#0f172a;`;
const Sub = styled.div`font-size:0.8125rem;color:#64748b;margin-top:2px;`;
const Center = styled.div`min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f8fafc;`;
const Card = styled.div`max-width:420px;text-align:center;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px 24px;`;
const H1 = styled.h1`margin:0 0 10px;font-size:1.125rem;font-weight:700;color:#0f172a;`;
const P = styled.p`margin:0;font-size:0.875rem;line-height:1.6;color:#64748b;`;
const RetryBtn = styled.button`
  margin-top:14px;height:44px;padding:0 18px;border:none;border-radius:10px;
  background:#14b8a6;color:#fff;font-size:0.875rem;font-weight:700;cursor:pointer;
`;
const Banner = styled.div`
  position:relative;margin:10px 20px 0;padding:12px 34px 12px 14px;
  background:#F0FDFA;border:1px solid #CCFBF1;border-radius:12px;
`;
const BannerText = styled.div`font-size:0.8125rem;color:#0F766E;line-height:1.5;`;
const BannerRow = styled.div`display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px;justify-content:flex-start;`;
const BannerInput = styled.input`
  flex:1 1 180px;min-width:0;height:36px;padding:0 10px;font-size:0.8125rem;
  border:1px solid #CCFBF1;border-radius:8px;background:#fff;color:#0F172A;
  &:focus{outline:none;border-color:#14B8A6;}
`;
const BannerBtn = styled.button`
  height:36px;padding:0 14px;border:none;border-radius:8px;background:#14B8A6;color:#fff;
  font-size:0.8125rem;font-weight:700;cursor:pointer;
  &:disabled{opacity:.5;cursor:not-allowed;}
`;
const BannerClose = styled.button`
  position:absolute;top:6px;right:8px;border:none;background:none;
  color:#94A3B8;font-size:1rem;line-height:1;cursor:pointer;padding:4px;
`;
