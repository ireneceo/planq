// 프로젝트 **외부 열람 링크** — 로그인 없이 프로젝트(개요·업무·대화)를 보는 링크를 만든다.
//
// Irene: "프로젝트 헤더에 고객공유링크 버튼이 누르면 채팅창 링크가 생겨. 이 버튼은 여기 왜 있어?"
//        "나는 프로젝트 안 탭들 보는 그대로 프로젝트 링크 물어본건데?"
//   전에는 이 버튼이 **채널을 찾아 오는 API** 를 부른 뒤 대화방 링크 모달을 열었다. 그래서
//   결과가 채팅방 링크였다. 지금은 **한 번의 호출**로 프로젝트 링크(scope='project')를 만든다 —
//   어느 방에 걸리는지는 서버의 판단이다(services/project_channel.js).
//
// ★ 모달·복사·공유·회수 UI 는 대화방 링크와 **한 벌**을 쓴다(GuestLinkButton 에 주소만 넘긴다).
//   각자 만들면 반드시 갈라진다 — 이 저장소가 반복해서 데인 지점.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { apiFetch } from '../../contexts/AuthContext';
import { isLiveGuestLink, type GuestLink } from '../../components/QTalk/guestLink';
import GuestLinkButton from '../../components/QTalk/GuestLinkButton';
import { HeaderBtn } from './QProjectDetailPage.styles';
import { Modal } from '../../components/UI/Modal';

export default function ProjectShareLinkButton({ projectId, projectName, businessId, clients = [] }: {
  projectId: number; projectName: string; businessId: number;
  /** 이 프로젝트에 연결된 고객 — 둘 이상이면 «누구에게 줄 링크인가» 를 먼저 고른다(2026-10-07).
   *  고객 채널은 프로젝트 × 고객이라 링크도 고객마다 따로다. 고르지 않고 첫 방에 걸면 다른 고객이 남의 방을 본다. */
  clients?: Array<{ id: number; name: string }>;
}) {
  const { t } = useTranslation('qproject');
  const [open, setOpen] = useState(false);
  const uniq = clients.filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i);
  const [pickOpen, setPickOpen] = useState(false);
  const [clientId, setClientId] = useState<number | null>(null);
  const q = uniq.length >= 2 && clientId ? `?client_id=${clientId}` : '';
  const picked = uniq.find((c) => c.id === clientId);
  // ★ 지금 이 프로젝트가 **밖에서 열려 있는가** 를 멤버가 알아야 한다(설계 §7.2·§7.3).
  //   링크가 살아 있는 동안 그 프로젝트의 진행 상황이 링크 소지자에게 보인다 — 그 사실을
  //   화면이 말하지 않으면 아무도 모른다. 살아 있는 링크가 있으면 아이콘에 점을 찍는다.
  //   유효 판정은 components/QTalk/guestLink.ts 단일 원천(모달 목록과 같은 술어).
  const [liveCount, setLiveCount] = useState(0);
  const loadLive = useCallback(async () => {
    const r = await apiFetch(`/api/projects/${projectId}/guest-links`);
    if (!r.ok) return;                       // 조용히 — 이 표시가 실패해도 화면은 살아야 한다
    const j = await r.json().catch(() => null);
    if (j?.success) setLiveCount(((j.data || []) as GuestLink[]).filter(isLiveGuestLink).length);
  }, [projectId]);
  useEffect(() => { void loadLive(); }, [loadLive]);

  const label = t('share.projectLink', { defaultValue: '외부 열람 링크' }) as string;

  if (open) {
    return (
      <GuestLinkButton
        businessId={businessId}
        conversationId={0}          /* 주소를 endpoints 로 넘기므로 쓰이지 않는다 */
        clientName={picked ? `${projectName} · ${picked.name}` : projectName}
        autoOpen
        scope="project"
        onClosed={() => { setOpen(false); setClientId(null); void loadLive(); }}
        title={label}
        lead={t('share.projectLinkLead', {
          defaultValue: '로그인 없이 {{name}} 의 진행 상황·업무를 보고 문의할 수 있는 링크입니다. 카톡·메일로 보내세요.',
          name: projectName,
        }) as string}
        endpoints={{
          list: `/api/projects/${projectId}/guest-links${q}`,
          issue: `/api/projects/${projectId}/guest-links${q}`,
          revoke: (id: number) => `/api/projects/${projectId}/guest-links/${id}`,
        }}
      />
    );
  }

  return (
    <>
    {pickOpen && (
      <Modal isOpen onClose={() => setPickOpen(false)} title={t('share.pickClientTitle') as string} zIndex={2150}>
        <PickLead>{t('share.pickClientLead') as string}</PickLead>
        <PickList data-testid="project-share-pick">
          {uniq.map((c) => (
            <PickBtn key={c.id} type="button" onClick={() => { setClientId(c.id); setPickOpen(false); setOpen(true); }}>{c.name}</PickBtn>
          ))}
        </PickList>
      </Modal>
    )}
    <ShareBtn type="button" onClick={() => (uniq.length >= 2 ? setPickOpen(true) : setOpen(true))}
      data-testid="project-share-link"
      title={liveCount > 0 ? (t('share.projectLinkLive', { defaultValue: '외부 열람 링크 — 지금 열려 있습니다' }) as string) : label}
      aria-label={label}>
      {/* 링크(사슬) 아이콘 — 헤더 아이콘 규격 16px / stroke 2 */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      {liveCount > 0 && <LiveDot data-testid="project-share-live" aria-hidden />}
    </ShareBtn>
    </>
  );
}

// 점을 얹으려면 기준이 필요하다 — HeaderBtn 자체에는 position 이 없다.
const ShareBtn = styled(HeaderBtn)`position:relative;`;
// 살아 있는 링크 표시 — 아이콘 우상단 점. 숫자가 아니라 "열려 있다" 는 사실만 말한다.
const LiveDot = styled.span`
  position:absolute;top:4px;right:4px;width:7px;aspect-ratio:1;border-radius:50%;
  background:#14B8A6;box-shadow:0 0 0 2px #FFFFFF;
`;
const PickLead = styled.p`margin:0 0 12px;font-size:0.875rem;color:#475569;line-height:1.5;`;
const PickList = styled.div`display:flex;flex-direction:column;gap:8px;padding-bottom:4px;`;
const PickBtn = styled.button`
  min-height:44px;padding:0 14px;text-align:left;border:1px solid #E2E8F0;border-radius:10px;background:#FFFFFF;
  font-size:0.875rem;font-weight:600;color:#0F172A;cursor:pointer;
  &:hover{border-color:#14B8A6;background:#F0FDFA;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
`;
