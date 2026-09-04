// 고객 대화방 진입 안내 — "이 방에 고객이 아직 못 들어옵니다".
//
// 왜 만드는가 (2026-09-04 운영 실측):
//   고객 대화방 4개 중 살아 있는 링크가 붙은 방은 **1개**. 나머지 3개는 고객이 들어올 방법이 없다.
//   그런데 그 1개는 **실제로 쓰였다**(last_used_at 있음). 기능이 안 먹히는 게 아니라 **시작이 안 된다.**
//   버튼은 이미 헤더에 있지만, "지금 이걸 해야 한다" 고 말해 주는 것이 없었다.
//
// 설계 원칙:
//   1. 조건이 맞을 때만 뜬다 — 고객 대화방 · 살아 있는 링크 0 · 내가 고객이 아님
//   2. 링크가 생기면 **상태에서 파생돼** 저절로 사라진다. 별도 플래그를 두면 갈라진다
//   3. 버튼은 기존 GuestLinkButton 을 그대로 연다 — 모달을 새로 만들지 않는다
//   4. 닫으면 그 방에서는 다시 안 뜬다(방별 기억). 매번 뜨면 잔소리가 된다
//   5. 메시지 목록 **위**에 둔다. 하단 고정 띠는 모바일에서 키보드가 입력줄을 덮는 회귀 전례가 있다
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import ActionButton from '../Common/ActionButton';
import GuestLinkButton from './GuestLinkButton';
import { hasLiveGuestLink, type GuestLink } from './guestLink';

const DISMISS_KEY = 'pq_guestlink_prompt_dismissed_v1';

function dismissedSet(): Set<number> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return new Set<number>(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
function rememberDismiss(convId: number) {
  try {
    const s = dismissedSet(); s.add(convId);
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...s].slice(-200)));
  } catch { /* 저장 실패해도 이번 화면에서는 닫힌다 */ }
}

export default function GuestLinkPrompt({ businessId, conversationId, clientName }: {
  businessId: number; conversationId: number; clientName: string;
}) {
  const { t } = useTranslation('qtalk');
  const [state, setState] = useState<'loading' | 'show' | 'hide'>('loading');
  const [openLink, setOpenLink] = useState(false);

  const check = useCallback(async () => {
    if (dismissedSet().has(conversationId)) { setState('hide'); return; }
    try {
      const r = await apiFetch(`/api/conversations/${businessId}/${conversationId}/guest-links`);
      if (!r.ok) { setState('hide'); return; }   // 권한 없음 등 — 조용히 접는다
      const j = await r.json();
      const links: GuestLink[] = j?.success ? (j.data || []) : [];
      setState(hasLiveGuestLink(links) ? 'hide' : 'show');
    } catch { setState('hide'); }
  }, [businessId, conversationId]);

  useEffect(() => { setState('loading'); setOpenLink(false); check(); }, [check]);

  if (state !== 'show') return null;

  return (
    <>
      <Box role="status">
        <Title>{t('guestPrompt.title', { defaultValue: '고객이 아직 이 대화를 볼 수 없습니다' })}</Title>
        <Desc>{t('guestPrompt.desc', { defaultValue: '링크를 보내면 고객이 로그인 없이 바로 대화하고 자료를 볼 수 있습니다.' })}</Desc>
        <Row>
          <ActionButton tone="primary" size="sm" onClick={() => setOpenLink(true)}>
            {t('guestPrompt.cta', { defaultValue: '고객 링크 보내기' })}
          </ActionButton>
          <Later
            type="button"
            onClick={() => { rememberDismiss(conversationId); setState('hide'); }}
          >
            {t('guestPrompt.later', { defaultValue: '나중에' })}
          </Later>
        </Row>
      </Box>
      {/* 발급 모달은 기존 것을 그대로 쓴다. 닫히면 다시 조회해 — 링크가 생겼으면 배너가 사라진다. */}
      {openLink && (
        <GuestLinkButton
          businessId={businessId}
          conversationId={conversationId}
          clientName={clientName}
          autoOpen
          onClosed={() => { setOpenLink(false); check(); }}
        />
      )}
    </>
  );
}

const Box = styled.div`
  margin: 12px 16px 4px;
  padding: 14px 16px;
  border: 1px solid #99F6E4;
  border-radius: 10px;
  background: #F0FDFA;
`;
const Title = styled.div`
  font-size: 0.875rem; font-weight: 700; color: #0F766E; line-height: 1.5;
`;
const Desc = styled.p`
  margin: 6px 0 0; font-size: 0.8125rem; line-height: 1.6; color: #475569;
`;
const Row = styled.div`
  margin-top: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
`;
const Later = styled.button`
  background: none; border: 0; padding: 6px 4px; cursor: pointer;
  font-size: 0.8125rem; color: #64748B;
  min-height: 36px;
  &:hover { color: #0F172A; text-decoration: underline; }
`;
