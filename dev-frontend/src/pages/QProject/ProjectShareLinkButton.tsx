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

export default function ProjectShareLinkButton({ projectId, projectName, businessId }: {
  projectId: number; projectName: string; businessId: number;
}) {
  const { t } = useTranslation('qproject');
  const [open, setOpen] = useState(false);
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
        clientName={projectName}
        autoOpen
        onClosed={() => { setOpen(false); void loadLive(); }}
        title={label}
        lead={t('share.projectLinkLead', {
          defaultValue: '로그인 없이 {{name}} 의 진행 상황·업무를 보고 문의할 수 있는 링크입니다. 카톡·메일로 보내세요.',
          name: projectName,
        }) as string}
        endpoints={{
          list: `/api/projects/${projectId}/guest-links`,
          issue: `/api/projects/${projectId}/guest-links`,
          revoke: (id: number) => `/api/projects/${projectId}/guest-links/${id}`,
        }}
      />
    );
  }

  return (
    <ShareBtn type="button" onClick={() => setOpen(true)}
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
  );
}

// 점을 얹으려면 기준이 필요하다 — HeaderBtn 자체에는 position 이 없다.
const ShareBtn = styled(HeaderBtn)`position:relative;`;
// 살아 있는 링크 표시 — 아이콘 우상단 점. 숫자가 아니라 "열려 있다" 는 사실만 말한다.
const LiveDot = styled.span`
  position:absolute;top:4px;right:4px;width:7px;aspect-ratio:1;border-radius:50%;
  background:#14B8A6;box-shadow:0 0 0 2px #FFFFFF;
`;
