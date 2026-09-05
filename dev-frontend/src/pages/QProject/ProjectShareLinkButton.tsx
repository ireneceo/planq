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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import GuestLinkButton from '../../components/QTalk/GuestLinkButton';
import { HeaderBtn } from './QProjectDetailPage.styles';

export default function ProjectShareLinkButton({ projectId, projectName, businessId }: {
  projectId: number; projectName: string; businessId: number;
}) {
  const { t } = useTranslation('qproject');
  const [open, setOpen] = useState(false);

  const label = t('share.projectLink', { defaultValue: '외부 열람 링크' }) as string;

  if (open) {
    return (
      <GuestLinkButton
        businessId={businessId}
        conversationId={0}          /* 주소를 endpoints 로 넘기므로 쓰이지 않는다 */
        clientName={projectName}
        autoOpen
        onClosed={() => setOpen(false)}
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
    <HeaderBtn type="button" onClick={() => setOpen(true)}
      data-testid="project-share-link"
      title={label} aria-label={label}>
      {/* 링크(사슬) 아이콘 — 헤더 아이콘 규격 16px / stroke 2 */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </HeaderBtn>
  );
}
