// 프로젝트 **외부 공유 링크** — 로그인 없이 프로젝트 진행 상황을 보는 링크를 만든다 (2026-09-02).
//
// ★ 이름이 "고객 공유 링크" 였을 때 Irene: "이 버튼은 여기 왜 있어? 헷갈려."
//   눌러서 나오는 것이 채팅방 링크처럼 보였기 때문이다. 이름을 실제 결과에 맞추고,
//   착지 화면을 **프로젝트 중심**으로 바꿨다(GuestConversationPage).
//
// Irene: "프로젝트마다도 링크 만들어서 공유할 수 있어? 볼 수 있게?
//         보안등급 걸리는 건 로그인 시키고 나머지는 채팅창처럼 고객에게 그냥 공유할 수 있는 거."
//
// ★ 프로젝트용 **새 토큰 체계를 만들지 않는다**(Fable 판단). 이미 운영에 있는 게스트 링크가
//   `project_id` 를 들고 개요를 화이트리스트로 내보낸다. 프로젝트 공유 = **그 프로젝트의
//   고객 채널에 게스트 링크 발급**이다. 토큰이 두 벌이 되면 `visibleToGuest` 술어도 두 벌이 된다.
//
// ★ "고객 채널이 있으면 그 방, 없으면 만든다" 판단은 **서버**에 있다
//   (`POST /api/projects/:id/guest-channel`). 화면이 목록을 받아 스스로 고르면 화면마다 갈라진다.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import GuestLinkButton from '../../components/QTalk/GuestLinkButton';
import { HeaderBtn } from './QProjectDetailPage.styles';

type Target = { business_id: number; conversation_id: number; title: string | null; created: boolean };

export default function ProjectShareLinkButton({ projectId, projectName }: {
  projectId: number; projectName: string;
}) {
  const { t } = useTranslation('qproject');
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  // apiFetch 는 throw 하지 않는다 — 상태를 직접 본다. 침묵하면 사용자에겐 "고장" 이다.
  const [err, setErr] = useState<string | null>(null);

  const resolve = async () => {
    if (busy || target) return;
    setBusy(true); setErr(null);
    const r = await apiFetch(`/api/projects/${projectId}/guest-channel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.status === 403
        ? (t('share.errForbidden', '이 프로젝트의 공유 링크를 만들 권한이 없습니다.') as string)
        : (t('share.errGeneric', '고객 채널을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.') as string));
      return;
    }
    const j = await r.json().catch(() => null);
    if (j?.success && j.data) setTarget(j.data as Target);
    else setErr(t('share.errGeneric', '고객 채널을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.') as string);
  };

  // 채널이 정해지면 기존 게스트 링크 모달을 그대로 쓴다 (규격·문구·회수 UI 가 한 벌이어야 한다).
  if (target) {
    return (
      <GuestLinkButton
        businessId={target.business_id}
        conversationId={target.conversation_id}
        clientName={projectName}
        autoOpen
        onClosed={() => setTarget(null)}
      />
    );
  }

  return (
    <>
      <HeaderBtn type="button" onClick={resolve} disabled={busy}
        data-testid="project-share-link"
        title={t('share.title', '외부 공유 링크') as string}>
        {busy ? (t('share.preparing', '준비 중…') as string) : (t('share.title', '외부 공유 링크') as string)}
      </HeaderBtn>
      {err && <span role="alert" style={{ marginLeft: 8, fontSize: '0.75rem', color: '#DC2626' }}>{err}</span>}
    </>
  );
}
