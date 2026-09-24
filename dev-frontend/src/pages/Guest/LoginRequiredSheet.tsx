// 게스트 화면의 **로그인·계정 요청 시트 한 벌** — docs/GUEST_PROJECT_VIEW_DECISIONS.md §G.
//
// Irene: *"파일들, 채팅에서 청구서, 업무들 확인하고 싶으면 고객으로 등록하기 해서 워크스페이스 들어가게
//   해야 하는 거 아니야?"* — 서버(`guest_auth.js` auth-check · `account-request`)는 이미 있었고
//   **프로젝트 화면에 문이 없었다**(대화 화면의 배너에만 있었다). 화면이 안 붙은 것이다.
//
// ★ 문서 잠김·파일 받기·«고객으로 등록» 셋이 **이 시트 하나**를 쓴다. 탭마다 그리면 갈라진다.
// ★ 가입 화면으로 보내지 않는다 — 초대 없이 가입하면 자기 워크스페이스가 새로 생겨 고객이 빈 화면에
//   떨어진다(routes/auth.js). 계정은 멤버의 초대 메일 한 곳이고, 여기서는 **요청**만 보낸다.
// ★ [로그인] 은 `?redirect=` 로 이 링크로 돌아온다 — LoginPage 가 읽는 인자 이름이 `redirect` 다
//   (설계 문서 옛 판의 `next` 는 오기였다).
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { Sheet, SheetBox, SheetTitle, SheetBody, SheetBtn, SheetGhostBtn, SheetPortal, SheetClose } from './guestShell';

export type LoginSheetReason = 'locked-doc' | 'locked-file' | 'download' | 'register';

type Props = {
  open: boolean;
  onClose: () => void;
  reason: LoginSheetReason;
  token: string;
  /** 돌아올 탭 — 로그인 뒤 같은 탭으로 착지한다. */
  tab: string;
  /** 계정 요청을 이미 보냈는가(서버 ctx.account_requested 또는 이 화면에서 보냄). */
  requested: boolean;
  onRequested: () => void;
  /** 로그인했는데 이 프로젝트에 초대된 계정이 아니다(auth-check canAccess=false). */
  notInvited?: boolean;
  onGone: () => void;
};

export default function LoginRequiredSheet({ open, onClose, reason, token, tab, requested, onRequested, notInvited, onGone }: Props) {
  const { t } = useTranslation('guest');
  const ref = useRef<HTMLDivElement>(null);
  useBodyScrollLock(open);
  useEscapeStack(open, onClose);
  useFocusTrap(ref, open);
  const [asking, setAsking] = useState(false);   // 이메일 칸을 펼쳤는가
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!open) return null;

  const title = reason === 'locked-doc' ? t('login.lockedDocTitle', { defaultValue: '로그인하면 볼 수 있어요' })
    : reason === 'locked-file' ? t('login.lockedFileTitle', { defaultValue: '로그인하면 받을 수 있어요' })
      : reason === 'download' ? t('login.downloadTitle', { defaultValue: '파일을 받으려면 로그인이 필요해요' })
        : t('login.registerTitle', { defaultValue: '고객으로 등록' });
  const body = reason === 'register'
    ? t('login.registerBody', { defaultValue: '이 링크로는 보기만 할 수 있어요. 파일 받기·청구서·업무 확인은 고객 계정으로 워크스페이스에 들어오면 돼요.' })
    : t('login.lockedBody', { defaultValue: '고객 계정으로 로그인하면 볼 수 있어요. 계정이 없으면 담당자에게 요청해 주세요.' });

  const loginHref = `/login?redirect=${encodeURIComponent(`/g/${token}?tab=${tab}`)}`;

  const send = async () => {
    if (sending) return;
    setSending(true);
    setFailed(false);
    try {
      const r = await fetch(`/api/guest/${token}/account-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() || undefined }),
      });
      if (r.status === 404) { onGone(); return; }
      if (r.ok) onRequested(); else setFailed(true);
    } catch { setFailed(true); } finally { setSending(false); }
  };

  return (
    <SheetPortal>
    <Sheet role="dialog" aria-modal="true" aria-label={title as string} onClick={onClose} data-testid="guest-login-sheet">
      <SheetBox ref={ref} onClick={(e) => e.stopPropagation()}>
        <SheetClose type="button" onClick={onClose} aria-label={t('close', { defaultValue: '닫기' }) as string}
          data-testid="guest-login-close">×</SheetClose>
        <SheetTitle>{title}</SheetTitle>
        <SheetBody>{body}</SheetBody>
        {notInvited && (
          <Warn data-testid="guest-login-not-invited">
            {t('login.notInvited', { defaultValue: '이 프로젝트에 초대된 계정이 아니에요. 담당자에게 계정 요청을 보내세요.' })}
          </Warn>
        )}
        {!notInvited && (
          <SheetBtn type="button" $primary data-testid="guest-login-go"
            onClick={() => { window.location.assign(loginHref); }}>
            {t('login.login', { defaultValue: '로그인' })}
          </SheetBtn>
        )}
        {requested ? (
          <Sent data-testid="guest-login-requested">
            {t('acct.sent', { defaultValue: '요청을 보냈어요. 담당자가 초대 메일을 보내면 계정을 만들 수 있어요.' })}
          </Sent>
        ) : asking ? (
          <AskRow>
            {/* draft-exempt: 무인증 화면이라 초안 키를 만들 사용자가 없다 — 이메일 한 줄이고 시트를 닫으면 버리는 게 맞다 */}
            <EmailInput value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} inputMode="email"
              placeholder={t('acct.emailPh', { defaultValue: '이메일 (선택)' }) as string} data-testid="guest-login-email" />
            <SheetBtn type="button" onClick={() => void send()} disabled={sending} data-testid="guest-login-send">
              {t('acct.request', { defaultValue: '계정 요청하기' })}
            </SheetBtn>
            {failed && <Fail role="alert">{t('login.requestFailed', { defaultValue: '요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.' })}</Fail>}
          </AskRow>
        ) : (
          <SheetGhostBtn type="button" onClick={() => setAsking(true)} data-testid="guest-login-request">
            {t('acct.request', { defaultValue: '계정 요청하기' })}
          </SheetGhostBtn>
        )}
      </SheetBox>
    </Sheet>
    </SheetPortal>
  );
}

const Warn = styled.div`
  margin-top:12px;padding:10px 12px;border-radius:8px;background:#FFF7ED;border:1px solid #FED7AA;
  font-size:0.8125rem;line-height:1.5;color:#9A3412;
`;
const Sent = styled.div`
  margin-top:12px;padding:10px 12px;border-radius:8px;background:#F0FDFA;border:1px solid #99F6E4;
  font-size:0.8125rem;line-height:1.5;color:#0F766E;
`;
const AskRow = styled.div`margin-top:12px;display:flex;flex-direction:column;`;
const EmailInput = styled.input`
  height:44px;padding:0 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:0.875rem;
  &:focus{outline:2px solid #14B8A6;outline-offset:1px;border-color:transparent;}
`;
const Fail = styled.div`margin-top:6px;font-size:0.75rem;color:#dc2626;`;
